/**
 * BLINDAGEM ANTI-REGRESSÃO — CONVÊNIO
 *
 * Este arquivo trava os dois bugs que foram corrigidos inúmeras vezes e
 * continuavam voltando. Se qualquer mudança futura quebrar esses
 * comportamentos, os testes falham ANTES de chegar em produção.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * BUG #A — Duas fontes de verdade para clinicAcceptsInsurance
 *
 *   CENÁRIO DO BUG: settings.acceptsInsurance=false + profissional.acceptsInsurance=true
 *   PROBLEMA:       ai-engine retornava TRUE, prompt-builder retornava FALSE
 *   CONSEQUÊNCIA:   IA tratava paciente de convênio como particular (SPIN, escassez)
 *   CORREÇÃO:       ai-engine passa clinicAcceptsInsurance via opts para buildSplitPrompt
 *
 * ═══════════════════════════════════════════════════════════════════════
 * BUG #B — Termos de venda não bloqueados em tempo real para convênio
 *
 *   CENÁRIO DO BUG: isInsuranceContact=true, IA responde com "agenda disputada"
 *   PROBLEMA:       response-validator não checava FORBIDDEN_INSURANCE_TERMS
 *   CONSEQUÊNCIA:   termos de venda chegavam ao paciente de convênio
 *   CORREÇÃO:       validateAIResponse chama findForbiddenTerms quando isInsuranceContact=true
 *
 * ═══════════════════════════════════════════════════════════════════════
 * REGRA: Se precisar mudar o comportamento de convênio, atualize
 * PRIMEIRO estes testes para refletir o novo comportamento esperado,
 * DEPOIS faça a mudança no código. Nunca o contrário.
 */

import { describe, it, expect, vi } from "vitest";

// ─── Mocks compartilhados ────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    query: {
      dentalLeadsTable:  { findFirst: vi.fn().mockResolvedValue(null) },
      patientsTable:     { findFirst: vi.fn().mockResolvedValue(null) },
      appointmentsTable: { findMany:  vi.fn().mockResolvedValue([]) },
    },
  },
  dentalLeadsTable:  { name: "dental_leads" },
  patientsTable:     { name: "patients" },
  appointmentsTable: { name: "appointments" },
}));

vi.mock("../lib/ai-learning", () => ({
  getContactMemories:     vi.fn().mockResolvedValue([]),
  getRelevantObjections:  vi.fn().mockResolvedValue([]),
  getRelevantKnowledge:   vi.fn().mockResolvedValue([]),
  getOptimizedStrategies: vi.fn().mockResolvedValue([]),
}));

vi.mock("../lib/lead-engine", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return { ...real, getTopStrategies: vi.fn().mockResolvedValue([]) };
});

// Settings base: master toggle DESLIGADO na clínica
const BASE_SETTINGS = {
  clinicName:          "Clinica Teste",
  aiName:              "Ana",
  professionalName:    "Dra. Maria",
  professionalGender:  "female",
  workingHoursStart:   "08:00",
  workingHoursEnd:     "18:00",
  chargesConsultation: false,
  consultationFee:     0,
  paymentMethods:      "PIX, Cartão",
  utcOffsetHours:      -3,
  activeDays:          "1,2,3,4,5",
  acceptsInsurance:    false,   // ← master toggle DESLIGADO
  insurancePlans:      null,
};

// Profissional que aceita convênio individualmente
const PROF_ACEITA_CONVENIO = {
  id: 1, name: "Dra. Maria", active: true, specialty: null, cro: null,
  instagramUrl: null, chargesConsultation: false, consultationFee: 0,
  acceptsInsurance: true,           // ← profissional ACEITA
  insurancePlans: "Unimed, Amil",
  insuranceDays: null,
  defaultLeadDurationMinutes: 30,
  defaultPatientDurationMinutes: 30,
};

import { buildSplitPrompt } from "../lib/prompt-builder.js";
import { validateAIResponse } from "../lib/response-validator.js";
import type { ConversationContext } from "../lib/lead-engine.js";

const CONTEXT: ConversationContext = {
  tenantId:       1,
  conversationId: 1,
  contactPhone:   "+5511999999999",
  contactName:    "João",
  contactType:    "lead",
};

