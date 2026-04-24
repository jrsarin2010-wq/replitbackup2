import { getRedis } from "./redis";
import { logger } from "./logger";

const AI_CALLS_PER_MINUTE = 30;
const CIRCUIT_BREAKER_ERROR_THRESHOLD = 11;
const CIRCUIT_BREAKER_WINDOW_MS = 60_000;
const CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;
const EVICTION_INTERVAL_MS = 5 * 60_000;

const FALLBACK_MSG_RATE_LIMIT_GENERIC =
  "Estamos com muitas mensagens no momento, por favor aguarde alguns instantes e tente novamente.";
const FALLBACK_MSG_CIRCUIT_OPEN_GENERIC =
  "Estamos passando por uma instabilidade temporaria. Por favor, tente novamente em alguns minutos.";

interface SlidingWindowEntry {
  timestamps: number[];
}

interface CircuitState {
  errorTimestamps: number[];
  openUntil: number | null;
}

const inMemoryRateMap = new Map<number, SlidingWindowEntry>();
const inMemoryCircuitMap = new Map<number, CircuitState>();

function pruneTimestamps(timestamps: number[], windowMs: number): number[] {
  const cutoff = Date.now() - windowMs;
  return timestamps.filter((t) => t > cutoff);
}

const RATE_LIMIT_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local cutoff = now - window

redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)
local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now, now .. ':' .. math.random(1000000))
  redis.call('EXPIRE', key, math.ceil(window / 1000) + 5)
  return {1, limit - count - 1}
else
  redis.call('EXPIRE', key, math.ceil(window / 1000) + 5)
  return {0, 0}
