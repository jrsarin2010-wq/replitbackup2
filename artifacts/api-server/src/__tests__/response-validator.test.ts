/**
 * Task #29 — Unit tests for the post-response validator.
 * Pure functions, no mocks needed.
 */
import { describe, it, expect } from "vitest";
import {
  validateAIResponse,
  buildCorrectionHint,
  deterministicFallback,
  parseMoney,
  type ValidatorContext,
} from "../lib/response-validator";

const BASE: ValidatorContext = {
  reply: "",
  availabilityInfo: "Seg 09:00 | Ter 14:00 | Qua 16:30",
  triagePending: false,
  procedureNames: ["Limpeza", "Restauracao"],
  ownerTitle: "Dra.",
  ownerFirstName: "Joana",
  consultationFee: "150.00",
  procedurePrices: [150, 250],
};

describe("validateAIResponse — time_outside_agenda", () => {
  it("flags HH:MM not present in the AGENDA string", () => {
    const v = validateAIResponse({ ...BASE, reply: "Tenho 11:30 e 09:00" });
    expect(v.map((x) => x.type)).toContain("time_outside_agenda");
    expect(v[0].detail).toContain("11:30");
    expect(v[0].detail).not.toContain("09:00");
  });

  it("does NOT flag when all times are in the AGENDA", () => {
    const v = validateAIResponse({ ...BASE, reply: "Posso te encaixar Seg 09:00 ou Ter 14:00" });
    expect(v.find((x) => x.type === "time_outside_agenda")).toBeUndefined();
  });

  it("ignores HH:MM that are part of an hour-range expression (e.g. '08:00 às 18:00')", () => {
    const v = validateAIResponse({
      ...BASE,
      reply: "Atendemos das 08:00 às 18:00 de seg a sex.",
      availabilityInfo: "",
    });
    expect(v.find((x) => x.type === "time_outside_agenda")).toBeUndefined();
  });

  it("flags ANY HH:MM when triagePending=true (even if availabilityInfo is empty)", () => {
    const v = validateAIResponse({
      ...BASE,
      triagePending: true,
      availabilityInfo: "",
      reply: "Posso te encaixar amanha as 09:00",
    });
    expect(v.find((x) => x.type === "time_outside_agenda")).toBeDefined();
  });
});

describe("validateAIResponse — triage_ignored", () => {
  it("flags scheduling offer without asking plano/particular", () => {
    const v = validateAIResponse({
      ...BASE,
      triagePending: true,
      availabilityInfo: "",
      reply: "Posso te marcar amanha de tarde, ta bom?",
    });
    expect(v.find((x) => x.type === "triage_ignored")).toBeDefined();
  });

  it("does NOT flag when reply asks plano/particular", () => {
    const v = validateAIResponse({
      ...BASE,
      triagePending: true,
      availabilityInfo: "",
      reply: "Antes de marcar, voce vai usar plano ou e particular?",
    });
    expect(v.find((x) => x.type === "triage_ignored")).toBeUndefined();
  });

  it("does NOT flag when triagePending=false even if scheduling offered without triage words", () => {
    const v = validateAIResponse({
      ...BASE,
      triagePending: false,
      reply: "Posso te encaixar Seg 09:00",
    });
    expect(v.find((x) => x.type === "triage_ignored")).toBeUndefined();
  });
});

describe("validateAIResponse — procedure_not_listed", () => {
  it("flags procedure keyword not present in tenant procedures", () => {
    const v = validateAIResponse({
      ...BASE,
      procedureNames: ["Limpeza"],
      reply: "Fazemos clareamento a laser sim!",
    });
    expect(v.find((x) => x.type === "procedure_not_listed")).toBeDefined();
  });

  it("does NOT flag when keyword matches a tenant procedure", () => {
    const v = validateAIResponse({
      ...BASE,
      procedureNames: ["Clareamento dental", "Limpeza"],
      reply: "Sim, fazemos clareamento.",
    });
    expect(v.find((x) => x.type === "procedure_not_listed")).toBeUndefined();
  });

  it("does NOT flag generic dental conversation without procedure keywords", () => {
    const v = validateAIResponse({
      ...BASE,
      reply: "Oi! Tudo bem? Como posso te ajudar?",
    });
    expect(v.find((x) => x.type === "procedure_not_listed")).toBeUndefined();
  });
});

