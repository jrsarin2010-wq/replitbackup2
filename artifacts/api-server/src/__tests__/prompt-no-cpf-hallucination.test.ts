/**
 * BLINDAGEM ANTI-ALUCINACAO: pedidos de CPF, RG e carteirinha
 *
 * Contexto: a IA estava inventando solicitacoes de CPF, RG, carteirinha e
 * nome completo para "verificar elegibilidade" do plano — comportamento
 * NUNCA configurado. A causa eram instrucoes ambiguas no prompt-builder
 * (linhas 500 e 1005) que mandavam "VALIDAR" o plano, e a IA inferia que
 * validacao = pedir documentos pessoais (como recepcionista humana faria).
 *
 * Estes testes travam a correcao cirurgica:
 *   1) Linguagem de "validacao" foi trocada por "comparacao" (sem gatilho semantico)
 *   2) Bloqueio explicito anti-CPF/RG/carteirinha em REGRAS GERAIS (DADOS PESSOAIS)
 *   3) Bloqueio inline em cada bloco que fala de plano
 *   4) PIX nunca aparece para contato de convenio (regressao do guard existente)
 *   5) Linhas 873/977: "Convenio:" e "Atende (convenio):" nao coexistem no mesmo
 *      profissional (fonte unica de verdade — sem contradicao para o LLM)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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
  getCachedSettings:      vi.fn(),
  getCachedProcedures:    vi.fn().mockResolvedValue([{ name: "Limpeza", price: 150 }]),
  getCachedProfessionals: vi.fn(),
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
    resolveInsuranceMode: vi.fn(),
    getTopStrategies: vi.fn().mockResolvedValue([]),
  };
});

import { buildSplitPrompt } from "../lib/prompt-builder.js";
import { buildPixInstructionsSection } from "../lib/prompt-helpers.js";
import { getCachedSettings, getCachedProfessionals } from "../lib/cache.js";
import { resolveInsuranceMode } from "../lib/lead-engine.js";
import type { ConversationContext } from "../lib/lead-engine.js";

const CONTEXT: ConversationContext = {
  tenantId:     1,
  conversationId: 1,
  contactPhone: "+5511999999999",
  contactName:  "Maria",
  contactType:  "unknown",
};

const AGENDA = "Seg 09:00 | Ter 14:00";

const SETTINGS_INSURANCE_ON = {
  clinicName:         "Clinica Teste",
  aiName:             "Ana",
  workingHoursStart:  "08:00",
  workingHoursEnd:    "18:00",
  acceptsInsurance:   true,
  insurancePlans:     "Unimed, Bradesco",
  insuranceDays:      "1,2,3,4,5",
  chargesConsultation: true,
  consultationFee:    "150.00",
  paymentMethods:     "Cartao, PIX",
  utcOffsetHours:     -3,
  activeDays:         "1,2,3,4,5",
};

const PROFS_TWO_INSURANCE = [
  {
    id: 1, name: "Dr. Joao", active: true, specialty: "Clinica Geral", cro: "12345",
    instagramUrl: null, chargesConsultation: true, consultationFee: "150.00",
    acceptsInsurance: true, insurancePlans: "Unimed, Bradesco",
    insuranceDays: "1,2,3,4,5",
    workingDays: "1,2,3,4,5", workingHoursStart: "08:00", workingHoursEnd: "18:00",
    defaultLeadDurationMinutes: 30, defaultPatientDurationMinutes: 30,
    pixEnabled: true, pixMode: "required", pixKey: "12345678900",
    pixKeyType: "cpf", pixBank: "Itau",
  },
  {
    id: 2, name: "Dra. Ana", active: true, specialty: "Ortodontia", cro: "67890",
    instagramUrl: null, chargesConsultation: true, consultationFee: "200.00",
    acceptsInsurance: true, insurancePlans: "Unimed",
    insuranceDays: "2,4",
    workingDays: "1,2,3,4,5", workingHoursStart: "09:00", workingHoursEnd: "17:00",
    defaultLeadDurationMinutes: 30, defaultPatientDurationMinutes: 30,
    pixEnabled: false, pixMode: "optional", pixKey: null,
    pixKeyType: null, pixBank: null,
  },
];

beforeEach(() => {
  vi.mocked(getCachedSettings).mockResolvedValue(SETTINGS_INSURANCE_ON as never);
  vi.mocked(getCachedProfessionals).mockResolvedValue(PROFS_TWO_INSURANCE as never);
  // resolveInsuranceMode e SINCRONA — usar mockReturnValue, nao mockResolvedValue
  vi.mocked(resolveInsuranceMode).mockReturnValue({
    isInsurance:           false,
    isPrivate:             false,
    triageComplete:        false,
    insuranceExplicitInCurrent: false,
    privateExplicitInCurrent:   false,
  } as never);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Anti-alucinacao CPF/RG/carteirinha — bloco DADOS PESSOAIS
// ─────────────────────────────────────────────────────────────────────────────
describe("Anti-alucinacao #1 — bloqueio global de CPF/RG/carteirinha", () => {
  it("inclui bloco DADOS PESSOAIS — REGRA ABSOLUTA com proibicao explicita", async () => {
    const { dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "scheduling", AGENDA, "", "neutral", false, 0, false, true,
    );
    expect(dynamicContext).toContain("DADOS PESSOAIS — REGRA ABSOLUTA");
    expect(dynamicContext).toMatch(/NUNCA peca CPF/i);
    expect(dynamicContext).toContain("RG");
    expect(dynamicContext).toContain("carteirinha");
    expect(dynamicContext).toContain("nome completo");
    expect(dynamicContext).toMatch(/elegibilidade/i);
  });

  it("posiciona DADOS PESSOAIS dentro de REGRAS GERAIS, antes de INCERTEZA", async () => {
    const { dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "scheduling", AGENDA, "", "neutral", false, 0, false, true,
    );
    const idxRegrasHeader = dynamicContext.indexOf("=== REGRAS GERAIS ===");
    const idxDados = dynamicContext.indexOf("DADOS PESSOAIS — REGRA ABSOLUTA");
    const idxIncerteza = dynamicContext.indexOf("INCERTEZA:");
    expect(idxRegrasHeader).toBeGreaterThan(-1);
    expect(idxDados).toBeGreaterThan(idxRegrasHeader);
    expect(idxIncerteza).toBeGreaterThan(idxDados);
  });

  it("bloco PRECOS E PAGAMENTO menciona NUNCA peca CPF inline (PLANOS ACEITOS)", async () => {
    const { dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "scheduling", AGENDA, "", "neutral", false, 0, false, true,
    );
    const idxPlanos = dynamicContext.indexOf("PLANOS ACEITOS:");
    expect(idxPlanos).toBeGreaterThan(-1);
    const planosBlock = dynamicContext.substring(idxPlanos, idxPlanos + 800);
    expect(planosBlock).toMatch(/NUNCA peca CPF/i);
    expect(planosBlock).toContain("carteirinha");
  });

  it("removeu a antiga 'VALIDACAO OBRIGATORIA DE PLANO' do prompt (gatilho de alucinacao)", async () => {
    const { dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "scheduling", AGENDA, "", "neutral", false, 0, false, true,
    );
    expect(dynamicContext).not.toContain("VALIDACAO OBRIGATORIA DE PLANO");
    expect(dynamicContext).not.toContain("REGRA CRITICA DE PLANOS");
  });

  it("substituiu pelas instrucoes neutras: COMPARACAO COM A LISTA DE PLANOS e PLANOS ACEITOS", async () => {
    const { dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "scheduling", AGENDA, "", "neutral", false, 0, false, true,
    );
    expect(dynamicContext).toContain("COMPARACAO COM A LISTA DE PLANOS");
    expect(dynamicContext).toContain("PLANOS ACEITOS:");
  });

  // Matriz: bloco DADOS PESSOAIS — REGRA ABSOLUTA esta presente em TODOS os modos
  // (e a defesa global; mesmo se os blocos inline forem suprimidos por configuracao,
  // a IA deve sempre receber a regra de NUNCA pedir CPF/RG/carteirinha).
  it.each([
    { label: "default (sem conversationMode)",      opts: {} as Record<string, unknown> },
    { label: "CONVENIO_TRIAGEM",                    opts: { conversationMode: "CONVENIO_TRIAGEM" } },
    { label: "CONVENIO_AGENDAR + isInsuranceContact", opts: { conversationMode: "CONVENIO_AGENDAR", isInsuranceContact: true } },
    { label: "PARTICULAR_SPIN",                     opts: { conversationMode: "PARTICULAR_SPIN" } },
  ])("DADOS PESSOAIS — REGRA ABSOLUTA aparece em modo: $label", async ({ opts }) => {
    const { dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "scheduling", AGENDA, "", "neutral", false, 0, false, true, opts,
    );
    expect(dynamicContext).toContain("DADOS PESSOAIS — REGRA ABSOLUTA");
    expect(dynamicContext).toMatch(/NUNCA peca CPF/i);
    expect(dynamicContext).toContain("carteirinha");
  });

  it("blindagem global anti-CPF continua presente mesmo SEM lista de planos (allInsurancePlansList vazia)", async () => {
    // Settings sem insurancePlans + profs sem insurancePlans => allInsurancePlansList
    // fica vazia, blocos inline somem, mas DADOS PESSOAIS — REGRA ABSOLUTA persiste.
    vi.mocked(getCachedSettings).mockResolvedValue({
      ...SETTINGS_INSURANCE_ON,
      insurancePlans: null,
      acceptedInsurances: null,
    } as never);
    vi.mocked(getCachedProfessionals).mockResolvedValue([
      {
        id: 99, name: "Dr. Solo", specialty: "Clinica Geral", customCro: "99999",
        consultationPrice: "150.00", durationMin: 30, leadDurationMin: 30,
        acceptsInsurance: false, insurancePlans: null, insuranceDays: null,
        acceptsParticular: true, particularDays: "1,2,3,4,5",
        startTime: "08:00", endTime: "18:00", emergencyOnly: false,
        pixEnabled: false, pixKey: null, pixMode: null,
        pixKeyType: null, pixBank: null,
      },
    ] as never);
    const { dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "scheduling", AGENDA, "", "neutral", false, 0, false, true,
    );
    // Blocos inline NAO aparecem (allInsurancePlansList vazio)
    expect(dynamicContext).not.toContain("COMPARACAO COM A LISTA DE PLANOS");
    expect(dynamicContext).not.toContain("PLANOS ACEITOS:");
    // Mas a defesa global continua
    expect(dynamicContext).toContain("DADOS PESSOAIS — REGRA ABSOLUTA");
    expect(dynamicContext).toMatch(/NUNCA peca CPF/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. PIX nunca aparece para contato de convenio
// ─────────────────────────────────────────────────────────────────────────────
describe("Anti-alucinacao #2 — PIX nunca para contato de convenio", () => {
  it("buildPixInstructionsSection retorna string vazia quando isInsuranceContact=true (mesmo com pix obrigatorio)", () => {
    const result = buildPixInstructionsSection(PROFS_TWO_INSURANCE, true);
    expect(result).toBe("");
  });

  it("buildPixInstructionsSection retorna instrucoes quando isInsuranceContact=false e ha pix configurado", () => {
    const result = buildPixInstructionsSection(PROFS_TWO_INSURANCE, false);
    expect(result).toContain("PIX OBRIGATORIO");
    expect(result).not.toBe("");
  });

  it("prompt completo com isInsuranceContact=true NAO contem PIX OBRIGATORIO nem PIX OPCIONAL", async () => {
    vi.mocked(resolveInsuranceMode).mockReturnValue({
      isInsurance:           true,
      isPrivate:             false,
      triageComplete:        true,
      insuranceExplicitInCurrent: true,
      privateExplicitInCurrent:   false,
    } as never);
    const { dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "scheduling", AGENDA, "", "neutral", false, 0, false, true,
      { isInsuranceContact: true, conversationMode: "CONVENIO_AGENDAR" },
    );
    // Cabecalhos do card PIX nao aparecem; texto descritivo de campo pode aparecer
    expect(dynamicContext).not.toContain("PIX OBRIGATORIO — PAGAMENTO ANTES DO ATENDIMENTO");
    expect(dynamicContext).not.toContain("PIX OPCIONAL");
    expect(dynamicContext).not.toContain("PIX — INSTRUCOES:");
    // Tambem garante que o bloqueio explicito do bloco PRECOS E PAGAMENTO esta la
    expect(dynamicContext).toMatch(/Paciente de CONVENIO.*NAO mencione.*PIX/);
  });

  it("prompt em CONVENIO_TRIAGEM (tipo nao definido) NAO contem instrucoes proativas de envio de PIX", async () => {
    const { dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "scheduling", AGENDA, "", "neutral", false, 0, false, true,
      { conversationMode: "CONVENIO_TRIAGEM" },
    );
    // Triagem em andamento bloqueia PIX explicitamente
    expect(dynamicContext).toMatch(/Triagem em andamento.*NAO mencione PIX/);
    // Cabecalhos do card PIX (instrucao de "envie o card agora") nao aparecem.
    // O texto "PIX OBRIGATORIO" pode aparecer apenas como descricao de campo
    // do profissional ("Consulta R$X — pagamento antecipado via PIX OBRIGATORIO"),
    // que e meta-info, nao instrucao para a IA enviar PIX agora.
    expect(dynamicContext).not.toContain("PIX OBRIGATORIO — PAGAMENTO ANTES DO ATENDIMENTO");
    expect(dynamicContext).not.toContain("PIX OPCIONAL");
    expect(dynamicContext).not.toContain("PIX — INSTRUCOES:");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Nao-contradicao convenio/particular (linhas 873/977)
// ─────────────────────────────────────────────────────────────────────────────
describe("Anti-contradicao #3 — Convenio: e Atende (convenio): nao coexistem", () => {
  it("multi-prof com contato de convenio: linha do profissional usa Plano: em vez de Convenio:", async () => {
    // Sync mock — resolveInsuranceMode e SINCRONA (mockReturnValue, nao mockResolvedValue).
    vi.mocked(resolveInsuranceMode).mockReturnValue({
      isInsurance:           true,
      isPrivate:             false,
      triageComplete:        true,
      triageNeeded:          false,
      insuranceExplicitInCurrent: true,
      privateExplicitInCurrent:   false,
    } as never);
    const { dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "scheduling", AGENDA, "", "neutral", false, 0, false, true,
      { isInsuranceContact: true, conversationMode: "CONVENIO_AGENDAR" },
    );
    // Filtra so as linhas detalhadas do bloco PROFISSIONAIS (com "CRO:"),
    // ignorando o bloco resumido de precos por profissional.
    const linhasProfs = dynamicContext
      .split("\n")
      .filter((l) => (l.startsWith("- Dr") || l.startsWith("- Dra")) && l.includes("CRO:"));
    expect(linhasProfs.length).toBeGreaterThan(0);
    for (const linha of linhasProfs) {
      // Em modo convenio com isInsurance=true: campo "Convenio:" desaparece;
      // o campo correto e "Plano:" (lista de planos do profissional).
      expect(linha).not.toMatch(/ \| Convenio: /);
      expect(linha).toMatch(/ \| Plano: /);
    }
  });

  it("contato com particular declarado (isPrivate=true via mock): linhas dos profissionais NAO contem Convenio: nem Plano:", async () => {
    // Override local do mock para forcar isPrivate=true.
    vi.mocked(resolveInsuranceMode).mockReturnValue({
      isInsurance:           false,
      isPrivate:             true,
      triageComplete:        true,
      triageNeeded:          false,
      insuranceExplicitInCurrent: false,
      privateExplicitInCurrent:   true,
    } as never);
    const { dynamicContext } = await buildSplitPrompt(
      1, CONTEXT, "scheduling", AGENDA, "", "neutral", false, 0, false, true,
      { conversationMode: "PARTICULAR_SPIN" },
    );
    const linhasProfs = dynamicContext.split("\n").filter((l) => l.startsWith("- Dr") || l.startsWith("- Dra"));
    expect(linhasProfs.length).toBeGreaterThan(0);
    for (const linha of linhasProfs) {
      expect(linha).not.toMatch(/ \| Convenio: /);
      expect(linha).not.toMatch(/ \| Plano: /);
    }
  });
});
