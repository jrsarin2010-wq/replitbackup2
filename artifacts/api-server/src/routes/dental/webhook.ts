import { Router } from "express";
import { db } from "@workspace/db";
import { tenantsTable, dentalConversationsTable, dentalMessagesTable, dentalLeadsTable, patientsTable, dentalSettingsTable, appointmentsTable, dentalProfessionalsTable, dentalPortfolioItemsTable } from "@workspace/db";
import { eq, and, sql, desc, isNotNull, inArray, notInArray } from "drizzle-orm";
import axios from "axios";
import { decryptTenantKeys } from "../../lib/tenant-helpers";
import { processIncomingMessage, transcribeAudio, analyzeImage, analyzePIXReceipt } from "../../lib/ai-engine";
import { getProviderForTenant, WhatsappProvider } from "../../lib/whatsapp-provider";
import { logger } from "../../lib/logger";
import { textToSpeech, countCharacters, resolveElevenLabsKey, normalizeTtsText } from "../../lib/elevenlabs";
import { cartesiaTTS, resolveCartesiaKey, getDefaultCartesiaVoiceId } from "../../lib/cartesia";
import { sanitizePushName } from "../../lib/contact-utils";
import { checkAndDeductCredits, refundCredits, getAudioCreditStatus } from "../../lib/credit-manager";
import { checkLowCreditsAlert } from "../../lib/credit-alerts";
import { runPostConversationLearning } from "../../lib/ai-learning";
import { getCachedSettings } from "../../lib/cache";
import { analyzeMessageSentiment, updateConversationSentiment, handleSmartEscalation } from "../../lib/ai-sentiment";
import { markMessageAsProcessed, resetPollingCache } from "../../lib/message-polling";
import { maskPhone, maskName, maskJid } from "../../lib/pii-mask";
import { sendTelegramMessage, buildProviderRedeliveryAlertMessage } from "../../lib/telegram";
import { insertChainedMessage } from "../../lib/audit-chain";

import { getRedis } from "../../lib/redis";

const router = Router();

const DEDUP_TTL_SEC = 120;
const recentlyProcessedMessages = new Map<string, number>();
const DEDUP_TTL_MS = DEDUP_TTL_SEC * 1000;

// ── Provider re-delivery alert config ───────────────────────────────────────
const DEDUP_ALERT_THRESHOLD = (() => {
  const v = Number(process.env["DEDUP_ALERT_THRESHOLD"]);
  return Number.isFinite(v) && v > 0 ? v : 5;
})();
const DEDUP_ALERT_WINDOW_SEC = (() => {
  const v = Number(process.env["DEDUP_ALERT_WINDOW_SEC"]);
  return Number.isFinite(v) && v > 0 ? v : 60;
})();
const DEDUP_ALERT_COOLDOWN_SEC = (() => {
  const v = Number(process.env["DEDUP_ALERT_COOLDOWN_SEC"]);
  return Number.isFinite(v) && v > 0 ? v : 300;
})();

interface DedupHitEntry {
  timestamps: number[];
  lastAlertAt: number;
}
const dedupHitTracker = new Map<number, DedupHitEntry>();

async function trackDedupFallbackAndMaybeAlert(tenantId: number, messageId: string): Promise<void> {
  const now = Date.now();
  const windowMs = DEDUP_ALERT_WINDOW_SEC * 1000;
  const cooldownMs = DEDUP_ALERT_COOLDOWN_SEC * 1000;

  let entry = dedupHitTracker.get(tenantId);
  if (!entry) {
    entry = { timestamps: [], lastAlertAt: 0 };
    dedupHitTracker.set(tenantId, entry);
  }

  entry.timestamps.push(now);
  entry.timestamps = entry.timestamps.filter(ts => now - ts <= windowMs);

  const hitCount = entry.timestamps.length;

  if (hitCount >= DEDUP_ALERT_THRESHOLD && now - entry.lastAlertAt >= cooldownMs) {
    entry.lastAlertAt = now;
    logger.warn(
      { tenantId, messageId, hitCount, windowSec: DEDUP_ALERT_WINDOW_SEC, threshold: DEDUP_ALERT_THRESHOLD },
      "Webhook: DB dedup fallback rate exceeded threshold — provider may be unstable"
    );

    try {
      const settings = await getCachedSettings(tenantId);
      if (
        settings?.telegramEscalationEnabled &&
        settings.telegramBotToken &&
        settings.telegramChatId
      ) {
        const clinicName = settings.clinicName ?? `Clínica #${tenantId}`;
        const msg = buildProviderRedeliveryAlertMessage(
          tenantId,
          clinicName,
          hitCount,
          DEDUP_ALERT_WINDOW_SEC,
          DEDUP_ALERT_THRESHOLD,
        );
        void sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, msg);
      }
    } catch (err) {
      logger.warn({ err, tenantId }, "Webhook: failed to send provider re-delivery Telegram alert");
    }
  }
}
// ─────────────────────────────────────────────────────────────────────────────

function hashStringToInt(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 2147483647;
}

async function findPortfolioMatch(
  tenantId: number,
  professionalId: number | null | undefined,
  userMessage: string
): Promise<{ mediaUrl: string; caption: string | null } | null> {
  if (!userMessage.trim()) return null;
  const conditions = [
    eq(dentalPortfolioItemsTable.tenantId, tenantId),
    eq(dentalPortfolioItemsTable.active, true),
  ];
  if (professionalId) {
    conditions.push(eq(dentalPortfolioItemsTable.professionalId, professionalId));
  }
  const items = await db
    .select({ mediaUrl: dentalPortfolioItemsTable.mediaUrl, keywords: dentalPortfolioItemsTable.keywords, caption: dentalPortfolioItemsTable.caption })
    .from(dentalPortfolioItemsTable)
    .where(and(...conditions));

  const msgLower = userMessage.toLowerCase();
  for (const item of items) {
    if (!item.keywords) continue;
    const kws = item.keywords.split(/[,;\n]+/).map((k) => k.trim().toLowerCase()).filter(Boolean);
    if (kws.some((kw) => kw && msgLower.includes(kw))) {
      return { mediaUrl: item.mediaUrl, caption: item.caption };
    }
  }
  return null;
}

async function findPortfolioByKeyword(
  tenantId: number,
  professionalId: number | null | undefined,
  keyword: string
): Promise<{ mediaUrl: string; caption: string | null } | null> {
  if (!keyword.trim()) return null;
  const conditions = [
    eq(dentalPortfolioItemsTable.tenantId, tenantId),
    eq(dentalPortfolioItemsTable.active, true),
  ];
  if (professionalId) {
    conditions.push(eq(dentalPortfolioItemsTable.professionalId, professionalId));
  }
  const items = await db
    .select({ mediaUrl: dentalPortfolioItemsTable.mediaUrl, keywords: dentalPortfolioItemsTable.keywords, caption: dentalPortfolioItemsTable.caption })
    .from(dentalPortfolioItemsTable)
    .where(and(...conditions));

  const kwLower = keyword.trim().toLowerCase();
  for (const item of items) {
    if (!item.keywords) continue;
    const kws = item.keywords.split(/[,;\n]+/).map((k) => k.trim().toLowerCase()).filter(Boolean);
    if (kws.some((kw) => kw && (kw === kwLower || kw.includes(kwLower) || kwLower.includes(kw)))) {
      return { mediaUrl: item.mediaUrl, caption: item.caption };
    }
  }
  return null;
}


const ABBREVIATIONS: [RegExp, string][] = [
  [/\bDr\./g, "Dr\u2060"],
  [/\bDra\./g, "Dra\u2060"],
  [/\bSr\./g, "Sr\u2060"],
  [/\bSra\./g, "Sra\u2060"],
  [/\bProf\./g, "Prof\u2060"],
  [/\bProfa\./g, "Profa\u2060"],
  [/\bEsp\./g, "Esp\u2060"],
  [/\betc\./g, "etc\u2060"],
  [/\bn\u00ba\./gi, "n\u00ba\u2060"],
];

function protectAbbreviations(s: string): string {
  let r = s;
  for (const [pattern, replacement] of ABBREVIATIONS) r = r.replace(pattern, replacement);
  return r;
}

function restoreAbbreviations(s: string): string {
  return s.replace(/\u2060/g, ".");
}

const TRAILING_ABBREV_RE = /\b(Dr|Dra|Sr|Sra|Prof|Profa|Esp)\.$/;

function mergeTrailingAbbreviations(chunks: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (TRAILING_ABBREV_RE.test(chunk) && i + 1 < chunks.length) {
      chunks[i + 1] = chunk + " " + chunks[i + 1];
    } else {
      result.push(chunk);
    }
  }
  return result;
}

// Tempo de digitacao realista no WhatsApp.
// Pessoa comum digita ~55 char/s no celular (mais rapido que antes calibrado).
// Min curto pra mensagens curtas nao parecerem travadas; max contido pra
// nao prender o paciente esperando.
function typingDelay(text: string): number {
  const CHARS_PER_SECOND = 55;
  const MIN_MS = 1500;
  const MAX_MS = 12000;
  const ms = (text.length / CHARS_PER_SECOND) * 1000;
  return Math.min(Math.max(ms, MIN_MS), MAX_MS);
}

function typingDelayBetweenParts(text: string): number {
  const CHARS_PER_SECOND = 55;
  const MIN_MS = 1200;
  const MAX_MS = 5000;
  const ms = (text.length / CHARS_PER_SECOND) * 1000;
  return Math.min(Math.max(ms, MIN_MS), MAX_MS);
}

