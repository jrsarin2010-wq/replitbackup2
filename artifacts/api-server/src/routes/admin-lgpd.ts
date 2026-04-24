import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import {
  patientsTable,
  dentalLeadsTable,
  consentRecordsTable,
  dataAuditLogTable,
  dentalConversationsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

router.get("/lgpd/:tenantId/consent", async (req: Request, res: Response) => {
  try {
    const tenantId = Number(req.params.tenantId);
    if (isNaN(tenantId)) { res.status(400).json({ error: "tenantId inválido" }); return; }
    const records = await db.query.consentRecordsTable.findMany({
      where: eq(consentRecordsTable.tenantId, tenantId),
      orderBy: [desc(consentRecordsTable.grantedAt)],
    });
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: "Erro ao listar consentimentos" });
  }
});

router.get("/lgpd/:tenantId/audit-log", async (req: Request, res: Response) => {
  try {
    const tenantId = Number(req.params.tenantId);
    if (isNaN(tenantId)) { res.status(400).json({ error: "tenantId inválido" }); return; }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const action = req.query.action as string | undefined;
    const entityType = req.query.entityType as string | undefined;
    const conditions: any[] = [eq(dataAuditLogTable.tenantId, tenantId)];
    if (action) conditions.push(eq(dataAuditLogTable.action, action));
    if (entityType) conditions.push(eq(dataAuditLogTable.entityType, entityType));
    const rows = await db.query.dataAuditLogTable.findMany({
      where: and(...conditions),
      orderBy: [desc(dataAuditLogTable.createdAt)],
      limit,
      offset,
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Erro ao listar logs de auditoria" });
  }
});

router.post("/lgpd/:tenantId/anonymize/:entityType/:entityId", async (req: Request, res: Response) => {
  try {
    const tenantId = Number(req.params.tenantId);
    const entityType = req.params.entityType as string;
    const entityIdStr = req.params.entityId as string;
    const entityId = Number(entityIdStr);
    if (isNaN(tenantId)) { res.status(400).json({ error: "tenantId inválido" }); return; }
    if (!["patient", "lead"].includes(entityType)) { res.status(400).json({ error: "entityType inválido" }); return; }
    if (isNaN(entityId)) { res.status(400).json({ error: "entityId inválido" }); return; }
    const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.ip || "unknown";
    await db.transaction(async (tx) => {
      if (entityType === "patient") {
        const patient = await tx.query.patientsTable.findFirst({
          where: and(eq(patientsTable.id, entityId), eq(patientsTable.tenantId, tenantId)),
        });
        if (!patient) throw new Error("Paciente não encontrado");
        await tx.update(patientsTable).set({
          name: "Paciente Anonimizado", phone: "00000000000", email: null, cpf: null,
          birthDate: null, address: null, notes: null, profilePicUrl: null,
        }).where(and(eq(patientsTable.id, entityId), eq(patientsTable.tenantId, tenantId)));
        await tx.update(dentalConversationsTable).set({ contactName: "Anonimizado", contactPhone: "00000000000" })
          .where(and(eq(dentalConversationsTable.patientId, entityId), eq(dentalConversationsTable.tenantId, tenantId)));
      } else {
        const lead = await tx.query.dentalLeadsTable.findFirst({
          where: and(eq(dentalLeadsTable.id, entityId), eq(dentalLeadsTable.tenantId, tenantId)),
        });
        if (!lead) throw new Error("Lead não encontrado");
        await tx.update(dentalLeadsTable).set({
          name: "Lead Anonimizado", phone: "00000000000", email: null, notes: null, interest: null, profilePicUrl: null,
        }).where(and(eq(dentalLeadsTable.id, entityId), eq(dentalLeadsTable.tenantId, tenantId)));
      }
      await tx.insert(consentRecordsTable).values({
        tenantId, entityType, entityId, consentType: "anonymization", termsVersion: "1.0",
        ipAddress: clientIp, userAgent: (Array.isArray(req.headers["user-agent"]) ? req.headers["user-agent"][0] : req.headers["user-agent"]) ?? null,
      });
      await tx.insert(dataAuditLogTable).values({
        tenantId, action: "anonymize", entityType, entityId, ipAddress: clientIp,
        userAgent: (Array.isArray(req.headers["user-agent"]) ? req.headers["user-agent"][0] : req.headers["user-agent"]) ?? null, metadata: JSON.stringify({ reason: "LGPD right to be forgotten" }),
      });
    });
    res.json({ message: "Dados anonimizados com sucesso" });
  } catch (err: any) {
    const message = err.message?.includes("não encontrado") ? err.message : "Erro ao anonimizar dados";
    res.status(err.message?.includes("não encontrado") ? 404 : 500).json({ error: message });
  }
});

export default router;
