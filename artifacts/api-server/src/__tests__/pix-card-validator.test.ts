import { describe, it, expect } from "vitest";
import { validateAIResponse } from "../lib/response-validator";
import { buildPixCardText } from "../lib/prompt-helpers";

const BASE_CTX = {
  availabilityInfo: "",
  triagePending: false,
  procedureNames: [],
  ownerTitle: null as null,
  ownerFirstName: null,
  consultationFee: null,
  procedurePrices: [],
  mode: "PARTICULAR_SPIN" as const,
};

const PIX_PROF = [{ pixEnabled: true, pixKey: "123.456.789-00", pixMode: "optional" }];

const PIXEL_CARD = buildPixCardText({
  name: "Dra. Ana",
  pixKey: "123.456.789-00",
  pixBank: "Nubank",
  pixKeyType: "cpf",
  consultationFee: null,
  chargesConsultation: false,
});

describe("pix_card_omitted — validador de omissão do card PIX", () => {
  it("(a) resposta contém o card → sem violação pix_card_omitted", () => {
    const violations = validateAIResponse({
      ...BASE_CTX,
      reply: `Claro! Segue o card para pagamento:\n\n${PIXEL_CARD}`,
      incomingMessage: "qual é a forma de pagamento?",
      pixProfessionals: PIX_PROF,
    });
    const types = violations.map((v) => v.type);
    expect(types).not.toContain("pix_card_omitted");
  });

  it("(b) resposta sem o card quando pergunta de pagamento foi feita → violação pix_card_omitted", () => {
    const violations = validateAIResponse({
      ...BASE_CTX,
      reply: "O pagamento é realizado via PIX, é bem simples!",
      incomingMessage: "como é feito o pagamento?",
      pixProfessionals: PIX_PROF,
    });
    const types = violations.map((v) => v.type);
    expect(types).toContain("pix_card_omitted");
  });

  it("(b2) pergunta explícita sobre PIX sem card → violação pix_card_omitted", () => {
    const violations = validateAIResponse({
      ...BASE_CTX,
      reply: "Aceitamos PIX, pode pagar pelo celular mesmo!",
      incomingMessage: "aceita PIX?",
      pixProfessionals: PIX_PROF,
    });
    const types = violations.map((v) => v.type);
    expect(types).toContain("pix_card_omitted");
  });

  it("(b3) pergunta 'como pago' sem card → violação pix_card_omitted", () => {
    const violations = validateAIResponse({
      ...BASE_CTX,
      reply: "O pagamento pode ser feito via PIX diretamente para a clínica.",
      incomingMessage: "como pago a consulta?",
      pixProfessionals: PIX_PROF,
    });
    const types = violations.map((v) => v.type);
    expect(types).toContain("pix_card_omitted");
  });

  it("(c) modo convênio (CONVENIO_AGENDAR) não dispara pix_card_omitted", () => {
    const violations = validateAIResponse({
      ...BASE_CTX,
      reply: "Ótimo, vamos agendar pelo seu plano!",
      incomingMessage: "como é o pagamento?",
      pixProfessionals: PIX_PROF,
      mode: "CONVENIO_AGENDAR" as const,
    });
    const types = violations.map((v) => v.type);
    expect(types).not.toContain("pix_card_omitted");
  });

  it("(c2) modo convênio em triagem não dispara pix_card_omitted", () => {
    const violations = validateAIResponse({
      ...BASE_CTX,
      reply: "Você vai usar plano ou é particular?",
      incomingMessage: "quero saber sobre pagamento",
      pixProfessionals: PIX_PROF,
      mode: "CONVENIO_TRIAGEM" as const,
      triagePending: true,
    });
    const types = violations.map((v) => v.type);
    expect(types).not.toContain("pix_card_omitted");
  });

  it("(c3) modo convênio (isInsuranceContact derivado de CONVENIO_AGENDAR) não dispara pix_card_omitted", () => {
    const violations = validateAIResponse({
      ...BASE_CTX,
      reply: "Vamos agendar pela Unimed!",
      incomingMessage: "qual é a forma de pagamento?",
      pixProfessionals: PIX_PROF,
      mode: "CONVENIO_AGENDAR" as const,
    });
    const types = violations.map((v) => v.type);
    expect(types).not.toContain("pix_card_omitted");
  });

  it("mensagem sem intenção de pagamento não dispara pix_card_omitted", () => {
    const violations = validateAIResponse({
      ...BASE_CTX,
      reply: "A clínica fica na Rua das Flores, 123.",
      incomingMessage: "onde fica a clínica?",
      pixProfessionals: PIX_PROF,
    });
    const types = violations.map((v) => v.type);
    expect(types).not.toContain("pix_card_omitted");
  });

  it("sem profissional com PIX não dispara pix_card_omitted", () => {
    const violations = validateAIResponse({
      ...BASE_CTX,
      reply: "O pagamento é via PIX, pode fazer pelo app do banco.",
      incomingMessage: "como é o pagamento?",
      pixProfessionals: [{ pixEnabled: false, pixKey: null, pixMode: null }],
    });
    const types = violations.map((v) => v.type);
    expect(types).not.toContain("pix_card_omitted");
  });

  it("sem pixProfessionals no contexto não dispara pix_card_omitted", () => {
    const violations = validateAIResponse({
      ...BASE_CTX,
      reply: "O pagamento é via PIX.",
      incomingMessage: "como é o pagamento?",
    });
    const types = violations.map((v) => v.type);
    expect(types).not.toContain("pix_card_omitted");
  });
});
