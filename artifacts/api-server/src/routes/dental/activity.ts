import { Router } from "express";
import { db } from "@workspace/db";
import { dentalActivityTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { tenantMiddleware } from "../../middlewares/tenant";
import { getLatestUnconfirmedAlert, markAlertHandled } from "../../lib/unconfirmed-alert";

const router = Router();
router.use(tenantMiddleware);

// Task #15 — dashboard card data: latest unconfirmed-appointments alert.
router.get("/unconfirmed-alert/latest", async (req, res) => {
  const alert = await getLatestUnconfirmedAlert(req.tenantId);
  res.json({ alert });
});

// Task #15 — dentist marks the alert as handled (audit trail).
router.post("/unconfirmed-alert/:id/handle", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const ok = await markAlertHandled(req.tenantId, id);
  if (!ok) { res.status(404).json({ error: "Alert not found" }); return; }
  res.json({ ok: true });
});

router.get("/", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Number(req.query.offset) || 0;

  const rows = await db.query.dentalActivityTable.findMany({
    where: eq(dentalActivityTable.tenantId, req.tenantId),
    orderBy: [desc(dentalActivityTable.createdAt)],
    limit,
    offset,
  });

  res.json(rows);
});

router.get("/:activityId", async (req, res) => {
  const id = Number(req.params.activityId);
  const row = await db.query.dentalActivityTable.findFirst({
    where: and(eq(dentalActivityTable.id, id), eq(dentalActivityTable.tenantId, req.tenantId)),
  });
  if (!row) { res.status(404).json({ error: "Activity not found" }); return; }
  res.json(row);
});

export default router;
