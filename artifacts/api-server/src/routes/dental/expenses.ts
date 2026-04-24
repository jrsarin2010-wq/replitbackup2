import { Router } from "express";
import { db } from "@workspace/db";
import { expensesTable } from "@workspace/db";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import { tenantMiddleware } from "../../middlewares/tenant";
import {
  CreateExpenseBody,
  UpdateExpenseBody,
  GetExpenseParams,
  UpdateExpenseParams,
  DeleteExpenseParams,
} from "@workspace/api-zod";

const router = Router();
router.use(tenantMiddleware);

router.get("/", async (req, res) => {
  const rawQuery = req.query as Record<string, string | undefined>;
  const category = rawQuery.category;
  const startDateStr = rawQuery.startDate;
  const endDateStr = rawQuery.endDate;

  const conditions = [eq(expensesTable.tenantId, req.tenantId)];

  if (category) {
    conditions.push(eq(expensesTable.category, category));
  }
  if (startDateStr) {
    conditions.push(gte(expensesTable.date, new Date(startDateStr)));
  }
  if (endDateStr) {
    const end = new Date(endDateStr);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(expensesTable.date, end));
  }

  const rows = await db
    .select()
    .from(expensesTable)
    .where(and(...conditions))
    .orderBy(desc(expensesTable.date));

  res.json(rows);
});

router.get("/:expenseId", async (req, res) => {
  const { expenseId } = GetExpenseParams.parse(req.params);
  const row = await db.query.expensesTable.findFirst({
    where: and(eq(expensesTable.id, expenseId), eq(expensesTable.tenantId, req.tenantId)),
  });
  if (!row) {
    res.status(404).json({ message: "Despesa nao encontrada" });
    return;
  }
  res.json(row);
});

router.post("/", async (req, res) => {
  const body = CreateExpenseBody.parse(req.body);

  const [row] = await db
    .insert(expensesTable)
    .values({
      tenantId: req.tenantId,
      description: body.description,
      amount: String(body.amount),
      category: body.category,
      date: body.date ? new Date(body.date) : new Date(),
      notes: body.notes || null,
    })
    .returning();

  res.status(201).json(row);
});

router.put("/:expenseId", async (req, res) => {
  const { expenseId } = UpdateExpenseParams.parse(req.params);
  const body = UpdateExpenseBody.parse(req.body);

  const existing = await db.query.expensesTable.findFirst({
    where: and(eq(expensesTable.id, expenseId), eq(expensesTable.tenantId, req.tenantId)),
  });
  if (!existing) {
    res.status(404).json({ message: "Despesa nao encontrada" });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (body.description !== undefined) updates.description = body.description;
  if (body.amount !== undefined) updates.amount = String(body.amount);
  if (body.category !== undefined) updates.category = body.category;
  if (body.date !== undefined) updates.date = new Date(body.date);
  if (body.notes !== undefined) updates.notes = body.notes;

  const [row] = await db
    .update(expensesTable)
    .set(updates)
    .where(and(eq(expensesTable.id, expenseId), eq(expensesTable.tenantId, req.tenantId)))
    .returning();

  res.json(row);
});

router.delete("/:expenseId", async (req, res) => {
  const { expenseId } = DeleteExpenseParams.parse(req.params);

  const existing = await db.query.expensesTable.findFirst({
    where: and(eq(expensesTable.id, expenseId), eq(expensesTable.tenantId, req.tenantId)),
  });
  if (!existing) {
    res.status(404).json({ message: "Despesa nao encontrada" });
    return;
  }

  await db
    .delete(expensesTable)
    .where(and(eq(expensesTable.id, expenseId), eq(expensesTable.tenantId, req.tenantId)));

  res.json({ message: "Despesa excluida" });
});

export default router;
