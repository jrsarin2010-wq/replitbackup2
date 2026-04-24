import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import {
  tenantsTable,
  patientsTable,
  dentalLeadsTable,
  dentalActivityTable,
  appointmentFollowUpsTable,
  aiKnowledgeBaseTable,
} from "@workspace/db";
import { sql, count, and, eq, gte, desc } from "drizzle-orm";

// Mantém-se em sincronia com o DAILY_LIMIT em routes/dental/risk-control.ts
const DAILY_LIMIT = 80;

const router = Router();

router.get("/dashboard", async (req: Request, res: Response) => {
  const startDate = req.query.startDate ? new Date(req.query.startDate as string) : new Date(Date.now() - 30 * 86400000);
  const endDate = req.query.endDate ? new Date(req.query.endDate as string) : new Date();

  const allTenants = await db.query.tenantsTable.findMany();
  const totalTenants = allTenants.length;
  const activeTenants = allTenants.filter(t => t.subscriptionStatus === "active").length;
  const cancelledTenants = allTenants.filter(t => t.subscriptionStatus === "cancelled").length;

  const newInPeriod = allTenants.filter(t => {
    const created = t.createdAt ? new Date(t.createdAt) : null;
    return created && created >= startDate && created <= endDate;
  }).length;

  const cancelledInPeriod = allTenants.filter(t => {
    const cancelled = t.cancelledAt ? new Date(t.cancelledAt) : null;
    return cancelled && cancelled >= startDate && cancelled <= endDate;
  }).length;

  const planCounts: Record<string, number> = {};
  allTenants.forEach(t => {
    planCounts[t.plan] = (planCounts[t.plan] || 0) + 1;
  });

  const totalPatientsResult = await db.select({ count: count() }).from(patientsTable);
  const totalPatients = totalPatientsResult[0]?.count ?? 0;

  const totalLeadsResult = await db.select({ count: count() }).from(dentalLeadsTable);
  const totalLeads = totalLeadsResult[0]?.count ?? 0;

  const revenueResult = await db.execute(sql`
    SELECT COALESCE(SUM(CAST(price AS NUMERIC)), 0) as total_revenue
    FROM appointments
    WHERE status = 'completed'
      AND starts_at >= ${startDate}
      AND starts_at <= ${endDate}
  `);
  const totalRevenue = Number(revenueResult.rows[0]?.total_revenue ?? 0);

  const creditTransactionsResult = await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'add' THEN amount ELSE 0 END), 0) as credits_added,
      COALESCE(SUM(CASE WHEN type = 'deduct' THEN ABS(amount) ELSE 0 END), 0) as credits_consumed
    FROM dental_credit_transactions
    WHERE created_at >= ${startDate}
      AND created_at <= ${endDate}
  `);
  const creditsAdded = Number(creditTransactionsResult.rows[0]?.credits_added ?? 0);
  const creditsConsumed = Number(creditTransactionsResult.rows[0]?.credits_consumed ?? 0);

  res.json({
    totalTenants,
    activeTenants,
    cancelledTenants,
    newInPeriod,
    cancelledInPeriod,
    planCounts,
    totalPatients,
    totalLeads,
    totalRevenue,
    creditsAdded,
    creditsConsumed,
    period: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
  });
});

router.get("/revenue", async (req: Request, res: Response) => {
  const startDate = req.query.startDate ? new Date(req.query.startDate as string) : new Date(Date.now() - 30 * 86400000);
  const endDate = req.query.endDate ? new Date(req.query.endDate as string) : new Date();
  const groupBy = (req.query.groupBy as string) || "day";

  const dateFormat = groupBy === "month" ? "YYYY-MM" : groupBy === "week" ? "IYYY-IW" : "YYYY-MM-DD";

  const rows = await db.execute(sql`
    SELECT
      TO_CHAR(a.starts_at AT TIME ZONE 'UTC', ${dateFormat}) as period,
      t.name as tenant_name,
      t.id as tenant_id,
      COUNT(*) as appointments,
      COALESCE(SUM(CAST(a.price AS NUMERIC)) FILTER (WHERE a.status = 'completed'), 0) as revenue
    FROM appointments a
    JOIN tenants t ON t.id = a.tenant_id
    WHERE a.starts_at >= ${startDate}
      AND a.starts_at <= ${endDate}
    GROUP BY period, t.id, t.name
    ORDER BY period
  `);

  const totals = await db.execute(sql`
    SELECT
      COALESCE(SUM(CAST(price AS NUMERIC)) FILTER (WHERE status = 'completed'), 0) as total_revenue,
      COUNT(*) as total_appointments,
      COUNT(*) FILTER (WHERE status = 'completed') as completed_appointments
    FROM appointments
    WHERE starts_at >= ${startDate}
      AND starts_at <= ${endDate}
  `);

  res.json({
    groupBy,
    period: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
    data: rows.rows,
    totals: {
      revenue: Number(totals.rows[0]?.total_revenue ?? 0),
      appointments: Number(totals.rows[0]?.total_appointments ?? 0),
      completed: Number(totals.rows[0]?.completed_appointments ?? 0),
    },
  });
});

router.get("/growth", async (req: Request, res: Response) => {
  const months = Number(req.query.months) || 6;
  const rows = await db.execute(sql`
    SELECT
      TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM') as period,
      COUNT(*) as new_tenants
    FROM tenants
    WHERE created_at >= NOW() - (${months} || ' months')::INTERVAL
    GROUP BY period
    ORDER BY period
  `);

  res.json({ months, data: rows.rows });
});

router.get("/churn", async (req: Request, res: Response) => {
  const months = Number(req.query.months) || 6;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

  const allTenants = await db.query.tenantsTable.findMany();
  const activeTenants = allTenants.filter(t => t.subscriptionStatus === "active").length;

  const monthlyMap: Record<string, { entries: number; exits: number }> = {};
  for (let i = 0; i < months; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthlyMap[key] = { entries: 0, exits: 0 };
  }

  let totalEntries = 0;
  let totalExits = 0;
  let totalDaysActive = 0;
  let cancelCount = 0;

  const recentEntries: Array<{ name: string; plan: string; date: string; email: string | null }> = [];
  const recentCancellations: Array<{ name: string; plan: string; joinedAt: string; cancelledAt: string; daysActive: number }> = [];

  for (const t of allTenants) {
    const created = t.createdAt ? new Date(t.createdAt) : null;
    if (created && created >= cutoff) {
      const key = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}`;
      if (monthlyMap[key]) monthlyMap[key].entries++;
      totalEntries++;
    }
    if (created && created >= thirtyDaysAgo) {
      recentEntries.push({ name: t.name, plan: t.plan, date: (created).toISOString(), email: t.email });
    }

    const cancelled = t.cancelledAt ? new Date(t.cancelledAt) : null;
    if (cancelled && cancelled >= cutoff) {
      const key = `${cancelled.getFullYear()}-${String(cancelled.getMonth() + 1).padStart(2, "0")}`;
      if (monthlyMap[key]) monthlyMap[key].exits++;
      totalExits++;
    }
    if (cancelled && cancelled >= thirtyDaysAgo && created) {
      const daysActive = Math.floor((cancelled.getTime() - created.getTime()) / 86400000);
      recentCancellations.push({
        name: t.name, plan: t.plan,
        joinedAt: created.toISOString(), cancelledAt: cancelled.toISOString(), daysActive,
      });
      totalDaysActive += daysActive;
      cancelCount++;
    }
  }

  const monthly = Object.entries(monthlyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, data]) => ({ period, ...data, net: data.entries - data.exits }));

  const churnRate = activeTenants > 0 ? ((totalExits / (activeTenants + totalExits)) * 100) : 0;
  const avgDaysToCancel = cancelCount > 0 ? Math.round(totalDaysActive / cancelCount) : 0;

  recentEntries.sort((a, b) => b.date.localeCompare(a.date));
  recentCancellations.sort((a, b) => b.cancelledAt.localeCompare(a.cancelledAt));

  res.json({
    months,
    totalEntries,
    totalExits,
    netGrowth: totalEntries - totalExits,
    churnRate: Math.round(churnRate * 10) / 10,
    avgDaysToCancel,
    activeTenants,
    monthly,
    recentEntries,
    recentCancellations,
  });
});

