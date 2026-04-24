import type { OpenAI } from "@workspace/integrations-openai-ai-server";
import { db } from "@workspace/db";
import {
  appointmentsTable,
  dentalLeadsTable,
  dentalActivityTable,
  dentalProceduresTable,
  dentalProfessionalsTable,
} from "@workspace/db";
import { eq, and, or, notInArray, isNull, ilike, count } from "drizzle-orm";
import { logger } from "./logger";
import { maskPhone } from "./pii-mask";
import { addMinutes, type AvailableSlot } from "./schedule-engine";
import type { ContactType } from "./lead-engine";
import { markStrategyOutcome } from "./lead-engine";
import { shouldSendPix, shouldSendWelcomeMedia } from "./insurance-policy";
import { getCachedSettings, getCachedProfessionals } from "./cache";

const APPOINTMENT_EXTRACTION_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "appointment_extraction",
    strict: true,
    schema: {
      type: "object",
      properties: {
        confirmed: {
          type: "boolean",
          description: "true SOMENTE se a IA confirmou explicitamente uma data e hora especificas",
        },
        date: {
          anyOf: [{ type: "string" }, { type: "null" }],
          description: "Data no formato YYYY-MM-DD ou null",
        },
        time: {
          anyOf: [{ type: "string" }, { type: "null" }],
          description: "Horario local (Brasilia UTC-3) no formato HH:MM ou null",
        },
        procedure: {
          anyOf: [{ type: "string" }, { type: "null" }],
          description: "Nome do procedimento mencionado ou null",
        },
        professionalName: {
          anyOf: [{ type: "string" }, { type: "null" }],
          description: "Nome exato do profissional mencionado na confirmacao ou null",
        },
      },
      required: ["confirmed", "date", "time", "procedure", "professionalName"],
      additionalProperties: false,
    },
  },
};

export type AppointmentExtraction = {
  confirmed: boolean;
  date: string | null;
  time: string | null;
  procedure: string | null;
  professionalName: string | null;
};

type PersistParams = {
  extraction: AppointmentExtraction;
  tenantId: number;
  conversationId: number;
  contactPhone: string;
  contactName?: string;
  contactType: ContactType;
  patientId?: number;
  leadId?: number;
  utcOffsetHours: number;
  professionals?: Array<{ id: number; name: string }>;
  /** Quando true, o contato é de convênio: PIX não deve ser gerado e
   *  a mídia de boas-vindas de lead (que pode conter instruções de
   *  pagamento particular) não deve ser disparada. */
  isInsuranceContact?: boolean;
  /** Lista de slots realmente disponíveis no servidor no momento da
   *  geração da resposta. Quando fornecida, atua como TRAVA DETERMINÍSTICA:
   *  se a IA confirmar uma data/hora/profissional que não bate com nenhum
   *  slot dessa lista, o agendamento é REJEITADO (não vai pro banco) e
   *  uma entrada estruturada de auditoria é logada. Quando undefined, a
   *  trava é desativada (compatibilidade retroativa). */
  availableSlots?: AvailableSlot[];
};

