import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import {
  tenantsTable,
  dentalAudioCreditsTable,
  dentalCreditTransactionsTable,
  patientsTable,
  dentalLeadsTable,
} from "@workspace/db";
import { eq, sql, count, desc } from "drizzle-orm";
import { addCredits } from "../lib/credit-manager";
import { encryptIfNeeded } from "../lib/encryption";
import { getCachedSettings } from "../lib/cache";
import { getMonthlyConversationsLimit } from "../lib/plan-features";
import { PLAN_MAX_PROFESSIONALS, isManagedPlan, normalizePlanId } from "../lib/plan-pricing";
import { getConversationQuotaStatus } from "../lib/conversation-quota-manager";

const router = Router();

router.get("/tenants", async (_req: Request, res: Response) => {
  const tenants = await db.query.tenantsTable.findMany({
    orderBy: [desc(tenantsTable.createdAt)],
  });

  const results = await Promise.all(
    tenants.map(async (t) => {
      const settings = await getCachedSettings(t.id);
      const credits = await db.query.dentalAudioCreditsTable.findFirst({
        where: eq(dentalAudioCreditsTable.tenantId, t.id),
      });
      const patientCount = await db.select({ count: count() }).from(patientsTable).where(eq(patientsTable.tenantId, t.id));
      const leadCount = await db.select({ count: count() }).from(dentalLeadsTable).where(eq(dentalLeadsTable.tenantId, t.id));

      // Use the same canonical quota function the clinic widget calls so
      // the admin column stays consistent (handles month rollover/reset
      // and lazily creates the quota record on first read).
      let monthlyConversationsUsed = 0;
      let monthlyConversationsLimit = getMonthlyConversationsLimit(t.plan, t.maxProfessionals ?? 1);
      let conversationRechargeBalance = 0;
      try {
        const status = await getConversationQuotaStatus(t.id);
        monthlyConversationsUsed = status.monthlyConversationsUsed;
        monthlyConversationsLimit = status.monthlyLimit;
        conversationRechargeBalance = status.rechargeBalance;
      } catch (err) {
        // Fall back to defaults above if the quota lookup fails for this
        // tenant — never break the admin list. Log so silent drift is
        // visible in observability.
        console.warn("[admin-tenants] failed to read conversation quota", { tenantId: t.id, err: (err as Error)?.message });
      }

      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        plan: t.plan,
        subscriptionStatus: t.subscriptionStatus,
        subscribedAt: t.subscribedAt,
        subscriptionExpiresAt: t.subscriptionExpiresAt,
        cancelledAt: t.cancelledAt,
        whatsappConnected: t.whatsappConnected,
        createdAt: t.createdAt,
        clinicName: settings?.clinicName ?? t.name,
        clinicPhone: settings?.clinicPhone ?? "",
        creditBalance: credits?.balance ?? 0,
        monthlyCharsUsed: credits?.monthlyCharsUsed ?? 0,
        monthlyConversationsUsed,
        monthlyConversationsLimit,
        conversationRechargeBalance,
        patientCount: patientCount[0]?.count ?? 0,
        leadCount: leadCount[0]?.count ?? 0,
        maxProfessionals: t.maxProfessionals ?? 1,
      };
    })
  );

  res.json(results);
});

