import axios from "axios";
import { db } from "@workspace/db";
import { tenantsTable, dentalMessagesTable } from "@workspace/db";
import { isNotNull, and, eq, gte, desc } from "drizzle-orm";
import { logger } from "./logger";
import { maskJid, maskName } from "./pii-mask";
import { decryptTenantKeys } from "./tenant-helpers";
import { getRedis, isRedisAvailable, waitForRedis } from "./redis";

interface EvolutionMessage {
  key: {
    remoteJid: string;
    fromMe: boolean;
    id: string;
  };
  pushName?: string;
  message?: Record<string, unknown>;
  messageTimestamp: number;
  messageType?: string;
}

type TenantRow = Awaited<ReturnType<typeof db.query.tenantsTable.findMany>>[number];
type DecryptedTenant = ReturnType<typeof decryptTenantKeys>;

const localProcessedIds = new Set<string>();
const MAX_CACHE_SIZE = 5000;
const POLLING_DEDUP_TTL_SEC = 3600;
const POLLING_DEDUP_KEY_PREFIX = "dedup:polling";
const WARMUP_LOOKBACK_MS = 24 * 60 * 60 * 1000;
let initialized = false;
let hasWarmedUp = false;
let lastDiagSig = "";
const stalenessState = new Map<string, { warned: boolean; consecutiveStale: number }>();
const STALE_THRESHOLD_SECONDS = 300;
const STALE_RETRY_INTERVAL = 3;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const PER_TENANT_INTERVAL_MS = 30_000;
const STAGGER_OFFSET_MS = 600;
const TENANT_REFRESH_INTERVAL_MS = 5 * 60_000;

const inFlightTenants = new Set<number>();
const tenantTimers = new Map<number, ReturnType<typeof setInterval>>();
let tenantRefreshTimer: ReturnType<typeof setInterval> | null = null;
let startupTimeoutHandles: ReturnType<typeof setTimeout>[] = [];
let staggeredPollingStarted = false;

function addToLocalCache(msgId: string): void {
  localProcessedIds.add(msgId);
  if (localProcessedIds.size > MAX_CACHE_SIZE) {
    const entries = Array.from(localProcessedIds);
    entries.slice(0, entries.length - MAX_CACHE_SIZE / 2).forEach((id) => localProcessedIds.delete(id));
  }
}

function dedupKey(tenantId: number, msgId: string): string {
  return `${POLLING_DEDUP_KEY_PREFIX}:${tenantId}:${msgId}`;
}

function localCacheKey(tenantId: number, msgId: string): string {
  return `${tenantId}:${msgId}`;
}

type DedupLayer = "local" | "redis" | "db" | "miss";

async function isMessageProcessed(msgId: string, tenantId: number): Promise<{ processed: boolean; layer: DedupLayer }> {
  const cacheKey = localCacheKey(tenantId, msgId);
  if (localProcessedIds.has(cacheKey)) {
    return { processed: true, layer: "local" };
  }

  const redis = getRedis();
  if (redis) {
    try {
      const exists = await redis.exists(dedupKey(tenantId, msgId));
      if (exists === 1) {
        addToLocalCache(cacheKey);
        return { processed: true, layer: "redis" };
      }
    } catch {
    }
  }

  try {
    const inDb = await db.query.dentalMessagesTable.findFirst({
      where: and(
        eq(dentalMessagesTable.tenantId, tenantId),
        eq(dentalMessagesTable.externalId, msgId),
      ),
      columns: { id: true },
    });
    if (inDb) {
      addToLocalCache(cacheKey);
      return { processed: true, layer: "db" };
    }
  } catch (err) {
    logger.warn({ err, msgId, tenantId }, "Polling: DB dedup check failed — treating as unprocessed");
  }

  return { processed: false, layer: "miss" };
}

async function markPollingProcessed(msgId: string, tenantId: number): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.setex(dedupKey(tenantId, msgId), POLLING_DEDUP_TTL_SEC, "1");
    } catch {
    }
  }
  addToLocalCache(localCacheKey(tenantId, msgId));
}

