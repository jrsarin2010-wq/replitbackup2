import { logger } from "./logger";
import { maskPhone } from "./pii-mask";

const DEBOUNCE_MS = Number(process.env.AGGREGATOR_DEBOUNCE_MS || 1500);
const MAX_BATCH_SIZE = 20;

export interface AggregatorResult {
  shouldReply: boolean;
  reply?: string;
  error?: unknown;
  aggregatedCount: number;
  waitMs: number;
}

type Processor = (combinedText: string, aggregatedCount: number) => Promise<string>;

interface BatchEntry {
  tenantId: number;
  contactPhone: string;
  texts: string[];
  callbacks: Array<(result: AggregatorResult) => void>;
  timer: ReturnType<typeof setTimeout>;
  startedAt: number;
  processor: Processor;
}

const batches = new Map<string, BatchEntry>();
// Per-conversation serialization chain: ensures only ONE processor runs at a time per key.
// New batches that fire while a previous processor is still running are queued behind it.
const chains = new Map<string, Promise<void>>();

function buildKey(tenantId: number, contactPhone: string): string {
  return `${tenantId}:${contactPhone}`;
}

async function runBatch(key: string, entry: BatchEntry): Promise<void> {
  const combined = entry.texts.join("\n");
  const aggregatedCount = entry.texts.length;
  const waitMs = Date.now() - entry.startedAt;

  if (aggregatedCount > 1) {
    logger.info(
      {
        tenantId: entry.tenantId,
        contactPhone: maskPhone(entry.contactPhone),
        aggregatedCount,
        waitMs,
      },
      "Aggregator: batch fired with multiple messages",
    );
  }

  let reply: string | undefined;
  let error: unknown;
  try {
    reply = await entry.processor(combined, aggregatedCount);
  } catch (e) {
    error = e;
  }

  for (let i = 0; i < entry.callbacks.length; i++) {
    const isLast = i === entry.callbacks.length - 1;
    entry.callbacks[i]({
      shouldReply: isLast,
      reply: isLast ? reply : undefined,
      error: isLast ? error : undefined,
      aggregatedCount,
      waitMs,
    });
  }
}

function fireBatch(key: string): void {
  const entry = batches.get(key);
  if (!entry) return;
  batches.delete(key);

  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => runBatch(key, entry));
  chains.set(key, next);
  next.finally(() => {
    if (chains.get(key) === next) chains.delete(key);
  });
}

/**
 * Enqueue an inbound message for aggregated processing.
 * - If no batch exists for this conversation, starts a new one with a 1.5s debounce timer.
 * - If a batch exists, appends the text and resets the timer (trailing-edge debounce).
 * - When the timer fires, the processor is called ONCE with all aggregated texts joined.
 * - Only the LAST caller receives shouldReply=true; earlier callers get shouldReply=false
 *   and should NOT send a reply (to avoid duplicate AI responses).
 */
export function enqueueIncomingMessage(
  tenantId: number,
  contactPhone: string,
  text: string,
  processor: Processor,
): Promise<AggregatorResult> {
  return new Promise<AggregatorResult>((resolve) => {
    const key = buildKey(tenantId, contactPhone);
    const existing = batches.get(key);

    if (existing) {
      if (existing.texts.length >= MAX_BATCH_SIZE) {
        logger.warn(
          { tenantId, contactPhone: maskPhone(contactPhone), max: MAX_BATCH_SIZE },
          "Aggregator: batch reached max size — skipping this message from batch",
        );
        resolve({ shouldReply: false, aggregatedCount: existing.texts.length, waitMs: 0 });
        return;
      }
      existing.texts.push(text);
      existing.callbacks.push(resolve);
      existing.processor = processor;
      clearTimeout(existing.timer);
      existing.timer = setTimeout(() => fireBatch(key), DEBOUNCE_MS);
      return;
    }

    const entry: BatchEntry = {
      tenantId,
      contactPhone,
      texts: [text],
      callbacks: [resolve],
      startedAt: Date.now(),
      processor,
      timer: setTimeout(() => fireBatch(key), DEBOUNCE_MS),
    };
    batches.set(key, entry);
  });
}

export function _resetForTests(): void {
  for (const entry of batches.values()) {
    clearTimeout(entry.timer);
  }
  batches.clear();
}

/**
 * Drain all pending batches: fire any pending debounce timers immediately and
 * await the per-conversation processor chains to settle, bounded by maxWaitMs.
 *
 * Safe to call when there are no pending batches (returns 0 immediately).
 * Intended for graceful shutdown so in-flight conversations still get a reply.
 */
export async function drainPendingBatches(maxWaitMs: number = 5000): Promise<number> {
  const pendingKeys = Array.from(batches.keys());
  for (const key of pendingKeys) {
    const entry = batches.get(key);
    if (entry) clearTimeout(entry.timer);
    fireBatch(key);
  }

  const drained = pendingKeys.length;
  const activeChains = Array.from(chains.values());
  if (activeChains.length === 0) return drained;

  const settle = Promise.allSettled(activeChains).then(() => undefined);
  const timeout = new Promise<"timeout">((resolve) => {
    setTimeout(() => resolve("timeout"), maxWaitMs).unref?.();
  });

  const result = await Promise.race([settle, timeout]);
  if (result === "timeout") {
    logger.warn(
      { drained, pendingChains: chains.size, maxWaitMs },
      "Aggregator: drain timeout — some batches may not have completed",
    );
  }
  return drained;
}