router.get("/ai/status", async (_req: Request, res: Response) => {
  const { getAiCostStats } = await import("../lib/ai-cost-metrics");
  res.json(getAiCostStats());
});

router.get("/insights", async (_req: Request, res: Response) => {
  const allTenants = await db.query.tenantsTable.findMany();
  const now = new Date();

  const PREMIUM_PRICE = 197;
  const premiumPlans = ["premium", "pro", "enterprise"];

  const activePremium = allTenants.filter(
    t => t.subscriptionStatus === "active" && premiumPlans.includes(t.plan)
  );
  const mrr = activePremium.length * PREMIUM_PRICE;

  const convertedToPremium = allTenants.filter(
    t => premiumPlans.includes(t.plan) && t.subscribedAt
  ).length;

  const noWhatsapp = allTenants
    .filter(t => t.subscriptionStatus === "active" && t.whatsappConnected !== "true")
    .map(t => ({ id: t.id, name: t.name, plan: t.plan, createdAt: t.createdAt }));

  const activeTenants = allTenants.filter(t => t.subscriptionStatus === "active");
  const totalActiveCount = activeTenants.length;
  const premiumCount = activePremium.length;
  const cancelledCount = allTenants.filter(t => t.subscriptionStatus === "cancelled").length;

  const avgMrrPerTenant = premiumCount > 0 ? mrr / premiumCount : 0;

  const receitaAcumulada = activePremium.reduce((acc, t) => {
    if (!t.subscribedAt) return acc;
    const start = new Date(t.subscribedAt);
    const monthsActive = Math.max(1, Math.round((now.getTime() - start.getTime()) / (30 * 86400000)));
    return acc + monthsActive * PREMIUM_PRICE;
  }, 0);

  const ticketMedio = premiumCount > 0 ? PREMIUM_PRICE : 0;

  res.json({
    mrr,
    premiumPrice: PREMIUM_PRICE,
    premiumCount,
    totalActiveCount,
    cancelledCount,
    convertedToPremium,
    noWhatsapp,
    avgMrrPerTenant,
    receitaAcumulada,
    ticketMedio,
  });
});

