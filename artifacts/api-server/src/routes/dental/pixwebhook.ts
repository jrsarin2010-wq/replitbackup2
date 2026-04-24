import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { dentalCreditOrdersTable, dentalConversationOrdersTable, professionalSlotOrdersTable, tenantsTable, planUpgradeOrdersTable, dentalAudioCreditsTable, dentalConversationQuotasTable } from "@workspace/db";
import { eq, sql, and } from "drizzle-orm";
import { addCredits } from "../../lib/credit-manager";
import { addConversationRechargeCredits } from "../../lib/conversation-quota-manager";
import { logger } from "../../lib/logger";
import { verifyBillingPaid } from "../../lib/abacatepay";
import { PLAN_MAX_PROFESSIONALS, isManagedPlan } from "../../lib/plan-pricing";

const router = Router();

interface AbacatePayWebhookPayload {
  event: string;
  data?: {
    billing?: {
      id?: string;
      status?: string;
      metadata?: {
        type?: string;
        tenantId?: string;
        packageId?: string;
        chars?: string;
        quantity?: string;
        conversations?: string;
      };
    };
  };
}

router.post("/", async (req: Request, res: Response) => {
  try {
    const payload = req.body as AbacatePayWebhookPayload;
    logger.info({ event: payload?.event }, "AbacatePay webhook received");

    const event = payload?.event;
    const billing = payload?.data?.billing;

    if (event !== "billing.paid" && event !== "BILLING_PAID") {
      res.json({ ok: true, ignored: true });
      return;
    }

    if (!billing || billing.status !== "PAID") {
      res.json({ ok: true, ignored: true });
      return;
    }

    const meta = billing.metadata;
    const tenantId = meta?.tenantId ? parseInt(meta.tenantId, 10) : null;
    const paymentType = meta?.type;

    if (paymentType === "plan_upgrade") {
      if (!billing.id) {
        logger.warn({ meta }, "AbacatePay webhook: missing billingId for plan_upgrade");
        res.status(400).json({ error: "Missing billingId" });
        return;
      }

      const existingUpgrade = await db.query.planUpgradeOrdersTable.findFirst({
        where: eq(planUpgradeOrdersTable.billingId, billing.id),
      });
      if (existingUpgrade?.status === "paid") {
        logger.info({ billingId: billing.id }, "Plan upgrade webhook: already processed");
        res.json({ ok: true, duplicate: true });
        return;
      }
      if (!existingUpgrade) {
        logger.warn({ billingId: billing.id, tenantId }, "Plan upgrade webhook: no matching order");
        res.status(400).json({ error: "No matching order" });
        return;
      }

      const upgradeVerified = await verifyBillingPaid(billing.id);
      if (!upgradeVerified) {
        logger.warn({ billingId: billing.id }, "Plan upgrade webhook: not verified as PAID");
        res.status(400).json({ error: "Payment not verified" });
        return;
      }

      const targetPlan = existingUpgrade.targetPlan;
      if (!isManagedPlan(targetPlan)) {
        logger.error({ billingId: billing.id, targetPlan }, "Plan upgrade webhook: unmanaged target plan");
        res.status(400).json({ error: "Invalid target plan" });
        return;
      }
      const orderTenantId = existingUpgrade.tenantId;

      await db.transaction(async (tx) => {
        const [updatedOrder] = await tx
          .update(planUpgradeOrdersTable)
          .set({ status: "paid", paidAt: new Date() })
          .where(and(
            eq(planUpgradeOrdersTable.id, existingUpgrade.id),
            eq(planUpgradeOrdersTable.status, "pending"),
          ))
          .returning();
        if (!updatedOrder) {
          logger.info({ billingId: billing.id }, "Plan upgrade webhook: race lost, already processed");
          return;
        }

        const tenant = await tx.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, orderTenantId) });
        if (!tenant) {
          logger.warn({ orderTenantId }, "Plan upgrade webhook: tenant not found");
          return;
        }

        const now = new Date();
        const newExpiresAt = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
        const newMaxProfessionals = Math.max(tenant.maxProfessionals, PLAN_MAX_PROFESSIONALS[targetPlan]);

        await tx.update(tenantsTable).set({
          plan: targetPlan,
          subscriptionStatus: "active",
          subscribedAt: now,
          subscriptionExpiresAt: newExpiresAt,
          cancelledAt: null,
          maxProfessionals: newMaxProfessionals,
          // Cancel any pending downgrade since the tenant just upgraded
          scheduledPlan: null,
          scheduledPlanEffectiveAt: null,
          scheduledPlanRequestedAt: null,
          subscriptionNotifSuspendedSent: false,
          subscriptionNotif7DaySent: false,
          subscriptionNotif3DaySent: false,
          subscriptionNotifDueDaySent: false,
        }).where(eq(tenantsTable.id, orderTenantId));

        // Reset both monthly quotas so the new plan limits apply immediately
        await tx.update(dentalAudioCreditsTable)
          .set({ monthlyCharsUsed: 0, monthlyResetDate: now })
          .where(eq(dentalAudioCreditsTable.tenantId, orderTenantId));
        await tx.update(dentalConversationQuotasTable)
          .set({ monthlyConversationsUsed: 0, monthlyResetDate: now, alert80SentAt: null, alert100SentAt: null })
          .where(eq(dentalConversationQuotasTable.tenantId, orderTenantId));
      });

      logger.info({ tenantId: orderTenantId, billingId: billing.id, targetPlan }, "Plan upgrade applied via payment");
      res.json({ ok: true });
      return;
    }

    if (paymentType === "professional_slot") {
      if (!billing.id) {
        logger.warn({ meta }, "AbacatePay webhook: missing billingId for professional_slot");
        res.status(400).json({ error: "Missing billingId" });
        return;
      }

      const existingOrder = await db.query.professionalSlotOrdersTable.findFirst({
        where: eq(professionalSlotOrdersTable.billingId, billing.id),
      });
      if (existingOrder?.status === "paid") {
        logger.info({ billingId: billing.id }, "Professional slot webhook: already processed, skipping");
        res.json({ ok: true, duplicate: true });
        return;
      }

      if (!existingOrder) {
        logger.warn({ billingId: billing.id, tenantId }, "Professional slot webhook: no matching order found");
        res.status(400).json({ error: "No matching order" });
        return;
      }

      const verified = await verifyBillingPaid(billing.id);
      if (!verified) {
        logger.warn({ billingId: billing.id }, "Professional slot webhook: billing not verified as PAID via AbacatePay API");
        res.status(400).json({ error: "Payment not verified" });
        return;
      }

      const orderTenantId = existingOrder.tenantId;
      // Task #31: Derive quantity from the persisted order amount, not from
      // the (untrusted, mutable) webhook metadata. Each slot is SLOT_PRICE_CENTS.
      const SLOT_PRICE_CENTS = 9700;
      const MAX_EXTRA_PROFESSIONALS = 1;
      const quantity = Math.max(1, Math.round(existingOrder.priceInCents / SLOT_PRICE_CENTS));

      let policyBlockReason: string | null = null;

      await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(professionalSlotOrdersTable)
          .set({ status: "paid", paidAt: new Date() })
          .where(and(
            eq(professionalSlotOrdersTable.id, existingOrder.id),
            eq(professionalSlotOrdersTable.status, "pending"),
          ))
          .returning();

        if (!updated) {
          logger.info({ billingId: billing.id }, "Professional slot webhook: order already processed (race), skipping");
          return;
        }

        // Re-check plan + cap policy at settlement time. The order may have
        // been created when the tenant was Pro; if they downgraded before
        // paying, do NOT silently grow their slots beyond the new cap.
        const tenant = await tx.query.tenantsTable.findFirst({
          where: eq(tenantsTable.id, orderTenantId),
        });
        if (!tenant) {
          policyBlockReason = "tenant_not_found";
          return;
        }

        if (tenant.plan !== "pro") {
          policyBlockReason = "non_pro_plan";
          logger.warn({ tenantId: orderTenantId, plan: tenant.plan, billingId: billing.id }, "Professional slot webhook: tenant is not on Pro plan; skipping slot increment (payment kept paid for refund handling)");
          return;
        }

        const planIncluded = isManagedPlan(tenant.plan) ? PLAN_MAX_PROFESSIONALS[tenant.plan] : 1;
        const currentExtras = Math.max(0, (tenant.maxProfessionals ?? 1) - planIncluded);
        const allowedIncrement = Math.max(0, MAX_EXTRA_PROFESSIONALS - currentExtras);
        const effectiveIncrement = Math.min(quantity, allowedIncrement);

        if (effectiveIncrement <= 0) {
          policyBlockReason = "cap_reached";
          logger.warn({ tenantId: orderTenantId, quantity, currentExtras, billingId: billing.id }, "Professional slot webhook: cap already reached; skipping slot increment");
          return;
        }

        if (effectiveIncrement < quantity) {
          logger.warn({ tenantId: orderTenantId, quantity, effectiveIncrement, currentExtras, billingId: billing.id }, "Professional slot webhook: clamped slot increment to remaining cap");
        }

        await tx
          .update(tenantsTable)
          .set({ maxProfessionals: sql`${tenantsTable.maxProfessionals} + ${effectiveIncrement}` })
          .where(eq(tenantsTable.id, orderTenantId));
      });

      if (policyBlockReason) {
        // Payment is recorded as paid (so it isn't reprocessed) but slots
        // were not added — surface this so support can refund manually.
        logger.warn({ tenantId: orderTenantId, billingId: billing.id, policyBlockReason }, "Professional slot webhook: payment accepted but slot grant blocked by policy");
      } else {
        logger.info({ tenantId: orderTenantId, billingId: billing.id, quantity }, "Professional slot(s) added via payment");
      }
      res.json({ ok: true, slotsGranted: !policyBlockReason, policyBlockReason });
      return;
    }

    if (paymentType === "conversation_recharge") {
      const conversations = meta?.conversations ? parseInt(meta.conversations, 10) : null;
      const convPackageId = meta?.packageId;

      if (!billing.id) {
        logger.warn({ meta }, "AbacatePay webhook: missing billingId for conversation_recharge");
        res.status(400).json({ error: "Missing billingId" });
        return;
      }

      if (!tenantId || !conversations || !convPackageId) {
        logger.warn({ meta }, "AbacatePay webhook: missing metadata for conversation_recharge");
        res.status(400).json({ error: "Missing metadata" });
        return;
      }

      const existingConvOrder = await db.query.dentalConversationOrdersTable.findFirst({
        where: eq(dentalConversationOrdersTable.billingId, billing.id),
      });
      if (existingConvOrder?.status === "paid") {
        logger.info({ billingId: billing.id }, "Conversation recharge webhook: already processed, skipping");
        res.json({ ok: true, duplicate: true });
        return;
      }

      if (!existingConvOrder) {
        logger.warn({ billingId: billing.id, tenantId }, "Conversation recharge webhook: no matching order found");
        res.status(400).json({ error: "No matching order" });
        return;
      }

      const convVerified = await verifyBillingPaid(billing.id);
      if (!convVerified) {
        logger.warn({ billingId: billing.id }, "Conversation recharge webhook: billing not verified as PAID via AbacatePay API");
        res.status(400).json({ error: "Payment not verified" });
        return;
      }

      // Use the persisted order's tenantId — never trust metadata for attribution.
      const orderTenantId = existingConvOrder.tenantId;

      // Atomically transition status pending → paid inside a transaction.
      // Credits are only granted when the UPDATE succeeds (returns a row),
      // preventing double-credit on concurrent duplicate webhook deliveries.
      // addConversationRechargeCredits receives the same tx so credits and
      // the status update are committed or rolled back together.
      await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(dentalConversationOrdersTable)
          .set({ status: "paid", paidAt: new Date() })
          .where(and(
            eq(dentalConversationOrdersTable.billingId, billing.id),
            eq(dentalConversationOrdersTable.status, "pending"),
          ))
          .returning();

        if (!updated) {
          logger.info({ billingId: billing.id }, "Conversation recharge webhook: order already processed (race), skipping");
          return;
        }

        // Credits granted inside the same tx — fully atomic with the status transition
        await addConversationRechargeCredits(orderTenantId, conversations, `Recarga ${convPackageId} — ${conversations} conversas`, tx);
        logger.info({ tenantId: orderTenantId, conversations, convPackageId, billingId: billing.id }, "Conversation recharge credits added via payment");
      });

      res.json({ ok: true });
      return;
    }

    const chars = meta?.chars ? parseInt(meta.chars, 10) : null;
    const packageId = meta?.packageId;

    if (!tenantId || !chars || !packageId) {
      logger.warn({ meta }, "AbacatePay webhook: missing metadata");
      res.status(400).json({ error: "Missing metadata" });
      return;
    }

    if (billing.id) {
      const existing = await db.query.dentalCreditOrdersTable.findFirst({
        where: eq(dentalCreditOrdersTable.billingId, billing.id),
      });
      if (existing?.status === "paid") {
        logger.info({ billingId: billing.id }, "AbacatePay webhook: already processed, skipping");
        res.json({ ok: true, duplicate: true });
        return;
      }
    }

    await addCredits(tenantId, chars, `Pacote ${packageId} — ${chars.toLocaleString("pt-BR")} créditos`);

    if (billing.id) {
      await db
        .update(dentalCreditOrdersTable)
        .set({ status: "paid", paidAt: new Date() })
        .where(eq(dentalCreditOrdersTable.billingId, billing.id));
    }

    logger.info({ tenantId, chars, packageId, billingId: billing.id }, "Credits added via payment");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "AbacatePay webhook processing error");
    res.json({ ok: false, error: "Internal error" });
  }
});

export default router;