async function sleepWithComposing(
  ms: number,
  sendComposing: () => void,
): Promise<void> {
  const RENEWAL_INTERVAL = 4000;
  const end = Date.now() + ms;
  sendComposing();
  while (Date.now() < end) {
    const remaining = end - Date.now();
    await new Promise(resolve => setTimeout(resolve, Math.min(RENEWAL_INTERVAL, remaining)));
    if (Date.now() < end) {
      sendComposing();
    }
  }
}

// Divide a resposta da IA em varias mensagens curtas estilo "humano no
// WhatsApp". Estrategia em camadas:
// 1) Se a IA ja usou \n\n entre ideias (formato preferido instruido no
//    prompt), respeitamos esses paragrafos como mensagens separadas.
// 2) Se veio um paragrafo unico mas com 2+ frases, dividimos por sentenca
//    — agora a partir de 120 chars (antes 250), pra realmente quebrar
//    respostas como "Oi! Tudo bem? Como posso te ajudar?".
// 3) Quebra dura por tamanho como ultimo recurso.
function splitIntoHumanMessages(text: string): string[] {
  const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);

  if (paragraphs.length >= 2 && paragraphs.length <= 5) {
    return mergeTrailingAbbreviations(paragraphs);
  }

  if (paragraphs.length <= 1) {
    const fullText = text.trim();
    // Threshold reduzido (250 -> 120). Mensagens muito curtas (uma frase
    // sozinha) ficam inteiras; o resto e quebrado por sentenca.
    if (fullText.length <= 120) return [fullText];

    const protected_ = protectAbbreviations(fullText);
    const sentences = protected_.match(/[^.!?]*[.!?]+[\s]*/g) || [protected_];
    // Se o texto so tem 1 sentenca detectada, retorna como esta.
    if (sentences.length <= 1) return [fullText];

    // Acumula sentencas em mensagens curtas (~80-160 chars). Antes era 220,
    // o que ainda agrupava 2-3 frases na mesma mensagem.
    const chunks: string[] = [];
    let current = "";
    const TARGET = 160;
    for (const s of sentences) {
      if (current && (current + s).length > TARGET) {
        chunks.push(restoreAbbreviations(current.trim()));
        current = s;
      } else {
        current += s;
      }
    }
    if (current.trim()) chunks.push(restoreAbbreviations(current.trim()));
    return mergeTrailingAbbreviations(chunks.length > 0 ? chunks : [fullText]);
  }

  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current && (current + "\n\n" + p).length > 280) {
      chunks.push(current.trim());
      current = p;
    } else {
      current = current ? current + "\n\n" + p : p;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return mergeTrailingAbbreviations(chunks);
}

async function persistSiblingExternalIds(
  tenantId: number,
  conversationId: number,
  siblingIds: string[],
): Promise<number> {
  if (siblingIds.length === 0) return 0;
  let inserted = 0;
  for (const sid of siblingIds) {
    try {
      const existing = await db.query.dentalMessagesTable.findFirst({
        where: and(eq(dentalMessagesTable.tenantId, tenantId), eq(dentalMessagesTable.externalId, sid)),
        columns: { id: true },
      });
      if (existing) continue;
      await insertChainedMessage({
        tenantId,
        conversationId,
        direction: "inbound",
        type: "merged_sibling",
        content: "",
        externalId: sid,
      });
      inserted++;
    } catch (err) {
      logger.warn({ err, tenantId, conversationId, sid }, "Webhook: failed to persist sibling externalId placeholder");
    }
  }
  if (inserted > 0) {
    logger.info({ tenantId, conversationId, inserted, total: siblingIds.length }, "Webhook: persisted merged-sibling externalIds for dedup durability");
  }
  return inserted;
}

async function isDuplicateMessage(
  messageId: string,
  tenantId: number,
  siblingExternalIds: string[] = [],
): Promise<boolean> {
  const now = Date.now();
  const redisKey = `dedup:webhook:${messageId}`;

  // Layer 1: in-memory cache
  for (const [id, ts] of recentlyProcessedMessages) {
    if (now - ts > DEDUP_TTL_MS) recentlyProcessedMessages.delete(id);
  }
  if (recentlyProcessedMessages.has(messageId)) return true;
  // Also check any sibling IDs in memory cache
  for (const sid of siblingExternalIds) {
    if (recentlyProcessedMessages.has(sid)) {
      recentlyProcessedMessages.set(messageId, now);
      return true;
    }
  }

  // Layer 2: Redis existence check (does NOT set the key yet)
  const redis = getRedis();
  if (redis) {
    try {
      const exists = await redis.exists(redisKey);
      if (exists === 1) {
        recentlyProcessedMessages.set(messageId, now);
        return true;
      }
    } catch {
    }
  }

  // Layer 3: DB fallback — catches re-deliveries after Redis TTL has expired.
  // Also checks siblingExternalIds so that re-delivered sibling-ID events
  // (same underlying WhatsApp message, different Evolution API IDs) are
  // correctly discarded even after the Redis TTL has expired.
  try {
    const allIds = siblingExternalIds.length > 0
      ? [messageId, ...siblingExternalIds]
      : [messageId];

    const inDb = await db.query.dentalMessagesTable.findFirst({
      where: and(
        eq(dentalMessagesTable.tenantId, tenantId),
        inArray(dentalMessagesTable.externalId, allIds),
      ),
      columns: { id: true },
    });
    if (inDb) {
      recentlyProcessedMessages.set(messageId, now);
      if (redis) {
        try {
          await redis.set(redisKey, "1", "EX", DEDUP_TTL_SEC);
        } catch {
        }
      }
      logger.info({ messageId, siblingCount: siblingExternalIds.length, tenantId }, "Webhook: duplicate detected via DB fallback — skipping reprocessing");
      void trackDedupFallbackAndMaybeAlert(tenantId, messageId);
      return true;
    }
  } catch (err) {
    logger.warn({ err, messageId, tenantId }, "Webhook: DB dedup fallback check failed — treating as unprocessed");
  }

  // New message — claim it in Redis and memory, then allow processing
  if (redis) {
    try {
      await redis.set(redisKey, "1", "EX", DEDUP_TTL_SEC, "NX");
    } catch {
    }
  }
  recentlyProcessedMessages.set(messageId, now);
  void markMessageAsProcessed(messageId);
  return false;
}

const INSTAGRAM_CARD_MARKER = "[INSTAGRAM_CARD]";
const PORTFOLIO_ITEM_MARKER_RE = /\[PORTFOLIO_ITEM:([^\]]+)\]/i;
const APT_CARD_MARKER_RE = /\[APT_CARD:\s*([^\]]+)\]/i;
const APT_CANCEL_MARKER_RE = /\[APT_CANCEL\]/i;

const PRIVATE_IP_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
  /^0\./,
];

function isSafeImageUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  const hostname = parsed.hostname.toLowerCase();
  if (PRIVATE_IP_PATTERNS.some((re) => re.test(hostname))) return false;
  if (hostname === "metadata.google.internal") return false;
  if (hostname.endsWith(".internal") || hostname.endsWith(".local")) return false;
  return true;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];

async function sendInstagramCard(
  provider: WhatsappProvider,
  replyToJid: string,
  instanceName: string,
  profName: string,
  instagramUrl: string,
  profilePhotoUrl: string | null | undefined
): Promise<void> {
  const caption = `*${profName}*\nVer resultados reais 👇\n${instagramUrl}`;
  if (profilePhotoUrl) {
    try {
      if (!isSafeImageUrl(profilePhotoUrl)) {
        throw new Error("Unsafe or invalid profile photo URL — skipping fetch");
      }
      const { default: sharp } = await import("sharp");
      const axios_ = (await import("axios")).default;
      const response = await axios_.get(profilePhotoUrl, {
        responseType: "arraybuffer",
        timeout: 8000,
        maxRedirects: 3,
        maxContentLength: MAX_IMAGE_BYTES,
        validateStatus: (status) => status >= 200 && status < 300,
      });
      const contentType: string = (response.headers["content-type"] as string) || "";
      const mimeBase = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
      if (!ALLOWED_IMAGE_MIME.some((m) => mimeBase.startsWith(m))) {
        throw new Error(`Unexpected content-type for profile photo: ${contentType}`);
      }
      const rawBuffer = Buffer.from(response.data as ArrayBuffer);
      if (rawBuffer.length > MAX_IMAGE_BYTES) {
        throw new Error("Profile photo exceeds max allowed size");
      }
      const thumbnailBuffer = await sharp(rawBuffer)
        .resize(300, 300, { fit: "cover" })
        .jpeg({ quality: 80 })
        .toBuffer();
      const base64 = thumbnailBuffer.toString("base64");
      await provider.sendImageBase64(replyToJid, base64, caption, instanceName);
      logger.info({ replyToJid: maskJid(replyToJid), instagramUrl }, "Instagram card sent with thumbnail");
      return;
    } catch (err) {
      logger.warn({ err, replyToJid: maskJid(replyToJid) }, "Failed to send Instagram thumbnail, falling back to text");
    }
  }
  await provider.sendMessage(replyToJid, caption, instanceName);
}

interface InstagramCardExtraction {
  textBefore: string;
  textAfter: string;
  instagramProfessional: Array<{ name: string; instagramUrl?: string | null; profilePhotoUrl?: string | null; isOwner: boolean; id: number }>[number] | null;
}

