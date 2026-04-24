import { logger } from "./logger";
import { maskPhone } from "./pii-mask";

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface TelegramSendResult {
  ok: boolean;
  error?: string;
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  parseMode: "HTML" | "Markdown" = "HTML"
): Promise<TelegramSendResult> {
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
      }),
    });
    const data = await resp.json() as { ok: boolean; description?: string };
    if (!data.ok) {
      logger.warn({ chatId, error: data.description }, "Telegram send failed");
      return { ok: false, error: data.description };
    }
    return { ok: true };
  } catch (err) {
    logger.error({ err, chatId }, "Telegram send error");
    return { ok: false, error: String(err) };
  }
}

export async function getTelegramUpdates(botToken: string, offset?: number): Promise<Array<{ update_id: number; message?: { chat: { id: number; first_name?: string }; text?: string } }>> {
  try {
    const url = `https://api.telegram.org/bot${botToken}/getUpdates?timeout=0${offset ? `&offset=${offset}` : ""}`;
    const resp = await fetch(url);
    const data = await resp.json() as { ok: boolean; result: Array<{ update_id: number; message?: { chat: { id: number; first_name?: string }; text?: string } }> };
    return data.ok ? data.result : [];
  } catch {
    return [];
  }
}

export async function validateBotToken(botToken: string): Promise<{ valid: boolean; botName?: string }> {
  try {
    const url = `https://api.telegram.org/bot${botToken}/getMe`;
    const resp = await fetch(url);
    const data = await resp.json() as { ok: boolean; result?: { first_name: string; username: string } };
    if (data.ok && data.result) {
      return { valid: true, botName: `@${data.result.username}` };
    }
    return { valid: false };
  } catch {
    return { valid: false };
  }
}

const RENEWAL_LINK = process.env.APP_BASE_URL ? `${process.env.APP_BASE_URL}/subscription` : "https://dentalai.app/subscription";

export function buildSubscriptionExpiryWarningMessage(
  clinicName: string,
  daysLeft: number,
  expiresAt: Date
): string {
  const dateStr = expiresAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const urgencyEmoji = daysLeft === 0 ? "🚨" : daysLeft <= 3 ? "⚠️" : "📅";
  const dayText = daysLeft === 0
    ? "vence <b>hoje</b>"
    : `vence em <b>${daysLeft} dia${daysLeft !== 1 ? "s" : ""}</b> (${dateStr})`;

  return `${urgencyEmoji} <b>Aviso de Assinatura — DentalAI</b>

🏥 <b>${escapeHtml(clinicName)}</b>

Sua assinatura ${dayText}.

💳 Renove agora para continuar usando todos os recursos sem interrupção.

🔗 <a href="${RENEWAL_LINK}">Renovar Assinatura</a>`;
}

export function buildSubscriptionSuspendedMessage(clinicName: string): string {
  return `🚫 <b>Conta Suspensa — DentalAI</b>

🏥 <b>${escapeHtml(clinicName)}</b>

Sua conta foi suspensa por falta de pagamento. O acesso ao sistema está temporariamente bloqueado.

📋 <b>Como regularizar:</b>
1. Acesse o painel da sua conta
2. Regularize o pagamento da assinatura
3. O acesso será restaurado automaticamente

🔗 <a href="${RENEWAL_LINK}">Regularizar Pagamento</a>

Seus dados estão seguros e serão preservados.`;
}

export function buildSubscriptionReactivatedMessage(clinicName: string): string {
  return `✅ <b>Assinatura Reativada — DentalAI</b>

🏥 <b>${escapeHtml(clinicName)}</b>

Sua assinatura foi reativada com sucesso! O acesso completo ao DentalAI foi restaurado.

🦷 Sua secretária virtual já está pronta para atender seus pacientes.

🔗 <a href="${RENEWAL_LINK}">Acessar o DentalAI</a>`;
}

export function buildTrialExpiryWarningMessage(
  clinicName: string,
  daysLeft: number,
  expiresAt: Date
): string {
  const dateStr = expiresAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const emoji = daysLeft <= 1 ? "🚨" : "⏳";

  return `${emoji} <b>Período de Teste Encerrando — DentalAI</b>

🏥 <b>${escapeHtml(clinicName)}</b>

Seu trial gratuito termina em <b>${daysLeft} dia${daysLeft !== 1 ? "s" : ""}</b> (${dateStr}).

Assine agora para continuar usando o DentalAI e não perder o acesso à sua secretária virtual inteligente. 🦷

🔗 <a href="${RENEWAL_LINK}">Assinar o DentalAI</a>`;
}