async function _persistAppointment(params: PersistParams): Promise<void> {
  const { extraction, tenantId, conversationId, contactPhone, contactName, contactType, patientId, leadId, utcOffsetHours, isInsuranceContact, availableSlots } = params;
  let { professionals } = params;

  if (!extraction.confirmed || !extraction.date || !extraction.time) {
    return;
  }

  if (!professionals) {
    const activeProfessionals = await getCachedProfessionals(tenantId);
    if (activeProfessionals.length > 0) {
      professionals = activeProfessionals.map((p) => ({ id: p.id, name: p.name }));
    }
  }

  const [year, month, day] = extraction.date.split("-").map(Number);
  const [hour, minute] = extraction.time.split(":").map(Number);

  if (!year || !month || !day || hour === undefined || minute === undefined) {
    logger.warn({ extraction }, "Invalid date/time in extraction");
    return;
  }

  const localStartMs = Date.UTC(year, month - 1, day, hour, minute, 0) - utcOffsetHours * 3600000;
  const startsAt = new Date(localStartMs);

  // Guard: never auto-create an appointment in the past. Allow a small
  // 60-second grace window for clock skew / processing delay between the
  // AI's extraction and the DB insert.
  const nowMs = Date.now();
  if (startsAt.getTime() <= nowMs - 60_000) {
    logger.warn(
      {
        tenantId,
        conversationId,
        contactPhone: maskPhone(contactPhone),
        startsAt: startsAt.toISOString(),
        nowISO: new Date(nowMs).toISOString(),
        extraction,
      },
      "Refusing to auto-create appointment in the past (AI extracted a time that already passed)",
    );
    return;
  }

  const [settings, cachedProfessionals] = await Promise.all([
    getCachedSettings(tenantId),
    getCachedProfessionals(tenantId),
  ]);

  const hasProfessionals = professionals && professionals.length > 0;
  const isMultiProf = professionals && professionals.length > 1;

  let singleProfFullRow: { defaultLeadDurationMinutes: number | null; defaultPatientDurationMinutes: number | null } | null = null;
  if (professionals && professionals.length === 1) {
    singleProfFullRow = cachedProfessionals.find((p) => p.id === professionals![0].id) ?? null;
  }
  const defaultDurationMinutes = contactType === "patient"
    ? (singleProfFullRow?.defaultPatientDurationMinutes || settings?.defaultPatientDurationMinutes || 30)
    : (singleProfFullRow?.defaultLeadDurationMinutes || settings?.defaultLeadDurationMinutes || 15);

  // ── Fuzzy word-prefix name match ─────────────────────────────────────────────
  // Handles AI hallucinating slightly wrong names (e.g. "Robertin" vs "Robertino").
  // Rule: every word in the shorter name must be a prefix (≥5 chars) or exact
  // match of a corresponding word in the longer name.
  function fuzzyProfNameMatch(extracted: string, profName: string): boolean {
    const wa = extracted.split(/\s+/).filter(Boolean);
    const wb = profName.split(/\s+/).filter(Boolean);
    return wa.every((wordA) =>
      wb.some((wordB) => {
        if (wordA === wordB) return true;
        const shorter = wordA.length <= wordB.length ? wordA : wordB;
        const longer = wordA.length > wordB.length ? wordA : wordB;
        return shorter.length >= 5 && longer.startsWith(shorter);
      }),
    );
  }

  let resolvedProfessionalId: number | undefined = undefined;
  if (extraction.professionalName && professionals && professionals.length > 0) {
    const extractedName = extraction.professionalName.toLowerCase().replace(/^dr[a]?\.?\s*/i, "").trim();

    const exactMatch = professionals.find((p) => {
      const profName = p.name.toLowerCase().replace(/^dr[a]?\.?\s*/i, "").trim();
      return profName === extractedName;
    });

    if (exactMatch) {
      resolvedProfessionalId = exactMatch.id;
    } else {
      const candidates = professionals.filter((p) => {
        const profName = p.name.toLowerCase().replace(/^dr[a]?\.?\s*/i, "").trim();
        return (
          profName.includes(extractedName) ||
          extractedName.includes(profName) ||
          fuzzyProfNameMatch(extractedName, profName)
        );
      });
      if (candidates.length === 1) {
        resolvedProfessionalId = candidates[0].id;
      } else if (candidates.length > 1) {
        logger.warn({ tenantId, extractedName, candidateCount: candidates.length }, "Ambiguous professional name match, skipping resolution");
      }
    }

    if (resolvedProfessionalId) {
      logger.info({ tenantId, professionalName: extraction.professionalName, professionalId: resolvedProfessionalId }, "Resolved professional from AI extraction");
    }
  }
  if (!resolvedProfessionalId && professionals && professionals.length === 1) {
    resolvedProfessionalId = professionals[0].id;
  }

  if (isMultiProf && !resolvedProfessionalId) {
    logger.warn({ tenantId, conversationId, extraction }, "Multi-professional tenant but could not resolve professionalId, skipping auto-create");
    return;
  }

  // ── TRAVA DETERMINÍSTICA (Opção A da Task #25) ─────────────────────────────
  // Se o servidor pré-computou os slots disponíveis, exigimos que o
  // (date, time, professionalId) extraído da resposta da IA bata com pelo
  // menos um slot real. Se não bater, REJEITAMOS o agendamento — significa
  // que a IA inventou ("hoje às 14h" quando hoje não é dia de convênio,
  // horário fora do expediente, agendamento fantasma, etc).
  // Quando availableSlots é undefined (intent não-scheduling, fluxos legados),
  // a trava é desativada para preservar compatibilidade.
  if (availableSlots !== undefined) {
    const matchesRealSlot = availableSlots.some((slot) => {
      if (slot.date !== extraction.date || slot.time !== extraction.time) return false;
      // professionalId do slot pode ser null (clínica sem multi-prof). Nesse caso
      // qualquer profissional resolvido (ou nenhum) é aceito. Quando o slot tem
      // professionalId definido, exigimos que bata com o que a IA escolheu —
      // ou que a IA não tenha escolhido nenhum (slot sem dono lá no banco).
      if (slot.professionalId === null) return true;
      if (resolvedProfessionalId === undefined) return true;
      return slot.professionalId === resolvedProfessionalId;
    });

    if (!matchesRealSlot) {
      logger.warn(
        {
          tenantId,
          conversationId,
          contactPhone: maskPhone(contactPhone),
          extractedDate: extraction.date,
          extractedTime: extraction.time,
          extractedProfessionalName: extraction.professionalName,
          resolvedProfessionalId,
          availableSlotsCount: availableSlots.length,
          availableSlotsSample: availableSlots.slice(0, 5),
          violation: "appointment_no_matching_slot",
        },
        "TRAVA: rejeitando agendamento — IA confirmou data/hora/profissional que NÃO existe na agenda real do servidor",
      );
      return;
    }
  }
  // ────────────────────────────────────────────────────────────────────────────

  let durationMinutes = defaultDurationMinutes;
  let resolvedProcedureId: number | undefined;

  if (extraction.procedure) {
    const matchedProc = await db.query.dentalProceduresTable.findFirst({
      where: and(
        eq(dentalProceduresTable.tenantId, tenantId),
        ilike(dentalProceduresTable.name, extraction.procedure),
        eq(dentalProceduresTable.active, "true"),
      ),
    });
    if (matchedProc) {
      resolvedProcedureId = matchedProc.id;
      if (matchedProc.durationMinutes) {
        durationMinutes = matchedProc.durationMinutes;
      }
    }
  }

  if (durationMinutes === defaultDurationMinutes && resolvedProfessionalId) {
    const resolvedProf = cachedProfessionals.find((p) => p.id === resolvedProfessionalId);
    if (resolvedProf?.slotDurationMinutes) {
      durationMinutes = resolvedProf.slotDurationMinutes;
    }
  }

  const endsAt = addMinutes(startsAt, durationMinutes);

  const alreadyExists = await db.query.appointmentsTable.findFirst({
    where: and(
      eq(appointmentsTable.tenantId, tenantId),
      eq(appointmentsTable.startsAt, startsAt),
      notInArray(appointmentsTable.status, ["cancelled", "no_show"]),
      ...(resolvedProfessionalId
        ? [or(eq(appointmentsTable.professionalId, resolvedProfessionalId), isNull(appointmentsTable.professionalId))]
        : []
      ),
    ),
  });
  if (alreadyExists) {
    logger.info({ tenantId, startsAt, professionalId: resolvedProfessionalId }, "Appointment already exists for this slot, skipping creation");
    return;
  }

  let resolvedPatientId = patientId;
  let resolvedLeadId = leadId;

  if (!resolvedPatientId && resolvedLeadId) {
    const lead = await db.query.dentalLeadsTable.findFirst({
      where: eq(dentalLeadsTable.id, resolvedLeadId),
    });
    if (!lead) return;

    if (lead.convertedToPatientId) {
      resolvedPatientId = lead.convertedToPatientId;
    }
  }

  if (!resolvedPatientId && !resolvedLeadId) {
    logger.warn({ tenantId, contactPhone: maskPhone(contactPhone) }, "Could not resolve patientId or leadId for appointment creation");
    return;
  }

  const profName = resolvedProfessionalId && hasProfessionals
    ? professionals!.find((p) => p.id === resolvedProfessionalId)?.name
    : undefined;

  // Check if the professional has PIX required mode enabled.
  // Usa o policy engine como fonte única: shouldSendPix já verifica
  // isInsuranceContact + pixEnabled + pixKey em um só lugar.
  let pixPaymentStatus: "none" | "pending" = "none";
  if (resolvedProfessionalId) {
    const profForPix = cachedProfessionals.find((p) => p.id === resolvedProfessionalId);
    if (profForPix && shouldSendPix(!!isInsuranceContact, profForPix) && profForPix.pixMode === "required") {
      pixPaymentStatus = "pending";
    }
  }

  const [appointment] = await db
    .insert(appointmentsTable)
    .values({
      tenantId,
      patientId: resolvedPatientId || undefined,
      leadId: resolvedLeadId || undefined,
      professionalId: resolvedProfessionalId || undefined,
      procedureId: resolvedProcedureId || undefined,
      startsAt,
      endsAt,
      status: "scheduled",
      pixPaymentStatus,
      procedureName: extraction.procedure || null,
      notes: `Agendamento realizado automaticamente via WhatsApp (IA)${profName ? ` - Profissional: ${profName}` : ""}`,
    })
    .returning();

  await db.insert(dentalActivityTable).values({
    tenantId,
    type: "appointment_scheduled",
    description: `Consulta agendada via WhatsApp: ${extraction.date} as ${extraction.time}${extraction.procedure ? ` - ${extraction.procedure}` : ""}${profName ? ` com ${profName}` : ""}`,
    entityType: "conversation",
    entityId: conversationId,
    metadata: JSON.stringify({
      appointmentId: appointment.id,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      procedure: extraction.procedure,
      professionalId: resolvedProfessionalId || null,
      professionalName: profName || null,
      source: "whatsapp_ai",
    }),
  });

  logger.info({ tenantId, appointmentId: appointment.id, startsAt, patientId: resolvedPatientId, professionalId: resolvedProfessionalId }, "Appointment auto-created from AI conversation");

  if (leadId) {
    markStrategyOutcome(tenantId, leadId, "positive").catch((err) => {
      logger.error({ err, tenantId, leadId }, "Failed to mark strategy outcome on appointment creation");
    });
  }

  const { runPostConversationLearning } = await import("./ai-learning");
  runPostConversationLearning(tenantId, contactPhone, conversationId, true).catch((err) => {
    logger.error({ err, tenantId, conversationId }, "Post-conversation learning (converted) failed");
  });

  // Welcome media: policy engine decide — convênio nunca recebe.
  if (resolvedLeadId && !resolvedPatientId && shouldSendWelcomeMedia(!!isInsuranceContact)) {
    _sendWelcomeMediaToLead({
      tenantId,
      leadId: resolvedLeadId,
      contactPhone,
      professionalId: resolvedProfessionalId,
    }).catch((err) => {
      logger.error({ err, tenantId, leadId: resolvedLeadId, contactPhone: maskPhone(contactPhone) }, "Failed to send welcome media to lead");
    });
  }
}

