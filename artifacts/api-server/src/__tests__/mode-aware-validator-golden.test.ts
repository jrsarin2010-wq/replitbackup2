import { describe, it, expect } from "vitest";
import { validateAIResponse, deterministicFallback } from "../lib/response-validator";

const baseCtx = {
  availabilityInfo: "Quarta 10:00, 14:00, 16:30",
  procedureNames: ["limpeza", "clareamento"],
  ownerTitle: "Dra." as const,
  ownerFirstName: "Ana",
  consultationFee: "200",
  procedurePrices: [200],
};

describe("validator obeys mode (Task #17)", () => {
  it("CONVENIO_TRIAGEM: bloqueia oferta de horário sem perguntar plano/particular", () => {
    const v = validateAIResponse({
      ...baseCtx,
      reply: "Posso te marcar quarta às 10:00, pode ser?",
      triagePending: true,
      mode: "CONVENIO_TRIAGEM",
    });
    expect(v.some((x) => x.type === "time_outside_agenda" || x.type === "triage_ignored")).toBe(true);
  });

  it("CONVENIO_TRIAGEM: aceita resposta que pergunta plano/particular sem horário", () => {
    const v = validateAIResponse({
      ...baseCtx,
      reply: "Antes de te passar horários, posso confirmar: você vai usar plano ou é particular?",
      triagePending: true,
      mode: "CONVENIO_TRIAGEM",
    });
    expect(v).toHaveLength(0);
  });

  it("CONVENIO_AGENDAR: bloqueia termos de venda/escassez", () => {
    const v = validateAIResponse({
      ...baseCtx,
      reply: "Consegui um encaixe na quarta às 10:00, mas a agenda está disputada — corre que vai!",
      triagePending: false,
      isInsuranceContact: true,
      mode: "CONVENIO_AGENDAR",
    });
    expect(v.some((x) => x.type === "insurance_sales_term")).toBe(true);
  });

  it("CONVENIO_AGENDAR: aceita oferta calma de horário da AGENDA", () => {
    const v = validateAIResponse({
      ...baseCtx,
      reply: "Tenho disponível quarta às 10:00 ou às 14:00. Qual fica melhor pra você?",
      triagePending: false,
      isInsuranceContact: true,
      mode: "CONVENIO_AGENDAR",
    });
    expect(v.filter((x) => x.type === "insurance_sales_term")).toHaveLength(0);
    expect(v.filter((x) => x.type === "time_outside_agenda")).toHaveLength(0);
  });

  it("PARTICULAR_SPIN: aceita SPIN/escassez sem violação", () => {
    const v = validateAIResponse({
      ...baseCtx,
      reply: "Consegui um encaixe especial pra você quarta às 10:00. Posso reservar?",
      triagePending: false,
      isInsuranceContact: false,
      mode: "PARTICULAR_SPIN",
    });
    expect(v.filter((x) => x.type === "insurance_sales_term")).toHaveLength(0);
  });

  it("PACIENTE_AGENDAR: bloqueia horário fora da AGENDA", () => {
    const v = validateAIResponse({
      ...baseCtx,
      reply: "Posso te encaixar terça às 19:30?",
      triagePending: false,
      mode: "PACIENTE_AGENDAR",
    });
    expect(v.some((x) => x.type === "time_outside_agenda")).toBe(true);
  });

  it("PACIENTE_AGENDAR: bloqueia termos de venda/escassez (no-SPIN para paciente recorrente)", () => {
    const v = validateAIResponse({
      ...baseCtx,
      reply: "Consegui um encaixe especial pra você quarta às 10:00, corre que vai!",
      triagePending: false,
      mode: "PACIENTE_AGENDAR",
    });
    expect(v.some((x) => x.type === "insurance_sales_term")).toBe(true);
  });

  it("CONVENIO_TRIAGEM: resposta genérica sem pergunta plano/particular viola na 2ª resposta em diante", () => {
    const v = validateAIResponse({
      ...baseCtx,
      reply: "Olá! Tudo bem por aí? Conta mais sobre o que está sentindo.",
      triagePending: true,
      mode: "CONVENIO_TRIAGEM",
      isFirstAIReplyInMode: false,
    });
    expect(v.some((x) => x.type === "triage_ignored")).toBe(true);
  });

  // ── Task #23 — empatia primeiro ─────────────────────────────────────────
  it("CONVENIO_TRIAGEM Task #23: 1ª resposta puramente empática (sem pergunta) é ACEITA", () => {
    const v = validateAIResponse({
      ...baseCtx,
      reply: "Que dor chata, Maria. Imagino o quanto está incomodando — vamos cuidar disso pra você.",
      triagePending: true,
      mode: "CONVENIO_TRIAGEM",
      isFirstAIReplyInMode: true,
    });
    expect(v.filter((x) => x.type === "triage_ignored")).toHaveLength(0);
  });

  it("CONVENIO_TRIAGEM Task #23: 1ª resposta com acolhimento + pergunta plano/particular é ACEITA", () => {
    const v = validateAIResponse({
      ...baseCtx,
      reply: "Que dor chata! Pra te orientar certinho, você vai usar plano ou é particular?",
      triagePending: true,
      mode: "CONVENIO_TRIAGEM",
      isFirstAIReplyInMode: true,
    });
    expect(v).toHaveLength(0);
  });

  it("CONVENIO_TRIAGEM Task #23: 1ª resposta empática NÃO pode oferecer agenda mesmo sendo a primeira", () => {
    const v = validateAIResponse({
      ...baseCtx,
      reply: "Imagino o quanto está incomodando. Posso te encaixar quarta às 10:00?",
      triagePending: true,
      mode: "CONVENIO_TRIAGEM",
      isFirstAIReplyInMode: true,
    });
    expect(v.some((x) => x.type === "triage_ignored")).toBe(true);
  });

  it("CONVENIO_TRIAGEM Task #23: 2ª resposta sem pergunta plano/particular volta a violar", () => {
    const v = validateAIResponse({
      ...baseCtx,
      reply: "Conta mais sobre o que está sentindo.",
      triagePending: true,
      mode: "CONVENIO_TRIAGEM",
      isFirstAIReplyInMode: false,
    });
    expect(v.some((x) => x.type === "triage_ignored")).toBe(true);
  });

  // ── Task #23 (refinado) — mesmo numa saudação genérica a 1ª resposta
  // pode ser puramente calorosa (sem perguntar plano/particular ainda).
  // O objetivo é que a IA pareça uma recepcionista humana, não um formulário.
  it("CONVENIO_TRIAGEM Task #23: saudação genérica + 1ª resposta calorosa SEM pergunta plano/particular passa", () => {
    const v = validateAIResponse({
      ...baseCtx,
      reply: "Oi José, tudo bem? Sou a Ana da clínica, em que posso te ajudar hoje?",
      triagePending: true,
      mode: "CONVENIO_TRIAGEM",
      isFirstAIReplyInMode: true,
      incomingIsGreeting: true,
    });
    expect(v).toHaveLength(0);
  });

  it("CONVENIO_TRIAGEM Task #23: saudação genérica + 1ª resposta com cumprimento + pergunta passa", () => {
    const v = validateAIResponse({
      ...baseCtx,
      reply: "Oi! Antes de te orientar, posso saber: você vai usar plano ou é particular?",
      triagePending: true,
      mode: "CONVENIO_TRIAGEM",
      isFirstAIReplyInMode: true,
      incomingIsGreeting: true,
    });
    expect(v).toHaveLength(0);
  });

  // ── Task #23 — CONVENIO_AGENDAR sem SPIN/gatilhos mentais ───────────────
  it("CONVENIO_AGENDAR Task #23: oferta calma de horários da AGENDA passa sem violação", () => {
    const v = validateAIResponse({
      ...baseCtx,
      reply: "Tenho disponível quarta às 10:00, 14:00 ou 16:30. Qual fica melhor pra você?",
      triagePending: false,
      isInsuranceContact: true,
      mode: "CONVENIO_AGENDAR",
    });
    expect(v).toHaveLength(0);
  });

  it("CONVENIO_AGENDAR Task #23: bloqueia gatilhos mentais (\"oportunidade\", \"não perca\")", () => {
    const v = validateAIResponse({
      ...baseCtx,
      reply: "Tenho quarta às 10:00 disponível, é uma oportunidade — não perca!",
      triagePending: false,
      isInsuranceContact: true,
      mode: "CONVENIO_AGENDAR",
    });
    expect(v.some((x) => x.type === "insurance_sales_term")).toBe(true);
  });
});

