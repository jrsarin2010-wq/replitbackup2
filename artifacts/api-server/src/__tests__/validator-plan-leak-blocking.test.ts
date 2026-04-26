/**
 * Este teste protege contra o bug histórico em que a IA voltava a perguntar
 * plano mesmo após desmarcar "aceita plano" nos profissionais. A CAMADA 4
 * (validateConstrainedReply + applyViolationFallback) deve segurar a brecha
 * mesmo que o prompt falhe ou o LLM regrida.
 */

import { describe, it, expect } from "vitest";
import { validateConstrainedReply } from "../lib/response-validator";
import { applyViolationFallback } from "../lib/structured-renderer";

describe("Validator — Plan Leak Blocking (CAMADA 4)", () => {
  describe("T1: Clínica SEM profissional aceitando plano + reply contém 'qual plano você usa?'", () => {
    it("deve detectar violation do tipo insurance_mention_when_not_accepted", () => {
      const violations = validateConstrainedReply(
        "Qual plano você usa, particular ou convênio?",
        { isInsuranceContact: false, insurancePlans: null, clinicAcceptsAnyInsurance: false },
      );

      expect(violations).toHaveLength(1);
      expect(violations[0]).toEqual(
        expect.objectContaining({ type: "insurance_mention_when_not_accepted" }),
      );
    });
  });

  describe("T2: Clínica SEM profissional aceitando plano + reply contém 'posso fazer reembolso'", () => {
    it("deve detectar menção a 'reembolso'", () => {
      const violations = validateConstrainedReply(
        "Posso fazer reembolso pra você depois.",
        { isInsuranceContact: false, insurancePlans: null, clinicAcceptsAnyInsurance: false },
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].type).toBe("insurance_mention_when_not_accepted");
    });
  });

  describe("T3: Clínica COM profissional aceitando plano + reply contém 'qual plano?'", () => {
    it("NÃO deve gerar violation — comportamento legítimo", () => {
      const violations = validateConstrainedReply(
        "Qual plano você usa?",
        { isInsuranceContact: false, insurancePlans: "amil,unimed", clinicAcceptsAnyInsurance: true },
      );

      expect(violations).toHaveLength(0);
    });
  });

  describe("T4: Clínica SEM profissional aceitando plano + reply sem menção a plano", () => {
    it("NÃO deve gerar violation", () => {
      const violations = validateConstrainedReply(
        "Posso te encaixar amanhã às 10h!",
        { isInsuranceContact: false, insurancePlans: null, clinicAcceptsAnyInsurance: false },
      );

      expect(violations).toHaveLength(0);
    });
  });

  describe("T5 (BUG REAL CRAVADO): Ponta-a-ponta — IA alucinando plano após desmarcar 'aceita plano'", () => {
    it("deve bloquear menção a plano no texto final, mesmo que LLM a gere", () => {
      const llmOutput = "Você seria atendimento por plano ou particular?";

      const violations = validateConstrainedReply(llmOutput, {
        isInsuranceContact: false,
        insurancePlans: null,
        clinicAcceptsAnyInsurance: false,
      });

      expect(violations).toHaveLength(1);
      expect(violations[0].type).toBe("insurance_mention_when_not_accepted");

      const rendered = {
        text: llmOutput,
        markers: [],
        shouldCreateAppointment: false,
        chosenSlot: null,
        chosenProfessional: null,
      };

      const safe = applyViolationFallback(rendered, violations);

      expect(safe.text).not.toMatch(/plano|convênio|reembolso/i);
      expect(safe.text).toContain("ajudar");
    });
  });
});