async function _sendWelcomeMediaToLead(params: {
  tenantId: number;
  leadId: number;
  contactPhone: string;
  professionalId?: number;
}): Promise<void> {
  const { tenantId, leadId, contactPhone, professionalId } = params;

  const [result] = await db
    .select({ appointmentCount: count() })
    .from(appointmentsTable)
    .where(
      and(
        eq(appointmentsTable.tenantId, tenantId),
        eq(appointmentsTable.leadId, leadId),
        notInArray(appointmentsTable.status, ["cancelled", "no_show"]),
      )
    );

  const appointmentCount = result?.appointmentCount ?? 0;
  if (appointmentCount > 1) {
    logger.info({ tenantId, leadId, appointmentCount }, "Not a first appointment — skipping welcome media");
    return;
  }

  if (!professionalId) {
    logger.info({ tenantId, leadId }, "No professional resolved — skipping welcome media");
    return;
  }

  const professional = await db.query.dentalProfessionalsTable.findFirst({
    where: and(
      eq(dentalProfessionalsTable.id, professionalId),
      eq(dentalProfessionalsTable.tenantId, tenantId),
    ),
  });

  if (!professional) {
    logger.info({ tenantId, professionalId }, "Professional not found — skipping welcome media");
    return;
  }

  const { welcomeVideoUrl, welcomeAudioUrl } = professional;
  if (!welcomeVideoUrl && !welcomeAudioUrl) {
    logger.info({ tenantId, professionalId }, "No welcome media configured for professional — skipping");
    return;
  }

  const { getProviderForTenant } = await import("./whatsapp-provider");
  const { provider, instanceName } = await getProviderForTenant(tenantId);

  if (welcomeVideoUrl) {
    try {
      await provider.sendVideo(contactPhone, welcomeVideoUrl, "", instanceName);
      logger.info({ tenantId, leadId, contactPhone: maskPhone(contactPhone), professionalId }, "Welcome video sent to lead");
    } catch (err) {
      logger.error({ err, tenantId, leadId, contactPhone: maskPhone(contactPhone) }, "Failed to send welcome video");
    }
  }

  if (welcomeAudioUrl) {
    try {
      const base64Match = welcomeAudioUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (base64Match) {
        const [, mimetype, audioBase64] = base64Match;
        await provider.sendAudio(contactPhone, audioBase64, instanceName, mimetype);
      } else {
        await provider.sendAudio(contactPhone, welcomeAudioUrl, instanceName);
      }
      logger.info({ tenantId, leadId, contactPhone: maskPhone(contactPhone), professionalId }, "Welcome audio sent to lead");
    } catch (err) {
      logger.error({ err, tenantId, leadId, contactPhone: maskPhone(contactPhone) }, "Failed to send welcome audio");
    }
  }
}

