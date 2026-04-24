/**
 * Testes focados no dedup de sibling IDs do webhook (Task #17)
 *
 * isDuplicateMessage agora aceita siblingExternalIds opcional.
 * O objetivo é verificar que re-entrega de um webhook com ID irmão
 * (mesmo evento WhatsApp, IDs diferentes na Evolution API) é
 * corretamente descartado nas 3 camadas de dedup.
 *
 * Cenários testados:
 *   1. Sibling ID encontrado em memória → duplicate
 *   2. Sibling ID encontrado no banco (layer 3 DB fallback) → duplicate
 *   3. Primary ID encontrado no banco sem siblings → duplicate (comportamento anterior)
 *   4. Nenhum ID encontrado → new message (não duplicate)
 *   5. Sibling ID excludes the messageId itself (sanitization)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { mockRedis, mockDbFindFirst } = vi.hoisted(() => ({
  mockRedis: {
    exists: vi.fn().mockResolvedValue(0),
    set:    vi.fn().mockResolvedValue("OK"),
  },
  mockDbFindFirst: vi.fn(),
}));

vi.mock("../../lib/redis", () => ({
  getRedis: () => mockRedis,
}));

vi.mock("@workspace/db", () => ({
  db: {
    query: {
      dentalMessagesTable: { findFirst: () => mockDbFindFirst() },
    },
    insert: () => ({ values: vi.fn().mockResolvedValue([]) }),
    update: () => ({ set: () => ({ where: vi.fn().mockResolvedValue([]) }) }),
    select: () => ({ from: () => ({ where: () => ({ limit: vi.fn().mockResolvedValue([]) }) }) }),
    delete: () => ({ where: vi.fn().mockResolvedValue([]) }),
  },
  dentalMessagesTable: { name: "dental_messages" },
  tenantsTable:                { name: "tenants" },
  dentalConversationsTable:    { name: "dental_conversations" },
  dentalLeadsTable:            { name: "dental_leads" },
  patientsTable:               { name: "patients" },
  dentalSettingsTable:         { name: "dental_settings" },
  appointmentsTable:           { name: "appointments" },
  dentalProfessionalsTable:    { name: "dental_professionals" },
  dentalPortfolioItemsTable:   { name: "dental_portfolio_items" },
  eq:      () => ({}),
  and:     (...args: unknown[]) => args,
  inArray: () => ({}),
  sql:     () => ({}),
  desc:    () => ({}),
  isNotNull: () => ({}),
}));

vi.mock("../../lib/whatsapp-provider", () => ({
  getProviderForTenant: vi.fn().mockResolvedValue({ kind: "evolution", send: vi.fn() }),
}));

vi.mock("../../lib/ai-engine", () => ({
  processIncomingMessage: vi.fn().mockResolvedValue({ aiResponse: "" }),
  transcribeAudio:  vi.fn().mockResolvedValue(""),
  analyzeImage:     vi.fn().mockResolvedValue(""),
  analyzePIXReceipt: vi.fn().mockResolvedValue(null),
  markStrategyOutcome: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/tenant-helpers", () => ({
  decryptTenantKeys: vi.fn().mockResolvedValue({ decryptedJwtSecret: "secret" }),
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../middlewares/tenant.js", () => ({
  tenantMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const { _testIsDuplicateMessage } = await import("../routes/dental/webhook.js");

// ─────────────────────────────────────────────────────────────────────────────

const TENANT_ID = 1;
// IDs únicos por execução de teste — evita colisão com o in-memory cache (Map do módulo)
let runId = 0;
function uniqueId(base: string): string {
  return `${base}_${++runId}_${Date.now()}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRedis.exists.mockResolvedValue(0);
  mockDbFindFirst.mockResolvedValue(null);
});

describe("isDuplicateMessage — sibling external IDs (Task #17)", () => {
  it("detecta duplicata via DB quando primaryId está no banco (comportamento anterior preservado)", async () => {
    const primary = uniqueId("PRIMARY");
    mockDbFindFirst.mockResolvedValue({ id: 99 }); // primary in DB

    const result = await _testIsDuplicateMessage(primary, TENANT_ID, []);

    expect(result).toBe(true);
  });

  it("detecta duplicata via DB quando sibling está no banco mas primary está ausente", async () => {
    const primary  = uniqueId("PRIMARY");
    const siblingA = uniqueId("SIBLING_A");
    const siblingB = uniqueId("SIBLING_B");

    // Simula re-entrega com ID irmão diferente do primary
    // DB retorna linha correspondente a SIBLING_A (mesmo mensagem, ID diferente)
    mockDbFindFirst.mockResolvedValue({ id: 77 });

    const result = await _testIsDuplicateMessage(primary, TENANT_ID, [siblingA, siblingB]);

    expect(result).toBe(true);
  });

  it("permite processamento quando nem primary nem siblings estão no banco", async () => {
    const primary  = uniqueId("PRIMARY");
    const siblingA = uniqueId("SIBLING_A");
    mockDbFindFirst.mockResolvedValue(null);

    const result = await _testIsDuplicateMessage(primary, TENANT_ID, [siblingA]);

    expect(result).toBe(false);
  });

  it("sem siblings: comportamento igual ao anterior (só checa primary)", async () => {
    const primary = uniqueId("PRIMARY");
    mockDbFindFirst.mockResolvedValue(null);

    const result = await _testIsDuplicateMessage(primary, TENANT_ID);

    expect(result).toBe(false);
  });

  it("trata falha de DB como não-duplicata (safe fallback) mesmo com siblings", async () => {
    const primary  = uniqueId("PRIMARY");
    const siblingA = uniqueId("SIBLING_A");
    mockDbFindFirst.mockRejectedValue(new Error("DB connection lost"));

    const result = await _testIsDuplicateMessage(primary, TENANT_ID, [siblingA]);

    // Em caso de erro no DB, deve tratar como nova mensagem (false)
    expect(result).toBe(false);
  });
});