end
`;

export async function checkAndRecordAICall(
  tenantId: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const redis = getRedis();
  if (redis) {
    return checkAndRecordRedis(redis, tenantId);
  }
  return checkAndRecordInMemory(tenantId);
}

async function checkAndRecordRedis(
  redis: import("ioredis").default,
  tenantId: number,
): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const key = `rl:ai:zset:${tenantId}`;
    const now = Date.now();
    const result = await redis.eval(
      RATE_LIMIT_LUA,
      1,
      key,
      String(now),
      String(60_000),
      String(AI_CALLS_PER_MINUTE),
    ) as [number, number];
    return { allowed: result[0] === 1, remaining: result[1] };
  } catch {
    return checkAndRecordInMemory(tenantId);
  }
}

function checkAndRecordInMemory(
  tenantId: number,
): { allowed: boolean; remaining: number } {
  let entry = inMemoryRateMap.get(tenantId);
  if (!entry) {
    entry = { timestamps: [] };
    inMemoryRateMap.set(tenantId, entry);
  }
  entry.timestamps = pruneTimestamps(entry.timestamps, 60_000);
  if (entry.timestamps.length < AI_CALLS_PER_MINUTE) {
    entry.timestamps.push(Date.now());
    const remaining = AI_CALLS_PER_MINUTE - entry.timestamps.length;
    return { allowed: true, remaining };
  }
  return { allowed: false, remaining: 0 };
}

export async function checkTenantRateLimit(
  tenantId: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const redis = getRedis();
  if (redis) {
    try {
      const key = `rl:ai:zset:${tenantId}`;
      const cutoff = Date.now() - 60_000;
      await redis.zremrangebyscore(key, "-inf", String(cutoff));
      const count = await redis.zcard(key);
      const remaining = Math.max(0, AI_CALLS_PER_MINUTE - count);
      return { allowed: count < AI_CALLS_PER_MINUTE, remaining };
    } catch {
      return checkRateLimitInMemory(tenantId);
    }
  }
  return checkRateLimitInMemory(tenantId);
}

function checkRateLimitInMemory(
  tenantId: number,
): { allowed: boolean; remaining: number } {
  const entry = inMemoryRateMap.get(tenantId);
  if (!entry) {
    return { allowed: true, remaining: AI_CALLS_PER_MINUTE };
  }
  entry.timestamps = pruneTimestamps(entry.timestamps, 60_000);
  const remaining = Math.max(0, AI_CALLS_PER_MINUTE - entry.timestamps.length);
  return { allowed: entry.timestamps.length < AI_CALLS_PER_MINUTE, remaining };
}

export async function recordTenantAICall(tenantId: number): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      const key = `rl:ai:zset:${tenantId}`;
      const now = Date.now();
      await redis.zadd(key, String(now), `${now}:${Math.random()}`);
      await redis.expire(key, 65);
    } catch {
      recordAICallInMemory(tenantId);
    }
    return;
  }
  recordAICallInMemory(tenantId);
}

function recordAICallInMemory(tenantId: number): void {
  let entry = inMemoryRateMap.get(tenantId);
  if (!entry) {
    entry = { timestamps: [] };
    inMemoryRateMap.set(tenantId, entry);
  }
  entry.timestamps = pruneTimestamps(entry.timestamps, 60_000);
  entry.timestamps.push(Date.now());
}

export async function isTenantCircuitOpen(tenantId: number): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    return isCircuitOpenRedis(redis, tenantId);
  }
  return isCircuitOpenInMemory(tenantId);
}

export async function recordTenantError(tenantId: number): Promise<void> {
  const redis = getRedis();
  if (redis) {
    await recordErrorRedis(redis, tenantId);
    return;
  }
  recordErrorInMemory(tenantId);
}

export async function resetTenantCircuit(tenantId: number): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(`cb:errors:${tenantId}`, `cb:open:${tenantId}`);
    } catch {}
  }
  inMemoryCircuitMap.delete(tenantId);
}

async function isCircuitOpenRedis(
  redis: import("ioredis").default,
  tenantId: number,
): Promise<boolean> {
  try {
    const openUntil = await redis.get(`cb:open:${tenantId}`);
    if (openUntil) {
      const expiryTs = Number(openUntil);
      if (Date.now() < expiryTs) {
        return true;
      }
      await redis.del(`cb:open:${tenantId}`, `cb:errors:${tenantId}`);
      logger.info({ tenantId, expiredAt: new Date(expiryTs).toISOString() }, "Circuit breaker closed — tenant resumed (cooldown expired)");
      return false;
    }
    return false;
  } catch {
    return isCircuitOpenInMemory(tenantId);
  }
}

async function recordErrorRedis(
  redis: import("ioredis").default,
  tenantId: number,
): Promise<void> {
  try {
    const key = `cb:errors:${tenantId}`;
    const now = Date.now();
    const cutoff = now - CIRCUIT_BREAKER_WINDOW_MS;
    const pipeline = redis.pipeline();
    pipeline.zadd(key, String(now), `${now}:${Math.random()}`);
    pipeline.zremrangebyscore(key, "-inf", String(cutoff));
    pipeline.zcard(key);
    pipeline.expire(key, Math.ceil(CIRCUIT_BREAKER_WINDOW_MS / 1000) + 10);
    const results = await pipeline.exec();

    const count = (results?.[2]?.[1] as number) ?? 0;
    if (count >= CIRCUIT_BREAKER_ERROR_THRESHOLD) {
      const openUntil = now + CIRCUIT_BREAKER_COOLDOWN_MS;
      await redis.set(`cb:open:${tenantId}`, String(openUntil), "EX", Math.ceil(CIRCUIT_BREAKER_COOLDOWN_MS / 1000) + 5);
      logger.warn(
        { tenantId, errorCount: count, openUntilTs: new Date(openUntil).toISOString() },
        "Circuit breaker OPENED — tenant AI calls paused",
      );
    }
  } catch {
    recordErrorInMemory(tenantId);
  }
}

function isCircuitOpenInMemory(tenantId: number): boolean {
  const state = inMemoryCircuitMap.get(tenantId);
  if (!state || !state.openUntil) return false;
  if (Date.now() < state.openUntil) return true;
  inMemoryCircuitMap.delete(tenantId);
  logger.info({ tenantId }, "Circuit breaker closed — tenant resumed");
  return false;
}

function recordErrorInMemory(tenantId: number): void {
  let state = inMemoryCircuitMap.get(tenantId);
  if (!state) {
    state = { errorTimestamps: [], openUntil: null };
    inMemoryCircuitMap.set(tenantId, state);
  }
  state.errorTimestamps = pruneTimestamps(
    state.errorTimestamps,
    CIRCUIT_BREAKER_WINDOW_MS,
  );
  state.errorTimestamps.push(Date.now());

  if (state.errorTimestamps.length >= CIRCUIT_BREAKER_ERROR_THRESHOLD) {
    const openUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
    state.openUntil = openUntil;
    logger.warn(
      {
        tenantId,
        errorCount: state.errorTimestamps.length,
        openUntilTs: new Date(openUntil).toISOString(),
      },
      "Circuit breaker OPENED — tenant AI calls paused",
    );
  }
}

function evictStaleEntries(): void {
  const now = Date.now();
  for (const [tenantId, entry] of inMemoryRateMap) {
    entry.timestamps = pruneTimestamps(entry.timestamps, 60_000);
    if (entry.timestamps.length === 0) {
      inMemoryRateMap.delete(tenantId);
    }
  }
  for (const [tenantId, state] of inMemoryCircuitMap) {
    if (state.openUntil && now >= state.openUntil) {
      logger.info({ tenantId, expiredAt: new Date(state.openUntil).toISOString() }, "Circuit breaker closed — tenant resumed (cooldown expired during eviction)");
      inMemoryCircuitMap.delete(tenantId);
      continue;
    }
    state.errorTimestamps = pruneTimestamps(state.errorTimestamps, CIRCUIT_BREAKER_WINDOW_MS);
    if (state.errorTimestamps.length === 0 && !state.openUntil) {
      inMemoryCircuitMap.delete(tenantId);
    }
  }
}

const _evictionTimer = setInterval(evictStaleEntries, EVICTION_INTERVAL_MS);
_evictionTimer.unref();

export function getFallbackMessage(
  reason: "rate_limit" | "circuit_open" | "ai_failure",
  clinicName?: string | null,
  aiName?: string | null,
): string {
  const name = aiName?.trim() || null;
  const clinic = clinicName?.trim() || null;

  const intro = name && clinic
    ? `Oi! Aqui e a ${name}, da ${clinic}.`
    : name
    ? `Oi! Aqui e a ${name}.`
    : clinic
    ? `Oi! Aqui e a equipe da ${clinic}.`
    : "Oi!";

  switch (reason) {
    case "rate_limit":
      return `${intro} Estamos com muitas mensagens no momento — aguarda so um instante que te respondo logo!`;
    case "circuit_open":
      return `${intro} Estou com uma dificuldade tecnica agora. Tenta de novo em alguns minutinhos, ta?`;
    case "ai_failure":
      return `${intro} Estou com uma dificuldade tecnica agora e nao consegui processar sua mensagem. Alguem da nossa equipe vai entrar em contato em breve. Desculpa o inconveniente!`;
    default:
      return reason === "rate_limit" ? FALLBACK_MSG_RATE_LIMIT_GENERIC : FALLBACK_MSG_CIRCUIT_OPEN_GENERIC;
  }
}

export {
  AI_CALLS_PER_MINUTE,
  CIRCUIT_BREAKER_ERROR_THRESHOLD,
  CIRCUIT_BREAKER_WINDOW_MS,
  CIRCUIT_BREAKER_COOLDOWN_MS,
};