router.get("/tenants/:tenantId", async (req: Request, res: Response) => {
  const tenantId = Number(req.params.tenantId);
  const tenant = await db.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, tenantId) });
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }

  const settings = await getCachedSettings(tenantId);
  const credits = await db.query.dentalAudioCreditsTable.findFirst({ where: eq(dentalAudioCreditsTable.tenantId, tenantId) });
  const patientCount = await db.select({ count: count() }).from(patientsTable).where(eq(patientsTable.tenantId, tenantId));
  const leadCount = await db.select({ count: count() }).from(dentalLeadsTable).where(eq(dentalLeadsTable.tenantId, tenantId));

  const appointmentStats = await db.execute(sql`
    SELECT
      COUNT(*) as total_appointments,
      COUNT(*) FILTER (WHERE status = 'completed') as completed,
      COALESCE(SUM(CAST(price AS NUMERIC)) FILTER (WHERE status = 'completed'), 0) as total_revenue
    FROM appointments WHERE tenant_id = ${tenantId}
  `);

  const transactions = await db.query.dentalCreditTransactionsTable.findMany({
    where: eq(dentalCreditTransactionsTable.tenantId, tenantId),
    orderBy: [desc(dentalCreditTransactionsTable.createdAt)],
    limit: 20,
  });

  res.json({
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    plan: tenant.plan,
    subscriptionStatus: tenant.subscriptionStatus,
    subscribedAt: tenant.subscribedAt,
    subscriptionExpiresAt: tenant.subscriptionExpiresAt,
    cancelledAt: tenant.cancelledAt,
    whatsappConnected: tenant.whatsappConnected,
    createdAt: tenant.createdAt,
    clinicName: settings?.clinicName ?? tenant.name,
    clinicPhone: settings?.clinicPhone ?? "",
    creditBalance: credits?.balance ?? 0,
    patientCount: patientCount[0]?.count ?? 0,
    leadCount: leadCount[0]?.count ?? 0,
    maxProfessionals: tenant.maxProfessionals ?? 1,
    totalAppointments: Number(appointmentStats.rows[0]?.total_appointments ?? 0),
    completedAppointments: Number(appointmentStats.rows[0]?.completed ?? 0),
    totalRevenue: Number(appointmentStats.rows[0]?.total_revenue ?? 0),
    recentTransactions: transactions,
  });
});

router.patch("/tenants/:tenantId", async (req: Request, res: Response) => {
  const tenantId = Number(req.params.tenantId);
  const { plan, subscriptionStatus, evolutionInstanceName, evolutionApiUrl, evolutionApiKey, elevenLabsApiKey, openaiApiKey, whatsappConnected, maxProfessionals, whatsappProvider, uazapiHost, uazapiAdminToken, uazapiInstanceToken, uazapiInstanceId } = req.body as {
    plan?: string; subscriptionStatus?: string;
    evolutionInstanceName?: string; evolutionApiUrl?: string; evolutionApiKey?: string;
    elevenLabsApiKey?: string; openaiApiKey?: string;
    whatsappConnected?: string; maxProfessionals?: number;
    whatsappProvider?: string; uazapiHost?: string; uazapiAdminToken?: string; uazapiInstanceToken?: string; uazapiInstanceId?: string;
  };

  const tenant = await db.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, tenantId) });
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }

  const updates: Record<string, unknown> = {};
  if (plan) updates.plan = plan;
  if (subscriptionStatus) {
    updates.subscriptionStatus = subscriptionStatus;
    if (subscriptionStatus === "cancelled" && !tenant.cancelledAt) {
      updates.cancelledAt = new Date();
    }
    if (subscriptionStatus === "active") {
      updates.cancelledAt = null;
    }
  }
  if (evolutionInstanceName) updates.evolutionInstanceName = evolutionInstanceName;
  if (evolutionApiUrl) updates.evolutionApiUrl = evolutionApiUrl;
  if (evolutionApiKey) updates.evolutionApiKey = encryptIfNeeded(evolutionApiKey);
  if (elevenLabsApiKey) updates.elevenLabsApiKey = encryptIfNeeded(elevenLabsApiKey);
  if (openaiApiKey) updates.openaiApiKey = encryptIfNeeded(openaiApiKey);
  if (whatsappProvider && (whatsappProvider === "evolution" || whatsappProvider === "uazapi")) {
    updates.whatsappProvider = whatsappProvider;
  }
  if (uazapiHost !== undefined) updates.uazapiHost = uazapiHost || null;
  if (uazapiAdminToken !== undefined) updates.uazapiAdminToken = uazapiAdminToken ? encryptIfNeeded(uazapiAdminToken) : null;
  if (uazapiInstanceToken !== undefined) updates.uazapiInstanceToken = uazapiInstanceToken ? encryptIfNeeded(uazapiInstanceToken) : null;
  if (uazapiInstanceId !== undefined) updates.uazapiInstanceId = uazapiInstanceId || null;
  if (whatsappConnected) updates.whatsappConnected = whatsappConnected;
  if (maxProfessionals !== undefined && Number.isInteger(maxProfessionals) && maxProfessionals >= 1) {
    updates.maxProfessionals = maxProfessionals;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  const [updated] = await db.update(tenantsTable).set(updates).where(eq(tenantsTable.id, tenantId)).returning();
  if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "openaiApiKey")) {
    const { invalidateOpenAIClient } = await import("../lib/openai-client");
    invalidateOpenAIClient(tenantId);
  }
  res.json({ id: updated.id, name: updated.name, plan: updated.plan, subscriptionStatus: updated.subscriptionStatus, maxProfessionals: updated.maxProfessionals });
});

