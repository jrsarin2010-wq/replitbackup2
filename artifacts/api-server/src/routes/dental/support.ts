import { Router } from "express";
import { tenantMiddleware } from "../../middlewares/tenant";
import { db } from "@workspace/db";
import { tenantsTable, dentalSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sendSupportMessageEmail, sendFeedbackEmail } from "../../lib/email";
import { logger } from "../../lib/logger";

const router = Router();
router.use(tenantMiddleware);

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.RESEND_FROM_EMAIL?.replace(/.*<(.+)>/, "$1") || "jrsarinho@gmail.com";

async function getTenantInfo(tenantId: string) {
  const tenant = await db.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, tenantId) });
  const settings = await db.query.dentalSettingsTable.findFirst({ where: eq(dentalSettingsTable.tenantId, tenantId) });
  return {
    email: tenant?.email || "",
    clinicName: (settings as { clinicName?: string | null } | null)?.clinicName || "Clínica sem nome",
  };
}

router.post("/message", async (req, res) => {
  try {
    const { message } = req.body as { message?: string };
    if (!message || message.trim().length < 10) {
      return res.status(400).json({ error: "Mensagem muito curta (mínimo 10 caracteres)" });
    }
    if (message.trim().length > 3000) {
      return res.status(400).json({ error: "Mensagem muito longa (máximo 3000 caracteres)" });
    }

    const { email, clinicName } = await getTenantInfo(req.tenantId);

    const sent = await sendSupportMessageEmail({
      clinicName,
      tenantEmail: email,
      message: message.trim(),
      adminEmail: ADMIN_EMAIL,
    });

    if (!sent) {
      logger.warn({ tenantId: req.tenantId }, "support email failed to send");
      return res.status(500).json({ error: "Falha ao enviar email. Tente novamente mais tarde." });
    }

    logger.info({ tenantId: req.tenantId, clinicName }, "support message sent to admin");
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "support /message error");
    return res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/feedback", async (req, res) => {
  try {
    const { rating, message } = req.body as { rating?: number; message?: string };
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Avaliação inválida (1 a 5)" });
    }
    if (!message || message.trim().length < 5) {
      return res.status(400).json({ error: "Comentário muito curto (mínimo 5 caracteres)" });
    }
    if (message.trim().length > 2000) {
      return res.status(400).json({ error: "Comentário muito longo (máximo 2000 caracteres)" });
    }

    const { email, clinicName } = await getTenantInfo(req.tenantId);

    const sent = await sendFeedbackEmail({
      clinicName,
      tenantEmail: email,
      rating,
      message: message.trim(),
      adminEmail: ADMIN_EMAIL,
    });

    if (!sent) {
      logger.warn({ tenantId: req.tenantId }, "feedback email failed to send");
      return res.status(500).json({ error: "Falha ao enviar feedback. Tente novamente mais tarde." });
    }

    logger.info({ tenantId: req.tenantId, clinicName, rating }, "feedback sent to admin");
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "support /feedback error");
    return res.status(500).json({ error: "Erro interno" });
  }
});

export default router;