describe("validateAIResponse — owner_title_wrong", () => {
  it("flags 'Dr. Joana' when owner is Dra.", () => {
    const v = validateAIResponse({
      ...BASE,
      ownerTitle: "Dra.",
      ownerFirstName: "Joana",
      reply: "O Dr. Joana atende de seg a sex.",
    });
    expect(v.find((x) => x.type === "owner_title_wrong")).toBeDefined();
  });

  it("flags 'Dra. Joao' when owner is Dr.", () => {
    const v = validateAIResponse({
      ...BASE,
      ownerTitle: "Dr.",
      ownerFirstName: "Joao",
      reply: "A Dra. Joao vai te atender.",
    });
    expect(v.find((x) => x.type === "owner_title_wrong")).toBeDefined();
  });

  it("does NOT flag correct title", () => {
    const v = validateAIResponse({
      ...BASE,
      ownerTitle: "Dra.",
      ownerFirstName: "Joana",
      reply: "A Dra. Joana atende de seg a sex.",
    });
    expect(v.find((x) => x.type === "owner_title_wrong")).toBeUndefined();
  });

  it("skips check when ownerTitle is null (gender unspecified)", () => {
    const v = validateAIResponse({
      ...BASE,
      ownerTitle: null,
      ownerFirstName: "Joana",
      reply: "O Dr. Joana atende de seg a sex.",
    });
    expect(v.find((x) => x.type === "owner_title_wrong")).toBeUndefined();
  });
});

describe("validateAIResponse — price_invented", () => {
  it("flags price not in consultationFee/procedurePrices", () => {
    const v = validateAIResponse({
      ...BASE,
      consultationFee: "150.00",
      procedurePrices: [250],
      reply: "Fica R$ 999 a consulta.",
    });
    expect(v.find((x) => x.type === "price_invented")).toBeDefined();
  });

  it("does NOT flag when price matches consultationFee", () => {
    const v = validateAIResponse({
      ...BASE,
      consultationFee: "150.00",
      reply: "A consulta fica R$ 150.",
    });
    expect(v.find((x) => x.type === "price_invented")).toBeUndefined();
  });

  it("does NOT flag when price matches a procedure price", () => {
    const v = validateAIResponse({
      ...BASE,
      consultationFee: null,
      procedurePrices: [350],
      reply: "Esse procedimento fica R$ 350.",
    });
    expect(v.find((x) => x.type === "price_invented")).toBeUndefined();
  });
});

describe("validateAIResponse — no violations", () => {
  it("returns [] for a clean reply", () => {
    const v = validateAIResponse({
      ...BASE,
      reply: "Oi Maria! Posso te encaixar Seg 09:00 ou Ter 14:00. Qual prefere?",
    });
    expect(v).toEqual([]);
  });
});

describe("buildCorrectionHint", () => {
  it("includes all violation types and details", () => {
    const hint = buildCorrectionHint([
      { type: "triage_ignored", detail: "X" },
      { type: "time_outside_agenda", detail: "Y" },
    ]);
    expect(hint).toContain("CORREÇÃO NECESSÁRIA");
    expect(hint).toContain("[triage_ignored]");
    expect(hint).toContain("[time_outside_agenda]");
    expect(hint).toContain("X");
    expect(hint).toContain("Y");
  });
});

describe("deterministicFallback", () => {
  it("returns triage question when triage_ignored", () => {
    const fb = deterministicFallback([{ type: "triage_ignored", detail: "" }]);
    expect(fb).toMatch(/plano|conv[eê]nio|particular/i);
  });
  it("returns triage question for time_outside_agenda when triage IS pending", () => {
    const fb = deterministicFallback(
      [{ type: "time_outside_agenda", detail: "" }],
      { triagePending: true },
    );
    expect(fb).toMatch(/plano|conv[eê]nio|particular/i);
  });
  it("returns 'check agenda' for time_outside_agenda when triage NOT pending", () => {
    const fb = deterministicFallback(
      [{ type: "time_outside_agenda", detail: "" }],
      { triagePending: false },
    );
    expect(fb.toLowerCase()).toMatch(/agenda|hor[áa]rio/);
    expect(fb).not.toMatch(/plano|conv[eê]nio/i);
  });
  it("returns confirm-with-clinic when procedure_not_listed", () => {
    const fb = deterministicFallback([{ type: "procedure_not_listed", detail: "" }]);
    expect(fb.toLowerCase()).toContain("clínica");
  });
  it("returns price-confirm when price_invented", () => {
    const fb = deterministicFallback([{ type: "price_invented", detail: "" }]);
    expect(fb.toLowerCase()).toMatch(/valor|confirm/);
  });
});