async function warmUpCacheFromDB(): Promise<void> {
  if (hasWarmedUp) return;
  hasWarmedUp = true;
  const cutoff = new Date(Date.now() - WARMUP_LOOKBACK_MS);
  try {
    const recentMessages = await db.query.dentalMessagesTable.findMany({
      where: and(
        isNotNull(dentalMessagesTable.externalId),
        gte(dentalMessagesTable.createdAt, cutoff),
      ),
      columns: { externalId: true, tenantId: true },
      orderBy: [desc(dentalMessagesTable.createdAt)],
      limit: MAX_CACHE_SIZE,
    });
    let loaded = 0;
    for (const row of recentMessages) {
      if (row.externalId) {
        localProcessedIds.add(localCacheKey(row.tenantId, row.externalId));
        loaded++;
      }
    }
    if (loaded > 0) {
      logger.info({ loaded, lookbackMs: WARMUP_LOOKBACK_MS }, "Polling: warm-up loaded recent externalIds from DB into local cache");
    }
  } catch (err) {
    logger.warn({ err }, "Polling: warm-up DB query failed — starting with empty local cache");
  }
}

function parseEvolutionMessages(data: unknown): EvolutionMessage[] {
  if (!data || typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;
  const messagesObj = obj.messages as Record<string, unknown> | undefined;
  const records = messagesObj?.records || (Array.isArray(data) ? data : []);
  return (Array.isArray(records) ? records : []) as EvolutionMessage[];
}

function getMaxTimestamp(msgs: EvolutionMessage[]): number {
  const timestamps = msgs.map(m => m.messageTimestamp).filter(t => typeof t === "number" && t > 0);
  return timestamps.length > 0 ? Math.max(...timestamps) : 0;
}

async function fetchMessagesPrimary(
  baseUrl: string,
  headers: Record<string, string>,
  instanceName: string,
  limit: number
): Promise<EvolutionMessage[]> {
  const response = await axios.post(
    `${baseUrl}/chat/findMessages/${instanceName}`,
    { where: {}, limit },
    { headers, timeout: 15000 }
  );
  return parseEvolutionMessages(response.data);
}

async function fetchMessagesFallback(
  baseUrl: string,
  headers: Record<string, string>,
  instanceName: string,
  limit: number
): Promise<EvolutionMessage[]> {
  const queryVariants = [
    { body: { limit } },
    { body: { where: { key: {} }, limit } },
    { body: { where: { key: { fromMe: false } }, limit } },
  ];
  for (const v of queryVariants) {
    try {
      const response = await axios.post(
        `${baseUrl}/chat/findMessages/${instanceName}`,
        v.body,
        { headers, timeout: 15000 }
      );
      const msgs = parseEvolutionMessages(response.data);
      if (msgs.length > 0) {
        logger.info({ instanceName, variant: JSON.stringify(v.body), count: msgs.length }, "Polling: fallback query returned messages");
        return msgs;
      }
    } catch (err) {
      logger.debug({ instanceName, variant: JSON.stringify(v.body), err: err instanceof Error ? err.message : String(err) }, "Polling: fallback variant failed");
    }
  }

  try {
    const chatsResp = await axios.post(
      `${baseUrl}/chat/findChats/${instanceName}`,
      {},
      { headers, timeout: 15000 }
    );
    const chats = Array.isArray(chatsResp.data) ? chatsResp.data : [];
    const recentChats = chats
      .filter((c: Record<string, unknown>) => c.lastMsgTimestamp && !String(c.id || "").endsWith("@g.us"))
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
        Number(b.lastMsgTimestamp) - Number(a.lastMsgTimestamp)
      )
      .slice(0, 5);

    for (const chat of recentChats) {
      const remoteJid = String(chat.id || "");
      if (!remoteJid) continue;
      try {
        const msgResp = await axios.post(
          `${baseUrl}/chat/findMessages/${instanceName}`,
          { where: { key: { remoteJid } }, limit: 10 },
          { headers, timeout: 10000 }
        );
        const msgs = parseEvolutionMessages(msgResp.data);
        if (msgs.length > 0) {
          logger.info({ instanceName, remoteJid: maskJid(remoteJid), count: msgs.length }, "Polling: fallback per-chat query returned messages");
          return msgs;
        }
      } catch (err) {
        logger.debug({ instanceName, remoteJid, err: err instanceof Error ? err.message : String(err) }, "Polling: fallback per-chat query failed");
      }
    }
  } catch (err) {
    logger.debug({ instanceName, err: err instanceof Error ? err.message : String(err) }, "Polling: fallback findChats failed");
  }

  return [];
}

