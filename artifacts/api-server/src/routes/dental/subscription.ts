import { Router } from "express";
import { db } from "@workspace/db";
import { tenantsTable, dentalSettingsTable, dentalAudioCreditsTable, planUpgradeOrdersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { tenantMiddleware } from "../../middlewares/tenant";
import { getCachedSettings } from "../../lib/cache";
import { sendSubscriptionNotifications } from "../../scheduler";
import {
  PLAN_LABELS,
  PLAN_PRICES_CENTS,
  PlanId,
  comparePlans,
  computeUpgradeProration,
  isManagedPlan,
  normalizePlanId,
} from "../../lib/plan-pricing";
import { getMonthlyConversationsLimit, EXTRA_CONVERSATIONS_PER_PROFESSIONAL } from "../../lib/plan-features";
import { createPixBillingGeneric } from "../../lib/abacatepay";
import { logger } from "../../lib/logger";

const router = Router();

function listPlansResponse(currentPlan: string | null | undefined) {
  const plans = (Object.keys(PLAN_PRICES_CENTS) as PlanId[]).map((id) => ({
    id,
    label: PLAN_LABELS[id],
    priceInCents: PLAN_PRICES_CENTS[id],
    monthlyConversationsBase: getMonthlyConversationsLimit(id, 1),
    extraConversationsPerProfessional: EXTRA_CONVERSATIONS_PER_PROFESSIONAL,
  }));
  return { plans, currentPlan: normalizePlanId(currentPlan) ?? currentPlan ?? null };
}

router.get("/", tenantMiddleware, async (req, res) => {
  const tenant = await db.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, req.tenantId) });
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }

  const settings = await getCachedSettings(req.tenantId);
  const credits = await db.query.dentalAudioCreditsTable.findFirst({ where: eq(dentalAudioCreditsTable.tenantId, req.tenantId) });

  res.json({
    plan: normalizePlanId(tenant.plan) ?? tenant.plan,
    subscriptionStatus: tenant.subscriptionStatus,
    subscribedAt: tenant.subscribedAt,
    subscriptionExpiresAt: tenant.subscriptionExpiresAt,
    cancelledAt: tenant.cancelledAt,
    creditBalance: credits?.balance ?? 0,
    clinicName: settings?.clinicName ?? tenant.name,
    scheduledPlan: normalizePlanId(tenant.scheduledPlan) ?? tenant.scheduledPlan,
    scheduledPlanEffectiveAt: tenant.scheduledPlanEffectiveAt,
    scheduledPlanRequestedAt: tenant.scheduledPlanRequestedAt,
  });
});

router.get("/plans", tenantMiddleware, async (req, res) => {
  const tenant = await db.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, req.tenantId) });
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }
  res.json(listPlansResponse(tenant.plan));
});

router.get("/plan-change/preview", tenantMiddleware, async (req, res) => {
  const targetPlan = String(req.query.targetPlan || "");
  if (!isManagedPlan(targetPlan)) {
    res.status(400).json({ error: "Plano alvo inválido." });
    return;
  }
  const tenant = await db.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, req.tenantId) });
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }
  if (!isManagedPlan(tenant.plan)) {
    res.status(400).json({ error: "Mudança de plano não disponível para o plano atual. Fale com o suporte." });
    return;
  }
  const fromPlan = normalizePlanId(tenant.plan)!;
  const towardPlan = normalizePlanId(targetPlan)!;
  if (fromPlan === towardPlan) {
    res.status(400).json({ error: "Você já está neste plano." });
    return;
  }

  const cmp = comparePlans(towardPlan, fromPlan);
  if (cmp > 0) {
    const proration = computeUpgradeProration(fromPlan, towardPlan, tenant.subscriptionExpiresAt);
    res.json({
      changeType: "upgrade",
      fromPlan,
      fromPlanLabel: PLAN_LABELS[fromPlan],
      targetPlan: towardPlan,
      targetPlanLabel: PLAN_LABELS[towardPlan],
      targetPriceInCents: proration.targetPriceCents,
      currentDailyPriceInCents: proration.currentDailyPriceCents,
      daysRemaining: proration.daysRemaining,
      creditInCents: proration.creditCents,
      finalChargeInCents: proration.finalChargeCents,
    });
  } else {
    res.json({
      changeType: "downgrade",
      fromPlan,
      fromPlanLabel: PLAN_LABELS[fromPlan],
      targetPlan: towardPlan,
      targetPlanLabel: PLAN_LABELS[towardPlan],
      targetPriceInCents: PLAN_PRICES_CENTS[towardPlan],
      effectiveAt: tenant.subscriptionExpiresAt,
      noRefund: true,
    });
  }
});

