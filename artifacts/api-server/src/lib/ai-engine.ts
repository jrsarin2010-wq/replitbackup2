export interface InsuranceOverrideInput {
  isInsuranceContact: boolean;
  skipAvailability: boolean;
  shouldSkipScheduleOffer: boolean;
}

export interface InsuranceOverrideResult {
  skipAvailability: boolean;
  shouldSkipScheduleOffer: boolean;
  canOfferSchedule: boolean;
  wasOverridden: boolean;
}

export function computeInsuranceScheduleOverride(input: InsuranceOverrideInput): InsuranceOverrideResult {
  let { skipAvailability, shouldSkipScheduleOffer } = input;
  let wasOverridden = false;
  if (input.isInsuranceContact && skipAvailability) {
    skipAvailability = false;
    shouldSkipScheduleOffer = false;
    wasOverridden = true;
  }
  return { skipAvailability, shouldSkipScheduleOffer, canOfferSchedule: !shouldSkipScheduleOffer, wasOverridden };
}

import { openai as defaultOpenai, OpenAI } from "@workspace/integrations-openai-ai-server";
import { db } from "@workspace/db";
import {
  dentalConversationsTable,
  dentalMessagesTable,
  dentalLeadsTable,
  patientsTable,
  dentalActivityTable,
  tenantsTable,
  appointmentsTable,
} from "@workspace/db";
import type { DentalBlockedPeriod } from "@workspace/db";
import { eq, and, desc, sql, gt, asc, or } from "drizzle-orm";
import { logger } from "./logger";
import { getCachedSettings, getCachedProfessionals, getCachedProcedures } from "./cache";
import { resolveOwnerTitle, stripOwnerTitlePrefix } from "./owner-title";
import type { OwnerGender } from "./owner-title";
import { validateAIResponse, buildCorrectionHint, deterministicFallback } from "./response-validator";
import { getAvailabilityInfo, getActiveBlockedPeriodForToday } from "./schedule-engine";
import type { Intent } from "./schedule-engine";
import { detectUrgencyLevel, detectUrgencyInMessage, sendBlockedPeriodUrgencyAlert } from "./urgency-handler";
import { detectIntent } from "./intent-detector";
import type { ContactType, SalesStrategy } from "./lead-engine";
import {
  getTopStrategies,
  selectStrategiesForLead,
  logStrategy,
  markStrategyOutcome,
  updateLeadTemperature,
  generateRemarketingMessage,
  INSURANCE_DECLARED_PATTERN,
  detectsInsuranceDeclaration,
  PRIVATE_DECLARED_PATTERN,
  isBareParticularAnswer,
  isBareInsuranceAnswer,
  resolveInsuranceMode,
  shouldSuppressAgendaForTriage,
} from "./lead-engine";
import { buildSplitPrompt } from "./prompt-builder";
import { detectNonCoveredProcedureRouting, buildNonCoveredRoutingHint, clinicEffectivelyAcceptsInsurance } from "./prompt-helpers";
// Task #11 — fonte única de verdade pra cobrar/valor. Substitui lógica inline
// duplicada em `ai-engine.ts` (incluindo o fallback hardcoded "150.00").
import { resolveChargesConsultation, resolveConsultationFee } from "./insurance-policy";
import { resolveConversationMode, type ConversationMode } from "./mode-resolver";
import { isBasicPlan } from "./plan-features";
import { normalizePlanId } from "./plan-pricing";
import { sanitizePushName } from "./contact-utils";
import { maskPhone } from "./pii-mask";
import { tryCreateAppointmentFromReply, createAppointmentFromData } from "./appointment-extractor";
import type { AppointmentExtraction } from "./appointment-extractor";
import { detectSchedulingRefusal, trackAndEscalateRefusal, checkAndEscalate } from "./escalation";
import { maybeUpdateConversationSummary, buildSummaryContextBlock } from "./conversation-summarizer";
import { buildGpt5Extras, bumpTokensForLowReasoning } from "./ai-tuning";
import { recordAiCall } from "./ai-cost-metrics";

export { markStrategyOutcome, generateRemarketingMessage };
export type { ContactType, Intent };

function toOwnerGender(v: string | null | undefined): OwnerGender {
  return v === "male" || v === "female" || v === "unspecified" ? v : null;
}

const PEAK_TIMEOUT_MS = 8_000;

/**
 * Returns true if an OpenAI error should trigger a fallback to gpt-5-mini
 * instead of being propagated. Covers:
 *   - 429 RateLimitError (TPM/RPM quota exhausted on shared key)
 *   - 503 / 529 (OpenAI overloaded — Anthropic-style status sometimes seen)
 * Other errors (auth, bad request, 5xx other) propagate so we don't silently
 * mask real bugs by serving a degraded reply.
 */
function isFallbackEligibleError(err: unknown): { eligible: true; reason: "rate_limit" | "overloaded" } | { eligible: false } {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status?: number }).status;
    if (status === 429) return { eligible: true, reason: "rate_limit" };
    if (status === 503 || status === 529) return { eligible: true, reason: "overloaded" };
  }
  return { eligible: false };
}

/**
 * Returns true if the current local time (in the configured timezone) falls
 * within a peak-hour window on a weekday (Mon–Fri).
 *
 * Configuration:
 *   PEAK_TZ    — IANA timezone string, e.g. "America/Sao_Paulo" (default)
 *   PEAK_HOURS — Comma-separated HH:MM-HH:MM ranges in that timezone
 *                Default: "08:00-10:00,12:00-14:00"
 */
export function isPeakHour(
  timezone = process.env.PEAK_TZ ?? "America/Sao_Paulo",
): boolean {
  const now = new Date();
  const dtfOptions: Intl.DateTimeFormatOptions = {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { ...dtfOptions, timeZone: timezone }).formatToParts(now);
  } catch {
    const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone;
    logger.warn({ timezone, fallback }, "isPeakHour: invalid PEAK_TZ — falling back to server local timezone");
    parts = new Intl.DateTimeFormat("en-US", { ...dtfOptions, timeZone: fallback }).formatToParts(now);
  }

  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  if (weekday === "Sat" || weekday === "Sun") return false;

  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  const minuteStr = parts.find((p) => p.type === "minute")?.value ?? "0";
  const localMinutes = parseInt(hourStr, 10) * 60 + parseInt(minuteStr, 10);

  const rangesStr = process.env.PEAK_HOURS ?? "08:00-10:00,12:00-14:00";
  for (const range of rangesStr.split(",")) {
    const rangeParts = range.trim().split("-");
    if (rangeParts.length !== 2) continue;
    const [sh, sm] = (rangeParts[0] ?? "").split(":").map(Number);
    const [eh, em] = (rangeParts[1] ?? "").split(":").map(Number);
    if ([sh, sm, eh, em].some(isNaN)) continue;
    if (localMinutes >= sh * 60 + sm && localMinutes < eh * 60 + em) return true;
  }
  return false;
}

import { getOpenAIClient, invalidateOpenAIClient } from "./openai-client";
export { getOpenAIClient, invalidateOpenAIClient };
import { selectModelForComplexity } from "./model-selector";

/**
 * Schema mínimo `{ reply }` aplicado a intents NÃO-scheduling (objection,
 * question/FAQ, price_inquiry, triagem) para forçar o modelo a devolver JSON
 * estruturado e simplificar parsing/validação posterior.
 */
const REPLY_ONLY_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "dental_reply_only",
    strict: true,
    schema: {
      type: "object",
      properties: {
        reply: {
          type: "string",
          description: "Resposta completa para enviar ao paciente via WhatsApp",
        },
        metadata: {
          type: "object",
          properties: {
            intent: {
              anyOf: [{ type: "string" }, { type: "null" }],
              description: "Intent classificada pela IA (objection|question|price_inquiry|triage|other) ou null",
            },
            confidence: {
              anyOf: [{ type: "number" }, { type: "null" }],
              description: "Confiança da classificação 0-1 ou null",
            },
          },
          required: ["intent", "confidence"],
          additionalProperties: false,
        },
      },
      required: ["reply", "metadata"],
      additionalProperties: false,
    },
  },
};

const UNIFIED_SCHEDULING_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "dental_response_with_scheduling",
    strict: true,
    schema: {
      type: "object",
      properties: {
        reply: {
          type: "string",
          description: "Resposta completa para enviar ao paciente/lead via WhatsApp",
        },
        appointment: {
          type: "object",
          properties: {
            confirmed: {
              type: "boolean",
              description: "true SOMENTE se voce confirmou explicitamente uma data e hora especificas nesta mensagem",
            },
            date: {
              anyOf: [{ type: "string" }, { type: "null" }],
              description: "Data no formato YYYY-MM-DD ou null",
            },
            time: {
              anyOf: [{ type: "string" }, { type: "null" }],
              description: "Horario local (Brasilia UTC-3) HH:MM ou null",
            },
            procedure: {
              anyOf: [{ type: "string" }, { type: "null" }],
              description: "Nome do procedimento ou null",
            },
            professionalName: {
              anyOf: [{ type: "string" }, { type: "null" }],
              description: "Nome exato do profissional confirmado ou null",
            },
          },
          required: ["confirmed", "date", "time", "procedure", "professionalName"],
          additionalProperties: false,
        },
      },
      required: ["reply", "appointment"],
      additionalProperties: false,
    },
  },
};

/**
 * Auto-promove um lead para paciente quando a triagem detecta que ele é de
 * convênio. Regra de negócio: lead = sempre paciente PARTICULAR. Convênio
 * NÃO existe como lead — vai direto pra tabela de pacientes.
 *
 * - Cria patient com nome+telefone do lead
 * - Marca lead como converted (preserva histórico)
 * - Religa appointments existentes do leadId → patientId
 * - Retorna { patientId } para o caller atualizar contexto local
 */
async function promoteLeadToInsurancePatient(params: {
  tenantId: number;
  leadId: number;
}): Promise<{ patientId: number } | null> {
  const { tenantId, leadId } = params;
  try {
    const lead = await db.query.dentalLeadsTable.findFirst({
      where: and(eq(dentalLeadsTable.id, leadId), eq(dentalLeadsTable.tenantId, tenantId)),
    });
    if (!lead) return null;
    if (lead.status === "converted" && lead.convertedToPatientId) {
      return { patientId: lead.convertedToPatientId };
    }
    const name = (lead.name || "Contato WhatsApp").trim();
    const phone = (lead.phone || "").trim();
    if (!phone) return null;

    const result = await db.transaction(async (tx) => {
      const existing = await tx.query.patientsTable.findFirst({
        where: and(eq(patientsTable.tenantId, tenantId), eq(patientsTable.phone, phone)),
      });
      const patientId = existing?.id ?? (await tx
        .insert(patientsTable)
        .values({
          tenantId,
          name,
          phone,
          email: lead.email || undefined,
          notes: lead.notes || undefined,
          profilePicUrl: lead.profilePicUrl || undefined,
          patientType: "insurance",
        })
        .returning())[0].id;

      // Se o paciente já existia, garante que patientType=insurance
      if (existing) {
        await tx.update(patientsTable)
          .set({ patientType: "insurance" })
          .where(eq(patientsTable.id, existing.id));
      }

      await tx.update(dentalLeadsTable)
        .set({ status: "converted", convertedToPatientId: patientId, convertedAt: new Date(), paymentType: "insurance" })
        .where(and(eq(dentalLeadsTable.id, leadId), eq(dentalLeadsTable.tenantId, tenantId)));

      // Religa todos os agendamentos existentes do lead para o paciente novo
      await tx.update(appointmentsTable)
        .set({ leadId: null, patientId })
        .where(and(eq(appointmentsTable.leadId, leadId), eq(appointmentsTable.tenantId, tenantId)));

      await tx.insert(dentalActivityTable).values({
        tenantId,
        type: "lead_converted",
        description: `Lead ${name} auto-promovido para paciente (convênio detectado na triagem)`,
        entityType: "lead",
        entityId: leadId,
      });

      return patientId;
    });

    logger.info({ tenantId, leadId, patientId: result }, "Lead auto-promoted to insurance patient");
    return { patientId: result };
  } catch (err) {
    logger.error({ err, tenantId, leadId }, "Failed to auto-promote lead to insurance patient");
    return null;
  }
}

