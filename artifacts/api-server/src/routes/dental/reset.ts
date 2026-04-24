import { Router } from "express";
import { db } from "@workspace/db";
import {
  dentalConversationsTable,
  dentalMessagesTable,
  appointmentsTable,
  appointmentFollowUpsTable,
  patientsTable,
  dentalLeadsTable,
  patientTreatmentsTable,
  audioMessagesTable,
  aiContactMemoryTable,
  aiObjectionPatternsTable,
  aiKnowledgeBaseTable,
  aiStrategyAnalyticsTable,
  dentalActivityTable,
  consentRecordsTable,
  callLogsTable,
  dataAuditLogTable,
  dentalWaitlistTable,
  expensesTable,
  tutorFeedbackTable,
  tutorChatSessionsTable,
  dentalBlockedPeriodsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { tenantMiddleware } from "../../middlewares/tenant";

const router = Router();

router.post("/reset-all", tenantMiddleware, async (req, res) => {
  const tenantId = req.tenantId;
  try {
    await db.transaction(async (tx) => {
      await tx.delete(appointmentFollowUpsTable).where(eq(appointmentFollowUpsTable.tenantId, tenantId));
      await tx.delete(callLogsTable).where(eq(callLogsTable.tenantId, tenantId));
      await tx.delete(consentRecordsTable).where(eq(consentRecordsTable.tenantId, tenantId));
      await tx.delete(dentalWaitlistTable).where(eq(dentalWaitlistTable.tenantId, tenantId));
      await tx.delete(expensesTable).where(eq(expensesTable.tenantId, tenantId));
      await tx.delete(tutorFeedbackTable).where(eq(tutorFeedbackTable.tenantId, tenantId));
      await tx.delete(tutorChatSessionsTable).where(eq(tutorChatSessionsTable.tenantId, tenantId));
      await tx.delete(dataAuditLogTable).where(eq(dataAuditLogTable.tenantId, tenantId));
      await tx.delete(dentalActivityTable).where(eq(dentalActivityTable.tenantId, tenantId));
      await tx.delete(aiStrategyAnalyticsTable).where(eq(aiStrategyAnalyticsTable.tenantId, tenantId));
      await tx.delete(aiContactMemoryTable).where(eq(aiContactMemoryTable.tenantId, tenantId));
      await tx.delete(aiObjectionPatternsTable).where(eq(aiObjectionPatternsTable.tenantId, tenantId));
      await tx.delete(aiKnowledgeBaseTable).where(eq(aiKnowledgeBaseTable.tenantId, tenantId));
      await tx.delete(audioMessagesTable).where(eq(audioMessagesTable.tenantId, tenantId));
      await tx.delete(dentalMessagesTable).where(eq(dentalMessagesTable.tenantId, tenantId));
      await tx.delete(dentalConversationsTable).where(eq(dentalConversationsTable.tenantId, tenantId));
      await tx.delete(patientTreatmentsTable).where(eq(patientTreatmentsTable.tenantId, tenantId));
      await tx.delete(appointmentsTable).where(eq(appointmentsTable.tenantId, tenantId));
      await tx.delete(dentalLeadsTable).where(eq(dentalLeadsTable.tenantId, tenantId));
      await tx.delete(patientsTable).where(eq(patientsTable.tenantId, tenantId));
      await tx.delete(dentalBlockedPeriodsTable).where(eq(dentalBlockedPeriodsTable.tenantId, tenantId));
    });

    res.json({ success: true, message: "Dados operacionais resetados com sucesso" });
  } catch (error) {
    console.error("Reset error:", error);
    const isDev = process.env.NODE_ENV !== "production";
    const detail = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      error: "Falha ao resetar dados",
      ...(isDev && { detail, stack: error instanceof Error ? error.stack : undefined }),
    });
  }
});

export default router;
