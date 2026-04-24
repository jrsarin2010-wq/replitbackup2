import { Router } from "express";
import { db } from "@workspace/db";
import { patientTreatmentsTable, patientsTable, dentalActivityTable, expensesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { tenantMiddleware } from "../../middlewares/tenant";
import { logger } from "../../lib/logger";
import { ListTreatmentsQueryParams, CreateTreatmentBody, UpdateTreatmentBody, GetTreatmentParams, UpdateTreatmentParams, DeleteTreatmentParams } from "@workspace/api-zod";

const router = Router();
router.use(tenantMiddleware);

async function validatePatientBelongsToTenant(patientId: number, tenantId: number) {
  const patient = await db.query.patientsTable.findFirst({
    where: and(eq(patientsTable.id, patientId), eq(patientsTable.tenantId, tenantId)),
  });
  return patient;
}

router.get("/", async (req, res) => {
  const { patientId, status } = ListTreatmentsQueryParams.parse(req.query);
  const conditions = [eq(patientTreatmentsTable.tenantId, req.tenantId)];
  if (patientId) conditions.push(eq(patientTreatmentsTable.patientId, Number(patientId)));
  if (status && status !== "all") conditions.push(eq(patientTreatmentsTable.status, status));

  const rows = await db.select().from(patientTreatmentsTable)
    .where(and(...conditions))
    .orderBy(desc(patientTreatmentsTable.createdAt));

  const withPatientName = await Promise.all(rows.map(async (row) => {
    const patient = await db.query.patientsTable.findFirst({
      where: and(eq(patientsTable.id, row.patientId), eq(patientsTable.tenantId, req.tenantId)),
      columns: { name: true, phone: true },
    });
    return { ...row, patientName: patient?.name || "", patientPhone: patient?.phone || "" };
  }));

  res.json(withPatientName);
});

router.get("/financial-summary", async (req, res) => {
  const [rows, expenseRows] = await Promise.all([
    db.select().from(patientTreatmentsTable)
      .where(eq(patientTreatmentsTable.tenantId, req.tenantId)),
    db.select().from(expensesTable)
      .where(eq(expensesTable.tenantId, req.tenantId)),
  ]);

  const totalRevenue = rows.reduce((s, r) => s + Number(r.totalValue || 0), 0);
  const totalPaid = rows.reduce((s, r) => s + Number(r.paidValue || 0), 0);
  const totalPending = totalRevenue - totalPaid;
  const totalTreatments = rows.length;
  const finalized = rows.filter(r => r.status === "finished").length;
  const inProgress = rows.filter(r => r.status === "in_progress").length;
  const totalExpenses = expenseRows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const netBalance = totalRevenue - totalExpenses;

  res.json({
    totalRevenue,
    totalPaid,
    totalPending,
    totalExpenses,
    netBalance,
    totalTreatments,
    finalized,
    inProgress,
  });
});

router.get("/:treatmentId", async (req, res) => {
  const { treatmentId } = GetTreatmentParams.parse(req.params);
  const row = await db.query.patientTreatmentsTable.findFirst({
    where: and(
      eq(patientTreatmentsTable.id, treatmentId),
      eq(patientTreatmentsTable.tenantId, req.tenantId),
    ),
  });
  if (!row) { res.status(404).json({ message: "Tratamento nao encontrado" }); return; }
  res.json(row);
});

router.post("/", async (req, res) => {
  const body = CreateTreatmentBody.parse(req.body);

  const patient = await validatePatientBelongsToTenant(body.patientId, req.tenantId);
  if (!patient) {
    res.status(400).json({ message: "Paciente nao encontrado neste tenant" });
    return;
  }

  const [row] = await db.insert(patientTreatmentsTable).values({
    tenantId: req.tenantId,
    patientId: body.patientId,
    description: body.description || "Tratamento",
    procedures: JSON.stringify(body.procedures || []),
    totalValue: String(body.totalValue || 0),
    paidValue: String(body.paidValue || 0),
    paymentMethod: body.paymentMethod || null,
    notes: body.notes || null,
    status: body.status || "in_progress",
  }).returning();

  if (Number(body.paidValue || 0) > 0) {
    const newTotal = Number(patient.totalSpent || 0) + Number(body.paidValue || 0);
    await db.update(patientsTable).set({ totalSpent: String(newTotal) })
      .where(and(eq(patientsTable.id, body.patientId), eq(patientsTable.tenantId, req.tenantId)));
  }

  await db.insert(dentalActivityTable).values({
    tenantId: req.tenantId,
    type: "treatment_created",
    description: `Tratamento criado: ${body.description || "Tratamento"}`,
    metadata: JSON.stringify({ treatmentId: row.id, patientId: body.patientId }),
  });

  res.status(201).json(row);
});

router.put("/:treatmentId", async (req, res) => {
  const { treatmentId } = UpdateTreatmentParams.parse(req.params);
  const body = UpdateTreatmentBody.parse(req.body);
  const existing = await db.query.patientTreatmentsTable.findFirst({
    where: and(eq(patientTreatmentsTable.id, treatmentId), eq(patientTreatmentsTable.tenantId, req.tenantId)),
  });
  if (!existing) { res.status(404).json({ message: "Tratamento nao encontrado" }); return; }

  const updates: Record<string, unknown> = {};
  if (body.description !== undefined) updates.description = body.description;
  if (body.procedures !== undefined) updates.procedures = JSON.stringify(body.procedures);
  if (body.totalValue !== undefined) updates.totalValue = String(body.totalValue);
  if (body.paidValue !== undefined) updates.paidValue = String(body.paidValue);
  if (body.paymentMethod !== undefined) updates.paymentMethod = body.paymentMethod;
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.status !== undefined) {
    updates.status = body.status;
    if (body.status === "finished" && existing.status !== "finished") {
      updates.finishedAt = new Date();
      await db.insert(dentalActivityTable).values({
        tenantId: req.tenantId,
        type: "treatment_finished",
        description: `Tratamento finalizado: ${existing.description}`,
        metadata: JSON.stringify({ treatmentId, patientId: existing.patientId }),
      });
    }
  }

  if (body.paidValue !== undefined) {
    const paidDiff = Number(body.paidValue) - Number(existing.paidValue);
    if (paidDiff !== 0) {
      const patient = await db.query.patientsTable.findFirst({
        where: and(eq(patientsTable.id, existing.patientId), eq(patientsTable.tenantId, req.tenantId)),
      });
      const newTotal = Math.max(0, Number(patient?.totalSpent || 0) + paidDiff);
      await db.update(patientsTable).set({ totalSpent: String(newTotal) })
        .where(and(eq(patientsTable.id, existing.patientId), eq(patientsTable.tenantId, req.tenantId)));
    }
  }

  const [row] = await db.update(patientTreatmentsTable).set(updates)
    .where(and(eq(patientTreatmentsTable.id, treatmentId), eq(patientTreatmentsTable.tenantId, req.tenantId)))
    .returning();
  res.json(row);
});

router.delete("/:treatmentId", async (req, res) => {
  const { treatmentId } = DeleteTreatmentParams.parse(req.params);
  const existing = await db.query.patientTreatmentsTable.findFirst({
    where: and(eq(patientTreatmentsTable.id, treatmentId), eq(patientTreatmentsTable.tenantId, req.tenantId)),
  });
  if (!existing) { res.status(404).json({ message: "Tratamento nao encontrado" }); return; }

  const patient = await db.query.patientsTable.findFirst({
    where: and(eq(patientsTable.id, existing.patientId), eq(patientsTable.tenantId, req.tenantId)),
  });
  if (patient) {
    const newTotal = Math.max(0, Number(patient.totalSpent || 0) - Number(existing.paidValue));
    await db.update(patientsTable).set({ totalSpent: String(newTotal) })
      .where(and(eq(patientsTable.id, existing.patientId), eq(patientsTable.tenantId, req.tenantId)));
  }

  await db.delete(patientTreatmentsTable)
    .where(and(eq(patientTreatmentsTable.id, treatmentId), eq(patientTreatmentsTable.tenantId, req.tenantId)));
  res.json({ message: "Tratamento excluido" });
});

export default router;
