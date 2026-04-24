import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { dentalBlockedPeriodsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { tenantMiddleware } from "../../middlewares/tenant";

const router = Router();
router.use(tenantMiddleware);

const CreateBlockedPeriodBody = z.object({
  title: z.string().min(1).max(255),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  publicMessage: z.string().optional().nullable(),
  isActive: z.boolean().optional().default(true),
});

const UpdateBlockedPeriodBody = CreateBlockedPeriodBody.partial();

router.get("/", async (req, res) => {
  const rows = await db.query.dentalBlockedPeriodsTable.findMany({
    where: eq(dentalBlockedPeriodsTable.tenantId, req.tenantId),
    orderBy: (t, { asc }) => [asc(t.startDate)],
  });
  res.json(rows);
});

router.post("/", async (req, res) => {
  const body = CreateBlockedPeriodBody.parse(req.body);
  if (body.startDate > body.endDate) {
    res.status(400).json({ error: "startDate deve ser anterior ou igual a endDate" });
    return;
  }
  const [row] = await db.insert(dentalBlockedPeriodsTable).values({
    tenantId: req.tenantId,
    title: body.title,
    startDate: body.startDate,
    endDate: body.endDate,
    publicMessage: body.publicMessage ?? null,
    isActive: body.isActive ?? true,
  }).returning();
  res.status(201).json(row);
});

router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const body = UpdateBlockedPeriodBody.parse(req.body);
  const existing = await db.query.dentalBlockedPeriodsTable.findFirst({
    where: and(eq(dentalBlockedPeriodsTable.id, id), eq(dentalBlockedPeriodsTable.tenantId, req.tenantId)),
  });
  if (!existing) {
    res.status(404).json({ error: "Periodo de bloqueio nao encontrado" });
    return;
  }
  const mergedStart = body.startDate ?? existing.startDate;
  const mergedEnd = body.endDate ?? existing.endDate;
  if (mergedStart > mergedEnd) {
    res.status(400).json({ error: "startDate deve ser anterior ou igual a endDate" });
    return;
  }
  const [updated] = await db.update(dentalBlockedPeriodsTable)
    .set(body)
    .where(and(eq(dentalBlockedPeriodsTable.id, id), eq(dentalBlockedPeriodsTable.tenantId, req.tenantId)))
    .returning();
  res.json(updated);
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const existing = await db.query.dentalBlockedPeriodsTable.findFirst({
    where: and(eq(dentalBlockedPeriodsTable.id, id), eq(dentalBlockedPeriodsTable.tenantId, req.tenantId)),
  });
  if (!existing) {
    res.status(404).json({ error: "Periodo de bloqueio nao encontrado" });
    return;
  }
  await db.delete(dentalBlockedPeriodsTable)
    .where(and(eq(dentalBlockedPeriodsTable.id, id), eq(dentalBlockedPeriodsTable.tenantId, req.tenantId)));
  res.status(204).send();
});

export default router;
