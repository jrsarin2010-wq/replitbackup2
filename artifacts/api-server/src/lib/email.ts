import { Resend } from "resend";
import { logger } from "./logger";

const RENEWAL_LINK = process.env.APP_BASE_URL ? `${process.env.APP_BASE_URL}/subscription` : "https://dentalai.app/subscription";

const resendApiKey = process.env.RESEND_API_KEY;
const emailFrom = process.env.RESEND_FROM_EMAIL || "OdontoFlow <onboarding@resend.dev>";

// Logo hosted on the app's public URL — works on dev and production
const appBase = process.env.APP_BASE_URL
  || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "")
  || "";
const LOGO_URL = appBase ? `${appBase}/odontoflow-logo.png` : "";

let resend: Resend | null = null;
if (resendApiKey) {
  resend = new Resend(resendApiKey);
}

type EmailAttachment = { filename: string; content: Buffer };

async function sendEmail(
  to: string,
  subject: string,
  html: string,
  attachments?: EmailAttachment[],
): Promise<boolean> {
  if (!resend) {
    logger.warn({ to, subject }, "Resend not configured — email not sent. Set RESEND_API_KEY to enable email sending.");
    return false;
  }

  try {
    const payload: Parameters<typeof resend.emails.send>[0] = { from: emailFrom, to, subject, html };
    if (attachments && attachments.length > 0) {
      payload.attachments = attachments.map((a) => ({ filename: a.filename, content: a.content }));
    }
    const { error } = await resend.emails.send(payload);
    if (error) {
      logger.error({ error, to, subject }, "Resend email send error");
      return false;
    }
    logger.info({ to, subject, attachments: attachments?.length ?? 0 }, "Email sent via Resend");
    return true;
  } catch (err) {
    logger.error({ err, to, subject }, "Failed to send email via Resend");
    return false;
  }
}

export async function sendContractAcceptedEmail(opts: {
  to: string;
  clinicName: string;
  documentTitle: string;
  versionLabel: string;
  acceptedAt: Date;
  pdf: Buffer;
  pdfFilename: string;
}): Promise<boolean> {
  const { to, clinicName, documentTitle, versionLabel, acceptedAt, pdf, pdfFilename } = opts;
  const dateStr = acceptedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const html = buildEmailWrapper(`
    <p style="color: #333; font-size: 15px; line-height: 1.6;">Olá, <strong>${clinicName}</strong>!</p>
    <p style="color: #555; font-size: 14px; line-height: 1.6;">
      Confirmamos o aceite do documento <strong>${documentTitle}</strong> (versão ${versionLabel}) em
      <strong>${dateStr}</strong> (horário de Brasília).
    </p>
    <div style="background: #ecfdf5; border-left: 4px solid #10b981; padding: 14px 16px; border-radius: 8px; margin: 20px 0;">
      <p style="margin: 0; color: #065f46; font-size: 13px; font-weight: 600;">
        📎 Em anexo está a via oficial em PDF, com o comprovante de aceite eletrônico.
      </p>
    </div>
    <p style="color: #555; font-size: 14px; line-height: 1.6;">
      Guarde este arquivo para seu controle. Você também pode baixá-lo a qualquer momento em
      <em>Configurações → Termos &amp; Contratos</em>.
    </p>
    <p style="color: #888; font-size: 12px; line-height: 1.5;">
      Em caso de dúvidas, fale com o nosso suporte.
    </p>
  `);
  return sendEmail(
    to,
    `📄 Cópia do documento aceito — ${documentTitle}`,
    html,
    [{ filename: pdfFilename, content: pdf }],
  );
}

export async function sendPasswordResetEmail(to: string, resetUrl: string, clinicName: string): Promise<boolean> {
  const html = buildEmailWrapper(`
    <p style="color: #333; font-size: 15px; line-height: 1.6;">
      Olá, <strong>${clinicName}</strong>!
    </p>
    <p style="color: #555; font-size: 14px; line-height: 1.6;">
      Recebemos uma solicitação para redefinir a senha da sua conta. Clique no botão abaixo para criar uma nova senha:
    </p>
    ${buildActionButton("Redefinir Senha", resetUrl)}
    <p style="color: #888; font-size: 12px; line-height: 1.5;">
      Este link expira em 1 hora. Se você não solicitou a redefinição de senha, ignore este email.
    </p>
  `);
  return sendEmail(to, "Redefinir sua senha — OdontoFlow", html);
}

