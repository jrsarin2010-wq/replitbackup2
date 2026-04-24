import Redis from "ioredis";
import { logger } from "./logger";

let _client: Redis | null = null;
let _available = false;

export function getRedis(): Redis | null {
  return _available ? _client : null;
}

export function isRedisAvailable(): boolean {
  return _available;
}

export async function waitForRedis(timeoutMs = 3000): Promise<boolean> {
  if (_available) return true;
  const client = _client;
  if (!client) return false;
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (val: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      client.off("ready", onReady);
      resolve(val);
    };
    const onReady = (): void => finish(true);
    const timer = setTimeout(() => finish(_available), timeoutMs);
    client.on("ready", onReady);
    if (_available) finish(true);
  });
}

export function initRedis(): void {
  const url = process.env["REDIS_URL"];
  if (!url) {
    logger.warn("REDIS_URL not set — Redis disabled, all caches will use in-memory fallback");
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "REDIS_URL is invalid — Redis disabled");
    return;
  }

  const isTls = parsed.protocol === "rediss:";
  const port = parsed.port ? Number(parsed.port) : 6379;
  const db = parsed.pathname && parsed.pathname.length > 1
    ? Number(parsed.pathname.slice(1))
    : 0;

  _client = new Redis({
    host: parsed.hostname,
    port,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: Number.isFinite(db) ? db : 0,
    tls: isTls ? {} : undefined,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });

  _client.on("ready", () => {
    _available = true;
    logger.info("Redis ready — shared cache enabled");
  });

  _client.on("error", (err: Error) => {
    if (_available) {
      logger.warn({ err: err.message }, "Redis error — falling back to in-memory caches");
    }
    _available = false;
  });

  _client.on("reconnecting", () => {
    logger.debug("Redis reconnecting...");
  });

  _client.on("connect", () => {
    logger.debug("Redis TCP connection established");
  });
}

export async function closeRedis(): Promise<void> {
  if (_client) {
    _available = false;
    try {
      await _client.quit();
    } catch {
      _client.disconnect();
    }
    _client = null;
    logger.info("Redis connection closed");
  }
}
