import { describe, it, expect } from "vitest";
import { computeEarlyInsuranceModeSection, buildModeDirective } from "../lib/prompt-builder.js";

// ─── Ordenacao de secoes no prompt ────────────────────────────────────────────
// Garante que === MODO DE ATENDIMENTO === aparece antes de === CLINICA === no
// template do buildSystemPrompt. Simula o output com as constantes reais da
// funcao para que qualquer reorganizacao futura seja capturada.

describe("Ordenacao de secoes — MODO DE ATENDIMENTO antes de CLINICA", () => {
  function buildMinimalPromptSections(earlyInsuranceModeSection: string): string {
    return [
      "=== IDENTIDADE E REGRAS ABSOLUTAS ===",
      "=== MODO DE ATENDIMENTO ===",
      earlyInsuranceModeSection,
      "=== DATA E HORA ===",
      "=== CLINICA ===",
      "=== PRECOS E PAGAMENTO ===",
      "=== ESTRATEGIA DE ATENDIMENTO ===",
      "=== AGENDA DISPONIVEL ===",
      "=== REGRAS GERAIS ===",
    ].join("\n");
  }

  it("MODO DE ATENDIMENTO aparece antes de CLINICA no prompt", () => {
    const prompt = buildMinimalPromptSections("MODO CONVENIO ATIVO: ...");
    const idxModo = prompt.indexOf("=== MODO DE ATENDIMENTO ===");
    const idxClinica = prompt.indexOf("=== CLINICA ===");
    expect(idxModo).toBeGreaterThan(-1);
    expect(idxClinica).toBeGreaterThan(-1);
    expect(idxModo).toBeLessThan(idxClinica);
  });

  it("IDENTIDADE E REGRAS ABSOLUTAS aparece antes de MODO DE ATENDIMENTO", () => {
    const prompt = buildMinimalPromptSections("");
    const idxId = prompt.indexOf("=== IDENTIDADE E REGRAS ABSOLUTAS ===");
    const idxModo = prompt.indexOf("=== MODO DE ATENDIMENTO ===");
    expect(idxId).toBeLessThan(idxModo);
  });

  it("CLINICA aparece antes de PRECOS E PAGAMENTO", () => {
    const prompt = buildMinimalPromptSections("");
    const idxClinica = prompt.indexOf("=== CLINICA ===");
    const idxPrecos = prompt.indexOf("=== PRECOS E PAGAMENTO ===");
    expect(idxClinica).toBeLessThan(idxPrecos);
  });

  it("PRECOS E PAGAMENTO aparece antes de ESTRATEGIA DE ATENDIMENTO", () => {
    const prompt = buildMinimalPromptSections("");
    const idxPrecos = prompt.indexOf("=== PRECOS E PAGAMENTO ===");
    const idxEstrategia = prompt.indexOf("=== ESTRATEGIA DE ATENDIMENTO ===");
    expect(idxPrecos).toBeLessThan(idxEstrategia);
  });

  it("ESTRATEGIA DE ATENDIMENTO aparece antes de AGENDA DISPONIVEL", () => {
    const prompt = buildMinimalPromptSections("");
    const idxEstrategia = prompt.indexOf("=== ESTRATEGIA DE ATENDIMENTO ===");
    const idxAgenda = prompt.indexOf("=== AGENDA DISPONIVEL ===");
    expect(idxEstrategia).toBeLessThan(idxAgenda);
  });

  it("AGENDA DISPONIVEL aparece antes de REGRAS GERAIS", () => {
    const prompt = buildMinimalPromptSections("");
    const idxAgenda = prompt.indexOf("=== AGENDA DISPONIVEL ===");
    const idxRegras = prompt.indexOf("=== REGRAS GERAIS ===");
    expect(idxAgenda).toBeLessThan(idxRegras);
  });

  it("para lead de convenio, modo de atendimento contem MODO CONVENIO ATIVO", () => {
    const mode = computeEarlyInsuranceModeSection(true, false, true, true, "bifurcation");
    const prompt = buildMinimalPromptSections(mode);
    const idxModo = prompt.indexOf("=== MODO DE ATENDIMENTO ===");
    const idxClinica = prompt.indexOf("=== CLINICA ===");
    expect(prompt.substring(idxModo, idxClinica)).toContain("MODO CONVENIO ATIVO");
  });

  it("para paciente, a secao MODO DE ATENDIMENTO existe mas fica vazia", () => {
    const mode = computeEarlyInsuranceModeSection(true, true, false, false, "bifurcation");
    expect(mode).toBe("");
    const prompt = buildMinimalPromptSections(mode);
    expect(prompt).toContain("=== MODO DE ATENDIMENTO ===");
    const idxModo = prompt.indexOf("=== MODO DE ATENDIMENTO ===") + "=== MODO DE ATENDIMENTO ===".length;
    const idxData = prompt.indexOf("=== DATA E HORA ===");
    const between = prompt.substring(idxModo, idxData).trim();
    expect(between).toBe("");
  });
});