router.post("/plan-change/upgrade", tenantMiddleware, async (req, res) => {
  try {
    const { targetPlan, taxId } = req.body as { targetPlan?: string; taxId?: string };
    if (!targetPlan || !isManagedPlan(targetPlan)) {
      res.status(400).json({ error: "Plano alvo inválido." });
      return;
    }
    const cleanTaxId = (taxId || "").replace(/\D/g, "");
    if (cleanTaxId.length !== 11 && cleanTaxId.length !== 14) {
      res.status(400).json({ error: "CPF (11 dígitos) ou CNPJ (14 dígitos) obrigatório." });
      return;
    }
    const tenant = await db.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, req.tenantId) });
    if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }
    if (!isManagedPlan(tenant.plan)) {
      res.status(400).json({ error: "Mudança de plano não disponível para o plano atual." });
      return;
    }
    const fromPlanNorm = normalizePlanId(tenant.plan)!;
    const targetPlanNorm = normalizePlanId(targetPlan)!;
    if (comparePlans(targetPlanNorm, fromPlanNorm) <= 0) {
      res.status(400).json({ error: "O plano selecionado não é um upgrade." });
      return;
    }

    // Block if there's already a pending upgrade order for this tenant.
    const existingPending = await db.query.planUpgradeOrdersTable.findFirst({
      where: and(
        eq(planUpgradeOrdersTable.tenantId, req.tenantId),
        eq(planUpgradeOrdersTable.status, "pending"),
      ),
    });
    if (existingPending) {
      res.json({
        orderId: existingPending.id,
        paymentUrl: existingPending.paymentUrl,
        targetPlan: existingPending.targetPlan,
        finalChargeInCents: existingPending.finalChargeInCents,
        duplicate: true,
      });
      return;
    }

    const proration = computeUpgradeProration(fromPlanNorm, targetPlanNorm, tenant.subscriptionExpiresAt);

    // Minimum charge enforced by the PIX provider — fallback to the smallest
    // allowed value (R$ 1,00) when the proration credit covers the entire price.
    const chargeCents = Math.max(100, proration.finalChargeCents);

    // Reserve the pending-order slot BEFORE creating the external PIX billing.
    // This way, if a concurrent request loses the unique-index race, we never
    // produce an orphan payment link at the provider.
    let order;
    try {
      [order] = await db.insert(planUpgradeOrdersTable).values({
        tenantId: req.tenantId,
        fromPlan: fromPlanNorm,
        targetPlan: targetPlanNorm,
        priceInCents: proration.targetPriceCents,
        creditInCents: proration.creditCents,
        finalChargeInCents: chargeCents,
        billingId: null,
        paymentUrl: null,
        status: "pending",
      }).returning();
    } catch (insertErr) {
      const concurrent = await db.query.planUpgradeOrdersTable.findFirst({
        where: and(
          eq(planUpgradeOrdersTable.tenantId, req.tenantId),
          eq(planUpgradeOrdersTable.status, "pending"),
        ),
      });
      if (concurrent) {
        logger.warn({ tenantId: req.tenantId, err: insertErr }, "Concurrent upgrade order detected, returning existing");
        res.json({
          orderId: concurrent.id,
          paymentUrl: concurrent.paymentUrl,
          targetPlan: concurrent.targetPlan,
          finalChargeInCents: concurrent.finalChargeInCents,
          duplicate: true,
        });
        return;
      }
      throw insertErr;
    }

    const baseUrl = `${req.protocol}://${req.hostname}`;
    const returnUrl = `${baseUrl}/dental-ai/subscription?upgrade=success`;
    const webhookUrl = `${baseUrl}/api/dental/pixwebhook`;

    const billing = await createPixBillingGeneric({
      productId: `plan-upgrade-${targetPlanNorm}-${order.id}`,
      productName: `DentalAI — Upgrade para plano ${PLAN_LABELS[targetPlanNorm]}`,
      priceInCents: chargeCents,
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantEmail: tenant.email || `tenant${tenant.id}@dentalai.app`,
      tenantTaxId: taxId ?? "",
      returnUrl,
      webhookUrl,
      metadata: {
        type: "plan_upgrade",
        tenantId: String(tenant.id),
        targetPlan: targetPlanNorm,
        fromPlan: fromPlanNorm,
        orderId: String(order.id),
      },
    });

    if ("error" in billing) {
      // Roll back the reserved pending slot so the clinic can retry.
      await db.delete(planUpgradeOrdersTable).where(eq(planUpgradeOrdersTable.id, order.id));
      logger.warn({ tenantId: req.tenantId, billingError: billing.error }, "AbacatePay upgrade billing failed");
      res.status(422).json({ error: "Não foi possível criar a cobrança. Tente novamente." });
      return;
    }

    [order] = await db.update(planUpgradeOrdersTable)
      .set({ billingId: billing.id, paymentUrl: billing.url })
      .where(eq(planUpgradeOrdersTable.id, order.id))
      .returning();

    logger.info({ tenantId: req.tenantId, orderId: order.id, targetPlan: targetPlanNorm, finalChargeInCents: chargeCents }, "Plan upgrade order created");
    res.json({
      orderId: order.id,
      paymentUrl: billing.url,
      targetPlan: targetPlanNorm,
      finalChargeInCents: chargeCents,
    });
  } catch (err) {
    logger.error({ err }, "Failed to create plan upgrade");
    res.status(500).json({ error: "Erro ao criar cobrança de upgrade." });
  }
});

