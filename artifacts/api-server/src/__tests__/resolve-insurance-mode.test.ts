import { describe, it, expect } from "vitest";
import { resolveInsuranceMode, INSURANCE_DECLARED_PATTERN, detectsInsuranceDeclaration } from "../lib/lead-engine.js";

// ─── Task #11 — negação: "nao tenho plano" NAO ativa modo convenio ────────────
describe("detectsInsuranceDeclaration — frases negadas (Task #11)", () => {
  const negatives = [
    "nao tenho plano",
    "não tenho plano",
    "nao tenho convenio",
    "não tenho convênio",
    "sem plano",
    "sem convenio",
    "nao uso plano",
    "não uso convênio",
    "nao tenho nenhum plano",
  ];
  for (const m of negatives) {
    it(`NAO reconhece "${m}" como declaracao de convenio`, () => {
      expect(detectsInsuranceDeclaration(m)).toBe(false);
    });
  }

  it("clinica aceita convenio + 'nao tenho plano' → resolve para particular, NAO convenio", () => {
    const r = resolveInsuranceMode({
      clinicAcceptsInsurance: true,
      persistedPaymentType: null,
      currentMessage: "nao tenho plano",
      historyMessages: [],
    });
    expect(r.isInsurance).toBe(false);
    expect(r.isPrivate).toBe(true);
    expect(r.triageComplete).toBe(true);
  });

  it("ainda reconhece declaracoes positivas no mesmo texto que tem 'plano' isolado", () => {
    expect(detectsInsuranceDeclaration("tenho unimed mas nao tenho plano dental")).toBe(true);
  });
});

// ─── Task #11 — correção de paymentType em vôo ────────────────────────────────
// Quando paymentType foi persistido errado (private) e o paciente declara
// convênio na mensagem, o resolveInsuranceMode precisa marcar isInsurance=true
// no MESMO turno — para que o prompt-builder use modo CONVENIO imediatamente.
describe("resolveInsuranceMode — correção de paymentType errado (Task #11)", () => {
  it("persistedPaymentType=private + currentMessage='tenho unimed' → isInsurance=true (corrige no turno)", () => {
    const r = resolveInsuranceMode({
      clinicAcceptsInsurance: true,
      persistedPaymentType: "private",
      currentMessage: "tenho unimed",
      historyMessages: [],
    });
    expect(r.isInsurance).toBe(true);
    expect(r.triageComplete).toBe(true);
  });

  it("persistedPaymentType=private + currentMessage='é pelo plano da empresa' → isInsurance=true", () => {
    const r = resolveInsuranceMode({
      clinicAcceptsInsurance: true,
      persistedPaymentType: "private",
      currentMessage: "é pelo plano da empresa",
      historyMessages: [],
    });
    expect(r.isInsurance).toBe(true);
  });

  it("persistedPaymentType=insurance + currentMessage='é particular' → isPrivate=true (também deve corrigir)", () => {
    const r = resolveInsuranceMode({
      clinicAcceptsInsurance: true,
      persistedPaymentType: "insurance",
      currentMessage: "vou de particular",
      historyMessages: [],
    });
    expect(r.isPrivate).toBe(true);
    expect(r.triageComplete).toBe(true);
  });
});

// ─── Task #11 — variantes adicionais de declaracao de convenio ────────────────
describe("INSURANCE_DECLARED_PATTERN — variantes coloquiais (Task #11)", () => {
  const positives = [
    "tenho unimed",
    "uso o convenio",
    "uso o plano",
    "tenho o plano",
    "tenho o convenio",
    "e pelo plano",
    "e pelo meu convenio",
    "e pelo plano da empresa",
    "convenio do trabalho",
    "plano da empresa",
    "vou pelo convenio",
    "tenho amil",
    "bradesco saude",
  ];
  for (const m of positives) {
    it(`reconhece "${m}" como declaracao de convenio`, () => {
      expect(INSURANCE_DECLARED_PATTERN.test(m)).toBe(true);
    });
  }
});