describe("parseMoney — canonical BRL/US numeric parser", () => {
  it("parses BR thousand format '1.500,00' → 1500", () => {
    expect(parseMoney("1.500,00")).toBe(1500);
  });
  it("parses BR thousand without decimal '1.500' → 1500", () => {
    expect(parseMoney("1.500")).toBe(1500);
  });
  it("parses US decimal '1500.00' → 1500", () => {
    expect(parseMoney("1500.00")).toBe(1500);
  });
  it("parses simple int '1500' → 1500", () => {
    expect(parseMoney("1500")).toBe(1500);
  });
  it("parses comma decimal '150,5' → 150.5", () => {
    expect(parseMoney("150,5")).toBe(150.5);
  });
  it("returns null for empty/invalid", () => {
    expect(parseMoney("")).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney("abc")).toBeNull();
  });
  it("passes through numeric input", () => {
    expect(parseMoney(150)).toBe(150);
    expect(parseMoney(1500.5)).toBe(1500.5);
  });
});

describe("validateAIResponse — price_invented with BRL formatting", () => {
  it("does NOT flag 'R$ 1.500,00' when consultationFee is the BR string '1.500,00'", () => {
    const v = validateAIResponse({
      ...BASE,
      consultationFee: "1.500,00",
      procedurePrices: [],
      reply: "A consulta fica R$ 1.500,00.",
    });
    expect(v.find((x) => x.type === "price_invented")).toBeUndefined();
  });
  it("does NOT flag when procedure price comes as BR string and reply uses BR format", () => {
    const v = validateAIResponse({
      ...BASE,
      consultationFee: null,
      procedurePrices: [parseMoney("2.500,00") as number],
      reply: "Esse procedimento fica R$ 2.500,00.",
    });
    expect(v.find((x) => x.type === "price_invented")).toBeUndefined();
  });
});

