import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import {
  appointmentFollowUpsTable,
  dentalActivityTable,
  tutorFeedbackTable,
} from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { processFollowUps, triggerRemarketingForAll } from "../scheduler";
import { buildAuditReport, runInsuranceAuditJob } from "../lib/insurance-audit";

const router = Router();

router.post("/tenants/:id/reset-test-data", async (req: Request, res: Response) => {
  const tenantId = parseInt(req.params.id as string);
  try {
    await db.execute(sql`DELETE FROM appointment_follow_ups WHERE appointment_id IN (SELECT id FROM appointments WHERE tenant_id = ${tenantId})`);
    await db.execute(sql`DELETE FROM ai_strategy_analytics WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM ai_contact_memory WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM dental_activity WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM dental_messages WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM dental_conversations WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM appointments WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM patient_treatments WHERE patient_id IN (SELECT id FROM patients WHERE tenant_id = ${tenantId})`);
    await db.execute(sql`DELETE FROM dental_leads WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM patients WHERE tenant_id = ${tenantId}`);
    res.json({ ok: true, message: "Dados de teste resetados com sucesso." });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.post("/trigger-followups", async (_req: Request, res: Response) => {
  try {
    const before = await db.query.appointmentFollowUpsTable.findMany({
      where: eq(appointmentFollowUpsTable.status, "pending"),
    });
    const pendingIds = new Set(before.map((f) => f.id));
    const pendingCount = before.length;

    await processFollowUps();

    const after = await db.query.appointmentFollowUpsTable.findMany({
      where: and(
        eq(appointmentFollowUpsTable.status, "pending"),
      ),
    });

    let sent = 0, failed = 0, skipped = 0;
    if (pendingIds.size > 0) {
      const idList = [...pendingIds];
      const sentRows = await db.execute(
        sql`SELECT COUNT(*) as cnt FROM appointment_follow_ups WHERE id = ANY(${idList}) AND status = 'sent'`
      );
      const failedRows = await db.execute(
        sql`SELECT COUNT(*) as cnt FROM appointment_follow_ups WHERE id = ANY(${idList}) AND status = 'failed'`
      );
      const skippedRows = await db.execute(
        sql`SELECT COUNT(*) as cnt FROM appointment_follow_ups WHERE id = ANY(${idList}) AND status = 'skipped'`
      );
      sent = Number((sentRows.rows as Array<{cnt: string}>)[0]?.cnt ?? 0);
      failed = Number((failedRows.rows as Array<{cnt: string}>)[0]?.cnt ?? 0);
      skipped = Number((skippedRows.rows as Array<{cnt: string}>)[0]?.cnt ?? 0);
    }

    res.json({
      ok: true,
      message: `Follow-ups: ${sent} enviados, ${failed} falhos, ${skipped} ignorados de ${pendingCount} pendentes`,
      pendingBefore: pendingCount,
      sent,
      failed,
      skipped,
      stillPending: after.length,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.post("/trigger-remarketing", async (_req: Request, res: Response) => {
  try {
    const beforeActivity = await db.query.dentalActivityTable.findMany({
      where: eq(dentalActivityTable.type, "remarketing_sent"),
      orderBy: [desc(dentalActivityTable.createdAt)],
      limit: 1,
    });
    const lastRemarketingBefore = beforeActivity[0]?.createdAt ?? null;

    const results = await triggerRemarketingForAll();

    const afterActivity = await db.query.dentalActivityTable.findMany({
      where: eq(dentalActivityTable.type, "remarketing_sent"),
      orderBy: [desc(dentalActivityTable.createdAt)],
      limit: 5,
    });

    const newSent = afterActivity.filter(
      (a) => !lastRemarketingBefore || a.createdAt > lastRemarketingBefore
    ).length;

    res.json({
      ok: true,
      message: `Remarketing disparado: ${newSent} mensagem(ns) enviada(s)`,
      tenantResults: results,
      recentActivity: afterActivity.map((a) => ({
        id: a.id,
        description: a.description,
        createdAt: a.createdAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.get("/feedback", async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = 50;
  const offset = (page - 1) * limit;
  const statusFilter = req.query.status as string | undefined;

  const rows = await db.execute(sql`
    SELECT
      tf.id,
      tf.tenant_id,
      tf.type,
      tf.content,
      tf.original_message,
      tf.status,
      tf.created_at,
      COALESCE(ds.clinic_name, t.name) as clinic_name
    FROM tutor_feedback tf
    JOIN tenants t ON t.id = tf.tenant_id
    LEFT JOIN dental_settings ds ON ds.tenant_id = tf.tenant_id
    ${statusFilter && statusFilter !== "all" ? sql`WHERE tf.status = ${statusFilter}` : sql``}
    ORDER BY tf.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  const countResult = await db.execute(sql`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'nova') as novas_global
    FROM tutor_feedback
  `);

  const filteredCountResult = await db.execute(sql`
    SELECT COUNT(*) as total_filtered
    FROM tutor_feedback
    ${statusFilter && statusFilter !== "all" ? sql`WHERE status = ${statusFilter}` : sql``}
  `);

  res.json({
    items: rows.rows,
    total: Number(filteredCountResult.rows[0]?.total_filtered ?? 0),
    novas: Number(countResult.rows[0]?.novas_global ?? 0),
    page,
  });
});

router.get("/feedback/trends", async (_req: Request, res: Response) => {
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

  const byTypeResult = await db.execute(sql`
    SELECT
      type,
      COUNT(*) as total
    FROM tutor_feedback
    GROUP BY type
    ORDER BY total DESC
  `);

  const weeklyResult = await db.execute(sql`
    SELECT
      TO_CHAR(DATE_TRUNC('week', created_at), 'YYYY-MM-DD') as week,
      type,
      COUNT(*) as total
    FROM tutor_feedback
    WHERE created_at >= ${since.toISOString()}
    GROUP BY week, type
    ORDER BY week ASC
  `);

  const TYPES = ["sugestao", "reclamacao", "elogio", "dica", "outro"];

  const topContentResult = await db.execute(sql`
    SELECT type, content, created_at
    FROM (
      SELECT
        type, content, created_at,
        ROW_NUMBER() OVER (PARTITION BY type ORDER BY created_at DESC) as rn
      FROM tutor_feedback
    ) ranked
    WHERE rn <= 10
    ORDER BY type, created_at DESC
  `);

  const byType: Record<string, number> = {};
  for (const row of byTypeResult.rows as Array<{ type: string; total: string }>) {
    byType[row.type] = Number(row.total);
  }

  const weekMap: Record<string, Record<string, number>> = {};
  for (const row of weeklyResult.rows as Array<{ week: string; type: string; total: string }>) {
    if (!weekMap[row.week]) weekMap[row.week] = {};
    weekMap[row.week][row.type] = Number(row.total);
  }

  const allWeeks: string[] = [];
  const cursor = new Date(since);
  cursor.setDate(cursor.getDate() - cursor.getDay());
  const nowWeekStart = new Date();
  nowWeekStart.setDate(nowWeekStart.getDate() - nowWeekStart.getDay());
  while (cursor <= nowWeekStart) {
    const iso = cursor.toISOString().slice(0, 10);
    allWeeks.push(iso);
    cursor.setDate(cursor.getDate() + 7);
  }

  const weeklyTimeSeries = allWeeks.map(week => ({
    week,
    ...Object.fromEntries(TYPES.map(t => [t, weekMap[week]?.[t] ?? 0])),
  }));

  const topContentByType: Record<string, Array<{ content: string; createdAt: string }>> = {};
  for (const type of TYPES) topContentByType[type] = [];
  for (const row of topContentResult.rows as Array<{ type: string; content: string; created_at: string }>) {
    const bucket = topContentByType[row.type] ?? (topContentByType[row.type] = []);
    bucket.push({ content: row.content, createdAt: row.created_at });
  }

  res.json({ byType, weeklyTimeSeries, topContentByType });
});

router.patch("/feedback/:id/status", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { status } = req.body as { status: string };

  if (!["nova", "lida", "arquivada"].includes(status)) {
    res.status(400).json({ error: "status inválido" });
    return;
  }

  const [updated] = await db
    .update(tutorFeedbackTable)
    .set({ status })
    .where(eq(tutorFeedbackTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Feedback não encontrado" }); return; }
  res.json({ id: updated.id, status: updated.status });
});

router.get("/insurance-audit", async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenantId ? Number(req.query.tenantId) : undefined;
    const days = req.query.days ? Number(req.query.days) : 7;
    if (tenantId !== undefined && (!Number.isFinite(tenantId) || tenantId <= 0)) {
      res.status(400).json({ error: "tenantId inválido" });
      return;
    }
    if (!Number.isFinite(days) || days <= 0 || days > 90) {
      res.status(400).json({ error: "days deve estar entre 1 e 90" });
      return;
    }
    const report = await buildAuditReport({ tenantId, sinceDays: days });
    res.json(report);
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.post("/insurance-audit/run", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    let tenantId: number | undefined;
    if (body.tenantId !== undefined && body.tenantId !== null && body.tenantId !== "") {
      const n = Number(body.tenantId);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        res.status(400).json({ error: "tenantId inválido" });
        return;
      }
      tenantId = n;
    }

    let sinceDays = 1;
    if (body.sinceDays !== undefined && body.sinceDays !== null && body.sinceDays !== "") {
      const n = Number(body.sinceDays);
      if (!Number.isFinite(n) || n <= 0 || n > 90) {
        res.status(400).json({ error: "sinceDays deve estar entre 1 e 90" });
        return;
      }
      sinceDays = n;
    }

    let threshold: number | undefined;
    if (body.threshold !== undefined && body.threshold !== null && body.threshold !== "") {
      const n = Number(body.threshold);
      if (!Number.isFinite(n) || n <= 0 || n > 1) {
        res.status(400).json({ error: "threshold deve estar entre 0 (exclusivo) e 1" });
        return;
      }
      threshold = n;
    }

    let minMessages: number | undefined;
    if (body.minMessages !== undefined && body.minMessages !== null && body.minMessages !== "") {
      const n = Number(body.minMessages);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
        res.status(400).json({ error: "minMessages deve ser um inteiro >= 1" });
        return;
      }
      minMessages = n;
    }

    const results = await runInsuranceAuditJob({ tenantId, sinceDays, threshold, minMessages });
    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