// ─── Helper defaults ─────────────────────────────────────────────────────────

const BASE = {
  clinicAcceptsInsurance: true,
  persistedPaymentType: null as string | null,
  currentMessage: "",
  historyMessages: [] as Array<{ content: string }>,
};

// ─── clinicAcceptsInsurance=false → tudo false ───────────────────────────────

describe("resolveInsuranceMode — clínica NÃO aceita convênio", () => {
  it("retorna todos false quando clinicAcceptsInsurance=false, mesmo com currentMessage de convênio", () => {
    const r = resolveInsuranceMode({ ...BASE, clinicAcceptsInsurance: false, currentMessage: "tenho plano" });
    expect(r).toEqual({ isInsurance: false, isPrivate: false, triageComplete: false, triageNeeded: false });
  });

  it("retorna todos false quando clinicAcceptsInsurance=false, mesmo com persistedPaymentType=insurance", () => {
    const r = resolveInsuranceMode({ ...BASE, clinicAcceptsInsurance: false, persistedPaymentType: "insurance" });
    expect(r).toEqual({ isInsurance: false, isPrivate: false, triageComplete: false, triageNeeded: false });
  });

  it("retorna todos false quando clinicAcceptsInsurance=false, mesmo com persistedPaymentType=private", () => {
    const r = resolveInsuranceMode({ ...BASE, clinicAcceptsInsurance: false, persistedPaymentType: "private" });
    expect(r).toEqual({ isInsurance: false, isPrivate: false, triageComplete: false, triageNeeded: false });
  });

  it("retorna todos false quando clinicAcceptsInsurance=false, mesmo com histórico de convênio", () => {
    const r = resolveInsuranceMode({
      ...BASE,
      clinicAcceptsInsurance: false,
      historyMessages: [{ content: "quero usar meu plano" }],
    });
    expect(r).toEqual({ isInsurance: false, isPrivate: false, triageComplete: false, triageNeeded: false });
  });
});

// ─── Detecção via currentMessage ─────────────────────────────────────────────

describe("resolveInsuranceMode — detecção via currentMessage", () => {
  it("isInsurance=true quando mensagem atual menciona 'plano'", () => {
    const r = resolveInsuranceMode({ ...BASE, currentMessage: "quero agendar pelo plano" });
    expect(r.isInsurance).toBe(true);
    expect(r.isPrivate).toBe(false);
    expect(r.triageComplete).toBe(true);
    expect(r.triageNeeded).toBe(false);
  });

  it("isInsurance=true quando mensagem atual menciona 'convênio' com acento", () => {
    const r = resolveInsuranceMode({ ...BASE, currentMessage: "vou usar convênio" });
    expect(r.isInsurance).toBe(true);
  });

  it("isInsurance=true quando mensagem atual menciona 'unimed'", () => {
    const r = resolveInsuranceMode({ ...BASE, currentMessage: "meu plano é unimed" });
    expect(r.isInsurance).toBe(true);
  });

  it("isPrivate=true quando mensagem atual menciona 'particular'", () => {
    const r = resolveInsuranceMode({ ...BASE, currentMessage: "vou pagar particular" });
    expect(r.isInsurance).toBe(false);
    expect(r.isPrivate).toBe(true);
    expect(r.triageComplete).toBe(true);
    expect(r.triageNeeded).toBe(false);
  });

  it("isPrivate=true quando mensagem atual menciona 'sem plano'", () => {
    const r = resolveInsuranceMode({ ...BASE, currentMessage: "nao tenho plano" });
    expect(r.isPrivate).toBe(true);
  });

  it("isInsurance e isPrivate ambos false para mensagem genérica", () => {
    const r = resolveInsuranceMode({ ...BASE, currentMessage: "oi, quero agendar uma consulta" });
    expect(r.isInsurance).toBe(false);
    expect(r.isPrivate).toBe(false);
    expect(r.triageComplete).toBe(false);
    expect(r.triageNeeded).toBe(true);
  });

  it("mensagem vazia → triageNeeded=true", () => {
    const r = resolveInsuranceMode({ ...BASE, currentMessage: "" });
    expect(r.isInsurance).toBe(false);
    expect(r.isPrivate).toBe(false);
    expect(r.triageNeeded).toBe(true);
  });
});