function buildEmailWrapper(content: string): string {
  const logoCell = LOGO_URL
    ? `<td style="vertical-align: middle; padding-right: 12px;">
              <img src="${LOGO_URL}" alt="OdontoFlow" width="56" height="56" style="border-radius: 14px; display: block; border: 0;" />
            </td>`
    : `<td style="vertical-align: middle; padding-right: 12px;">
              <table cellpadding="0" cellspacing="0" border="0"><tr>
                <td style="width: 56px; height: 56px; background: #1e3a5f; border-radius: 14px; text-align: center; vertical-align: middle;">
                  <span style="font-size: 26px; line-height: 56px; display: block;">🦷</span>
                </td>
              </tr></table>
            </td>`;

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 32px 24px; background: #fff;">
      <div style="text-align: center; margin-bottom: 28px;">
        <table cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
          <tr>
            ${logoCell}
            <td style="vertical-align: middle; text-align: left;">
              <div style="font-size: 22px; color: #1e3a5f; font-weight: 800; letter-spacing: -0.5px; line-height: 1.2;">OdontoFlow</div>
              <div style="font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 2.5px; font-weight: 600; margin-top: 2px;">Secretária IA</div>
            </td>
          </tr>
        </table>
      </div>
      ${content}
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #aaa; font-size: 11px; text-align: center;">OdontoFlow — Você recebeu este e-mail porque é titular de uma conta no sistema.</p>
    </div>
  `;
}

function buildActionButton(label: string, url: string): string {
  return `
    <div style="text-align: center; margin: 28px 0;">
      <a href="${url}" style="display: inline-block; background: linear-gradient(135deg, #10b981, #0d9488); color: white; text-decoration: none; padding: 14px 36px; border-radius: 12px; font-weight: 600; font-size: 15px;">
        ${label}
      </a>
    </div>
  `;
}

export async function sendSubscriptionExpiryWarningEmail(
  to: string,
  clinicName: string,
  daysLeft: number,
  expiresAt: Date
): Promise<boolean> {
  const dateStr = expiresAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const urgency = daysLeft <= 3 ? "⚠️ Urgente" : "📅 Aviso";
  const subject = daysLeft === 0
    ? "⚠️ Sua assinatura DentalAI vence HOJE"
    : `${urgency}: Sua assinatura DentalAI vence em ${daysLeft} dia${daysLeft !== 1 ? "s" : ""}`;

  const html = buildEmailWrapper(`
    <p style="color: #333; font-size: 15px; line-height: 1.6;">Olá, <strong>${clinicName}</strong>!</p>
    <p style="color: #555; font-size: 14px; line-height: 1.6;">
      ${daysLeft === 0
        ? "Sua assinatura do DentalAI <strong>vence hoje</strong>. Renove agora para continuar usando todos os recursos sem interrupção."
        : `Sua assinatura do DentalAI vence em <strong>${daysLeft} dia${daysLeft !== 1 ? "s" : ""}</strong> (${dateStr}). Renove com antecedência para não perder o acesso ao sistema.`
      }
    </p>
    <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 14px 16px; border-radius: 8px; margin: 20px 0;">
      <p style="margin: 0; color: #92400e; font-size: 13px; font-weight: 600;">
        📅 Vencimento: ${dateStr}
      </p>
    </div>
    <p style="color: #555; font-size: 14px; line-height: 1.6;">
      Para renovar, acesse o painel da sua conta e siga as instruções de pagamento.
    </p>
    ${buildActionButton("Renovar Assinatura", RENEWAL_LINK)}
    <p style="color: #888; font-size: 12px; line-height: 1.5;">
      Em caso de dúvidas, entre em contato com o nosso suporte.
    </p>
  `);

  return sendEmail(to, subject, html);
}

export async function sendSubscriptionSuspendedEmail(
  to: string,
  clinicName: string
): Promise<boolean> {
  const html = buildEmailWrapper(`
    <p style="color: #333; font-size: 15px; line-height: 1.6;">Olá, <strong>${clinicName}</strong>!</p>
    <div style="background: #fee2e2; border-left: 4px solid #ef4444; padding: 14px 16px; border-radius: 8px; margin: 20px 0;">
      <p style="margin: 0; color: #991b1b; font-size: 14px; font-weight: 600;">
        🚫 Sua conta DentalAI foi suspensa por falta de pagamento.
      </p>
    </div>
    <p style="color: #555; font-size: 14px; line-height: 1.6;">
      O acesso ao sistema foi temporariamente bloqueado. Para reativar sua conta e retomar o uso completo do DentalAI, regularize o pagamento da sua assinatura.
    </p>
    <p style="color: #555; font-size: 14px; line-height: 1.6;">
      Seus dados estão seguros e serão preservados. Assim que o pagamento for confirmado, o acesso é reativado automaticamente.
    </p>
    ${buildActionButton("Regularizar Pagamento", RENEWAL_LINK)}
    <p style="color: #888; font-size: 12px; line-height: 1.5;">
      Precisa de ajuda? Entre em contato com o suporte DentalAI.
    </p>
  `);

  return sendEmail(to, "🚫 Conta DentalAI suspensa — regularize seu pagamento", html);
}

export async function sendSubscriptionReactivatedEmail(
  to: string,
  clinicName: string
): Promise<boolean> {
  const html = buildEmailWrapper(`
    <p style="color: #333; font-size: 15px; line-height: 1.6;">Olá, <strong>${clinicName}</strong>!</p>
    <div style="background: #d1fae5; border-left: 4px solid #10b981; padding: 14px 16px; border-radius: 8px; margin: 20px 0;">
      <p style="margin: 0; color: #065f46; font-size: 14px; font-weight: 600;">
        ✅ Sua assinatura DentalAI foi reativada com sucesso!
      </p>
    </div>
    <p style="color: #555; font-size: 14px; line-height: 1.6;">
      Ficamos felizes em ter você de volta! Seu acesso completo ao DentalAI foi restaurado e você já pode usar todos os recursos normalmente.
    </p>
    <p style="color: #555; font-size: 14px; line-height: 1.6;">
      A secretária virtual já está pronta para atender seus pacientes. 🦷
    </p>
    ${buildActionButton("Acessar o DentalAI", RENEWAL_LINK)}
  `);

  return sendEmail(to, "✅ Assinatura DentalAI reativada com sucesso!", html);
}

export async function sendSupportMessageEmail(opts: {
  clinicName: string;
  tenantEmail: string;
  message: string;
  adminEmail: string;
}): Promise<boolean> {
  const { clinicName, tenantEmail, message, adminEmail } = opts;
  const html = buildEmailWrapper(`
    <p style="color: #333; font-size: 15px; line-height: 1.6;">
      📩 <strong>Nova mensagem de suporte recebida</strong>
    </p>
    <div style="background: #f0f4ff; border-left: 4px solid #1e3a5f; padding: 14px 16px; border-radius: 8px; margin: 16px 0;">
      <p style="margin: 0 0 6px; color: #1e3a5f; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Clínica</p>
      <p style="margin: 0; color: #333; font-size: 14px;">${clinicName}</p>
      <p style="margin: 4px 0 0; color: #888; font-size: 12px;">${tenantEmail}</p>
    </div>
    <div style="background: #f9fafb; border: 1px solid #e5e7eb; padding: 14px 16px; border-radius: 8px; margin: 12px 0;">
      <p style="margin: 0 0 8px; color: #1e3a5f; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Mensagem</p>
      <p style="margin: 0; color: #374151; font-size: 14px; line-height: 1.7; white-space: pre-wrap;">${message}</p>
    </div>
    <p style="color: #888; font-size: 12px;">Responda diretamente para: <a href="mailto:${tenantEmail}" style="color: #1e3a5f;">${tenantEmail}</a></p>
  `);
  return sendEmail(adminEmail, `[Suporte] ${clinicName} — Nova mensagem`, html);
}

export async function sendFeedbackEmail(opts: {
  clinicName: string;
  tenantEmail: string;
  rating: number;
  message: string;
  adminEmail: string;
}): Promise<boolean> {
  const { clinicName, tenantEmail, rating, message, adminEmail } = opts;
  const stars = "⭐".repeat(rating) + "☆".repeat(5 - rating);
  const html = buildEmailWrapper(`
    <p style="color: #333; font-size: 15px; line-height: 1.6;">
      💬 <strong>Novo feedback recebido</strong>
    </p>
    <div style="background: #f0f4ff; border-left: 4px solid #1e3a5f; padding: 14px 16px; border-radius: 8px; margin: 16px 0;">
      <p style="margin: 0 0 6px; color: #1e3a5f; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Clínica</p>
      <p style="margin: 0; color: #333; font-size: 14px;">${clinicName}</p>
      <p style="margin: 4px 0 0; color: #888; font-size: 12px;">${tenantEmail}</p>
    </div>
    <div style="text-align: center; padding: 16px 0; margin: 12px 0; background: #fffbeb; border-radius: 8px; border: 1px solid #fde68a;">
      <p style="margin: 0 0 4px; color: #92400e; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Avaliação</p>
      <p style="margin: 0; font-size: 28px;">${stars}</p>
      <p style="margin: 4px 0 0; color: #92400e; font-size: 13px; font-weight: 600;">${rating}/5</p>
    </div>
    <div style="background: #f9fafb; border: 1px solid #e5e7eb; padding: 14px 16px; border-radius: 8px; margin: 12px 0;">
      <p style="margin: 0 0 8px; color: #1e3a5f; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Comentário</p>
      <p style="margin: 0; color: #374151; font-size: 14px; line-height: 1.7; white-space: pre-wrap;">${message}</p>
    </div>
    <p style="color: #888; font-size: 12px;">Responda diretamente para: <a href="mailto:${tenantEmail}" style="color: #1e3a5f;">${tenantEmail}</a></p>
  `);
  return sendEmail(adminEmail, `[Feedback ${stars}] ${clinicName}`, html);
}

export async function sendTrialExpiryWarningEmail(
  to: string,
  clinicName: string,
  daysLeft: number,
  expiresAt: Date
): Promise<boolean> {
  const dateStr = expiresAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const subject = daysLeft <= 1
    ? "⏳ Seu período de teste DentalAI termina AMANHÃ"
    : `⏳ Seu período de teste DentalAI termina em ${daysLeft} dias`;

  const html = buildEmailWrapper(`
    <p style="color: #333; font-size: 15px; line-height: 1.6;">Olá, <strong>${clinicName}</strong>!</p>
    <p style="color: #555; font-size: 14px; line-height: 1.6;">
      Seu período de teste gratuito do DentalAI termina em <strong>${daysLeft} dia${daysLeft !== 1 ? "s" : ""}</strong> (${dateStr}).
    </p>
    <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 14px 16px; border-radius: 8px; margin: 20px 0;">
      <p style="margin: 0; color: #92400e; font-size: 13px; font-weight: 600;">
        ⏰ Trial encerra em: ${dateStr}
      </p>
    </div>
    <p style="color: #555; font-size: 14px; line-height: 1.6;">
      Para continuar usando o DentalAI e não perder o acesso à sua secretária virtual, assine agora e aproveite todos os recursos sem limitação.
    </p>
    ${buildActionButton("Assinar o DentalAI", RENEWAL_LINK)}
    <p style="color: #888; font-size: 12px; line-height: 1.5;">
      Dúvidas sobre os planos? Entre em contato com o suporte.
    </p>
  `);

  return sendEmail(to, subject, html);
}
