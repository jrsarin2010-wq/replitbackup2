import { Router } from "express";
import { db } from "@workspace/db";
import { dentalLeadsTable, dentalProfessionalsTable, patientsTable, dentalActivityTable, consentRecordsTable, dataAuditLogTable, leadsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { tenantMiddleware } from "../../middlewares/tenant";
import { markStrategyOutcome } from "../../lib/ai-engine";
import { logger } from "../../lib/logger";
import { encryptIfNeeded, decryptIfNeeded, hasEncryptionKey } from "../../lib/encryption";
import {
  CreateLeadBody, UpdateLeadBody, GetLeadParams, UpdateLeadParams,
  DeleteLeadParams, ConvertLeadParams, ConvertLeadBody, ListLeadsQueryParams,
} from "@workspace/api-zod";
import { z } from "zod/v4";

const CaptureLeadBody = z.object({
  nome: z.string().min(2).max(255),
  email: z.string().email().max(255),
  whatsapp: z.string().min(10).max(50),
  origem: z.string().max(100).optional().default("landing_free_plan"),
});

function encryptCpfOrFail(cpf: string): string {
  if (!hasEncryptionKey()) {
    throw new Error("DATA_ENCRYPTION_KEY is required to store sensitive patient data (CPF)");
  }
  return encryptIfNeeded(cpf) as string;
}

const router = Router();

router.post("/capture", async (req, res) => {
  try {
    const body = CaptureLeadBody.parse(req.body);
    const [lead] = await db.insert(leadsTable).values({
      nome: body.nome,
      email: body.email,
      whatsapp: body.whatsapp,
      origem: body.origem,
    }).returning({ id: leadsTable.id });
    res.status(201).json({ success: true, id: lead.id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Dados inválidos", details: err.issues });
      return;
    }
    throw err;
  }
});

router.use(tenantMiddleware);

router.get("/", async (req, res) => {
  const query = ListLeadsQueryParams.safeParse(req.query);
  const temperature = query.success ? query.data.temperature : undefined;
  const status = query.success ? query.data.status : undefined;

  const conditions = [eq(dentalLeadsTable.tenantId, req.tenantId)];
  if (temperature) conditions.push(eq(dentalLeadsTable.temperature, temperature));
  if (status) conditions.push(eq(dentalLeadsTable.status, status));

  const rows = await db.query.dentalLeadsTable.findMany({
    where: and(...conditions),
    orderBy: [desc(dentalLeadsTable.updatedAt)],
  });
  res.json(rows);
});

router.post("/", async (req, res) => {
  const body = CreateLeadBody.parse(req.body);
  if (body.professionalId != null) {
    if (body.professionalId <= 0) { res.status(400).json({ error: "Invalid professionalId" }); return; }
    const prof = await db.query.dentalProfessionalsTable.findFirst({ where: and(eq(dentalProfessionalsTable.id, body.professionalId), eq(dentalProfessionalsTable.tenantId, req.tenantId)) });
    if (!prof) { res.status(400).json({ error: "Professional not found or does not belong to this clinic" }); return; }
  }
  const [lead] = await db.insert(dentalLeadsTable).values({ ...body, tenantId: req.tenantId }).returning();

  db.insert(consentRecordsTable).values({
    tenantId: req.tenantId,
    entityType: "lead",
    entityId: lead.id,
    consentType: "data_processing",
    ipAddress: req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() || req.ip || "unknown",
    userAgent: req.headers["user-agent"] || null,
  }).catch((err) => logger.error({ err }, "Failed to record auto-consent for lead"));

  res.status(201).json(lead);
});

router.get("/:leadId", async (req, res) => {
  const { leadId } = GetLeadParams.parse(req.params);
  const lead = await db.query.dentalLeadsTable.findFirst({ where: and(eq(dentalLeadsTable.id, leadId), eq(dentalLeadsTable.tenantId, req.tenantId)) });
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  res.json(lead);
});

router.patch("/:leadId", async (req, res) => {
  const { leadId } = UpdateLeadParams.parse(req.params);
  const body = UpdateLeadBody.parse(req.body);
  if (body.professionalId != null) {
    if (body.professionalId <= 0) { res.status(400).json({ error: "Invalid professionalId" }); return; }
    const prof = await db.query.dentalProfessionalsTable.findFirst({ where: and(eq(dentalProfessionalsTable.id, body.professionalId), eq(dentalProfessionalsTable.tenantId, req.tenantId)) });
    if (!prof) { res.status(400).json({ error: "Professional not found or does not belong to this clinic" }); return; }
  }
  const [lead] = await db.update(dentalLeadsTable).set(body).where(and(eq(dentalLeadsTable.id, leadId), eq(dentalLeadsTable.tenantId, req.tenantId))).returning();
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  res.json(lead);
});

const PaymentTypeBody = z.object({
  paymentType: z.enum(["insurance", "private"]).nullable(),
});

router.patch("/:leadId/payment-type", async (req, res) => {
  const { leadId } = UpdateLeadParams.parse(req.params);
  const body = PaymentTypeBody.parse(req.body);

  const existing = await db.query.dentalLeadsTable.findFirst({
    where: and(eq(dentalLeadsTable.id, leadId), eq(dentalLeadsTable.tenantId, req.tenantId)),
  });
  if (!existing) { res.status(404).json({ error: "Lead not found" }); return; }

  const previousPaymentType = existing.paymentType ?? null;

  const [lead] = await db.update(dentalLeadsTable)
    .set({ paymentType: body.paymentType })
    .where(and(eq(dentalLeadsTable.id, leadId), eq(dentalLeadsTable.tenantId, req.tenantId)))
    .returning();

  await db.insert(dataAuditLogTable).values({
    tenantId: req.tenantId,
    action: "update",
    entityType: "lead",
    entityId: leadId,
    field: "payment_type",
    ipAddress: req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() || req.ip || "unknown",
    userAgent: req.headers["user-agent"] || null,
    metadata: JSON.stringify({
      from: previousPaymentType,
      to: body.paymentType,
      source: "manual_dashboard_override",
    }),
  }).catch((err) => logger.error({ err, leadId }, "Failed to write payment_type audit log"));

  await db.insert(dentalActivityTable).values({
    tenantId: req.tenantId,
    type: "lead_payment_type_changed",
    description: `Tipo de pagamento de ${existing.name} alterado: ${previousPaymentType ?? "não definido"} → ${body.paymentType ?? "não definido"}`,
    entityType: "lead",
    entityId: leadId,
  }).catch((err) => logger.error({ err, leadId }, "Failed to write payment_type activity"));

  res.json(lead);
});

router.delete("/:leadId", async (req, res) => {
  const { leadId } = DeleteLeadParams.parse(req.params);
  await db.delete(dentalLeadsTable).where(and(eq(dentalLeadsTable.id, leadId), eq(dentalLeadsTable.tenantId, req.tenantId)));
  res.status(204).send();
});

router.post("/:leadId/convert", async (req, res) => {
  const { leadId } = ConvertLeadParams.parse(req.params);
  const lead = await db.query.dentalLeadsTable.findFirst({ where: and(eq(dentalLeadsTable.id, leadId), eq(dentalLeadsTable.tenantId, req.tenantId)) });
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  if (lead.status === "converted") { res.status(400).json({ error: "Lead already converted" }); return; }

  const body = ConvertLeadBody.parse(req.body);
  const patientName = (body.name || lead.name || "").trim();
  const patientPhone = (body.phone || lead.phone || "").trim();
  if (!patientName || !patientPhone) { res.status(400).json({ error: "Nome e telefone sao obrigatorios" }); return; }

  const result = await db.transaction(async (tx) => {
    const [patient] = await tx.insert(patientsTable).values({
      tenantId: req.tenantId,
      name: patientName,
      phone: patientPhone,
      email: body.email || lead.email || undefined,
      cpf: body.cpf ? encryptCpfOrFail(body.cpf) : undefined,
      birthDate: body.birthDate || undefined,
      address: body.address || undefined,
      notes: body.notes || lead.notes || undefined,
      profilePicUrl: lead.profilePicUrl || undefined,
    }).returning();

    await tx.update(dentalLeadsTable).set({
      status: "converted",
      convertedToPatientId: patient.id,
      convertedAt: new Date(),
    }).where(and(eq(dentalLeadsTable.id, leadId), eq(dentalLeadsTable.tenantId, req.tenantId)));

    await tx.insert(dentalActivityTable).values({
      tenantId: req.tenantId,
      type: "lead_converted",
      description: `Lead ${lead.name} convertido para paciente`,
      entityType: "lead",
      entityId: leadId,
    });

    await tx.insert(consentRecordsTable).values({
      tenantId: req.tenantId,
      entityType: "patient",
      entityId: patient.id,
      consentType: "data_processing",
      ipAddress: req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() || req.ip || "unknown",
      userAgent: req.headers["user-agent"] || null,
    });

    await tx.insert(dataAuditLogTable).values({
      tenantId: req.tenantId,
      action: "create",
      entityType: "patient",
      entityId: patient.id,
      ipAddress: req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() || req.ip || "unknown",
      userAgent: req.headers["user-agent"] || null,
      metadata: JSON.stringify({ fields: Object.keys(body), source: "lead_conversion", leadId }),
    });

    return patient;
  });

  await markStrategyOutcome(req.tenantId, leadId, "positive").catch((err) => {
    logger.error({ err, leadId }, "Failed to mark strategy outcome");
  });

  const decryptedPatient = result.cpf
    ? { ...result, cpf: decryptIfNeeded(result.cpf) }
    : result;
  res.json({ lead: { ...lead, status: "converted", convertedToPatientId: result.id }, patient: decryptedPatient });
});

export default router;
