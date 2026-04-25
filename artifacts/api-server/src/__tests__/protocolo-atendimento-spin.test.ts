/**
 * SIMULAÇÃO DE PROTOCOLO DE ATENDIMENTO — SPIN × CONVÊNIO × PACIENTE
 *
 * Verifica, via buildSplitPrompt (o prompt real que vai para a IA), que:
 *
 *  Cenário A — Lead PARTICULAR
 *    ✓ Prompt contém a metodologia SPIN Selling completa
 *    ✓ Prompt contém termos de escassez/urgência
 *    ✓ Identifica o contato como CRA (Consultora de Relacionamento com o Agendamento)
 *    ✗ Prompt NÃO contém "MODO CONVENIO ATIVO"
 *
 *  Cenário B — Lead CONVÊNIO (pagamento declarado)
 *    ✓ Prompt contém "MODO CONVENIO ATIVO"
 *    ✗ Prompt NÃO contém termos SPIN de venda (spin_situacao, spin_implicacao, etc.)
 *    ✗ Prompt NÃO contém escassez/urgência/ancoragem (proibição da Task #11)
 *    ✗ Prompt NÃO menciona "consegui um encaixe", "agenda disputada", etc.
 *
 *  Cenário C — Paciente Cadastrado
 *    ✓ Prompt contém "Nunca aplique SPIN Selling, tecnicas de venda ou pressao"
 *    ✓ Prompt contém bloco PACIENTE com histórico
 *    ✗ Prompt NÃO contém a metodologia SPIN Selling ativa (a seção não é injetada)
 *
 *  Cenário D — Lead em TRIAGEM PENDENTE (clínica aceita convênio, sem resposta ainda)
 *    ✓ Prompt pergunta "plano ou particular"
 *    ✗ Prompt NÃO contém SPIN antes da triagem completar
 *    ✗ Prompt NÃO contém escassez/urgência durante a triagem
 *
 * Todos os cenários usam o prompt REAL (buildSplitPrompt), não mocks parciais.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Termos proibidos no contexto de convênio ──────────────────────────────────
const FORBIDDEN_IN_INSURANCE = [
  "spin_situacao",
  "spin_problema",
  "spin_implicacao",
  "spin_necessidade",
  "loss_aversion",
  "price_anchoring",
  "scarcity",
  "agenda disputada",
  "sao os ultimos",
  "são os últimos",
  "consegui um encaixe",
  "consegui 2 encaixes",
  "Consegui 2 horarios",
  "urgencia maxima",
  "urgência máxima",
  "Escassez OBRIGATORIA",
  "Escassez OBRIGATÓRIA",
];

// ── Termos SPIN esperados somente para leads particulares ────────────────────
const SPIN_TERMS = [
  "METODOLOGIA SPIN SELLING",
  "perguntas abertas",
  "Fase SPIN",
];

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockResolveInsuranceMode,
  mockGetCachedSettings,
  mockFindLeadFirst,
  mockFindPatientFirst,
  mockFindAppointments,
} = vi.hoisted(() => ({
  mockResolveInsuranceMode: vi.fn(),
  mockGetCachedSettings: vi.fn(),
  mockFindLeadFirst: vi.fn(),
  mockFindPatientFirst: vi.fn(),
  mockFindAppointments: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    query: {
      dentalLeadsTable:  { findFirst: () => mockFindLeadFirst() },
      patientsTable:     { findFirst: () => mockFindPatientFirst() },
      appointmentsTable: { findMany: () => mockFindAppointments() },
    },
  },
  dentalLeadsTable:  { name: "dental_leads" },
  patientsTable:     { name: "patients" },
  appointmentsTable: { name: "appointments" },
  eq:  () => ({}),
  and: () => ({}),
  desc: () => ({}),
}));

vi.mock("../lib/cache", () => ({
  getCachedSettings:     () => mockGetCachedSettings(),
  getCachedProcedures:   vi.fn().mockResolvedValue([{ name: "Limpeza", price: 150 }]),
  getCachedProfessionals: vi.fn().mockResolvedValue([{
    id: 1, name: "Dr. João", active: true, specialty: null, cro: null,
    instagramUrl: null, chargesConsultation: true, consultationFee: "150.00",
    acceptsInsurance: true,
    insurancePlans: "Unimed, Odontoprev",
    insuranceDays: "6",
    insuranceHoursStart: "08:00",
    insuranceHoursEnd: "12:00",
    defaultLeadDurationMinutes: 30,
    defaultPatientDurationMinutes: 30,
    isOwner: true,
  }]),
  TenantCache: class {
    get()       { return undefined; }
    set()       {}
    invalidate(){ }
    clear()     { }
  },
}));

vi.mock("../lib/ai-learning", () => ({
  getContactMemories:     vi.fn().mockResolvedValue(""),
  getRelevantObjections:  vi.fn().mockResolvedValue(""),
  getRelevantKnowledge:   vi.fn().mockResolvedValue(""),
  getOptimizedStrategies: vi.fn().mockResolvedValue(""),
}));

vi.mock("../lib/lead-engine", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return {
    ...real,
    resolveInsuranceMode:              mockResolveInsuranceMode,
    getTopStrategies:                  vi.fn().mockResolvedValue([]),
  };
});

// ── Import real após mocks ────────────────────────────────────────────────────
import { buildSplitPrompt } from "../lib/prompt-builder.js";
import type { ConversationContext } from "../lib/lead-engine.js";

// ── Fixtures compartilhadas ───────────────────────────────────────────────────
const BASE_SETTINGS = {
  clinicName:         "Sorrizin",
  aiName:             "Ana",
  professionalName:   "Dr. João",
  workingHoursStart:  "08:00",
  workingHoursEnd:    "18:00",
  acceptsInsurance:   true,
  chargesConsultation: true,
  consultationFee:    "150.00",
  paymentMethods:     "Cartão, PIX",
  utcOffsetHours:     -3,
  activeDays:         "1,2,3,4,5,6",
  insurancePlans:     "Unimed, Odontoprev",
  insuranceDays:      "6",
  insuranceHoursStart: "08:00",
  insuranceHoursEnd:   "12:00",
};

const LEAD_PRIVATE = {
  id: 1, tenantId: 1, name: "Carlos Silva", phone: "+5511999990001",
  email: null, temperature: "warm", status: "active", source: "Instagram",
  interest: "Clareamento dental", notes: null, paymentType: "private",
  profilePicUrl: null, lastContactAt: null, professionalId: null,
  createdAt: new Date(), updatedAt: new Date(),
};

const LEAD_HOT_PRIVATE = {
  ...LEAD_PRIVATE, id: 2, name: "Bruno Faria", temperature: "hot",
};

const LEAD_INSURANCE = {
  id: 3, tenantId: 1, name: "Fernanda Lima", phone: "+5511999990003",
  email: null, temperature: "warm", status: "active", source: "WhatsApp",
  interest: "Limpeza", notes: null, paymentType: "insurance",
  profilePicUrl: null, lastContactAt: null, professionalId: null,
  createdAt: new Date(), updatedAt: new Date(),
};

const LEAD_UNKNOWN_PRETRIAGE = {
  id: 4, tenantId: 1, name: "Amanda Costa", phone: "+5511999990004",
  email: null, temperature: "cold", status: "active", source: "Google",
  interest: "Consulta", notes: null, paymentType: null,
  profilePicUrl: null, lastContactAt: null, professionalId: null,
  createdAt: new Date(), updatedAt: new Date(),
};

const PATIENT = {
  id: 10, tenantId: 1, name: "Roberto Andrade", phone: "+5511999990010",
  email: null, totalSpent: "350.00", cpf: null, birthDate: null,
  address: null, notes: null, profilePicUrl: null,
  createdAt: new Date(), updatedAt: new Date(),
};

const AGENDA_DISPONIVEL = "Qua 09:00 | Qui 14:00 | Sab 10:00";

function makeInsuranceMode(override: Partial<{
  isInsurance: boolean; isPrivate: boolean; triageComplete: boolean;
  triagePending: boolean; isPatient: boolean; skipAvailability: boolean;
}>) {
  return {
    isInsurance: false,
    isPrivate:   false,
    triageComplete: false,
    triagePending:  false,
    isPatient: false,
    skipAvailability: false,
    shouldSkipScheduleOffer: false,
    ...override,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CENÁRIO A — Lead PARTICULAR
// ─────────────────────────────────────────────────────────────────────────────
describe("Cenário A — Lead Particular: SPIN Selling DEVE ser aplicado", () => {
  let promptResult: Awaited<ReturnType<typeof buildSplitPrompt>>;
  let fullPrompt: string;

  beforeEach(async () => {
    mockGetCachedSettings.mockResolvedValue(BASE_SETTINGS);
    mockFindLeadFirst.mockResolvedValue(LEAD_PRIVATE);
    mockFindPatientFirst.mockResolvedValue(null);
    mockFindAppointments.mockResolvedValue([]);
    mockResolveInsuranceMode.mockReturnValue(makeInsuranceMode({
      isInsurance: false, isPrivate: true, triageComplete: true,
    }));

    const context: ConversationContext = {
      tenantId: 1, conversationId: 1,
      contactPhone: LEAD_PRIVATE.phone,
      contactName:  "Carlos",
      contactType:  "lead",
      leadId: LEAD_PRIVATE.id,
    };

    promptResult = await buildSplitPrompt(
      1, context, "greeting", AGENDA_DISPONIVEL,
      "quero clarear meus dentes", "neutral",
      false, 0, false, true,
      { preloadedLead: LEAD_PRIVATE },
    );

    fullPrompt = promptResult.identity + "\n" + promptResult.dynamicContext;
  });

  it("contém a metodologia SPIN Selling completa", () => {
    for (const term of SPIN_TERMS) {
      expect(fullPrompt, `esperado: "${term}" — lead particular deve receber SPIN`).toContain(term);
    }
  });

  it("identifica o contato como CRA (Consultora de Relacionamento)", () => {
    expect(fullPrompt).toContain("CRA");
  });

  it("contém instrução de escassez/urgência para lead particular", () => {
    expect(fullPrompt).toMatch(/escassez|urgencia|urgência/i);
  });

  it("NÃO contém 'MODO CONVENIO ATIVO' (não é lead de plano)", () => {
    expect(fullPrompt).not.toContain("MODO CONVENIO ATIVO");
  });

  it("NÃO usa linguagem de convênio neutra no lugar de SPIN", () => {
    expect(fullPrompt).not.toContain("INSTRUCOES MODO CONVENIO");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CENÁRIO A2 — Lead QUENTE Particular: urgência máxima e escassez forçada
// ─────────────────────────────────────────────────────────────────────────────
describe("Cenário A2 — Lead QUENTE Particular: urgência e escassez no fechamento", () => {
  let fullPrompt: string;

  beforeEach(async () => {
    mockGetCachedSettings.mockResolvedValue(BASE_SETTINGS);
    mockFindLeadFirst.mockResolvedValue(LEAD_HOT_PRIVATE);
    mockFindPatientFirst.mockResolvedValue(null);
    mockFindAppointments.mockResolvedValue([]);
    mockResolveInsuranceMode.mockReturnValue(makeInsuranceMode({
      isInsurance: false, isPrivate: true, triageComplete: true,
    }));

    const context: ConversationContext = {
      tenantId: 1, conversationId: 2,
      contactPhone: LEAD_HOT_PRIVATE.phone,
      contactName:  "Bruno",
      contactType:  "lead",
      leadId: LEAD_HOT_PRIVATE.id,
    };

    const result = await buildSplitPrompt(
      1, context, "scheduling", AGENDA_DISPONIVEL,
      "quero marcar", "neutral", false, 0, false, true,
      { preloadedLead: LEAD_HOT_PRIVATE },
    );

    fullPrompt = result.identity + "\n" + result.dynamicContext;
  });

  it("fase SPIN para lead QUENTE é N — NECESSIDADE DE SOLUÇÃO", () => {
    expect(fullPrompt).toContain("N — NECESSIDADE DE SOLUCAO");
  });

  it("contém instrução de escassez/urgência para fechamento de lead quente", () => {
    expect(fullPrompt).toMatch(/escassez|urgencia|ultimos|disputada/i);
  });

  it("NÃO ativa MODO CONVENIO para lead particular", () => {
    expect(fullPrompt).not.toContain("MODO CONVENIO ATIVO");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CENÁRIO B — Lead CONVÊNIO: SPIN é proibido
// ─────────────────────────────────────────────────────────────────────────────
describe("Cenário B — Lead Convênio: SPIN NUNCA deve aparecer", () => {
  let fullPrompt: string;

  beforeEach(async () => {
    mockGetCachedSettings.mockResolvedValue(BASE_SETTINGS);
    mockFindLeadFirst.mockResolvedValue(LEAD_INSURANCE);
    mockFindPatientFirst.mockResolvedValue(null);
    mockFindAppointments.mockResolvedValue([]);
    mockResolveInsuranceMode.mockReturnValue(makeInsuranceMode({
      isInsurance: true, isPrivate: false, triageComplete: true,
    }));

    const context: ConversationContext = {
      tenantId: 1, conversationId: 3,
      contactPhone: LEAD_INSURANCE.phone,
      contactName:  "Fernanda",
      contactType:  "lead",
      leadId: LEAD_INSURANCE.id,
    };

    const result = await buildSplitPrompt(
      1, context, "scheduling", AGENDA_DISPONIVEL,
      "uso o convenio Unimed", "neutral", false, 0, false, true,
      { preloadedLead: LEAD_INSURANCE },
    );

    fullPrompt = result.identity + "\n" + result.dynamicContext;
  });

  it("contém MODO CONVENIO ATIVO no prompt", () => {
    expect(fullPrompt).toContain("MODO CONVENIO ATIVO");
  });

  it("contém instruções de acolhimento sem pressão comercial", () => {
    expect(fullPrompt).toContain("INSTRUCOES MODO CONVENIO");
  });

  it("objetivo é agendar com gentileza, sem técnicas de venda", () => {
    expect(fullPrompt).toMatch(/marcar.*consulta.*gentileza|gentileza.*marcar|objetivo.*unico.*marcar/i);
  });

  it.each(FORBIDDEN_IN_INSURANCE)(
    "NÃO contém o termo proibido em convênio: '%s'",
    (term) => {
      expect(fullPrompt).not.toContain(term);
    },
  );

  it("NÃO contém a metodologia SPIN Selling ativa (bloco CRA)", () => {
    expect(fullPrompt).not.toContain("METODOLOGIA SPIN SELLING");
  });

  it("NÃO identifica o contato como CRA (Consultora de Relacionamento)", () => {
    expect(fullPrompt).not.toContain("VOCE E UMA CRA");
  });

  it("NÃO menciona fase SPIN (S/P/I/N)", () => {
    expect(fullPrompt).not.toContain("Fase SPIN");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CENÁRIO C — Paciente Cadastrado: SPIN nunca para pacientes
// ─────────────────────────────────────────────────────────────────────────────
describe("Cenário C — Paciente Cadastrado: SPIN Selling PROIBIDO", () => {
  let fullPrompt: string;

  beforeEach(async () => {
    mockGetCachedSettings.mockResolvedValue(BASE_SETTINGS);
    mockFindLeadFirst.mockResolvedValue(null);
    mockFindPatientFirst.mockResolvedValue(PATIENT);
    mockFindAppointments.mockResolvedValue([
      { startsAt: new Date("2026-03-10T10:00:00"), status: "confirmed" },
    ]);
    mockResolveInsuranceMode.mockReturnValue(makeInsuranceMode({
      isInsurance: false, isPrivate: false, triageComplete: false, isPatient: true,
    }));

    const context: ConversationContext = {
      tenantId: 1, conversationId: 4,
      contactPhone: PATIENT.phone,
      contactName:  "Roberto",
      contactType:  "patient",
      patientId: PATIENT.id,
    };

    const result = await buildSplitPrompt(
      1, context, "greeting", AGENDA_DISPONIVEL,
      "quero agendar uma limpeza", "neutral", false, 0, false, true,
    );

    fullPrompt = result.identity + "\n" + result.dynamicContext;
  });

  it("contém a regra explícita proibindo SPIN com pacientes", () => {
    expect(fullPrompt).toContain("Nunca aplique SPIN Selling, tecnicas de venda ou pressao com pacientes");
  });

  it("contém o bloco PACIENTE com nome e histórico de consultas", () => {
    expect(fullPrompt).toContain("PACIENTE:");
    expect(fullPrompt).toContain("Roberto Andrade");
  });

  it("instrui a ser acolhedor com paciente já cadastrado", () => {
    expect(fullPrompt).toMatch(/paciente.*ja.*clinica|JA e da clinica|ja e da clinica/i);
  });

  it("NÃO injeta a metodologia SPIN Selling ativa no prompt de paciente", () => {
    expect(fullPrompt).not.toContain("METODOLOGIA SPIN SELLING");
  });

  it("NÃO identifica o atendente como CRA com pacientes", () => {
    expect(fullPrompt).not.toContain("VOCE E UMA CRA");
  });

  it("NÃO contém termos de escassez/urgência para paciente", () => {
    for (const term of ["agenda disputada", "sao os ultimos", "urgencia maxima"]) {
      expect(fullPrompt).not.toContain(term);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CENÁRIO D — Pré-triagem: clínica aceita convênio, paciente ainda não respondeu
// ─────────────────────────────────────────────────────────────────────────────
describe("Cenário D — Pré-triagem pendente: pede plano/particular, bloqueia SPIN", () => {
  let fullPrompt: string;

  beforeEach(async () => {
    mockGetCachedSettings.mockResolvedValue(BASE_SETTINGS);
    mockFindLeadFirst.mockResolvedValue(LEAD_UNKNOWN_PRETRIAGE);
    mockFindPatientFirst.mockResolvedValue(null);
    mockFindAppointments.mockResolvedValue([]);
    mockResolveInsuranceMode.mockReturnValue(makeInsuranceMode({
      isInsurance: false, isPrivate: false, triageComplete: false,
    }));

    const context: ConversationContext = {
      tenantId: 1, conversationId: 5,
      contactPhone: LEAD_UNKNOWN_PRETRIAGE.phone,
      contactName:  "Amanda",
      contactType:  "lead",
      leadId: LEAD_UNKNOWN_PRETRIAGE.id,
    };

    const result = await buildSplitPrompt(
      1, context, "greeting", AGENDA_DISPONIVEL,
      "oi", "neutral", true, 0, false, false,
      { preloadedLead: LEAD_UNKNOWN_PRETRIAGE },
    );

    fullPrompt = result.identity + "\n" + result.dynamicContext;
  });

  it("instrui a perguntar 'plano ou particular' antes de qualquer ação", () => {
    expect(fullPrompt).toMatch(/plano ou e particular|plano ou particular/i);
  });

  it("proíbe explicitamente SPIN antes da triagem completar", () => {
    expect(fullPrompt).toMatch(/PROIBIDO.*SPIN|SPIN.*PROIBIDO/i);
  });

  it("proíbe oferecer horários antes de saber plano/particular", () => {
    expect(fullPrompt).toMatch(/PROIBIDO.*horario|nao ofere[cç]a horarios|Nao avance para.*horarios/i);
  });

  it("proíbe mencionar preço antes da triagem", () => {
    expect(fullPrompt).toMatch(/PROIBIDO.*prec[oô]|nao mencione.*prec[oô]|Nao avance para.*prec/i);
  });

  it("NÃO contém SPIN Selling ativo — espera resposta de plano/particular primeiro", () => {
    expect(fullPrompt).not.toContain("METODOLOGIA SPIN SELLING");
  });

  it("NÃO contém escassez/urgência durante a triagem pendente", () => {
    for (const term of ["agenda disputada", "sao os ultimos", "Escassez OBRIGATORIA"]) {
      expect(fullPrompt).not.toContain(term);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CENÁRIO E — Validação cruzada: mesma clínica, 2 leads simultâneos (1 plano, 1 particular)
// ─────────────────────────────────────────────────────────────────────────────
describe("Cenário E — Dois leads simultâneos: plano e particular na mesma clínica", () => {
  it("lead PARTICULAR recebe SPIN; lead CONVÊNIO não recebe SPIN (mesma clínica)", async () => {
    mockGetCachedSettings.mockResolvedValue(BASE_SETTINGS);
    mockFindAppointments.mockResolvedValue([]);

    // Prompt para lead particular
    mockFindLeadFirst.mockResolvedValue(LEAD_PRIVATE);
    mockFindPatientFirst.mockResolvedValue(null);
    mockResolveInsuranceMode.mockReturnValue(makeInsuranceMode({
      isInsurance: false, isPrivate: true, triageComplete: true,
    }));
    const ctxPrivate: ConversationContext = {
      tenantId: 1, conversationId: 10,
      contactPhone: LEAD_PRIVATE.phone, contactName: "Carlos",
      contactType: "lead", leadId: LEAD_PRIVATE.id,
    };
    const privateResult = await buildSplitPrompt(
      1, ctxPrivate, "greeting", AGENDA_DISPONIVEL, "oi", "neutral",
      false, 0, false, true, { preloadedLead: LEAD_PRIVATE },
    );
    const privatePrompt = privateResult.identity + "\n" + privateResult.dynamicContext;

    // Prompt para lead de convênio
    mockFindLeadFirst.mockResolvedValue(LEAD_INSURANCE);
    mockResolveInsuranceMode.mockReturnValue(makeInsuranceMode({
      isInsurance: true, isPrivate: false, triageComplete: true,
    }));
    const ctxInsurance: ConversationContext = {
      tenantId: 1, conversationId: 11,
      contactPhone: LEAD_INSURANCE.phone, contactName: "Fernanda",
      contactType: "lead", leadId: LEAD_INSURANCE.id,
    };
    const insuranceResult = await buildSplitPrompt(
      1, ctxInsurance, "greeting", AGENDA_DISPONIVEL, "oi", "neutral",
      false, 0, false, true, { preloadedLead: LEAD_INSURANCE },
    );
    const insurancePrompt = insuranceResult.identity + "\n" + insuranceResult.dynamicContext;

    // Lead particular deve ter SPIN
    expect(privatePrompt).toContain("METODOLOGIA SPIN SELLING");
    expect(privatePrompt).not.toContain("MODO CONVENIO ATIVO");

    // Lead de convênio não deve ter SPIN
    expect(insurancePrompt).toContain("MODO CONVENIO ATIVO");
    expect(insurancePrompt).not.toContain("METODOLOGIA SPIN SELLING");

    // Termos proibidos não devem vazar para o prompt de convênio
    for (const term of FORBIDDEN_IN_INSURANCE) {
      expect(insurancePrompt, `vazamento do termo "${term}" no prompt de convênio`).not.toContain(term);
    }
  });
});
