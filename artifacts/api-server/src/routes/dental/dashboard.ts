import { Router } from "express";
import { db } from "@workspace/db";
import { appointmentsTable, patientsTable, dentalLeadsTable, dentalActivityTable, expensesTable, birthdayGreetingsSentTable } from "@workspace/db";
import { eq, and, gte, lte, count, sql, desc } from "drizzle-orm";
import { tenantMiddleware } from "../../middlewares/tenant";
import { GetDashboardActivityQueryParams } from "@workspace/api-zod";
import { logger } from "../../lib/logger";

const router = Router();
router.use(tenantMiddleware);

router.get("/", async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayEnd = new Date(today);
  todayEnd.setHours(23, 59, 59, 999);

  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);

  const safeQuery = async <T>(fn: () => Promise<T>, fallback: T, label: string): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      logger.error({ err, label, tenantId: req.tenantId }, "Dashboard query failed, returning fallback");
      return fallback;
    }
  };

  const [
    todayAppts,
    weekAppts,
    monthAppts,
    totalPatients,
    hotLeads,
    warmLeads,
    coldLeads,
    monthRevenue,
    noShowThisMonth,
    rescheduledRows,
    monthExpensesResult,
  ] = await Promise.all([
    safeQuery(() => db.select({ count: count() }).from(appointmentsTable).where(
      and(eq(appointmentsTable.tenantId, req.tenantId), gte(appointmentsTable.startsAt, today), lte(appointmentsTable.startsAt, todayEnd))
    ), [{ count: 0 }], "todayAppts"),
    safeQuery(() => db.select({ count: count() }).from(appointmentsTable).where(
      and(eq(appointmentsTable.tenantId, req.tenantId), gte(appointmentsTable.startsAt, weekStart), lte(appointmentsTable.startsAt, weekEnd))
    ), [{ count: 0 }], "weekAppts"),
    safeQuery(() => db.select({ count: count() }).from(appointmentsTable).where(
      and(eq(appointmentsTable.tenantId, req.tenantId), gte(appointmentsTable.startsAt, monthStart), lte(appointmentsTable.startsAt, monthEnd))
    ), [{ count: 0 }], "monthAppts"),
    safeQuery(() => db.select({ count: count() }).from(patientsTable).where(eq(patientsTable.tenantId, req.tenantId)), [{ count: 0 }], "totalPatients"),
    safeQuery(() => db.select({ count: count() }).from(dentalLeadsTable).where(and(eq(dentalLeadsTable.tenantId, req.tenantId), eq(dentalLeadsTable.temperature, "hot"), eq(dentalLeadsTable.status, "active"))), [{ count: 0 }], "hotLeads"),
    safeQuery(() => db.select({ count: count() }).from(dentalLeadsTable).where(and(eq(dentalLeadsTable.tenantId, req.tenantId), eq(dentalLeadsTable.temperature, "warm"), eq(dentalLeadsTable.status, "active"))), [{ count: 0 }], "warmLeads"),
    safeQuery(() => db.select({ count: count() }).from(dentalLeadsTable).where(and(eq(dentalLeadsTable.tenantId, req.tenantId), eq(dentalLeadsTable.temperature, "cold"), eq(dentalLeadsTable.status, "active"))), [{ count: 0 }], "coldLeads"),
    safeQuery(() => db.select({ total: sql<string>`COALESCE(SUM(CAST(price AS NUMERIC)), 0)` })
      .from(appointmentsTable)
      .where(and(eq(appointmentsTable.tenantId, req.tenantId), gte(appointmentsTable.startsAt, monthStart), lte(appointmentsTable.startsAt, monthEnd), eq(appointmentsTable.status, "completed"))),
      [{ total: "0" }], "monthRevenue"),
    safeQuery(() => db.select({ count: count() }).from(appointmentsTable).where(
      and(eq(appointmentsTable.tenantId, req.tenantId), gte(appointmentsTable.startsAt, monthStart), lte(appointmentsTable.startsAt, monthEnd), eq(appointmentsTable.status, "no_show"))
    ), [{ count: 0 }], "noShowThisMonth"),
    safeQuery(() => db.execute<{ count: string }>(sql`
      SELECT COUNT(*) AS count FROM (
        SELECT COALESCE(ns.patient_id::text, 'lead:' || ns.lead_id::text) AS entity_key
        FROM appointments ns
        WHERE ns.tenant_id = ${req.tenantId}
          AND ns.status = 'no_show'
          AND ns.starts_at >= ${monthStart}
          AND ns.starts_at <= ${monthEnd}
          AND EXISTS (
            SELECT 1 FROM appointments re
            WHERE re.tenant_id = ${req.tenantId}
              AND re.status IN ('scheduled','confirmed')
              AND re.created_at > ns.starts_at
              AND (
                (ns.patient_id IS NOT NULL AND re.patient_id = ns.patient_id)
                OR (ns.lead_id IS NOT NULL AND re.lead_id = ns.lead_id)
              )
          )
        GROUP BY entity_key
      ) distinct_entities
    `), { rows: [{ count: "0" }] } as unknown as Awaited<ReturnType<typeof db.execute<{ count: string }>>>, "rescheduledRows"),
    safeQuery(() => db.select().from(expensesTable).where(
      and(eq(expensesTable.tenantId, req.tenantId), gte(expensesTable.date, monthStart), lte(expensesTable.date, monthEnd))
    ), [], "monthExpenses"),
  ]);

  const todayApptsList = await safeQuery(() => db.query.appointmentsTable.findMany({
    where: and(eq(appointmentsTable.tenantId, req.tenantId), gte(appointmentsTable.startsAt, today), lte(appointmentsTable.startsAt, todayEnd)),
    orderBy: [desc(appointmentsTable.startsAt)],
    limit: 5,
  }), [], "todayApptsList");

  const enrichedToday = await Promise.all(
    todayApptsList.map(async (a) => {
      let patientName: string | undefined;
      try {
        if (a.patientId) {
          const patient = await db.query.patientsTable.findFirst({ where: and(eq(patientsTable.id, a.patientId), eq(patientsTable.tenantId, req.tenantId)) });
          patientName = patient?.name;
        } else if (a.leadId) {
          const lead = await db.query.dentalLeadsTable.findFirst({ where: and(eq(dentalLeadsTable.id, a.leadId), eq(dentalLeadsTable.tenantId, req.tenantId)) });
          patientName = lead?.name ? `${lead.name} (Lead)` : undefined;
        }
      } catch (err) {
        logger.error({ err, appointmentId: a.id }, "Failed to enrich appointment with patient/lead name");
      }
      return { ...a, patientName };
    })
  );

  const rescheduledThisMonth = parseInt((rescheduledRows.rows[0]?.count as string) || "0", 10);
  const expensesThisMonth = (monthExpensesResult as Array<{ amount: string | null }>).reduce((s, r) => s + Number(r.amount || 0), 0);

  const birthdayRows = await safeQuery(
    () => db.execute<{ count: string }>(sql`
      SELECT COUNT(*) AS count FROM ${birthdayGreetingsSentTable}
      WHERE ${birthdayGreetingsSentTable.tenantId} = ${req.tenantId}
        AND ${birthdayGreetingsSentTable.sentAt} >= ${monthStart}
        AND ${birthdayGreetingsSentTable.sentAt} <= ${monthEnd}
    `),
    { rows: [{ count: "0" }] } as unknown as Awaited<ReturnType<typeof db.execute<{ count: string }>>>,
    "birthdayRows"
  );
  const birthdayGreetingsThisMonth = parseInt(birthdayRows.rows[0]?.count || "0", 10);

  res.json({
    appointmentsToday: todayAppts[0]?.count ?? 0,
    appointmentsThisWeek: weekAppts[0]?.count ?? 0,
    appointmentsThisMonth: monthAppts[0]?.count ?? 0,
    totalPatients: totalPatients[0]?.count ?? 0,
    leads: { hot: hotLeads[0]?.count ?? 0, warm: warmLeads[0]?.count ?? 0, cold: coldLeads[0]?.count ?? 0 },
    revenueThisMonth: parseFloat(monthRevenue[0]?.total || "0"),
    noShowThisMonth: noShowThisMonth[0]?.count ?? 0,
    rescheduledThisMonth,
    birthdayGreetingsThisMonth,
    expensesThisMonth,
    upcomingToday: enrichedToday,
  });
});

router.get("/activity", async (req, res) => {
  const query = GetDashboardActivityQueryParams.safeParse(req.query);
  const limit = query.success ? (query.data.limit ?? 20) : 20;

  try {
    const rows = await db.query.dentalActivityTable.findMany({
      where: eq(dentalActivityTable.tenantId, req.tenantId),
      orderBy: [desc(dentalActivityTable.createdAt)],
      limit,
    });
    res.json(rows);
  } catch (err) {
    logger.error({ err, tenantId: req.tenantId }, "Failed to fetch dashboard activity");
    res.json([]);
  }
});

export default router;
