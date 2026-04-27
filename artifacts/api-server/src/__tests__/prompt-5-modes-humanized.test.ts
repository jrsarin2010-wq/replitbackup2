import { describe, it, expect } from "vitest";
import { buildConstrainedPrompt } from "../lib/constrained-prompt";
import type { ConstrainedPromptContext } from "../lib/constrained-prompt";

describe("Constrained Prompt — 5 modos humanizados (Sessão 2)", () => {
  const baseContext: ConstrainedPromptContext = {
    aiName: "Júlia",
    clinicName: "Sorrizin Maxx",
    personalityHint: "Tom acolhedor, caloroso e empático.",
    mode: "PARTICULAR_SPIN",
    isInsuranceContact: false,
    isFirstContact: false,
    contactType: "lead",
    intent: "schedule",
    slots: [],
    professionals: [],
    procedureNames: [],
    insurancePlans: null,
    todayLabel: "Seg 27/04/2026",
  };

  describe("T1: URGENCIA — acolhimento emocional antes de logística", () => {
    it("deve incluir 'Calma', encaminhamento ao doutor e encaixe", () => {
      const prompt = buildConstrainedPrompt({ ...baseContext, mode: "URGENCIA" });
      expect(prompt).toContain("Calma");
      expect(prompt).toContain("ajudar");
      expect(prompt).toContain("falar com o doutor");
      expect(prompt).toContain("encaixe");
    });
  });

  describe("T2: LEAD_INDICACAO — valida indicação e oferece 2 horários", () => {
    it("deve mencionar 2 horários e escassez leve ('apertado')", () => {
      const prompt = buildConstrainedPrompt({ ...baseContext, mode: "LEAD_INDICACAO" });
      expect(prompt).toContain("bom");
      expect(prompt).toContain("2 horarios");
      expect(prompt).toContain("apertado");
    });
  });

  describe("T3: PARTICULAR_SPIN — SPIN comercial leve", () => {
    it("deve incluir empatia, urgência ('Quanto antes') e escassez ('agenda')", () => {
      const prompt = buildConstrainedPrompt({ ...baseContext, mode: "PARTICULAR_SPIN" });
      expect(prompt).toContain("situacao chata");
      expect(prompt).toContain("Quanto antes");
      expect(prompt).toContain("agenda");
    });
  });

  describe("T4: CONVENIO_TRIAGEM — confirma plano sem mencionar preços", () => {
    it("deve confirmar que atende o plano e delegar valor ao doutor", () => {
      const prompt = buildConstrainedPrompt({
        ...baseContext,
        mode: "CONVENIO_TRIAGEM",
        isInsuranceContact: true,
        insurancePlans: "bradesco,unimed",
      });
      expect(prompt).toContain("atendemos");
      expect(prompt).not.toContain("consulta custa");
      expect(prompt).toContain("doutor decide");
    });
  });

  describe("T5: CONVENIO_AGENDAR — eficiência + amigável", () => {
    it("deve confirmar intenção de agendamento com 'Otimo' e 'encaixar'", () => {
      const prompt = buildConstrainedPrompt({ ...baseContext, mode: "CONVENIO_AGENDAR" });
      expect(prompt).toContain("Otimo");
      expect(prompt).toContain("encaixar");
      expect(prompt).toContain("dia");
    });
  });

  describe("T6: PACIENTE_AGENDAR — familiar, usa nome e referencia tratamento", () => {
    it("deve conter placeholder [nome], 'proxima' e 'tratamento'", () => {
      const prompt = buildConstrainedPrompt({ ...baseContext, mode: "PACIENTE_AGENDAR" });
      expect(prompt).toContain("[nome]");
      expect(prompt).toContain("proxima");
      expect(prompt).toContain("tratamento");
    });
  });

  describe("T7: personalityHint — tom varia por personalidade configurada", () => {
    it("deve injetar o hint quando presente e omiti-lo quando ausente", () => {
      const promptComHint = buildConstrainedPrompt({
        ...baseContext,
        personalityHint: "Tom acolhedor, caloroso e empático.",
      });
      expect(promptComHint).toContain("acolhedor");
      expect(promptComHint).toContain("caloroso");

      const promptSemHint = buildConstrainedPrompt({
        ...baseContext,
        personalityHint: undefined,
      });
      expect(promptSemHint).not.toContain("acolhedor");
    });
  });

  describe("T8: REGRA-MÃE — seções universais presentes em todos os modos", () => {
    it("todos os modos devem conter REGRAS UNIVERSAIS, REGRA-MAE e 'falar com o doutor'", () => {
      const modes = [
        "URGENCIA",
        "LEAD_INDICACAO",
        "PARTICULAR_SPIN",
        "CONVENIO_TRIAGEM",
        "CONVENIO_AGENDAR",
        "PACIENTE_AGENDAR",
      ] as const;

      for (const mode of modes) {
        const prompt = buildConstrainedPrompt({ ...baseContext, mode });
        expect(prompt, `modo ${mode}: deve ter REGRAS UNIVERSAIS`).toContain("REGRAS UNIVERSAIS");
        expect(prompt, `modo ${mode}: deve ter REGRA-MAE`).toContain("=== REGRA-MAE ===");
        expect(prompt, `modo ${mode}: deve ter alternativa 'falar com o doutor'`).toContain("falar com o doutor");
      }
    });
  });
});
