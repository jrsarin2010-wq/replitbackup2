import { describe, it, expect } from "vitest";
import { buildLeadUrgencyInstruction, LEAD_DATE_REDIRECT_INSTRUCTION, filterInsuranceDays, resolveInsuranceHours } from "../lib/schedule-engine.js";
import { INSURANCE_DECLARED_PATTERN, PRIVATE_DECLARED_PATTERN } from "../lib/lead-engine.js";
import { computeInsuranceScheduleOverride } from "../lib/ai-engine.js";

// ─── buildLeadUrgencyInstruction ─────────────────────────────────────────────

describe("buildLeadUrgencyInstruction — urgência escalada por distância", () => {
  describe("URGENCIA NORMAL (0-1 dias)", () => {
    it("offset 0 → urgência normal (hoje)", () => {
      const msg = buildLeadUrgencyInstruction(0);
      expect(msg).toContain("URGENCIA NORMAL");
    });

    it("offset 1 → urgência normal (amanhã)", () => {
      const msg = buildLeadUrgencyInstruction(1);
      expect(msg).toContain("URGENCIA NORMAL");
    });

    it("offset 0 menciona 'hoje/amanha'", () => {
      const msg = buildLeadUrgencyInstruction(0);
      expect(msg).toContain("hoje/amanha");
    });

    it("offset 1 menciona 'hoje/amanha'", () => {
      const msg = buildLeadUrgencyInstruction(1);
      expect(msg).toContain("hoje/amanha");
    });
  });

  describe("URGENCIA ALTA (2-3 dias)", () => {
    it("offset 2 → urgência alta", () => {
      const msg = buildLeadUrgencyInstruction(2);
      expect(msg).toContain("URGENCIA ALTA");
    });

    it("offset 3 → urgência alta", () => {
      const msg = buildLeadUrgencyInstruction(3);
      expect(msg).toContain("URGENCIA ALTA");
    });

    it("offset 2 menciona 'perda iminente'", () => {
      const msg = buildLeadUrgencyInstruction(2);
      expect(msg.toLowerCase()).toContain("perda iminente");
    });

    it("offset 3 menciona 'saem rapido'", () => {
      const msg = buildLeadUrgencyInstruction(3);
      expect(msg).toContain("saem rapido");
    });
  });

  describe("URGENCIA MAXIMA (4+ dias)", () => {
    it("offset 4 → urgência máxima", () => {
      const msg = buildLeadUrgencyInstruction(4);
      expect(msg).toContain("URGENCIA MAXIMA");
    });

    it("offset 5 → urgência máxima", () => {
      const msg = buildLeadUrgencyInstruction(5);
      expect(msg).toContain("URGENCIA MAXIMA");
    });

    it("offset 10 → urgência máxima", () => {
      const msg = buildLeadUrgencyInstruction(10);
      expect(msg).toContain("URGENCIA MAXIMA");
    });

    it("offset 4 inclui o número de dias no texto", () => {
      const msg = buildLeadUrgencyInstruction(4);
      expect(msg).toContain("4 dias");
    });

    it("offset 7 inclui o número de dias no texto", () => {
      const msg = buildLeadUrgencyInstruction(7);
      expect(msg).toContain("7 dias");
    });

    it("offset 4 menciona 'PRESSAO REAL'", () => {
      const msg = buildLeadUrgencyInstruction(4);
      expect(msg).toContain("PRESSAO REAL");
    });

    it("offset 5 menciona 'somem'", () => {
      const msg = buildLeadUrgencyInstruction(5);
      expect(msg).toContain("somem");
    });
  });

  describe("Limites exatos de transição", () => {
    it("offset 1 NÃO é urgência alta", () => {
      const msg = buildLeadUrgencyInstruction(1);
      expect(msg).not.toContain("URGENCIA ALTA");
      expect(msg).not.toContain("URGENCIA MAXIMA");
    });

    it("offset 3 NÃO é urgência máxima", () => {
      const msg = buildLeadUrgencyInstruction(3);
      expect(msg).not.toContain("URGENCIA MAXIMA");
    });

    it("offset 2 NÃO é urgência normal", () => {
      const msg = buildLeadUrgencyInstruction(2);
      expect(msg).not.toContain("URGENCIA NORMAL");
    });

    it("offset 4 NÃO é urgência alta", () => {
      const msg = buildLeadUrgencyInstruction(4);
      expect(msg).not.toContain("URGENCIA ALTA");
      expect(msg).not.toContain("URGENCIA NORMAL");
    });
  });

  describe("Conteúdo de conversão obrigatório", () => {
    it("urgência normal contém cta de reserva imediata", () => {
      const msg = buildLeadUrgencyInstruction(0);
      expect(msg).toContain("antes de alguem pegar");
    });

    it("urgência alta contém cta de reserva imediata", () => {
      const msg = buildLeadUrgencyInstruction(2);
      expect(msg).toContain("antes de alguem pegar");
    });

    it("urgência máxima contém pergunta de fechamento", () => {
      const msg = buildLeadUrgencyInstruction(4);
      expect(msg).toContain("Posso garantir o seu?");
    });

    it("urgência máxima menciona outra pessoa pegando a vaga", () => {
      const msg = buildLeadUrgencyInstruction(5);
      expect(msg).toContain("outra pessoa vai pegar");
    });

    it("toda urgência retorna string não vazia", () => {
      [0, 1, 2, 3, 4, 5, 10].forEach((d) => {
        expect(buildLeadUrgencyInstruction(d)).toBeTruthy();
        expect(typeof buildLeadUrgencyInstruction(d)).toBe("string");
      });
    });
  });
});

