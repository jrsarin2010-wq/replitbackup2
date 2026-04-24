import { Router } from "express";
import { db } from "@workspace/db";
import { dentalConversationsTable, dentalMessagesTable, dentalSettingsTable, aiResponseAuditTable } from "@workspace/db";
import { insertChainedMessage } from "../../lib/audit-chain";
import { eq, and, desc, ne } from "drizzle-orm";
import { tenantMiddleware } from "../../middlewares/tenant";
import { GetConversationParams, ListMessagesParams, ListMessagesQueryParams, SendMessageParams, SendMessageBody, ListConversationsQueryParams } from "@workspace/api-zod";
import { getProviderForTenant } from "../../lib/whatsapp-provider";
import { logger } from "../../lib/logger";
import { getCachedSettings } from "../../lib/cache";
import { maskPhone } from "../../lib/pii-mask";

const router = Router();
router.use(tenantMiddleware);

router.get("/", async (req, res) => {
  const query = ListConversationsQueryParams.safeParse(req.query);
  const status = query.success ? query.data.status : undefined;
  const contactType = query.success ? query.data.contactType : undefined;

  const conditions = [eq(dentalConversationsTable.tenantId, req.tenantId)];
  if (status) conditions.push(eq(dentalConversationsTable.status, status));
  if (contactType) conditions.push(eq(dentalConversationsTable.contactType, contactType));

  const rows = await db.query.dentalConversationsTable.findMany({
    where: and(...conditions),
    orderBy: [desc(dentalConversationsTable.lastMessageAt)],
  });
  res.json(rows);
});

router.get("/:conversationId", async (req, res) => {
  const { conversationId } = GetConversationParams.parse(req.params);
  const conv = await db.query.dentalConversationsTable.findFirst({ where: and(eq(dentalConversationsTable.id, conversationId), eq(dentalConversationsTable.tenantId, req.tenantId)) });
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

  const [messages, lastAudit] = await Promise.all([
    db.query.dentalMessagesTable.findMany({
      where: and(
        eq(dentalMessagesTable.conversationId, conversationId),
        ne(dentalMessagesTable.type, "merged_sibling"),
      ),
      orderBy: [desc(dentalMessagesTable.sentAt)],
      limit: 100,
    }),
    db.query.aiResponseAuditTable.findFirst({
      where: and(
        eq(aiResponseAuditTable.tenantId, req.tenantId),
        eq(aiResponseAuditTable.conversationId, conversationId),
      ),
      orderBy: [desc(aiResponseAuditTable.createdAt)],
    }).catch(() => null),
  ]);

  res.json({ ...conv, messages: messages.reverse(), lastModelUsed: lastAudit?.modelUsed ?? null });
});

router.get("/:conversationId/messages", async (req, res) => {
  const { conversationId } = ListMessagesParams.parse(req.params);
  const query = ListMessagesQueryParams.safeParse(req.query);
  const limit = query.success ? (query.data.limit ?? 50) : 50;
  const offset = query.success ? (query.data.offset ?? 0) : 0;

  const conv = await db.query.dentalConversationsTable.findFirst({ where: and(eq(dentalConversationsTable.id, conversationId), eq(dentalConversationsTable.tenantId, req.tenantId)) });
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

  const messages = await db.query.dentalMessagesTable.findMany({
    where: and(
      eq(dentalMessagesTable.conversationId, conversationId),
      ne(dentalMessagesTable.type, "merged_sibling"),
    ),
    orderBy: [desc(dentalMessagesTable.sentAt)],
    limit,
    offset,
  });

  res.json(messages.reverse());
});

router.post("/:conversationId/resume", async (req, res) => {
  const conversationId = Number(req.params.conversationId);
  const conv = await db.query.dentalConversationsTable.findFirst({ where: and(eq(dentalConversationsTable.id, conversationId), eq(dentalConversationsTable.tenantId, req.tenantId)) });
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
  if (conv.status !== "escalated" && conv.status !== "human_takeover") { res.json({ message: "Conversation is already open" }); return; }

  await db.update(dentalConversationsTable).set({
    status: "open",
    escalatedAt: null,
    escalationReason: null,
    humanTakeoverAt: null,
    humanTakeoverExpiresAt: null,
    sentimentScore: 0,
    sentiment: "neutral",
  }).where(eq(dentalConversationsTable.id, conversationId));

  res.json({ message: "Conversation resumed — AI is active again" });
});

router.post("/:conversationId/takeover", async (req, res) => {
  const conversationId = Number(req.params.conversationId);
  const conv = await db.query.dentalConversationsTable.findFirst({ where: and(eq(dentalConversationsTable.id, conversationId), eq(dentalConversationsTable.tenantId, req.tenantId)) });
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

  const settings = await getCachedSettings(req.tenantId);
  const takeoverMinutes = settings?.humanTakeoverMinutes ?? 5;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + takeoverMinutes * 60 * 1000);

  await db.update(dentalConversationsTable).set({
    status: "human_takeover",
    humanTakeoverAt: now,
    humanTakeoverExpiresAt: expiresAt,
  }).where(eq(dentalConversationsTable.id, conversationId));

  logger.info({ tenantId: req.tenantId, conversationId, takeoverMinutes }, "Human takeover activated via panel");

  if (settings?.telegramEscalationEnabled && settings?.telegramBotToken && settings?.telegramChatId) {
    try {
      const { sendTelegramMessage, escapeHtml } = await import("../../lib/telegram");
      const contactName = conv.contactName || conv.contactPhone;
      const msg = `👨‍⚕️ <b>Dentista assumiu conversa</b>\n\n👤 <b>${escapeHtml(contactName)}</b>\n📱 ${escapeHtml(conv.contactPhone)}\n\n⏱ IA pausada por ${takeoverMinutes} min\n📋 A IA retomara automaticamente apos o tempo expirar.\n\n⏰ ${now.toLocaleString("pt-BR")}`;
      await sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, msg);
    } catch (err) {
      logger.error({ err }, "Failed to send takeover Telegram notification");
    }
  }

  res.json({ message: "Human takeover activated", expiresAt: expiresAt.toISOString(), takeoverMinutes });
});

router.post("/:conversationId/messages", async (req, res) => {
  const { conversationId } = SendMessageParams.parse(req.params);
  const body = SendMessageBody.parse(req.body);

  const conv = await db.query.dentalConversationsTable.findFirst({ where: and(eq(dentalConversationsTable.id, conversationId), eq(dentalConversationsTable.tenantId, req.tenantId)) });
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

  const message = await insertChainedMessage({
    tenantId: req.tenantId,
    conversationId,
    direction: "outbound",
    type: body.type || "text",
    content: body.content,
  });

  await db.update(dentalConversationsTable).set({
    lastMessageAt: new Date(),
    lastMessagePreview: body.content?.substring(0, 100),
  }).where(eq(dentalConversationsTable.id, conversationId));

  const { provider, instanceName } = await getProviderForTenant(req.tenantId).catch((err) => {
    logger.error({ err, tenantId: req.tenantId }, "Failed to get WhatsApp provider for tenant");
    return { provider: null, instanceName: "" };
  });
  if (provider && body.content) {
    await provider.sendMessage(conv.contactPhone, body.content, instanceName).catch((err) => {
      logger.error({ err, phone: maskPhone(conv.contactPhone) }, "Failed to send WhatsApp message");
    });
  }

  res.status(201).json(message);
});

export default router;