async function fetchMessages(
  apiUrl: string,
  apiKey: string,
  instanceName: string,
  limit: number
): Promise<EvolutionMessage[]> {
  const baseUrl = apiUrl.replace(/\/$/, "");
  const headers = { apikey: apiKey, "Content-Type": "application/json" };
  let msgs: EvolutionMessage[] = [];
  try {
    msgs = await fetchMessagesPrimary(baseUrl, headers, instanceName, limit);
  } catch (err) {
    logger.warn({ err, instanceName }, "Polling: primary findMessages failed, trying fallback");
    try {
      msgs = await fetchMessagesFallback(baseUrl, headers, instanceName, limit);
    } catch (fallbackErr) {
      logger.warn({ fallbackErr, instanceName }, "Polling: all findMessages attempts failed");
      return [];
    }
  }

  if (msgs.length > 0) {
    const timestamps = msgs.map(m => m.messageTimestamp).filter(t => typeof t === "number" && t > 0);
    if (timestamps.length > 0) {
      const maxTs = Math.max(...timestamps);
      const sig = `${msgs.length}:${maxTs}`;
      if (sig !== lastDiagSig) {
        lastDiagSig = sig;
        const minTs = Math.min(...timestamps);
        logger.info({
          instanceName,
          total: msgs.length,
          oldestDate: new Date(minTs * 1000).toISOString(),
          newestDate: new Date(maxTs * 1000).toISOString(),
          inbound: msgs.filter(m => !m.key?.fromMe).length,
          outbound: msgs.filter(m => m.key?.fromMe).length,
        }, "Polling: fetchMessages response changed");
      }
      const nowSec = Math.floor(Date.now() / 1000);
      const ageSec = nowSec - maxTs;
      const state = stalenessState.get(instanceName) || { warned: false, consecutiveStale: 0 };
      if (ageSec > STALE_THRESHOLD_SECONDS) {
        state.consecutiveStale++;
        const shouldRetryFallback = !state.warned || (state.consecutiveStale % STALE_RETRY_INTERVAL === 0);
        if (shouldRetryFallback) {
          if (!state.warned) {
            state.warned = true;
            logger.warn({
              instanceName,
              newestDate: new Date(maxTs * 1000).toISOString(),
              ageSec,
              threshold: STALE_THRESHOLD_SECONDS,
            }, "Polling: findMessages data appears stale — trying fallback queries");
          }
          const fallbackMsgs = await fetchMessagesFallback(baseUrl, headers, instanceName, limit);
          if (fallbackMsgs.length > 0 && getMaxTimestamp(fallbackMsgs) > maxTs) {
            logger.info({ instanceName, fallbackCount: fallbackMsgs.length }, "Polling: fallback returned fresher data");
            state.warned = false;
            state.consecutiveStale = 0;
            stalenessState.set(instanceName, state);
            return fallbackMsgs;
          }
        }
      } else {
        state.warned = false;
        state.consecutiveStale = 0;
      }
      stalenessState.set(instanceName, state);
    }
  }
  return msgs;
}

async function forwardToWebhook(
  instanceName: string,
  msg: EvolutionMessage,
  webhookUrl: string,
  siblingExternalIds: string[] = [],
): Promise<void> {
  const payload: Record<string, unknown> = {
    event: "messages.upsert",
    instance: instanceName,
    data: {
      key: msg.key,
      pushName: msg.pushName,
      message: msg.message || {},
      messageTimestamp: msg.messageTimestamp,
      messageType: msg.messageType,
    },
    source: "polling-fallback",
  };
  if (siblingExternalIds.length > 0) {
    payload.siblingExternalIds = siblingExternalIds;
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.WEBHOOK_SECRET) {
    headers["x-webhook-token"] = process.env.WEBHOOK_SECRET;
  }
  await axios.post(webhookUrl, payload, {
    headers,
    timeout: 30000,
  });
}

function getLocalWebhookUrl(): string {
  const port = process.env["PORT"] || "8080";
  return `http://localhost:${port}/api/dental/webhook/whatsapp`;
}

