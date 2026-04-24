import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { dentalConversationOrdersTable, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { tenantMiddleware } from "../../middlewares/tenant";
import { logger } from "../../lib/logger";
import {
  getConversationQuotaStatus,
  CONVERSATION_RECHARGE_PACKAGE,
} from "../../lib/conversation-quota-manager";
import { createPixBillingGeneric } from "../../lib/abacatepay";
import { z } from "zod/v4";

const router = Router();
router.use(tenantMiddleware);

router.get("/", async (req: Request, res: Response) => {
  try {
    const status = await getConversationQuotaStatus(req.tenantId);
    res.json(status);
  } catch (err) {
    logger.error({ err, tenantId: req.tenantId }, "Failed to get conversation quota status");
    res.status(500).json({ error: "Erro ao buscar quota de conversas" });
  }
});

const PurchaseRechargeBody = z.object({
  taxId: z.string().min(1),
});

export async function handleConversationRecharge(req: Request, res: Response) {
  try {
    const parsed = PurchaseRechargeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "CPF ou CNPJ obrigatório." });
      return;
    }
    const { taxId } = parsed.data;
    const cleanTaxId = taxId.replace(/\D/g, "");
    if (cleanTaxId.length !== 11 && cleanTaxId.length !== 14) {
      res.status(400).json({ error: "CPF (11 dígitos) ou CNPJ (14 dígitos) inválido." });
      return;
    }

    const tenant = await db.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, req.tenantId) });
    if (!tenant) {
      res.status(404).json({ error: "Tenant não encontrado" });
      return;
    }

    const pkg = CONVERSATION_RECHARGE_PACKAGE;
    const baseUrl = `${req.protocol}://${req.hostname}`;
    const returnUrl = `${baseUrl}/dental-ai/subscription?tab=conversas&purchase=success`;
    const webhookUrl = `${baseUrl}/api/dental/conversations/recharge/webhook`;

    const billing = await createPixBillingGeneric({
      productId: `conv-recharge-${pkg.id}`,
      productName: `DentalAI — ${pkg.name} (${pkg.conversations} conversas de IA)`,
      priceInCents: pkg.priceInCents,
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantEmail: tenant.email || `tenant${tenant.id}@dentalai.app`,
      tenantTaxId: taxId,
      returnUrl,
      webhookUrl,
      metadata: {
        type: "conversation_recharge",
        tenantId: String(tenant.id),
        packageId: pkg.id,
        conversations: String(pkg.conversations),
      },
    });

    if ("error" in billing) {
      logger.warn({ tenantId: req.tenantId, billingError: billing.error }, "AbacatePay billing creation failed for conversation recharge");
      res.status(422).json({ error: "Não foi possível criar a cobrança. Tente novamente." });
      return;
    }

    const [order] = await db.insert(dentalConversationOrdersTable).values({
      tenantId: req.tenantId,
      packageId: pkg.id,
      conversations: pkg.conversations,
      priceInCents: pkg.priceInCents,
      billingId: billing.id,
      paymentUrl: billing.url,
      status: "pending",
    }).returning();

    logger.info({ tenantId: req.tenantId, orderId: order.id, packageId: pkg.id }, "Conversation recharge order created");
    res.json({ orderId: order.id, paymentUrl: billing.url, package: pkg });
  } catch (err) {
    logger.error({ err }, "Failed to create conversation recharge purchase");
    res.status(500).json({ error: "Erro ao criar cobrança" });
  }
}

router.post("/recharge", handleConversationRecharge);

export default router;
