import { describe, it, expect } from "vitest";
import { resolveAcceptsInsurance } from "../lib/prompt-builder.js";

describe("resolveAcceptsInsurance — master toggle de convênio da clínica", () => {
  describe("clinicAcceptsInsurance = false (master toggle DESLIGADO)", () => {
    it("retorna false mesmo com 1 profissional com acceptsInsurance=true", () => {
      expect(resolveAcceptsInsurance(false, [{ acceptsInsurance: true }])).toBe(false);
    });

    it("retorna false com múltiplos profissionais com acceptsInsurance=true", () => {
      expect(
        resolveAcceptsInsurance(false, [
          { acceptsInsurance: true },
          { acceptsInsurance: true },
        ]),
      ).toBe(false);
    });

    it("retorna false com profissional sem campo acceptsInsurance definido", () => {
      expect(resolveAcceptsInsurance(false, [{}])).toBe(false);
    });

    it("retorna false com profissional acceptsInsurance=null", () => {
      expect(resolveAcceptsInsurance(false, [{ acceptsInsurance: null }])).toBe(false);
    });

    it("retorna false sem nenhum profissional cadastrado", () => {
      expect(resolveAcceptsInsurance(false, [])).toBe(false);
    });

    it("retorna false com mix de profissionais (true + false)", () => {
      expect(
        resolveAcceptsInsurance(false, [
          { acceptsInsurance: true },
          { acceptsInsurance: false },
        ]),
      ).toBe(false);
    });
  });

  describe("clinicAcceptsInsurance = true (master toggle LIGADO)", () => {
    describe("1 profissional (single-professional)", () => {
      it("retorna true quando profissional aceita convênio (true)", () => {
        expect(resolveAcceptsInsurance(true, [{ acceptsInsurance: true }])).toBe(true);
      });

      it("Task #11 — retorna false quando profissional não tem campo definido (default: NÃO aceita)", () => {
        expect(resolveAcceptsInsurance(true, [{}])).toBe(false);
      });

      it("Task #11 — retorna false quando profissional tem acceptsInsurance=null (default: NÃO aceita)", () => {
        expect(resolveAcceptsInsurance(true, [{ acceptsInsurance: null }])).toBe(false);
      });

      it("retorna false quando profissional recusa convênio explicitamente (false)", () => {
        expect(resolveAcceptsInsurance(true, [{ acceptsInsurance: false }])).toBe(false);
      });
    });

    describe("múltiplos profissionais (multi-professional)", () => {
      it("retorna true quando pelo menos 1 profissional aceita convênio", () => {
        expect(
          resolveAcceptsInsurance(true, [
            { acceptsInsurance: false },
            { acceptsInsurance: true },
          ]),
        ).toBe(true);
      });

      it("retorna true quando todos aceitam convênio", () => {
        expect(
          resolveAcceptsInsurance(true, [
            { acceptsInsurance: true },
            { acceptsInsurance: true },
          ]),
        ).toBe(true);
      });

      it("retorna false quando TODOS recusam convênio explicitamente", () => {
        expect(
          resolveAcceptsInsurance(true, [
            { acceptsInsurance: false },
            { acceptsInsurance: false },
          ]),
        ).toBe(false);
      });

      it("Task #11 — retorna false quando ninguém aceita explicitamente (false + sem campo)", () => {
        expect(
          resolveAcceptsInsurance(true, [
            { acceptsInsurance: false },
            {},
          ]),
        ).toBe(false);
      });

      it("Task #11 — retorna false quando ninguém aceita explicitamente (false + null)", () => {
        expect(
          resolveAcceptsInsurance(true, [
            { acceptsInsurance: false },
            { acceptsInsurance: null },
          ]),
        ).toBe(false);
      });
    });

    describe("sem profissionais cadastrados (fallback)", () => {
      it("retorna true (fallback para aceitar quando clínica ativa mas sem profissionais)", () => {
        expect(resolveAcceptsInsurance(true, [])).toBe(true);
      });
    });
  });

  describe("cenários de regressão — bug original", () => {
    it("BUG: clínica desliga convênio mas profissional tem acceptsInsurance=true → DEVE ser false", () => {
      const clinicAcceptsInsurance = false;
      const professionals = [{ acceptsInsurance: true }];
      const result = resolveAcceptsInsurance(clinicAcceptsInsurance, professionals);
      expect(result).toBe(false);
    });

    it("BUG: clínica desliga convênio + 3 profissionais com true → DEVE ser false", () => {
      const clinicAcceptsInsurance = false;
      const professionals = [
        { acceptsInsurance: true },
        { acceptsInsurance: true },
        { acceptsInsurance: true },
      ];
      const result = resolveAcceptsInsurance(clinicAcceptsInsurance, professionals);
      expect(result).toBe(false);
    });

    it("CENÁRIO CORRETO: clínica liga convênio + profissional com true → DEVE ser true", () => {
      const clinicAcceptsInsurance = true;
      const professionals = [{ acceptsInsurance: true }];
      const result = resolveAcceptsInsurance(clinicAcceptsInsurance, professionals);
      expect(result).toBe(true);
    });
  });

  describe("impacto no prompt — bifurcação convênio/particular", () => {
    it("quando acceptsInsurance=false, bifurcationBlock NÃO deve ser gerado", () => {
      const acceptsInsurance = resolveAcceptsInsurance(false, [{ acceptsInsurance: true }]);
      const insuranceTriageComplete = false;
      const bifurcationBlock = acceptsInsurance && !insuranceTriageComplete;
      expect(bifurcationBlock).toBe(false);
    });

    it("quando acceptsInsurance=true + triage incompleta, bifurcationBlock DEVE ser gerado", () => {
      const acceptsInsurance = resolveAcceptsInsurance(true, [{ acceptsInsurance: true }]);
      const insuranceTriageComplete = false;
      const bifurcationBlock = acceptsInsurance && !insuranceTriageComplete;
      expect(bifurcationBlock).toBe(true);
    });

    it("quando acceptsInsurance=true + triage completa, bifurcationBlock NÃO é gerado", () => {
      const acceptsInsurance = resolveAcceptsInsurance(true, [{ acceptsInsurance: true }]);
      const insuranceTriageComplete = true;
      const bifurcationBlock = acceptsInsurance && !insuranceTriageComplete;
      expect(bifurcationBlock).toBe(false);
    });

    it("schedulingRules: connectionPhase + acceptsInsurance=true + triage incompleta → pede plano/particular", () => {
      const acceptsInsurance = resolveAcceptsInsurance(true, [{ acceptsInsurance: true }]);
      const connectionPhase = true;
      const insuranceTriageComplete = false;
      const shouldAskTriage = connectionPhase && acceptsInsurance && !insuranceTriageComplete;
      expect(shouldAskTriage).toBe(true);
    });

    it("schedulingRules: connectionPhase + acceptsInsurance=false → NÃO pede plano/particular", () => {
      const acceptsInsurance = resolveAcceptsInsurance(false, [{ acceptsInsurance: true }]);
      const connectionPhase = true;
      const insuranceTriageComplete = false;
      const shouldAskTriage = connectionPhase && acceptsInsurance && !insuranceTriageComplete;
      expect(shouldAskTriage).toBe(false);
    });
  });
});
