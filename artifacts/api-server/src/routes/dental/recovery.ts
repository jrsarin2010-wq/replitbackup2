import { Router } from "express";
import { db } from "@workspace/db";
import {
  dentalSettingsTable,
  dentalActivityTable,
  patientsTable,
  dentalLeadsTable,
  appointmentsTable,
} from "@workspace/db";
import { eq, and, lt, desc, sql, gte, inArray } from "drizzle-orm";
import { tenantMiddleware } from "../../middlewares/tenant";
import { settingsCache, getCachedSettings } from "../../lib/cache";
import { logger } from "../../lib/logger";

const router = Router();
router.use(tenantMiddleware);

router.get("/candidates", async (req, res) => {
  try {
    const settings = await getCachedSettings(req.tenantId);

    const inactivityDays = settings?.recoveryInactivityDays ?? 60;
    const noShowDays = settings?.recoveryNoShowDays ?? 14;

    const now = new Date();
    const patientCutoff = new Date(now.getTime() - inactivityDays * 24 * 60 * 60 * 1000);
    const noShowCutoff = new Date(now.getTime() - noShowDays * 24 * 60 * 60 * 1000);

    const inactivePatients = await db.execute<{
      id: number;
      name: string;
      phone: string;
      last_visit: string | null;
    }>(sql`
      SELECT id, name, phone, last_visit
      FROM patients
      WHERE tenant_id = ${req.tenantId}
        AND (last_visit IS NULL OR last_visit < ${patientCutoff.toISOString()})
      ORDER BY last_visit ASC NULLS FIRST
      LIMIT 100
    `);

    const noShowLeads = await db.execute<{
      id: number;
      name: string;
      phone: string;
      last_contact_at: string | null;
    }>(sql`
      SELECT DISTINCT dl.id, dl.name, dl.phone, dl.last_contact_at
      FROM dental_leads dl
      INNER JOIN appointments a ON a.lead_id = dl.id
      WHERE dl.tenant_id = ${req.tenantId}
        AND dl.status = 'active'
        AND a.status = 'no_show'
        AND a.starts_at < ${noShowCutoff.toISOString()}
      ORDER BY dl.last_contact_at ASC NULLS FIRST
      LIMIT 100
    `);

    const patientIds = inactivePatients.rows.map((p) => p.id);
    const leadIds = noShowLeads.rows.map((l) => l.id);

    const recentPatientActivity = patientIds.length > 0
      ? await db.query.dentalActivityTable.findMany({
          where: and(
            eq(dentalActivityTable.tenantId, req.tenantId),
            eq(dentalActivityTable.entityType, "patient"),
            inArray(dentalActivityTable.entityId, patientIds),
            inArray(dentalActivityTable.type, ["recovery_sent", "recovery_responded", "recovery_converted"])
          ),
          orderBy: [desc(dentalActivityTable.createdAt)],
        })
      : [];

    const recentLeadActivity = leadIds.length > 0
      ? await db.query.dentalActivityTable.findMany({
          where: and(
            eq(dentalActivityTable.tenantId, req.tenantId),
            eq(dentalActivityTable.entityType, "lead"),
            inArray(dentalActivityTable.entityId, leadIds),
            inArray(dentalActivityTable.type, ["recovery_sent", "recovery_responded", "recovery_converted"])
          ),
          orderBy: [desc(dentalActivityTable.createdAt)],
        })
      : [];

    const patientActivityMap = new Map<number, { type: string; createdAt: Date }>();
    for (const act of recentPatientActivity) {
      if (act.entityId !== null && !patientActivityMap.has(act.entityId)) {
        patientActivityMap.set(act.entityId, { type: act.type, createdAt: act.createdAt });
      }
    }

    const leadActivityMap = new Map<number, { type: string; createdAt: Date }>();
    for (const act of recentLeadActivity) {
      if (act.entityId !== null && !leadActivityMap.has(act.entityId)) {
        leadActivityMap.set(act.entityId, { type: act.type, createdAt: act.createdAt });
      }
    }

    const candidates = [
      ...inactivePatients.rows.map((p) => {
        const lastVisit = p.last_visit ? new Date(p.last_visit) : null;
        const daysInactive = lastVisit
          ? Math.floor((now.getTime() - lastVisit.getTime()) / (24 * 60 * 60 * 1000))
          : 9999;
        const activity = patientActivityMap.get(p.id);
        return {
          id: p.id,
          entityType: "patient" as const,
          name: p.name,
          phone: p.phone,
          lastContact: p.last_visit,
          daysInactive,
          status: activity?.type === "recovery_converted"
            ? "reagendou"
            : activity?.type === "recovery_responded"
              ? "respondeu"
              : activity?.type === "recovery_sent"
                ? "mensagem_enviada"
                : "pendente",
          lastRecoveryAt: activity?.createdAt ?? null,
        };
      }),
      ...noShowLeads.rows.map((l) => {
        const lastContact = l.last_contact_at ? new Date(l.last_contact_at) : null;
        const daysInactive = lastContact
          ? Math.floor((now.getTime() - lastContact.getTime()) / (24 * 60 * 60 * 1000))
          : 9999;
        const activity = leadActivityMap.get(l.id);
        return {
          id: l.id,
          entityType: "lead" as const,
          name: l.name,
          phone: l.phone,
          lastContact: l.last_contact_at,
          daysInactive,
          status: activity?.type === "recovery_converted"
            ? "reagendou"
            : activity?.type === "recovery_responded"
              ? "respondeu"
              : activity?.type === "recovery_sent"
                ? "mensagem_enviada"
                : "pendente",
          lastRecoveryAt: activity?.createdAt ?? null,
        };
      }),
    ].sort((a, b) => b.daysInactive - a.daysInactive);

    res.json(candidates);
  } catch (err) {
    logger.error({ err, tenantId: req.tenantId }, "Failed to get recovery candidates");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/stats", async (req, res) => {
  try {
    const { period = "30d" } = req.query as { period?: string };
    const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const settings = await getCachedSettings(req.tenantId);
    const inactivityDays = settings?.recoveryInactivityDays ?? 60;
    const noShowDays = settings?.recoveryNoShowDays ?? 14;

    const now = new Date();
    const patientCutoff = new Date(now.getTime() - inactivityDays * 24 * 60 * 60 * 1000);
    const noShowCutoff = new Date(now.getTime() - noShowDays * 24 * 60 * 60 * 1000);

    const { rows: [inactivePatientsResult] } = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count FROM patients
      WHERE tenant_id = ${req.tenantId}
        AND (last_visit IS NULL OR last_visit < ${patientCutoff.toISOString()})
    `);
    const { rows: [noShowLeadsResult] } = await db.execute<{ count: string }>(sql`
      SELECT COUNT(DISTINCT dl.id)::text AS count
      FROM dental_leads dl
      INNER JOIN appointments a ON a.lead_id = dl.id
      WHERE dl.tenant_id = ${req.tenantId}
        AND dl.status = 'active'
        AND a.status = 'no_show'
        AND a.starts_at < ${noShowCutoff.toISOString()}
    `);

    const totalCandidates = Number(inactivePatientsResult?.count ?? 0) + Number(noShowLeadsResult?.count ?? 0);

    const activityRows = await db.execute<{ type: string; count: string; week: string }>(sql`
      SELECT type, COUNT(*)::text AS count,
        TO_CHAR(DATE_TRUNC('week', created_at), 'YYYY-MM-DD') AS week
      FROM dental_activity
      WHERE tenant_id = ${req.tenantId}
        AND type IN ('recovery_sent', 'recovery_responded', 'recovery_converted')
        AND created_at >= ${since.toISOString()}
      GROUP BY type, week
      ORDER BY week
    `);

    let totalSent = 0, totalResponded = 0, totalConverted = 0;
    const weekMap = new Map<string, { sent: number; responded: number; converted: number }>();

    for (const row of activityRows.rows) {
      const count = Number(row.count);
      if (row.type === "recovery_sent") totalSent += count;
      if (row.type === "recovery_responded") totalResponded += count;
      if (row.type === "recovery_converted") totalConverted += count;

      const w = weekMap.get(row.week) || { sent: 0, responded: 0, converted: 0 };
      if (row.type === "recovery_sent") w.sent += count;
      if (row.type === "recovery_responded") w.responded += count;
      if (row.type === "recovery_converted") w.converted += count;
      weekMap.set(row.week, w);
    }

    const weeklyTrend = Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, counts]) => ({ week, ...counts }));

    const inactivityBuckets = await db.execute<{ bucket: string; count: string }>(sql`
      SELECT
        CASE
          WHEN EXTRACT(EPOCH FROM (NOW() - last_visit)) / 86400 BETWEEN 30 AND 60 THEN '30-60d'
          WHEN EXTRACT(EPOCH FROM (NOW() - last_visit)) / 86400 BETWEEN 60 AND 90 THEN '60-90d'
          ELSE '+90d'
        END AS bucket,
        COUNT(*)::text AS count
      FROM patients
      WHERE tenant_id = ${req.tenantId}
        AND last_visit IS NOT NULL
        AND EXTRACT(EPOCH FROM (NOW() - last_visit)) / 86400 >= 30
      GROUP BY bucket
    `);

    const buckets: Record<string, number> = { "30-60d": 0, "60-90d": 0, "+90d": 0 };
    for (const row of inactivityBuckets.rows) {
      buckets[row.bucket] = Number(row.count);
    }

    res.json({
      totalCandidates,
      totalSent,
      totalResponded,
      totalConverted,
      weeklyTrend,
      inactivityBuckets: buckets,
    });
  } catch (err) {
    logger.error({ err, tenantId: req.tenantId }, "Failed to get recovery stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/manual-send/:entityType/:entityId", async (req, res) => {
  try {
    const { entityType, entityId } = req.params as { entityType: string; entityId: string };
    const id = parseInt(entityId, 10);

    if (!["patient", "lead"].includes(entityType) || isNaN(id)) {
      res.status(400).json({ error: "Invalid entity" });
      return;
    }

    const { processPatientRecoveryForTenant } = await import("../../scheduler");
    await processPatientRecoveryForTenant(req.tenantId, { manualEntityType: entityType as "patient" | "lead", manualEntityId: id });

    res.json({ success: true });
  } catch (err) {
    logger.error({ err, tenantId: req.tenantId }, "Manual recovery send failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