function extractInstagramCardFromReply(
  reply: string,
  professionals: Array<{ name: string; instagramUrl?: string | null; profilePhotoUrl?: string | null; isOwner: boolean; id: number }>,
  leadProfessionalId?: number | null
): InstagramCardExtraction {
  let prof: typeof professionals[number] | null = null;
  if (leadProfessionalId) {
    prof = professionals.find((p) => p.id === leadProfessionalId && p.instagramUrl) || null;
  }
  if (!prof) prof = professionals.find((p) => p.isOwner && p.instagramUrl) || null;
  if (!prof) prof = professionals.find((p) => p.instagramUrl) || null;

  if (reply.includes(INSTAGRAM_CARD_MARKER)) {
    const markerIdx = reply.indexOf(INSTAGRAM_CARD_MARKER);
    const textBefore = reply.substring(0, markerIdx).trim();
    const textAfter = reply.substring(markerIdx + INSTAGRAM_CARD_MARKER.length).trim();
    return { textBefore, textAfter, instagramProfessional: prof };
  }

  if (prof && prof.instagramUrl) {
    const instagramUrlPattern = /https?:\/\/(www\.)?instagram\.com\/[\w.]+\/?/gi;
    const hasInstagramUrl = instagramUrlPattern.test(reply);

    if (hasInstagramUrl) {
      const cleanedText = reply
        .replace(/https?:\/\/(www\.)?instagram\.com\/[\w.]+\/?/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      logger.info({ instagramUrl: prof.instagramUrl }, "Instagram URL detected in AI reply — intercepting for card send");
      return { textBefore: cleanedText, textAfter: "", instagramProfessional: prof };
    }
  }

  return { textBefore: reply, textAfter: "", instagramProfessional: null };
}

function detectProviderFormat(body: Record<string, unknown>): "evolution" | "uazapi" {
  const event = String(body.event || "");
  const data = (body.data as Record<string, unknown>) || {};
  if (event === "messages" || event === "connection") return "uazapi";
  if (event === "messages.upsert" || event === "MESSAGES_UPSERT" || event === "connection.update" || event === "CONNECTION_UPDATE") return "evolution";
  if (data && typeof data === "object" && !data.key && (data.messageid || data.chatid)) return "uazapi";
  return "evolution";
}

function normalizeUazapiPayload(body: Record<string, unknown>): Record<string, unknown> {
  const event = String(body.event || "");
  const data = (body.data as Record<string, unknown>) || {};

  if (event === "connection") {
    const status = String((data.status as string) || "").toLowerCase();
    let normalizedState = status;
    if (status === "connected") normalizedState = "open";
    else if (status === "disconnected" || status === "closed" || status === "loggedout" || status === "logged_out") normalizedState = "close";
    return {
      event: "connection.update",
      instance: body.instance,
      data: { state: normalizedState, ...data },
    };
  }

  if (event === "messages") {
    const messageType = String(data.messageType || "");
    const text = String(data.text || "");
    const fromMe = data.fromMe === true;
    const chatid = String(data.chatid || data.sender || "");
    const messageid = String(data.messageid || data.id || "");
    const senderName = String(data.senderName || data.pushName || "");
    const messageTimestamp = typeof data.messageTimestamp === "number"
      ? Math.floor((data.messageTimestamp as number) > 1e12 ? (data.messageTimestamp as number) / 1000 : (data.messageTimestamp as number))
      : Math.floor(Date.now() / 1000);

    const message: Record<string, unknown> = {};
    const lowerType = messageType.toLowerCase();
    if (lowerType.includes("audio") || lowerType === "ptt" || lowerType === "audiomessage") {
      message.audioMessage = {
        mimetype: data.mimetype || "audio/ogg",
        url: data.fileURL || data.fileUrl || "",
        base64: data.base64Data || data.base64 || "",
      };
    } else if (lowerType.includes("image") || lowerType === "imagemessage") {
      message.imageMessage = {
        mimetype: data.mimetype || "image/jpeg",
        url: data.fileURL || data.fileUrl || "",
        base64: data.base64Data || data.base64 || "",
        caption: data.text || data.caption || "",
      };
    } else if (lowerType.includes("video") || lowerType === "videomessage") {
      message.videoMessage = {
        mimetype: data.mimetype || "video/mp4",
        url: data.fileURL || data.fileUrl || "",
        base64: data.base64Data || data.base64 || "",
        caption: data.text || data.caption || "",
      };
    } else if (text) {
      message.conversation = text;
    }

    return {
      event: "messages.upsert",
      instance: body.instance,
      data: {
        key: { id: messageid, remoteJid: chatid, fromMe },
        pushName: senderName,
        message,
        messageTimestamp,
        messageType: messageType || (text ? "conversation" : "unknown"),
      },
    };
  }

  return body;
}

function extractMessageContent(messageContent: Record<string, unknown>): {
  text: string;
  mediaType: "text" | "audio" | "image" | null;
  mimetype: string;
  mediaUrl: string;
  mediaBase64: string;
  caption: string;
} {
  const text = String(
    (messageContent.conversation as string) ||
    (messageContent.extendedTextMessage as Record<string, unknown>)?.text ||
    ""
  );

  const audioMsg = (messageContent.audioMessage as Record<string, unknown>) || null;
  if (audioMsg) {
    return {
      text: "",
      mediaType: "audio",
      mimetype: String(audioMsg.mimetype || "audio/ogg"),
      mediaUrl: String(audioMsg.url || ""),
      mediaBase64: String(audioMsg.base64 || ""),
      caption: "",
    };
  }

  const imageMsg = (messageContent.imageMessage as Record<string, unknown>) || null;
  if (imageMsg) {
    return {
      text: "",
      mediaType: "image",
      mimetype: String(imageMsg.mimetype || "image/jpeg"),
      mediaUrl: String(imageMsg.url || ""),
      mediaBase64: String(imageMsg.base64 || ""),
      caption: String(imageMsg.caption || ""),
    };
  }

  return { text, mediaType: text ? "text" : null, mimetype: "", mediaUrl: "", mediaBase64: "", caption: "" };
}

router.post("/whatsapp", async (req, res) => {
  let messageId = "";
  let advisoryLockKey: number | null = null;
  try {
    const webhookToken = req.headers["x-webhook-token"] || req.query.token;
    const expectedToken = process.env.WEBHOOK_SECRET;
    if (expectedToken && webhookToken !== expectedToken) {
      logger.warn({ token: webhookToken ? "provided" : "missing" }, "Webhook: invalid or missing authentication token");
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const rawBody = req.body as Record<string, unknown>;
    const providerFormat: "evolution" | "uazapi" = detectProviderFormat(rawBody);
    const body = providerFormat === "uazapi" ? normalizeUazapiPayload(rawBody) : rawBody;
    const event = (body.event as string) || "";
    const instanceName = (body.instance as string) || "";
    const data = (body.data as Record<string, unknown>) || {};

    logger.info({ event, instanceName, providerFormat, bodyKeys: Object.keys(body) }, "Webhook: raw event received");

    if (event === "connection.update" || event === "CONNECTION_UPDATE") {
      const connectionState = String((data.state as string) || (data.connection as string) || "").toLowerCase();
      logger.info({ event, instanceName, state: connectionState }, "Webhook: connection state update");
      if (connectionState === "open") {
        resetPollingCache();
        const matchCol = providerFormat === "uazapi" ? tenantsTable.uazapiInstanceId : tenantsTable.evolutionInstanceName;
        await db.update(tenantsTable)
          .set({ whatsappConnected: "true" })
          .where(eq(matchCol, instanceName));
        logger.info({ instanceName, providerFormat }, "Webhook: WhatsApp connected — polling cache reset, ready to process new messages");
      } else if (connectionState === "close" || connectionState === "closed") {
        logger.info({ instanceName, providerFormat }, "Webhook: WhatsApp disconnected");
      }
      res.json({ ok: true });
      return;
    }

    const isMessageEvent = event === "messages.upsert" || event === "MESSAGES_UPSERT" || event.toLowerCase().includes("messages");
    if (!isMessageEvent) {
      res.json({ ok: true });
      return;
    }

    const key = (data.key as Record<string, unknown>) || {};
    const fromMe = key.fromMe === true;

    const tenant = providerFormat === "uazapi"
      ? (await db.query.tenantsTable.findFirst({ where: eq(tenantsTable.uazapiInstanceId, instanceName) }))
        || await db.query.tenantsTable.findFirst({ where: eq(tenantsTable.evolutionInstanceName, instanceName) })
      : (await db.query.tenantsTable.findFirst({ where: eq(tenantsTable.evolutionInstanceName, instanceName) })
        || await db.query.tenantsTable.findFirst({ where: eq(tenantsTable.slug, instanceName.replace("dental-", "")) }));

    if (!tenant) {
      logger.warn({ instanceName }, "Webhook: tenant not found for instance");
      res.json({ ok: true });
      return;
    }

    const tenantId = tenant.id;

    if (fromMe) {
      const rawJidFm = String(key.remoteJid || "");
      if (rawJidFm && !rawJidFm.includes("@g.us")) {
        handleHumanTakeover(tenantId, rawJidFm).catch((err) =>
          logger.error({ err, tenantId }, "Human takeover handling failed"),
        );
      }
      res.json({ ok: true });
      return;
    }

    const rawJid = String(key.remoteJid || "");
    if (!rawJid || rawJid.includes("@g.us")) {
      res.json({ ok: true });
      return;
    }

    const isLid = rawJid.includes("@lid");
    const lidId = isLid ? rawJid.replace("@lid", "") : null;
    let contactPhone = rawJid.replace("@s.whatsapp.net", "").replace("@lid", "");
    let replyToJid = rawJid;
    const pushName = sanitizePushName(String((data.pushName as string) || ""));
    const messageContent = (data.message as Record<string, unknown>) || {};
    messageId = String(key.id || "");

    const siblingExternalIds: string[] = (() => {
      const raw = (body as Record<string, unknown>).siblingExternalIds;
      if (!Array.isArray(raw)) return [];
      const out: string[] = [];
      for (const v of raw) {
        if (typeof v === "string" && v && v !== messageId) out.push(v);
      }
      return out;
    })();

    if (messageId && await isDuplicateMessage(messageId, tenantId, siblingExternalIds)) {
      logger.debug({ messageId, siblingCount: siblingExternalIds.length }, "Webhook: skipping duplicate message (in-process)");
      res.json({ ok: true });
      return;
    }

    if (isLid) {
      const remoteJidAlt = String(key.remoteJidAlt || "");
      const participant = String(key.participant || data.participant || "");
      const sender = String((data as Record<string, unknown>).sender || "");

      if (remoteJidAlt && remoteJidAlt.includes("@s.whatsapp.net")) {
        contactPhone = remoteJidAlt.replace("@s.whatsapp.net", "");
        logger.info({ lid: lidId, contactPhone: maskPhone(contactPhone) }, "Webhook: resolved real phone from remoteJidAlt");
      } else if (participant && participant.includes("@s.whatsapp.net")) {
        contactPhone = participant.replace("@s.whatsapp.net", "");
        logger.info({ lid: lidId, contactPhone: maskPhone(contactPhone) }, "Webhook: resolved real phone from participant");
      } else if (sender && sender.includes("@s.whatsapp.net")) {
        contactPhone = sender.replace("@s.whatsapp.net", "");
        logger.info({ lid: lidId, contactPhone: maskPhone(contactPhone) }, "Webhook: resolved real phone from sender");
      } else {
        logger.warn({ lid: lidId, remoteJidAlt: maskJid(remoteJidAlt), participant: maskJid(participant), sender: maskJid(sender) }, "Webhook: LID detected but could not resolve real phone number");
      }
      if (contactPhone && contactPhone !== lidId) {
        replyToJid = `${contactPhone}@s.whatsapp.net`;
        logger.info({ lid: lidId, contactPhone: maskPhone(contactPhone), replyToJid: maskJid(replyToJid) }, "Webhook: updated replyToJid to real phone JID for LID message");
      }
    }

    const phoneLog = maskPhone(contactPhone);
    const jidLog = maskJid(replyToJid);
    const nameLog = maskName(pushName);
    logger.info({ event, instanceName, contactPhone: phoneLog, replyToJid: jidLog, pushName: nameLog, isLid, hasMessage: !!Object.keys(messageContent).length }, "Webhook: processing incoming message");

    const { text, mediaType, mimetype, mediaBase64, caption } = extractMessageContent(messageContent);

    if (!text && !mediaType) {
      res.json({ ok: true });
      return;
    }

    res.json({ ok: true });

    if (messageId) {
      advisoryLockKey = hashStringToInt(`msg_${tenantId}_${messageId}`);
      const lockResult = await db.execute(sql`SELECT pg_try_advisory_lock(${advisoryLockKey}) as acquired`);
      const rows = (lockResult as { rows?: Array<{ acquired?: boolean }> }).rows ?? (lockResult as unknown as Array<{ acquired?: boolean }>);
      const acquired = rows?.[0]?.acquired;
      if (!acquired) {
        logger.info({ messageId, tenantId }, "Webhook: cross-process lock — another worker is processing this message, skipping");
        return;
      }

      const alreadyProcessed = await db.query.dentalMessagesTable.findFirst({
        where: and(eq(dentalMessagesTable.tenantId, tenantId), eq(dentalMessagesTable.externalId, messageId)),
        columns: { id: true },
      });
      if (alreadyProcessed) {
        if (siblingExternalIds.length > 0) {
          const existingConv = await db.query.dentalConversationsTable.findFirst({
            where: and(eq(dentalConversationsTable.tenantId, tenantId), eq(dentalConversationsTable.contactPhone, contactPhone)),
            columns: { id: true },
          });
          if (existingConv) {
            await persistSiblingExternalIds(tenantId, existingConv.id, siblingExternalIds);
          } else {
            logger.warn({ tenantId, messageId, siblingCount: siblingExternalIds.length }, "Webhook: cannot persist sibling externalIds — conversation not found for already-processed message");
          }
        }
        await db.execute(sql`SELECT pg_advisory_unlock(${advisoryLockKey})`).catch(() => {});
        advisoryLockKey = null;
        logger.debug({ messageId, tenantId }, "Webhook: DB dedup — message already processed, skipping");
        return;
      }
    }

    if (isLid && lidId && contactPhone !== lidId) {
      const lidVariants = [lidId, `${lidId}@lid`];
      for (const oldPhone of lidVariants) {
        const existingRealConv = await db.query.dentalConversationsTable.findFirst({
          where: and(eq(dentalConversationsTable.tenantId, tenantId), eq(dentalConversationsTable.contactPhone, contactPhone)),
        });
        const oldConv = await db.query.dentalConversationsTable.findFirst({
          where: and(eq(dentalConversationsTable.tenantId, tenantId), eq(dentalConversationsTable.contactPhone, oldPhone)),
        });
        if (oldConv) {
          if (existingRealConv) {
            await db.update(dentalMessagesTable)
              .set({ conversationId: existingRealConv.id })
              .where(eq(dentalMessagesTable.conversationId, oldConv.id));
            await db.delete(dentalConversationsTable).where(eq(dentalConversationsTable.id, oldConv.id));
            logger.info({ tenantId, oldPhone: maskPhone(oldPhone), newPhone: phoneLog, mergedIntoConvId: existingRealConv.id }, "Webhook: merged LID conversation into existing real-phone conversation");
          } else {
            await db.update(dentalConversationsTable)
              .set({ contactPhone })
              .where(eq(dentalConversationsTable.id, oldConv.id));
            logger.info({ tenantId, oldPhone: maskPhone(oldPhone), newPhone: phoneLog }, "Webhook: migrated conversation from LID to real phone");
          }
        }

        const existingRealLead = await db.query.dentalLeadsTable.findFirst({
          where: and(eq(dentalLeadsTable.tenantId, tenantId), eq(dentalLeadsTable.phone, contactPhone)),
        });
        const oldLead = await db.query.dentalLeadsTable.findFirst({
          where: and(eq(dentalLeadsTable.tenantId, tenantId), eq(dentalLeadsTable.phone, oldPhone)),
        });
        if (oldLead) {
          if (existingRealLead) {
            await db.delete(dentalLeadsTable).where(eq(dentalLeadsTable.id, oldLead.id));
            logger.info({ tenantId, oldPhone: maskPhone(oldPhone), newPhone: phoneLog, keptLeadId: existingRealLead.id }, "Webhook: deleted duplicate LID lead, kept real-phone lead");
          } else {
            await db.update(dentalLeadsTable)
              .set({ phone: contactPhone })
              .where(eq(dentalLeadsTable.id, oldLead.id));
            logger.info({ tenantId, oldPhone: maskPhone(oldPhone), newPhone: phoneLog }, "Webhook: migrated lead from LID to real phone");
          }
        }
      }
    }

    const [convResult, patient, leadResult] = await Promise.all([
      db.query.dentalConversationsTable.findFirst({
        where: and(eq(dentalConversationsTable.tenantId, tenantId), eq(dentalConversationsTable.contactPhone, contactPhone)),
      }),
      db.query.patientsTable.findFirst({
        where: and(eq(patientsTable.tenantId, tenantId), eq(patientsTable.phone, contactPhone)),
      }),
      db.query.dentalLeadsTable.findFirst({
        where: and(eq(dentalLeadsTable.tenantId, tenantId), eq(dentalLeadsTable.phone, contactPhone)),
      }),
    ]);
    let conversation = convResult;
    const lead = patient ? null : leadResult;

    const contactType = patient ? "patient" : lead ? "lead" : "unknown";
    const previewText = text || caption || (mediaType === "audio" ? "🎤 Áudio" : "📷 Foto");

    const existingPicUrl = conversation?.contactProfilePicUrl || patient?.profilePicUrl || lead?.profilePicUrl || null;

    if (!conversation) {
      const [newConv] = await db.insert(dentalConversationsTable).values({
        tenantId,
        contactPhone,
        contactName: pushName || contactPhone,
        contactProfilePicUrl: existingPicUrl,
        contactType,
        patientId: patient?.id,
        leadId: lead?.id,
        lastMessageAt: new Date(),
        lastMessagePreview: previewText.substring(0, 100),
      }).returning();
      conversation = newConv;
    } else {
      const convUpdate: Record<string, unknown> = {
        lastMessageAt: new Date(),
        lastMessagePreview: previewText.substring(0, 100),
        unreadCount: (conversation.unreadCount || 0) + 1,
        contactType,
        patientId: patient?.id || conversation.patientId,
        leadId: lead?.id || conversation.leadId,
      };
      if (existingPicUrl && !conversation.contactProfilePicUrl) {
        convUpdate.contactProfilePicUrl = existingPicUrl;
      }
      await db.update(dentalConversationsTable).set(convUpdate).where(eq(dentalConversationsTable.id, conversation.id));
    }

    if (!existingPicUrl) {
      (async () => {
        try {
          const { provider, instanceName: whatsappInstance } = await getProviderForTenant(tenantId);
          let picUrl = await provider.getProfilePicture(contactPhone, whatsappInstance);
          if (!picUrl && isLid) {
            picUrl = await provider.getProfilePicture(replyToJid, whatsappInstance);
          }
          if (!picUrl) return;
          await db.update(dentalConversationsTable).set({ contactProfilePicUrl: picUrl }).where(eq(dentalConversationsTable.id, conversation!.id));
          if (patient) {
            await db.update(patientsTable).set({ profilePicUrl: picUrl }).where(eq(patientsTable.id, patient.id));
          }
          if (lead) {
            await db.update(dentalLeadsTable).set({ profilePicUrl: picUrl }).where(eq(dentalLeadsTable.id, lead.id));
          }
          logger.info({ tenantId, contactPhone: phoneLog }, "Profile picture fetched and saved");
        } catch (err) {
          logger.debug({ err, contactPhone }, "Failed to fetch profile picture (non-critical)");
        }
      })();
    }

    let processedText = text;
    let mediaContext: { type: "audio_transcription" | "image_analysis"; description: string } | undefined;

    if (mediaType === "audio") {
      logger.info({ tenantId, contactPhone: phoneLog, mimetype }, "Webhook: processing audio message");

      let audioBuffer: Buffer | null = null;

      if (mediaBase64) {
        audioBuffer = Buffer.from(mediaBase64, "base64");
      } else {
        const { provider, instanceName: whatsappInstance } = await getProviderForTenant(tenantId).catch((err) => {
          logger.error({ err, tenantId }, "Failed to get WhatsApp provider for media download");
          return { provider: null, instanceName: "" };
        });
        if (provider && messageId) {
          audioBuffer = await provider.downloadMedia(messageId, whatsappInstance);
        }
      }

      if (audioBuffer) {
        try {
          const transcription = await transcribeAudio(audioBuffer);
          processedText = transcription;
          mediaContext = { type: "audio_transcription", description: transcription };
          logger.info({ tenantId, contactPhone: phoneLog, transcriptionLength: transcription.length }, "Webhook: audio transcribed successfully");
        } catch (err) {
          logger.error({ err, tenantId, contactPhone: phoneLog }, "Webhook: audio transcription failed");
          processedText = "[Audio recebido - nao foi possivel transcrever]";
        }
      } else {
        processedText = "[Audio recebido - nao foi possivel baixar a midia]";
      }

      await insertChainedMessage({
        tenantId,
        conversationId: conversation.id,
        direction: "inbound",
        type: "audio",
        content: processedText,
        externalId: messageId,
      });
    } else if (mediaType === "image") {
      logger.info({ tenantId, contactPhone: phoneLog, mimetype }, "Webhook: processing image message");

      let imageBase64Data: string | null = null;

      if (mediaBase64) {
        imageBase64Data = mediaBase64;
      } else {
        const { provider, instanceName: whatsappInstance } = await getProviderForTenant(tenantId).catch((err) => {
          logger.error({ err, tenantId }, "Failed to get WhatsApp provider for media download");
          return { provider: null, instanceName: "" };
        });
        if (provider && messageId) {
          const buf = await provider.downloadMedia(messageId, whatsappInstance);
          if (buf) imageBase64Data = buf.toString("base64");
        }
      }

      // Check if this contact has a pending PIX appointment
      const contactId = patient?.id || lead?.id || null;
      const contactIdType = patient ? "patient" : lead ? "lead" : null;
      let pendingPixAppointment: { id: number; professionalId: number | null; price: string | null } | null = null;
      if (contactId && contactIdType) {
        const whereConditions = [
          eq(appointmentsTable.tenantId, tenantId),
          eq(appointmentsTable.pixPaymentStatus, "pending"),
        ];
        if (contactIdType === "patient") {
          whereConditions.push(eq(appointmentsTable.patientId, contactId));
        } else {
          whereConditions.push(eq(appointmentsTable.leadId, contactId));
        }
        const pendingApt = await db.query.appointmentsTable.findFirst({
          where: and(...whereConditions),
          orderBy: [desc(appointmentsTable.createdAt)],
          columns: { id: true, professionalId: true, price: true },
        });
        if (pendingApt) {
          pendingPixAppointment = pendingApt;
        }
      }

      let imageAnalysis = "";
      if (imageBase64Data) {
        try {
          if (pendingPixAppointment) {
            // Fetch professional's PIX info for validation
            let profName: string | null = null;
            let pixKey: string | null = null;
            let expectedAmount: string | null = pendingPixAppointment.price;
            if (pendingPixAppointment.professionalId) {
              const prof = await db.query.dentalProfessionalsTable.findFirst({
                where: and(eq(dentalProfessionalsTable.id, pendingPixAppointment.professionalId), eq(dentalProfessionalsTable.tenantId, tenantId)),
                columns: { name: true, pixKey: true, consultationFee: true },
              });
              profName = prof?.name || null;
              pixKey = prof?.pixKey || null;
              if (!expectedAmount && prof?.consultationFee) {
                expectedAmount = prof.consultationFee;
              }
            }
            imageAnalysis = await analyzePIXReceipt(tenantId, imageBase64Data, mimetype, {
              pixKey: pixKey || undefined,
              expectedAmount: expectedAmount || undefined,
              recipientName: profName || undefined,
            });
            mediaContext = { type: "image_analysis", description: imageAnalysis };
            logger.info({ tenantId, contactPhone: phoneLog, appointmentId: pendingPixAppointment.id }, "Webhook: PIX receipt analyzed for pending appointment");

            // If the PIX was recognized, update the appointment status
            const isApproved = imageAnalysis.includes("[PIX_APROVADO]");
            if (isApproved) {
              await db.update(appointmentsTable)
                .set({ pixPaymentStatus: "confirmed_auto", status: "confirmed" })
                .where(eq(appointmentsTable.id, pendingPixAppointment.id));

              // Notify dentist via telegram if configured
              const settings = await getCachedSettings(tenantId);
              if (settings?.telegramBotToken && settings?.telegramChatId && settings?.telegramEscalationEnabled) {
                const { sendTelegramMessage } = await import("../../lib/telegram");
                const contactName = pushName || patient?.name || lead?.name || contactPhone;
                const msg = `✅ <b>Pagamento PIX Confirmado</b>\n\nPaciente: <b>${contactName}</b>\nConsulta confirmada automaticamente apos analise do comprovante.\nAgendamento ID: #${pendingPixAppointment.id}`;
                sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, msg).catch((err) => {
                  logger.warn({ err, tenantId }, "Failed to send PIX confirmation telegram notification");
                });
              }
            }
          } else {
            imageAnalysis = await analyzeImage(tenantId, imageBase64Data, mimetype);
            mediaContext = { type: "image_analysis", description: imageAnalysis };
          }
          logger.info({ tenantId, contactPhone: phoneLog, analysisLength: imageAnalysis.length }, "Webhook: image analyzed successfully");
        } catch (err) {
          logger.error({ err, tenantId, contactPhone: phoneLog }, "Webhook: image analysis failed");
          imageAnalysis = "Imagem recebida mas nao foi possivel analisar.";
        }
      } else {
        imageAnalysis = "Imagem recebida mas nao foi possivel baixar.";
      }

      processedText = caption || imageAnalysis;

      await insertChainedMessage({
        tenantId,
        conversationId: conversation.id,
        direction: "inbound",
        type: "image",
        content: caption ? `${caption}\n\n[Analise da imagem: ${imageAnalysis}]` : `[Analise da imagem: ${imageAnalysis}]`,
        externalId: messageId,
      });
    } else if (text) {
      await insertChainedMessage({
        tenantId,
        conversationId: conversation.id,
        direction: "inbound",
        type: "text",
        content: text,
        externalId: messageId,
      });
    }

    if (siblingExternalIds.length > 0) {
      await persistSiblingExternalIds(tenantId, conversation.id, siblingExternalIds);
    }

    if (processedText || mediaContext) {
      const sentimentResult = analyzeMessageSentiment(processedText || "");
      const sentimentCheck = await updateConversationSentiment(tenantId, conversation.id, sentimentResult);

      if (sentimentCheck.shouldEscalate) {
        logger.info({ tenantId, conversationId: conversation.id, reason: sentimentCheck.reason, sentiment: sentimentResult }, "Smart escalation triggered — AI paused");
        handleSmartEscalation(
          tenantId, conversation.id,
          pushName || patient?.name || lead?.name || contactPhone,
          contactPhone, processedText || "", "(IA pausada)", sentimentCheck.reason!,
          sentimentResult,
        ).catch((err) => logger.error({ err, tenantId }, "Smart escalation notification failed"));
        return;
      }

      const freshConv = await db.query.dentalConversationsTable.findFirst({
        where: eq(dentalConversationsTable.id, conversation.id),
      });
      if (freshConv?.status === "escalated") {
        logger.info({ tenantId, conversationId: conversation.id }, "Conversation is escalated — AI skipped");
        return;
      }
      // quota_blocked: quota was exhausted when this conversation was first attempted.
      // Re-check on each new message so it auto-unblocks after a recharge.
      if (freshConv?.status === "quota_blocked") {
        const { getConversationQuotaStatus, checkAndConsumeConversationQuota } = await import("../../lib/conversation-quota-manager");
        // Pre-check: if quota is still exhausted, keep the conversation blocked without
        // attempting to consume a quota unit.
        const quotaStatus = await getConversationQuotaStatus(tenantId).catch(() => null);
        if (!quotaStatus || quotaStatus.isExhausted) {
          // Still exhausted — silently skip (fallback message was already sent the first time)
          return;
        }
        // Quota available — force-consume 1 unit. The original blocked message is
        // already persisted in dental_messages, so without forceCharge the heuristic
        // would see priorCount≥1 and skip charging, allowing a free conversation.
        const recheckResult = await checkAndConsumeConversationQuota(tenantId, contactPhone, { forceCharge: true }).catch(() => null);
        if (!recheckResult?.allowed) {
          return;
        }
        // Quota consumed — unblock the conversation and fall through to AI
        await db.update(dentalConversationsTable).set({ status: "open" })
          .where(eq(dentalConversationsTable.id, conversation.id)).catch(() => {});
        logger.info({ tenantId, conversationId: conversation.id }, "Quota restored — conversation unblocked, AI resumed");
        // Fall through to AI — quota already consumed above; main check skipped via flag
      }
      // Flag set to true when quota was already consumed in the quota_blocked auto-unblock path
      const quotaAlreadyConsumed = freshConv?.status === "quota_blocked";
      if (freshConv?.status === "human_takeover") {
        if (freshConv.humanTakeoverExpiresAt && freshConv.humanTakeoverExpiresAt > new Date()) {
          logger.info({ tenantId, conversationId: conversation.id, expiresAt: freshConv.humanTakeoverExpiresAt }, "Conversation in human takeover — AI skipped");
          return;
        }
        await db.update(dentalConversationsTable).set({
          status: "open",
          humanTakeoverAt: null,
          humanTakeoverExpiresAt: null,
        }).where(eq(dentalConversationsTable.id, conversation.id));
        logger.info({ tenantId, conversationId: conversation.id }, "Human takeover expired — AI resumed");
      }

      const { isTenantCircuitOpen, checkTenantRateLimit, getFallbackMessage } = await import("../../lib/tenant-rate-limiter");

      const fallbackSettings = await getCachedSettings(tenantId);
      const fallbackClinicName = fallbackSettings?.clinicName || null;
      const fallbackAiName = fallbackSettings?.aiName || null;

      const circuitOpen = await isTenantCircuitOpen(tenantId);
      if (circuitOpen) {
        logger.warn({ tenantId, contactPhone: phoneLog }, "Webhook: circuit breaker open — skipping AI, sending fallback");
        const { provider: fbProvider, instanceName: fbInstance } = await getProviderForTenant(tenantId).catch(() => ({ provider: null, instanceName: "" }));
        if (fbProvider) {
          await fbProvider.sendMessage(replyToJid, getFallbackMessage("circuit_open", fallbackClinicName, fallbackAiName), fbInstance).catch((err: unknown) => {
            logger.error({ err, tenantId }, "Failed to send circuit-open fallback");
          });
        }
        return;
      }

      const ratePre = await checkTenantRateLimit(tenantId);
      if (!ratePre.allowed) {
        logger.warn({ tenantId, contactPhone: phoneLog, remaining: ratePre.remaining }, "Webhook: tenant AI rate limit exceeded (pre-check) — sending fallback");
        const { provider: fbProvider, instanceName: fbInstance } = await getProviderForTenant(tenantId).catch(() => ({ provider: null, instanceName: "" }));
        if (fbProvider) {
          await fbProvider.sendMessage(replyToJid, getFallbackMessage("rate_limit", fallbackClinicName, fallbackAiName), fbInstance).catch((err: unknown) => {
            logger.error({ err, tenantId }, "Failed to send rate-limit fallback");
          });
        }
        return;
      }

      // ── CONVERSATION QUOTA CHECK ─────────────────────────────────────────
      if (!quotaAlreadyConsumed) {
        const { checkAndConsumeConversationQuota } = await import("../../lib/conversation-quota-manager");
        const quotaResult = await checkAndConsumeConversationQuota(tenantId, contactPhone).catch((err) => {
          logger.error({ err, tenantId }, "Conversation quota check failed — fail-closed: skipping AI");
          return { allowed: false as const, isExhausted: false, percentUsed: 0, remaining: 0, _checkFailed: true as const };
        });
        if (!quotaResult.allowed) {
          const checkFailed = "_checkFailed" in quotaResult && quotaResult._checkFailed;
          if (checkFailed) {
            return;
          }
          logger.warn({ tenantId, contactPhone: phoneLog }, "Webhook: conversation quota exhausted — sending fallback and blocking conversation");
          // Atomically set quota_blocked (not escalated — quota_blocked is reversible on recharge).
          // Conditional update prevents duplicate fallback messages on concurrent deliveries.
          const blocked = await db.update(dentalConversationsTable)
            .set({ status: "quota_blocked" })
            .where(and(eq(dentalConversationsTable.id, conversation.id), sql`status NOT IN ('escalated', 'quota_blocked')`))
            .returning({ id: dentalConversationsTable.id })
            .catch(() => []);
          if (blocked.length > 0) {
            const { provider: qProvider, instanceName: qInstance } = await getProviderForTenant(tenantId).catch(() => ({ provider: null, instanceName: "" }));
            if (qProvider) {
              await qProvider.sendMessage(replyToJid, "Em breve um atendente entrará em contato.", qInstance).catch((err: unknown) => {
                logger.error({ err, tenantId }, "Failed to send quota-exhausted fallback message");
              });
            }
          }
          return;
        }
      }

      const { provider: typingProvider, instanceName: typingInstance } = await getProviderForTenant(tenantId).catch(() => ({ provider: null, instanceName: "" }));
      if (typingProvider) {
        typingProvider.sendPresence(replyToJid, typingInstance, "composing").catch(() => {});
      }

      const aiStartTime = Date.now();
      let rawReply: string;
      const aiContactName = pushName || patient?.name || lead?.name || "Paciente";
      const { enqueueIncomingMessage } = await import("../../lib/conversation-aggregator");
      const aggResult = await enqueueIncomingMessage(
        tenantId,
        contactPhone,
        processedText || "",
        async (combinedText, aggregatedCount) => {
          const waitMsTotal = Date.now() - aiStartTime;
          return processIncomingMessage(
            tenantId,
            conversation.id,
            contactPhone,
            aiContactName,
            combinedText,
            contactType as "patient" | "lead" | "unknown",
            patient?.id,
            lead?.id,
            mediaContext,
            aggregatedCount,
            waitMsTotal,
          );
        },
      );

      if (!aggResult.shouldReply) {
        logger.info(
          { tenantId, contactPhone: phoneLog, aggregatedCount: aggResult.aggregatedCount, waitMs: aggResult.waitMs },
          "Webhook: message aggregated into a sibling batch — skipping reply (sibling will reply)",
        );
        return;
      }

      if (aggResult.error || aggResult.reply === undefined) {
        const aiErr = aggResult.error;
        logger.error({ err: aiErr, tenantId, contactPhone: phoneLog }, "Webhook: AI processing failed — sending branded fallback");
        const { provider: fbProvider, instanceName: fbInstance } = await getProviderForTenant(tenantId).catch(() => ({ provider: null, instanceName: "" }));
        if (fbProvider) {
          await fbProvider.sendMessage(replyToJid, getFallbackMessage("ai_failure", fallbackClinicName, fallbackAiName), fbInstance).catch((err: unknown) => {
            logger.error({ err, tenantId }, "Failed to send AI-failure fallback");
          });
        }
        const { trackAndEscalateAiFailure } = await import("../../lib/escalation");
        trackAndEscalateAiFailure(tenantId, conversation.id, aiContactName, contactPhone).catch((err: unknown) => {
          logger.error({ err, tenantId }, "Failed to track/escalate AI failure");
        });
        return;
      }
      rawReply = aggResult.reply;
      logger.info(
        {
          tenantId,
          contactPhone: phoneLog,
          aiMs: Date.now() - aiStartTime,
          aggregatedCount: aggResult.aggregatedCount,
          waitMsTotal: aggResult.waitMs,
        },
        "Webhook: AI response time",
      );

      const { recordAiSuccess } = await import("../../lib/escalation");
      await recordAiSuccess(tenantId, conversation.id);

      const { provider, instanceName: whatsappInstance } = await getProviderForTenant(tenantId).catch((err) => {
        logger.error({ err, tenantId }, "Failed to get WhatsApp provider for tenant");
        return { provider: null, instanceName: "" };
      });

      const { getCachedProfessionals: getProfessionalsForCard } = await import("../../lib/cache");
      const professionalsForCard = await getProfessionalsForCard(tenantId).catch(() => [] as Array<{ id: number; name: string; instagramUrl?: string | null; profilePhotoUrl?: string | null; isOwner: boolean }>);

      const portfolioMarkerMatch = PORTFOLIO_ITEM_MARKER_RE.exec(rawReply);
      const portfolioMarkerKeyword = portfolioMarkerMatch ? portfolioMarkerMatch[1].trim() : null;
      const replyWithoutPortfolioMarker = portfolioMarkerKeyword
        ? rawReply.replace(PORTFOLIO_ITEM_MARKER_RE, "").replace(/\s{2,}/g, " ").trim()
        : rawReply;

      // Extract [APT_CARD: ...] marker — strip from reply so it is NOT read aloud by TTS
      const aptCardMatch = APT_CARD_MARKER_RE.exec(replyWithoutPortfolioMarker);
      const aptCardContent = aptCardMatch ? aptCardMatch[1].trim() : null;
      const replyAfterAptCard = aptCardContent
        ? replyWithoutPortfolioMarker.replace(APT_CARD_MARKER_RE, "").replace(/\s{2,}/g, " ").trim()
        : replyWithoutPortfolioMarker;

      // Extract [APT_CANCEL] marker — when IA confirms cancellation, persist
      // status='cancelled' on the contact's most recent active appointment.
      // We accept either the explicit marker OR a deterministic phrase match
      // (the LLM is not always reliable about emitting silent markers in
      // free-text intents, so the phrase fallback acts as a safety net).
      const aptCancelMatch = APT_CANCEL_MARKER_RE.exec(replyAfterAptCard);
      const replyAfterCancelStrip = aptCancelMatch
        ? replyAfterAptCard.replace(APT_CANCEL_MARKER_RE, "").replace(/\s{2,}/g, " ").trim()
        : replyAfterAptCard;
      const CANCEL_CONFIRMATION_RE = /\b(j[aá]\s+cancel(?:ei|amos|ada|ado)|cancel(?:ei|amos|ada|ado)\s+(?:sua|seu|a\s+sua|o\s+seu|por\s+aqui|aqui|no\s+sistema)|consulta\s+cancel(?:ada|ado)|baix(?:ei|amos)\s+(?:o|a|sua|seu)\s+(?:agendamento|consulta))/i;
      const cancelPhraseMatch = !aptCancelMatch && CANCEL_CONFIRMATION_RE.test(replyAfterAptCard);
      const replyWithoutAptCard = replyAfterCancelStrip;
      if ((aptCancelMatch || cancelPhraseMatch) && contactId && contactIdType) {
        const cancelWhere = [
          eq(appointmentsTable.tenantId, tenantId),
          notInArray(appointmentsTable.status, ["cancelled", "no_show", "completed"]),
        ];
        if (contactIdType === "patient") {
          cancelWhere.push(eq(appointmentsTable.patientId, contactId));
        } else {
          cancelWhere.push(eq(appointmentsTable.leadId, contactId));
        }
        try {
          const targetApt = await db.query.appointmentsTable.findFirst({
            where: and(...cancelWhere),
            orderBy: [desc(appointmentsTable.startsAt)],
            columns: { id: true },
          });
          if (targetApt) {
            await db.update(appointmentsTable)
              .set({ status: "cancelled", updatedAt: new Date() })
              .where(eq(appointmentsTable.id, targetApt.id));
            logger.info({ tenantId, contactId, contactIdType, appointmentId: targetApt.id }, "APT_CANCEL: appointment marked as cancelled by AI");
          } else {
            logger.warn({ tenantId, contactId, contactIdType }, "APT_CANCEL marker present but no active appointment found");
          }
        } catch (err) {
          logger.error({ err, tenantId, contactId }, "Failed to apply APT_CANCEL");
        }
      }

      const { textBefore, textAfter, instagramProfessional } = extractInstagramCardFromReply(
        replyWithoutAptCard,
        professionalsForCard,
        lead?.professionalId
      );

      const portfolioProfIdForMarker = instagramProfessional?.id ?? lead?.professionalId ?? null;

      const fullReplyForDb = [textBefore, textAfter].filter(Boolean).join(" ").trim();

      insertChainedMessage({
        tenantId,
        conversationId: conversation.id,
        direction: "outbound",
        type: "text",
        content: fullReplyForDb,
        // Task #12: marca a origem para auditoria distinguir respostas
        // geradas pela IA das mensagens enviadas manualmente do painel.
        externalId: `ai:reply:${Date.now()}`,
        aiModel: process.env.AI_MODEL_NAME || "gpt-5-nano",
        promptVersion: process.env.AI_PROMPT_VERSION || "v1",
      }).catch((err) => {
        logger.error({ err, tenantId }, "Failed to save outbound message");
      });

      db.update(dentalConversationsTable).set({
        lastMessageAt: new Date(),
        lastMessagePreview: fullReplyForDb.substring(0, 100),
      }).where(eq(dentalConversationsTable.id, conversation.id)).catch((err) => {
        logger.error({ err, tenantId }, "Failed to update conversation");
      });

      runPostConversationLearning(tenantId, contactPhone, conversation.id, false).catch((err) => {
        logger.error({ err, tenantId, conversationId: conversation.id }, "Post-conversation learning failed");
      });

      const sendComposing = () => {
        if (provider) {
          provider.sendPresence(replyToJid, whatsappInstance, "composing").catch(() => {});
        }
      };

      const sendTextParts = async (text: string, isFirstChunk: boolean) => {
        if (!text || !provider) return;
        const parts = splitIntoHumanMessages(text).filter(p => p.trim().length > 0);
        const fullText = parts.join(" ");
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          if (i === 0 && isFirstChunk) {
            const delay = typingDelay(fullText);
            logger.debug({ delayMs: delay, chars: fullText.length }, "Typing delay before first part");
            await sleepWithComposing(delay, sendComposing);
          } else {
            const delay = typingDelayBetweenParts(part);
            logger.debug({ partIndex: i, delayMs: delay, chars: part.length }, "Typing delay before next part");
            await sleepWithComposing(delay, sendComposing);
          }
          const MAX_RETRIES = 2;
          let lastErr: unknown = null;
          for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
              await provider.sendMessage(replyToJid, part, whatsappInstance);
              lastErr = null;
              break;
            } catch (err) {
              lastErr = err;
              if (attempt < MAX_RETRIES) {
                const retryDelay = 1000 * (attempt + 1);
                logger.warn({ partIndex: i, attempt: attempt + 1, retryDelay }, "WhatsApp reply part failed, retrying...");
                await new Promise(resolve => setTimeout(resolve, retryDelay));
              }
            }
          }
          if (lastErr) {
            logger.error({ err: lastErr, partIndex: i, replyToJid: jidLog, whatsappInstance }, "Failed to send WhatsApp reply part after all retries");
            throw lastErr;
          }
        }
      };

      if (provider) {
        logger.info({ tenantId, contactPhone: phoneLog, hasCard: !!instagramProfessional, textBeforeLen: textBefore.length, textAfterLen: textAfter.length }, "Webhook: sending response");

        // ── Determine audio capability BEFORE sending anything ──────────────
        const settings = await getCachedSettings(tenantId);
        const audioMode = settings?.audioMode || "off";
        const audioConditionMet = audioMode === "always" || (audioMode === "audio_reply_only" && mediaType === "audio");

        let useElevenLabs = false;
        let useCartesia = false;
        let elevenLabsKey: string | null = null;
        let cartesiaKey: string | null = null;

        if (audioConditionMet) {
          try {
            const { getTenantWithDecryptedKeys } = await import("../../lib/tenant-helpers");
            const tenantRow = await getTenantWithDecryptedKeys(tenantId);
            elevenLabsKey = resolveElevenLabsKey(tenantRow?.elevenLabsApiKey);
            const ttsProvider = settings?.ttsProvider || "cartesia";
            useElevenLabs = ttsProvider === "elevenlabs" && !!elevenLabsKey && !!settings?.elevenLabsVoiceId;
            cartesiaKey = resolveCartesiaKey();
            useCartesia = !useElevenLabs && !!cartesiaKey;
          } catch (e) {
            logger.error({ err: e, tenantId }, "Failed to resolve TTS provider");
          }
        }

        const shouldSendAudio = audioConditionMet && (useElevenLabs || useCartesia);
        let deliveryOk = false;

        // ── AUDIO MODE: send only audio, text is the fallback ───────────────
        if (shouldSendAudio) {
          logger.info({ tenantId, contactPhone: phoneLog, audioMode }, "Audio mode active — will not send text unless TTS generation fails or credits are missing");
          const charCount = countCharacters(fullReplyForDb);
          let deductResult: { success: boolean } = { success: false };
          try {
            deductResult = await checkAndDeductCredits(tenantId, charCount, `TTS: ${charCount} caracteres`);
          } catch (e) {
            logger.error({ err: e, tenantId }, "Credit deduction failed");
          }

          if (deductResult.success) {
            // Phase 1: TTS generation — if this fails, fall back to text
            let audioBuffer: Buffer | null = null;
            try {
              const ttsText = normalizeTtsText(fullReplyForDb);

              if (useElevenLabs) {
                audioBuffer = await textToSpeech(ttsText, settings!.elevenLabsVoiceId!, elevenLabsKey!);
                logger.info({ tenantId, contactPhone: phoneLog, charCount, tts: "elevenlabs" }, "TTS generation succeeded via ElevenLabs");
              } else {
                const voiceId = settings?.cartesiaVoiceId || getDefaultCartesiaVoiceId();
                audioBuffer = await cartesiaTTS(ttsText, voiceId, cartesiaKey!);
                logger.info({ tenantId, contactPhone: phoneLog, charCount, tts: "cartesia" }, "TTS generation succeeded via Cartesia");
              }
            } catch (ttsGenErr) {
              await refundCredits(tenantId, charCount, `Reembolso: falha na geração TTS (${charCount} caracteres)`).catch(() => {});
              logger.error({ err: ttsGenErr, tenantId, contactPhone: phoneLog }, "TTS generation failed — falling back to text (audio mode fallback)");

              // Fallback to text only when TTS generation itself failed
              try { await sendTextParts(textBefore, true); deliveryOk = true; } catch { /* noop */ }
              try { await sendTextParts(textAfter, !textBefore); } catch { /* noop */ }
            }

            // Phase 2: Audio send — if TTS succeeded, attempt to send audio.
            // If sendAudio fails, we do NOT fall back to text (audio may have been partially
            // delivered). Credits are refunded since the audio did not reach the patient reliably.
            if (audioBuffer !== null) {
              try {
                await provider.sendAudio(replyToJid, audioBuffer.toString("base64"), whatsappInstance, "audio/mpeg");
                deliveryOk = true;
                logger.info({ tenantId, contactPhone: phoneLog, charCount }, "Audio-only reply sent successfully — no text dispatched");

                // After audio: send a text confirmation card so the patient can see the date/time
                if (aptCardContent && provider) {
                  const cardText = `📅 *Consulta confirmada:*\n${aptCardContent}`;
                  await new Promise<void>((res) => setTimeout(res, 800));
                  provider.sendMessage(replyToJid, cardText, whatsappInstance).catch((err) => {
                    logger.warn({ err, tenantId, contactPhone: phoneLog }, "APT_CARD text message failed to send");
                  });
                }
              } catch (sendAudioErr) {
                logger.error({ err: sendAudioErr, tenantId, contactPhone: phoneLog }, "Audio send failed after TTS succeeded — no text fallback to avoid duplicate delivery");
                await refundCredits(tenantId, charCount, `Reembolso: falha no envio do áudio (${charCount} caracteres)`).catch(() => {});
              }
            }

            getAudioCreditStatus(tenantId).then((status) => {
              checkLowCreditsAlert(tenantId, status.totalAvailable).catch(() => {});
            }).catch(() => {});
          } else {
            // No credits — send text as fallback
            logger.warn({ tenantId, contactPhone: phoneLog, charCount }, "Audio blocked: no credits — falling back to text (audio mode fallback)");
            checkLowCreditsAlert(tenantId, 0).catch(() => {});
            try { await sendTextParts(textBefore, true); deliveryOk = true; } catch { /* noop */ }
            try { await sendTextParts(textAfter, !textBefore); } catch { /* noop */ }
          }

        // ── TEXT MODE: send text parts normally ──────────────────────────────
        } else {
          logger.info({ tenantId, contactPhone: phoneLog, audioMode, audioConditionMet }, "Text mode — sending text reply");
          let sendFailed = false;
          try { await sendTextParts(textBefore, true); } catch { sendFailed = true; }

          if (instagramProfessional && instagramProfessional.instagramUrl) {
            const rawHandle = instagramProfessional.instagramUrl.trim()
              .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
              .replace(/^@/, "")
              .replace(/\/$/, "");
            const instagramUrl = `https://instagram.com/${rawHandle}`;
            await sendInstagramCard(provider, replyToJid, whatsappInstance, instagramProfessional.name, instagramUrl, instagramProfessional.profilePhotoUrl).catch((err) => {
              logger.error({ err, replyToJid: jidLog }, "Failed to send Instagram card");
            });
          }

          if (portfolioMarkerKeyword) {
            await findPortfolioByKeyword(tenantId, portfolioProfIdForMarker, portfolioMarkerKeyword).then(async (match) => {
              if (!match) {
                logger.info({ tenantId, contactPhone: phoneLog, keyword: portfolioMarkerKeyword }, "Portfolio marker found but no matching item for keyword");
                return;
              }
              try {
                await provider.sendImage(replyToJid, match.mediaUrl, match.caption || "", whatsappInstance);
                logger.info({ tenantId, contactPhone: phoneLog, keyword: portfolioMarkerKeyword, mediaUrl: match.mediaUrl }, "Portfolio item sent via AI marker");
              } catch (err) {
                logger.warn({ err, tenantId, contactPhone: phoneLog, keyword: portfolioMarkerKeyword }, "Failed to send portfolio item via marker");
              }
            }).catch(() => {});
          }

          try { await sendTextParts(textAfter, !textBefore); } catch { sendFailed = true; }

          if (sendFailed) {
            logger.error({ tenantId, contactPhone: phoneLog, replyToJid: jidLog, whatsappInstance }, "Webhook: one or more WhatsApp reply parts failed delivery after retries");
          } else {
            deliveryOk = true;
          }
        }

        // ── Reaction ✅ for confirmed appointments ───────────────────────────
        if (deliveryOk) {
          const isConfirmation = /\b(reserv|agend|confirm|marcad|pronto.*horario|horario.*reserv)\w*/i.test(fullReplyForDb);
          if (isConfirmation && messageId) {
            provider.sendReaction(replyToJid, messageId, "✅", whatsappInstance).catch(() => {});
          }

          const portfolioProfId = portfolioProfIdForMarker;
          findPortfolioMatch(tenantId, portfolioProfId, processedText || "").then(async (match) => {
            if (!match) return;
            if (portfolioMarkerKeyword) return;
            try {
              await provider.sendImage(replyToJid, match.mediaUrl, match.caption || "", whatsappInstance);
              logger.info({ tenantId, contactPhone: phoneLog, mediaUrl: match.mediaUrl }, "Portfolio photo sent");
            } catch (err) {
              logger.warn({ err, tenantId, contactPhone: phoneLog }, "Failed to send portfolio photo");
            }
          }).catch(() => {});
        }
      }
    }

  } catch (err) {
    logger.error({ err }, "Webhook processing error (async phase)");
  } finally {
    if (advisoryLockKey !== null) {
      db.execute(sql`SELECT pg_advisory_unlock(${advisoryLockKey})`).catch(() => {});
    }
  }
});

