/**
 * Testes de integração: PUT /settings e PATCH /pause-status
 * Verifica que settingsCache.invalidate() é chamado APÓS a escrita no banco.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── Spies criados com vi.hoisted() para serem acessíveis nos mocks ─────────────
const { dbWriteSpy, cacheInvalidateSpy, mockFindFirst, mockReturning } = vi.hoisted(() => ({
  dbWriteSpy: vi.fn(),
  cacheInvalidateSpy: vi.fn(),
  mockFindFirst: vi.fn(),
  mockReturning: vi.fn(),
}));

// ── Mock do banco ──────────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => {
  const chain = {
    set: () => chain,
    where: () => chain,
    returning: () => {
      dbWriteSpy(); // marcador de escrita no banco
      return mockReturning();
    },
    values: () => chain,
  };
  return {
    db: {
      query: { dentalSettingsTable: { findFirst: () => mockFindFirst() } },
      update: () => chain,
      insert: () => chain,
    },
    dentalSettingsTable: {},
    eq: () => ({}),
    and: () => ({}),
  };
});

// ── Mock do cache ──────────────────────────────────────────────────────────────
vi.mock("../lib/cache.js", () => ({
  settingsCache: {
    get: vi.fn().mockReturnValue(undefined),
    set: vi.fn(),
    invalidate: cacheInvalidateSpy,
  },
  getCachedSettings: vi.fn(),
  getCachedProcedures: vi.fn(),
  getCachedProfessionals: vi.fn(),
  TenantCache: class {},
}));

// ── Mock do tenant middleware ──────────────────────────────────────────────────
vi.mock("../middlewares/tenant.js", () => ({
  tenantMiddleware: (
    req: express.Request & { tenantId: number },
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    req.tenantId = 1;
    next();
  },
}));

// ── Mock do schema Zod ────────────────────────────────────────────────────────
vi.mock("@workspace/api-zod", () => ({
  UpdateSettingsBody: { parse: (body: unknown) => body },
}));

// ── Mock do risk-control schema Zod (inline no arquivo, não usa api-zod) ──────
// Não é necessário mockar — o PauseStatusBody está definido inline no risk-control.ts

// ── Importa rotas APÓS configurar todos os mocks ──────────────────────────────
const { default: settingsRouter } = await import("../routes/dental/settings.js");
const { default: riskControlRouter } = await import("../routes/dental/risk-control.js");

// ── Apps Express para os testes ───────────────────────────────────────────────
const settingsApp = express();
settingsApp.use(express.json());
settingsApp.use("/", settingsRouter);

const riskApp = express();
riskApp.use(express.json());
riskApp.use("/", riskControlRouter);

// ── Fixtures ──────────────────────────────────────────────────────────────────
const existingRow = {
  id: 1,
  tenantId: 1,
  clinicName: "Clínica Antiga",
  acceptsInsurance: false,
  telegramBotToken: null,
  automationsPaused: false,
  remarketingPaused: false,
  followupPaused: false,
  birthdayPaused: false,
  recoveryPaused: false,
};

const updatedRow = {
  ...existingRow,
  clinicName: "Clínica Nova",
  acceptsInsurance: true,
};

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
});

// ── PUT /settings — tenant existente (update) ──────────────────────────────────

describe("PUT /settings — db.update() + cache.invalidate()", () => {
  it("retorna 200 com o row atualizado", async () => {
    mockFindFirst.mockResolvedValue(existingRow);
    mockReturning.mockResolvedValue([updatedRow]);

    const res = await request(settingsApp)
      .put("/")
      .send({ clinicName: "Clínica Nova", acceptsInsurance: true });

    expect(res.status).toBe(200);
    expect(res.body.clinicName).toBe("Clínica Nova");
  });

  it("db.write() é chamado antes de cache.invalidate() — ordem correta", async () => {
    mockFindFirst.mockResolvedValue(existingRow);
    mockReturning.mockResolvedValue([updatedRow]);

    await request(settingsApp)
      .put("/")
      .send({ clinicName: "Clínica Nova" });

    expect(dbWriteSpy).toHaveBeenCalledTimes(1);
    expect(cacheInvalidateSpy).toHaveBeenCalledTimes(1);
    expect(cacheInvalidateSpy).toHaveBeenCalledWith(1); // tenantId=1

    // invocationCallOrder garante que dbWriteSpy foi chamado antes de cacheInvalidateSpy
    const dbOrder = dbWriteSpy.mock.invocationCallOrder[0]!;
    const cacheOrder = cacheInvalidateSpy.mock.invocationCallOrder[0]!;
    expect(dbOrder).toBeLessThan(cacheOrder);
  });

  it("cache.invalidate() NÃO é chamado antes do db.write()", async () => {
    const eventsBeforeDb: string[] = [];

    // Sobrescreve temporariamente para checar se cache.invalidate rodou antes
    cacheInvalidateSpy.mockImplementation(() => {
      if (!dbWriteSpy.mock.calls.length) {
        eventsBeforeDb.push("cache.invalidate chamado antes do db.write — BUG");
      }
    });

    mockFindFirst.mockResolvedValue(existingRow);
    mockReturning.mockResolvedValue([updatedRow]);

    await request(settingsApp)
      .put("/")
      .send({ clinicName: "Clínica Nova" });

    expect(eventsBeforeDb).toHaveLength(0); // sem chamadas prematuras
  });
});

// ── PUT /settings — tenant novo (insert) ──────────────────────────────────────

describe("PUT /settings — db.insert() + cache.invalidate()", () => {
  it("retorna 200 com o row criado", async () => {
    mockFindFirst.mockResolvedValue(undefined); // tenant não existe ainda
    mockReturning.mockResolvedValue([{ ...updatedRow, id: 2 }]);

    const res = await request(settingsApp)
      .put("/")
      .send({ clinicName: "Clínica Nova" });

    expect(res.status).toBe(200);
  });

  it("db.write() é chamado antes de cache.invalidate() no insert", async () => {
    mockFindFirst.mockResolvedValue(undefined);
    mockReturning.mockResolvedValue([{ ...updatedRow, id: 2 }]);

    await request(settingsApp)
      .put("/")
      .send({ clinicName: "Clínica Nova" });

    const dbOrder = dbWriteSpy.mock.invocationCallOrder[0]!;
    const cacheOrder = cacheInvalidateSpy.mock.invocationCallOrder[0]!;
    expect(dbOrder).toBeLessThan(cacheOrder);
  });
});

// ── PATCH /pause-status — risk-control ────────────────────────────────────────

describe("PATCH /pause-status — db.update() + cache.invalidate()", () => {
  it("retorna 200 com flags de pausa atualizadas", async () => {
    mockFindFirst.mockResolvedValue(existingRow);
    mockReturning.mockResolvedValue([{ ...existingRow, automationsPaused: true }]);

    const res = await request(riskApp)
      .patch("/pause-status")
      .send({ automationsPaused: true });

    expect(res.status).toBe(200);
    expect(res.body.automationsPaused).toBe(true);
  });

  it("db.write() é chamado antes de cache.invalidate() no patch de pause-status", async () => {
    mockFindFirst.mockResolvedValue(existingRow);
    mockReturning.mockResolvedValue([{ ...existingRow, remarketingPaused: true }]);

    await request(riskApp)
      .patch("/pause-status")
      .send({ remarketingPaused: true });

    const dbOrder = dbWriteSpy.mock.invocationCallOrder[0]!;
    const cacheOrder = cacheInvalidateSpy.mock.invocationCallOrder[0]!;
    expect(dbOrder).toBeLessThan(cacheOrder);
  });

  it("cache.invalidate() recebe tenantId correto após o update de pause-status", async () => {
    mockFindFirst.mockResolvedValue(existingRow);
    mockReturning.mockResolvedValue([{ ...existingRow, followupPaused: true }]);

    await request(riskApp)
      .patch("/pause-status")
      .send({ followupPaused: true });

    expect(cacheInvalidateSpy).toHaveBeenCalledWith(1);
  });
});

// ── Integração: após PUT, getCachedSettings retorna valor novo ─────────────────

describe("Integração end-to-end: PUT /settings → cache.invalidate() → valor novo disponível", () => {
  it("após PUT, cache é invalidado para que próxima leitura busque dado novo no banco", async () => {
    mockFindFirst.mockResolvedValue(existingRow);
    mockReturning.mockResolvedValue([updatedRow]);

    await request(settingsApp)
      .put("/")
      .send({ acceptsInsurance: true });

    // Cache foi invalidado — próxima chamada de getCachedSettings vai ao banco
    expect(cacheInvalidateSpy).toHaveBeenCalledOnce();
    expect(cacheInvalidateSpy).toHaveBeenCalledWith(1);

    // Confirma que a escrita no banco aconteceu antes da invalidação
    const dbOrder = dbWriteSpy.mock.invocationCallOrder[0]!;
    const cacheOrder = cacheInvalidateSpy.mock.invocationCallOrder[0]!;
    expect(dbOrder).toBeLessThan(cacheOrder);
  });
});