router.post("/tenants/:tenantId/activate-plan", async (req: Request, res: Response) => {
  const tenantId = Number(req.params.tenantId);
  const { plan, durationDays, resetSubscribedAt } = (req.body ?? {}) as {
    plan?: string;
    durationDays?: number;
    resetSubscribedAt?: boolean;
  };

  const ALLOWED_PLANS = new Set(["basic", "basico", "essencial", "pro", "trial", "premium", "enterprise"]);
  if (!plan || !ALLOWED_PLANS.has(plan)) {
    res.status(400).json({ error: "Invalid plan", allowed: Array.from(ALLOWED_PLANS) });
    return;
  }
  // Normalize legacy aliases (basico → basic) before any DB writes or gating checks
  const canonicalPlan = normalizePlanId(plan) ?? plan;

  const tenant = await db.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, tenantId) });
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }

  const now = new Date();
  const days = Number.isInteger(durationDays) && durationDays! > 0 ? durationDays! : 30;
  const newSubscribedAt = resetSubscribedAt || !tenant.subscribedAt ? now : tenant.subscribedAt;
  const newExpiresAt = new Date(newSubscribedAt.getTime() + days * 24 * 3600 * 1000);

  // Task #31: align maxProfessionals with the activated plan ceiling.
  // Activating a managed plan resets max to that plan's included quota
  // (Pro=2, Essencial/Free=1) so upgrades grant the right number of agendas
  // and downgrades clamp existing tenants. Unmanaged plans (premium/
  // enterprise/basico) keep their previously configured value.
  let newMaxProfessionals = tenant.maxProfessionals ?? 1;
  if (isManagedPlan(canonicalPlan)) {
    newMaxProfessionals = PLAN_MAX_PROFESSIONALS[canonicalPlan];
  }

  const [updated] = await db.update(tenantsTable).set({
    plan: canonicalPlan,
    maxProfessionals: newMaxProfessionals,
    subscriptionStatus: "active",
    subscribedAt: newSubscribedAt,
    subscriptionExpiresAt: newExpiresAt,
    cancelledAt: null,
    subscriptionNotifSuspendedSent: false,
    subscriptionNotif7DaySent: false,
    subscriptionNotif3DaySent: false,
    subscriptionNotifDueDaySent: false,
    // Task #22: clear any pending scheduled downgrade so the admin override
    // is not silently undone at the next renewal.
    scheduledPlan: null,
    scheduledPlanEffectiveAt: null,
    scheduledPlanRequestedAt: null,
  }).where(eq(tenantsTable.id, tenantId)).returning();

  res.json({
    id: updated.id,
    name: updated.name,
    plan: updated.plan,
    subscriptionStatus: updated.subscriptionStatus,
    subscribedAt: updated.subscribedAt,
    subscriptionExpiresAt: updated.subscriptionExpiresAt,
  });
});

router.post("/tenants/:tenantId/credits", async (req: Request, res: Response) => {
  const tenantId = Number(req.params.tenantId);
  const { amount, description } = req.body as { amount: number; description: string };

  if (!amount || !Number.isInteger(amount) || amount <= 0) {
    res.status(400).json({ error: "amount must be a positive integer" });
    return;
  }

  const tenant = await db.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, tenantId) });
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }

  const result = await addCredits(tenantId, amount, description || "Créditos adicionados pelo admin");
  res.json({ tenantId, balance: result.newBalance });
});

export default router;
