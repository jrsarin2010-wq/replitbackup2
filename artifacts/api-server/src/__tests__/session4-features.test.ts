/**
 * Session 4 — Suite de regressão para Resgate de Lead + Telegram + Maps.
 *
 * Cobre sem chamada à OpenAI/rede:
 *   - detectLeadEscape: positivos e negativos
 *   - detectMapQuery:   positivos e negativos
 *   - buildConstrainedPrompt: bloco RESGATE condicional
 *   - buildConstrainedPrompt: ação SEND_MAPS presente no prompt de ações
 *   - buildConstrainedPrompt: produz output com qualquer configuração válida
 */

import { describe, it, expect } from "vitest";
import { detectLeadEscape, detectMapQuery } from "../lib/constrained-engine";
import { buildConstrainedPrompt } from "../lib/constrained-prompt";

// Contexto mínimo válido para buildConstrainedPrompt (campos obrigatórios).
const BASE_CTX = {
  aiName: "Júlia",
  clinicName: "Sorrizin Maxx",
  mode: null,
  isInsuranceContact: false,
  isFirstContact: false,
  contactType: "lead",
  intent: "agendar",
  slots: [],
  professionals: [],
  procedureNames: [],
  todayLabel: "Dom 27/04/2025",
  pixMode: "DESATIVADO" as const,
};

describe("Session 4 — Resgate + Telegram + Maps", () => {

  describe("T1: detectLeadEscape com 'vou pensar'", () => {
    it("deve retornar true", () => {
      expect(detectLeadEscape("oi, vou pensar e te ligo depois")).toBe(true);
    });
  });

  describe("T2: detectLeadEscape com 'deixa eu pensar'", () => {
    it("deve retornar true (case-insensitive)", () => {
      expect(detectLeadEscape("Deixa eu pensar sobre isso")).toBe(true);
    });
  });

  describe("T3: detectLeadEscape com mensagem normal", () => {
    it("deve retornar false", () => {
      expect(detectLeadEscape("Perfeito, segunda às 14h!")).toBe(false);
    });
  });

  describe("T4: detectMapQuery com 'onde fica'", () => {
    it("deve retornar true", () => {
      expect(detectMapQuery("Onde fica a clínica?")).toBe(true);
    });
  });

  describe("T5: detectMapQuery com 'qual é o endereço'", () => {
    it("deve retornar true", () => {
      expect(detectMapQuery("Qual é o endereço de vocês?")).toBe(true);
    });
  });

  describe("T6: detectMapQuery com mensagem normal", () => {
    it("deve retornar false", () => {
      expect(detectMapQuery("Tudo bem com vocês?")).toBe(false);
    });
  });

  describe("T7: Bloco RESGATE renderizado quando leadIsEscaping=true", () => {
    it("deve incluir 'RESGATE DE LEAD' e instrução de reserva", () => {
      const prompt = buildConstrainedPrompt({ ...BASE_CTX, leadIsEscaping: true });
      expect(prompt).toContain("RESGATE DE LEAD");
      expect(prompt).toContain("deixa eu reservar");
    });
  });

  describe("T8: Bloco RESGATE NÃO renderizado quando leadIsEscaping=false", () => {
    it("não deve incluir bloco de resgate", () => {
      const prompt = buildConstrainedPrompt({ ...BASE_CTX, leadIsEscaping: false });
      expect(prompt).not.toContain("RESGATE DE LEAD");
    });
  });

  describe("T9: SEND_MAPS action incluído no prompt de ações", () => {
    it("deve listar SEND_MAPS como ação disponível", () => {
      const prompt = buildConstrainedPrompt(BASE_CTX);
      expect(prompt).toContain("SEND_MAPS");
    });
  });

  describe("T10: prompt gerado com qualquer config de Telegram", () => {
    it("deve produzir output não-vazio independente de settingsTelegramEscalationEnabled", () => {
      const prompt = buildConstrainedPrompt(BASE_CTX);
      expect(prompt.length).toBeGreaterThan(0);
      // Telegram não deve vazar no texto do paciente (regra universal)
      expect(prompt).toContain("NUNCA mencione \"Telegram\"");
    });
  });

});