export async function processIncomingMessage(
  tenantId: number,
  conversationId: number,
  contactPhone: string,
  contactName: string | undefined,
  incomingMessage: string,
  contactType: ContactType = "unknown",
  patientId?: number,
  leadId?: number,
  mediaContext?: { type: "audio_transcription" | "image_analysis"; description: string },
  aggregatedCount: number = 1,
  waitMsTotal: number = 0,
): Promise<string> {
  const { isTenantCircuitOpen, checkAndRecordAICall, recordTenantError, getFallbackMessage } = await import("./tenant-rate-limiter");

  const circuitOpen = await isTenantCircuitOpen(tenantId);
  if (circuitOpen) {
    logger.warn({ tenantId, conversationId, contactPhone: maskPhone(contactPhone) }, "processIncomingMessage: circuit breaker open — returning fallback");
    return getFallbackMessage("circuit_open");
  }

  const rateCheck = await checkAndRecordAICall(tenantId);
  if (!rateCheck.allowed) {
    logger.warn({ tenantId, conversationId, contactPhone: maskPhone(contactPhone), remaining: rateCheck.remaining }, "processIncomingMessage: tenant AI rate limit exceeded — returning fallback");
    return getFallbackMessage("rate_limit");
  }

  const context = {
    tenantId,
    conversationId,
    contactPhone,
    contactName,
    contactType,
    patientId,
    leadId,
  };

  const intent = await detectIntent(incomingMessage);

  if (!patientId && !leadId) {
    const existingLead = await db.query.dentalLeadsTable.findFirst({
      where: and(eq(dentalLeadsTable.tenantId, tenantId), eq(dentalLeadsTable.phone, contactPhone)),
    });
    if (existingLead) {
      context.contactType = "lead";
      context.leadId = existingLead.id;
      leadId = existingLead.id;
    } else {
      const existingPatient = await db.query.patientsTable.findFirst({
        where: and(eq(patientsTable.tenantId, tenantId), eq(patientsTable.phone, contactPhone)),
      });
      if (existingPatient) {
        context.contactType = "patient";
        context.patientId = existingPatient.id;
        patientId = existingPatient.id;
      } else {
        const [newLead] = await db
          .insert(dentalLeadsTable)
          .values({
            tenantId,
            name: contactName || "Contato WhatsApp",
            phone: contactPhone,
            temperature: "cold",
            source: "whatsapp",
            status: "active",
          })
          .returning();
        context.contactType = "lead";
        context.leadId = newLead.id;
        leadId = newLead.id;

        await db.insert(dentalActivityTable).values({
          tenantId,
          type: "lead_auto_created",
          description: `Novo lead criado automaticamente: ${contactName || contactPhone}`,
          entityType: "lead",
          entityId: newLead.id,
        });
      }
    }
  }

  let strategiesUsed: SalesStrategy[] = [];
  let preloadedLead: Awaited<ReturnType<typeof db.query.dentalLeadsTable.findFirst>> | undefined;
  let preloadedTopStrategies: Awaited<ReturnType<typeof getTopStrategies>> | undefined;

  const recentMessagesPromise = db.query.dentalMessagesTable.findMany({
    where: eq(dentalMessagesTable.conversationId, conversationId),
    orderBy: [desc(dentalMessagesTable.sentAt)],
    limit: 12,
  });
  const conversationPromise = db.query.dentalConversationsTable.findFirst({
    where: eq(dentalConversationsTable.id, conversationId),
  });

  const earlyMessages = await recentMessagesPromise;
  const hasAnyPriorAssistant = earlyMessages.some((m) => m.direction === "outbound");
  const isFirstContactEarly = !hasAnyPriorAssistant;

  const inboundMessages = earlyMessages.filter((m) => m.direction === "inbound");
  const outboundMessages = earlyMessages.filter((m) => m.direction === "outbound");

  const previousAiOfferedSlots = outboundMessages.some((m) =>
    /\d{1,2}:\d{2}/.test(m.content || ""),
  );

  // The AI may have asked "deseja agendar?" / "quer marcar?" without
  // listing concrete times yet. Treat that as a pending scheduling offer
  // so an affirmative reply ("sim", "claro", "pode ser") is recognized
  // and the agenda is loaded on the next turn.
  const SCHEDULING_QUESTION_PATTERN =
    /\b(deseja|quer|gostaria|posso|podemos|vamos)\s+(marcar|agendar|reservar|encaixar)\b|\bquer\s+que\s+eu\s+(marque|agende)\b|\bpodemos\s+(marcar|agendar)\b|\bagendamos\b/i;
  const lastOutbound = outboundMessages[0]?.content || "";
  const previousAiAskedToSchedule = SCHEDULING_QUESTION_PATTERN.test(lastOutbound);

  const AFFIRMATIVE_REPLY_PATTERN =
    /^\s*(sim|claro|pode|pode ser|pode marcar|pode agendar|quero|quero sim|vamos|vamos la|bora|ok|okay|positivo|isso|isso mesmo|com certeza|por favor|pf|sim por favor|sim claro|aceito|aceito sim|fechado|combinado|beleza|blz|tranquilo|uhum|aham|yep|sure)\s*[!.?]*\s*$/i;
  const leadAffirmedScheduling = previousAiAskedToSchedule && AFFIRMATIVE_REPLY_PATTERN.test(incomingMessage);

  const leadExplicitlyAsksSchedule = /\b(quero marcar|quero agendar|vamos marcar|vamos agendar|pode marcar|pode agendar|marca pra mim|agenda pra mim|tem horario|tem vaga)\b/i.test(incomingMessage);

  const leadPreviouslyAskedSchedule = inboundMessages.some((m) => {
    const c = (m.content || "").toLowerCase();
    return /\b(quero marcar|quero agendar|vamos marcar|vamos agendar|pode marcar|pode agendar|marca pra mim|agenda pra mim|tem horario|tem vaga)\b/i.test(c);
  });

  const readyForSchedule =
    leadExplicitlyAsksSchedule ||
    leadPreviouslyAskedSchedule ||
    leadAffirmedScheduling ||
    previousAiOfferedSlots;

  let shouldSkipScheduleOffer =
    (isFirstContactEarly && intent === "greeting") ||
    intent === "objection" ||
    (!readyForSchedule && intent !== "scheduling");

  let skipAvailability = shouldSkipScheduleOffer;

  // ── Load settings early so clinicAcceptsInsurance is available for insurance detection ──
  const [tenantSettings, tenantProfessionals] = await Promise.all([
    getCachedSettings(tenantId),
    getCachedProfessionals(tenantId),
  ]);
  const clinicAcceptsInsurance = clinicEffectivelyAcceptsInsurance(tenantSettings, tenantProfessionals);

  let isInsuranceContact = false;
  // Persisted paymentType — captured at higher scope so the triage check can
  // reuse it without a second DB roundtrip.
  let persistedLeadPaymentType: string | null = null;
  // triageMode is set in each branch and reused below (eliminates duplicate call)
  let triageMode: ReturnType<typeof resolveInsuranceMode>;
  // Task #17 — modo determinístico de conversa (resolvido após triageMode).
  let conversationMode: ConversationMode = "PARTICULAR_SPIN";
  let conversationModeReason = "default";

  if (leadId) {
    updateLeadTemperature(leadId, intent, conversationId).catch((err) => {
      logger.error({ err, leadId, intent }, "Failed to update lead temperature");
    });

    let leadForTriage = await db.query.dentalLeadsTable.findFirst({
      where: eq(dentalLeadsTable.id, leadId),
    });
    persistedLeadPaymentType = leadForTriage?.paymentType ?? null;
    if (leadForTriage) {
      const declaredInsurance = detectsInsuranceDeclaration(incomingMessage);

      // Contextual affirmation: previous AI message asked "plano ou particular?"
      // and the user replied with a bare affirmative ("sim", "claro", etc.).
      // In that context "sim" = "sim, plano" — treat as insurance declaration.
      const AI_ASKED_INSURANCE_PATTERN = /plano\s*ou\s*(?:e\s*)?particular|vai\s*usar\s*plano|usa\s*plano|tem\s*plano|possui\s*plano/i;
      const aiAskedAboutInsurance = AI_ASKED_INSURANCE_PATTERN.test(lastOutbound);

      // Contextual bare-particular: the AI asked "plano ou particular?" and
      // the user replied with just "particular" (alone). PRIVATE_DECLARED_PATTERN
      // intentionally does NOT match the bare word (too many false positives in
      // questions/adjectives like "atende particular?" or "consulta particular
      // urgente"); we only trust it as a declaration when it clearly answers
      // the triage question.
      const contextualBarePrivate =
        aiAskedAboutInsurance && isBareParticularAnswer(incomingMessage);

      const declaredPrivate =
        PRIVATE_DECLARED_PATTERN.test(incomingMessage) || contextualBarePrivate;

      // Contextual bare-insurance: AI asked "plano ou particular?" and the
      // user replied with just "plano" or "convênio". INSURANCE_DECLARED_PATTERN
      // intentionally excludes bare words to avoid false positives from questions
      // ("atende plano?"); we only trust it as a declaration here, in context.
      const contextualBareInsurance =
        aiAskedAboutInsurance &&
        !contextualBarePrivate &&
        isBareInsuranceAnswer(incomingMessage);

      const contextualInsuranceAffirmation =
        aiAskedAboutInsurance &&
        !declaredPrivate &&
        (AFFIRMATIVE_REPLY_PATTERN.test(incomingMessage) || contextualBareInsurance);

      // Override semantics:
      //   - declaredInsurance has priority (covers the case where paymentType
      //     was wrongly persisted as "private" but the contact in fact uses
      //     a plan — Task #11 correction path).
      //   - contextualInsuranceAffirmation: user said "sim" to "plano ou particular?"
      //   - declaredPrivate only flips a null/insurance value when the message
      //     does NOT also carry an insurance signal.
      let next: "insurance" | "private" | null = null;
      if ((declaredInsurance || contextualInsuranceAffirmation) && leadForTriage.paymentType !== "insurance") next = "insurance";
      else if (declaredPrivate && !declaredInsurance && leadForTriage.paymentType !== "private") next = "private";
      if (next) {
        const newType = next;
        // Await the DB write to avoid a race condition: if the contact replies
        // again before the fire-and-forget write lands, the next turn would
        // reload leadForTriage with paymentType=null and re-trigger the
        // plano/particular triage question (loop bug).
        try {
          await db
            .update(dentalLeadsTable)
            .set({ paymentType: newType })
            .where(eq(dentalLeadsTable.id, leadId));
        } catch (err) {
          logger.error({ err, leadId, paymentType: newType }, "Failed to persist lead paymentType");
        }
        // Reflect immediately in local state so the in-flight prompt build sees
        // the corrected value (avoids one extra wrong-mode turn).
        leadForTriage.paymentType = newType;
        persistedLeadPaymentType = newType;

        // Regra de negócio: lead é sempre paciente PARTICULAR. Se virou
        // convênio, auto-promove pra paciente e atualiza contexto local.
        if (newType === "insurance" && leadId) {
          const promoted = await promoteLeadToInsurancePatient({ tenantId, leadId });
          if (promoted) {
            context.contactType = "patient";
            context.patientId = promoted.patientId;
            context.leadId = undefined;
            patientId = promoted.patientId;
            leadId = undefined as unknown as number;
            leadForTriage = null as unknown as typeof leadForTriage;
          }
        }
      }
    }

    // ── Detect insurance contact using real clinicAcceptsInsurance ────────────
    const insuranceModeForLead = resolveInsuranceMode({
      clinicAcceptsInsurance,
      persistedPaymentType: leadForTriage?.paymentType ?? null,
      currentMessage: incomingMessage,
      historyMessages: inboundMessages.map((m) => ({ content: m.content || "" })),
    });
    isInsuranceContact = insuranceModeForLead.isInsurance;
    triageMode = insuranceModeForLead;

    // ── Persist paymentType from history detection (covers contextual affirmation)
    // If resolveInsuranceMode detected insurance from conversation history (e.g.
    // user previously said a plan name, or replied "sim" to "plano ou particular?")
    // but the DB still shows null/private, persist now so future turns don't lose
    // the insurance context. Only fires when the current-message path above did not
    // already handle it (leadForTriage.paymentType !== "insurance").
    if (
      leadForTriage &&
      insuranceModeForLead.isInsurance &&
      leadForTriage.paymentType !== "insurance" &&
      !insuranceModeForLead.isPrivate
    ) {
      const newType = "insurance";
      db.update(dentalLeadsTable)
        .set({ paymentType: newType })
        .where(eq(dentalLeadsTable.id, leadId))
        .catch((err) => logger.error({ err, leadId, paymentType: newType }, "Failed to persist lead paymentType from history detection"));
      leadForTriage.paymentType = newType;
      persistedLeadPaymentType = newType;
      logger.info({ tenantId, leadId, contactPhone: maskPhone(contactPhone) }, "Persisted paymentType=insurance from history/context detection");

      if (leadId) {
        const promoted = await promoteLeadToInsurancePatient({ tenantId, leadId });
        if (promoted) {
          context.contactType = "patient";
          context.patientId = promoted.patientId;
          context.leadId = undefined;
          patientId = promoted.patientId;
          leadId = undefined as unknown as number;
          leadForTriage = null as unknown as typeof leadForTriage;
        }
      }
    }

    // ── Persist paymentType=private from history detection ──────────────────
    // Mirror of the insurance-history persistence above. Without this, when
    // resolveInsuranceMode detects isPrivate from past messages (e.g. user
    // previously said "particular" in answer to "plano ou particular?"), the
    // DB stays at paymentType=null. After a few turns the original message
    // falls outside the inboundMessages window (limit=12) and triage is
    // re-triggered, looping back to CONVENIO_TRIAGEM.
    if (
      leadForTriage &&
      insuranceModeForLead.isPrivate &&
      !insuranceModeForLead.isInsurance &&
      leadForTriage.paymentType !== "private" &&
      leadId
    ) {
      const newType = "private";
      try {
        await db
          .update(dentalLeadsTable)
          .set({ paymentType: newType })
          .where(eq(dentalLeadsTable.id, leadId));
      } catch (err) {
        logger.error({ err, leadId, paymentType: newType }, "Failed to persist lead paymentType=private from history detection");
      }
      leadForTriage.paymentType = newType;
      persistedLeadPaymentType = newType;
      logger.info({ tenantId, leadId, contactPhone: maskPhone(contactPhone) }, "Persisted paymentType=private from history/context detection");
    }

    const overrideResult = computeInsuranceScheduleOverride({ isInsuranceContact, skipAvailability, shouldSkipScheduleOffer });
    skipAvailability = overrideResult.skipAvailability;
    shouldSkipScheduleOffer = overrideResult.shouldSkipScheduleOffer;
    if (overrideResult.wasOverridden) {
      logger.info({ tenantId, contactPhone: maskPhone(contactPhone), leadId }, "Insurance contact detected — overriding skipAvailability to ensure insurance-filtered schedule is provided");
    }

    if (!skipAvailability) {
      const lead = leadForTriage;
      if (lead) {
        preloadedLead = lead;
        const topStrategies = await getTopStrategies(tenantId);
        preloadedTopStrategies = topStrategies;
        strategiesUsed = selectStrategiesForLead(lead.temperature, intent, topStrategies);
      }
    }
  } else {
    // ── Non-lead contact (patient or unknown) ────────────────────────────────
    const insuranceModeForPatient = resolveInsuranceMode({
      clinicAcceptsInsurance,
      persistedPaymentType: null,
      currentMessage: incomingMessage,
      historyMessages: inboundMessages.map((m) => ({ content: m.content || "" })),
    });
    isInsuranceContact = insuranceModeForPatient.isInsurance;
    triageMode = insuranceModeForPatient;

    const overrideResult = computeInsuranceScheduleOverride({ isInsuranceContact, skipAvailability, shouldSkipScheduleOffer });
    skipAvailability = overrideResult.skipAvailability;
    shouldSkipScheduleOffer = overrideResult.shouldSkipScheduleOffer;
    if (overrideResult.wasOverridden) {
      logger.info({ tenantId, contactPhone: maskPhone(contactPhone) }, "Insurance patient detected — overriding skipAvailability to ensure insurance-filtered schedule is provided");
    }
  }

  // Task #17 — resolve modo determinístico (uma única vez, fora do fluxo probabilístico do prompt).
  {
    const r = resolveConversationMode({
      contactType: context.contactType,
      clinicAcceptsInsurance,
      insuranceMode: triageMode,
    });
    conversationMode = r.mode;
    conversationModeReason = r.reason;
  }

  logger.info(
    {
      tenantId,
      contactPhone: maskPhone(contactPhone),
      isInsuranceContact,
      skipAvailability,
      readyForSchedule,
      intent,
      mode_resolved: conversationMode,
      mode_reason: conversationModeReason,
    },
    "Insurance detection result",
  );

  // ── Task #2 — Filtro server-side de especialidade ──────────────────────────
  // Aplicado AQUI (não antes) porque depende de `isInsuranceContact`. Em modo
  // convênio, primeiro restringimos a base de profissionais aos que aceitam
  // convênio (têm insuranceDays configurado); só então rodamos a detecção de
  // especialidade sobre essa sub-lista. Isso garante "convênio primeiro,
  // especialidade depois" e impede que um profissional particular vaze para a
  // AGENDA quando o paciente é de convênio.
  // Regra de negócio: usamos `insuranceDays?.trim()` como critério de elegibilidade
  // ao invés de `acceptsInsurance`, porque `insuranceDays` é o campo que controla
  // quais dias/horários o profissional atende por convênio na AGENDA — é a mesma
  // lógica que schedule-engine usa em `effectiveProfessionals`. Dessa forma, o
  // filtro de especialidade aqui é consistente com o que a AGENDA vai mostrar.
  // Consequência: se um profissional tem `acceptsInsurance=true` mas não tem
  // `insuranceDays` configurado, ele fica na base completa (sem filtro convênio),
  // o que é o comportamento esperado (sem configuração de dias, não há restrição).
  let routingBaseProfessionals = tenantProfessionals;
  if (isInsuranceContact) {
    const insuranceEligible = tenantProfessionals.filter((p) => p.insuranceDays?.trim());
    if (insuranceEligible.length > 0) {
      routingBaseProfessionals = insuranceEligible;
    }
  }
  const { applySpecialtyRouting, detectNeededSpecialty } = await import("./specialty-router");
  // Fix Task #14 — Prioridade da mensagem atual sobre o histórico.
  // Se a mensagem ATUAL sozinha dispara uma especialidade (ex.: "dente torto" →
  // ortodontia), usamos SOMENTE ela — ignoramos as mensagens anteriores para não
  // contaminar o roteamento com palavras-chave de outra conversa (ex.: a paciente
  // antes mencionou "perdi um dente" → implantodontia, agora diz "dente torto" →
  // sem essa proteção, as keywords de implante + ortodontia se unem e Robertino
  // vaza junto com Siverino).
  // Fallback para a janela completa somente quando a mensagem atual é ambígua
  // (respostas curtas como "sim", "plano", "pode ser") — nesses casos o histórico
  // recente é necessário para identificar a especialidade da rodada anterior.
  // recentInboundTexts is always computed so it is available in the audit log
  // regardless of which routing branch executes below.
  const recentInboundTexts = inboundMessages.slice(-2).map((m) => m.content || "");
  const currentMsgDetected = detectNeededSpecialty(incomingMessage);
  let routingTextWindow: string;
  if (currentMsgDetected.labels.length > 0) {
    // Current message alone has a clear specialty signal — use ONLY it.
    // The history window is intentionally excluded to prevent contamination from
    // prior turns (e.g., "perdi um dente" followed by "dente torto" must not
    // include implantodontia keywords in the routing window).
    routingTextWindow = incomingMessage;
  } else {
    // Ambiguous current message (short replies: "sim", "plano", "pode ser") —
    // expand to the last 2 inbound messages to catch specialty mentioned earlier.
    routingTextWindow = [...recentInboundTexts, incomingMessage].join(" ");
  }
  const routing = applySpecialtyRouting(routingTextWindow, routingBaseProfessionals);
  if (routing.detected.labels.length > 0 || routing.filtered) {
    logger.info(
      {
        tenantId,
        conversationId,
        contactPhone: maskPhone(contactPhone),
        isInsuranceContact,
        routing_base_size: routingBaseProfessionals.length,
        routing_window_messages: currentMsgDetected.labels.length > 0 ? 1 : recentInboundTexts.length + 1,
        routing_current_msg_only: currentMsgDetected.labels.length > 0,
        routing_detected_labels: routing.detected.labels,
        routing_keywords: routing.detected.keywords,
        routing_filtered: routing.filtered,
        routing_no_match_fallback: routing.noMatchFallback,
        routing_kept_professionals: routing.professionals.map((p) => p.name),
        routing_dropped_professionals: routingBaseProfessionals
          .filter((p) => !routing.professionals.some((kept) => kept.id === p.id))
          .map((p) => p.name),
      },
      "Specialty routing filter applied",
    );
  }
  const routedProfessionals = routing.professionals;
  let professionalsOverride: Array<{ id: number }> | null = routing.filtered ? routedProfessionals.map((p) => ({ id: p.id })) : null;

  let availabilityResult = skipAvailability
    ? { info: "", utcOffsetHours: -3, professionals: undefined as Array<{ id: number; name: string }> | undefined, blockedPeriod: undefined as DentalBlockedPeriod | null | undefined }
    : await getAvailabilityInfo(tenantId, intent, context.contactType, isInsuranceContact, professionalsOverride ? routedProfessionals : null).catch((err) => {
        logger.error({ err, tenantId }, "Failed to get availability info");
        return { info: "", utcOffsetHours: -3, professionals: undefined as Array<{ id: number; name: string }> | undefined, blockedPeriod: undefined as DentalBlockedPeriod | null | undefined };
      });

  // Task #2 / Task #14 — Step 4: se o filtro de especialidade deixou a AGENDA vazia
  // (sem horários e sem bloqueio ativo), tentamos novamente sem o filtro.
  // Task #14: ao reverter, guardamos um hint para injetar no prompt informando
  // ao LLM que o especialista detectado não tem horários — proibindo que ele
  // ofereça silenciosamente outros profissionais de especialidades diferentes.
  let routingAvailabilityFallback = false;
  // Populated when fallback triggers; pushed to systemHints after systemHints is declared.
  let specialtyFallbackHint: string | null = null;
  // Task #20 — quando o filtro de especialidade dropou profissionais (sem
  // acionar o fallback noMatch), guardamos os nomes dropados + o hint que
  // proibe explicitamente que o LLM os mencione (mesmo que apareçam no
  // histórico) e cobre o caso "único especialista não atende o convênio".
  let specialtyFilteredHint: string | null = null;
  let routingDroppedNames: string[] = [];
  let routingKeptNames: string[] = [];
  if (
    !skipAvailability &&
    professionalsOverride &&
    availabilityResult.hasAvailableSlots === false &&
    !availabilityResult.blockedPeriod
  ) {
    const retry = await getAvailabilityInfo(tenantId, intent, context.contactType, isInsuranceContact, null).catch((err) => {
      logger.error({ err, tenantId }, "Failed to get availability info (specialty fallback retry)");
      return null;
    });
    if (retry && retry.hasAvailableSlots === true) {
      routingAvailabilityFallback = true;
      const fallbackSpecialtyLabels = routing.detected.labels.join(" / ");
      const fallbackSpecialistNames = routedProfessionals.map((p) => p.name).join(", ");
      logger.info(
        {
          tenantId,
          conversationId,
          contactPhone: maskPhone(contactPhone),
          routing_availability_fallback: true,
          routing_kept_professionals: routedProfessionals.map((p) => p.name),
          routing_fallback_specialty_labels: routing.detected.labels,
        },
        "Specialty routing fallback: filtered agenda was empty — reverting to full professional list",
      );
      availabilityResult = retry;
      // Como a AGENDA voltou a usar todos os profissionais, o prompt também
      // precisa enxergar todos para não oferecer um especialista sem agenda.
      professionalsOverride = null;
      // Task #14 — Harden fallback: inject a hint so the LLM explicitly informs
      // the patient about specialist unavailability instead of silently offering
      // professionals from unrelated specialties.
      specialtyFallbackHint = `[SISTEMA: ESPECIALISTA INDISPONIVEL — O contato solicitou "${fallbackSpecialtyLabels}" mas nao ha horarios disponiveis no momento com ${fallbackSpecialistNames || "o especialista dessa area"}. PROIBIDO oferecer outros profissionais como alternativa sem deixar claro que sao de especialidades diferentes. Informe com gentileza que o especialista em ${fallbackSpecialtyLabels} nao tem horarios disponiveis agora. Somente se o contato aceitar explicitamente ser atendido por outro profissional (de outra especialidade), apresente as opcoes da AGENDA. Nao mencione nomes de profissionais nem areas distintas antes dessa aceitacao.]`;
    }
  }

  // Task #20 — Quando o filtro de especialidade dropou profissionais e o
  // override AINDA está ativo (não houve fallback de agenda vazia), montar
  // hint nominalizando os profissionais permitidos e PROIBINDO mencionar
  // qualquer um dos dropados nesta resposta — mesmo que apareçam no histórico
  // (cenário "dente torto" → IA lembra do Robertino oferecido em turnos
  // anteriores e o reoferece). Também cobre o caso "único especialista
  // existe mas não atende o convênio do paciente" (orienta a IA a comunicar
  // isso em vez de oferecer profissional de outra área).
  if (routing.filtered && !routing.noMatchFallback && professionalsOverride) {
    routingKeptNames = routedProfessionals
      .map((p) => p.name)
      .filter((n): n is string => !!n);
    routingDroppedNames = routingBaseProfessionals
      .filter((p) => !routedProfessionals.some((kept) => kept.id === p.id))
      .map((p) => p.name)
      .filter((n): n is string => !!n);
    const labelsStr = routing.detected.labels.join(" / ") || "essa area";
    const keptStr = routingKeptNames.join(", ") || "(nenhum)";
    const droppedClause = routingDroppedNames.length > 0
      ? ` PROIBIDO mencionar nesta resposta o(s) profissional(is): ${routingDroppedNames.join(", ")} — mesmo que aparecam no historico, eles NAO atendem ${labelsStr} e nao podem ser oferecidos para essa necessidade.`
      : "";
    let convenioCoverageClause = "";
    if (isInsuranceContact) {
      const anyKeptCoversInsurance = routedProfessionals.some(
        (p) => p.acceptsInsurance === true && (p.insuranceDays?.trim() ?? ""),
      );
      if (!anyKeptCoversInsurance) {
        convenioCoverageClause = ` ATENCAO: o(s) especialista(s) em ${labelsStr} desta clinica NAO atende(m) por convenio. Diga isso com clareza ao paciente e ofereca (a) atendimento PARTICULAR com ${keptStr}, ou (b) avaliacao. PROIBIDO oferecer profissional de outra especialidade so porque ele aceita o convenio do paciente.`;
      }
    }
    specialtyFilteredHint = `[SISTEMA: ESPECIALIDADE FILTRADA — Para a necessidade "${labelsStr}", os UNICOS profissionais habilitados desta clinica sao: ${keptStr}.${droppedClause}${convenioCoverageClause}]`;
  }

  const activeBlockedPeriodFromAvailability = availabilityResult.blockedPeriod;

  const activeBlockedPeriod = activeBlockedPeriodFromAvailability !== undefined
    ? activeBlockedPeriodFromAvailability
    : (detectUrgencyInMessage(incomingMessage)
      ? await getActiveBlockedPeriodForToday(tenantId).catch(() => null)
      : null);

  const urgencyLevel = detectUrgencyLevel(incomingMessage);
  if (activeBlockedPeriod && urgencyLevel) {
    const resolvedName = contactName || context.contactName || contactPhone;
    sendBlockedPeriodUrgencyAlert(
      tenantId,
      resolvedName,
      contactPhone,
      incomingMessage,
      activeBlockedPeriod,
      urgencyLevel,
    ).catch((err) => logger.error({ err, tenantId }, "Failed to send blocked period urgency alert"));
  }

  const conversation = await conversationPromise;

  const hasSummary = !!conversation?.aiSummary;
  const summaryContextBlock = buildSummaryContextBlock(conversation?.aiSummary);

  const allMessages = earlyMessages.reverse();

  // When the aggregator combined multiple inbound messages, those same messages were
  // already persisted to the DB and would now appear at the tail of `allMessages`.
  // Drop them from history to avoid duplicating the user turn (history would have
  // them as separate turns AND the combined text is appended as the current user turn).
  let trimmedAllMessages = allMessages;
  if (aggregatedCount > 1) {
    let trailingInboundCount = 0;
    for (let i = allMessages.length - 1; i >= 0; i--) {
      if (allMessages[i].direction === "inbound") trailingInboundCount++;
      else break;
    }
    const dropCount = Math.min(aggregatedCount, trailingInboundCount);
    if (dropCount > 0) {
      trimmedAllMessages = allMessages.slice(0, allMessages.length - dropCount);
    }
  }

  const historyMessages = hasSummary ? trimmedAllMessages.slice(-16) : trimmedAllMessages;

  const history = historyMessages
    .map((m) => ({
      role: m.direction === "inbound" ? ("user" as const) : ("assistant" as const),
      content: m.content || "",
    }))
    .filter((m) => m.content);

  // ── Topic resume hint ─────────────────────────────────────────────────────────
  // If the latest user message is just a short greeting BUT we have substantive
  // history with a recent assistant turn (< 24h), instruct the AI to resume the
  // prior topic instead of restarting with "como posso ajudar".
  const GREETING_ONLY_RE = /^\s*(oi+|ol[áa]|hey+|hi+|bom\s*dia|boa\s*tarde|boa\s*noite|tudo\s*bem\??|opa+|e[\s-]*a[íi])(\s*[!.?,]*\s*(oi+|ol[áa]|bom\s*dia|boa\s*tarde|boa\s*noite|tudo\s*bem\??|opa+))*\s*[!.?,]*\s*$/i;
  const isGreetingOnly = GREETING_ONLY_RE.test(incomingMessage.trim());
  let topicResumeHint: string | undefined;
  if (isGreetingOnly && history.length >= 4) {
    const lastOutbound = [...allMessages].reverse().find((m) => m.direction === "outbound" && (m.content || "").trim());
    if (lastOutbound && lastOutbound.sentAt) {
      const ageMs = Date.now() - new Date(lastOutbound.sentAt).getTime();
      if (ageMs < 24 * 60 * 60 * 1000) {
        const firstSentence = (lastOutbound.content || "").split(/(?<=[.!?])\s+/)[0]?.slice(0, 80) || "";
        if (firstSentence) topicResumeHint = firstSentence;
      }
    }
  }

  const availabilityInfo = availabilityResult.info;
  const utcOffsetHours = availabilityResult.utcOffsetHours;
  const conversationSentiment = conversation?.sentiment || "neutral";

  const isFirstContact = isFirstContactEarly;

  let schedulingRefusalCount = 0;
  const currentMessageIsRefusal = !skipAvailability && detectSchedulingRefusal(incomingMessage, history);
  if (!skipAvailability) {
    const refusalRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(dentalActivityTable)
      .where(
        and(
          eq(dentalActivityTable.tenantId, tenantId),
          eq(dentalActivityTable.entityType, "conversation"),
          eq(dentalActivityTable.entityId, conversationId),
          eq(dentalActivityTable.type, "scheduling_refusal"),
        ),
      );
    schedulingRefusalCount = Number(refusalRows[0]?.count || 0);
    if (currentMessageIsRefusal) {
      schedulingRefusalCount += 1;
    }
  }

  const isEarlyConnectionPhase = isFirstContactEarly && (intent === "greeting" || intent === "question" || intent === "price_inquiry" || intent === "other");

  let canOfferSchedule = !shouldSkipScheduleOffer;

  const tenantRow = await db.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, tenantId) });
  const tenantPlan = normalizePlanId(tenantRow?.plan) ?? tenantRow?.plan ?? "premium";
  const tenantIsBasicPlan = isBasicPlan(tenantPlan);
  // Task #25 — feature flag de geração restrita (constrained generation).
  // Quando ON, bypass do prompt-builder legado + validador de 779 linhas, usando
  // JSON Schema com slot_ids/professional_id enums e render layer determinístico.
  const useConstrainedGeneration = tenantRow?.useConstrainedGeneration === true;

  // ── Build userContent (clean — no [SISTEMA:] hints) ─────────────────────────
  const localNowTs = new Date(Date.now() + utcOffsetHours * 3600000);
  const tsStr = `${localNowTs.toISOString().split("T")[0].split("-").reverse().join("/")} ${localNowTs.toISOString().substring(11, 16)}`;
  let userContent = `[${tsStr}] ${incomingMessage}`;
  if (mediaContext) {
    if (mediaContext.type === "audio_transcription") {
      userContent = `[${tsStr}] [O paciente enviou um audio. Transcricao do audio: "${mediaContext.description}"]`;
    } else if (mediaContext.type === "image_analysis") {
      const extraText = incomingMessage && incomingMessage !== mediaContext.description ? `\n\nMensagem do paciente junto com a foto: ${incomingMessage}` : "";
      userContent = `[${tsStr}] [O paciente enviou uma foto. Analise da imagem: "${mediaContext.description}"]${extraText}`;
    }
  }

  // ── Collect [SISTEMA:] hints — injected into dynamic context, NOT userContent ─
  const systemHints: string[] = [];
  // Task #14 — push the specialty-fallback hint (built earlier when the
  // specialist's agenda was empty and the fallback reverted to all professionals).
  if (specialtyFallbackHint) {
    systemHints.push(specialtyFallbackHint);
  }
  // Task #20 — bloqueio nominal de profissionais dropados pelo filtro de
  // especialidade (impede vazamento via histórico).
  if (specialtyFilteredHint) {
    systemHints.push(specialtyFilteredHint);
  }
  const schedulingIntents: Intent[] = ["scheduling", "rescheduling", "price_inquiry"];

  // ── Triage gating ──────────────────────────────────────────────────────────
  // triageMode was already resolved in the lead/patient branch above with the
  // real clinicAcceptsInsurance value — no second call needed.
  const insuranceTriagePending = shouldSuppressAgendaForTriage({
    clinicAcceptsInsurance,
    contactType: context.contactType,
    insuranceMode: triageMode,
  });

  let availabilityInfoForPrompt = availabilityInfo;
  if (insuranceTriagePending) {
    availabilityInfoForPrompt = "";
    logger.info(
      {
        tenantId,
        conversationId,
        contactPhone: maskPhone(contactPhone),
        availability_suppressed_reason: "insurance_triage_pending",
        intent,
        contactType: context.contactType,
      },
      "Suppressing AGENDA block from prompt — insurance triage pending",
    );
    // Task #23 — na 1ª resposta da IA seja calorosa como uma recepcionista
    // humana (cumprimente, pergunte como está, o que a pessoa está sentindo).
    // NAO pergunte plano/particular ainda. Da 2ª resposta em diante, a
    // pergunta plano/particular passa a ser obrigatória.
    const aiHasRepliedBefore = historyMessages.some((m) => m.direction === "outbound");
    if (aiHasRepliedBefore) {
      systemHints.push(`[SISTEMA: A clinica aceita convenio e este contato AINDA NAO informou se vai usar plano ou particular. Pergunta obrigatoria nesta resposta: "Voce vai usar plano ou e particular?", vinculada ao que ele acabou de dizer (sem soar interrogatorio). PROIBIDO mencionar horarios, dias da semana, periodos da agenda ou oferecer marcacao antes da resposta — a AGENDA foi propositalmente suprimida.]`);
    } else {
      systemHints.push(`[SISTEMA: 1ª resposta a este contato. Voce e uma RECEPCIONISTA HUMANA, calorosa. PROIBIDO ja pedir plano/particular nesta 1ª resposta — isso soa robotico. Em vez disso: cumprimente pelo nome, reconheca o que a pessoa trouxe (mesmo se foi so "oi"), pergunte como ela esta ou o que ela esta sentindo. Apenas na PROXIMA troca (depois que ela responder) voce pergunta plano/particular. PROIBIDO em qualquer caso mencionar horarios, dias da semana, periodos da agenda ou oferecer marcacao — a AGENDA foi propositalmente suprimida.]`);
    }
  } else if (!shouldSkipScheduleOffer && context.contactType !== "patient" && availabilityInfo) {
    // Cross-specialty routing — insurance lead asked for a procedure that no
    // insurance-accepting professional handles in this clinic. Suppress AGENDA
    // and inject a deterministic hint so the AI redirects to the private
    // professional(s) instead of falling into convênio scarcity mode.
    const nonCoveredRouting = isInsuranceContact
      ? detectNonCoveredProcedureRouting(incomingMessage, tenantProfessionals)
      : null;
    if (nonCoveredRouting) {
      availabilityInfoForPrompt = "";
      shouldSkipScheduleOffer = true;
      skipAvailability = true;
      canOfferSchedule = false;
      systemHints.push(buildNonCoveredRoutingHint(nonCoveredRouting));
      logger.info(
        {
          tenantId,
          conversationId,
          contactPhone: maskPhone(contactPhone),
          procedureLabel: nonCoveredRouting.procedureLabel,
          privateProfs: nonCoveredRouting.privateProfs.map((p) => p.name),
          availability_suppressed_reason: "non_covered_procedure_for_insurance_lead",
        },
        "Suppressing AGENDA — insurance lead asked for procedure not covered by any insurance professional",
      );
    } else if (isInsuranceContact) {
      systemHints.push(`[SISTEMA: MODO CONVENIO — Este contato usa plano/convenio. PROIBIDO ABSOLUTO: frases de implicacao, consequencia ou urgencia ("pode complicar", "vai sair mais caro", "deixar para depois", "pode piorar"). PROIBIDO SPIN Selling. Ofereca SOMENTE os horarios da AGENDA DISPONIVEL. Se o contato pedir um dia nao listado na AGENDA, redirecione para o dia disponivel: "Nosso atendimento por convenio e nos dias listados na agenda. O proximo horario e [data]." NUNCA confirme horario em dia fora da AGENDA.]`);
    } else if (isFirstContact && schedulingIntents.includes(intent)) {
      if (clinicAcceptsInsurance && PRIVATE_DECLARED_PATTERN.test(incomingMessage)) {
        systemHints.push(`[SISTEMA: Lead declarou que e particular. Inclua os 2 horarios da AGENDA com escassez (1 manha + 1 tarde).]`);
      } else if (!clinicAcceptsInsurance) {
        systemHints.push(`[SISTEMA: O lead quer agendar/saber preco. Alem de se apresentar, inclua os 2 horarios da AGENDA com escassez.]`);
      }
    }
  }
  // Task #24 — informar valor da consulta proativamente para PARTICULAR
  // (gated por chargesConsultation; consulta gratuita vira diferencial).
  // Task #11 — passa a usar `resolveChargesConsultation`/`resolveConsultationFee`
  // do `insurance-policy.ts` (fonte única de verdade). Removido o fallback
  // hardcoded "150.00" — quando o tenant não tem fee configurado, NÃO
  // promete preço; o módulo central proíbe isso explicitamente.
  if (conversationMode === "PARTICULAR_SPIN") {
    const singleProf = tenantProfessionals.length === 1 ? tenantProfessionals[0] : null;
    // Only inject the flat-fee hint for single-prof clinics: multi-prof clinics
    // may have different fees per professional — the per-professional listing in
    // the prompt already handles that correctly, so we avoid injecting a wrong
    // global fee here.
    if (singleProf) {
      const chargesC = resolveChargesConsultation(singleProf, tenantSettings ?? null);
      const fee = resolveConsultationFee(singleProf, tenantSettings ?? null);
      if (chargesC && fee) {
        systemHints.push(`[SISTEMA: Lead PARTICULAR. Ao oferecer agendamento, INFORME PROATIVAMENTE o valor da consulta (R$ ${fee}) na mesma frase da oferta de horarios — nao espere o paciente perguntar. Ex: "A consulta sai por R$ ${fee}. Tenho quarta as 10:00 ou 14:00, qual fica melhor?". PROIBIDO oferecer horario sem mencionar o valor.]`);
      } else if (!chargesC) {
        systemHints.push(`[SISTEMA: Lead PARTICULAR e a consulta de avaliacao e GRATUITA nesta clinica. Destaque isso como diferencial junto com a oferta de horarios. NAO cite valor em R$ para a consulta — ela e gratuita.]`);
      }
      // chargesC=true && fee=null → sem fee configurado: não promete preço,
      // não promete gratuidade. Silencioso é o caminho seguro.
    }
  }

  // ── Upcoming appointment check ────────────────────────────────────────────────
  // Always runs — even when shouldSkipScheduleOffer is already true.
  // Reason: shouldSkipScheduleOffer starts true for non-scheduling intents
  // (readyForSchedule=false), but the AI can still invent a slot from history.
  // We must inject a hard prohibition hint and zero out availabilityInfoForPrompt
  // so the model has NO slot data to hallucinate with.
  //
  // NOTE: A contact can exist as BOTH a patient AND a lead in the DB (e.g. when
  // converted). The webhook resolves patient-first and nulls out the lead ref, so
  // appointments booked against the lead_id would be missed if we only checked
  // patientId. Solution: always check by phone via a sub-select covering both.
  if (leadId || patientId) {
    try {
      // Build an OR clause: match by patientId OR by leadId OR by any lead with
      // the same phone (handles patient/lead split-identity scenario).
      const apptConditions: Parameters<typeof and>[0][] = [
        eq(appointmentsTable.tenantId, tenantId),
        eq(appointmentsTable.status, "scheduled"),
        gt(appointmentsTable.startsAt, new Date()),
      ];

      // Sub-select all lead IDs for this phone so we catch appointments booked
      // against a lead even when the caller holds a patientId.
      const leadsForPhone = await db
        .select({ id: dentalLeadsTable.id })
        .from(dentalLeadsTable)
        .where(and(eq(dentalLeadsTable.tenantId, tenantId), eq(dentalLeadsTable.phone, contactPhone)));

      const leadIdsForPhone = leadsForPhone.map((r) => r.id);

      const identityConditions: Parameters<typeof or>[0][] = [];
      if (patientId) identityConditions.push(eq(appointmentsTable.patientId, patientId));
      if (leadId) identityConditions.push(eq(appointmentsTable.leadId, leadId));
      for (const lid of leadIdsForPhone) {
        identityConditions.push(eq(appointmentsTable.leadId, lid));
      }

      const whereClause = identityConditions.length === 1
        ? and(...apptConditions, identityConditions[0])
        : and(...apptConditions, or(...identityConditions));

      const [upcomingAppt] = await db
        .select({ startsAt: appointmentsTable.startsAt, procedureName: appointmentsTable.procedureName })
        .from(appointmentsTable)
        .where(whereClause)
        .orderBy(asc(appointmentsTable.startsAt))
        .limit(1);
      if (upcomingAppt) {
        const apptDate = upcomingAppt.startsAt.toLocaleDateString("pt-BR", {
          weekday: "long",
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "America/Sao_Paulo",
        });
        shouldSkipScheduleOffer = true;
        skipAvailability = true;
        availabilityInfoForPrompt = "";
        systemHints.push(
          `[SISTEMA: AGENDAMENTO JA CONFIRMADO. Este contato JA POSSUI consulta marcada: ${upcomingAppt.procedureName || "Consulta"} em ${apptDate}. PROIBIDO oferecer novo horario, mencionar dias da semana, horarios ou profissionais disponíveis. Se o contato perguntar sobre o agendamento, confirme gentilmente os dados acima. Mantenha conversa amigavel e natural sem SPIN selling.]`,
        );
        logger.info(
          { tenantId, contactPhone: maskPhone(contactPhone), apptDate, procedureName: upcomingAppt.procedureName },
          "AI: suppressing schedule offer — contact already has upcoming appointment",
        );
      }
    } catch (err) {
      logger.warn({ err, tenantId }, "AI: failed to check upcoming appointments — continuing without override");
    }
  }

  // ── Estimate tokens already used by history + user + summaryContext ──────────
  // (identity tokens are added inside buildSplitPrompt after the identity is built)
  const historyTokens = Math.ceil(history.map((m) => m.content).join("").length / 4);
  const userTokens = Math.ceil(userContent.length / 4);
  const summaryTokens = summaryContextBlock ? Math.ceil(summaryContextBlock.length / 4) : 0;
  const alreadyUsedTokens = historyTokens + userTokens + summaryTokens;

  // ── Resolve OpenAI client (peak just kept for logging correlation) ─────────
  // Strategy: ALWAYS try selectedModel first with an 8s timeout. Only fall back to
  // gpt-5.1 on (a) timeout, (b) HTTP 429 rate-limit, or (c) HTTP 503/529
  // overloaded. We no longer downgrade by clock — most peak-hour calls now
  // succeed and patients get the full SPIN/empathy experience even
  // on the shared global key. Tenants only get the degraded model when the
  // upstream actually pushes back.
  const client = await getOpenAIClient(tenantId);
  const usingGlobalKey = client === defaultOpenai;
  const peak = isPeakHour();

  // ── Select primary model based on conversation complexity ─────────────────
  const modelSelection = selectModelForComplexity({
    conversationMode,
    isFirstContact,
    routingFiltered: routing.filtered,
    routedProfessionalsCount: routedProfessionals.length,
    totalProfessionalsCount: tenantProfessionals.length,
    routingLabelsDetected: routing.detected.labels.length,
  });
  const selectedModel = modelSelection.model;
  logger.info(
    {
      tenantId,
      conversationId,
      model_selected: selectedModel,
      model_reason: modelSelection.reason,
      conversationMode,
      isFirstContact,
      routing_filtered: routing.filtered,
      routed_pro_count: routedProfessionals.length,
      total_pro_count: tenantProfessionals.length,
    },
    "model_routing: primary model selected",
  );

  let aiModel = selectedModel;
  let fallbackReason: "timeout" | "rate_limit" | "overloaded" | null = null;

  // ── Task #14 — Audit log: final professionals visible in the prompt ──────────
  // Lists all professional names that will be injected into the LLM prompt so that
  // future specialty-leak incidents can be traced immediately from the log stream
  // without needing to reconstruct the prompt from source.
  logger.info(
    {
      tenantId,
      conversationId,
      contactPhone: maskPhone(contactPhone),
      prompt_professionals_override_active: !!professionalsOverride,
      prompt_active_professionals: professionalsOverride
        ? routedProfessionals.map((p) => p.name)
        : tenantProfessionals.map((p) => p.name),
      routing_availability_fallback: routingAvailabilityFallback,
      routing_specialty_hint_injected: !!specialtyFallbackHint,
      routing_specialty_filtered_hint_injected: !!specialtyFilteredHint,
      routing_dropped_names_blocked: routingDroppedNames,
    },
    "Prompt audit: final professionals list visible to LLM",
  );

  // ── Task #25 — Vars compartilhadas entre caminho restrito e legado ────────
  let reply: string = "";
  let inlineAppointment: AppointmentExtraction | null = null;
  let retryUsed = false;
  let fallbackUsed = false;
  let promptTokensFinal = 0;
  let completionTokensFinal = 0;
  let cachedTokens = 0;
  let constrainedAction: string | null = null;
  let constrainedViolations: string[] = [];

  if (useConstrainedGeneration) {
    // ── Caminho RESTRITO (Task #25) ─────────────────────────────────────────
    const { runConstrainedGeneration } = await import("./constrained-engine");
    const { buildFactsBlock, getSlotOffset } = await import("./constrained-facts");
    const settingsForConstrained = await getCachedSettings(tenantId).catch(() => null);
    const procsForConstrained = await getCachedProcedures(tenantId).catch(() => []);
    const localNow = new Date(Date.now() + utcOffsetHours * 3600000);
    const todayLabel = `${["Dom","Seg","Ter","Qua","Qui","Sex","Sab"][localNow.getUTCDay()]} ${String(localNow.getUTCDate()).padStart(2,"0")}/${String(localNow.getUTCMonth()+1).padStart(2,"0")}/${localNow.getUTCFullYear()}`;
    // Task #1 — janela do histórico configurável via env (default 8 turnos),
    // antes era 6 hardcoded. Permite ajuste sem deploy quando o resumo persistente
    // estiver suprindo bem o contexto antigo.
    const histTurnsRaw = Number(process.env.CONSTRAINED_HISTORY_TURNS);
    const histTurns = Number.isFinite(histTurnsRaw) && histTurnsRaw >= 2 && histTurnsRaw <= 24 ? histTurnsRaw : 8;
    const recentHistoryText = history
      .slice(-histTurns)
      .map((m) => `${m.role}: ${typeof m.content === "string" ? m.content : ""}`)
      .join("\n");
    const constrainedProfessionals = (professionalsOverride ? routedProfessionals : tenantProfessionals).map((p) => ({
      id: p.id,
      name: p.name,
      pixEnabled: p.pixEnabled ?? null,
      pixKey: p.pixKey ?? null,
      pixBank: p.pixBank ?? null,
      pixKeyType: p.pixKeyType ?? null,
      pixMode: p.pixMode ?? null,
      consultationFee: p.consultationFee ?? null,
      chargesConsultation: p.chargesConsultation ?? null,
      isOwner: p.isOwner ?? null,
      // Bug fix (post-review #2) — propagar config de convênio por
      // profissional para o engine restrito filtrar slots e mostrar status.
      acceptsInsurance: p.acceptsInsurance ?? null,
      insurancePlans: p.insurancePlans ?? null,
    }));
    // Task #1 — bloco [FATOS] determinístico construído ANTES da chamada à
    // OpenAI. profIdShortByDbId mapeia profId numérico → "pX" usando a MESMA
    // ordem que o engine usa para `assignProfessionalIds`, garantindo que o
    // "prof preferido" referenciado em [FATOS] case com [PROFISSIONAIS].
    const profIdShortByDbId = new Map(constrainedProfessionals.map((p, i) => [p.id, `p${i + 1}`]));
    const facts = await buildFactsBlock(tenantId, contactPhone, profIdShortByDbId).catch(() => ({ text: null, factCount: 0 }));
    // aiSummary já é carregado por `getOrCreateConversation` no início do fluxo.
    const totalAvailableSlots = availabilityResult.availableSlots?.length ?? 0;
    // Task #1 — paginação determinística: lê offset persistido do turno
    // anterior (incrementado quando IA pediu request_more_slots, resetado
    // em CONFIRM_SLOT). Falha silenciosa retorna 0.
    const slotOffset = await getSlotOffset(tenantId, contactPhone).catch(() => 0);
    try {
      const cr = await runConstrainedGeneration({
        client,
        tenantId,
        conversationId,
        contactName: contactName ?? null,
        contactPhone,
        contactType: context.contactType,
        intent: String(intent),
        conversationMode,
        isInsuranceContact,
        isFirstContact,
        availableSlots: availabilityResult.availableSlots ?? [],
        totalAvailableSlots,
        slotOffset,
        professionals: constrainedProfessionals,
        procedureNames: procsForConstrained.map((p) => p.name).filter(Boolean),
        insurancePlans: settingsForConstrained?.insurancePlans ?? null,
        clinicName: settingsForConstrained?.clinicName ?? "a clinica",
        aiName: settingsForConstrained?.aiName ?? "Sofia",
        personalityHint: null,
        settingsConsultationFee:
          settingsForConstrained?.consultationFee != null
            ? String(settingsForConstrained.consultationFee)
            : null,
        settingsChargesConsultation: settingsForConstrained?.chargesConsultation ?? null,
        recentHistoryText,
        userContent,
        todayLabel,
        model: selectedModel,
        // Task #1 — injeta resumo persistente da conversa como contexto de paciente.
        patientContext: conversation?.aiSummary ?? null,
        factsBlock: facts.text,
      });
      reply = cr.reply;
      inlineAppointment = cr.inlineAppointment;
      aiModel = cr.modelUsed;
      promptTokensFinal = cr.promptTokens;
      completionTokensFinal = cr.completionTokens;
      cachedTokens = cr.cachedTokens;
      constrainedAction = cr.structured.action;
      constrainedViolations = cr.violations;
    } catch (constrainedErr) {
      logger.error(
        { err: constrainedErr, tenantId, conversationId },
        "constrained-engine: failed — using deterministic fallback reply",
      );
      reply = "Vou confirmar isso com a clinica e ja te aviso, ta bom?";
      inlineAppointment = null;
    }
  } else {
  // ── Caminho LEGADO ───────────────────────────────────────────────────────
  // ── Build split prompt ───────────────────────────────────────────────────────
  const { identityPrompt, dynamicContext } = await buildSplitPrompt(
    tenantId, context, intent, availabilityInfoForPrompt, incomingMessage,
    conversationSentiment, isFirstContact, schedulingRefusalCount,
    isEarlyConnectionPhase, canOfferSchedule,
    {
      preloadedLead,
      preloadedTopStrategies,
      conversationHistory: history,
      isBasicPlan: tenantIsBasicPlan,
      topicResumeHint,
      systemHints,
      alreadyUsedTokens,
      conversationMode,
      isInsuranceContact,
      professionalsOverride: professionalsOverride ?? undefined,
      // Sempre passa os IDs filtrados por especialidade — mesmo quando o
      // fallback de agenda vazia zerou professionalsOverride. Isso garante que
      // a lista de PLANOS no prompt reflita só os profissionais que atendem
      // a especialidade pedida (ex.: implante → Dr. Robertino), evitando
      // oferecer planos cobertos só por especialistas de outras áreas.
      specialtyMatchedProfessionalIds: routing.filtered
        ? routedProfessionals.map((p) => p.id)
        : undefined,
    },
  );

  // ── Assemble messages: identity → summaryContext? → history → dynamic → user ─
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: identityPrompt },
    ...(summaryContextBlock ? [{ role: "system" as const, content: summaryContextBlock }] : []),
    ...history,
    ...(dynamicContext ? [{ role: "system" as const, content: dynamicContext }] : []),
    { role: "user", content: userContent },
  ];

  const useUnifiedSchema = (intent === "scheduling" || intent === "rescheduling") && !shouldSkipScheduleOffer;
  // Intents NÃO-scheduling (objection, FAQ/question, price_inquiry, triagem)
  // também são forçados a JSON `{ reply }` via REPLY_ONLY_SCHEMA, padronizando
  // parsing e validação. greeting/cancellation seguem em texto puro para não
  // sobrecarregar trocas curtas.
  const useReplySchema = !useUnifiedSchema && (
    intent === "objection" ||
    intent === "question" ||
    intent === "price_inquiry" ||
    insuranceTriagePending === true
  );
  const responseFormat = useUnifiedSchema
    ? UNIFIED_SCHEDULING_SCHEMA
    : useReplySchema
      ? REPLY_ONLY_SCHEMA
      : null;

  if (useUnifiedSchema) {
    const localNow2 = new Date(Date.now() + utcOffsetHours * 3600000);
    const dayNames2 = ["Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"];
    const todayStr2 = `${dayNames2[localNow2.getUTCDay()]} ${localNow2.toISOString().split("T")[0]}`;
    messages.push({
      role: "system",
      content: `IMPORTANTE — FORMATO DA RESPOSTA: Responda em JSON com dois campos: "reply" (sua mensagem para o paciente, sem formatacao JSON) e "appointment" (dados do agendamento). Preencha "appointment.confirmed": true e os demais campos SOMENTE se voce estiver confirmando uma data E hora especificas nesta mensagem. Caso contrario, use confirmed: false e null nos demais. HOJE e ${todayStr2}.`,
    });
  }

  // Token budget: 400 is too tight when the reply may carry the agenda (2 slots +
  // scarcity language) AND/OR the appointment payload — the unified JSON
  // ({ reply, appointment }) on scheduling intents, OR the [APT_CARD: ...] text
  // marker emitted from the identity prompt on confirmation turns of any intent.
  // Truncation in either path silently drops the booking.
  //
  // Gate: !skipAvailability. Note that `skipAvailability === shouldSkipScheduleOffer`
  // throughout this function (initial assignment + insurance override flips both),
  // so this is equivalent to `canOfferSchedule` — i.e. precisely the turns where
  // APT_CARD output is permitted by the prompt.
  const replyMaxTokens = skipAvailability ? 400 : 600;
  // Quando AI_REASONING_EFFORT=low|minimal, sobra orçamento de tokens (o modelo
  // gasta menos em raciocínio interno) — aumentamos o teto da resposta em ~200
  // APENAS no gpt-5-mini, para evitar truncamento de APT_CARD/JSON.
  const replyMaxTokensGpt5 = bumpTokensForLowReasoning(replyMaxTokens);

  // Helper to build the completion call (avoids repetition between primary and fallback).
  // Aplica prompt_cache_key + reasoning_effort APENAS no gpt-5-mini. O fallback
  // (gpt-5-mini) recebe os parâmetros mínimos de antes — esse modelo não usa
  // reasoning tokens e o cache key não tem efeito relevante nele.
  const makeCall = (callModel: string, signal?: AbortSignal) => {
    const isGpt5 = callModel.startsWith("gpt-5");
    const extras = isGpt5 ? buildGpt5Extras({ tenantId, namespace: "dental-conv" }) : {};
    return client.chat.completions.create(
      {
        model: callModel,
        max_completion_tokens: isGpt5 ? replyMaxTokensGpt5 : replyMaxTokens,
        messages,
        temperature: 0.2,
        ...(responseFormat ? { response_format: responseFormat } : {}),
        ...extras,
      } as Parameters<typeof client.chat.completions.create>[0],
      signal ? { signal } : undefined,
    );
  };

  let response;
  try {
    // Try selected model first, wrapped in an abort-based timeout race.
    // Fallback to gpt-5.1 only on (a) timeout, (b) 429 rate-limit,
    // (c) 503/529 overloaded. Other errors propagate.
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(), PEAK_TIMEOUT_MS);
    try {
      response = await makeCall(selectedModel, ac.signal);
      clearTimeout(timeoutId);
    } catch (primaryErr) {
      clearTimeout(timeoutId);
      const fbErr = isFallbackEligibleError(primaryErr);
      const timedOut = ac.signal.aborted;
      if (timedOut) {
        aiModel = "gpt-5.1";
        fallbackReason = "timeout";
        logger.warn(
          { tenantId, conversationId, fallback_reason: "timeout", primary_model: selectedModel, model_used: "gpt-5.1", timeout_ms: PEAK_TIMEOUT_MS, peak, usingGlobalKey },
          `processIncomingMessage: ${selectedModel} timed out — retrying with gpt-5.1`,
        );
        response = await makeCall("gpt-5.1");
      } else if (fbErr.eligible) {
        aiModel = "gpt-5.1";
        fallbackReason = fbErr.reason;
        logger.warn(
          { tenantId, conversationId, fallback_reason: fbErr.reason, primary_model: selectedModel, model_used: "gpt-5.1", peak, usingGlobalKey, err: primaryErr },
          `processIncomingMessage: ${selectedModel} ${fbErr.reason} — retrying with gpt-5.1`,
        );
        response = await makeCall("gpt-5.1");
      } else {
        throw primaryErr;
      }
    }
  } catch (aiError) {
    await recordTenantError(tenantId);
    logger.error(
      { err: aiError, tenantId, conversationId, model_used: aiModel, fallback_reason: fallbackReason },
      "processIncomingMessage: OpenAI call failed — error recorded in circuit breaker",
    );
    throw aiError;
  }

  // Captura métricas de cache hit (vem em prompt_tokens_details.cached_tokens
  // quando a OpenAI aplica o desconto de prompt cache). Só registra se foi a
  // chamada principal (gpt-5-mini) — o fallback distorce a média.
  const usage = (response as { usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } }).usage;
  cachedTokens = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  promptTokensFinal = usage?.prompt_tokens ?? 0;
  completionTokensFinal = usage?.completion_tokens ?? 0;
  // Record cache-hit metrics only when the actual final model is gpt-5 (prompt-cache
  // is only relevant/meaningful for gpt-5 models). Guard with both conditions:
  // no fallback occurred AND the model used is in the gpt-5 family.
  if (fallbackReason === null && aiModel.startsWith("gpt-5")) {
    recordAiCall({ promptTokens: usage?.prompt_tokens ?? 0, cachedTokens });
  }

  // max_tokens_effective reflects the actual model used (aiModel), not the selected one —
  // when fallback kicked in, aiModel is gpt-5-mini which doesn't use the bumped limit.
  const isGpt5Final = aiModel.startsWith("gpt-5");
  logger.info(
    { tenantId, conversationId, model_selected: selectedModel, model_used: aiModel, model_reason: modelSelection.reason, fallback_reason: fallbackReason, peak, aggregated_count: aggregatedCount, topic_resume: !!topicResumeHint, wait_ms_total: waitMsTotal, max_tokens_used: replyMaxTokens, max_tokens_effective: isGpt5Final ? replyMaxTokensGpt5 : replyMaxTokens, cached_tokens: cachedTokens, prompt_tokens: usage?.prompt_tokens ?? 0 },
    "processIncomingMessage: AI reply generated",
  );

  const rawContent = response.choices[0]?.message?.content || "";
  // Task #25 — vars `reply`, `inlineAppointment`, `retryUsed`, `fallbackUsed`
  // são hoisted antes do dispatcher (compartilhadas com o caminho restrito).

  if (useUnifiedSchema) {
    try {
      const parsed = JSON.parse(rawContent) as { reply: string; appointment: AppointmentExtraction };
      reply = parsed.reply || "Desculpe, nao consegui processar sua mensagem. Por favor, tente novamente.";
      inlineAppointment = parsed.appointment ?? null;
    } catch {
      logger.warn({ tenantId, conversationId }, "Failed to parse unified scheduling JSON — falling back to raw content");
      reply = rawContent || "Desculpe, nao consegui processar sua mensagem. Por favor, tente novamente.";
    }
  } else if (useReplySchema) {
    try {
      const parsed = JSON.parse(rawContent) as { reply?: string; metadata?: { intent?: string | null; confidence?: number | null } };
      reply = parsed.reply || rawContent || "Desculpe, nao consegui processar sua mensagem. Por favor, tente novamente.";
      if (parsed.metadata) {
        logger.debug(
          { tenantId, conversationId, intent, ai_metadata: parsed.metadata },
          "reply-only schema metadata captured",
        );
      }
    } catch {
      logger.warn({ tenantId, conversationId, intent }, "Failed to parse reply-only JSON — falling back to raw content");
      reply = rawContent || "Desculpe, nao consegui processar sua mensagem. Por favor, tente novamente.";
    }
  } else {
    reply = rawContent || "Desculpe, nao consegui processar sua mensagem. Por favor, tente novamente.";
  }

  if (currentMessageIsRefusal && schedulingRefusalCount >= 2) {
    const firstName = sanitizePushName(contactName)?.split(" ")[0] || "";
    const nameStr = firstName ? `, ${firstName}` : "";
    const settingsForEscalation = await getCachedSettings(tenantId);
    const profName = settingsForEscalation?.professionalName || "o(a) doutor(a)";
    reply = `Entendi${nameStr}! Vou falar com o(a) Dr(a). ${profName} pra ver se consigo algo especial pra voce. Te retorno em breve, ta bom?`;
    logger.info({ tenantId, conversationId, schedulingRefusalCount }, "Deterministic graceful acceptance triggered");
  }

  // ── Post-response validation (Task #29) ──────────────────────────────────────
  // Garante que a resposta obedece à configuração do tenant (procedimentos
  // cadastrados, horários da AGENDA, triagem plano/particular, gênero do
  // titular, preços). Em caso de violação faz UM retry com hint de correção;
  // se o retry também violar, troca pela frase determinística segura.
  try {
    const settingsForVal = await getCachedSettings(tenantId).catch(() => null);
    const procsForVal = await getCachedProcedures(tenantId).catch(() => []);
    const profsForVal = await getCachedProfessionals(tenantId).catch(() => []);
    const ownerTitle = resolveOwnerTitle(toOwnerGender(settingsForVal?.professionalGender));
    const ownerFirstName = settingsForVal?.professionalName
      ? stripOwnerTitlePrefix(settingsForVal.professionalName).split(/\s+/)[0] || null
      : null;
    const { parseMoney } = await import("./response-validator");
    const procedurePrices = procsForVal
      .map((p) => parseMoney(p.price ?? null))
      .filter((n): n is number => n !== null);
    // Task #11 — usa `resolveChargesConsultation`/`resolveConsultationFee` do
    // `insurance-policy.ts` (mesma lógica de prioridade prof→settings).
    // Include per-professional consultation fees as allowed prices so the validator
    // does not block the AI from mentioning fees configured for extra professionals.
    profsForVal.forEach((p) => {
      if (resolveChargesConsultation(p, settingsForVal ?? null)) {
        const fee = parseMoney(resolveConsultationFee(p, settingsForVal ?? null));
        if (fee !== null) procedurePrices.push(fee);
      }
    });
    // Use the lowest per-professional fee (or settings fee) as the primary consultationFee
    // so the validator accepts all valid per-professional prices.
    const allFees = profsForVal
      .filter((p) => resolveChargesConsultation(p, settingsForVal ?? null))
      .map((p) => parseMoney(resolveConsultationFee(p, settingsForVal ?? null)))
      .filter((n): n is number => n !== null);
    const effectiveConsultationFee = allFees.length > 0
      ? String(Math.min(...allFees))
      : resolveConsultationFee(null, settingsForVal ?? null);
    const valCtxBase = {
      availabilityInfo: availabilityInfoForPrompt,
      triagePending: insuranceTriagePending,
      procedureNames: procsForVal.map((p) => p.name).filter(Boolean),
      ownerTitle,
      ownerFirstName,
      consultationFee: effectiveConsultationFee,
      procedurePrices,
      // Deriva lista estruturada de paymentMethods a partir das flags do tenant.
      // Convenção BR: PIX e Cartão são presumidos sempre aceitos. Boleto só
      // entra na lista quando acceptsBoleto !== false. Quando acceptsBoleto é
      // explicitamente false, o validator flagra promessa de "boleto".
      paymentMethods: (() => {
        const methods = ["PIX", "Cartão"];
        if (settingsForVal?.acceptsBoleto !== false) methods.push("Boleto");
        return methods.join(", ");
      })(),
      insurancePlans: settingsForVal?.insurancePlans ?? null,
      acceptsInsurance: settingsForVal?.acceptsInsurance ?? undefined,
      // Task #11 — alinhar com a lógica per-prof: se QUALQUER profissional cobra,
      // o validador deve recusar a IA prometer "consulta gratuita". Fica true
      // se algum prof tem charges=true; cai no settings caso não haja prof.
      chargesConsultation: profsForVal.length > 0
        ? profsForVal.some((p) => resolveChargesConsultation(p, settingsForVal ?? null))
        : (settingsForVal?.chargesConsultation ?? undefined),
      isInsuranceContact,
      mode: conversationMode,
      // Task #23 — em CONVENIO_TRIAGEM, a 1ª resposta pode ser puramente
      // empática (acolhimento) sem ainda perguntar plano/particular,
      // EXCETO quando o paciente só mandou saudação genérica.
      isFirstAIReplyInMode: !historyMessages.some((m) => m.direction === "outbound"),
      incomingIsGreeting: (await import("./response-validator")).isGenericGreeting(incomingMessage),
      incomingMessage,
      pixProfessionals: profsForVal.map((p) => ({
        pixEnabled: p.pixEnabled ?? null,
        pixKey: p.pixKey ?? null,
        pixMode: p.pixMode ?? null,
      })),
      // Task #20 — bloqueio explícito de nomes dropados pelo filtro de
      // especialidade (impede vazamento via histórico).
      droppedProfessionalNames: routingDroppedNames,
      keptProfessionalNames: routingKeptNames,
      detectedSpecialtyLabels: routing.detected.labels,
      // insurance_wrong_day: passa os dias de convênio do profissional roteado
      // (ou do primeiro profissional ativo com insurance_days configurado)
      // para o validador detectar quando o modelo oferece dia proibido.
      insuranceDays: isInsuranceContact
        ? (routedProfessionals.find((p) => (p as { insuranceDays?: string | null }).insuranceDays?.trim()) as { insuranceDays?: string | null } | undefined)?.insuranceDays
          ?? (tenantProfessionals.find((p) => (p as { insuranceDays?: string | null }).insuranceDays?.trim()) as { insuranceDays?: string | null } | undefined)?.insuranceDays
          ?? null
        : null,
    };
    const violations = validateAIResponse({ ...valCtxBase, reply });
    if (violations.length > 0) {
      const violationTypes = violations.map((v) => v.type);
      // Per-violation structured log (one event por tipo) facilita mineração
      // por tenant/intent/tipo nos dashboards.
      for (const v of violations) {
        logger.warn(
          {
            event: "ai_response_violation",
            tenantId,
            conversationId,
            intent,
            type: v.type,
            detail: v.detail,
            correctedOnRetry: false,
            modelUsed: aiModel,
          },
          `ai_response_validation: ${v.type}`,
        );
      }
      // Cost-opt: violações cosméticas (não afetam corretude de agendamento/preço)
      // não disparam retry nem fallback determinístico — só ficam logadas. Isso
      // economiza ~1 chamada extra ao modelo por violação cosmética sem degradar UX.
      //
      // policy_violation é cosmético APENAS em modos não-convênio
      // (PARTICULAR_SPIN, PACIENTE_AGENDAR). Em CONVENIO_AGENDAR/CONVENIO_TRIAGEM
      // continua hard-block — lá representa risco contratual real (preço/PIX
      // proibidos pelo convênio). Fora de convênio, a violação fica registrada
      // pra auditoria mas não gasta token retentando.
      const ALWAYS_SOFT = new Set<string>([
        "insurance_sales_term",
        "owner_title_wrong",
      ]);
      const isInsuranceMode =
        conversationMode === "CONVENIO_AGENDAR" || conversationMode === "CONVENIO_TRIAGEM";
      const isSoftViolation = (v: { type: string }): boolean =>
        ALWAYS_SOFT.has(v.type) || (v.type === "policy_violation" && !isInsuranceMode);
      const allSoft = violations.every(isSoftViolation);
      if (allSoft) {
        logger.info(
          { tenantId, conversationId, intent, violations: violationTypes, model_used: aiModel },
          "ai_response_validation: cosmetic-only violations — skipping retry to save tokens",
        );
      } else {
      logger.warn(
        { tenantId, conversationId, intent, violations: violationTypes, retried: false, model_used: aiModel },
        "ai_response_validation: violations detected — retrying once",
      );
      retryUsed = true;
      const retryMessages = [
        ...messages,
        { role: "assistant" as const, content: reply },
        { role: "system" as const, content: buildCorrectionHint(violations) },
      ];
      let retryReply: string | null = null;
      const retryAc = new AbortController();
      const retryTimeoutId = setTimeout(() => retryAc.abort(), PEAK_TIMEOUT_MS);
      try {
        const retryResp = await client.chat.completions.create(
          {
            model: aiModel,
            max_completion_tokens: replyMaxTokens,
            messages: retryMessages,
            temperature: 0.2,
            ...(responseFormat ? { response_format: responseFormat } : {}),
          },
          { signal: retryAc.signal },
        );
        clearTimeout(retryTimeoutId);
        const retryRaw = retryResp.choices[0]?.message?.content || "";
        if (useUnifiedSchema && retryRaw) {
          try {
            const parsedRetry = JSON.parse(retryRaw) as { reply?: string; appointment?: AppointmentExtraction };
            retryReply = parsedRetry.reply || retryRaw;
            // Atualiza extração de agendamento para refletir a resposta corrigida
            // (evita persistir agendamento da resposta original violadora).
            inlineAppointment = parsedRetry.appointment ?? null;
          } catch {
            retryReply = retryRaw;
            inlineAppointment = null;
          }
        } else if (useReplySchema && retryRaw) {
          // Mesmo parsing do primeiro pass — não pode vazar JSON `{reply:...}`
          // como mensagem do WhatsApp. Cai pro raw apenas se parse falhar.
          try {
            const parsedRetry = JSON.parse(retryRaw) as { reply?: string };
            retryReply = parsedRetry.reply || retryRaw;
          } catch {
            retryReply = retryRaw;
          }
        } else {
          retryReply = retryRaw || null;
        }
      } catch (retryErr) {
        clearTimeout(retryTimeoutId);
        const retryTimedOut = retryAc.signal.aborted;
        logger.error(
          { err: retryErr, tenantId, conversationId, retry_timed_out: retryTimedOut, timeout_ms: PEAK_TIMEOUT_MS },
          "ai_response_validation: retry call failed",
        );
      }
      const retryViolations = retryReply ? validateAIResponse({ ...valCtxBase, reply: retryReply }) : violations;
      if (retryReply && retryViolations.length === 0) {
        // Per-violation log: corrigido no retry
        for (const v of violations) {
          logger.info(
            {
              event: "ai_response_violation",
              tenantId,
              conversationId,
              intent,
              type: v.type,
              correctedOnRetry: true,
              modelUsed: aiModel,
            },
            `ai_response_validation: ${v.type} corrected`,
          );
        }
        logger.info(
          { tenantId, conversationId, intent, retried: true, retryFixed: true, original_violations: violationTypes },
          "ai_response_validation: retry corrected violations",
        );
        reply = retryReply;
      } else {
        // Fallback baseado na união de violações originais + violações do retry,
        // garantindo que o tipo da mensagem segura reflita o estado mais recente
        // observado pelo validador.
        const unionViolations = [...violations, ...retryViolations];
        const fb = deterministicFallback(unionViolations, { triagePending: insuranceTriagePending, mode: conversationMode });
        fallbackUsed = true;
        // Fallback determinístico = mensagem segura SEM agendamento. Limpa
        // inlineAppointment para impedir que extração da resposta original
        // violadora seja persistida pelo setImmediate abaixo.
        inlineAppointment = null;
        // Per-violation log: NÃO corrigido — usado fallback determinístico
        for (const v of unionViolations) {
          logger.error(
            {
              event: "ai_response_violation",
              tenantId,
              conversationId,
              intent,
              type: v.type,
              detail: v.detail,
              correctedOnRetry: false,
              modelUsed: aiModel,
              fellBackToDeterministic: true,
            },
            `ai_response_validation: ${v.type} — fallback used`,
          );
        }
        logger.warn(
          {
            tenantId,
            conversationId,
            intent,
            retried: true,
            retryFixed: false,
            original_violations: violationTypes,
            retry_violations: retryViolations.map((v) => v.type),
          },
          "ai_response_validation: retry failed — using deterministic fallback",
        );
        // Alerta interno persistente: registra atividade `ai_validation_failure`
        // (visível no dashboard) e dispara escalação Telegram quando configurada.
        // Roda em background para não atrasar a resposta ao paciente.
        setImmediate(() => {
          (async () => {
            try {
              const { db, dentalActivityTable } = await import("@workspace/db");
              await db.insert(dentalActivityTable).values({
                tenantId,
                type: "ai_validation_failure",
                description: `IA violou políticas após retry — fallback determinístico aplicado (${unionViolations.map((v) => v.type).join(", ")})`,
                entityType: "conversation",
                entityId: conversationId,
                metadata: JSON.stringify({
                  intent,
                  contactPhone,
                  modelUsed: aiModel,
                  originalViolations: violationTypes,
                  retryViolations: retryViolations.map((v) => v.type),
                  details: unionViolations.map((v) => ({ type: v.type, detail: v.detail })),
                }),
              });
              const settingsForAlert = await getCachedSettings(tenantId).catch(() => null);
              if (settingsForAlert?.telegramEscalationEnabled && settingsForAlert?.telegramBotToken && settingsForAlert?.telegramChatId) {
                const { sendTelegramMessage } = await import("./telegram");
                const safePhone = contactPhone.replace(/\d(?=\d{4})/g, "*");
                const msg = `⚠️ ALERTA INTERNO — IA violou políticas\nClínica: ${settingsForAlert.clinicName || "N/A"}\nContato: ${contactName} (${safePhone})\nIntent: ${intent}\nViolações: ${unionViolations.map((v) => v.type).join(", ")}\nFallback determinístico aplicado.`;
                await sendTelegramMessage(settingsForAlert.telegramBotToken, settingsForAlert.telegramChatId, msg);
              }
            } catch (alertErr) {
              logger.error({ err: alertErr, tenantId, conversationId }, "ai_response_validation: failed to record validation failure alert");
            }
          })();
        });
        reply = fb;
      }
      }
    }
  } catch (validatorErr) {
    logger.error(
      { err: validatorErr, tenantId, conversationId },
      "ai_response_validation: validator threw — keeping original reply",
    );
  }
  } // end if (!useConstrainedGeneration) — fim do caminho legado (Task #25)

  // Task #17 — auditoria de obediência por modo. Roda em background para
  // não atrasar a resposta ao paciente. Snapshot dos sinais finais (após
  // retry/fallback) é registrado em ai_response_audit para o painel admin.
  setImmediate(() => {
    (async () => {
      try {
        const dbMod = await import("@workspace/db");
        // Mocks legados de @workspace/db (vitest) lançam ao acessar exports
        // que não foram explicitamente declarados no vi.mock. Acesso defensivo.
        let auditDb: typeof dbMod.db | undefined;
        let aiResponseAuditTable: typeof dbMod.aiResponseAuditTable | undefined;
        try { auditDb = dbMod.db; } catch { auditDb = undefined; }
        try { aiResponseAuditTable = dbMod.aiResponseAuditTable; } catch { aiResponseAuditTable = undefined; }
        // Mocks legados podem não exportar a tabela nova: pulamos silenciosamente
        // (o log estruturado abaixo continua registrando o evento de modo).
        if (!auditDb || !aiResponseAuditTable) {
          logger.info(
            {
              tenantId,
              conversationId,
              mode_resolved: conversationMode,
              retry_used: retryUsed,
              fallback_used: fallbackUsed,
              model_used: aiModel,
            },
            "ai_mode_audit (skipped persistence — table unavailable)",
          );
          return;
        }
        // Recalcula violações sobre a `reply` final (já corrigida ou substituída
        // pelo fallback). Se a função do validator falhar, registra obeyed=true
        // como melhor esforço — o log estruturado já capturou os detalhes.
        let finalViolations: Array<{ type: string }> = [];
        try {
          const settingsAud = await getCachedSettings(tenantId).catch(() => null);
          const procsAud = await getCachedProcedures(tenantId).catch(() => []);
          const profsAud = await getCachedProfessionals(tenantId).catch(() => []);
          const { parseMoney: pm } = await import("./response-validator");
          const procPricesAud = procsAud.map((p) => pm(p.price ?? null)).filter((n): n is number => n !== null);
          profsAud.forEach((p) => {
            if (p.chargesConsultation !== false && p.consultationFee) {
              const fee = pm(p.consultationFee);
              if (fee !== null) procPricesAud.push(fee);
            }
          });
          finalViolations = validateAIResponse({
            reply,
            availabilityInfo: availabilityInfoForPrompt,
            triagePending: insuranceTriagePending,
            procedureNames: procsAud.map((p) => p.name).filter(Boolean),
            ownerTitle: resolveOwnerTitle(toOwnerGender(settingsAud?.professionalGender)),
            ownerFirstName: settingsAud?.professionalName
              ? stripOwnerTitlePrefix(settingsAud.professionalName).split(/\s+/)[0] || null
              : null,
            consultationFee: settingsAud?.consultationFee != null ? String(settingsAud.consultationFee) : null,
            procedurePrices: procPricesAud,
            paymentMethods: settingsAud?.acceptsBoleto !== false ? "PIX, Cartão, Boleto" : "PIX, Cartão",
            insurancePlans: settingsAud?.insurancePlans ?? null,
            acceptsInsurance: settingsAud?.acceptsInsurance ?? undefined,
            chargesConsultation: settingsAud?.chargesConsultation ?? undefined,
            isInsuranceContact,
            mode: conversationMode,
            // Task #23 — mesma flag usada na 1ª passada: na 1ª resposta da IA
            // permite acolhimento empático sem pergunta plano/particular,
            // exceto quando a mensagem do paciente é só saudação genérica.
            isFirstAIReplyInMode: !historyMessages.some((m) => m.direction === "outbound"),
            incomingIsGreeting: (await import("./response-validator")).isGenericGreeting(incomingMessage),
            incomingMessage,
            pixProfessionals: profsAud.map((p) => ({
              pixEnabled: p.pixEnabled ?? null,
              pixKey: p.pixKey ?? null,
              pixMode: p.pixMode ?? null,
            })),
            // Task #20 — manter coerência com a 1ª passada do validator.
            droppedProfessionalNames: routingDroppedNames,
            keptProfessionalNames: routingKeptNames,
            detectedSpecialtyLabels: routing.detected.labels,
          });
        } catch {
          finalViolations = [];
        }
        const obeyed = finalViolations.length === 0;
        const violationTypesStr = finalViolations.length > 0
          ? JSON.stringify(finalViolations.map((v) => v.type))
          : null;
        await auditDb.insert(aiResponseAuditTable).values({
          tenantId,
          conversationId,
          contactPhoneMasked: maskPhone(contactPhone),
          mode: conversationMode,
          obeyed,
          violationTypes: violationTypesStr,
          retryUsed,
          fallbackUsed,
          modelUsed: aiModel,
          intent: String(intent),
          promptTokens: promptTokensFinal,
          completionTokens: completionTokensFinal,
          cachedTokens,
        });
        logger.info(
          {
            tenantId,
            conversationId,
            mode_resolved: conversationMode,
            mode_obeyed: obeyed,
            retry_used: retryUsed,
            fallback_used: fallbackUsed,
            violation_types: finalViolations.map((v) => v.type),
            model_used: aiModel,
          },
          "ai_mode_audit",
        );
      } catch (auditErr) {
        logger.error({ err: auditErr, tenantId, conversationId }, "ai_mode_audit: failed to persist audit row");
      }
    })();
  });

  setImmediate(() => {
    if (!tenantIsBasicPlan && leadId && strategiesUsed.length > 0) {
      logStrategy(tenantId, leadId, conversationId, strategiesUsed, intent).catch((err) => {
        logger.error({ err, tenantId, leadId }, "Failed to log strategy");
      });
    }

    if (intent === "scheduling" || intent === "rescheduling" || intent === "other") {
      if (inlineAppointment && (intent === "scheduling" || intent === "rescheduling")) {
        createAppointmentFromData({
          extraction: inlineAppointment,
          tenantId,
          conversationId,
          contactPhone,
          contactName,
          contactType: context.contactType,
          patientId,
          leadId,
          utcOffsetHours,
          professionals: availabilityResult.professionals ?? tenantProfessionals.map((p) => ({ id: p.id, name: p.name })),
          isInsuranceContact,
          availableSlots: availabilityResult.availableSlots,
        }).catch((err) => {
          logger.error({ err, tenantId, conversationId }, "Failed to auto-create appointment from unified response");
        });
      } else if (!useConstrainedGeneration) {
        // Task #25 — quando o modo restrito está ON, SOMENTE CONFIRM_SLOT
        // (que produz inlineAppointment) cria agendamento. A extração livre
        // sobre o reply final é desabilitada para impedir agendamento fantasma.
        tryCreateAppointmentFromReply({
          client,
          tenantId,
          conversationId,
          contactPhone,
          contactName,
          contactType: context.contactType,
          patientId,
          leadId,
          history,
          userContent,
          reply,
          utcOffsetHours,
          professionals: availabilityResult.professionals ?? tenantProfessionals.map((p) => ({ id: p.id, name: p.name })),
          isInsuranceContact,
          availableSlots: availabilityResult.availableSlots,
        }).catch((err) => {
          logger.error({ err, tenantId, conversationId }, "Failed to auto-create appointment from AI reply");
        });
      } else {
        logger.info({ tenantId, conversationId, intent, constrainedAction }, "constrained: skipped legacy extractor (only CONFIRM_SLOT may persist appointment)");
      }
    }

    const isSchedulingRefusal = detectSchedulingRefusal(incomingMessage, history);
    if (isSchedulingRefusal) {
      trackAndEscalateRefusal(tenantId, conversationId, contactName || contactPhone, contactPhone, incomingMessage, reply).catch((err) => {
        logger.error({ err, tenantId }, "Scheduling refusal tracking failed");
      });
    }

    db.insert(dentalActivityTable).values({
      tenantId,
      type: "ai_reply",
      description: `Resposta automatica enviada para ${contactPhone} (intencao: ${intent})`,
      entityType: "conversation",
      entityId: conversationId,
      metadata: JSON.stringify({
        intent,
        contactType: context.contactType,
        strategiesUsed,
        leadId,
        patientId,
      }),
    }).catch((err) => {
      logger.error({ err, tenantId }, "Failed to log ai_reply activity");
    });

    checkAndEscalate(tenantId, incomingMessage, reply, contactName || contactPhone, contactPhone).catch((err) => {
      logger.error({ err, tenantId }, "Escalation check failed");
    });

    maybeUpdateConversationSummary(
      client,
      tenantId,
      conversationId,
      conversation?.aiSummaryMessageCount ?? 0,
    ).catch((err) => {
      logger.error({ err, tenantId, conversationId }, "Conversation summary update failed");
    });
  });

  return reply;
}