let initPromise: Promise<void> | null = null;
async function initializePolling(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await waitForRedis(3000);
    initialized = true;
  })();
  await initPromise;
  const redisAvailable = isRedisAvailable();
  if (!redisAvailable) {
    if (IS_PRODUCTION) {
      logger.warn(
        "Polling: REDIS_URL not configured in production — polling dedup is not durable. " +
        "Configure REDIS_URL to ensure messages are not re-processed after restarts. " +
        "Polling will skip processing until Redis is available.",
      );
    } else {
      logger.warn(
        "Polling: Redis NOT configured — running in DB-only dedup mode. " +
        "In-memory cache is volatile across restarts; durability relies entirely on " +
        "externalIds persisted in dental_messages (including merged-sibling placeholders). " +
        "Set REDIS_URL for an additional fast dedup layer.",
      );
    }
  }
  logger.info(
    { redisAvailable, warmupLookbackHours: WARMUP_LOOKBACK_MS / 3_600_000, maxCacheSize: MAX_CACHE_SIZE },
    "Polling: initialized — DB deduplication handles already-processed messages",
  );
}

async function pollSingleTenant(tenant: DecryptedTenant, webhookUrl: string): Promise<void> {
  if (!tenant.evolutionInstanceName) return;
  const apiUrl = tenant.evolutionApiUrl || process.env.EVOLUTION_API_URL;
  const apiKey = tenant.evolutionApiKey || process.env.EVOLUTION_API_KEY;
  if (!apiUrl || !apiKey) return;

  const tenantId = tenant.id;
  const instanceName = tenant.evolutionInstanceName;

  if (IS_PRODUCTION && !isRedisAvailable()) {
    logger.warn({ tenantId }, "Polling: Redis unavailable in production — skipping cycle (fail-safe)");
    return;
  }

  if (inFlightTenants.has(tenantId)) {
    logger.warn({ tenantId, instanceName }, "Polling: previous cycle still in flight — skipping this cycle");
    return;
  }

  inFlightTenants.add(tenantId);
  const cycleStart = Date.now();

  try {
    const messages = await fetchMessages(apiUrl, apiKey, instanceName, 200);
    logger.debug({ instanceName, fetched: messages.length }, "Polling: cycle check");

    let forwarded = 0;
    const MAX_PER_CYCLE = 5;
    let localHits = 0;
    let redisHits = 0;
    let dbHits = 0;

    const newMessages: EvolutionMessage[] = [];
    for (const msg of messages) {
      const msgId = msg.key?.id;
      if (!msgId || msg.key.fromMe) continue;
      const { processed, layer } = await isMessageProcessed(msgId, tenantId);
      if (processed) {
        if (layer === "local") localHits++;
        else if (layer === "redis") redisHits++;
        else if (layer === "db") dbHits++;
      } else {
        newMessages.push(msg);
      }
    }

    const anyFiltered = localHits + redisHits + dbHits > 0;
    if (dbHits > 0 || redisHits > 0) {
      logger.info(
        { instanceName, localHits, redisHits, dbHits, newCount: newMessages.length },
        "Polling: dedup layer stats",
      );
    } else if (anyFiltered) {
      logger.debug(
        { instanceName, localHits, redisHits: 0, dbHits: 0, newCount: newMessages.length },
        "Polling: dedup layer stats",
      );
    }

    if (newMessages.length > 0) {
      logger.info({ instanceName, newCount: newMessages.length, totalFetched: messages.length }, "Polling: found new messages to forward");
    }

    const byContact = new Map<string, EvolutionMessage[]>();
    for (const msg of newMessages) {
      const jid = msg.key.remoteJid;
      if (!byContact.has(jid)) byContact.set(jid, []);
      byContact.get(jid)!.push(msg);
    }

    for (const [contactJid, contactMsgs] of byContact) {
      if (forwarded >= MAX_PER_CYCLE) break;

      contactMsgs.sort((a, b) => a.messageTimestamp - b.messageTimestamp);
      const msgIds = contactMsgs.map(m => m.key.id);

      if (contactMsgs.length > 1) {
        const latestMsg = contactMsgs[contactMsgs.length - 1];
        const combinedTexts: string[] = [];
        for (const msg of contactMsgs) {
          const text = (msg.message as Record<string, unknown>)?.conversation as string
            || ((msg.message as Record<string, unknown>)?.extendedTextMessage as Record<string, unknown>)?.text as string
            || "";
          if (text.trim()) combinedTexts.push(text.trim());
        }
        const merged: EvolutionMessage = {
          ...latestMsg,
          message: combinedTexts.length > 0
            ? { ...latestMsg.message, conversation: combinedTexts.join("\n") }
            : latestMsg.message,
        };
        const siblingIds = msgIds.filter((id) => id && id !== latestMsg.key.id);
        try {
          await forwardToWebhook(instanceName, merged, webhookUrl, siblingIds);
          forwarded++;
          for (const id of msgIds) await markPollingProcessed(id, tenantId);
          logger.info({ instanceName, contactJid: maskJid(contactJid), msgCount: contactMsgs.length, msgIds }, "Polling: forwarded grouped messages for contact");
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.warn({ instanceName, contactJid: maskJid(contactJid), msgIds, error: errMsg }, "Polling: forward grouped messages failed");
        }
      } else {
        const msg = contactMsgs[0];
        try {
          await forwardToWebhook(instanceName, msg, webhookUrl);
          forwarded++;
          await markPollingProcessed(msg.key.id, tenantId);
          logger.info({ instanceName, msgId: msg.key.id, contactJid: maskJid(contactJid), pushName: maskName(msg.pushName) }, "Polling: forwarded new message");
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.warn({ instanceName, msgId: msg.key.id, error: errMsg }, "Polling: forward to webhook failed");
        }
      }
    }

    const elapsed = Date.now() - cycleStart;
    logger.debug({ tenantId, instanceName, elapsed, forwarded }, "Polling: tenant cycle complete");
  } catch (err) {
    logger.error({ err, tenantId, instanceName }, "Polling: tenant cycle error");
  } finally {
    inFlightTenants.delete(tenantId);
  }
}

