import { db } from "@workspace/db";
import { dentalSettingsTable } from "@workspace/db";
import type { DentalBlockedPeriod } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sendTelegramMessage, escapeHtml } from "./telegram";
import { getCachedSettings } from "./cache";

const HIGH_URGENCY_KEYWORDS = [
  "emergencia", "emergência", "sangramento", "sangrando", "sangue",
  "desmaiei", "desmaiando", "insuportavel", "insuportável",
  "abscesso", "inchaço", "inchado", "inchou",
  "acidente", "quebrou o dente", "caiu o dente",
  "preciso de ajuda agora", "nao to aguentando",
  "febr", "infeccao", "infecção",
];

const MEDIUM_URGENCY_KEYWORDS = [
  "urgente", "urgencia", "urgência",
  "to com muita dor", "muita dor", "nao consigo dormir",
  "preciso urgente",
];

const LOW_URGENCY_KEYWORDS = [
  "dor", "dore", "dores", "doendo", "doer",
];

export type UrgencyLevel = "alta" | "media" | "baixa" | null;

export function detectUrgencyLevel(message: string): UrgencyLevel {
  const lower = message.toLowerCase();
  if (HIGH_URGENCY_KEYWORDS.some((kw) => lower.includes(kw))) return "alta";
  if (MEDIUM_URGENCY_KEYWORDS.some((kw) => lower.includes(kw))) return "media";
  if (LOW_URGENCY_KEYWORDS.some((kw) => lower.includes(kw))) return "baixa";
  return null;
}

export function detectUrgencyInMessage(message: string): boolean {
  return detectUrgencyLevel(message) !== null;
}

export async function sendBlockedPeriodUrgencyAlert(
  tenantId: number,
  contactName: string,
  contactPhone: string,
  urgencyMessage: string,
  blockedPeriod: DentalBlockedPeriod,
  urgencyLevel: UrgencyLevel,
): Promise<void> {
  const settings = await getCachedSettings(tenantId);

  if (!settings?.telegramBotToken || !settings?.telegramChatId || !settings?.telegramEscalationEnabled) {
    return;
  }

  const whatsappLink = `https://wa.me/${contactPhone.replace(/\D/g, "")}`;
  const displayPhone = contactPhone.replace(/\D/g, "").replace(/^55/, "").replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  const localNow = new Date(Date.now() - 3 * 3600000);
  const dateStr = localNow.toLocaleString("pt-BR");

  const clinicName = settings.clinicName || "Clínica";
  const formattedStart = blockedPeriod.startDate.split("-").reverse().join("/");
  const formattedEnd = blockedPeriod.endDate.split("-").reverse().join("/");

  const urgencyLevelLabel = urgencyLevel === "alta"
    ? "🔴 ALTA — Atenção imediata recomendada"
    : urgencyLevel === "media"
    ? "🟡 MÉDIA — Avalie resposta em breve"
    : "🟢 BAIXA — Monitorar, sem pânico";

  const text = `🚨 <b>ALERTA DE URGÊNCIA — PERÍODO BLOQUEADO</b>

🏥 ${escapeHtml(clinicName)}
⏸️ Período bloqueado: <b>${escapeHtml(blockedPeriod.title)}</b> (${formattedStart} até ${formattedEnd})

👤 <b>Paciente/Lead:</b> ${escapeHtml(contactName)}
📱 <b>Telefone:</b> ${escapeHtml(displayPhone)}

⚡ <b>Nível de urgência percebido:</b> ${urgencyLevelLabel}

💬 <b>Mensagem de urgência:</b>
<i>${escapeHtml(urgencyMessage.substring(0, 400))}</i>

⏰ ${dateStr}

<b>⚠️ Atenção necessária:</b> A clínica está em período de bloqueio, mas este contato reportou urgência. Avalie se é necessário atendimento emergencial.

📲 <a href="${whatsappLink}">Abrir WhatsApp do paciente</a>`;

  await sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, text, "HTML");
}