router.get("/sending-monitor", async (_req: Request, res: Response) => {
  const now = new Date();
  const brasiliaMs = now.getTime() - 3 * 3600 * 1000;
  const brasiliaToday = new Date(brasiliaMs);
  brasiliaToday.setUTCHours(0, 0, 0, 0);
  const todayStart = new Date(brasiliaToday.getTime() + 3 * 3600 * 1000);
  const sevenDaysAgo = new Date(brasiliaToday.getTime() - 7 * 86400000 + 3 * 3600 * 1000);

  const tenants = await db.query.tenantsTable.findMany();

  const automatedTypes = sql`('remarketing_sent','birthday_greeting_sent','recovery_sent')`;

  // Activity counts (remarketing/birthday/recovery) — exclude manual recovery
  const activityToday = await db.execute<{ tenant_id: number; c: number }>(sql`
    SELECT tenant_id, COUNT(*)::int AS c
    FROM dental_activity
    WHERE type IN ${automatedTypes}
      AND created_at >= ${todayStart.toISOString()}
      AND (type <> 'recovery_sent' OR metadata IS NULL OR metadata::jsonb->>'manual' IS NULL OR metadata::jsonb->>'manual' = 'false')
    GROUP BY tenant_id
  `);

  const activity7 = await db.execute<{ tenant_id: number; c: number }>(sql`
    SELECT tenant_id, COUNT(*)::int AS c
    FROM dental_activity
    WHERE type IN ${automatedTypes}
      AND created_at >= ${sevenDaysAgo.toISOString()}
      AND (type <> 'recovery_sent' OR metadata IS NULL OR metadata::jsonb->>'manual' IS NULL OR metadata::jsonb->>'manual' = 'false')
    GROUP BY tenant_id
  `);

  // Follow-up counts (sent appointment follow-ups)
  const followToday = await db.execute<{ tenant_id: number; c: number }>(sql`
    SELECT tenant_id, COUNT(*)::int AS c
    FROM appointment_follow_ups
    WHERE status = 'sent' AND sent_at >= ${todayStart.toISOString()}
    GROUP BY tenant_id
  `);

  const follow7 = await db.execute<{ tenant_id: number; c: number }>(sql`
    SELECT tenant_id, COUNT(*)::int AS c
    FROM appointment_follow_ups
    WHERE status = 'sent' AND sent_at >= ${sevenDaysAgo.toISOString()}
    GROUP BY tenant_id
  `);

  const todayMap = new Map<number, number>();
  const week7Map = new Map<number, number>();
  for (const r of activityToday.rows) todayMap.set(r.tenant_id, (todayMap.get(r.tenant_id) ?? 0) + Number(r.c));
  for (const r of followToday.rows) todayMap.set(r.tenant_id, (todayMap.get(r.tenant_id) ?? 0) + Number(r.c));
  for (const r of activity7.rows) week7Map.set(r.tenant_id, (week7Map.get(r.tenant_id) ?? 0) + Number(r.c));
  for (const r of follow7.rows) week7Map.set(r.tenant_id, (week7Map.get(r.tenant_id) ?? 0) + Number(r.c));

  const rows = tenants.map((t) => {
    const today = todayMap.get(t.id) ?? 0;
    const last7 = week7Map.get(t.id) ?? 0;
    const pct = (today / DAILY_LIMIT) * 100;
    let status: "normal" | "atencao" | "limite" = "normal";
    if (pct >= 80) status = "limite";
    else if (pct >= 50) status = "atencao";
    return {
      tenantId: t.id,
      tenantName: t.name ?? `Tenant ${t.id}`,
      today,
      last7Days: last7,
      status,
    };
  });

  rows.sort((a, b) => b.today - a.today);

  res.json({
    dailyLimit: DAILY_LIMIT,
    tenants: rows,
  });
});

