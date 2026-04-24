import { db } from "@workspace/db";
import { dentalConversationsTable, dentalMessagesTable, dentalActivityTable, dentalSettingsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "./logger";
import { getOpenAIClient } from "./openai-client";
import { getCachedSettings } from "./cache";

export type SentimentLevel = "positive" | "neutral" | "negative" | "critical";

interface SentimentResult {
  level: SentimentLevel;
  score: number;
  triggers: string[];
}

const NEGATIVE_KEYWORDS: Array<{ words: string[]; weight: number }> = [
  { words: ["absurdo", "vergonha", "horrivel", "pessimo", "lixo", "nojo", "palhaçada", "palhacada", "incompetente", "ridiculo"], weight: 3 },
  { words: ["raiva", "irritado", "indignado", "revoltado", "furioso", "puto", "bravo"], weight: 3 },
  { words: ["procon", "processar", "advogado", "justiça", "justica", "denuncia", "processo"], weight: 4 },
  { words: ["nunca mais", "pior clinica", "pior atendimento", "falta de respeito", "desrespeito"], weight: 3 },
  { words: ["decepcionado", "decepcionada", "frustrado", "frustrada", "chateado", "chateada", "triste"], weight: 2 },
  { words: ["demora", "demorando", "esperando", "ninguem responde", "nao respondem", "sem resposta"], weight: 2 },
  { words: ["reclamacao", "reclamar", "reclamando", "insatisfeito", "insatisfeita"], weight: 2 },
  { words: ["ruim", "mal", "errado", "erro", "problema", "complicado"], weight: 1 },
  { words: ["caro", "muito caro", "abusivo", "cobrado errado", "cobraram demais"], weight: 1 },
];

const POSITIVE_KEYWORDS: Array<{ words: string[]; weight: number }> = [
  { words: ["obrigado", "obrigada", "agradeço", "agradeco", "valeu", "show", "top"], weight: 2 },
  { words: ["otimo", "excelente", "maravilhoso", "perfeito", "amei", "adorei", "incrivel"], weight: 2 },
  { words: ["gostei", "satisfeito", "satisfeita", "feliz", "contente"], weight: 2 },
  { words: ["bom", "legal", "bacana", "beleza", "combinado", "fechado"], weight: 1 },
];

export function analyzeMessageSentiment(message: string): SentimentResult {
  const lower = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const triggers: string[] = [];
  let score = 0;

  for (const group of NEGATIVE_KEYWORDS) {
    for (const word of group.words) {
      const normalizedWord = word.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (lower.includes(normalizedWord)) {
        score -= group.weight;
        triggers.push(word);
      }
    }
  }

  for (const group of POSITIVE_KEYWORDS) {
    for (const word of group.words) {
      const normalizedWord = word.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (lower.includes(normalizedWord)) {
        score += group.weight;
        triggers.push(`+${word}`);
      }
    }
  }

  const capsRatio = (message.match(/[A-Z]/g) || []).length / Math.max(message.length, 1);
  if (capsRatio > 0.5 && message.length > 10) {
    score -= 1;
    triggers.push("CAPS_LOCK");
  }

  const exclamations = (message.match(/!/g) || []).length;
  if (exclamations >= 3) {
    score -= 1;
    triggers.push("multiple_!");
  }

  let level: SentimentLevel;
  if (score <= -4) level = "critical";
  else if (score <= -1) level = "negative";
  else if (score >= 2) level = "positive";
  else level = "neutral";

  return { level, score, triggers };
}

export async function updateConversationSentiment(
  tenantId: number,
  conversationId: number,
  messageSentiment: SentimentResult,
): Promise<{ shouldEscalate: boolean; reason: string | null }> {
  const conversation = await db.query.dentalConversationsTable.findFirst({
    where: and(
      eq(dentalConversationsTable.id, conversationId),
      eq(dentalConversationsTable.tenantId, tenantId),
    ),
  });

  if (!conversation) return { shouldEscalate: false, reason: null };

  const currentScore = conversation.sentimentScore || 0;
  const newScore = currentScore + messageSentiment.score;

  let sentiment: SentimentLevel;
  if (newScore <= -6) sentiment = "critical";
  else if (newScore <= -2) sentiment = "negative";
  else if (newScore >= 3) sentiment = "positive";
  else sentiment = "neutral";

  await db.update(dentalConversationsTable).set({
    sentiment,
    sentimentScore: newScore,
  }).where(eq(dentalConversationsTable.id, conversationId));

  if (conversation.escalatedAt) {
    return { shouldEscalate: false, reason: null };
  }

  let escalationReason: string | null = null;

  if (messageSentiment.level === "critical") {
    escalationReason = "critical_sentiment";
  }

  if (newScore <= -6) {
    escalationReason = "accumulated_negativity";
  }

  if (!escalationReason && newScore <= -3) {
    const recentMessages = await db.query.dentalMessagesTable.findMany({
      where: and(
        eq(dentalMessagesTable.conversationId, conversationId),
        eq(dentalMessagesTable.direction, "inbound"),
      ),
      orderBy: [desc(dentalMessagesTable.createdAt)],
      limit: 5,
    });

    let consecutiveNegative = 0;
    for (const msg of recentMessages) {
      const s = analyzeMessageSentiment(msg.content || "");
      if (s.score < 0) consecutiveNegative++;
      else break;
    }

    if (consecutiveNegative >= 3) {
      escalationReason = "persistent_frustration";
    }
  }

  if (escalationReason) {
    await db.update(dentalConversationsTable).set({
      escalatedAt: new Date(),
      escalationReason,
      status: "escalated",
    }).where(eq(dentalConversationsTable.id, conversationId));

    return { shouldEscalate: true, reason: escalationReason };
  }

  return { shouldEscalate: false, reason: null };
}

export async function handleSmartEscalation(
  tenantId: number,
  conversationId: number,
  contactName: string,
  contactPhone: string,
  patientMessage: string,
  aiReply: string,
  reason: string,
  sentimentResult: SentimentResult,
): Promise<void> {
  const settings = await getCachedSettings(tenantId);

  if (!settings?.telegramEscalationEnabled || !settings?.telegramBotToken || !settings?.telegramChatId) {
    return;
  }

  const reasonLabels: Record<string, string> = {
    critical_sentiment: "Sentimento Critico Detectado",
    accumulated_negativity: "Insatisfacao Acumulada",
    persistent_frustration: "Frustracao Persistente",
    explicit_request: "Paciente pediu humano",
    complaint: "Reclamacao",
    financial: "Questao Financeira",
    medical_emergency: "Urgencia Medica",
    angry_patient: "Paciente Irritado",
  };

  const reasonEmojis: Record<string, string> = {
    critical_sentiment: "🔴",
    accumulated_negativity: "🟠",
    persistent_frustration: "🟡",
    explicit_request: "🙋",
    complaint: "⚠️",
    financial: "💰",
    medical_emergency: "🚨",
    angry_patient: "😤",
  };

  const sentimentEmojis: Record<string, string> = {
    critical: "🔴 CRITICO",
    negative: "🟠 Negativo",
    neutral: "⚪ Neutro",
    positive: "🟢 Positivo",
  };

  const label = reasonLabels[reason] || reason;
  const emoji = reasonEmojis[reason] || "⚠️";
  const sentimentLabel = sentimentEmojis[sentimentResult.level] || sentimentResult.level;

  const triggersStr = sentimentResult.triggers.length > 0
    ? `\n🔍 <b>Gatilhos:</b> ${sentimentResult.triggers.join(", ")}`
    : "";

  const message = `${emoji} <b>ESCALACAO INTELIGENTE — ${label}</b>
${settings.clinicName ? `\n🏥 ${settings.clinicName}` : ""}
👤 <b>${contactName}</b>
📱 ${contactPhone}
📊 Sentimento: ${sentimentLabel} (score: ${sentimentResult.score})${triggersStr}

💬 <b>Ultima mensagem:</b>
<i>${patientMessage.substring(0, 500)}</i>

🤖 <b>Ultima resposta da IA:</b>
<i>${aiReply.substring(0, 500)}</i>

⏰ ${new Date(Date.now() - 3 * 3600000).toLocaleString("pt-BR")}

⚡ <b>A IA foi PAUSADA nesta conversa.</b> O atendimento agora e manual.
Responda diretamente ao paciente pelo WhatsApp.`;

  const { sendTelegramMessage } = await import("./telegram");
  const result = await sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, message);

  if (result.ok) {
    await db.insert(dentalActivityTable).values({
      tenantId,
      type: "smart_escalation",
      description: `Escalacao inteligente: ${label} — ${contactName} (${contactPhone})`,
      entityType: "conversation",
      entityId: conversationId,
      metadata: JSON.stringify({ reason, sentiment: sentimentResult }),
    });
    logger.info({ tenantId, conversationId, reason, sentiment: sentimentResult.level }, "Smart escalation triggered");
  } else {
    logger.warn({ tenantId, conversationId, reason, error: result.error }, "Smart escalation Telegram delivery failed");
  }
}

export function getSentimentEmoji(sentiment: string | null): string {
  switch (sentiment) {
    case "critical": return "🔴";
    case "negative": return "🟠";
    case "positive": return "🟢";
    default: return "⚪";
  }
}