export async function transcribeAudio(audioBuffer: Buffer, format: "wav" | "mp3" | "webm" = "webm"): Promise<string> {
  const { speechToText, ensureCompatibleFormat } = await import("@workspace/integrations-openai-ai-server/audio");
  const { buffer, format: compatFormat } = await ensureCompatibleFormat(audioBuffer);
  return speechToText(buffer, compatFormat);
}

export async function analyzeImage(tenantId: number, imageBase64: string, mimeType: string = "image/jpeg"): Promise<string> {
  const client = await getOpenAIClient(tenantId);
  const response = await client.chat.completions.create({
    model: "gpt-5-mini",
    max_completion_tokens: bumpTokensForLowReasoning(512),
    ...buildGpt5Extras({ tenantId, namespace: "dental-img" }),
    messages: [
      {
        role: "system",
        content: `Voce e um assistente de uma clinica odontologica. Ao receber uma foto:
- Se for uma foto de dentes, boca, gengiva ou area oral: descreva o que voce observa de forma clinica mas acessivel. Identifique possiveis problemas visiveis (caries, inflamacao, fratura, manchas, tártaro, etc). NUNCA faca diagnostico definitivo — diga que a avaliacao presencial e essencial.
- Se for uma radiografia ou exame de imagem odontologico: descreva o que e visivel e recomende avaliacao profissional.
- Se for qualquer outra imagem (documento, comprovante, selfie, etc): descreva brevemente o conteudo.
Responda em portugues do Brasil, de forma curta e clara.`,
      },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${imageBase64}` },
          },
          { type: "text", text: "O que voce ve nesta imagem?" },
        ],
      },
    ],
  });
  return response.choices[0]?.message?.content || "Nao consegui analisar a imagem.";
}

export interface PIXReceiptValidationContext {
  pixKey?: string;
  expectedAmount?: string;
  recipientName?: string;
}

export async function analyzePIXReceipt(
  tenantId: number,
  imageBase64: string,
  mimeType: string = "image/jpeg",
  context: PIXReceiptValidationContext = {}
): Promise<string> {
  const client = await getOpenAIClient(tenantId);

  const contextLines: string[] = [];
  if (context.pixKey) contextLines.push(`Chave PIX esperada: ${context.pixKey}`);
  if (context.expectedAmount) contextLines.push(`Valor esperado: R$${context.expectedAmount}`);
  if (context.recipientName) contextLines.push(`Nome do destinatario esperado: ${context.recipientName}`);

  const contextBlock = contextLines.length > 0
    ? `\nInformacoes do pagamento esperado:\n${contextLines.join("\n")}`
    : "";

  const systemPrompt = `Voce e um verificador de comprovantes PIX de uma clinica odontologica.${contextBlock}

Sua tarefa:
1. Verificar se a imagem e um comprovante de pagamento PIX valido (pode ser captura de tela de app bancario, comprovante em PDF impresso, ou similar).
2. Extrair: valor transferido, nome/chave do destinatario, data/hora da transacao.
3. Comparar com as informacoes esperadas (se fornecidas).
4. Decidir se o pagamento e valido.

Regras de validacao:
- Se o valor transferido corresponde ao esperado (ou e maior): valido.
- Se o destinatario corresponde (nome parcial ou chave PIX): valido.
- Se nao for um comprovante PIX (foto de dente, selfie, etc): invalido.
- Se o comprovante estiver ilegivel ou cortado: solicitar reenvio.

Formato obrigatorio da resposta:
- Se valido e aprovado: inicie com [PIX_APROVADO] e descreva o que foi encontrado.
- Se invalido ou inconsistente: inicie com [PIX_INVALIDO] e explique o motivo.
- Se nao for comprovante PIX: inicie com [NAO_E_PIX] e descreva o que e.
- Se ilegivel: inicie com [PIX_ILEGIVEL] e peca para reenviar.

Responda em portugues do Brasil, de forma clara e objetiva.`;

  const response = await client.chat.completions.create({
    model: "gpt-5-mini",
    max_completion_tokens: bumpTokensForLowReasoning(512),
    ...buildGpt5Extras({ tenantId, namespace: "dental-pix" }),
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${imageBase64}` },
          },
          { type: "text", text: "Analise este comprovante PIX." },
        ],
      },
    ],
  });
  return response.choices[0]?.message?.content || "[PIX_ILEGIVEL] Nao foi possivel analisar a imagem.";
}
