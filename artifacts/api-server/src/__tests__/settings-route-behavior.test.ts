/**
 * Teste comportamental: PUT /settings → getCachedSettings() retorna valor novo
 *
 * Usa o settingsCache REAL (não mockado) para validar que após o PUT,
 * a próxima chamada de getCachedSettings() reflete o valor escrito no banco.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── DB mock: controla os dados retornados pelo banco ──────────────────────────
const { mockFindFirst, mockReturning, mockSetCapture } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockReturning: vi.fn(),
  mockSetCapture: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  const chain: Record<string, unknown> = {};
  chain.set = (data: unknown) => { mockSetCapture(data); return chain; };
  chain.where = () => chain;
  chain.returning = () => mockReturning();
  chain.values = () => chain;
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

// ── Tenant middleware: injeta tenantId=1 sem validar JWT ──────────────────────
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

// ── Schema Zod: retorna body sem transformações ────────────────────────────────
vi.mock("@workspace/api-zod", () => ({
  UpdateSettingsBody: { parse: (body: unknown) => body },
}));

// ── Cache REAL (não mockado) — permite validar o fluxo completo ───────────────
const { settingsCache, getCachedSettings } = await import("../lib/cache.js");

// ── Route REAL importada após todos os mocks ──────────────────────────────────
const { default: settingsRouter } = await import("../routes/dental/settings.js");

const app = express();
app.use(express.json());
app.use("/", settingsRouter);

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await settingsCache.invalidateAll();
  vi.resetAllMocks();
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const rowBefore = {
  id: 1,
  tenantId: 1,
  clinicName: "Clínica Antiga",
  acceptsInsurance: false,
  telegramBotToken: null,
};

const rowAfter = {
  id: 1,
  tenantId: 1,
  clinicName: "Clínica Nova",
  acceptsInsurance: true,
  telegramBotToken: null,
};

// ─────────────────────────────────────────────────────────────────────────────

describe("PUT /settings → getCachedSettings() retorna valor atualizado", () => {
  it("cache stale é descartado: getCachedSettings() busca o valor novo do banco após PUT", async () => {
    // 1. Popula cache com dado antigo (simula chamada anterior de getCachedSettings)
    mockFindFirst.mockResolvedValueOnce(rowBefore);
    await getCachedSettings(1); // → cache tem rowBefore
    expect(await settingsCache.get(1)).toMatchObject({ clinicName: "Clínica Antiga" });

    // 2. PUT /settings: banco atualiza, rota invalida cache APÓS a escrita
    mockFindFirst.mockResolvedValueOnce(rowBefore); // existing check na rota
    mockReturning.mockResolvedValue([rowAfter]);    // db.update().returning()

    const putRes = await request(app)
      .put("/")
      .send({ clinicName: "Clínica Nova", acceptsInsurance: true });

    expect(putRes.status).toBe(200);

    // 3. Cache deve estar vazio (foi invalidado pelo PUT)
    expect(await settingsCache.get(1)).toBeUndefined();

    // 4. getCachedSettings() vai ao banco e retorna o valor novo
    mockFindFirst.mockResolvedValueOnce(rowAfter);
    const fresh = await getCachedSettings(1);

    expect(fresh?.clinicName).toBe("Clínica Nova");
    expect(fresh?.acceptsInsurance).toBe(true);
  });

  it("sem PUT, getCachedSettings() continua servindo valor do cache (controle negativo)", async () => {
    // Cache populado com dado antigo
    mockFindFirst.mockResolvedValueOnce(rowBefore);
    await getCachedSettings(1);

    // Sem PUT — banco não é consultado novamente
    const result = await getCachedSettings(1);
    expect(result?.clinicName).toBe("Clínica Antiga");
    expect(mockFindFirst).toHaveBeenCalledTimes(1); // só uma chamada ao banco
  });

  it("PUT com campos depreciados do titular não persiste esses campos no banco (Task #4)", async () => {
    mockFindFirst.mockResolvedValueOnce(rowBefore);
    mockReturning.mockResolvedValue([rowAfter]);

    const res = await request(app)
      .put("/")
      .send({
        clinicName: "Clínica Nova",
        // Campos depreciados que não devem mais ser salvos via settings
        professionalCro: "CRO-SP 99999",
        professionalSpecialties: "Implantodontia",
        chargesConsultation: false,
        consultationFee: "250.00",
        defaultLeadDurationMinutes: 45,
        defaultPatientDurationMinutes: 60,
        acceptsInsurance: true,
        insurancePlans: "Unimed",
        insuranceDays: "1,2",
        insuranceHoursStart: "09:00",
        insuranceHoursEnd: "13:00",
      });

    expect(res.status).toBe(200);

    // Verifica que o set() do banco não recebeu nenhum campo depreciado
    const savedData = mockSetCapture.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(savedData).toBeDefined();
    expect(savedData).not.toHaveProperty("professionalCro");
    expect(savedData).not.toHaveProperty("professionalSpecialties");
    expect(savedData).not.toHaveProperty("chargesConsultation");
    expect(savedData).not.toHaveProperty("consultationFee");
    expect(savedData).not.toHaveProperty("defaultLeadDurationMinutes");
    expect(savedData).not.toHaveProperty("defaultPatientDurationMinutes");
    expect(savedData).not.toHaveProperty("acceptsInsurance");
    expect(savedData).not.toHaveProperty("insurancePlans");
    expect(savedData).not.toHaveProperty("insuranceDays");
    expect(savedData).not.toHaveProperty("insuranceHoursStart");
    expect(savedData).not.toHaveProperty("insuranceHoursEnd");
    // clinicName legítimo deve ser salvo
    expect(savedData).toHaveProperty("clinicName", "Clínica Nova");
  });

  it("PATCH /pause-status: cache é invalidado e getCachedSettings() retorna automationsPaused atualizado", async () => {
    // Importa o router de risk-control com os mocks já ativos
    const { default: riskRouter } = await import("../routes/dental/risk-control.js");
    const riskApp = express();
    riskApp.use(express.json());
    riskApp.use("/", riskRouter);

    const rowPaused = { ...rowBefore, automationsPaused: true };

    // 1. Popula cache
    mockFindFirst.mockResolvedValueOnce(rowBefore);
    await getCachedSettings(1);
    expect(await settingsCache.get(1)).toMatchObject({ clinicName: "Clínica Antiga" });

    // 2. PATCH /pause-status: banco atualiza, cache é invalidado
    mockFindFirst.mockResolvedValueOnce(rowBefore); // existing check
    mockReturning.mockResolvedValue([rowPaused]);

    const patchRes = await request(riskApp)
      .patch("/pause-status")
      .send({ automationsPaused: true });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.automationsPaused).toBe(true);

    // 3. Cache vazio após invalidação
    expect(await settingsCache.get(1)).toBeUndefined();

    // 4. getCachedSettings() retorna valor novo
    mockFindFirst.mockResolvedValueOnce(rowPaused);
    const fresh = await getCachedSettings(1);
    expect(fresh?.automationsPaused).toBe(true);
  });
});
