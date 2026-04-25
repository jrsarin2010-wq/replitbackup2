/**
 * SIMULAÇÃO DE PROTOCOLO DE AGENDAMENTO — CONVENIO × PARTICULAR × PACIENTE
 *
 * Valida, via buildSplitPrompt (prompt REAL enviado à IA), que as regras de
 * agendamento são aplicadas corretamente para cada perfil de contato:
 *
 * CENÁRIO F — Lead Particular solicitando agendamento
 *   ✓ Recebe SPIN Selling completo (fase N — necessidade de solução)
 *   ✓ Regras de agendamento particular com urgência/escassez
 *   ✓ "Consegui 2 encaixes", "sao os ultimos", "agenda disputada"
 *   ✗ Não ativa MODO CONVENIO
 *   ✗ Não usa regras de agendamento por convênio
 *
 * CENÁRIO G — Lead Convênio solicitando agendamento
 *   ✓ MODO CONVENIO ATIVO — regras de agenda por convênio
 *   ✓ Apresenta horários com "manha ou de tarde" (sem pressão)
 *   ✗ Sem SPIN Selling
 *   ✗ Sem urgência/escassez ("consegui 2 encaixes", "sao os ultimos", etc.)
 *   ✗ Sem ancoragem de preço ou argumentos comerciais
 *
 * CENÁRIO H — Lead Particular QUENTE fechando agendamento
 *   ✓ Fase SPIN N — necessidade de solução (temperatura hot)
 *   ✓ Urgência máxima: "Sao os ultimos da semana"
 *   ✓ Mensagem de encerramento com escassez
 *   ✗ Sem MODO CONVENIO
 *
 * CENÁRIO I — Paciente Cadastrado (particular) solicitando agendamento
 *   ✓ Bloco PACIENTE com histórico
 *   ✓ Proibição explícita de SPIN com pacientes
 *   ✗ Sem "VOCE E UMA CRA" (SPIN não ativado)
 *   ✗ Sem urgência/escassez
 *
 * CENÁRIO J — Paciente de Convênio (paciente cadastrado, plano)
 *   ✓ Mesmo tratamento acolhedor que paciente particular
 *   ✗ Sem SPIN Selling
 *   ✗ Sem pressão comercial
 *
 * CENÁRIO K — Pré-triagem: clínica aceita convênio, paciente pede agendamento
 *             antes de responder plano/particular
 *   ✓ Pergunta obrigatória plano/particular bloqueando o agendamento
 *   ✗ Sem SPIN Selling ativo
 *   ✗ Sem oferta de horários antes da triagem
 *
 * CENÁRIO L — Validação cruzada de regras de agendamento simultâneas
 *             (lead particular E lead convênio na mesma clínica)
 *   Particular → escassez presente; Convênio → escassez ausente (mesmo tenant)
 *
 * Todos os cenários usam o prompt REAL (buildSplitPrompt), não mocks parciais.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Termos proibidos para qualquer agendamento de convênio ───────────────────
const FORBIDDEN_INSURANCE_SCHEDULING = [
  "Consegui 2 encaixes",
  "Consegui 2 horarios",
  "sao os ultimos",
  "são os últimos",
  "agenda disputada",
  "Escassez OBRIGATORIA",
  "Escassez OBRIGATÓRIA",
  "urgencia maxima",
  "urgência máxima",
  "consegui um encaixe",
  "METODOLOGIA SPIN SELLING",
  "VOCE E UMA CRA",
  "spin_situacao",
  "spin_problema",
  "spin_implicacao",
  "spin_necessidade",
];

// ── Termos de urgência/escassez esperados somente no agendamento particular ──
const SCHEDULING_SCARCITY_TERMS = [
  /consegui 2 encaixes|Consegui 2 encaixes/i,
  /sao os ultimos|são os últimos|ultimos da semana/i,
  /agenda.*disputada|disputada/i,
  /Escassez OBRIGATORIA|Escassez OBRIGATÓRIA/i,
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
  mockGetCachedSettings:    vi.fn(),
  mockFindLeadFirst:        vi.fn(),
  mockFindPatientFirst:     vi.fn(),
  mockFindAppointments:     vi.fn(),
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
  getCachedSettings:      () => mockGetCachedSettings(),
  getCachedProcedures:    vi.fn().mockResolvedValue([
    { name: "Limpeza", price: 150, durationMinutes: 30 },
    { name: "Clareamento", price: 800, durationMinutes: 60 },
  ]),
  getCachedProfessionals: vi.fn().mockResolvedValue([{
    id: 1, name: "Dr. João", active: true, specialty: "Clínica Geral",
    cro: null, instagramUrl: null,
    chargesConsultation: true, consultationFee: "150.00",
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
    get()        { return undefined; }
    set()        {}
    invalidate() {}
    clear()      {}
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
    resolveInsuranceMode: mockResolveInsuranceMode,
    getTopStrategies:     vi.fn().mockResolvedValue([]),
  };
});

// ── Import real após mocks ────────────────────────────────────────────────────
import { buildSplitPrompt } from "../lib/prompt-builder.js";
import type { ConversationContext } from "../lib/lead-engine.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────
const BASE_SETTINGS = {
  clinicName:          "Sorrizin",
  aiName:              "Ana",
  professionalName:    "Dr. João",
  workingHoursStart:   "08:00",
  workingHoursEnd:     "18:00",
  acceptsInsurance:    true,
  chargesConsultation: true,
  consultationFee:     "150.00",
  paymentMethods:      "Cartão, PIX",
  utcOffsetHours:      -3,
  activeDays:          "1,2,3,4,5,6",
  insurancePlans:      "Unimed, Odontoprev",
  insuranceDays:       "6",
  insuranceHoursStart: "08:00",
  insuranceHoursEnd:   "12:00",
};

const LEAD_WARM_PRIVATE = {
  id: 1, tenantId: 1, name: "Carlos Silva", phone: "+5511999990001",
  email: null, temperature: "warm", status: "active", source: "Instagram",
  interest: "Clareamento dental", notes: null, paymentType: "private",
  profilePicUrl: null, lastContactAt: null, professionalId: null,
  createdAt: new Date(), updatedAt: new Date(),
};

const LEAD_HOT_PRIVATE = {
  ...LEAD_WARM_PRIVATE, id: 2, name: "Bruno Faria", phone: "+5511999990002",
  temperature: "hot",
};

const LEAD_INSURANCE = {
  id: 3, tenantId: 1, name: "Fernanda Lima", phone: "+5511999990003",
  email: null, temperature: "warm", status: "active", source: "WhatsApp",
  interest: "Limpeza", notes: null, paymentType: "insurance",
  profilePicUrl: null, lastContactAt: null, professionalId: null,
  createdAt: new Date(), updatedAt: new Date(),
};

const LEAD_UNKNOWN = {
  id: 4, tenantId: 1, name: "Amanda Costa", phone: "+5511999990004",
  email: null, temperature: "cold", status: "active", source: "Google",
  interest: "Consulta", notes: null, paymentType: null,
  profilePicUrl: null, lastContactAt: null, professionalId: null,
  createdAt: new Date(), updatedAt: new Date(),
};

const PATIENT_PRIVATE = {
  id: 10, tenantId: 1, name: "Roberto Andrade", phone: "+5511999990010",
  email: null, totalSpent: "350.00", cpf: null, birthDate: null,
  address: null, notes: null, profilePicUrl: null,
  createdAt: new Date(), updatedAt: new Date(),
};

const PATIENT_INSURANCE = {
  id: 11, tenantId: 1, name: "Silvia Campos", phone: "+5511999990011",
  email: null, totalSpent: "0.00", cpf: null, birthDate: null,
  address: null, notes: null, profilePicUrl: null,
  createdAt: new Date(), updatedAt: new Date(),
};

const AGENDA = "Qua 09:00 | Qua 14:00 | Qui 10:00 | Sex 08:00 | Sab 09:00 (Convênio)";

function makeMode(override: Partial<{
  isInsurance: boolean; isPrivate: boolean; triageComplete: boolean;
  triagePending: boolean; isPatient: boolean; skipAvailability: boolean;
  shouldSkipScheduleOffer: boolean;
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
// CENÁRIO F — Lead Particular: regras de agendamento com urgência e escassez
// ─────────────────────────────────────────────────────────────────────────────
describe("Cenário F — Lead Particular solicitando agendamento", () => {
  let fullPrompt: string;

  beforeEach(async () => {
    mockGetCachedSettings.mockResolvedValue(BASE_SETTINGS);
    mockFindLeadFirst.mockResolvedValue(LEAD_WARM_PRIVATE);
    mockFindPatientFirst.mockResolvedValue(null);
    mockFindAppointments.mockResolvedValue([]);
    mockResolveInsuranceMode.mockReturnValue(makeMode({
      isInsurance: false, isPrivate: true, triageComplete: true,
    }));

    const ctx: ConversationContext = {
      tenantId: 1, conversationId: 10,
      contactPhone: LEAD_WARM_PRIVATE.phone,
      contactName:  "Carlos",
      contactType:  "lead",
      leadId: LEAD_WARM_PRIVATE.id,
    };

    const r = await buildSplitPrompt(
      1, ctx, "scheduling", AGENDA,
      "quero marcar uma consulta", "neutral",
      false, 0, false, true,
      { preloadedLead: LEAD_WARM_PRIVATE },
    );
    fullPrompt = r.identity + "\n" + r.dynamicContext;
  });

  it("aplica SPIN Selling completo ao lead particular", () => {
    expect(fullPrompt).toContain("METODOLOGIA SPIN SELLING");
  });

  it("identifica o atendente como CRA para lead particular", () => {
    expect(fullPrompt).toContain("VOCE E UMA CRA");
  });

  it("exibe regras de agendamento EXCLUSIVAS para particulares", () => {
    expect(fullPrompt).toContain("SOMENTE PARA PARTICULARES");
  });

  it("instrui a oferecer exatamente 2 horários (manhã e tarde)", () => {
    expect(fullPrompt).toMatch(/MAXIMO 2 horarios|maximo 2 horarios/i);
  });

  it("contém escassez/urgência obrigatória nas regras de agendamento", () => {
    const hasScarcity = SCHEDULING_SCARCITY_TERMS.some(re => re.test(fullPrompt));
    expect(hasScarcity, "esperado: ao menos um termo de escassez/urgência").toBe(true);
  });

  it("contém instrução de apresentar horários como favor conquistado", () => {
    expect(fullPrompt).toContain("Consegui 2 encaixes");
  });

  it("NÃO ativa MODO CONVENIO para lead particular", () => {
    expect(fullPrompt).not.toContain("MODO CONVENIO ATIVO");
  });

  it("NÃO usa regras de agendamento de convênio", () => {
    expect(fullPrompt).not.toContain("AGENDA — CONVENIO (REGRA ABSOLUTA)");
  });

  it("NÃO contém pergunta neutra 'manha ou de tarde' (convênio)", () => {
    expect(fullPrompt).not.toContain("Prefere de manha ou de tarde?");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CENÁRIO G — Lead Convênio: agendamento sem pressão, sem SPIN
// ─────────────────────────────────────────────────────────────────────────────
describe("Cenário G — Lead Convênio solicitando agendamento", () => {
  let fullPrompt: string;

  beforeEach(async () => {
    mockGetCachedSettings.mockResolvedValue(BASE_SETTINGS);
    mockFindLeadFirst.mockResolvedValue(LEAD_INSURANCE);
    mockFindPatientFirst.mockResolvedValue(null);
    mockFindAppointments.mockResolvedValue([]);
    mockResolveInsuranceMode.mockReturnValue(makeMode({
      isInsurance: true, isPrivate: false, triageComplete: true,
    }));

    const ctx: ConversationContext = {
      tenantId: 1, conversationId: 20,
      contactPhone: LEAD_INSURANCE.phone,
      contactName:  "Fernanda",
      contactType:  "lead",
      leadId: LEAD_INSURANCE.id,
    };

    const r = await buildSplitPrompt(
      1, ctx, "scheduling", AGENDA,
      "quero agendar usando meu plano Unimed", "neutral",
      false, 0, false, true,
      { preloadedLead: LEAD_INSURANCE },
    );
    fullPrompt = r.identity + "\n" + r.dynamicContext;
  });

  it("ativa MODO CONVENIO ATIVO para lead de plano", () => {
    expect(fullPrompt).toContain("MODO CONVENIO ATIVO");
  });

  it("usa regras de agendamento específicas para convênio", () => {
    expect(fullPrompt).toContain("AGENDA — CONVENIO (REGRA ABSOLUTA)");
  });

  it("instrui a perguntar 'manha ou de tarde' de forma gentil", () => {
    expect(fullPrompt).toContain("Prefere de manha ou de tarde?");
  });

  it("instrui a apresentar horários disponíveis direto (sem rodeios)", () => {
    expect(fullPrompt).toMatch(/IMEDIATAMENTE|Nao diga que vai verificar|oferte os horarios IMEDIATAMENTE/i);
  });

  it.each(FORBIDDEN_INSURANCE_SCHEDULING)(
    "NÃO contém o termo proibido em agendamento de convênio: '%s'",
    (term) => {
      expect(fullPrompt).not.toContain(term);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// CENÁRIO H — Lead QUENTE Particular: fechamento com urgência máxima
// ─────────────────────────────────────────────────────────────────────────────
describe("Cenário H — Lead QUENTE Particular: fechamento com urgência máxima", () => {
  let fullPrompt: string;

  beforeEach(async () => {
    mockGetCachedSettings.mockResolvedValue(BASE_SETTINGS);
    mockFindLeadFirst.mockResolvedValue(LEAD_HOT_PRIVATE);
    mockFindPatientFirst.mockResolvedValue(null);
    mockFindAppointments.mockResolvedValue([]);
    mockResolveInsuranceMode.mockReturnValue(makeMode({
      isInsurance: false, isPrivate: true, triageComplete: true,
    }));

    const ctx: ConversationContext = {
      tenantId: 1, conversationId: 30,
      contactPhone: LEAD_HOT_PRIVATE.phone,
      contactName:  "Bruno",
      contactType:  "lead",
      leadId: LEAD_HOT_PRIVATE.id,
    };

    const r = await buildSplitPrompt(
      1, ctx, "scheduling", AGENDA,
      "quero marcar agora", "neutral",
      false, 0, false, true,
      { preloadedLead: LEAD_HOT_PRIVATE },
    );
    fullPrompt = r.identity + "\n" + r.dynamicContext;
  });

  it("fase SPIN é N — NECESSIDADE DE SOLUÇÃO para lead quente", () => {
    expect(fullPrompt).toContain("N — NECESSIDADE DE SOLUCAO");
  });

  it("instrui fechamento com urgência máxima para lead quente", () => {
    expect(fullPrompt).toMatch(
      /Lead QUENTE.*urgencia maxima|urgencia maxima.*Lead QUENTE|ultimos da semana/i,
    );
  });

  it("contém instrução de reservar vaga com pressão de conversão", () => {
    expect(fullPrompt).toMatch(/posso reservar.*agora|reservar.*vaga.*agora/i);
  });

  it("NÃO ativa MODO CONVENIO para lead quente particular", () => {
    expect(fullPrompt).not.toContain("MODO CONVENIO ATIVO");
  });

  it("mantém SPIN Selling ativo — lead quente particular sempre recebe SPIN", () => {
    expect(fullPrompt).toContain("METODOLOGIA SPIN SELLING");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CENÁRIO I — Paciente Particular: agendamento sem SPIN, acolhedor
// ─────────────────────────────────────────────────────────────────────────────
describe("Cenário I — Paciente Cadastrado (particular) solicitando agendamento", () => {
  let fullPrompt: string;

  beforeEach(async () => {
    mockGetCachedSettings.mockResolvedValue(BASE_SETTINGS);
    mockFindLeadFirst.mockResolvedValue(null);
    mockFindPatientFirst.mockResolvedValue(PATIENT_PRIVATE);
    mockFindAppointments.mockResolvedValue([
      { startsAt: new Date("2026-02-10T10:00:00"), status: "confirmed" },
      { startsAt: new Date("2026-03-15T14:00:00"), status: "confirmed" },
    ]);
    mockResolveInsuranceMode.mockReturnValue(makeMode({
      isInsurance: false, isPrivate: false, triageComplete: false, isPatient: true,
    }));

    const ctx: ConversationContext = {
      tenantId: 1, conversationId: 40,
      contactPhone: PATIENT_PRIVATE.phone,
      contactName:  "Roberto",
      contactType:  "patient",
      patientId: PATIENT_PRIVATE.id,
    };

    const r = await buildSplitPrompt(
      1, ctx, "scheduling", AGENDA,
      "quero marcar uma limpeza", "neutral",
      false, 0, false, true,
    );
    fullPrompt = r.identity + "\n" + r.dynamicContext;
  });

  it("exibe o bloco PACIENTE com nome e histórico de consultas", () => {
    expect(fullPrompt).toContain("PACIENTE:");
    expect(fullPrompt).toContain("Roberto Andrade");
  });

  it("mostra consultas anteriores no contexto do paciente", () => {
    expect(fullPrompt).toMatch(/confirmed/i);
  });

  it("proíbe explicitamente SPIN Selling com pacientes", () => {
    expect(fullPrompt).toContain(
      "Nunca aplique SPIN Selling, tecnicas de venda ou pressao com pacientes",
    );
  });

  it("instrui a ser acolhedor com paciente já cadastrado", () => {
    expect(fullPrompt).toMatch(/JA e da clinica|ja e da clinica/i);
  });

  it("NÃO injeta metodologia SPIN Selling no prompt de paciente", () => {
    expect(fullPrompt).not.toContain("METODOLOGIA SPIN SELLING");
  });

  it("NÃO identifica o atendente como CRA com pacientes", () => {
    expect(fullPrompt).not.toContain("VOCE E UMA CRA");
  });

  it("NÃO contém escassez/urgência para paciente particular", () => {
    for (const term of ["Consegui 2 encaixes", "sao os ultimos", "Escassez OBRIGATORIA", "urgencia maxima"]) {
      expect(fullPrompt).not.toContain(term);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CENÁRIO J — Paciente de Convênio: mesmo acolhimento, sem SPIN
// ─────────────────────────────────────────────────────────────────────────────
describe("Cenário J — Paciente de Convênio: acolhimento idêntico, SPIN proibido", () => {
  let fullPrompt: string;

  beforeEach(async () => {
    mockGetCachedSettings.mockResolvedValue(BASE_SETTINGS);
    mockFindLeadFirst.mockResolvedValue(null);
    mockFindPatientFirst.mockResolvedValue(PATIENT_INSURANCE);
    mockFindAppointments.mockResolvedValue([
      { startsAt: new Date("2026-01-20T09:00:00"), status: "confirmed" },
    ]);
    mockResolveInsuranceMode.mockReturnValue(makeMode({
      isInsurance: false, isPrivate: false, triageComplete: false, isPatient: true,
    }));

    const ctx: ConversationContext = {
      tenantId: 1, conversationId: 50,
      contactPhone: PATIENT_INSURANCE.phone,
      contactName:  "Silvia",
      contactType:  "patient",
      patientId: PATIENT_INSURANCE.id,
    };

    const r = await buildSplitPrompt(
      1, ctx, "scheduling", AGENDA,
      "preciso agendar uma consulta pelo plano", "neutral",
      false, 0, false, true,
    );
    fullPrompt = r.identity + "\n" + r.dynamicContext;
  });

  it("exibe o bloco PACIENTE com nome de paciente de convênio", () => {
    expect(fullPrompt).toContain("PACIENTE:");
    expect(fullPrompt).toContain("Silvia Campos");
  });

  it("proíbe SPIN Selling também para paciente de convênio", () => {
    expect(fullPrompt).toContain(
      "Nunca aplique SPIN Selling, tecnicas de venda ou pressao com pacientes",
    );
  });

  it("instrui tratamento caloroso igual para paciente de convênio", () => {
    expect(fullPrompt).toMatch(
      /Pacientes de convenio recebem o mesmo tratamento|JA e da clinica/i,
    );
  });

  it("NÃO ativa METODOLOGIA SPIN SELLING para paciente de convênio", () => {
    expect(fullPrompt).not.toContain("METODOLOGIA SPIN SELLING");
  });

  it("NÃO ativa MODO CONVENIO ATIVO (é paciente, não lead)", () => {
    expect(fullPrompt).not.toContain("MODO CONVENIO ATIVO");
  });

  it("NÃO contém pressão comercial para paciente de convênio", () => {
    for (const term of ["Consegui 2 encaixes", "sao os ultimos", "Escassez OBRIGATORIA"]) {
      expect(fullPrompt).not.toContain(term);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CENÁRIO K — Pré-triagem: pede agendamento antes de responder plano/particular
// ─────────────────────────────────────────────────────────────────────────────
describe("Cenário K — Pré-triagem: contato pede agendamento antes de declarar plano/particular", () => {
  let fullPrompt: string;

  beforeEach(async () => {
    mockGetCachedSettings.mockResolvedValue(BASE_SETTINGS);
    mockFindLeadFirst.mockResolvedValue(LEAD_UNKNOWN);
    mockFindPatientFirst.mockResolvedValue(null);
    mockFindAppointments.mockResolvedValue([]);
    mockResolveInsuranceMode.mockReturnValue(makeMode({
      isInsurance: false, isPrivate: false, triageComplete: false,
    }));

    const ctx: ConversationContext = {
      tenantId: 1, conversationId: 60,
      contactPhone: LEAD_UNKNOWN.phone,
      contactName:  "Amanda",
      contactType:  "lead",
      leadId: LEAD_UNKNOWN.id,
    };

    const r = await buildSplitPrompt(
      1, ctx, "scheduling", AGENDA,
      "quero marcar uma consulta", "neutral",
      true, 0, false, false,
      { preloadedLead: LEAD_UNKNOWN },
    );
    fullPrompt = r.identity + "\n" + r.dynamicContext;
  });

  it("bloqueia agendamento e pergunta plano/particular primeiro", () => {
    expect(fullPrompt).toMatch(
      /PROIBIDO.*horario.*plano.*particular|PROIBIDO.*convenio|plano ou e particular|ACAO UNICA NESTE MOMENTO/i,
    );
  });

  it("proíbe iniciar SPIN antes da triagem completar", () => {
    expect(fullPrompt).toMatch(/PROIBIDO.*SPIN|PROIBIDO comecar SPIN/i);
  });

  it("proíbe oferecer horários antes de conhecer o tipo de pagamento", () => {
    expect(fullPrompt).toMatch(/PROIBIDO.*horarios|PROIBIDO oferecer horarios|Nao avance para.*horarios/i);
  });

  it("proíbe mencionar preço durante a triagem pendente", () => {
    expect(fullPrompt).toMatch(/PROIBIDO mencionar preco|PROIBIDO.*prec[oô]|Nao avance para.*prec/i);
  });

  it("NÃO contém METODOLOGIA SPIN SELLING durante a triagem pendente", () => {
    expect(fullPrompt).not.toContain("METODOLOGIA SPIN SELLING");
  });

  it("NÃO contém termos de escassez/urgência durante a triagem", () => {
    for (const term of ["Consegui 2 encaixes", "sao os ultimos", "Escassez OBRIGATORIA"]) {
      expect(fullPrompt).not.toContain(term);
    }
  });

  it("NÃO contém MODO CONVENIO ATIVO (triagem ainda pendente)", () => {
    expect(fullPrompt).not.toContain("MODO CONVENIO ATIVO");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CENÁRIO L — Validação cruzada: lead particular e lead convênio em agendamento
// ─────────────────────────────────────────────────────────────────────────────
describe("Cenário L — Validação cruzada de agendamento: particular vs convênio na mesma clínica", () => {
  it("lead PARTICULAR: escassez obrigatória; lead CONVÊNIO: sem escassez — na mesma clínica", async () => {
    mockGetCachedSettings.mockResolvedValue(BASE_SETTINGS);
    mockFindAppointments.mockResolvedValue([]);

    // ── Lead particular ──────────────────────────────────────────────────────
    mockFindLeadFirst.mockResolvedValue(LEAD_WARM_PRIVATE);
    mockFindPatientFirst.mockResolvedValue(null);
    mockResolveInsuranceMode.mockReturnValue(makeMode({
      isInsurance: false, isPrivate: true, triageComplete: true,
    }));
    const ctxPrivate: ConversationContext = {
      tenantId: 1, conversationId: 70,
      contactPhone: LEAD_WARM_PRIVATE.phone, contactName: "Carlos",
      contactType: "lead", leadId: LEAD_WARM_PRIVATE.id,
    };
    const privateResult = await buildSplitPrompt(
      1, ctxPrivate, "scheduling", AGENDA, "quero marcar", "neutral",
      false, 0, false, true, { preloadedLead: LEAD_WARM_PRIVATE },
    );
    const privatePrompt = privateResult.identity + "\n" + privateResult.dynamicContext;

    // ── Lead convênio ────────────────────────────────────────────────────────
    mockFindLeadFirst.mockResolvedValue(LEAD_INSURANCE);
    mockResolveInsuranceMode.mockReturnValue(makeMode({
      isInsurance: true, isPrivate: false, triageComplete: true,
    }));
    const ctxInsurance: ConversationContext = {
      tenantId: 1, conversationId: 71,
      contactPhone: LEAD_INSURANCE.phone, contactName: "Fernanda",
      contactType: "lead", leadId: LEAD_INSURANCE.id,
    };
    const insuranceResult = await buildSplitPrompt(
      1, ctxInsurance, "scheduling", AGENDA, "quero agendar pelo plano", "neutral",
      false, 0, false, true, { preloadedLead: LEAD_INSURANCE },
    );
    const insurancePrompt = insuranceResult.identity + "\n" + insuranceResult.dynamicContext;

    // ── Particular: escassez presente ───────────────────────────────────────
    expect(privatePrompt).toContain("Consegui 2 encaixes");
    expect(privatePrompt).toContain("METODOLOGIA SPIN SELLING");
    expect(privatePrompt).not.toContain("MODO CONVENIO ATIVO");

    // ── Convênio: escassez ausente ───────────────────────────────────────────
    expect(insurancePrompt).toContain("MODO CONVENIO ATIVO");
    expect(insurancePrompt).not.toContain("METODOLOGIA SPIN SELLING");

    for (const term of FORBIDDEN_INSURANCE_SCHEDULING) {
      expect(
        insurancePrompt,
        `termo "${term}" VAZOU para o prompt de agendamento de convênio`,
      ).not.toContain(term);
    }
  });

  it("paciente PARTICULAR e paciente CONVÊNIO recebem o mesmo SPIN PROIBIDO", async () => {
    mockGetCachedSettings.mockResolvedValue(BASE_SETTINGS);
    mockFindLeadFirst.mockResolvedValue(null);

    // Paciente particular
    mockFindPatientFirst.mockResolvedValue(PATIENT_PRIVATE);
    mockFindAppointments.mockResolvedValue([]);
    mockResolveInsuranceMode.mockReturnValue(makeMode({ isPatient: true }));
    const ctxP: ConversationContext = {
      tenantId: 1, conversationId: 80,
      contactPhone: PATIENT_PRIVATE.phone, contactName: "Roberto",
      contactType: "patient", patientId: PATIENT_PRIVATE.id,
    };
    const rP = await buildSplitPrompt(1, ctxP, "scheduling", AGENDA, "quero marcar", "neutral");
    const particularPatientPrompt = rP.identity + "\n" + rP.dynamicContext;

    // Paciente de convênio
    mockFindPatientFirst.mockResolvedValue(PATIENT_INSURANCE);
    const ctxI: ConversationContext = {
      tenantId: 1, conversationId: 81,
      contactPhone: PATIENT_INSURANCE.phone, contactName: "Silvia",
      contactType: "patient", patientId: PATIENT_INSURANCE.id,
    };
    const rI = await buildSplitPrompt(1, ctxI, "scheduling", AGENDA, "quero marcar", "neutral");
    const insurancePatientPrompt = rI.identity + "\n" + rI.dynamicContext;

    const SPIN_PROIBIDO = "Nunca aplique SPIN Selling, tecnicas de venda ou pressao com pacientes";

    expect(particularPatientPrompt).toContain(SPIN_PROIBIDO);
    expect(insurancePatientPrompt).toContain(SPIN_PROIBIDO);

    expect(particularPatientPrompt).not.toContain("METODOLOGIA SPIN SELLING");
    expect(insurancePatientPrompt).not.toContain("METODOLOGIA SPIN SELLING");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CENÁRIO M — Regressão Task #14: filtro de especialidade "dente torto"
//
// Garante que quando o filtro de especialidade está ativo (professionalsOverride
// contendo apenas Siverino/ortodontia), o nome Robertino (implantodontia) não
// aparece no prompt — e que o hint de especialista indisponível é incluído quando
// a agenda do especialista está vazia e o fallback é acionado.
// ─────────────────────────────────────────────────────────────────────────────
describe("Cenário M — Regressão Task #14: vazamento de profissional fora da especialidade", () => {
  const PROF_SIVERINO = {
    id: 10, name: "Dr. Siverino", active: true,
    specialty: "Ortodontia", specialties: "Ortodontia,aparelho",
    cro: null, instagramUrl: null,
    chargesConsultation: true, consultationFee: "200",
    acceptsInsurance: false, insurancePlans: null,
    insuranceDays: null, insuranceHoursStart: null, insuranceHoursEnd: null,
    defaultLeadDurationMinutes: 30, defaultPatientDurationMinutes: 30,
    isOwner: false,
  };
  const PROF_ROBERTINO = {
    id: 20, name: "Dr. Robertino", active: true,
    specialty: "Implantodontia", specialties: "Implantodontia,protese,lente de contato",
    cro: null, instagramUrl: null,
    chargesConsultation: true, consultationFee: "300",
    acceptsInsurance: false, insurancePlans: null,
    insuranceDays: null, insuranceHoursStart: null, insuranceHoursEnd: null,
    defaultLeadDurationMinutes: 30, defaultPatientDurationMinutes: 30,
    isOwner: true,
  };

  const MULTI_PROF_SETTINGS = {
    ...BASE_SETTINGS,
    professionalName: "",
    clinicName: "OdontoClínica",
    acceptsInsurance: false,
    // Ensure string type so resolveConsultationFee can call .trim() on it.
    consultationFee: "200",
  };

  const LEAD_DENTE_TORTO = {
    id: 5, tenantId: 1, name: "Ana Lima", phone: "+5511999990005",
    email: null, temperature: "warm", status: "active", source: "Instagram",
    interest: "Aparelho ortodontico", notes: null, paymentType: "private",
    profilePicUrl: null, lastContactAt: null, professionalId: null,
    createdAt: new Date(), updatedAt: new Date(),
  };

  const CTX_DENTE_TORTO: ConversationContext = {
    tenantId: 1, conversationId: 90,
    contactPhone: LEAD_DENTE_TORTO.phone,
    contactName: "Ana",
    contactType: "lead",
    leadId: LEAD_DENTE_TORTO.id,
  };

  // ── (a) "dente torto" → professionalsOverride com só Siverino ─────────────
  it("(a) prompt com professionalsOverride={Siverino} não menciona Robertino", async () => {
    mockGetCachedSettings.mockResolvedValue(MULTI_PROF_SETTINGS);
    mockFindLeadFirst.mockResolvedValue(LEAD_DENTE_TORTO);
    mockFindPatientFirst.mockResolvedValue(null);
    mockFindAppointments.mockResolvedValue([]);
    mockResolveInsuranceMode.mockReturnValue(makeMode({ isPrivate: true, triageComplete: true }));

    // Override getCachedProfessionals to return both professionals.
    const { getCachedProfessionals } = await import("../lib/cache.js");
    (getCachedProfessionals as ReturnType<typeof vi.fn>).mockResolvedValue([
      PROF_SIVERINO,
      PROF_ROBERTINO,
    ]);

    const r = await buildSplitPrompt(
      1, CTX_DENTE_TORTO, "scheduling", "Seg 10:00 | Seg 14:00 (Dr. Siverino)",
      "coloquei dente torto, quero aparelho", "neutral",
      false, 0, false, true,
      {
        preloadedLead: LEAD_DENTE_TORTO,
        // Specialty filter active: only Siverino (ortodontia) gets through.
        professionalsOverride: [{ id: PROF_SIVERINO.id }],
      },
    );
    const fullPrompt = r.identityPrompt + "\n" + r.dynamicContext;

    expect(fullPrompt, "Siverino deve estar no prompt").toContain("Siverino");
    expect(fullPrompt, "Robertino NÃO deve aparecer no prompt quando override está ativo").not.toContain("Robertino");
  });

  // ── (b) histórico: "perdi um dente" → msg atual: "dente torto" ───────────
  // O filtro deve usar SOMENTE a mensagem atual (ortodontia), não o histórico.
  // Quando professionalsOverride={Siverino}, Robertino não deve aparecer.
  it("(b) histórico de implante + msg atual 'dente torto' → apenas Siverino no prompt", async () => {
    mockGetCachedSettings.mockResolvedValue(MULTI_PROF_SETTINGS);
    mockFindLeadFirst.mockResolvedValue(LEAD_DENTE_TORTO);
    mockFindPatientFirst.mockResolvedValue(null);
    mockFindAppointments.mockResolvedValue([]);
    mockResolveInsuranceMode.mockReturnValue(makeMode({ isPrivate: true, triageComplete: true }));

    const { getCachedProfessionals } = await import("../lib/cache.js");
    (getCachedProfessionals as ReturnType<typeof vi.fn>).mockResolvedValue([
      PROF_SIVERINO,
      PROF_ROBERTINO,
    ]);

    const r = await buildSplitPrompt(
      1, CTX_DENTE_TORTO, "scheduling", "Seg 10:00 | Seg 14:00 (Dr. Siverino)",
      "na verdade e dente torto, quero aparelho", "neutral",
      false, 0, false, true,
      {
        preloadedLead: LEAD_DENTE_TORTO,
        // ai-engine.ts, when currentMsg alone detects orthodontics, passes only Siverino.
        professionalsOverride: [{ id: PROF_SIVERINO.id }],
        // History with implant mention — in the fixed code this does NOT contaminate
        // the specialty detection because current message already matched orthodontics.
        conversationHistory: [
          { role: "user" as const, content: "perdi um dente" },
          { role: "assistant" as const, content: "Entendo. Vamos ver as opções..." },
        ],
      },
    );
    const fullPrompt = r.identityPrompt + "\n" + r.dynamicContext;

    expect(fullPrompt, "Siverino deve estar no prompt").toContain("Siverino");
    expect(fullPrompt, "Robertino NÃO deve aparecer no prompt quando override está ativo").not.toContain("Robertino");
  });

  // ── (c) "dente torto" + agenda do Siverino vazia → hint de indisponibilidade ─
  // Quando o fallback de agenda vazia reverte o override, o hint de especialidade
  // indisponível deve aparecer no prompt — a IA não deve oferecer Robertino
  // silenciosamente como alternativa.
  it("(c) quando override reverteu por agenda vazia, prompt contém hint de especialista indisponível", async () => {
    mockGetCachedSettings.mockResolvedValue(MULTI_PROF_SETTINGS);
    mockFindLeadFirst.mockResolvedValue(LEAD_DENTE_TORTO);
    mockFindPatientFirst.mockResolvedValue(null);
    mockFindAppointments.mockResolvedValue([]);
    mockResolveInsuranceMode.mockReturnValue(makeMode({ isPrivate: true, triageComplete: true }));

    const { getCachedProfessionals } = await import("../lib/cache.js");
    (getCachedProfessionals as ReturnType<typeof vi.fn>).mockResolvedValue([
      PROF_SIVERINO,
      PROF_ROBERTINO,
    ]);

    // Simulate: specialty filter found Siverino only, but his agenda was empty,
    // so ai-engine reverted professionalsOverride=null and injected the fallback hint.
    const specialtyFallbackHint = `[SISTEMA: ESPECIALISTA INDISPONIVEL — O contato solicitou "ortodontia" mas nao ha horarios disponiveis no momento com Dr. Siverino. PROIBIDO oferecer outros profissionais como alternativa sem deixar claro que sao de especialidades diferentes. Informe com gentileza que o especialista em ortodontia nao tem horarios disponiveis agora. Somente se o contato aceitar explicitamente ser atendido por outro profissional (de outra especialidade), apresente as opcoes da AGENDA. Nao mencione nomes de profissionais nem areas distintas antes dessa aceitacao.]`;

    const r = await buildSplitPrompt(
      1, CTX_DENTE_TORTO, "scheduling",
      // Availability now includes Robertino (after fallback)
      "Ter 09:00 | Ter 15:00 (Dr. Robertino)",
      "dente torto, quero aparelho", "neutral",
      false, 0, false, true,
      {
        preloadedLead: LEAD_DENTE_TORTO,
        // professionalsOverride is null (reverted by fallback)
        professionalsOverride: undefined,
        systemHints: [specialtyFallbackHint],
      },
    );
    const fullPrompt = r.identityPrompt + "\n" + r.dynamicContext;

    expect(
      fullPrompt,
      "prompt deve conter o hint de especialista indisponível quando o fallback foi acionado",
    ).toContain("ESPECIALISTA INDISPONIVEL");
    expect(
      fullPrompt,
      "prompt deve proibir oferecer outros profissionais sem aviso",
    ).toContain("PROIBIDO oferecer outros profissionais");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CENÁRIO N — Regressão Task #20: vazamento de profissional dropado via histórico
//
// Reproduz o caso real ("dente torto" → IA oferece Robertino lembrando do
// histórico de implante/PIX). Garante que, quando o ai-engine injeta o hint
// "[SISTEMA: ESPECIALIDADE FILTRADA ...]" via systemHints (com a lista de
// permitidos + lista de proibidos + cláusula de cobertura de convênio), o
// prompt final entregue ao LLM:
//   (a) declara nominalmente que apenas Siverino atende ortodontia;
//   (b) lista Robertino como PROIBIDO de ser mencionado nesta resposta;
//   (c) inclui a cláusula "especialista NAO atende por convenio" quando o
//       único especialista da área é particular e o paciente é de plano.
// ─────────────────────────────────────────────────────────────────────────────
describe("Cenário N — Regressão Task #20: hint bloqueia vazamento de profissional dropado", () => {
  const PROF_SIVERINO = {
    id: 10, name: "Dr. Siverino Braga", active: true,
    specialty: "Ortodontia", specialties: "Ortodontia,aparelho",
    cro: null, instagramUrl: null,
    chargesConsultation: true, consultationFee: "200",
    acceptsInsurance: false, insurancePlans: null,
    insuranceDays: null, insuranceHoursStart: null, insuranceHoursEnd: null,
    defaultLeadDurationMinutes: 30, defaultPatientDurationMinutes: 30,
    isOwner: false,
  };
  const PROF_ROBERTINO = {
    id: 20, name: "Dr. Robertino Oliveira", active: true,
    specialty: "Implantodontia", specialties: "Implantodontia,protese,lente de contato",
    cro: null, instagramUrl: null,
    chargesConsultation: true, consultationFee: "300",
    acceptsInsurance: true, insurancePlans: "Unimed",
    insuranceDays: "6", insuranceHoursStart: "08:00", insuranceHoursEnd: "12:00",
    defaultLeadDurationMinutes: 30, defaultPatientDurationMinutes: 30,
    isOwner: true,
  };

  const MULTI_PROF_SETTINGS = {
    ...BASE_SETTINGS,
    professionalName: "",
    clinicName: "OdontoClínica",
    acceptsInsurance: true,
    consultationFee: "200",
  };

  const LEAD_CONVENIO_DENTE_TORTO = {
    id: 6, tenantId: 1, name: "José Convenio", phone: "+5511999990006",
    email: null, temperature: "warm", status: "active", source: "WhatsApp",
    interest: "ortodontia", notes: null, paymentType: "insurance",
    profilePicUrl: null, lastContactAt: null, professionalId: null,
    createdAt: new Date(), updatedAt: new Date(),
  };

  const CTX_CONVENIO_DENTE_TORTO: ConversationContext = {
    tenantId: 1, conversationId: 91,
    contactPhone: LEAD_CONVENIO_DENTE_TORTO.phone,
    contactName: "José",
    contactType: "lead",
    leadId: LEAD_CONVENIO_DENTE_TORTO.id,
  };

  // Hint that ai-engine builds in the new Task #20 branch: nomeia permitidos +
  // proibidos + cláusula "não atende por convênio" (Siverino é particular e o
  // paciente é convênio).
  const TASK_20_HINT =
    `[SISTEMA: ESPECIALIDADE FILTRADA — Para a necessidade "ortodontia", os UNICOS profissionais habilitados desta clinica sao: Dr. Siverino Braga.` +
    ` PROIBIDO mencionar nesta resposta o(s) profissional(is): Dr. Robertino Oliveira — mesmo que aparecam no historico, eles NAO atendem ortodontia e nao podem ser oferecidos para essa necessidade.` +
    ` ATENCAO: o(s) especialista(s) em ortodontia desta clinica NAO atende(m) por convenio. Diga isso com clareza ao paciente e ofereca (a) atendimento PARTICULAR com Dr. Siverino Braga, ou (b) avaliacao. PROIBIDO oferecer profissional de outra especialidade so porque ele aceita o convenio do paciente.]`;

  it("(a) prompt contém o bloco ESPECIALIDADE FILTRADA com Siverino como único permitido", async () => {
    mockGetCachedSettings.mockResolvedValue(MULTI_PROF_SETTINGS);
    mockFindLeadFirst.mockResolvedValue(LEAD_CONVENIO_DENTE_TORTO);
    mockFindPatientFirst.mockResolvedValue(null);
    mockFindAppointments.mockResolvedValue([]);
    mockResolveInsuranceMode.mockReturnValue(makeMode({
      isInsurance: true, isPrivate: false, triageComplete: true,
    }));

    const { getCachedProfessionals } = await import("../lib/cache.js");
    (getCachedProfessionals as ReturnType<typeof vi.fn>).mockResolvedValue([
      PROF_SIVERINO,
      PROF_ROBERTINO,
    ]);

    const r = await buildSplitPrompt(
      1, CTX_CONVENIO_DENTE_TORTO, "scheduling",
      "Seg 10:00 (Dr. Siverino Braga)",
      "coloquei dente torto", "neutral",
      false, 0, false, true,
      {
        preloadedLead: LEAD_CONVENIO_DENTE_TORTO,
        professionalsOverride: [{ id: PROF_SIVERINO.id }],
        // Histórico com várias menções a Robertino (implante / PIX) — o que
        // antes contaminava a resposta atual.
        conversationHistory: [
          { role: "user", content: "quero saber sobre implante" },
          { role: "assistant", content: "Implante a gente atende com o Dr. Robertino Oliveira." },
          { role: "user", content: "quanto fica?" },
          { role: "assistant", content: "O Dr. Robertino faz por R$ 3.000, dá pra parcelar no PIX." },
          { role: "user", content: "ok, vou pensar" },
          { role: "assistant", content: "Sem problema! O Dr. Robertino fica à disposição." },
        ],
        systemHints: [TASK_20_HINT],
      },
    );
    const fullPrompt = r.identityPrompt + "\n" + r.dynamicContext;

    expect(fullPrompt).toContain("ESPECIALIDADE FILTRADA");
    expect(fullPrompt).toContain("Dr. Siverino Braga");
    // O hint EXPLICITAMENTE proíbe mencionar Robertino na resposta.
    expect(fullPrompt).toMatch(/PROIBIDO mencionar.*Robertino/);
    // E informa a IA sobre a falta de cobertura por convênio.
    expect(fullPrompt).toContain("NAO atende(m) por convenio");
    expect(fullPrompt).toContain("PROIBIDO oferecer profissional de outra especialidade");
  });

  it("(b) sem o hint Task #20 (clínica sem filtro), prompt NÃO contém o bloco — comportamento legado preservado", async () => {
    mockGetCachedSettings.mockResolvedValue(MULTI_PROF_SETTINGS);
    mockFindLeadFirst.mockResolvedValue(LEAD_CONVENIO_DENTE_TORTO);
    mockFindPatientFirst.mockResolvedValue(null);
    mockFindAppointments.mockResolvedValue([]);
    mockResolveInsuranceMode.mockReturnValue(makeMode({
      isInsurance: true, isPrivate: false, triageComplete: true,
    }));

    const { getCachedProfessionals } = await import("../lib/cache.js");
    (getCachedProfessionals as ReturnType<typeof vi.fn>).mockResolvedValue([
      PROF_SIVERINO,
      PROF_ROBERTINO,
    ]);

    const r = await buildSplitPrompt(
      1, CTX_CONVENIO_DENTE_TORTO, "scheduling",
      "Seg 10:00 (Dr. Siverino Braga)",
      "quero marcar consulta", "neutral",
      false, 0, false, true,
      {
        preloadedLead: LEAD_CONVENIO_DENTE_TORTO,
        // Sem override e sem hint: nenhum bloco Task #20 deve aparecer.
      },
    );
    const fullPrompt = r.identityPrompt + "\n" + r.dynamicContext;
    expect(fullPrompt).not.toContain("ESPECIALIDADE FILTRADA");
  });
});
