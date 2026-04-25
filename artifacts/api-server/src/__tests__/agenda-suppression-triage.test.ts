import { describe, it, expect, vi } from "vitest";
import { shouldSuppressAgendaForTriage, resolveInsuranceMode } from "../lib/lead-engine.js";

// ─── Pure helper coverage ────────────────────────────────────────────────────
// Task #28 — single source of truth for "should we ZERO the AGENDA block in
// the prompt because plano/particular triage was not answered yet?".

const HISTORY_NONE: Array<{ content: string }> = [];

describe("shouldSuppressAgendaForTriage — clínica NÃO aceita convênio", () => {
  it("retorna false sempre que clinicAcceptsInsurance=false (lead novo)", () => {
    const insuranceMode = resolveInsuranceMode({
      clinicAcceptsInsurance: false,
      persistedPaymentType: null,
      currentMessage: "oi tudo bem",
      historyMessages: HISTORY_NONE,
    });
    expect(
      shouldSuppressAgendaForTriage({
        clinicAcceptsInsurance: false,
        contactType: "lead",
        insuranceMode,
      }),
    ).toBe(false);
  });

  it("retorna false mesmo se a mensagem cita 'plano' quando a clínica não aceita convênio", () => {
    const insuranceMode = resolveInsuranceMode({
      clinicAcceptsInsurance: false,
      persistedPaymentType: null,
      currentMessage: "tenho plano unimed",
      historyMessages: HISTORY_NONE,
    });
    expect(
      shouldSuppressAgendaForTriage({
        clinicAcceptsInsurance: false,
        contactType: "lead",
        insuranceMode,
      }),
    ).toBe(false);
  });
});

describe("shouldSuppressAgendaForTriage — paciente conhecido nunca é travado", () => {
  it("retorna false para contactType=patient mesmo com clínica de convênio e sem triagem", () => {
    const insuranceMode = resolveInsuranceMode({
      clinicAcceptsInsurance: true,
      persistedPaymentType: null,
      currentMessage: "oi quero remarcar",
      historyMessages: HISTORY_NONE,
    });
    expect(insuranceMode.triageNeeded).toBe(true);
    expect(
      shouldSuppressAgendaForTriage({
        clinicAcceptsInsurance: true,
        contactType: "patient",
        insuranceMode,
      }),
    ).toBe(false);
  });
});

describe("shouldSuppressAgendaForTriage — clínica COM convênio + lead sem triagem", () => {
  it("retorna true quando lead diz só 'oi' (intent classificado como greeting/other depois)", () => {
    const insuranceMode = resolveInsuranceMode({
      clinicAcceptsInsurance: true,
      persistedPaymentType: null,
      currentMessage: "oi tudo bem",
      historyMessages: HISTORY_NONE,
    });
    expect(
      shouldSuppressAgendaForTriage({
        clinicAcceptsInsurance: true,
        contactType: "lead",
        insuranceMode,
      }),
    ).toBe(true);
  });

  it("retorna true quando lead pergunta vagamente, sem citar plano nem particular", () => {
    const insuranceMode = resolveInsuranceMode({
      clinicAcceptsInsurance: true,
      persistedPaymentType: null,
      currentMessage: "queria saber sobre limpeza",
      historyMessages: [{ content: "oi" }],
    });
    expect(
      shouldSuppressAgendaForTriage({
        clinicAcceptsInsurance: true,
        contactType: "lead",
        insuranceMode,
      }),
    ).toBe(true);
  });

  it("retorna true para contactType=unknown (mesmo tratamento de lead)", () => {
    const insuranceMode = resolveInsuranceMode({
      clinicAcceptsInsurance: true,
      persistedPaymentType: null,
      currentMessage: "tem horário hoje?",
      historyMessages: HISTORY_NONE,
    });
    expect(
      shouldSuppressAgendaForTriage({
        clinicAcceptsInsurance: true,
        contactType: "unknown",
        insuranceMode,
      }),
    ).toBe(true);
  });
});

describe("shouldSuppressAgendaForTriage — triagem respondida → libera agenda", () => {
  it("retorna false quando lead declara 'particular' na mensagem atual", () => {
    const insuranceMode = resolveInsuranceMode({
      clinicAcceptsInsurance: true,
      persistedPaymentType: null,
      currentMessage: "é particular",
      historyMessages: HISTORY_NONE,
    });
    expect(insuranceMode.isPrivate).toBe(true);
    expect(
      shouldSuppressAgendaForTriage({
        clinicAcceptsInsurance: true,
        contactType: "lead",
        insuranceMode,
      }),
    ).toBe(false);
  });

  it("retorna false quando lead declara 'tenho plano unimed' na mensagem atual", () => {
    const insuranceMode = resolveInsuranceMode({
      clinicAcceptsInsurance: true,
      persistedPaymentType: null,
      currentMessage: "tenho plano unimed",
      historyMessages: HISTORY_NONE,
    });
    expect(insuranceMode.isInsurance).toBe(true);
    expect(
      shouldSuppressAgendaForTriage({
        clinicAcceptsInsurance: true,
        contactType: "lead",
        insuranceMode,
      }),
    ).toBe(false);
  });

  it("retorna false quando paymentType já está persistido como 'private' (turno > 1)", () => {
    const insuranceMode = resolveInsuranceMode({
      clinicAcceptsInsurance: true,
      persistedPaymentType: "private",
      currentMessage: "qual horário tem amanhã?",
      historyMessages: [{ content: "oi" }, { content: "queria marcar" }],
    });
    expect(insuranceMode.triageComplete).toBe(true);
    expect(
      shouldSuppressAgendaForTriage({
        clinicAcceptsInsurance: true,
        contactType: "lead",
        insuranceMode,
      }),
    ).toBe(false);
  });

  it("retorna false quando paymentType já está persistido como 'insurance'", () => {
    const insuranceMode = resolveInsuranceMode({
      clinicAcceptsInsurance: true,
      persistedPaymentType: "insurance",
      currentMessage: "tem encaixe pra essa semana?",
      historyMessages: HISTORY_NONE,
    });
    expect(
      shouldSuppressAgendaForTriage({
        clinicAcceptsInsurance: true,
        contactType: "lead",
        insuranceMode,
      }),
    ).toBe(false);
  });

  it("retorna false quando o histórico já tem declaração de 'particular' em turno anterior", () => {
    const insuranceMode = resolveInsuranceMode({
      clinicAcceptsInsurance: true,
      persistedPaymentType: null,
      currentMessage: "qual horário tem?",
      historyMessages: [{ content: "oi" }, { content: "vou de particular" }],
    });
    expect(insuranceMode.triageComplete).toBe(true);
    expect(
      shouldSuppressAgendaForTriage({
        clinicAcceptsInsurance: true,
        contactType: "lead",
        insuranceMode,
      }),
    ).toBe(false);
  });
});