// ─── Regras de escassez — estrutura do bloco de disponibilidade ───────────────
// Estas são verificações de que o texto gerado pelo schedule-engine contém
// os termos proibidos e obrigatórios corretos. Testamos via buildLeadUrgencyInstruction
// (já que getAvailabilityInfo requer DB), mas a lógica de proibição está no texto.

describe("Regras de escassez — termos proibidos e obrigatórios", () => {
  const proibidos = [
    "temos disponibilidade",
    "varios horarios",
    "pode escolher o melhor",
  ];

  it("urgência normal NÃO contém termos proibidos", () => {
    const msg = buildLeadUrgencyInstruction(0);
    proibidos.forEach((termo) => {
      expect(msg.toLowerCase()).not.toContain(termo.toLowerCase());
    });
  });

  it("urgência alta NÃO contém termos proibidos", () => {
    const msg = buildLeadUrgencyInstruction(3);
    proibidos.forEach((termo) => {
      expect(msg.toLowerCase()).not.toContain(termo.toLowerCase());
    });
  });

  it("urgência máxima NÃO contém termos proibidos", () => {
    const msg = buildLeadUrgencyInstruction(5);
    proibidos.forEach((termo) => {
      expect(msg.toLowerCase()).not.toContain(termo.toLowerCase());
    });
  });

  it("urgência máxima usa fechamento direto com pergunta", () => {
    const msg = buildLeadUrgencyInstruction(4);
    expect(msg).toMatch(/\?/);
  });

  it("urgência alta usa linguagem de perda", () => {
    const msg = buildLeadUrgencyInstruction(2);
    const hasLossLanguage = msg.includes("perda") || msg.includes("pegar") || msg.includes("rapido");
    expect(hasLossLanguage).toBe(true);
  });
});

// ─── LEAD_DATE_REDIRECT_INSTRUCTION — conteúdo real do bloco ────────────────
// Testa a constante exportada que é injetada nos blocos de disponibilidade
// (single-prof e multi-prof) E nos schedulingRules do prompt-builder.

