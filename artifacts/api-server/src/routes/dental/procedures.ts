import { Router } from "express";
import { db } from "@workspace/db";
import { dentalProceduresTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { tenantMiddleware } from "../../middlewares/tenant";
import { CreateProcedureBody, UpdateProcedureBody, UpdateProcedureParams, DeleteProcedureParams } from "@workspace/api-zod";
import { proceduresCache } from "../../lib/cache";

const router = Router();
router.use(tenantMiddleware);

router.get("/", async (req, res) => {
  const cached = await proceduresCache.get(req.tenantId);
  if (cached) {
    res.json(cached);
    return;
  }

  const rows = await db.query.dentalProceduresTable.findMany({
    where: eq(dentalProceduresTable.tenantId, req.tenantId),
    orderBy: (t, { asc }) => [asc(t.name)],
  });
  await proceduresCache.set(req.tenantId, rows);
  res.json(rows);
});

router.post("/", async (req, res) => {
  const body = CreateProcedureBody.parse(req.body);
  const [row] = await db.insert(dentalProceduresTable).values({ ...body, tenantId: req.tenantId }).returning();
  await proceduresCache.invalidate(req.tenantId);
  res.status(201).json(row);
});

router.patch("/:procedureId", async (req, res) => {
  const { procedureId } = UpdateProcedureParams.parse(req.params);
  const body = UpdateProcedureBody.parse(req.body);
  const [row] = await db.update(dentalProceduresTable).set(body).where(and(eq(dentalProceduresTable.id, procedureId), eq(dentalProceduresTable.tenantId, req.tenantId))).returning();
  if (!row) { res.status(404).json({ error: "Procedure not found" }); return; }
  await proceduresCache.invalidate(req.tenantId);
  res.json(row);
});

router.delete("/:procedureId", async (req, res) => {
  const { procedureId } = DeleteProcedureParams.parse(req.params);
  await db.delete(dentalProceduresTable).where(and(eq(dentalProceduresTable.id, procedureId), eq(dentalProceduresTable.tenantId, req.tenantId)));
  await proceduresCache.invalidate(req.tenantId);
  res.status(204).send();
});

export default router;
