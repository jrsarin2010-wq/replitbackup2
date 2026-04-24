import { Router } from "express";
import { db } from "@workspace/db";
import { patientsTable, appointmentsTable, dentalConversationsTable, dentalLeadsTable, consentRecordsTable } from "@workspace/db";
import { eq, and, ilike, or, desc, count, ne } from "drizzle-orm";
import { tenantMiddleware } from "../../middlewares/tenant";
import { CreatePatientBody, UpdatePatientBody, GetPatientParams, UpdatePatientParams, DeletePatientParams, ListPatientsQueryParams } from "@workspace/api-zod";
import { encryptIfNeeded, decryptIfNeeded, hasEncryptionKey, isEncrypted } from "../../lib/encryption";
import { logger } from "../../lib/logger";

type PatientRecord = typeof patientsTable.$inferSelect;

function decryptPatient<T extends Partial<PatientRecord>>(p: T): T {
  if (!p.cpf || !isEncrypted(p.cpf)) return p;
  if (!hasEncryptionKey()) return p;
  return { ...p, cpf: decryptIfNeeded(p.cpf) };
}

function encryptPatientFields<T extends Partial<PatientRecord>>(body: T): T {
  if (!body.cpf) return body;
  if (!hasEncryptionKey()) {
    throw new Error("DATA_ENCRYPTION_KEY is required to store sensitive patient data (CPF)");
  }
  return { ...body, cpf: encryptIfNeeded(body.cpf) };
}

const router = Router();
router.use(tenantMiddleware);

router.get("/", async (req, res) => {
  const query = ListPatientsQueryParams.parse(req.query);
  const { search, filter } = query;

  const patientWhere = search
    ? and(eq(patientsTable.tenantId, req.tenantId), or(ilike(patientsTable.name, `%${search}%`), ilike(patientsTable.phone, `%${search}%`), ilike(patientsTable.email, `%${search}%`)))
    : eq(patientsTable.tenantId, req.tenantId);

  const leadWhere = search
    ? and(eq(dentalLeadsTable.tenantId, req.tenantId), ne(dentalLeadsTable.status, "converted"), or(ilike(dentalLeadsTable.name, `%${search}%`), ilike(dentalLeadsTable.phone, `%${search}%`), ilike(dentalLeadsTable.email, `%${search}%`)))
    : and(eq(dentalLeadsTable.tenantId, req.tenantId), ne(dentalLeadsTable.status, "converted"));

  const [patientRows, leadRows, totalPatientsRows, totalLeadsRows] = await Promise.all([
    filter !== "leads" ? db.query.patientsTable.findMany({ where: patientWhere, orderBy: [desc(patientsTable.createdAt)] }) : Promise.resolve([]),
    filter !== "patients" ? db.query.dentalLeadsTable.findMany({ where: leadWhere, orderBy: [desc(dentalLeadsTable.createdAt)] }) : Promise.resolve([]),
    db.select({ count: count() }).from(patientsTable).where(eq(patientsTable.tenantId, req.tenantId)),
    db.select({ count: count() }).from(dentalLeadsTable).where(and(eq(dentalLeadsTable.tenantId, req.tenantId), ne(dentalLeadsTable.status, "converted"))),
  ]);

  const patientsWithType = patientRows.map((p) => ({ ...decryptPatient(p), type: "patient" as const }));
  const leadsWithType = leadRows.map((l) => ({
    id: l.id,
    leadId: l.id,
    name: l.name,
    phone: l.phone,
    email: l.email,
    notes: l.notes,
    profilePicUrl: l.profilePicUrl,
    totalSpent: "0",
    temperature: l.temperature,
    interest: l.interest,
    source: l.source,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
    type: "lead" as const,
  }));

  const combined = [...patientsWithType, ...leadsWithType].sort((a, b) => {
    const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const db2 = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return db2 - da;
  });

  const totalPatients = totalPatientsRows[0]?.count ?? 0;
  const totalLeads = totalLeadsRows[0]?.count ?? 0;
  const total = filter === "patients" ? totalPatients : filter === "leads" ? totalLeads : totalPatients + totalLeads;

  res.json({ data: combined, total, totalPatients, totalLeads });
});

router.post("/", async (req, res) => {
  const body = CreatePatientBody.parse(req.body);
  const encrypted = encryptPatientFields(body);
  const [patient] = await db.insert(patientsTable).values({ ...encrypted, tenantId: req.tenantId }).returning();

  db.insert(consentRecordsTable).values({
    tenantId: req.tenantId,
    entityType: "patient",
    entityId: patient.id,
    consentType: "data_processing",
    ipAddress: req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() || req.ip || "unknown",
    userAgent: req.headers["user-agent"] || null,
  }).catch((err) => logger.error({ err }, "Failed to record auto-consent for patient"));

  res.status(201).json(decryptPatient(patient));
});

router.get("/:patientId", async (req, res) => {
  const { patientId } = GetPatientParams.parse(req.params);
  const patient = await db.query.patientsTable.findFirst({
    where: and(eq(patientsTable.id, patientId), eq(patientsTable.tenantId, req.tenantId)),
  });
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
  const decryptedPatient = decryptPatient(patient);

  const appointments = await db.query.appointmentsTable.findMany({
    where: and(eq(appointmentsTable.patientId, patientId), eq(appointmentsTable.tenantId, req.tenantId)),
    orderBy: [desc(appointmentsTable.startsAt)],
    limit: 10,
  });

  const conversations = await db.query.dentalConversationsTable.findMany({
    where: and(eq(dentalConversationsTable.patientId, patientId), eq(dentalConversationsTable.tenantId, req.tenantId)),
    orderBy: [desc(dentalConversationsTable.lastMessageAt)],
    limit: 5,
  });

  res.json({ ...decryptedPatient, appointments, conversations });
});

router.patch("/:patientId", async (req, res) => {
  const { patientId } = UpdatePatientParams.parse(req.params);
  const body = UpdatePatientBody.parse(req.body);
  const encrypted = encryptPatientFields(body);
  const [patient] = await db.update(patientsTable).set(encrypted).where(and(eq(patientsTable.id, patientId), eq(patientsTable.tenantId, req.tenantId))).returning();
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }
  res.json(decryptPatient(patient));
});

router.delete("/:patientId", async (req, res) => {
  const { patientId } = DeletePatientParams.parse(req.params);
  await db.delete(patientsTable).where(and(eq(patientsTable.id, patientId), eq(patientsTable.tenantId, req.tenantId)));
  res.status(204).send();
});

export default router;