describe("LEAD_DATE_REDIRECT_INSTRUCTION — conteúdo obrigatório", () => {
  it("é uma string não-vazia", () => {
    expect(typeof LEAD_DATE_REDIRECT_INSTRUCTION).toBe("string");
    expect(LEAD_DATE_REDIRECT_INSTRUCTION.length).toBeGreaterThan(10);
  });

  it("instrui a NÃO acomodar o pedido de data diferente", () => {
    expect(LEAD_DATE_REDIRECT_INSTRUCTION).toContain("NAO acomode o pedido");
  });

  it("instrui a NÃO buscar nem inventar novos horários", () => {
    expect(LEAD_DATE_REDIRECT_INSTRUCTION).toContain("NAO busque nem invente novos horarios");
  });

  it("menciona 'semana que vem' como exemplo de data proibida", () => {
    expect(LEAD_DATE_REDIRECT_INSTRUCTION).toContain("semana que vem");
  });

  it("menciona 'outro dia' como exemplo de data proibida", () => {
    expect(LEAD_DATE_REDIRECT_INSTRUCTION).toContain("outro dia");
  });

  it("instrui a redirecionar imediatamente", () => {
    expect(LEAD_DATE_REDIRECT_INSTRUCTION).toContain("Redirecione IMEDIATAMENTE");
  });

  it("contém a frase de fechamento 'qual voce garante'", () => {
    expect(LEAD_DATE_REDIRECT_INSTRUCTION.toLowerCase()).toContain("qual voce garante");
  });

  it("instrui que semana que vem já está tomada", () => {
    expect(LEAD_DATE_REDIRECT_INSTRUCTION).toContain("semana que vem ja esta tomada");
  });

  it("tem instrução de encerramento após 2 insistências", () => {
    expect(LEAD_DATE_REDIRECT_INSTRUCTION).toContain("insistir 2x");
  });

  it("NUNCA contém instrução de buscar alternativas ('tente outro')", () => {
    expect(LEAD_DATE_REDIRECT_INSTRUCTION.toLowerCase()).not.toContain("tente outro");
  });

  it("NUNCA contém 'temos disponibilidade'", () => {
    expect(LEAD_DATE_REDIRECT_INSTRUCTION.toLowerCase()).not.toContain("temos disponibilidade");
  });

  it("NUNCA contém 'varios horarios'", () => {
    expect(LEAD_DATE_REDIRECT_INSTRUCTION.toLowerCase()).not.toContain("varios horarios");
  });

  it("NUNCA contém 'pode escolher'", () => {
    expect(LEAD_DATE_REDIRECT_INSTRUCTION.toLowerCase()).not.toContain("pode escolher");
  });

  it("NUNCA contém 'qual fica melhor pra voce'", () => {
    expect(LEAD_DATE_REDIRECT_INSTRUCTION.toLowerCase()).not.toContain("qual fica melhor pra voce");
  });
});

// ─── Bug 1 — instrução contraditória removida ────────────────────────────────

describe("Bug 1 — sem instrução de buscar horários alternativos", () => {
  it("urgência nunca instrui 'tente outro horario'", () => {
    [0, 1, 2, 3, 4, 5].forEach((d) => {
      const msg = buildLeadUrgencyInstruction(d);
      expect(msg.toLowerCase()).not.toContain("tente outro");
    });
  });

  it("redirect nunca instrui 'tente outro horario'", () => {
    expect(LEAD_DATE_REDIRECT_INSTRUCTION.toLowerCase()).not.toContain("tente outro");
  });

  it("urgência não usa 'livre escolha' — não contém 'qual fica melhor pra voce'", () => {
    [0, 1, 2, 3, 4, 5].forEach((d) => {
      expect(buildLeadUrgencyInstruction(d).toLowerCase()).not.toContain("qual fica melhor pra voce");
    });
  });
});

// ─── Bug 2 — redirect para data fora da lista ────────────────────────────────

describe("Bug 2 — redirect explícito para 'semana que vem'", () => {
  it("LEAD_DATE_REDIRECT_INSTRUCTION cobre o caso 'semana que vem'", () => {
    expect(LEAD_DATE_REDIRECT_INSTRUCTION).toContain("semana que vem");
  });

  it("LEAD_DATE_REDIRECT_INSTRUCTION cobre o caso 'mes que vem'", () => {
    expect(LEAD_DATE_REDIRECT_INSTRUCTION).toContain("mes que vem");
  });

  it("urgência máxima ainda menciona perda por terceiros (reforço)", () => {
    const msg = buildLeadUrgencyInstruction(4);
    expect(msg).toContain("outra pessoa vai pegar");
  });

  it("urgência normal reforça ação imediata", () => {
    const msg = buildLeadUrgencyInstruction(0);
    expect(msg).toContain("antes de alguem pegar");
  });
});

