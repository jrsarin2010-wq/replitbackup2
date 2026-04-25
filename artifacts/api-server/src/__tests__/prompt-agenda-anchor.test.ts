import { describe, it, expect, vi } from "vitest";

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

import { buildSplitPrompt } from "../lib/prompt-builder.js";
import type { ConversationContext } from "../lib/lead-engine.js";

const CONTEXT: ConversationContext = {
  tenantId:     1,
  conversationId: 1,
  contactPhone: "+5511999999999",
  contactName:  "Maria",
  contactType:  "unknown",
};

describe("Task #16 — aviso de agenda atualizada sempre presente em dynamicContext", () => {
  it("inclui o aviso anti-horários-fantasmas logo após === AGENDA DISPONIVEL ===", async () => {
    const availabilityInfo = "Seg 09:00 | Ter 14:00 | Qua 16:00";
    const { dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "scheduling", availabilityInfo, "", "neutral", false, 0, false, true,
    );

    expect(dynamicContext).toContain("=== AGENDA DISPONIVEL ===");
    expect(dynamicContext).toContain("Horarios mencionados em mensagens anteriores");
    expect(dynamicContext).toContain("EXCLUSIVAMENTE");
    expect(dynamicContext).toContain("Ignore qualquer horario que apareca no historico");

    const agendaIdx = dynamicContext.indexOf("=== AGENDA DISPONIVEL ===");
    const warningIdx = dynamicContext.indexOf("Horarios mencionados em mensagens anteriores");
    expect(warningIdx).toBeGreaterThan(agendaIdx);
  });

  it("mantém o aviso mesmo quando availabilityInfo está vazio", async () => {
    const { dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "greeting", "", "", "neutral", false, 0, false, true,
    );

    expect(dynamicContext).toContain("Horarios mencionados em mensagens anteriores");
    expect(dynamicContext).toContain("EXCLUSIVAMENTE");
    expect(dynamicContext).toContain("Ignore qualquer horario que apareca no historico");
  });

  it("mantém o aviso em primeiro contato (isFirstContact=true)", async () => {
    const { dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "greeting", "Seg 09:00", "oi", "neutral", true, 0, false, true,
    );

    expect(dynamicContext).toContain("Horarios mencionados em mensagens anteriores");
    expect(dynamicContext).toContain("EXCLUSIVAMENTE");
    expect(dynamicContext).toContain("Ignore qualquer horario que apareca no historico");
  });
});
