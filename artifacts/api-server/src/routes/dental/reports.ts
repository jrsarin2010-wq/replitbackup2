import { Router } from "express";
import { db } from "@workspace/db";
import { appointmentsTable, dentalLeadsTable } from "@workspace/db";
import { eq, and, gte, lte, sql, count } from "drizzle-orm";
import { tenantMiddleware } from "../../middlewares/tenant";
import { GetAppointmentsReportQueryParams, GetRevenueReportQueryParams, GetProceduresReportQueryParams, GetPeakHoursReportQueryParams, GetLeadsReportQueryParams } from "@workspace/api-zod";
import { logger } from "../../lib/logger";

const router = Router();
router.use(tenantMiddleware);

function parseRange(q: { startDate?: string; endDate?: string }) {
  const from = q.startDate ? new Date(q.startDate) : new Date(Date.now() - 30 * 86400000);
  const to = q.endDate ? new Date(q.endDate) : new Date();
  return { from, to };
}

router.get("/appointments", async (req, res) => {
  const query = GetAppointmentsReportQueryParams.safeParse(req.query);
  const groupBy = query.success ? (query.data.groupBy ?? "day") : "day";
  const { from, to } = parseRange(query.success ? query.data : {});

  const dateFormat = groupBy === "month" ? "YYYY-MM" : groupBy === "week" ? "IYYY-IW" : "YYYY-MM-DD";

  try {
    const rows = await db.execute(sql`
      SELECT TO_CHAR(starts_at AT TIME ZONE 'UTC', ${dateFormat}) as period,
             COUNT(*) as total,
             COUNT(*) FILTER (WHERE status = 'completed') as completed,
             COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
             COUNT(*) FILTER (WHERE status = 'scheduled') as scheduled
      FROM appointments
      WHERE tenant_id = ${req.tenantId}
        AND starts_at >= ${from}
        AND starts_at <= ${to}
      GROUP BY period ORDER BY period
    `);
    res.json({ groupBy, startDate: from.toISOString(), endDate: to.toISOString(), data: rows.rows });
  } catch (err) {
    logger.error({ err, tenantId: req.tenantId }, "appointments report query failed");
    res.json({ groupBy, startDate: from.toISOString(), endDate: to.toISOString(), data: [], error: "Nao foi possivel carregar os dados de consultas." });
  }
});

router.get("/revenue", async (req, res) => {
  const query = GetRevenueReportQueryParams.safeParse(req.query);
  const groupBy = query.success ? (query.data.groupBy ?? "day") : "day";
  const { from, to } = parseRange(query.success ? query.data : {});

  const dateFormat = groupBy === "month" ? "YYYY-MM" : groupBy === "week" ? "IYYY-IW" : "YYYY-MM-DD";

  let rows: { rows: unknown[] } = { rows: [] };
  let totalRevenue = 0;
  let hasError = false;

  try {
    rows = await db.execute(sql`
      SELECT TO_CHAR(starts_at AT TIME ZONE 'UTC', ${dateFormat}) as period,
             COALESCE(SUM(CAST(price AS NUMERIC)), 0) as revenue,
             COUNT(*) as appointments
      FROM appointments
      WHERE tenant_id = ${req.tenantId}
        AND status = 'completed'
        AND starts_at >= ${from}
        AND starts_at <= ${to}
      GROUP BY period ORDER BY period
    `);
  } catch (err) {
    logger.error({ err, tenantId: req.tenantId }, "revenue report rows query failed");
    hasError = true;
  }

  try {
    const totalResult = await db.execute(sql`
      SELECT COALESCE(SUM(CAST(price AS NUMERIC)), 0) as total
      FROM appointments
      WHERE tenant_id = ${req.tenantId} AND status = 'completed' AND starts_at >= ${from} AND starts_at <= ${to}
    `);
    totalRevenue = parseFloat(String((totalResult.rows[0] as Record<string, unknown>)?.total ?? "0"));
  } catch (err) {
    logger.error({ err, tenantId: req.tenantId }, "revenue report total query failed");
    hasError = true;
  }

  res.json({
    groupBy,
    startDate: from.toISOString(),
    endDate: to.toISOString(),
    totalRevenue,
    data: rows.rows,
    ...(hasError ? { error: "Alguns dados de receita nao puderam ser carregados." } : {}),
  });
});

router.get("/procedures", async (req, res) => {
  const query = GetProceduresReportQueryParams.safeParse(req.query);
  const { from, to } = parseRange(query.success ? query.data : {});

  try {
    const rows = await db.execute(sql`
      SELECT procedure_name, COUNT(*) as count,
             COALESCE(SUM(CAST(price AS NUMERIC)), 0) as revenue
      FROM appointments
      WHERE tenant_id = ${req.tenantId}
        AND starts_at >= ${from} AND starts_at <= ${to}
        AND procedure_name IS NOT NULL
      GROUP BY procedure_name ORDER BY count DESC
      LIMIT 20
    `);
    res.json(rows.rows);
  } catch (err) {
    logger.error({ err, tenantId: req.tenantId }, "procedures report query failed");
    res.status(200).json([]);
  }
});

router.get("/peak-hours", async (req, res) => {
  const query = GetPeakHoursReportQueryParams.safeParse(req.query);
  const { from, to } = parseRange(query.success ? query.data : {});

  try {
    const rows = await db.execute(sql`
      SELECT EXTRACT(HOUR FROM starts_at AT TIME ZONE 'UTC') as hour,
             EXTRACT(DOW FROM starts_at AT TIME ZONE 'UTC') as day_of_week,
             COUNT(*) as count
      FROM appointments
      WHERE tenant_id = ${req.tenantId}
        AND starts_at >= ${from} AND starts_at <= ${to}
      GROUP BY hour, day_of_week ORDER BY count DESC
    `);
    res.json(rows.rows);
  } catch (err) {
    logger.error({ err, tenantId: req.tenantId }, "peak-hours report query failed");
    res.json([]);
  }
});