function scheduleTenantPolling(
  tenant: DecryptedTenant,
  tenantIndex: number,
  offset: number,
  perTenantIntervalMs: number,
  webhookUrl: string,
): void {
  const tenantId = tenant.id;
  const instanceName = tenant.evolutionInstanceName;

  const handle = setTimeout(() => {
    startupTimeoutHandles = startupTimeoutHandles.filter(h => h !== handle);

    if (!staggeredPollingStarted) return;

    logger.info(
      { tenantId, tenantIndex, instanceName, offset, perTenantIntervalMs },
      "Polling: staggered timer started for tenant",
    );

    const runCycle = (): void => {
      logger.debug({ tenantId, tenantIndex, instanceName }, "Polling: tenant cycle starting");
      pollSingleTenant(tenant, webhookUrl).catch((err) => {
        logger.error({ err, tenantId, tenantIndex }, "Polling: tenant cycle error");
      });
    };

    runCycle();

    const timer = setInterval(runCycle, perTenantIntervalMs);
    timer.unref();
    tenantTimers.set(tenantId, timer);
  }, offset);

  startupTimeoutHandles.push(handle);
}

function clearAllTimers(): void {
  for (const h of startupTimeoutHandles) clearTimeout(h);
  startupTimeoutHandles = [];
  for (const timer of tenantTimers.values()) clearInterval(timer);
  tenantTimers.clear();
  if (tenantRefreshTimer) {
    clearInterval(tenantRefreshTimer);
    tenantRefreshTimer = null;
  }
}

async function loadAndScheduleNewTenants(perTenantIntervalMs: number, staggerMs: number, webhookUrl: string): Promise<void> {
  const rawTenants = await db.query.tenantsTable.findMany({
    where: isNotNull(tenantsTable.evolutionInstanceName),
  });
  const tenants = rawTenants.map(decryptTenantKeys).filter(t => !!t.evolutionInstanceName);

  const currentIds = new Set(tenantTimers.keys());
  const freshIds = new Set(tenants.map(t => t.id));

  for (const id of currentIds) {
    if (!freshIds.has(id)) {
      const timer = tenantTimers.get(id);
      if (timer) clearInterval(timer);
      tenantTimers.delete(id);
      logger.info({ tenantId: id }, "Polling: removed staggered timer for disconnected tenant");
    }
  }

  const newTenants = tenants.filter(t => !currentIds.has(t.id));
  if (newTenants.length > 0) {
    const existingCount = tenantTimers.size;
    newTenants.forEach((tenant, i) => {
      const tenantIndex = existingCount + i;
      const offset = tenantIndex * staggerMs;
      scheduleTenantPolling(tenant, tenantIndex, offset, perTenantIntervalMs, webhookUrl);
      logger.info({ tenantId: tenant.id, tenantIndex, instanceName: tenant.evolutionInstanceName, offset }, "Polling: added staggered timer for new tenant");
    });
  }

  if (tenants.length === 0) {
    logger.info("Polling: no connected tenants — staggered polling idle");
  }
}

