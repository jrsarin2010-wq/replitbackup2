import { describe, it, expect, beforeEach } from "vitest";
import { TenantCache } from "../lib/cache.js";

// ─── TenantCache — operações básicas ─────────────────────────────────────────

describe("TenantCache — operações básicas", () => {
  let cache: TenantCache<{ name: string; value: number }>;

  beforeEach(() => {
    cache = new TenantCache("test", 60);
  });

  it("get() retorna undefined para chave inexistente", async () => {
    expect(await cache.get(1)).toBeUndefined();
  });

  it("set() + get() retorna o valor armazenado", async () => {
    await cache.set(1, { name: "clinica", value: 42 });
    expect(await cache.get(1)).toEqual({ name: "clinica", value: 42 });
  });

  it("invalidate() remove o valor — get() retorna undefined", async () => {
    await cache.set(1, { name: "clinica", value: 42 });
    await cache.invalidate(1);
    expect(await cache.get(1)).toBeUndefined();
  });

  it("invalidate() não afeta outros tenants", async () => {
    await cache.set(1, { name: "tenant-1", value: 1 });
    await cache.set(2, { name: "tenant-2", value: 2 });
    await cache.invalidate(1);
    expect(await cache.get(1)).toBeUndefined();
    expect(await cache.get(2)).toEqual({ name: "tenant-2", value: 2 });
  });

  it("invalidateAll() remove todos os tenants", async () => {
    await cache.set(1, { name: "t1", value: 1 });
    await cache.set(2, { name: "t2", value: 2 });
    await cache.set(3, { name: "t3", value: 3 });
    await cache.invalidateAll();
    expect(await cache.get(1)).toBeUndefined();
    expect(await cache.get(2)).toBeUndefined();
    expect(await cache.get(3)).toBeUndefined();
  });

  it("set() sobrescreve valor existente", async () => {
    await cache.set(1, { name: "antigo", value: 1 });
    await cache.set(1, { name: "novo", value: 2 });
    expect(await cache.get(1)).toEqual({ name: "novo", value: 2 });
  });
});

// ─── Invariante de ordem: write → invalidate (não invalidate → write) ─────────

describe("Invariante de ordem — invalidate APÓS escrita no banco", () => {
  let cache: TenantCache<{ acceptsInsurance: boolean }>;

  beforeEach(() => {
    cache = new TenantCache("settings-test", 120);
  });

  it("ordem CORRETA: set (simulando leitura do DB) → invalidate → get retorna undefined (vai ao DB)", async () => {
    await cache.set(1, { acceptsInsurance: false });
    expect(await cache.get(1)).toEqual({ acceptsInsurance: false });

    await cache.invalidate(1);

    expect(await cache.get(1)).toBeUndefined();
  });

  it("ordem ERRADA simulada: invalidate → set (outro processo cacheia dado stale)", async () => {
    await cache.set(1, { acceptsInsurance: false });

    await cache.invalidate(1);
    await cache.set(1, { acceptsInsurance: false });

    expect(await cache.get(1)).toEqual({ acceptsInsurance: false });
  });

  it("após invalidação, próxima leitura do banco (simulada com set) serve o valor novo", async () => {
    await cache.set(1, { acceptsInsurance: false });

    await cache.invalidate(1);

    await cache.set(1, { acceptsInsurance: true });
    expect(await cache.get(1)).toEqual({ acceptsInsurance: true });
  });
});

// ─── Isolamento por tenant — invalidação não vaza entre tenants ───────────────

describe("Isolamento de tenant no cache", () => {
  it("invalidar tenant 1 não afeta configuração do tenant 2", async () => {
    const cache = new TenantCache<{ clinicName: string }>("settings", 120);
    await cache.set(1, { clinicName: "Clínica A" });
    await cache.set(2, { clinicName: "Clínica B" });

    await cache.invalidate(1);

    expect(await cache.get(1)).toBeUndefined();
    expect(await cache.get(2)).toEqual({ clinicName: "Clínica B" });
  });

  it("múltiplas invalidações consecutivas do mesmo tenant não causam erro", async () => {
    const cache = new TenantCache<number>("test", 60);
    await cache.set(1, 42);
    await expect(async () => {
      await cache.invalidate(1);
      await cache.invalidate(1);
      await cache.invalidate(1);
    }).not.toThrow();
    expect(await cache.get(1)).toBeUndefined();
  });

  it("invalidar tenant inexistente não causa erro", async () => {
    const cache = new TenantCache<number>("test", 60);
    await expect(cache.invalidate(999)).resolves.not.toThrow();
  });
});

// ─── TTL — expiração automática ───────────────────────────────────────────────

describe("TenantCache — expiração por TTL", () => {
  it("TTL de 0 segundos faz o cache expirar imediatamente", async () => {
    const cache = new TenantCache<number>("ttl-test", 0);
    await cache.set(1, 42);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await cache.get(1)).toBeUndefined();
  });

  it("size reflete entradas ativas no fallback local (não expiradas)", async () => {
    const cache = new TenantCache<number>("size-test", 60);
    expect(cache.size).toBe(0);
    await cache.set(1, 1);
    await cache.set(2, 2);
    expect(cache.size).toBe(2);
    await cache.invalidate(1);
    expect(cache.size).toBe(1);
  });
});

// ─── Deduplicação cross-instance simulada ────────────────────────────────────

describe("Deduplicação cross-instance (simulada com fallback in-memory)", () => {
  it("dois caches independentes não compartilham estado sem Redis", async () => {
    const cache1 = new TenantCache<string>("isolation-test", 60);
    const cache2 = new TenantCache<string>("isolation-test", 60);

    await cache1.set(1, "from-instance-1");

    // cache2 is a separate instance — without Redis, they are isolated
    // This demonstrates the problem that Redis solves
    expect(await cache2.get(1)).toBeUndefined();
  });

  it("invalidação em um cache não propaga para outro sem Redis", async () => {
    const cache1 = new TenantCache<string>("propagation-test", 60);
    const cache2 = new TenantCache<string>("propagation-test", 60);

    await cache1.set(1, "value");
    await cache2.set(1, "value");

    await cache1.invalidate(1);

    // Without Redis, cache2 still has the value — Redis would propagate DEL
    expect(await cache2.get(1)).toBe("value");
  });
});