router.get("/leads", async (req, res) => {
  const query = GetLeadsReportQueryParams.safeParse(req.query);
  const { from, to } = parseRange(query.success ? query.data : {});

  try {
    const [total, converted, hot, warm, cold] = await Promise.all([
      db.select({ count: count() }).from(dentalLeadsTable).where(and(eq(dentalLeadsTable.tenantId, req.tenantId), gte(dentalLeadsTable.createdAt, from), lte(dentalLeadsTable.createdAt, to))),
      db.select({ count: count() }).from(dentalLeadsTable).where(and(eq(dentalLeadsTable.tenantId, req.tenantId), eq(dentalLeadsTable.status, "converted"), gte(dentalLeadsTable.createdAt, from), lte(dentalLeadsTable.createdAt, to))),
      db.select({ count: count() }).from(dentalLeadsTable).where(and(eq(dentalLeadsTable.tenantId, req.tenantId), eq(dentalLeadsTable.temperature, "hot"), gte(dentalLeadsTable.createdAt, from), lte(dentalLeadsTable.createdAt, to))),
      db.select({ count: count() }).from(dentalLeadsTable).where(and(eq(dentalLeadsTable.tenantId, req.tenantId), eq(dentalLeadsTable.temperature, "warm"), gte(dentalLeadsTable.createdAt, from), lte(dentalLeadsTable.createdAt, to))),
      db.select({ count: count() }).from(dentalLeadsTable).where(and(eq(dentalLeadsTable.tenantId, req.tenantId), eq(dentalLeadsTable.temperature, "cold"), gte(dentalLeadsTable.createdAt, from), lte(dentalLeadsTable.createdAt, to))),
    ]);

    const totalCount = total[0]?.count ?? 0;
    const convertedCount = converted[0]?.count ?? 0;
    const conversionRate = totalCount > 0 ? ((convertedCount / totalCount) * 100) : 0;

    res.json({
      startDate: from.toISOString(),
      endDate: to.toISOString(),
      total: totalCount,
      converted: convertedCount,
      conversionRate,
      byTemperature: { hot: hot[0]?.count ?? 0, warm: warm[0]?.count ?? 0, cold: cold[0]?.count ?? 0 },
    });
  } catch (err) {
    logger.error({ err, tenantId: req.tenantId }, "leads report query failed");
    res.json({
      startDate: from.toISOString(),
      endDate: to.toISOString(),
      total: 0,
      converted: 0,
      conversionRate: 0,
      byTemperature: { hot: 0, warm: 0, cold: 0 },
      error: "Nao foi possivel carregar os dados de leads.",
    });
  }
});

router.get("/monthly-trend", async (req, res) => {
  const months = Math.min(Math.max(parseInt(String(req.query.months ?? "12"), 10) || 12, 1), 24);

  try {
    const rows = await db.execute<{
      month: string;
      appointments: string;
      revenue: string;
      recovered_patients: string;
      leads_converted: string;
    }>(sql`
      WITH months AS (
        SELECT TO_CHAR(generate_series(
          DATE_TRUNC('month', NOW()) - INTERVAL '1 month' * (${months} - 1),
          DATE_TRUNC('month', NOW()),
          '1 month'::interval
        ), 'YYYY-MM') AS month
      ),
      appts AS (
        SELECT TO_CHAR(DATE_TRUNC('month', starts_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
               COUNT(*) FILTER (WHERE status = 'completed') AS appointments,
               COALESCE(SUM(CAST(price AS NUMERIC)) FILTER (WHERE status = 'completed'), 0) AS revenue
        FROM appointments
        WHERE tenant_id = ${req.tenantId}
          AND starts_at >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month' * (${months} - 1)
        GROUP BY 1
      ),
      recovery AS (
        SELECT TO_CHAR(DATE_TRUNC('month', created_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
               COUNT(*) FILTER (WHERE type = 'recovery_converted') AS recovered_patients
        FROM dental_activity
        WHERE tenant_id = ${req.tenantId}
          AND type = 'recovery_converted'
          AND created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month' * (${months} - 1)
        GROUP BY 1
      ),
      leads AS (
        SELECT TO_CHAR(DATE_TRUNC('month', created_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
               COUNT(*) FILTER (WHERE status = 'converted') AS leads_converted
        FROM dental_leads
        WHERE tenant_id = ${req.tenantId}
          AND created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month' * (${months} - 1)
        GROUP BY 1
      )
      SELECT m.month,
             COALESCE(a.appointments, 0)::text AS appointments,
             COALESCE(a.revenue, 0)::text AS revenue,
             COALESCE(r.recovered_patients, 0)::text AS recovered_patients,
             COALESCE(l.leads_converted, 0)::text AS leads_converted
      FROM months m
      LEFT JOIN appts a ON a.month = m.month
      LEFT JOIN recovery r ON r.month = m.month
      LEFT JOIN leads l ON l.month = m.month
      ORDER BY m.month
    `);

    const data = rows.rows.map((row) => ({
      month: row.month,
      appointments: Number(row.appointments),
      revenue: parseFloat(row.revenue),
      recoveredPatients: Number(row.recovered_patients),
      leadsConverted: Number(row.leads_converted),
    }));

    res.json({ months, data });
  } catch (err) {
    logger.error({ err, tenantId: req.tenantId }, "monthly-trend report query failed");
    res.json({ months, data: [], error: "Nao foi possivel carregar a tendencia mensal." });
  }
});

export default router;