async function scheduleStaggeredPolling(perTenantIntervalMs: number, staggerMs: number): Promise<void> {
  if (!hasWarmedUp) {
    await warmUpCacheFromDB();
  }

  const webhookUrl = getLocalWebhookUrl();

  const rawTenants = await db.query.tenantsTable.findMany({
    where: isNotNull(tenantsTable.evolutionInstanceName),
  });
  const tenants = rawTenants.map(decryptTenantKeys).filter(t => !!t.evolutionInstanceName);

  logger.info(
    { tenantCount: tenants.length, perTenantIntervalMs, staggerMs },
    "Polling: starting staggered polling",
  );

  tenants.forEach((tenant, i) => {
    const offset = i * staggerMs;
    scheduleTenantPolling(tenant, i, offset, perTenantIntervalMs, webhookUrl);
  });

  tenantRefreshTimer = setInterval(() => {
    loadAndScheduleNewTenants(perTenantIntervalMs, staggerMs, webhookUrl).catch((err) => {
      logger.error({ err }, "Polling: tenant refresh failed");
    });
  }, TENANT_REFRESH_INTERVAL_MS);
  tenantRefreshTimer.unref();
}

export async function pollForNewMessages(): Promise<void> {
  if (!initialized) {
    await initializePolling();
  }

  if (IS_PRODUCTION && !isRedisAvailable()) {
    logger.warn("Polling: Redis unavailable in production — skipping this polling cycle (fail-safe). Configure REDIS_URL.");
    return;
  }

  if (!hasWarmedUp) {
    await warmUpCacheFromDB();
  }

  const rawTenants = await db.query.tenantsTable.findMany({
    where: isNotNull(tenantsTable.evolutionInstanceName),
  });
  const connectedTenants = rawTenants.map(decryptTenantKeys);

  if (connectedTenants.length === 0) return;

  const localWebhookUrl = getLocalWebhookUrl();
  for (const tenant of connectedTenants) {
    await pollSingleTenant(tenant, localWebhookUrl);
  }
}

export function startMessagePolling(perTenantIntervalMs = PER_TENANT_INTERVAL_MS): void {
  if (staggeredPollingStarted) return;
  staggeredPollingStarted = true;

  logger.info(
    { perTenantIntervalMs, staggerMs: STAGGER_OFFSET_MS },
    "Message polling started",
  );

  initializePolling()
    .then(() => {
      logger.info("Polling: initialization complete — ready for new messages");
      return scheduleStaggeredPolling(perTenantIntervalMs, STAGGER_OFFSET_MS);
    })
    .catch((err) => {
      logger.error({ err }, "Polling: failed to start staggered scheduler — polling disabled");
      staggeredPollingStarted = false;
    });
}

export function stopMessagePolling(): void {
  if (staggeredPollingStarted) {
    clearAllTimers();
    staggeredPollingStarted = false;
    initialized = false;
    hasWarmedUp = false;
  }
}

export async function markMessageAsProcessed(msgId: string, tenantId?: number): Promise<void> {
  if (tenantId != null) {
    await markPollingProcessed(msgId, tenantId);
  } else {
    addToLocalCache(msgId);
  }
}

export function resetPollingCache(): void {
  // Do NOT clear localProcessedIds — grouped polling messages that are only
  // tracked in memory (not saved to DB individually) would be re-processed
  // after reconnect. Keeping the existing cache prevents duplicates.
  // hasWarmedUp = false triggers a DB reload on the next cycle so any newly
  // committed messages are also loaded into the local cache.
  hasWarmedUp = false;
  logger.info("Polling: dedup cache refreshed (triggered by WhatsApp reconnect) — warm-up will merge DB entries on next cycle");
}