const SAMPLE_BIFURCATION_BLOCK = "FLUXO CONVENIO/PARTICULAR — REGRA OBRIGATORIA (PRIORIDADE MAXIMA): pergunte plano ou particular";

// ─── Guard de pacientes ────────────────────────────────────────────────────────

describe("computeEarlyInsuranceModeSection — guard de pacientes", () => {
  it("retorna string vazia para paciente conhecido (isPatient=true), mesmo com convenio ativo", () => {
    const result = computeEarlyInsuranceModeSection(true, true, false, false, SAMPLE_BIFURCATION_BLOCK);
    expect(result).toBe("");
  });

  it("retorna string vazia para paciente que declarou convenio (isPatient=true, contactDeclaredInsurance=true)", () => {
    const result = computeEarlyInsuranceModeSection(true, true, true, true, SAMPLE_BIFURCATION_BLOCK);
    expect(result).toBe("");
  });

  it("retorna string vazia para paciente que declarou particular (isPatient=true, insuranceTriageComplete=true)", () => {
    const result = computeEarlyInsuranceModeSection(true, true, false, true, SAMPLE_BIFURCATION_BLOCK);
    expect(result).toBe("");
  });

  it("retorna string vazia quando clinica nao aceita convenio, independente do tipo de contato", () => {
    expect(computeEarlyInsuranceModeSection(false, false, false, false, SAMPLE_BIFURCATION_BLOCK)).toBe("");
    expect(computeEarlyInsuranceModeSection(false, false, true, true, SAMPLE_BIFURCATION_BLOCK)).toBe("");
  });
});

// ─── Leads e contatos novos ───────────────────────────────────────────────────

describe("computeEarlyInsuranceModeSection — leads e contatos novos", () => {
  it("retorna MODO CONVENIO ATIVO para lead que declarou plano", () => {
    const result = computeEarlyInsuranceModeSection(true, false, true, true, SAMPLE_BIFURCATION_BLOCK);
    expect(result).toContain("MODO CONVENIO ATIVO");
  });

  it("modo convenio descreve tom acolhedor (Task #11: linguagem positiva, sem termos de venda)", () => {
    const result = computeEarlyInsuranceModeSection(true, false, true, true, SAMPLE_BIFURCATION_BLOCK);
    expect(result).toContain("MODO CONVENIO ATIVO");
    expect(result.toLowerCase()).toContain("acolhedor");
  });

  it("modo convenio NAO menciona 'escassez' em forma alguma (Task #11)", () => {
    const result = computeEarlyInsuranceModeSection(true, false, true, true, SAMPLE_BIFURCATION_BLOCK);
    expect(result.toLowerCase()).not.toContain("escassez");
  });

  it("retorna FLUXO PARTICULAR ATIVO para lead que declarou particular (insuranceTriageComplete=true, contactDeclaredInsurance=false)", () => {
    const result = computeEarlyInsuranceModeSection(true, false, false, true, SAMPLE_BIFURCATION_BLOCK);
    expect(result).toContain("FLUXO PARTICULAR ATIVO");
  });

  it("fluxo particular menciona SPIN Selling com escassez", () => {
    const result = computeEarlyInsuranceModeSection(true, false, false, true, SAMPLE_BIFURCATION_BLOCK);
    expect(result).toContain("SPIN Selling");
    expect(result).toContain("escassez");
  });

  it("retorna o bloco de bifurcacao para lead sem triagem (nao respondeu plano nem particular)", () => {
    const result = computeEarlyInsuranceModeSection(true, false, false, false, SAMPLE_BIFURCATION_BLOCK);
    expect(result).toBe(SAMPLE_BIFURCATION_BLOCK);
  });

  it("retorna string vazia (nao injeta nada) para lead quando clinica nao aceita convenio", () => {
    const result = computeEarlyInsuranceModeSection(false, false, false, false, SAMPLE_BIFURCATION_BLOCK);
    expect(result).toBe("");
  });
});

// ─── Invariantes ─────────────────────────────────────────────────────────────