// ─────────────────────────────────────────────────────────────────────────────
// BUG #A — clinicAcceptsInsurance: fonte única de verdade
// ─────────────────────────────────────────────────────────────────────────────
describe("BUG #A — clinicAcceptsInsurance: fonte única de verdade via opts", () => {
  it("quando opts.clinicAcceptsInsurance=true, prompt contém MODO CONVENIO mesmo com settings.acceptsInsurance=false", async () => {
    const { getCachedSettings, getCachedProfessionals, getCachedProcedures, TenantCache } =
      await import("../lib/cache.js");

    vi.mocked(getCachedSettings).mockResolvedValue(BASE_SETTINGS as any);
    vi.mocked(getCachedProfessionals).mockResolvedValue([PROF_ACEITA_CONVENIO] as any);
    vi.mocked(getCachedProcedures).mockResolvedValue([]);

    // Simula o comportamento do ai-engine: calcula TRUE (settings OR profissional)
    // e passa via opts — isso é a correção do Bug #A
    const { identityPrompt, dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "scheduling", "Seg 09:00 | Ter 14:00",
      "quero agendar pelo meu plano", "neutral", false, 0, false, true,
      {
        clinicAcceptsInsurance: true,  // ← ai-engine passou TRUE corretamente
      },
    );

    const fullPrompt = identityPrompt + dynamicContext;

    // O prompt DEVE conter modo convênio — porque clinicAcceptsInsurance=true foi passado
    expect(fullPrompt).toMatch(/MODO CONVENIO ATIVO|convenio|plano/i);

    // O prompt NÃO deve conter SPIN selling — convênio não usa técnicas de venda
    expect(fullPrompt).not.toMatch(/METODOLOGIA SPIN SELLING|ESTRATEGIAS ATIVAS/i);
  });

  it("quando opts.clinicAcceptsInsurance=false, prompt NÃO contém MODO CONVENIO mesmo com profissional aceitando", async () => {
    const { getCachedSettings, getCachedProfessionals, getCachedProcedures } =
      await import("../lib/cache.js");

    vi.mocked(getCachedSettings).mockResolvedValue(BASE_SETTINGS as any);
    vi.mocked(getCachedProfessionals).mockResolvedValue([PROF_ACEITA_CONVENIO] as any);
    vi.mocked(getCachedProcedures).mockResolvedValue([]);

    const { identityPrompt, dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "scheduling", "Seg 09:00 | Ter 14:00",
      "quero agendar", "neutral", false, 0, false, true,
      {
        clinicAcceptsInsurance: false,  // ← master toggle desligado
      },
    );

    const fullPrompt = identityPrompt + dynamicContext;

    // Não deve conter modo convênio — master toggle está desligado
    expect(fullPrompt).not.toMatch(/MODO CONVENIO ATIVO/i);
  });

  it("sem opts.clinicAcceptsInsurance, faz fallback para cálculo local (compatibilidade)", async () => {
    const { getCachedSettings, getCachedProfessionals, getCachedProcedures } =
      await import("../lib/cache.js");

    // Settings com acceptsInsurance=true para que o cálculo local funcione
    vi.mocked(getCachedSettings).mockResolvedValue({
      ...BASE_SETTINGS,
      acceptsInsurance: true,
    } as any);
    vi.mocked(getCachedProfessionals).mockResolvedValue([PROF_ACEITA_CONVENIO] as any);
    vi.mocked(getCachedProcedures).mockResolvedValue([]);

    // Sem clinicAcceptsInsurance no opts — deve calcular localmente
    const { identityPrompt, dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "scheduling", "Seg 09:00",
      "quero agendar", "neutral", false, 0, false, true,
      // sem clinicAcceptsInsurance no opts
    );

    const fullPrompt = identityPrompt + dynamicContext;

    // Deve funcionar normalmente com o cálculo local
    expect(typeof fullPrompt).toBe("string");
    expect(fullPrompt.length).toBeGreaterThan(100);
  });

  it("CENÁRIO EXATO DO BUG: settings=false + profissional=true + opts=true → MODO CONVENIO ativo", async () => {
    // Este teste reproduz exatamente o cenário que causava o bug:
    // - Clínica com master toggle DESLIGADO (settings.acceptsInsurance=false)
    // - Profissional ACEITA convênio individualmente
    // - ai-engine calcula TRUE e passa via opts
    // ANTES DA CORREÇÃO: prompt-builder ignorava opts e recalculava → FALSE → bug
    // DEPOIS DA CORREÇÃO: prompt-builder usa opts → TRUE → comportamento correto

    const { getCachedSettings, getCachedProfessionals, getCachedProcedures } =
      await import("../lib/cache.js");

    vi.mocked(getCachedSettings).mockResolvedValue({
      ...BASE_SETTINGS,
      acceptsInsurance: false,  // master toggle DESLIGADO
    } as any);
    vi.mocked(getCachedProfessionals).mockResolvedValue([
      { ...PROF_ACEITA_CONVENIO, acceptsInsurance: true },  // profissional ACEITA
    ] as any);
    vi.mocked(getCachedProcedures).mockResolvedValue([]);

    const { identityPrompt, dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "scheduling", "Seg 09:00",
      "quero agendar pelo unimed", "neutral", false, 0, false, true,
      {
        // ai-engine calculou: false || true = TRUE e passou aqui
        clinicAcceptsInsurance: true,
      },
    );

    const fullPrompt = identityPrompt + dynamicContext;

    // DEVE ter modo convênio — o ai-engine mandou TRUE
    expect(fullPrompt).toMatch(/MODO CONVENIO ATIVO|convenio|plano/i);

    // NÃO DEVE ter SPIN — convênio não usa técnicas de venda
    expect(fullPrompt).not.toContain("METODOLOGIA SPIN SELLING");
    expect(fullPrompt).not.toContain("ESTRATEGIAS ATIVAS");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG #B — Termos de venda bloqueados em tempo real para convênio
// ─────────────────────────────────────────────────────────────────────────────
describe("BUG #B — validateAIResponse bloqueia termos de venda para convênio", () => {
  const BASE_CTX = {
    availabilityInfo: "Seg 09:00 | Ter 14:00",
    triagePending: false,
    procedureNames: ["Limpeza"],
    ownerTitle: "Dra." as const,
    ownerFirstName: "Maria",
    consultationFee: "0",
    procedurePrices: [],
    acceptsInsurance: true,
    isInsuranceContact: true,  // ← paciente de convênio
  };

  it("detecta 'agenda disputada' em resposta para paciente de convênio", () => {
    const violations = validateAIResponse({
      ...BASE_CTX,
      reply: "Oi! A nossa agenda está disputada, é melhor garantir logo.",
    });
    expect(violations.some((v) => v.type === "insurance_sales_term")).toBe(true);
  });

  it("detecta 'última vaga' em resposta para paciente de convênio", () => {
    const violations = validateAIResponse({
      ...BASE_CTX,
      reply: "Temos a última vaga disponível para amanhã às 09:00.",
    });
    expect(violations.some((v) => v.type === "insurance_sales_term")).toBe(true);
  });

  it("detecta 'consegui um encaixe' em resposta para paciente de convênio", () => {
    const violations = validateAIResponse({
      ...BASE_CTX,
      reply: "Consegui um encaixe especial pra você na sexta às 10h!",
    });
    expect(violations.some((v) => v.type === "insurance_sales_term")).toBe(true);
  });

  it("detecta 'restam apenas' em resposta para paciente de convênio", () => {
    const violations = validateAIResponse({
      ...BASE_CTX,
      reply: "Restam apenas 2 horários disponíveis esta semana.",
    });
    expect(violations.some((v) => v.type === "insurance_sales_term")).toBe(true);
  });

  it("detecta 'melhor garantir agora' em resposta para paciente de convênio", () => {
    const violations = validateAIResponse({
      ...BASE_CTX,
      reply: "É melhor garantir agora antes que alguém pegue o horário.",
    });
    expect(violations.some((v) => v.type === "insurance_sales_term")).toBe(true);
  });

  it("detecta 'fila de espera' como pressão indevida para paciente de convênio", () => {
    const violations = validateAIResponse({
      ...BASE_CTX,
      reply: "Posso te colocar na fila de espera se preferir.",
    });
    expect(violations.some((v) => v.type === "insurance_sales_term")).toBe(true);
  });

  it("NÃO flagra resposta neutra e acolhedora para paciente de convênio", () => {
    const violations = validateAIResponse({
      ...BASE_CTX,
      reply: "Olá! Claro, atendemos pelo Unimed sim. Qual seria sua queixa ou o que precisa consultar?",
    });
    expect(violations.some((v) => v.type === "insurance_sales_term")).toBe(false);
  });

  it("NÃO flagra resposta com horário disponível sem pressão", () => {
    const violations = validateAIResponse({
      ...BASE_CTX,
      reply: "Temos horário na segunda às 09:00 ou terça às 14:00. Qual prefere?",
    });
    expect(violations.some((v) => v.type === "insurance_sales_term")).toBe(false);
  });

  it("NÃO flagra termos de venda quando isInsuranceContact=false (lead particular)", () => {
    const violations = validateAIResponse({
      ...BASE_CTX,
      isInsuranceContact: false,  // ← particular
      reply: "A agenda está disputada! Consegui um encaixe especial pra você.",
    });
    // Para particular é permitido usar escassez — não deve flagrar
    expect(violations.some((v) => v.type === "insurance_sales_term")).toBe(false);
  });

  it("NÃO flagra quando isInsuranceContact não está definido (contexto sem convênio)", () => {
    const violations = validateAIResponse({
      ...BASE_CTX,
      isInsuranceContact: undefined,  // ← campo não enviado
      reply: "Restam apenas 2 vagas esta semana.",
    });
    expect(violations.some((v) => v.type === "insurance_sales_term")).toBe(false);
  });

  it("deterministicFallback para insurance_sales_term retorna mensagem neutra de agendamento", () => {
    const { deterministicFallback } = require("../lib/response-validator.js");
    const fallback = deterministicFallback([
      { type: "insurance_sales_term", detail: "Usou 'agenda disputada'" },
    ]);
    // Deve ser uma mensagem neutra — sem pressão, sem escassez
    expect(fallback).not.toMatch(/disputada|urgencia|ultima vaga|garante/i);
    // Deve mencionar agendamento de forma neutra
    expect(fallback).toMatch(/agendar|consulta|convenio|dia/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSÃO COMBINADA — os dois bugs juntos
// ─────────────────────────────────────────────────────────────────────────────
describe("Regressão combinada — Bug #A + Bug #B juntos", () => {
  it("mesmo com settings.acceptsInsurance=false+profissional=true: prompt correto E termos bloqueados", async () => {
    // Este é o cenário mais crítico: settings desligado, profissional ligado.
    // Bug #A garantiu que o prompt seja construído corretamente.
    // Bug #B garante que termos de venda sejam bloqueados na resposta.

    const { getCachedSettings, getCachedProfessionals, getCachedProcedures } =
      await import("../lib/cache.js");

    vi.mocked(getCachedSettings).mockResolvedValue({
      ...BASE_SETTINGS,
      acceptsInsurance: false,
    } as any);
    vi.mocked(getCachedProfessionals).mockResolvedValue([
      { ...PROF_ACEITA_CONVENIO, acceptsInsurance: true },
    ] as any);
    vi.mocked(getCachedProcedures).mockResolvedValue([]);

    // Bug #A: prompt deve reconhecer convênio quando ai-engine passa TRUE
    const { identityPrompt, dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "scheduling", "Seg 09:00",
      "quero marcar pelo plano", "neutral", false, 0, false, true,
      { clinicAcceptsInsurance: true },
    );
    const fullPrompt = identityPrompt + dynamicContext;
    expect(fullPrompt).toMatch(/MODO CONVENIO ATIVO|convenio|plano/i);
    expect(fullPrompt).not.toContain("METODOLOGIA SPIN SELLING");

    // Bug #B: mesmo com prompt correto, validador ainda deve barrar termos de venda
    const violations = validateAIResponse({
      availabilityInfo: "Seg 09:00",
      triagePending: false,
      procedureNames: [],
      ownerTitle: null,
      ownerFirstName: null,
      consultationFee: null,
      procedurePrices: [],
      acceptsInsurance: true,
      isInsuranceContact: true,
      reply: "A nossa agenda está disputada essa semana, melhor garantir agora!",
    });
    expect(violations.some((v) => v.type === "insurance_sales_term")).toBe(true);
  });
});
