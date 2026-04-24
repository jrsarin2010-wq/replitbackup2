import { db } from "@workspace/db";
import { dentalSettingsTable, dentalActivityTable } from "@workspace/db";
import { eq, and, sql, gte, desc } from "drizzle-orm";
import { logger } from "./logger";
import { getCachedSettings } from "./cache";
import { maskPhone } from "./pii-mask";

const SCHEDULING_REFUSAL_PATTERNS = [
  /\b(nao posso|nao consigo|nao da|nao dá|nao tenho como|impossivel|impossível)\b/i,
  /\b(outro dia|outra data|semana que vem|proximo mes|próximo mês|mes que vem|mês que vem)\b/i,
  /\b(nao serve|nao funciona|nao rola|nenhum desses|nenhum horario|nenhum horário)\b/i,
  /\b(so posso|só posso|so consigo|só consigo|melhor pra mim seria)\b/i,
  /\b(essa semana nao|esse dia nao|amanha nao|amanhã não|hoje nao)\b/i,
];

export function detectSchedulingRefusal(
  message: string,
  history: Array<{ role: string; content: string }>,
): boolean {
  const lower = message.toLowerCase();
  const matchesRefusal = SCHEDULING_REFUSAL_PATTERNS.some((p) => p.test(lower));
  if (!matchesRefusal) return false;

  const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
  if (!lastAssistant) return false;
  const assistantLower = lastAssistant.content.toLowerCase();
  const offeredConcreteSlots = /\d{1,2}:\d{2}/.test(assistantLower);
  return offeredConcreteSlots;
}

export async function trackAndEscalateRefusal(
  tenantId: number,
  conversationId: number,
  contactName: string,
  contactPhone: string,
  patientMessage: string,
  aiReply: string,
): Promise<void> {
  await db.insert(dentalActivityTable).values({
    tenantId,
    type: "scheduling_refusal",
    description: `Lead ${contactName} recusou horarios oferecidos`,
    entityType: "conversation",
    entityId: conversationId,
    metadata: JSON.stringify({ contactPhone }),
  });

  const refusalCount = await db
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

  const count = Number(refusalCount[0]?.count || 0);
  logger.info({ tenantId, conversationId, contactPhone: maskPhone(contactPhone), refusalCount: count }, "Scheduling refusal tracked");

  if (count === 2) {
    const settings = await getCachedSettings(tenantId);

    if (settings?.telegramEscalationEnabled && settings?.telegramBotToken && settings?.telegramChatId) {
      const { sendTelegramMessage, buildEscalationMessage } = await import("./telegram");
      const message = buildEscalationMessage(
        "scheduling_conflict",
        contactName,
        contactPhone,
        patientMessage,
        aiReply,
        settings.clinicName || undefined,
      );
      const result = await sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, message);
      if (result.ok) {
        await db.insert(dentalActivityTable).values({
          tenantId,
          type: "telegram_escalation",
          description: `Alerta de agenda enviado ao Telegram: ${contactName} recusou horarios ${count}x`,
          entityType: "conversation",
          entityId: conversationId,
          metadata: JSON.stringify({ reason: "scheduling_conflict", contactName, contactPhone, refusalCount: count }),
        });
        logger.info({ tenantId, conversationId, contactPhone: maskPhone(contactPhone), refusalCount: count }, "Scheduling refusal escalated to Telegram");
      }
    } else {
      await db.insert(dentalActivityTable).values({
        tenantId,
        type: "escalation_pending",
        description: `ATENCAO: ${contactName} (${contactPhone}) recusou horarios ${count}x. Requer contato manual do dentista.`,
        entityType: "conversation",
        entityId: conversationId,
        metadata: JSON.stringify({ reason: "scheduling_conflict", contactName, contactPhone, refusalCount: count, requiresManualFollowup: true }),
      });
      logger.info({ tenantId, conversationId, refusalCount: count }, "Scheduling refusal escalation saved as pending (Telegram not configured)");
    }
  }
}

const AI_FAILURE_WINDOW_MS = 60 * 60 * 1000;

