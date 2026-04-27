import { describe, it, expect } from "vitest";
import { detectProofOfPayment } from "../lib/constrained-engine";
import { buildConstrainedPrompt } from "../lib/constrained-prompt";

function makePixCtx(overrides: Record<string, unknown>) {
  return {
    clinicName: "Sorrizin Maxx",
    aiName: "Julia",
    mode: null as null,
    isInsuranceContact: false,
    isFirstContact: false,
    contactType: "lead",
    intent: "agendar",
    slots: [],
    professionals: [],
    procedureNames: [],
    todayLabel: "Seg 04/05/2026",
    ...overrides,
  };
}

describe("PIX Payment Validation", () => {
  describe("T1: pixMode=OBRIGATORIO — prompt menciona PIX obrigatorio", () => {
    it("deve incluir instrucao de PIX antecipado, comprovante e watchdog 30min/24h", () => {
      const prompt = buildConstrainedPrompt(makePixCtx({
        pixMode: "OBRIGATORIO",
        pixKey: "chave-pix@sorrizin",
        pixAmount: "200",
        pixHolderName: "Sorrizin Maxx LTDA",
      }));
      expect(prompt).toContain("EXIGE PIX");
      expect(prompt).toContain("comprovante");
      expect(prompt).toContain("30min");
      expect(prompt).toContain("24h");
    });
  });

  describe("T2: pixMode=OPCIONAL — prompt menciona PIX so se pedir", () => {
    it("deve instruir confirmar direto e so mencionar PIX se lead pedir", () => {
      const prompt = buildConstrainedPrompt(makePixCtx({
        pixMode: "OPCIONAL",
        pixKey: "chave-pix@sorrizin",
      }));
      expect(prompt).toContain("OFERECE PIX");
      expect(prompt).toContain("so mencione se o lead pedir");
      expect(prompt).not.toContain("EXIGE PIX");
    });
  });

  describe("T3: pixMode=DESATIVADO — prompt proibe qualquer mencao a PIX", () => {
    it("deve conter aviso de desativado e proibicao", () => {
      const prompt = buildConstrainedPrompt(makePixCtx({
        pixMode: "DESATIVADO",
      }));
      expect(prompt).toContain("PIX ESTA DESATIVADO");
      expect(prompt).toContain("NAO mencione PIX");
    });
  });

  describe("T4: detectProofOfPayment com 'transferi R$ 200'", () => {
    it("deve retornar true", () => {
      expect(detectProofOfPayment("transferi R$ 200 agora")).toBe(true);
    });
  });

  describe("T5: detectProofOfPayment com comprovante (case-insensitive)", () => {
    it("deve retornar true", () => {
      expect(detectProofOfPayment("Aqui está o comprovante da transferência")).toBe(true);
    });
  });

  describe("T6: detectProofOfPayment sem keywords", () => {
    it("deve retornar false", () => {
      expect(detectProofOfPayment("Oi, tudo bem? Como vai?")).toBe(false);
    });
  });

  describe("T7: pixKey e pixAmount renderizados corretamente em OBRIGATORIO", () => {
    it("deve incluir chave PIX e valor no prompt", () => {
      const prompt = buildConstrainedPrompt(makePixCtx({
        pixMode: "OBRIGATORIO",
        pixKey: "123.456.789-00",
        pixAmount: "300",
      }));
      expect(prompt).toContain("123.456.789-00");
      expect(prompt).toContain("300");
    });
  });

  describe("T8: pixKey renderizado corretamente em OPCIONAL", () => {
    it("deve incluir chave PIX no bloco opcional", () => {
      const prompt = buildConstrainedPrompt(makePixCtx({
        pixMode: "OPCIONAL",
        pixKey: "conta@banco.com",
      }));
      expect(prompt).toContain("conta@banco.com");
    });
  });

  describe("T9: Fluxo OBRIGATORIO — lead aceita mas ainda nao enviou comprovante", () => {
    it("detectProofOfPayment retorna false para aceite e true para envio", () => {
      expect(detectProofOfPayment("Perfeito, segunda às 14h!")).toBe(false);
      expect(detectProofOfPayment("Tá certo, transferindo agora")).toBe(true);
    });
  });

  describe("T10: pixMode null → default DESATIVADO", () => {
    it("deve renderizar como DESATIVADO quando pixMode e null", () => {
      const prompt = buildConstrainedPrompt(makePixCtx({
        pixMode: null,
      }));
      expect(prompt).toContain("PIX ESTA DESATIVADO");
    });
  });
});