export function buildProviderRedeliveryAlertMessage(
  tenantId: number,
  clinicName: string,
  hitCount: number,
  windowSec: number,
  threshold: number,
): string {
  return `⚠️ <b>Alerta — Reentregas de Webhook WhatsApp</b>

🏥 <b>${escapeHtml(clinicName)}</b>

O provedor WhatsApp está reentregando mensagens já processadas em alta frequência.

📊 <b>${hitCount} duplicata${hitCount !== 1 ? "s" : ""} detectada${hitCount !== 1 ? "s" : ""}</b> via fallback de banco de dados nos últimos <b>${windowSec}s</b> (limite: ${threshold}).

Isso indica instabilidade no provedor ou falha de deduplicação. Mensagens legítimas não estão sendo afetadas — o sistema já está descartando os duplicados.

🔎 <b>Ação recomendada:</b> Verifique os logs do provedor e considere reiniciar a conexão WhatsApp se o problema persistir.

⏰ ${new Date(Date.now() - 3 * 3600000).toLocaleString("pt-BR")} | tenant #${tenantId}`;
}

export function buildWhatsappDisconnectedMessage(clinicName: string): string {
  return `🔴 <b>WhatsApp Desconectado — DentalAI</b>

🏥 <b>${escapeHtml(clinicName)}</b>

O WhatsApp foi desconectado. <b>A IA parou de responder</b> e nenhuma mensagem está sendo processada.

⚡ Para reconectar, acesse o painel e vá em Configurações → WhatsApp para escanear o QR Code novamente.`;
}

export type EscalationReason =
  | "complaint"
  | "financial"
  | "scheduling_conflict"
  | "medical_emergency"
  | "angry_patient"
  | "complex_question"
  | "explicit_request";

export function buildAiFailureEscalationMessage(
  contactName: string,
  contactPhone: string,
  failureCount: number,
  clinicName?: string,
): string {
  return `🤖 <b>ALERTA — IA Fora do Ar</b>
${clinicName ? `\n🏥 ${escapeHtml(clinicName)}` : ""}
👤 <b>${escapeHtml(contactName)}</b>
📱 ${escapeHtml(maskPhone(contactPhone))}

❌ A secretaria virtual falhou <b>${failureCount} vez${failureCount !== 1 ? "es seguidas" : ""}</b> ao responder este contato.

O paciente recebeu uma mensagem de fallback, mas <b>nao esta sendo atendido pela IA</b>.

⏰ ${new Date(Date.now() - 3 * 3600000).toLocaleString("pt-BR")}

<b>Acao necessaria:</b> Responda diretamente ao paciente pelo WhatsApp.`;
}

export function buildEscalationMessage(
  reason: EscalationReason,
  contactName: string,
  contactPhone: string,
  lastMessage: string,
  aiReply: string,
  clinicName?: string
): string {
  const reasonLabels: Record<EscalationReason, string> = {
    complaint: "Reclamacao",
    financial: "Questao Financeira",
    scheduling_conflict: "Conflito de Agenda",
    medical_emergency: "Urgencia Medica",
    angry_patient: "Paciente Irritado",
    complex_question: "Pergunta Complexa",
    explicit_request: "Paciente pediu humano",
  };

  const emoji: Record<EscalationReason, string> = {
    complaint: "⚠️",
    financial: "💰",
    scheduling_conflict: "📅",
    medical_emergency: "🚨",
    angry_patient: "😤",
    complex_question: "❓",
    explicit_request: "🙋",
  };

  return `${emoji[reason]} <b>ALERTA — ${reasonLabels[reason]}</b>
${clinicName ? `\n🏥 ${escapeHtml(clinicName)}` : ""}
👤 <b>${escapeHtml(contactName)}</b>
📱 ${escapeHtml(contactPhone)}

💬 <b>Mensagem do paciente:</b>
<i>${escapeHtml(lastMessage.substring(0, 500))}</i>

🤖 <b>Resposta da IA:</b>
<i>${escapeHtml(aiReply.substring(0, 500))}</i>

⏰ ${new Date(Date.now() - 3 * 3600000).toLocaleString("pt-BR")}

<b>Acao necessaria:</b> Responda diretamente ao paciente pelo WhatsApp.`;
}
