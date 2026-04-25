import { describe, it, expect, vi } from "vitest";

// ── Mocks (hoisted) ───────────────────────────────────────────────────────────
// Mock only the async DB/cache dependencies; pure helper functions are
// imported from the real modules.

vi.mock("@workspace/db", () => ({
  db: {
    query: {
      dentalLeadsTable: { findFirst: vi.fn().mockResolvedValue(null) },
      patientsTable:    { findFirst: vi.fn().mockResolvedValue(null) },
      appointmentsTable:{ findMany: vi.fn().mockResolvedValue([]) },
    },
  },
  dentalLeadsTable:  { name: "dental_leads" },
  patientsTable:     { name: "patients" },
  appointmentsTable: { name: "appointments" },
}));

vi.mock("../lib/cache", () => ({
  getCachedSettings: vi.fn().mockResolvedValue({
    clinicName:         "Clinica Teste",
    aiName:             "Ana",
    professionalName:   "Dr. João",
    workingHoursStart:  "08:00",
    workingHoursEnd:    "18:00",
    acceptsInsurance:   false,
    chargesConsultation: true,
    consultationFee:    "150.00",
    paymentMethods:     "Cartão, PIX",
    utcOffsetHours:     -3,
    activeDays:         "1,2,3,4,5",
  }),
  getCachedProcedures:    vi.fn().mockResolvedValue([{ name: "Limpeza", price: 150 }]),
  getCachedProfessionals: vi.fn().mockResolvedValue([{
    id: 1, name: "Dr. João", active: true, specialty: null, cro: null,
    instagramUrl: null, chargesConsultation: true, consultationFee: "150.00",
    acceptsInsurance: false, insurancePlans: null, insuranceDays: null,
    defaultLeadDurationMinutes: 30, defaultPatientDurationMinutes: 30,
  }]),
  TenantCache: class {
    get() { return undefined; }
    set() {}
    invalidate() {}
    clear() {}
  },
}));

vi.mock("../lib/ai-learning", () => ({
  getContactMemories:    vi.fn().mockResolvedValue([]),
  getRelevantObjections: vi.fn().mockResolvedValue([]),
  getRelevantKnowledge:  vi.fn().mockResolvedValue([]),
  getOptimizedStrategies: vi.fn().mockResolvedValue([]),
}));

vi.mock("../lib/lead-engine", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return {
    ...real,
    resolveInsuranceMode: vi.fn().mockResolvedValue({
      isInsuranceContact:    false,
      skipAvailability:      false,
      shouldSkipScheduleOffer: false,
    }),
    getTopStrategies: vi.fn().mockResolvedValue([]),
  };
});

// ─────────────────────────────────────────────────────────────────────────────

import { buildSplitPrompt } from "../lib/prompt-builder.js";
import type { ConversationContext } from "../lib/lead-engine.js";

const CONTEXT: ConversationContext = {
  tenantId:     1,
  conversationId: 1,
  contactPhone: "+5511999999999",
  contactName:  "Maria",
  contactType:  "unknown",
};

describe("buildSplitPrompt — runtime output", () => {
  it("retorna identityPrompt contendo seção de identidade", async () => {
    const { identityPrompt } = await buildSplitPrompt(
      1, CONTEXT, "greeting", "", "", "neutral", false, 0, false, true,
    );
    expect(identityPrompt).toContain("=== IDENTIDADE E REGRAS ABSOLUTAS ===");
    expect(identityPrompt).toContain("RESTRICOES ABSOLUTAS");
    expect(identityPrompt).toContain("MARCADOR DE CONFIRMACAO DE AGENDAMENTO");
  });

  it("identityPrompt NÃO contém nenhuma seção dinâmica", async () => {
    const { identityPrompt } = await buildSplitPrompt(
      1, CONTEXT, "greeting", "", "", "neutral", false, 0, false, true,
    );
    expect(identityPrompt).not.toContain("=== AGENDA DISPONIVEL ===");
    expect(identityPrompt).not.toContain("=== CLINICA ===");
    expect(identityPrompt).not.toContain("=== MODO DE ATENDIMENTO ===");
    expect(identityPrompt).not.toContain("=== DATA E HORA ===");
    expect(identityPrompt).not.toContain("=== PRECOS E PAGAMENTO ===");
    expect(identityPrompt).not.toContain("=== ESTRATEGIA DE ATENDIMENTO ===");
  });

  it("dynamicContext contém as seções dinâmicas esperadas", async () => {
    const { dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "greeting", "Seg 09:00 | Ter 14:00", "", "neutral", false, 0, false, true,
    );
    expect(dynamicContext).toContain("=== MODO DE ATENDIMENTO ===");
    expect(dynamicContext).toContain("=== DATA E HORA ===");
    expect(dynamicContext).toContain("=== CLINICA ===");
    expect(dynamicContext).toContain("=== AGENDA DISPONIVEL ===");
  });

  it("systemHints aparecem em dynamicContext, não em identityPrompt", async () => {
    const hint = "[SISTEMA: teste de hint de agendamento]";
    const { identityPrompt, dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "scheduling", "Seg 09:00", "", "neutral", false, 0, false, true,
      { systemHints: [hint] },
    );
    expect(identityPrompt).not.toContain("[SISTEMA:");
    expect(dynamicContext).toContain(hint);
  });

  it("topicResumeHint aparece em dynamicContext e NÃO em identityPrompt", async () => {
    const hint = "Assunto sobre implante dental";
    const { identityPrompt, dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "greeting", "", "oi", "neutral", false, 0, false, true,
      { topicResumeHint: hint },
    );
    expect(identityPrompt).not.toContain(hint);
    expect(dynamicContext).toContain("RETOMADA DE TOPICO");
    expect(dynamicContext).toContain(hint);
  });

  it("isFirstContact=true injeta regra de primeiro contato em identityPrompt", async () => {
    const { identityPrompt } = await buildSplitPrompt(
      1, CONTEXT, "greeting", "", "oi", "neutral", true, 0, false, true,
    );
    expect(identityPrompt).toContain("REGRA ABSOLUTA — PRIMEIRO CONTATO");
  });

  it("free-plan: identityPrompt preenchido e dynamicContext vazio", async () => {
    const { identityPrompt, dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "greeting", "", "", "neutral", false, 0, false, true,
      { isBasicPlan: true },
    );
    expect(identityPrompt).toBeTruthy();
    expect(identityPrompt.length).toBeGreaterThan(50);
    expect(dynamicContext).toBe("");
  });

  it("identityPrompt e dynamicContext são strings distintas e não vazias (premium)", async () => {
    const { identityPrompt, dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "greeting", "", "", "neutral", false, 0, false, true,
    );
    expect(typeof identityPrompt).toBe("string");
    expect(typeof dynamicContext).toBe("string");
    expect(identityPrompt.length).toBeGreaterThan(100);
    expect(dynamicContext.length).toBeGreaterThan(100);
    expect(identityPrompt).not.toBe(dynamicContext);
  });
});