router.post("/plan-change/schedule-downgrade", tenantMiddleware, async (req, res) => {
  const { targetPlan } = req.body as { targetPlan?: string };
  if (!targetPlan || !isManagedPlan(targetPlan)) {
    res.status(400).json({ error: "Plano alvo inválido." });
    return;
  }
  const tenant = await db.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, req.tenantId) });
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }
  if (!isManagedPlan(tenant.plan)) {
    res.status(400).json({ error: "Mudança de plano não disponível para o plano atual." });
    return;
  }
  const fromPlanNorm2 = normalizePlanId(tenant.plan)!;
  const targetPlanNorm2 = normalizePlanId(targetPlan)!;
  if (comparePlans(targetPlanNorm2, fromPlanNorm2) >= 0) {
    res.status(400).json({ error: "O plano selecionado não é um downgrade." });
    return;
  }
  if (!tenant.subscriptionExpiresAt) {
    res.status(400).json({ error: "Assinatura sem data de vencimento. Fale com o suporte." });
    return;
  }

  const [updated] = await db.update(tenantsTable).set({
    scheduledPlan: targetPlanNorm2,
    scheduledPlanEffectiveAt: tenant.subscriptionExpiresAt,
    scheduledPlanRequestedAt: new Date(),
  }).where(eq(tenantsTable.id, req.tenantId)).returning();

  res.json({
    scheduledPlan: updated.scheduledPlan,
    scheduledPlanEffectiveAt: updated.scheduledPlanEffectiveAt,
    scheduledPlanRequestedAt: updated.scheduledPlanRequestedAt,
  });
});