// ─── Bug 3 — multi-profissional: 1 slot por profissional ─────────────────────

describe("Bug 3 — limite correto de slots por profissional", () => {
  it("LEAD_DATE_REDIRECT_INSTRUCTION não menciona '2 horarios por profissional'", () => {
    expect(LEAD_DATE_REDIRECT_INSTRUCTION.toLowerCase()).not.toContain("2 horarios por profissional");
  });

  it("urgência não sugere múltiplos slots por profissional", () => {
    [0, 1, 2, 3, 4].forEach((d) => {
      const msg = buildLeadUrgencyInstruction(d);
      expect(msg.toLowerCase()).not.toContain("2 horarios por profissional");
    });
  });

  it("redirect não oferece mais horários — mantém foco no fechamento", () => {
    expect(LEAD_DATE_REDIRECT_INSTRUCTION.toLowerCase()).not.toContain("outros horarios");
    expect(LEAD_DATE_REDIRECT_INSTRUCTION.toLowerCase()).not.toContain("mais horarios");
  });
});

// ─── filterInsuranceDays ─────────────────────────────────────────────────────

describe("filterInsuranceDays — restrição de dias para convênio", () => {
  it("retorna apenas o dia 6 (sábado) quando insuranceDays='6'", () => {
    const allWeek = new Set([0, 1, 2, 3, 4, 5, 6]);
    const result = filterInsuranceDays(allWeek, "6");
    expect(result).toEqual(new Set([6]));
  });

  it("retorna diasstring vazia → enabledDays inalterado", () => {
    const days = new Set([1, 2, 3, 4, 5]);
    const result = filterInsuranceDays(days, "");
    expect(result).toEqual(days);
  });

  it("retorna string de espaços → enabledDays inalterado", () => {
    const days = new Set([1, 3, 5]);
    const result = filterInsuranceDays(days, "   ");
    expect(result).toEqual(days);
  });

  it("insuranceDays sobrescreve o schedule regular — sábado retorna {6} mesmo fora dos dias úteis", () => {
    // A professional may attend insurance on Saturday even if workingDays is Mon-Fri.
    // insuranceDays is a REPLACEMENT, not an intersection with workingDays.
    const weekdays = new Set([1, 2, 3, 4, 5]);
    const result = filterInsuranceDays(weekdays, "6");
    expect(result).toEqual(new Set([6]));
  });

  it("múltiplos dias de convênio (sábado e segunda)", () => {
    const allWeek = new Set([0, 1, 2, 3, 4, 5, 6]);
    const result = filterInsuranceDays(allWeek, "6,1");
    expect(result).toEqual(new Set([1, 6]));
  });

  it("suporta espaços em torno das vírgulas", () => {
    const allWeek = new Set([0, 1, 2, 3, 4, 5, 6]);
    const result = filterInsuranceDays(allWeek, " 6 , 1 ");
    expect(result).toEqual(new Set([1, 6]));
  });

  it("não muta o conjunto original", () => {
    const days = new Set([1, 2, 3, 4, 5, 6]);
    const original = new Set(days);
    filterInsuranceDays(days, "6");
    expect(days).toEqual(original);
  });
});

// ─── resolveInsuranceHours ────────────────────────────────────────────────────