// ─── Curadoria de Aprendizados (admin) ────────────────────────────────────────
// Lista aprendizados aprovados nos últimos 30 dias e candidatos pendentes,
// agregados por tenant. O dentista não vê mais essa tela; é o admin do SaaS
// que acompanha e remove se quiser.

router.get("/ai-learning/knowledge", async (req: Request, res: Response) => {
  const status = req.query.status === "approved" ? "approved" : "pending";
  const tenants = await db.query.tenantsTable.findMany();
  const tenantMap = new Map(tenants.map((t) => [t.id, t.name ?? `Tenant ${t.id}`]));

  let rows;
  if (status === "approved") {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    rows = await db.query.aiKnowledgeBaseTable.findMany({
      where: and(
        eq(aiKnowledgeBaseTable.status, "approved"),
        gte(aiKnowledgeBaseTable.approvedAt, thirtyDaysAgo),
      ),
      orderBy: [desc(aiKnowledgeBaseTable.approvedAt)],
      limit: 500,
    });
  } else {
    rows = await db.query.aiKnowledgeBaseTable.findMany({
      where: eq(aiKnowledgeBaseTable.status, "pending"),
      orderBy: [desc(aiKnowledgeBaseTable.createdAt)],
      limit: 500,
    });
  }

  const items = rows.map((r) => ({
    id: r.id,
    tenantId: r.tenantId,
    tenantName: tenantMap.get(r.tenantId) ?? `Tenant ${r.tenantId}`,
    question: r.question,
    answer: r.editedAnswer ?? r.answer,
    category: r.category,
    occurrences: r.occurrences ?? r.frequency ?? 1,
    createdAt: r.createdAt,
    approvedAt: r.approvedAt,
  }));

  res.json({ status, items });
});

router.delete("/ai-learning/knowledge/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid id" });
  }
  const deleted = await db.delete(aiKnowledgeBaseTable).where(eq(aiKnowledgeBaseTable.id, id)).returning({ id: aiKnowledgeBaseTable.id });
  if (deleted.length === 0) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true, id: deleted[0].id });
});

export default router;