async function handleHumanTakeover(tenantId: number, remoteJid: string): Promise<void> {
  const contactPhone = remoteJid.replace("@s.whatsapp.net", "").replace("@lid", "");

  const conversation = await db.query.dentalConversationsTable.findFirst({
    where: and(
      eq(dentalConversationsTable.tenantId, tenantId),
      eq(dentalConversationsTable.contactPhone, contactPhone),
    ),
    orderBy: [sql`updated_at DESC`],
  });

  if (!conversation) return;

  const settings = await getCachedSettings(tenantId);

  const takeoverMinutes = settings?.humanTakeoverMinutes ?? 5;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + takeoverMinutes * 60 * 1000);
  const wasAlreadyTakeover = conversation.status === "human_takeover";

  await db.update(dentalConversationsTable).set({
    status: "human_takeover",
    humanTakeoverAt: wasAlreadyTakeover ? conversation.humanTakeoverAt : now,
    humanTakeoverExpiresAt: expiresAt,
  }).where(eq(dentalConversationsTable.id, conversation.id));

  logger.info({
    tenantId,
    conversationId: conversation.id,
    contactPhone: maskPhone(contactPhone),
    takeoverMinutes,
    expiresAt,
    renewed: wasAlreadyTakeover,
  }, wasAlreadyTakeover ? "Human takeover timer renewed" : "Human takeover activated (fromMe detected)");

  if (!wasAlreadyTakeover && settings?.telegramEscalationEnabled && settings?.telegramBotToken && settings?.telegramChatId) {
    try {
      const { sendTelegramMessage } = await import("../../lib/telegram");
      const contactName = conversation.contactName || contactPhone;
      const msg = `👨‍⚕️ <b>Dentista assumiu conversa</b>\n\n👤 <b>${contactName}</b>\n📱 ${contactPhone}\n\n⏱ IA pausada por ${takeoverMinutes} min\n📋 A IA retomara automaticamente apos o tempo expirar.\n\n⏰ ${now.toLocaleString("pt-BR")}`;
      await sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, msg);
    } catch (err) {
      logger.error({ err, tenantId }, "Failed to send takeover Telegram notification");
    }
  }
}