describe("resolveInsuranceHours — resolução de horários do convênio", () => {
  it("retorna horários do profissional quando ambos configurados no prof", () => {
    const result = resolveInsuranceHours("08:00", "12:00", null, null);
    expect(result).toEqual({ start: "08:00", end: "12:00" });
  });

  it("retorna horários do settings quando prof não tem", () => {
    const result = resolveInsuranceHours(null, null, "09:00", "13:00");
    expect(result).toEqual({ start: "09:00", end: "13:00" });
  });

  it("prof tem precedência sobre settings", () => {
    const result = resolveInsuranceHours("08:00", "12:00", "09:00", "13:00");
    expect(result).toEqual({ start: "08:00", end: "12:00" });
  });

  it("retorna null quando nem prof nem settings têm horário configurado", () => {
    const result = resolveInsuranceHours(null, null, null, null);
    expect(result).toBeNull();
  });

  it("retorna null quando start configurado mas end ausente", () => {
    const result = resolveInsuranceHours("08:00", null, null, null);
    expect(result).toBeNull();
  });

  it("retorna null quando end configurado mas start ausente", () => {
    const result = resolveInsuranceHours(null, "12:00", null, null);
    expect(result).toBeNull();
  });

  it("suporta undefined como ausente (sem erro de tipo)", () => {
    const result = resolveInsuranceHours(undefined, undefined, "08:00", "12:00");
    expect(result).toEqual({ start: "08:00", end: "12:00" });
  });
});

// ─── INSURANCE_DECLARED_PATTERN ───────────────────────────────────────────────

describe("INSURANCE_DECLARED_PATTERN — detecção de paciente de convênio", () => {
  describe("variantes sem acento (base original)", () => {
    it("detecta 'plano'", () => {
      expect(INSURANCE_DECLARED_PATTERN.test("quero agendar pelo plano")).toBe(true);
    });
    it("detecta 'convenio' sem acento", () => {
      expect(INSURANCE_DECLARED_PATTERN.test("vou usar convenio")).toBe(true);
    });
    it("detecta 'tenho plano'", () => {
      expect(INSURANCE_DECLARED_PATTERN.test("tenho plano de saude")).toBe(true);
    });
    it("detecta 'uso plano'", () => {
      expect(INSURANCE_DECLARED_PATTERN.test("uso plano")).toBe(true);
    });
    it("detecta 'meu plano'", () => {
      expect(INSURANCE_DECLARED_PATTERN.test("quero usar meu plano")).toBe(true);
    });
  });

  describe("variantes COM acento — bug anteriormente não detectado", () => {
    it("detecta 'convênio' com acento circunflexo", () => {
      expect(INSURANCE_DECLARED_PATTERN.test("vou usar convênio")).toBe(true);
    });
    it("detecta 'pelo convênio'", () => {
      expect(INSURANCE_DECLARED_PATTERN.test("quero agendar pelo convênio")).toBe(true);
    });
    it("detecta 'tenho convênio'", () => {
      expect(INSURANCE_DECLARED_PATTERN.test("tenho convênio")).toBe(true);
    });
    it("detecta 'uso convênio'", () => {
      expect(INSURANCE_DECLARED_PATTERN.test("uso convênio")).toBe(true);
    });
    it("detecta 'meu convênio'", () => {
      expect(INSURANCE_DECLARED_PATTERN.test("quero usar meu convênio")).toBe(true);
    });
    it("detecta 'por convênio'", () => {
      expect(INSURANCE_DECLARED_PATTERN.test("vou pagar por convênio")).toBe(true);
    });
    it("detecta 'no plano'", () => {
      expect(INSURANCE_DECLARED_PATTERN.test("quero agendar no plano")).toBe(true);
    });
    it("detecta 'com plano'", () => {
      expect(INSURANCE_DECLARED_PATTERN.test("vou com plano")).toBe(true);
    });
    it("detecta 'convênios' (plural)", () => {
      expect(INSURANCE_DECLARED_PATTERN.test("atende convênios?")).toBe(true);
    });
  });

  describe("operadoras de plano nomeadas", () => {
    it("detecta 'unimed'", () => {
      expect(INSURANCE_DECLARED_PATTERN.test("tenho unimed")).toBe(true);
    });
    it("detecta 'hapvida'", () => {
      expect(INSURANCE_DECLARED_PATTERN.test("meu plano e hapvida")).toBe(true);
    });
    it("detecta 'amil'", () => {
      expect(INSURANCE_DECLARED_PATTERN.test("uso amil")).toBe(true);
    });
    it("detecta 'notredame'", () => {
      expect(INSURANCE_DECLARED_PATTERN.test("meu plano e notredame")).toBe(true);
    });
  });

  describe("case-insensitive", () => {
    it("detecta 'PLANO' maiúsculo", () => {
      expect(INSURANCE_DECLARED_PATTERN.test("VOU USAR PLANO")).toBe(true);
    });
    it("detecta 'Convênio' com maiúscula inicial", () => {
      expect(INSURANCE_DECLARED_PATTERN.test("Uso Convênio")).toBe(true);
    });
    it("detecta 'UNIMED' maiúsculo", () => {
      expect(INSURANCE_DECLARED_PATTERN.test("meu UNIMED")).toBe(true);
    });
  });

  describe("falsos positivos — NÃO deve detectar", () => {
    it("não detecta 'particular'", () => {
      expect(INSURANCE_DECLARED_PATTERN.test("vou pagar particular")).toBe(false);
    });
    it("não detecta mensagem genérica de agendamento", () => {
      expect(INSURANCE_DECLARED_PATTERN.test("quero agendar uma consulta")).toBe(false);
    });
    it("não detecta saudação simples", () => {
      expect(INSURANCE_DECLARED_PATTERN.test("oi, tudo bem?")).toBe(false);
    });
    it("não detecta mensagem vazia", () => {
      expect(INSURANCE_DECLARED_PATTERN.test("")).toBe(false);
    });
  });
});