// ─── Detecção via persistedPaymentType ───────────────────────────────────────

describe("resolveInsuranceMode — detecção via persistedPaymentType (DB)", () => {
  it("isInsurance=true quando persistedPaymentType=insurance, mesmo com mensagem vazia", () => {
    const r = resolveInsuranceMode({ ...BASE, persistedPaymentType: "insurance", currentMessage: "" });
    expect(r.isInsurance).toBe(true);
    expect(r.isPrivate).toBe(false);
    expect(r.triageComplete).toBe(true);
  });

  it("isPrivate=true quando persistedPaymentType=private, mesmo com mensagem vazia", () => {
    const r = resolveInsuranceMode({ ...BASE, persistedPaymentType: "private", currentMessage: "" });
    expect(r.isInsurance).toBe(false);
    expect(r.isPrivate).toBe(true);
    expect(r.triageComplete).toBe(true);
  });

  it("persistedPaymentType=insurance prevalece: isInsurance=true mesmo se currentMessage menciona 'particular'", () => {
    const r = resolveInsuranceMode({
      ...BASE,
      persistedPaymentType: "insurance",
      currentMessage: "vou pagar particular",
    });
    // persisted insurance + current message says private → BOTH can be true (histórico vs atual)
    expect(r.isInsurance).toBe(true);
    expect(r.isPrivate).toBe(true);
    expect(r.triageComplete).toBe(true);
  });

  it("persistedPaymentType=null → não afeta resultado (detecção por regex)", () => {
    const r = resolveInsuranceMode({ ...BASE, persistedPaymentType: null, currentMessage: "tenho plano" });
    expect(r.isInsurance).toBe(true);
  });
});

// ─── Detecção via historyMessages ────────────────────────────────────────────

describe("resolveInsuranceMode — detecção via historyMessages", () => {
  it("isInsurance=true quando histórico menciona 'plano' (mesmo sem currentMessage)", () => {
    const r = resolveInsuranceMode({
      ...BASE,
      currentMessage: "oi",
      historyMessages: [{ content: "quero usar meu plano" }],
    });
    expect(r.isInsurance).toBe(true);
  });

  it("isInsurance=true quando histórico menciona 'convênio' sem acento", () => {
    const r = resolveInsuranceMode({
      ...BASE,
      currentMessage: "ok",
      historyMessages: [{ content: "vou usar convenio" }],
    });
    expect(r.isInsurance).toBe(true);
  });

  it("isPrivate=true quando histórico menciona 'particular'", () => {
    const r = resolveInsuranceMode({
      ...BASE,
      currentMessage: "ok",
      historyMessages: [{ content: "sou particular" }],
    });
    expect(r.isPrivate).toBe(true);
  });

  it("múltiplas mensagens de histórico: detecta na segunda", () => {
    const r = resolveInsuranceMode({
      ...BASE,
      currentMessage: "ok",
      historyMessages: [
        { content: "quero agendar uma consulta" },
        { content: "tenho unimed" },
      ],
    });
    expect(r.isInsurance).toBe(true);
  });

  it("histórico vazio + currentMessage vazia → triageNeeded=true", () => {
    const r = resolveInsuranceMode({ ...BASE, currentMessage: "", historyMessages: [] });
    expect(r.triageNeeded).toBe(true);
  });

  it("histórico vazio + persistedPaymentType=null → triageNeeded=true", () => {
    const r = resolveInsuranceMode({ ...BASE, persistedPaymentType: null });
    expect(r.triageNeeded).toBe(true);
  });
});

// ─── Prioridade: persistedPaymentType > currentMessage > historyMessages ──────