describe("deterministicFallback é mode-aware (Task #17)", () => {
  const v = [{ type: "insurance_sales_term" as const, detail: "x" }];

  it("PACIENTE_AGENDAR: fallback NÃO menciona convênio nem plano", () => {
    const fb = deterministicFallback(v, { mode: "PACIENTE_AGENDAR" });
    expect(fb.toLowerCase()).not.toMatch(/conv[eê]nio|plano/);
  });

  it("PARTICULAR_SPIN: fallback NÃO menciona convênio nem plano", () => {
    const fb = deterministicFallback(v, { mode: "PARTICULAR_SPIN" });
    expect(fb.toLowerCase()).not.toMatch(/conv[eê]nio|plano/);
  });

  it("CONVENIO_AGENDAR: fallback ainda pode mencionar convênio", () => {
    const fb = deterministicFallback(v, { mode: "CONVENIO_AGENDAR" });
    expect(fb.toLowerCase()).toMatch(/conv[eê]nio|plano/);
  });

  it("CONVENIO_TRIAGEM: implica triagePending no fallback (faz pergunta plano/particular)", () => {
    const fb = deterministicFallback([{ type: "time_outside_agenda", detail: "x" }], { mode: "CONVENIO_TRIAGEM" });
    expect(fb.toLowerCase()).toMatch(/plano.*particular|particular/);
  });
});