// ─── PRIVATE_DECLARED_PATTERN ─────────────────────────────────────────────────

describe("PRIVATE_DECLARED_PATTERN — detecção de paciente particular", () => {
  it("detecta 'particular'", () => {
    expect(PRIVATE_DECLARED_PATTERN.test("vou pagar particular")).toBe(true);
  });
  it("detecta 'e particular'", () => {
    expect(PRIVATE_DECLARED_PATTERN.test("e particular")).toBe(true);
  });
  it("detecta 'sou particular'", () => {
    expect(PRIVATE_DECLARED_PATTERN.test("sou particular")).toBe(true);
  });
  it("detecta 'sem plano'", () => {
    expect(PRIVATE_DECLARED_PATTERN.test("estou sem plano")).toBe(true);
  });
  it("detecta 'nao tenho plano'", () => {
    expect(PRIVATE_DECLARED_PATTERN.test("nao tenho plano")).toBe(true);
  });
  it("detecta 'por conta propria'", () => {
    expect(PRIVATE_DECLARED_PATTERN.test("vou pagar por conta propria")).toBe(true);
  });
  it("não detecta 'plano' sozinho (deve ser insurance)", () => {
    expect(PRIVATE_DECLARED_PATTERN.test("uso plano")).toBe(false);
  });
  it("não detecta saudação simples", () => {
    expect(PRIVATE_DECLARED_PATTERN.test("oi, bom dia")).toBe(false);
  });
});

// ─── computeInsuranceScheduleOverride — anti-regressão (Task #3) ──────────────