export async function trackAndEscalateAiFailure(
  tenantId: number,
  conversationId: number,
  contactName: string,
  contactPhone: string,
): Promise<void> {
  await db.insert(dentalActivityTable).values({
    tenantId,
    type: "ai_failure",
    description: `IA falhou ao processar mensagem de ${contactName}`,
    entityType: "conversation",
    entityId: conversationId,
    metadata: JSON.stringify({ contactPhone }),
  });

  const windowStart = new Date(Date.now() - AI_FAILURE_WINDOW_MS);

  const lastSuccessRows = await db
    .select({ createdAt: dentalActivityTable.createdAt })
    .from(dentalActivityTable)
    .where(
      and(
        eq(dentalActivityTable.tenantId, tenantId),
        eq(dentalActivityTable.entityType, "conversation"),
        eq(dentalActivityTable.entityId, conversationId),
        eq(dentalActivityTable.type, "ai_success"),
        gte(dentalActivityTable.createdAt, windowStart),
      ),
    )
    .orderBy(desc(dentalActivityTable.createdAt))
    .limit(1);

  const countFrom: Date = lastSuccessRows[0]?.createdAt ?? windowStart;

  const failureCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(dentalActivityTable)
    .where(
      and(
        eq(dentalActivityTable.tenantId, tenantId),
        eq(dentalActivityTable.entityType, "conversation"),
        eq(dentalActivityTable.entityId, conversationId),
        eq(dentalActivityTable.type, "ai_failure"),
        gte(dentalActivityTable.createdAt, countFrom),
      ),
    );

  const count = Number(failureCount[0]?.count || 0);
  logger.warn({ tenantId, conversationId, contactPhone: maskPhone(contactPhone), failureCount: count }, "AI failure tracked");

  if (count === 2) {
    const settings = await getCachedSettings(tenantId);

    if (settings?.telegramEscalationEnabled && settings?.telegramBotToken && settings?.telegramChatId) {
      const { sendTelegramMessage, buildAiFailureEscalationMessage } = await import("./telegram");
      const message = buildAiFailureEscalationMessage(
        contactName,
        contactPhone,
        count,
        settings.clinicName || undefined,
      );
      const result = await sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, message);
      if (result.ok) {
        await db.insert(dentalActivityTable).values({
          tenantId,
          type: "telegram_escalation",
          description: `Alerta de falha de IA enviado ao Telegram: ${contactName} (${count}x em 1h)`,
          entityType: "conversation",
          entityId: conversationId,
          metadata: JSON.stringify({ reason: "ai_failure", contactName, contactPhone, failureCount: count }),
        });
        logger.warn({ tenantId, conversationId, contactPhone: maskPhone(contactPhone), failureCount: count }, "AI failure escalated to Telegram");
      } else {
        logger.warn({ tenantId, conversationId, failureCount: count }, "AI failure Telegram delivery failed — saving as pending");
        await db.insert(dentalActivityTable).values({
          tenantId,
          type: "ai_failure_escalation_pending",
          description: `ATENCAO: IA falhou ${count}x para ${contactName}. Requer atendimento manual.`,
          entityType: "conversation",
          entityId: conversationId,
          metadata: JSON.stringify({ reason: "ai_failure", contactName, contactPhone, failureCount: count, requiresManualFollowup: true }),
        });
      }
    } else {
      await db.insert(dentalActivityTable).values({
        tenantId,
        type: "ai_failure_escalation_pending",
        description: `ATENCAO: IA falhou ${count}x para ${contactName}. Requer atendimento manual.`,
        entityType: "conversation",
        entityId: conversationId,
        metadata: JSON.stringify({ reason: "ai_failure", contactName, contactPhone, failureCount: count, requiresManualFollowup: true }),
      });
      logger.warn({ tenantId, conversationId, failureCount: count }, "AI failure escalation saved as pending (Telegram not configured)");
    }
  }
}

export async function recordAiSuccess(tenantId: number, conversationId: number): Promise<void> {
  try {
    await db.insert(dentalActivityTable).values({
      tenantId,
      type: "ai_success",
      description: "IA processou mensagem com sucesso",
      entityType: "conversation",
      entityId: conversationId,
      metadata: null,
    });
  } catch (err) {
    logger.warn({ err, tenantId, conversationId }, "Failed to record ai_success — non-critical");
  }
}

const ESCALATION_PATTERNS: Array<{ pattern: RegExp; reason: import("./telegram").EscalationReason }> = [
  { pattern: /\b(falar com|quero falar|humano|atendente|pessoa real|gerente|responsavel|dono|doutor|doutora|falar com alguem)\b/i, reason: "explicit_request" },
  { pattern: /\b(reclamacao|reclamar|absurdo|vergonha|pior|horrivel|pessimo|indignado|denuncia|procon|processar|advogado|justi[cç]a)\b/i, reason: "complaint" },
  { pattern: /\b(reembolso|devolver|devolucao|meu dinheiro|cobran[cç]a|cobrado errado|cobraram|valor errado|paguei|nota fiscal|recibo)\b/i, reason: "financial" },
  { pattern: /\b(dor forte|muita dor|sangramento|sangrando muito|inchou|inchado demais|febre|urgente|emergencia|acidente|quebr|fratur|arrancou|caiu o dente)\b/i, reason: "medical_emergency" },
  { pattern: /\b(raiva|palha[cç]ada|falta de respeito|incompetente|nunca mais|pior clinica|nojo|lixo)\b/i, reason: "angry_patient" },
];

export async function checkAndEscalate(
  tenantId: number,
  patientMessage: string,
  aiReply: string,
  contactName: string,
  contactPhone: string,
): Promise<void> {
  const settings = await getCachedSettings(tenantId);

  if (!settings?.telegramEscalationEnabled || !settings?.telegramBotToken || !settings?.telegramChatId) {
    return;
  }

  let reason: import("./telegram").EscalationReason | null = null;
  for (const { pattern, reason: r } of ESCALATION_PATTERNS) {
    if (pattern.test(patientMessage)) {
      reason = r;
      break;
    }
  }

  if (!reason) return;

  const { sendTelegramMessage, buildEscalationMessage } = await import("./telegram");
  const message = buildEscalationMessage(
    reason,
    contactName,
    contactPhone,
    patientMessage,
    aiReply,
    settings.clinicName || undefined
  );

  const result = await sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, message);

  if (result.ok) {
    await db.insert(dentalActivityTable).values({
      tenantId,
      type: "telegram_escalation",
      description: `Alerta enviado ao Telegram: ${reason} — paciente ${contactName}`,
      entityType: "conversation",
      metadata: JSON.stringify({ reason, contactName, contactPhone }),
    });
  } else {
    logger.warn({ tenantId, reason, error: result.error }, "Telegram escalation delivery failed");
  }
}
