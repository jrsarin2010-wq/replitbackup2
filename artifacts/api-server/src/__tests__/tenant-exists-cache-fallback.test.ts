/**
 * Pin the local-fallback TTL behavior of `tenantExistsCache` across the
 * deployment matrix:
 *
 *   1. Single instance + no Redis  → uses 300 s local TTL
 *   2. Multi-instance + no Redis   → uses 30 s local TTL
 *   3. Redis available             → Redis path used; local fallback irrelevant
 *   4. Redis SETEX throws          → falls back to local with the
 *                                    multi-instance-aware TTL
 *
 * Why this matters: when the API runs on multiple servers without a shared
 * Redis, each process owns its own in-memory cache. A 5-minute TTL would
 * leave a 5-minute window in which a deleted tenant still appears live on
 * other instances. Task #5 shortened the local TTL to 30 s in that mode
 * (via the `localFallbackTtlSeconds` option on `TenantCache`); these tests
 * pin that behavior so a future refactor cannot silently regress it.
 *
 * Note: Redis SETEX always uses the long (300 s) TTL — Redis is shared, so
 * the fleet sees invalidations instantly. Only the local fallback shortens.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockGetRedis } = vi.hoisted(() => ({
  mockGetRedis: vi.fn<() => unknown>(),
}));

vi.mock("../lib/redis.js", () => ({
  getRedis: () => mockGetRedis(),
  isRedisAvailable: () => mockGetRedis() !== null,
  initRedis: vi.fn(),
  closeRedis: vi.fn(),
}));

// Avoid pulling the real DB into module init.
vi.mock("@workspace/db", () => ({
  db: {
    query: {
      dentalSettingsTable: { findFirst: vi.fn() },
      dentalProceduresTable: { findMany: vi.fn() },
      dentalProfessionalsTable: { findMany: vi.fn() },
    },
  },
  dentalSettingsTable: { tenantId: {} },
  dentalProceduresTable: { tenantId: {}, active: {} },
  dentalProfessionalsTable: { tenantId: {}, isActive: {} },
}));

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
}));

import {
  TenantCache,
  tenantExistsCache,
  isMultiInstanceDeployment,
} from "../lib/cache.js";

const ORIGINAL_INSTANCE_COUNT = process.env["APP_INSTANCE_COUNT"];

function setInstanceCount(value: string | undefined) {
  if (value === undefined) {
    delete process.env["APP_INSTANCE_COUNT"];
  } else {
    process.env["APP_INSTANCE_COUNT"] = value;
  }
}

type LocalEntry = { data: unknown; expiresAt: number };
function localCacheOf(c: unknown): Map<number, LocalEntry> {
  return (c as { localCache: Map<number, LocalEntry> }).localCache;
}

beforeEach(() => {
  mockGetRedis.mockReset();
  // Wipe any prior local-fallback state so tests are deterministic.
  // tenantExistsCache is a module-level singleton.
  void tenantExistsCache.invalidateAll();
});

afterEach(() => {
  setInstanceCount(ORIGINAL_INSTANCE_COUNT);
});

describe("isMultiInstanceDeployment()", () => {
  it("returns false when APP_INSTANCE_COUNT is unset", () => {
    setInstanceCount(undefined);
    expect(isMultiInstanceDeployment()).toBe(false);
  });

  it("returns false when APP_INSTANCE_COUNT=1", () => {
    setInstanceCount("1");
    expect(isMultiInstanceDeployment()).toBe(false);
  });

  it("returns true when APP_INSTANCE_COUNT=2", () => {
    setInstanceCount("2");
    expect(isMultiInstanceDeployment()).toBe(true);
  });

  it("returns true for higher counts", () => {
    setInstanceCount("8");
    expect(isMultiInstanceDeployment()).toBe(true);
  });

  it("returns false for non-numeric values", () => {
    setInstanceCount("not-a-number");
    expect(isMultiInstanceDeployment()).toBe(false);
  });
});

describe("tenantExistsCache — local fallback TTL matrix", () => {
  it("case 1: single instance + no Redis → uses 300 s local TTL", async () => {
    setInstanceCount(undefined);
    mockGetRedis.mockReturnValue(null);

    const beforeSet = Date.now();
    await tenantExistsCache.set(42, true);
    const afterSet = Date.now();

    const entry = localCacheOf(tenantExistsCache).get(42);
    expect(entry).toBeDefined();
    expect(entry!.expiresAt - beforeSet).toBeGreaterThanOrEqual(300_000);
    // Allow a small upper slack for time elapsed inside set().
    expect(entry!.expiresAt - afterSet).toBeLessThanOrEqual(300_000);
  });

  it("case 2: multi-instance (APP_INSTANCE_COUNT=2) + no Redis → uses 30 s local TTL", async () => {
    setInstanceCount("2");
    mockGetRedis.mockReturnValue(null);

    const beforeSet = Date.now();
    await tenantExistsCache.set(42, true);
    const afterSet = Date.now();

    const entry = localCacheOf(tenantExistsCache).get(42);
    expect(entry).toBeDefined();
    expect(entry!.expiresAt - beforeSet).toBeGreaterThanOrEqual(30_000);
    // Hard upper bound: must be < 60 s, proving it is NOT the 5-minute TTL.
    expect(entry!.expiresAt - afterSet).toBeLessThan(60_000);
  });

  it("case 3: Redis available (single instance) → Redis SETEX used; nothing written to local fallback", async () => {
    setInstanceCount(undefined);
    const setex = vi.fn().mockResolvedValue("OK");
    mockGetRedis.mockReturnValue({ setex });

    await tenantExistsCache.set(42, true);

    expect(setex).toHaveBeenCalledTimes(1);
    expect(setex).toHaveBeenCalledWith(
      "cache:tenant-exists:42",
      300,
      JSON.stringify(true),
    );
    expect(localCacheOf(tenantExistsCache).has(42)).toBe(false);
  });

  it("case 3b: Redis available + multi-instance → Redis SETEX still uses 300 s (Redis is shared)", async () => {
    setInstanceCount("3");
    const setex = vi.fn().mockResolvedValue("OK");
    mockGetRedis.mockReturnValue({ setex });

    await tenantExistsCache.set(7, true);

    // Redis stays at the long TTL because a shared store doesn't suffer the
    // multi-instance staleness problem; only the local fallback shortens.
    expect(setex).toHaveBeenCalledWith(
      "cache:tenant-exists:7",
      300,
      JSON.stringify(true),
    );
    expect(localCacheOf(tenantExistsCache).has(7)).toBe(false);
  });

  it("case 4: Redis SETEX throws + multi-instance → falls back to local with 30 s TTL", async () => {
    setInstanceCount("4");
    const setex = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    mockGetRedis.mockReturnValue({ setex });

    const beforeSet = Date.now();
    await tenantExistsCache.set(99, true);
    const afterSet = Date.now();

    expect(setex).toHaveBeenCalledTimes(1);

    const entry = localCacheOf(tenantExistsCache).get(99);
    expect(entry).toBeDefined();
    expect(entry!.expiresAt - beforeSet).toBeGreaterThanOrEqual(30_000);
    expect(entry!.expiresAt - afterSet).toBeLessThan(60_000);
  });

  it("case 4b: Redis SETEX throws + single instance → falls back to local with 300 s TTL", async () => {
    setInstanceCount(undefined);
    const setex = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    mockGetRedis.mockReturnValue({ setex });

    const beforeSet = Date.now();
    await tenantExistsCache.set(123, true);

    const entry = localCacheOf(tenantExistsCache).get(123);
    expect(entry).toBeDefined();
    expect(entry!.expiresAt - beforeSet).toBeGreaterThanOrEqual(300_000);
  });
});

describe("TenantCache — localFallbackTtlSeconds option semantics", () => {
  it("without localFallbackTtlSeconds, multi-instance does NOT shorten the local TTL", async () => {
    setInstanceCount("2");
    mockGetRedis.mockReturnValue(null);
    const cache = new TenantCache<true>("no-fallback-opt", 120);

    const t = Date.now();
    await cache.set(1, true);

    const entry = localCacheOf(cache).get(1)!;
    expect(entry.expiresAt - t).toBeGreaterThanOrEqual(120_000);
  });

  it("localFallbackTtlSeconds is ignored on single-instance deployments", async () => {
    setInstanceCount(undefined);
    mockGetRedis.mockReturnValue(null);
    const cache = new TenantCache<true>("single-inst", 300, {
      localFallbackTtlSeconds: 30,
    });

    const t = Date.now();
    await cache.set(1, true);

    const entry = localCacheOf(cache).get(1)!;
    // Single instance → full 300 s TTL, not 30 s.
    expect(entry.expiresAt - t).toBeGreaterThanOrEqual(300_000);
  });

  it("localFallbackTtlSeconds is only honored when it is shorter than the main TTL", async () => {
    setInstanceCount("2");
    mockGetRedis.mockReturnValue(null);
    // Pathological config: fallback TTL > main TTL → guard returns main TTL.
    const cache = new TenantCache<true>("inverted", 60, {
      localFallbackTtlSeconds: 600,
    });

    const t = Date.now();
    await cache.set(1, true);

    const entry = localCacheOf(cache).get(1)!;
    expect(entry.expiresAt - t).toBeGreaterThanOrEqual(60_000);
    expect(entry.expiresAt - t).toBeLessThan(120_000);
  });
});