export async function tryCreateAppointmentFromReply(params: {
  client: OpenAI;
  tenantId: number;
  conversationId: number;
  contactPhone: string;
  contactName?: string;
  contactType: ContactType;
  patientId?: number;
  leadId?: number;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userContent: string;
  reply: string;
  utcOffsetHours: number;
  professionals?: Array<{ id: number; name: string }>;
  isInsuranceContact?: boolean;
  availableSlots?: AvailableSlot[];
}): Promise<void> {
  const { client, tenantId, conversationId, contactPhone, contactName, contactType, patientId, leadId, history, userContent, reply, utcOffsetHours, isInsuranceContact, availableSlots } = params;

  let professionals = params.professionals;
  if (!professionals) {
    const activeProfessionals = await getCachedProfessionals(tenantId);
    if (activeProfessionals.length > 0) {
      professionals = activeProfessionals.map((p) => ({ id: p.id, name: p.name }));
    }
  }

  const hasProfessionals = professionals && professionals.length > 0;
  const profListStr = hasProfessionals
    ? `\nProfissionais da clinica: ${professionals!.map((p) => p.name).join(", ")}.`
    : "";

  const localNow = new Date(Date.now() + utcOffsetHours * 3600000);
  const dayNames = ["Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"];
  const todayStr = `${dayNames[localNow.getUTCDay()]} ${localNow.toISOString().split("T")[0]}`;

  const extractionMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    {
      role: "system",
      content: `Analise a conversa entre o paciente/lead e a secretaria IA de uma clinica odontologica.
Determine se a secretaria IA acabou de CONFIRMAR um agendamento especifico nesta ultima mensagem.
Para ser considerado confirmado, a mensagem da IA deve conter: data E hora ESPECIFICOS do agendamento.

"confirmed" = true SOMENTE se a IA confirmou explicitamente uma data e hora especificas nesta mensagem.${profListStr}
HOJE e ${todayStr}.
Datas relativas como "amanha" ou "segunda-feira" devem ser resolvidas para YYYY-MM-DD com base nesta data de hoje.
O "time" deve ser o horario LOCAL (horario de Brasilia UTC-3).${hasProfessionals ? `\nSe a IA mencionou um profissional especifico na confirmacao, inclua o nome EXATO em "professionalName".` : ""}`,
    },
    ...history.slice(-6),
    { role: "user", content: userContent },
    { role: "assistant", content: reply },
  ];

  const extractionResponse = await client.chat.completions.create({
    model: "gpt-5.1",
    max_completion_tokens: 80,
    temperature: 0,
    response_format: APPOINTMENT_EXTRACTION_SCHEMA,
    messages: extractionMessages,
  });

  const raw = extractionResponse.choices[0]?.message?.content || "{}";
  let extraction: AppointmentExtraction;
  try {
    extraction = JSON.parse(raw) as AppointmentExtraction;
  } catch {
    logger.warn({ raw, tenantId }, "Failed to parse appointment extraction JSON");
    return;
  }

  await _persistAppointment({
    extraction,
    tenantId,
    conversationId,
    contactPhone,
    contactName,
    contactType,
    patientId,
    leadId,
    utcOffsetHours,
    professionals,
    isInsuranceContact,
    availableSlots,
  });
}

export async function createAppointmentFromData(params: {
  extraction: AppointmentExtraction;
  tenantId: number;
  conversationId: number;
  contactPhone: string;
  contactName?: string;
  contactType: ContactType;
  patientId?: number;
  leadId?: number;
  utcOffsetHours: number;
  professionals?: Array<{ id: number; name: string }>;
  isInsuranceContact?: boolean;
  availableSlots?: AvailableSlot[];
}): Promise<void> {
  await _persistAppointment(params);
}
