import { db } from "@workspace/db";
import {
  dentalSettingsTable,
  dentalProceduresTable,
  dentalProfessionalsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";
import { decryptIfNeeded, hasEncryptionKey } from "./encryption";
import { getRedis } from "./redis";

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export function isMultiInstanceDeployment(): boolean {
  const raw = process.env["APP_INSTANCE_COUNT"];
  if (!raw) return false;
  const n = Number(raw);
  return Number.isFinite(n) && n > 1;
}

export function getInstanceCount(): number {
  const raw = process.env["APP_INSTANCE_COUNT"];
  if (!raw) return 1;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export class TenantCache<T> {
  private localCache = new Map<number, CacheEntry<T>>();
  private readonly ttlMs: number;
  private readonly ttlSec: number;
  private readonly localFallbackTtlMs: number;
  private readonly name: string;

  constructor(
    name: string,
    ttlSeconds: number = 60,
    options: { localFallbackTtlSeconds?: number } = {},
  ) {
    this.name = name;
    this.ttlSec = ttlSeconds;
    this.ttlMs = ttlSeconds * 1000;
    this.localFallbackTtlMs =
      (options.localFallbackTtlSeconds ?? ttlSeconds) * 1000;
  }

  private effectiveLocalTtlMs(): number {
    if (isMultiInstanceDeployment() && this.localFallbackTtlMs < this.ttlMs) {
      return this.localFallbackTtlMs;
    }
    return this.ttlMs;
  }

  async get(tenantId: number): Promise<T | undefined> {
    const redis = getRedis();
    if (redis) {
      try {
        const val = await redis.get(`cache:${this.name}:${tenantId}`);
        if (val === null) return undefined;
        try {
          return JSON.parse(val) as T;
        } catch {
          logger.warn({ cache: this.name, tenantId }, "Redis cache: invalid JSON — evicting entry");
          await redis.del(`cache:${this.name}:${tenantId}`).catch(() => {});
          return undefined;
        }
      } catch (err) {
        logger.warn({ err: (err as Error).message, cache: this.name }, "Redis GET failed — using local fallback");
      }
    }
    const entry = this.localCache.get(tenantId);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.localCache.delete(tenantId);
      return undefined;
    }
    return entry.data;
  }

  async set(tenantId: number, data: T): Promise<void> {
    const redis = getRedis();
    if (redis) {
      try {
        await redis.setex(`cache:${this.name}:${tenantId}`, this.ttlSec, JSON.stringify(data));
        return;
      } catch (err) {
        logger.warn({ err: (err as Error).message, cache: this.name }, "Redis SETEX failed — using local fallback");
      }
    }
    this.localCache.set(tenantId, { data, expiresAt: Date.now() + this.effectiveLocalTtlMs() });
  }

  async invalidate(tenantId: number): Promise<void> {
    const redis = getRedis();
    if (redis) {
      try {
        await redis.del(`cache:${this.name}:${tenantId}`);
      } catch (err) {
        logger.warn({ err: (err as Error).message, cache: this.name }, "Redis DEL failed — clearing local fallback");
      }
    }
    this.localCache.delete(tenantId);
  }

  async invalidateAll(): Promise<void> {
    const redis = getRedis();
    if (redis) {
      try {
        const pattern = `cache:${this.name}:*`;
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } catch (err) {
        logger.warn({ err: (err as Error).message, cache: this.name }, "Redis KEYS/DEL failed — clearing local fallback");
      }
    }
    this.localCache.clear();
  }

  get size(): number {
    return this.localCache.size;
  }
}

type DentalSettings = Awaited<ReturnType<typeof db.query.dentalSettingsTable.findFirst>>;
type DentalProcedure = Awaited<ReturnType<typeof db.query.dentalProceduresTable.findMany>>[number];
type DentalProfessional = Awaited<ReturnType<typeof db.query.dentalProfessionalsTable.findMany>>[number];

export type CachedProfessional = DentalProfessional & {
  pixEnabled: boolean;
  pixKey: string | null;
  pixMode: string;
};

function decryptSettingsKeys(settings: DentalSettings): DentalSettings {
  if (!settings || !hasEncryptionKey()) return settings;
  return {
    ...settings,
    telegramBotToken: decryptIfNeeded(settings.telegramBotToken) as string | null,
    vapiApiKey: decryptIfNeeded(settings.vapiApiKey) as string | null,
  };
}

export const settingsCache = new TenantCache<DentalSettings>("settings", 120);
export const proceduresCache = new TenantCache<DentalProcedure[]>("procedures", 120);
export const professionalsCache = new TenantCache<CachedProfessional[]>("professionals", 60);
export const tenantExistsCache = new TenantCache<true>("tenant-exists", 300, {
  localFallbackTtlSeconds: 30,
});

export async function getCachedSettings(tenantId: number): Promise<DentalSettings> {
  const cached = await settingsCache.get(tenantId);
  if (cached !== undefined) return cached;
  const fresh = await db.query.dentalSettingsTable.findFirst({
    where: eq(dentalSettingsTable.tenantId, tenantId),
  });
  const decrypted = decryptSettingsKeys(fresh);
  await settingsCache.set(tenantId, decrypted);
  return decrypted;
}

export async function getCachedProcedures(tenantId: number): Promise<DentalProcedure[]> {
  const cached = await proceduresCache.get(tenantId);
  if (cached !== undefined) return cached;
  const fresh = await db.query.dentalProceduresTable.findMany({
    where: and(eq(dentalProceduresTable.tenantId, tenantId), eq(dentalProceduresTable.active, "true")),
  });
  await proceduresCache.set(tenantId, fresh);
  return fresh;
}

export async function getCachedProfessionals(tenantId: number): Promise<CachedProfessional[]> {
  const cached = await professionalsCache.get(tenantId);
  if (cached !== undefined) return cached;
  const fresh = await db.query.dentalProfessionalsTable.findMany({
    where: and(
      eq(dentalProfessionalsTable.tenantId, tenantId),
      eq(dentalProfessionalsTable.isActive, true),
    ),
  });
  await professionalsCache.set(tenantId, fresh);
  return fresh;
}
