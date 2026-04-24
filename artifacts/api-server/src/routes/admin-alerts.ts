import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { platformAlertsTable } from "@workspace/db";
import { eq, desc, isNull, and, gte, sql } from "drizzle-orm";

const router = Router();

router.get("/alerts", async (req: Request, res: Response) => {
  const onlyActive = req.query.active === "1" || req.query.active === "true";
  const limit = Math.min(Number(req.query.limit) || 100, 500);

  const where = onlyActive ? isNull(platformAlertsTable.dismissedAt) : undefined;
  const list = await db
    .select()
    .from(platformAlertsTable)
    .where(where)
    .orderBy(desc(platformAlertsTable.createdAt))
    .limit(limit);

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const counts = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where dismissed_at is null)::int`,
      critical: sql<number>`count(*) filter (where severity = 'critical' and dismissed_at is null)::int`,
    })
    .from(platformAlertsTable)
    .where(gte(platformAlertsTable.createdAt, since));

  res.json({ alerts: list, summary: counts[0] ?? { total: 0, active: 0, critical: 0 } });
});

router.post("/alerts/:id/dismiss", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db
    .update(platformAlertsTable)
    .set({ dismissedAt: new Date() })
    .where(and(eq(platformAlertsTable.id, id), isNull(platformAlertsTable.dismissedAt)));
  res.json({ ok: true });
});

router.post("/alerts/dismiss-all", async (_req: Request, res: Response) => {
  await db
    .update(platformAlertsTable)
    .set({ dismissedAt: new Date() })
    .where(isNull(platformAlertsTable.dismissedAt));
  res.json({ ok: true });
});

export default router;
