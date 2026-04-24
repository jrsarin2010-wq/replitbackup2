import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { dentalCreditOrdersTable, professionalSlotOrdersTable, tenantsTable } from "@workspace/db";
import { eq, sql, and } from "drizzle-orm";
import { addCredits } from "../../lib/credit-manager";
import { logger } from "../../lib/logger";
import { PLAN_MAX_PROFESSIONALS, isManagedPlan } from "../../lib/plan-pricing";

const SLOT_PRICE_CENTS = 9700;
// Task #31: keep dev simulator in sync with production webhook policy.
const MAX_EXTRA_PROFESSIONALS = 1;

const router = Router();

router.post("/simulate-payment", async (req: Request, res: Response) => {
  if (process.env.NODE_ENV !== "development") {
    res.status(403).json({ error: "Endpoint disponível apenas em ambiente de desenvolvimento." });
    return;
  }

  const { billingId } = req.body as { billingId?: string };
  if (!billingId) {
    res.status(400).json({ error: "billingId é obrigatório." });
    return;
  }

  try {
    const slotOrder = await db.query.professionalSlotOrdersTable.findFirst({
      where: eq(professionalSlotOrdersTable.billingId, billingId),
    });

    if (slotOrder) {
      if (slotOrder.status === "paid") {
        res.json({ ok: true, duplicate: true, type: "professional_slot" });
        return;
      }

      const quantity = Math.max(1, Math.round(slotOrder.priceInCents / SLOT_PRICE_CENTS));

      let processed = false;
      let policyBlockReason: string | null = null;
      let effectiveIncrement = 0;

      await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(professionalSlotOrdersTable)
          .set({ status: "paid", paidAt: new Date() })
          .where(and(
            eq(professionalSlotOrdersTable.id, slotOrder.id),
            eq(professionalSlotOrdersTable.status, "pending"),
          ))
          .returning();

        if (!updated) {
          return;
        }
        processed = true;

        const tenant = await tx.query.tenantsTable.findFirst({
          where: eq(tenantsTable.id, slotOrder.tenantId),
        });
        if (!tenant) {
          policyBlockReason = "tenant_not_found";
          return;
        }
        if (tenant.plan !== "pro") {
          policyBlockReason = "non_pro_plan";
          return;
        }

        const planIncluded = isManagedPlan(tenant.plan) ? PLAN_MAX_PROFESSIONALS[tenant.plan] : 1;
        const currentExtras = Math.max(0, (tenant.maxProfessionals ?? 1) - planIncluded);
        const allowedIncrement = Math.max(0, MAX_EXTRA_PROFESSIONALS - currentExtras);
        effectiveIncrement = Math.min(quantity, allowedIncrement);

        if (effectiveIncrement <= 0) {
          policyBlockReason = "cap_reached";
          return;
        }

        await tx
          .update(tenantsTable)
          .set({ maxProfessionals: sql`${tenantsTable.maxProfessionals} + ${effectiveIncrement}` })
          .where(eq(tenantsTable.id, slotOrder.tenantId));
      });

      if (!processed) {
        logger.info({ billingId }, "Dev simulate-payment: slot order already processed (race), skipping");
        res.json({ ok: true, duplicate: true, type: "professional_slot" });
        return;
      }

      if (policyBlockReason) {
        logger.warn({ billingId, tenantId: slotOrder.tenantId, policyBlockReason }, "Dev simulate-payment: payment marked paid but slot grant blocked by policy");
        res.json({ ok: true, type: "professional_slot", tenantId: slotOrder.tenantId, slotsGranted: false, policyBlockReason });
        return;
      }

      logger.info({ billingId, tenantId: slotOrder.tenantId, quantity, effectiveIncrement }, "Dev: simulated professional slot payment");
      res.json({ ok: true, type: "professional_slot", tenantId: slotOrder.tenantId, quantity: effectiveIncrement });
      return;
    }

    const creditOrder = await db.query.dentalCreditOrdersTable.findFirst({
      where: eq(dentalCreditOrdersTable.billingId, billingId),
    });

    if (creditOrder) {
      if (creditOrder.status === "paid") {
        res.json({ ok: true, duplicate: true, type: "dental_credit" });
        return;
      }

      const chars = creditOrder.chars;
      const packageId = creditOrder.packageId;
      const tenantId = creditOrder.tenantId;

      await addCredits(tenantId, chars, `Pacote ${packageId} — ${chars.toLocaleString("pt-BR")} créditos (simulação)`);

      await db
        .update(dentalCreditOrdersTable)
        .set({ status: "paid", paidAt: new Date() })
        .where(eq(dentalCreditOrdersTable.billingId, billingId));

      logger.info({ billingId, tenantId, chars, packageId }, "Dev: simulated dental credit payment");
      res.json({ ok: true, type: "dental_credit", tenantId, chars });
      return;
    }

    res.status(404).json({ error: "Nenhum pedido encontrado para este billingId." });
  } catch (err) {
    logger.error({ err, billingId }, "Dev simulate-payment error");
    res.status(500).json({ error: "Erro interno ao simular pagamento." });
  }
});

export default router;