describe("computeInsuranceScheduleOverride — override para pacientes de convênio", () => {
  describe("cenário raiz: paciente responde triage 'sim' mas readyForSchedule=false", () => {
    it("insurance + skipAvailability=true → override para false (agenda filtrada é buscada)", () => {
      const result = computeInsuranceScheduleOverride({
        isInsuranceContact: true,
        skipAvailability: true,
        shouldSkipScheduleOffer: true,
      });
      expect(result.skipAvailability).toBe(false);
      expect(result.shouldSkipScheduleOffer).toBe(false);
      expect(result.canOfferSchedule).toBe(true);
      expect(result.wasOverridden).toBe(true);
    });

    it("insurance declarado no histórico + triage 'sim' (intent != scheduling) → override ativo", () => {
      const historyMessages = [
        "oi, tudo bem?",
        "quero agendar pelo convênio",
        "sim",
      ];
      const isInsuranceContact = historyMessages.some((m) => INSURANCE_DECLARED_PATTERN.test(m));
      const readyForSchedule = false;
      const intent = "other";
      const shouldSkipScheduleOffer = !readyForSchedule && intent !== "scheduling";
      const result = computeInsuranceScheduleOverride({
        isInsuranceContact,
        skipAvailability: shouldSkipScheduleOffer,
        shouldSkipScheduleOffer,
      });
      expect(isInsuranceContact).toBe(true);
      expect(result.skipAvailability).toBe(false);
      expect(result.canOfferSchedule).toBe(true);
      expect(result.wasOverridden).toBe(true);
    });
  });

  describe("canOfferSchedule permanece consistente com shouldSkipScheduleOffer", () => {
    it("canOfferSchedule = true quando override ativado", () => {
      const result = computeInsuranceScheduleOverride({
        isInsuranceContact: true,
        skipAvailability: true,
        shouldSkipScheduleOffer: true,
      });
      expect(result.canOfferSchedule).toBe(!result.shouldSkipScheduleOffer);
      expect(result.canOfferSchedule).toBe(true);
    });

    it("canOfferSchedule = true quando skipAvailability já era false (sem override necessário)", () => {
      const result = computeInsuranceScheduleOverride({
        isInsuranceContact: true,
        skipAvailability: false,
        shouldSkipScheduleOffer: false,
      });
      expect(result.canOfferSchedule).toBe(true);
      expect(result.wasOverridden).toBe(false);
    });

    it("canOfferSchedule = false para não-insurance com skip ativo", () => {
      const result = computeInsuranceScheduleOverride({
        isInsuranceContact: false,
        skipAvailability: true,
        shouldSkipScheduleOffer: true,
      });
      expect(result.canOfferSchedule).toBe(false);
      expect(result.wasOverridden).toBe(false);
    });
  });

  describe("não altera comportamento para contatos não-insurance", () => {
    it("não-insurance + skipAvailability=true → mantém skip (sem override)", () => {
      const result = computeInsuranceScheduleOverride({
        isInsuranceContact: false,
        skipAvailability: true,
        shouldSkipScheduleOffer: true,
      });
      expect(result.skipAvailability).toBe(true);
      expect(result.shouldSkipScheduleOffer).toBe(true);
      expect(result.wasOverridden).toBe(false);
    });

    it("não-insurance + skipAvailability=false → mantém disponível (sem override)", () => {
      const result = computeInsuranceScheduleOverride({
        isInsuranceContact: false,
        skipAvailability: false,
        shouldSkipScheduleOffer: false,
      });
      expect(result.skipAvailability).toBe(false);
      expect(result.shouldSkipScheduleOffer).toBe(false);
      expect(result.wasOverridden).toBe(false);
    });
  });

  describe("detecção de insurance via histórico + override combinado", () => {
    it("Postal Saúde declarada em mensagem anterior → isInsurance=true → override ativo", () => {
      const msgs = ["oi", "tenho postal saúde", "sim, quero agendar"];
      const isInsuranceContact = msgs.some((m) => INSURANCE_DECLARED_PATTERN.test(m));
      expect(isInsuranceContact).toBe(true);
      const result = computeInsuranceScheduleOverride({
        isInsuranceContact,
        skipAvailability: true,
        shouldSkipScheduleOffer: true,
      });
      expect(result.skipAvailability).toBe(false);
      expect(result.canOfferSchedule).toBe(true);
    });

    it("Unimed declarada em histórico → isInsurance=true → override ativo", () => {
      const msgs = ["bom dia", "meu plano é unimed", "sim"];
      const isInsuranceContact = msgs.some((m) => INSURANCE_DECLARED_PATTERN.test(m));
      expect(isInsuranceContact).toBe(true);
      const result = computeInsuranceScheduleOverride({
        isInsuranceContact,
        skipAvailability: true,
        shouldSkipScheduleOffer: true,
      });
      expect(result.skipAvailability).toBe(false);
    });

    it("mensagem genérica sem insurance → sem override", () => {
      const msgs = ["oi", "quero agendar uma consulta", "sim"];
      const isInsuranceContact = msgs.some((m) => INSURANCE_DECLARED_PATTERN.test(m));
      expect(isInsuranceContact).toBe(false);
      const result = computeInsuranceScheduleOverride({
        isInsuranceContact,
        skipAvailability: true,
        shouldSkipScheduleOffer: true,
      });
      expect(result.skipAvailability).toBe(true);
      expect(result.wasOverridden).toBe(false);
    });
  });
});