describe("resolveInsuranceMode — prioridade das fontes", () => {
  it("persisted anula necessidade de regex — mesmo sem regex, isInsurance=true", () => {
    const r = resolveInsuranceMode({
      ...BASE,
      persistedPaymentType: "insurance",
      currentMessage: "bom dia",
      historyMessages: [{ content: "oi" }],
    });
    expect(r.isInsurance).toBe(true);
  });

  it("regex do currentMessage detecta mesmo sem histórico e sem persistedPaymentType", () => {
    const r = resolveInsuranceMode({
      ...BASE,
      persistedPaymentType: null,
      currentMessage: "hapvida",
      historyMessages: [],
    });
    expect(r.isInsurance).toBe(true);
  });

  it("histórico detecta mesmo sem currentMessage e sem persistedPaymentType", () => {
    const r = resolveInsuranceMode({
      ...BASE,
      persistedPaymentType: null,
      currentMessage: "ok",
      historyMessages: [{ content: "tenho amil" }],
    });
    expect(r.isInsurance).toBe(true);
  });
});

// ─── triageComplete e triageNeeded ───────────────────────────────────────────

describe("resolveInsuranceMode — triageComplete e triageNeeded", () => {
  it("triageComplete=true e triageNeeded=false quando isInsurance=true", () => {
    const r = resolveInsuranceMode({ ...BASE, currentMessage: "tenho plano" });
    expect(r.triageComplete).toBe(true);
    expect(r.triageNeeded).toBe(false);
  });

  it("triageComplete=true e triageNeeded=false quando isPrivate=true", () => {
    const r = resolveInsuranceMode({ ...BASE, currentMessage: "sou particular" });
    expect(r.triageComplete).toBe(true);
    expect(r.triageNeeded).toBe(false);
  });

  it("triageComplete=false e triageNeeded=true quando nenhuma declaração detectada", () => {
    const r = resolveInsuranceMode({ ...BASE });
    expect(r.triageComplete).toBe(false);
    expect(r.triageNeeded).toBe(true);
  });

  it("triageComplete=false e triageNeeded=false quando clinicAcceptsInsurance=false (triagem não aplicável)", () => {
    const r = resolveInsuranceMode({ ...BASE, clinicAcceptsInsurance: false });
    expect(r.triageComplete).toBe(false);
    expect(r.triageNeeded).toBe(false);
  });

  it("triageNeeded inverte triageComplete quando clínica aceita convênio", () => {
    const withPlan = resolveInsuranceMode({ ...BASE, currentMessage: "tenho plano" });
    const withoutPlan = resolveInsuranceMode({ ...BASE, currentMessage: "oi" });
    expect(withPlan.triageNeeded).toBe(!withPlan.triageComplete);
    expect(withoutPlan.triageNeeded).toBe(!withoutPlan.triageComplete);
  });
});

// ─── Estrutura do retorno ─────────────────────────────────────────────────────

describe("resolveInsuranceMode — estrutura do retorno", () => {
  it("sempre retorna objeto com as 4 chaves esperadas", () => {
    const r = resolveInsuranceMode({ ...BASE });
    expect(r).toHaveProperty("isInsurance");
    expect(r).toHaveProperty("isPrivate");
    expect(r).toHaveProperty("triageComplete");
    expect(r).toHaveProperty("triageNeeded");
  });

  it("todos os valores são booleanos", () => {
    const r = resolveInsuranceMode({ ...BASE, currentMessage: "tenho plano" });
    expect(typeof r.isInsurance).toBe("boolean");
    expect(typeof r.isPrivate).toBe("boolean");
    expect(typeof r.triageComplete).toBe("boolean");
    expect(typeof r.triageNeeded).toBe("boolean");
  });

  it("não muta o array historyMessages", () => {
    const history = [{ content: "tenho plano" }];
    const original = [...history];
    resolveInsuranceMode({ ...BASE, historyMessages: history });
    expect(history).toEqual(original);
  });
});