describe("validateAIResponse — policy_violation", () => {
  it("flags 'consulta gratuita' when chargesConsultation=true", () => {
    const v = validateAIResponse({
      ...BASE,
      reply: "A primeira consulta é gratuita, pode vir sem custo!",
      chargesConsultation: true,
    });
    expect(v.map((x) => x.type)).toContain("policy_violation");
  });

  it("does NOT flag 'consulta gratuita' when chargesConsultation=false", () => {
    const v = validateAIResponse({
      ...BASE,
      reply: "A primeira consulta é gratuita!",
      chargesConsultation: false,
    });
    expect(v.find((x) => x.type === "policy_violation")).toBeUndefined();
  });

  it("flags promise to accept insurance when acceptsInsurance=false", () => {
    const v = validateAIResponse({
      ...BASE,
      reply: "Sim, aceitamos plano Amil sem problema",
      acceptsInsurance: false,
    });
    expect(v.map((x) => x.type)).toContain("policy_violation");
  });

  it("flags insurance plan not in tenant list", () => {
    const v = validateAIResponse({
      ...BASE,
      reply: "Atendemos sim pelo Amil!",
      acceptsInsurance: true,
      insurancePlans: "Unimed, Bradesco Saúde",
    });
    expect(v.map((x) => x.type)).toContain("policy_violation");
  });

  it("does NOT flag insurance plan that IS in tenant list", () => {
    const v = validateAIResponse({
      ...BASE,
      reply: "Atendemos pela Unimed sim!",
      acceptsInsurance: true,
      insurancePlans: "Unimed, Bradesco",
    });
    expect(v.find((x) => x.type === "policy_violation")).toBeUndefined();
  });

  it("flags payment method not in paymentMethods list", () => {
    const v = validateAIResponse({
      ...BASE,
      reply: "Aceitamos boleto sem problema",
      paymentMethods: "PIX, Cartão",
    });
    expect(v.map((x) => x.type)).toContain("policy_violation");
  });

  it("does NOT flag payment method that IS in paymentMethods list", () => {
    const v = validateAIResponse({
      ...BASE,
      reply: "Aceitamos PIX sim!",
      paymentMethods: "PIX, Cartão",
    });
    expect(v.find((x) => x.type === "policy_violation")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task #20 — dropped_professional_mentioned
// Cobre o caso real onde o paciente diz "dente torto" (ortodontia) e a IA,
// influenciada pelo histórico, oferece o Dr. Robertino (implantodontista),
// que foi explicitamente filtrado pelo specialty-router para esse turno.
// ─────────────────────────────────────────────────────────────────────────────
describe("validateAIResponse — dropped_professional_mentioned (Task #20)", () => {
  it("flags reply mentioning a dropped professional by full first name", () => {
    const v = validateAIResponse({
      ...BASE,
      reply: "Pra convênio a gente atende com o Dr. Robertino Oliveira. Posso te passar um horário?",
      droppedProfessionalNames: ["Robertino Oliveira"],
      keptProfessionalNames: ["Siverino Braga"],
      detectedSpecialtyLabels: ["ortodontia"],
    });
    expect(v.map((x) => x.type)).toContain("dropped_professional_mentioned");
  });

  it("flags 'Dr. Robertin Oliveira' (typo) — match by 6-char stem", () => {
    const v = validateAIResponse({
      ...BASE,
      reply: "Pra convênio a gente atende com o Dr. Robertin Oliveira.",
      droppedProfessionalNames: ["Robertino Oliveira"],
      keptProfessionalNames: ["Siverino Braga"],
      detectedSpecialtyLabels: ["ortodontia"],
    });
    expect(v.map((x) => x.type)).toContain("dropped_professional_mentioned");
  });

  it("does NOT flag when reply only mentions a kept professional", () => {
    const v = validateAIResponse({
      ...BASE,
      reply: "Para ortodontia a gente atende com o Dr. Siverino Braga. Posso te passar horário?",
      droppedProfessionalNames: ["Robertino Oliveira"],
      keptProfessionalNames: ["Siverino Braga"],
      detectedSpecialtyLabels: ["ortodontia"],
    });
    expect(v.find((x) => x.type === "dropped_professional_mentioned")).toBeUndefined();
  });

  it("does NOT flag when droppedProfessionalNames is empty", () => {
    const v = validateAIResponse({
      ...BASE,
      reply: "Pode ser com o Dr. Robertino se preferir.",
      droppedProfessionalNames: [],
      keptProfessionalNames: ["Robertino Oliveira"],
    });
    expect(v.find((x) => x.type === "dropped_professional_mentioned")).toBeUndefined();
  });

  it("does NOT flag when kept and dropped share first-name stem", () => {
    // Kept = "Roberta Souza" (estem 'robert'); dropped = "Roberto Almeida" (also 'robert').
    // Para evitar falso positivo, o validador pula stems que coincidam com um
    // nome permitido — fica a cargo do operador desambiguar nesses casos raros.
    const v = validateAIResponse({
      ...BASE,
      reply: "Marquei com a Dra. Roberta Souza, ok?",
      droppedProfessionalNames: ["Roberto Almeida"],
      keptProfessionalNames: ["Roberta Souza"],
      detectedSpecialtyLabels: ["ortodontia"],
    });
    expect(v.find((x) => x.type === "dropped_professional_mentioned")).toBeUndefined();
  });

  it("regressão Task #20: cenário 'dente torto' → reply oferecendo Robertino é flag", () => {
    // Reproduz o bug observado: paciente convênio, histórico cheio de respostas
    // anteriores oferecendo o Dr. Robertino (implante/PIX), nova msg "dente torto"
    // → routing manda só Siverino, mas a IA "lembra" do Robertino e o oferece.
    const reply =
      "Entendi, José. Pra convênio a gente atende com o Dr. Robertin Oliveira. Posso te passar um horário na próxima semana, pode ser?";
    const v = validateAIResponse({
      ...BASE,
      reply,
      mode: "CONVENIO_AGENDAR",
      isInsuranceContact: true,
      droppedProfessionalNames: ["Robertino Oliveira"],
      keptProfessionalNames: ["Dr Siverino Braga"],
      detectedSpecialtyLabels: ["ortodontia"],
    });
    const types = v.map((x) => x.type);
    expect(types).toContain("dropped_professional_mentioned");
    // Verifica também que o detail nomeia o profissional vazado para auditoria.
    const dropV = v.find((x) => x.type === "dropped_professional_mentioned");
    expect(dropV?.detail).toMatch(/Robertino/);
  });
});

describe("deterministicFallback — dropped_professional_mentioned (Task #20)", () => {
  it("retorna mensagem segura sem nomear nenhum profissional", () => {
    const fb = deterministicFallback([
      { type: "dropped_professional_mentioned", detail: "Mencionou Robertino" },
    ]);
    expect(fb).not.toMatch(/Robertin|Siverin/i);
    expect(fb.toLowerCase()).toMatch(/clínica|clinica/);
  });
});

describe("validateAIResponse — procedure_not_listed with EMPTY catalog", () => {
  it("flags any specific dental procedure when tenant catalog is empty", () => {
    const v = validateAIResponse({
      ...BASE,
      procedureNames: [],
      reply: "Sim, fazemos clareamento a laser!",
    });
    expect(v.find((x) => x.type === "procedure_not_listed")).toBeDefined();
  });
  it("does NOT flag generic chitchat with empty catalog", () => {
    const v = validateAIResponse({
      ...BASE,
      procedureNames: [],
      reply: "Oi, tudo bem? Como posso te ajudar?",
    });
    expect(v.find((x) => x.type === "procedure_not_listed")).toBeUndefined();
  });
});