// ─── Integração com buildSplitPrompt ─────────────────────────────────────────
// Garante que, quando o ai-engine ZERA o availabilityInfo (caminho da trava),
// o prompt renderizado realmente não vaza nenhum slot de horário.

vi.mock("@workspace/db", () => ({
  db: {
    query: {
      dentalLeadsTable: { findFirst: vi.fn().mockResolvedValue(null) },
      patientsTable: { findFirst: vi.fn().mockResolvedValue(null) },
      appointmentsTable: { findMany: vi.fn().mockResolvedValue([]) },
    },
  },
  dentalLeadsTable: { name: "dental_leads" },
  patientsTable: { name: "patients" },
  appointmentsTable: { name: "appointments" },
}));

vi.mock("../lib/cache", () => ({
  getCachedSettings: vi.fn().mockResolvedValue({
    clinicName: "Clinica Teste",
    aiName: "Ana",
    professionalName: "Dr. Joao",
    workingHoursStart: "08:00",
    workingHoursEnd: "18:00",
    acceptsInsurance: true,
    insurancePlans: "Unimed, Amil",
    chargesConsultation: true,
    consultationFee: "150.00",
    paymentMethods: "Cartao, PIX",
    utcOffsetHours: -3,
    activeDays: "1,2,3,4,5",
  }),
  getCachedProcedures: vi.fn().mockResolvedValue([{ name: "Limpeza", price: 150, durationMinutes: 30 }]),
  getCachedProfessionals: vi.fn().mockResolvedValue([
    {
      id: 1,
      name: "Dr. Joao",
      active: true,
      specialty: null,
      cro: null,
      instagramUrl: null,
      chargesConsultation: true,
      consultationFee: "150.00",
      acceptsInsurance: true,
      insurancePlans: "Unimed, Amil",
      insuranceDays: null,
      defaultLeadDurationMinutes: 30,
      defaultPatientDurationMinutes: 30,
    },
  ]),
  TenantCache: class {
    get() { return undefined; }
    set() {}
    invalidate() {}
    clear() {}
  },
}));

vi.mock("../lib/ai-learning", () => ({
  getContactMemories: vi.fn().mockResolvedValue(""),
  getRelevantObjections: vi.fn().mockResolvedValue(""),
  getRelevantKnowledge: vi.fn().mockResolvedValue(""),
  getOptimizedStrategies: vi.fn().mockResolvedValue(""),
}));

const { buildSplitPrompt } = await import("../lib/prompt-builder.js");
import type { ConversationContext } from "../lib/lead-engine.js";

const CONTEXT: ConversationContext = {
  tenantId: 1,
  conversationId: 1,
  contactPhone: "+5511999999999",
  contactName: "Maria",
  contactType: "lead",
};

describe("Task #28 — buildSplitPrompt com availabilityInfo zerado nunca vaza horário", () => {
  it("não contém padrão HH:MM dentro da seção === AGENDA DISPONIVEL === quando availabilityInfo=''", async () => {
    const { dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "other", "" /* zerado pelo ai-engine */, "oi tudo bem",
      "neutral", true, 0, false, true,
    );

    const idxAgenda = dynamicContext.indexOf("=== AGENDA DISPONIVEL ===");
    expect(idxAgenda).toBeGreaterThan(-1);
    const idxRegras = dynamicContext.indexOf("=== REGRAS GERAIS ===");
    expect(idxRegras).toBeGreaterThan(idxAgenda);

    const agendaSection = dynamicContext.substring(idxAgenda, idxRegras);
    // Nenhum slot HH:MM deve aparecer dentro da seção de agenda.
    expect(agendaSection).not.toMatch(/\b\d{1,2}:\d{2}\b/);
  });

  it("contém o bloco de bifurcação plano/particular quando triagem está pendente", async () => {
    const { identityPrompt, dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "other", "", "oi quero saber sobre limpeza",
      "neutral", true, 0, false, true,
    );
    const fullPrompt = `${identityPrompt}\n${dynamicContext}`;
    expect(fullPrompt).toMatch(/plano|conv[eê]nio/i);
    expect(fullPrompt).toMatch(/particular/i);
  });
});