router.delete("/plan-change/schedule-downgrade", tenantMiddleware, async (req, res) => {
  const tenant = await db.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, req.tenantId) });
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }
  if (!tenant.scheduledPlan) {
    res.status(400).json({ error: "Não há downgrade agendado." });
    return;
  }
  await db.update(tenantsTable).set({
    scheduledPlan: null,
    scheduledPlanEffectiveAt: null,
    scheduledPlanRequestedAt: null,
  }).where(eq(tenantsTable.id, req.tenantId));
  res.json({ ok: true });
});

router.post("/cancel", tenantMiddleware, async (req, res) => {
  const tenant = await db.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, req.tenantId) });
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }

  if (tenant.subscriptionStatus === "cancelled") {
    res.status(400).json({ error: "Assinatura já cancelada" });
    return;
  }

  const now = new Date();
  const subscribedAt = tenant.subscribedAt ?? tenant.createdAt;
  const expiresAt = tenant.subscriptionExpiresAt ?? new Date(subscribedAt.getTime() + 365 * 24 * 3600 * 1000);

  const [updated] = await db.update(tenantsTable).set({
    subscriptionStatus: "cancelled",
    cancelledAt: now,
    subscriptionExpiresAt: expiresAt,
    subscriptionNotifSuspendedSent: true,
  }).where(eq(tenantsTable.id, req.tenantId)).returning();

  const settings = await getCachedSettings(req.tenantId);
  const credits = await db.query.dentalAudioCreditsTable.findFirst({ where: eq(dentalAudioCreditsTable.tenantId, req.tenantId) });
  const clinicName = settings?.clinicName ?? updated.name;

  sendSubscriptionNotifications(
    req.tenantId,
    tenant.email,
    settings?.telegramBotToken ?? null,
    settings?.telegramChatId ?? null,
    clinicName,
    "suspended"
  ).catch((err) => console.error("Subscription suspended notification failed", err));

  res.json({
    plan: updated.plan,
    subscriptionStatus: updated.subscriptionStatus,
    subscribedAt: updated.subscribedAt,
    subscriptionExpiresAt: updated.subscriptionExpiresAt,
    cancelledAt: updated.cancelledAt,
    creditBalance: credits?.balance ?? 0,
    clinicName,
  });
});

router.post("/reactivate", tenantMiddleware, async (req, res) => {
  const tenant = await db.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, req.tenantId) });
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }

  if (tenant.subscriptionStatus === "active") {
    res.status(400).json({ error: "Assinatura já está ativa" });
    return;
  }

  const [updated] = await db.update(tenantsTable).set({
    subscriptionStatus: "active",
    cancelledAt: null,
    subscriptionNotifSuspendedSent: false,
    subscriptionNotif7DaySent: false,
    subscriptionNotif3DaySent: false,
    subscriptionNotifDueDaySent: false,
  }).where(eq(tenantsTable.id, req.tenantId)).returning();

  const settings = await getCachedSettings(req.tenantId);
  const credits = await db.query.dentalAudioCreditsTable.findFirst({ where: eq(dentalAudioCreditsTable.tenantId, req.tenantId) });
  const clinicName = settings?.clinicName ?? updated.name;

  sendSubscriptionNotifications(
    req.tenantId,
    tenant.email,
    settings?.telegramBotToken ?? null,
    settings?.telegramChatId ?? null,
    clinicName,
    "reactivated"
  ).catch((err) => console.error("Subscription reactivated notification failed", err));

  res.json({
    plan: updated.plan,
    subscriptionStatus: updated.subscriptionStatus,
    subscribedAt: updated.subscribedAt,
    subscriptionExpiresAt: updated.subscriptionExpiresAt,
    cancelledAt: updated.cancelledAt,
    creditBalance: credits?.balance ?? 0,
    clinicName,
  });
});

export default router;