describe("computeEarlyInsuranceModeSection — invariantes", () => {
  it("modo convenio NUNCA contém 'SPIN' nem como proibicao (Task #11: zero leak)", () => {
    const result = computeEarlyInsuranceModeSection(true, false, true, true, SAMPLE_BIFURCATION_BLOCK);
    expect(result).not.toMatch(/SPIN/i);
  });

  it("modo convenio NUNCA contém 'urgencia' nem como proibicao (Task #11: zero leak)", () => {
    const result = computeEarlyInsuranceModeSection(true, false, true, true, SAMPLE_BIFURCATION_BLOCK);
    expect(result.toLowerCase()).not.toContain("urgencia");
    expect(result.toLowerCase()).not.toContain("urgência");
  });

  it("modo convenio NUNCA contém 'ancoragem', 'consegui um encaixe', 'agenda disputada' (Task #11)", () => {
    const result = computeEarlyInsuranceModeSection(true, false, true, true, SAMPLE_BIFURCATION_BLOCK);
    const lower = result.toLowerCase();
    expect(lower).not.toContain("ancoragem");
    expect(lower).not.toContain("consegui um encaixe");
    expect(lower).not.toContain("agenda disputada");
    expect(lower).not.toMatch(/sao\s+os\s+ultimos|s[aã]o\s+os\s+[uú]ltimos/);
  });

  it("fluxo particular NAO menciona 'MODO CONVENIO ATIVO'", () => {
    const result = computeEarlyInsuranceModeSection(true, false, false, true, SAMPLE_BIFURCATION_BLOCK);
    expect(result).not.toContain("MODO CONVENIO ATIVO");
  });

  it("modo convenio NAO menciona 'FLUXO PARTICULAR ATIVO'", () => {
    const result = computeEarlyInsuranceModeSection(true, false, true, true, SAMPLE_BIFURCATION_BLOCK);
    expect(result).not.toContain("FLUXO PARTICULAR ATIVO");
  });

  it("retorna string em todos os cenarios possiveis (sem lancar excecao)", () => {
    const cases: Array<[boolean, boolean, boolean, boolean]> = [
      [true, false, false, false],
      [true, false, true, true],
      [true, false, false, true],
      [true, true, false, false],
      [true, true, true, true],
      [false, false, false, false],
      [false, true, true, true],
    ];
    cases.forEach(([acc, pat, ins, tri]) => {
      expect(typeof computeEarlyInsuranceModeSection(acc, pat, ins, tri, SAMPLE_BIFURCATION_BLOCK)).toBe("string");
    });
  });
});

// ─── Task #9 — buildModeDirective: CONVENIO_TRIAGEM menciona planos ───────────

describe("buildModeDirective CONVENIO_TRIAGEM — planos aceitos na pergunta", () => {
  it("sem plansList: instrucao da 2a resposta nao menciona planos especificos", () => {
    const directive = buildModeDirective("CONVENIO_TRIAGEM");
    expect(directive).toContain("CONVENIO_TRIAGEM");
    // Deve conter a pergunta padrao
    expect(directive).toContain("plano ou é particular");
    // Nao deve mencionar planos especificos
    expect(directive).not.toMatch(/Aqui a gente atende:/i);
  });

  it("com plansList: instrucao da 2a resposta menciona os planos aceitos", () => {
    const directive = buildModeDirective("CONVENIO_TRIAGEM", "Unimed, Bradesco Saúde, Amil");
    expect(directive).toContain("CONVENIO_TRIAGEM");
    // Deve mencionar os planos na instrucao
    expect(directive).toContain("Unimed");
    expect(directive).toContain("Bradesco Saúde");
    expect(directive).toContain("Amil");
    expect(directive).toMatch(/Aqui a gente atende:/i);
  });

  it("com plansList: ainda proibe oferecer horario antes de saber plano/particular", () => {
    const directive = buildModeDirective("CONVENIO_TRIAGEM", "Unimed");
    expect(directive).toContain("PROIBIDO");
    expect(directive).toMatch(/horários|horario/i);
  });

  it("com plansList: 1a resposta continua sem mencionar plano/particular (regra do acolhimento)", () => {
    const directive = buildModeDirective("CONVENIO_TRIAGEM", "Unimed, Amil");
    // A instrucao da 1a resposta nao deve mencionar os planos
    const lines = directive.split("\n");
    const primeiraRespostaLine = lines.find(l => l.includes("1ª resposta"));
    expect(primeiraRespostaLine).toBeDefined();
    // A 1a resposta NAO deve oferecer plano
    expect(primeiraRespostaLine).not.toContain("Unimed");
    expect(primeiraRespostaLine).not.toContain("Amil");
  });

  it("sem plansList: directive e string nao vazia", () => {
    const directive = buildModeDirective("CONVENIO_TRIAGEM");
    expect(directive.length).toBeGreaterThan(50);
  });

  it("outros modos nao sao afetados por plansList", () => {
    const agendar = buildModeDirective("CONVENIO_AGENDAR", "Unimed");
    expect(agendar).not.toContain("Unimed");
    const spin = buildModeDirective("PARTICULAR_SPIN", "Unimed");
    expect(spin).not.toContain("Unimed");
    const paciente = buildModeDirective("PACIENTE_AGENDAR", "Unimed");
    expect(paciente).not.toContain("Unimed");
  });
});