router.get("/debug/poll-test", async (_req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not found" });
  }
  const adminKey = _req.headers["x-admin-key"] || _req.query["admin_key"];
  if (adminKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const rawTenants = await db.query.tenantsTable.findMany({
      where: isNotNull(tenantsTable.evolutionInstanceName),
    });
    const tenants = rawTenants.map(decryptTenantKeys);
    const results: Record<string, unknown>[] = [];

    for (const tenant of tenants) {
      if (!tenant.evolutionInstanceName) continue;
      const apiUrl = (tenant.evolutionApiUrl || process.env.EVOLUTION_API_URL || "").replace(/\/$/, "");
      const apiKey = tenant.evolutionApiKey || process.env.EVOLUTION_API_KEY || "";
      if (!apiUrl || !apiKey) continue;
      const instanceName = tenant.evolutionInstanceName;
      const headers = { apikey: apiKey, "Content-Type": "application/json" };

      try {
        const resp = await axios.post(
          `${apiUrl}/chat/findMessages/${instanceName}`,
          { where: {}, limit: 200 },
          { headers, timeout: 15000 }
        );
        const data = resp.data;
        const records = data?.messages?.records || (Array.isArray(data) ? data : []);
        const msgs = records as Array<{ key: { id: string; fromMe: boolean; remoteJid: string }; messageTimestamp: number; pushName?: string }>;
        const timestamps = msgs.map(m => m.messageTimestamp).filter(t => typeof t === "number" && t > 0);
        results.push({
          source: "findMessages",
          instanceName,
          totalReturned: msgs.length,
          inboundCount: msgs.filter(m => !m.key?.fromMe).length,
          oldestDate: timestamps.length ? new Date(Math.min(...timestamps) * 1000).toISOString() : null,
          newestDate: timestamps.length ? new Date(Math.max(...timestamps) * 1000).toISOString() : null,
        });
      } catch (err: unknown) {
        results.push({ source: "findMessages", instanceName, error: err instanceof Error ? err.message : String(err) });
      }

      try {
        const csResp = await axios.get(
          `${apiUrl}/instance/connectionState/${instanceName}`,
          { headers: { apikey: apiKey }, timeout: 10000 }
        );
        results.push({ source: "connectionState", instanceName, data: csResp.data });
      } catch (err: unknown) {
        results.push({ source: "connectionState", instanceName, error: err instanceof Error ? err.message : String(err) });
      }

      try {
        const settingsResp = await axios.get(
          `${apiUrl}/settings/find/${instanceName}`,
          { headers, timeout: 10000 }
        );
        results.push({ source: "settings", instanceName, data: settingsResp.data });
      } catch (err: unknown) {
        results.push({ source: "settings", instanceName, error: err instanceof Error ? err.message : String(err) });
      }
    }

    res.json({ ok: true, results, now: new Date().toISOString() });
  } catch (err: unknown) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * Exported for unit testing only — never call in production code.
 * Allows targeted tests to exercise the isDuplicateMessage logic
 * (all 3 layers: memory, Redis, DB) without going through the full
 * HTTP route handler.
 */
export { isDuplicateMessage as _testIsDuplicateMessage };
export default router;
