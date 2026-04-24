import { Router, Request } from "express";
import { db } from "@workspace/db";
import {
  consentRecordsTable,
  dataAuditLogTable,
  patientsTable,
  dentalLeadsTable,
  dentalConversationsTable,
  dentalMessagesTable,
  appointmentsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { tenantMiddleware } from "../../middlewares/tenant";
import { logger } from "../../lib/logger";

const router = Router();
router.use(tenantMiddleware);

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.ip || "unknown";
}

router.post("/consent", async (req, res) => {
  try {
    const { entityType, entityId, consentType, termsVersion } = req.body as {
      entityType: string;
      entityId: number;
      consentType: string;
      termsVersion?: string;
    };

    if (!entityType || !entityId || !consentType) {
      res.status(400).json({ error: "entityType, entityId e consentType são obrigatórios" });
      return;
    }

    if (!["patient", "lead"].includes(entityType)) {
      res.status(400).json({ error: "entityType deve ser 'patient' ou 'lead'" });
      return;
    }

    const entityTable = entityType === "patient" ? patientsTable : dentalLeadsTable;
    const entity = entityType === "patient"
      ? await db.query.patientsTable.findFirst({ where: and(eq(patientsTable.id, entityId), eq(patientsTable.tenantId, req.tenantId)) })
      : await db.query.dentalLeadsTable.findFirst({ where: and(eq(dentalLeadsTable.id, entityId), eq(dentalLeadsTable.tenantId, req.tenantId)) });
    if (!entity) {
      res.status(404).json({ error: `${entityType} não encontrado(a) neste tenant` });
      return;
    }

    const [record] = await db
      .insert(consentRecordsTable)
      .values({
        tenantId: req.tenantId,
        entityType,
        entityId,
        consentType,
        termsVersion: termsVersion || "1.0",
        ipAddress: getClientIp(req),
        userAgent: req.headers["user-agent"] || null,
      })
      .returning();

    res.status(201).json(record);
  } catch (err) {
    logger.error({ err }, "Failed to record consent");
    res.status(500).json({ error: "Erro ao registrar consentimento" });
  }
});

router.get("/consent", async (req, res) => {
  try {
    const entityType = req.query.entityType as string | undefined;
    const entityId = req.query.entityId ? Number(req.query.entityId) : undefined;

    const conditions = [eq(consentRecordsTable.tenantId, req.tenantId)];
    if (entityType) conditions.push(eq(consentRecordsTable.entityType, entityType));
    if (entityId) conditions.push(eq(consentRecordsTable.entityId, entityId));

    const records = await db.query.consentRecordsTable.findMany({
      where: and(...conditions),
      orderBy: [desc(consentRecordsTable.grantedAt)],
    });

    res.json(records);
  } catch (err) {
    logger.error({ err }, "Failed to list consents");
    res.status(500).json({ error: "Erro ao listar consentimentos" });
  }
});

router.get("/audit-log", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const action = req.query.action as string | undefined;
    const entityType = req.query.entityType as string | undefined;

    const conditions = [eq(dataAuditLogTable.tenantId, req.tenantId)];
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
    logger.error({ err }, "Failed to list audit logs");
    res.status(500).json({ error: "Erro ao listar logs de auditoria" });
  }
});

router.post("/anonymize/:entityType/:entityId", async (req, res) => {
  try {
    const { entityType, entityId: entityIdStr } = req.params;
    const entityId = Number(entityIdStr);

    if (!["patient", "lead"].includes(entityType)) {
      res.status(400).json({ error: "entityType deve ser 'patient' ou 'lead'" });
      return;
    }

    if (isNaN(entityId)) {
      res.status(400).json({ error: "entityId inválido" });
      return;
    }

    await db.transaction(async (tx) => {
      if (entityType === "patient") {
        const patient = await tx.query.patientsTable.findFirst({
          where: and(eq(patientsTable.id, entityId), eq(patientsTable.tenantId, req.tenantId)),
        });
        if (!patient) throw new Error("Paciente não encontrado");

        await tx
          .update(patientsTable)
          .set({
            name: "Paciente Anonimizado",
            phone: "00000000000",
            email: null,
            cpf: null,
            birthDate: null,
            address: null,
            notes: null,
            profilePicUrl: null,
          })
          .where(and(eq(patientsTable.id, entityId), eq(patientsTable.tenantId, req.tenantId)));

        await tx
          .update(dentalConversationsTable)
          .set({ contactName: "Anonimizado", contactPhone: "00000000000" })
          .where(
            and(
              eq(dentalConversationsTable.patientId, entityId),
              eq(dentalConversationsTable.tenantId, req.tenantId),
            ),
          );
      } else {
        const lead = await tx.query.dentalLeadsTable.findFirst({
          where: and(eq(dentalLeadsTable.id, entityId), eq(dentalLeadsTable.tenantId, req.tenantId)),
        });
        if (!lead) throw new Error("Lead não encontrado");

        await tx
          .update(dentalLeadsTable)
          .set({
            name: "Lead Anonimizado",
            phone: "00000000000",
            email: null,
            notes: null,
            interest: null,
            profilePicUrl: null,
          })
          .where(and(eq(dentalLeadsTable.id, entityId), eq(dentalLeadsTable.tenantId, req.tenantId)));
      }

      await tx.insert(consentRecordsTable).values({
        tenantId: req.tenantId,
        entityType,
        entityId,
        consentType: "anonymization",
        termsVersion: "1.0",
        ipAddress: getClientIp(req),
        userAgent: req.headers["user-agent"] || null,
      });

      await tx.insert(dataAuditLogTable).values({
        tenantId: req.tenantId,
        action: "anonymize",
        entityType,
        entityId,
        ipAddress: getClientIp(req),
        userAgent: req.headers["user-agent"] || null,
        metadata: JSON.stringify({ reason: "LGPD right to be forgotten" }),
      });
    });

    res.json({ message: "Dados anonimizados com sucesso" });
  } catch (err: any) {
    logger.error({ err }, "Failed to anonymize data");
    const message = err.message?.includes("não encontrado") ? err.message : "Erro ao anonimizar dados";
    res.status(err.message?.includes("não encontrado") ? 404 : 500).json({ error: message });
  }
});

export default router;
