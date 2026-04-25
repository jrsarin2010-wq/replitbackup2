/**
 * Task #25 — Suite golden para o caminho de constrained generation.
 *
 * Cobre as 3 camadas que NÃO dependem de chamada à OpenAI:
 *   1. Schema dinâmico (buildResponseSchema) — enums refletem slots/profs reais.
 *   2. Render layer (renderStructuredResponse) — cada ação produz texto correto
 *      com data/hora/preço/PIX injetados deterministicamente pelo servidor.
 *   3. Validador fino (validateConstrainedReply) — só termos comerciais
 *      proibidos em convênio são reportados.
 *
 * 6 cenários golden representam regressões reais:
 *   - Bradesco em dia errado (convênio NÃO recebe SEND_PIX/SEND_FEE).
 *   - Multi-pro: prof certo é injetado no texto.
 *   - PIX omitido (sem chave configurada): degrada gracioso.
 *   - Valor inventado: server NUNCA permite IA escrever R$.
 *   - Pro fora da especialidade: schema rejeita ID inválido (impossibilidade).
 *   - Primeiro contato SPIN: ação ASK_INFO, sem agenda.
 */

import { describe, it, expect } from "vitest";
import {
  assignSlotIds,
  assignProfessionalIds,
  buildResponseSchema,
  formatSlotLabel,
  formatSlotForReply,
  type StructuredAIResponse,
} from "../lib/constrained-output";
import {
  renderStructuredResponse,
  type RenderContext,
  type RenderableProfessional,
} from "../lib/structured-renderer";
import { validateConstrainedReply } from "../lib/response-validator";
import type { AvailableSlot } from "../lib/schedule-engine";

// ─────────────────────────────────────────────────────────────────────────
// Fixtures comuns
// ─────────────────────────────────────────────────────────────────────────

const SLOTS: AvailableSlot[] = [
  { date: "2026-04-27", time: "09:00", professionalId: 1 },
  { date: "2026-04-27", time: "14:00", professionalId: 1 },
  { date: "2026-04-28", time: "10:30", professionalId: 2 },
  { date: "2026-04-29", time: "16:00", professionalId: 2 },
] as AvailableSlot[];

const PROS: RenderableProfessional[] = [
  {
    id: 1,
    name: "Dr. Carlos",
    pixEnabled: true,
    pixKey: "12345678900",
    pixBank: "Itau",
    pixKeyType: "cpf",
    pixMode: "optional",
    consultationFee: "200",
    chargesConsultation: true,
  },
  {
    id: 2,
    name: "Dra. Ana",
    pixEnabled: false,
    pixKey: null,
    pixBank: null,
    pixKeyType: null,
    pixMode: null,
    consultationFee: "350",
    chargesConsultation: true,
  },
];

function buildCtx(overrides: Partial<RenderContext> = {}): RenderContext {
  const slotsWithIds = assignSlotIds(SLOTS, PROS.map((p) => ({ id: p.id, name: p.name })));
  const profsWithIds = assignProfessionalIds(PROS.map((p) => ({ id: p.id, name: p.name })));
  return {
    slots: slotsWithIds,
    professionals: profsWithIds,
    professionalsFull: PROS,
    isInsuranceContact: false,
    settingsConsultationFee: null,
    settingsChargesConsultation: null,
    clinicName: "Clinica Teste",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Schema
// ─────────────────────────────────────────────────────────────────────────

describe("constrained-output / buildResponseSchema", () => {
  it("gera enums de slot_ids alinhados com os IDs atribuidos", () => {
    const slotsWithIds = assignSlotIds(SLOTS, PROS.map((p) => ({ id: p.id, name: p.name })));
    const profsWithIds = assignProfessionalIds(PROS.map((p) => ({ id: p.id, name: p.name })));
    const schema = buildResponseSchema(slotsWithIds, profsWithIds);

    const slotEnum = (schema.json_schema.schema.properties.slot_ids as { items: { enum: string[] } }).items.enum;
    expect(slotEnum).toEqual(["s1", "s2", "s3", "s4"]);

    const profAnyOf = (schema.json_schema.schema.properties.professional_id as { anyOf: Array<{ enum?: string[] }> }).anyOf;
    expect(profAnyOf[0].enum).toEqual(["p1", "p2"]);

    expect(schema.json_schema.strict).toBe(true);
    expect(schema.json_schema.schema.additionalProperties).toBe(false);
  });

  it("aceita listas vazias sem quebrar (degrada para enum [''])", () => {
    const schema = buildResponseSchema([], []);
    const slotEnum = (schema.json_schema.schema.properties.slot_ids as { items: { enum: string[] } }).items.enum;
    expect(slotEnum).toEqual([""]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. Renderer
// ─────────────────────────────────────────────────────────────────────────

describe("structured-renderer / OFFER_SLOTS", () => {
  it("injeta data/hora/profissional no texto quando o LLM omite (1 slot)", () => {
    const parsed: StructuredAIResponse = {
      action: "OFFER_SLOTS",
      slot_ids: ["s1"],
      professional_id: "p1",
      reply_text: "Entendi, dor incomoda mesmo.",
    };
    const r = renderStructuredResponse(parsed, buildCtx());
    expect(r.text).toContain("Dr. Carlos");
    expect(r.text).toMatch(/09h/);
    expect(r.text).toContain("Confirmo pra voce?");
    expect(r.shouldCreateAppointment).toBe(false);
  });

  it("injeta os 2 slots quando o LLM oferta 2", () => {
    const parsed: StructuredAIResponse = {
      action: "OFFER_SLOTS",
      slot_ids: ["s1", "s3"],
      professional_id: null,
      reply_text: "",
    };
    const r = renderStructuredResponse(parsed, buildCtx());
    expect(r.text).toContain("Dr. Carlos");
    expect(r.text).toContain("Dra. Ana");
    expect(r.text).toMatch(/09h/);
    expect(r.text).toMatch(/10h30/);
    expect(r.text).toContain("Qual fica melhor?");
  });

  it("ignora slot_id invalido (impossivel via schema strict, mas teste robusto)", () => {
    const parsed: StructuredAIResponse = {
      action: "OFFER_SLOTS",
      slot_ids: ["s99"],
      professional_id: null,
      reply_text: "Olha so",
    };
    const r = renderStructuredResponse(parsed, buildCtx());
    // Sem slot resolvido → degrada para fallback empático.
    expect(r.text).not.toMatch(/\d{2}h/);
  });
});

describe("structured-renderer / CONFIRM_SLOT", () => {
  it("emite APT_CARD com data/dia da semana corretos e marca para criacao", () => {
    const parsed: StructuredAIResponse = {
      action: "CONFIRM_SLOT",
      slot_ids: ["s2"],
      professional_id: "p1",
      reply_text: "",
    };
    const r = renderStructuredResponse(parsed, buildCtx());
    expect(r.shouldCreateAppointment).toBe(true);
    expect(r.chosenSlot?.date).toBe("2026-04-27");
    expect(r.chosenSlot?.time).toBe("14:00");
    expect(r.text).toContain("[APT_CARD:");
    expect(r.text).toMatch(/27\/04/);
    expect(r.text).toMatch(/14h/);
  });

  it("nao cria agendamento se LLM esquecer slot_id", () => {
    const parsed: StructuredAIResponse = {
      action: "CONFIRM_SLOT",
      slot_ids: [],
      professional_id: "p1",
      reply_text: "Confirma o horario que voce quer?",
    };
    const r = renderStructuredResponse(parsed, buildCtx());
    expect(r.shouldCreateAppointment).toBe(false);
    expect(r.text).not.toContain("[APT_CARD:");
  });
});

describe("structured-renderer / SEND_PIX", () => {
  it("injeta o card PIX completo do profissional escolhido", () => {
    const parsed: StructuredAIResponse = {
      action: "SEND_PIX",
      slot_ids: [],
      professional_id: "p1",
      reply_text: "",
    };
    const r = renderStructuredResponse(parsed, buildCtx());
    expect(r.text).toContain("DADOS PARA PAGAMENTO PIX");
    expect(r.text).toContain("Dr. Carlos");
    expect(r.text).toContain("12345678900");
    expect(r.text).toContain("R$ 200");
  });

  it("convenio NUNCA recebe PIX — degrada para mensagem segura", () => {
    const parsed: StructuredAIResponse = {
      action: "SEND_PIX",
      slot_ids: [],
      professional_id: "p1",
      reply_text: "",
    };
    const r = renderStructuredResponse(parsed, buildCtx({ isInsuranceContact: true }));
    expect(r.text).not.toContain("DADOS PARA PAGAMENTO PIX");
    expect(r.text).not.toContain("12345678900");
    expect(r.text.toLowerCase()).toMatch(/convenio|coberto/);
  });

  it("profissional sem PIX configurado degrada gracioso (sem expor card errado)", () => {
    const parsed: StructuredAIResponse = {
      action: "SEND_PIX",
      slot_ids: [],
      professional_id: "p2",
      reply_text: "",
    };
    // p2 (Dra. Ana) tem pixEnabled=false e sem chave. O renderer NÃO inventa
    // um card nem cobra com a chave de outro profissional — degrada para uma
    // mensagem segura. Esse é o comportamento desejado: nunca expor PIX errado.
    const r = renderStructuredResponse(parsed, buildCtx());
    expect(r.text).not.toContain("12345678900");
    expect(r.text).not.toContain("DADOS PARA PAGAMENTO PIX");
    expect(r.text.toLowerCase()).toMatch(/clinica|confirmar/);
  });

  it("sem professional_id explicito: usa primeiro prof com PIX habilitado", () => {
    const parsed: StructuredAIResponse = {
      action: "SEND_PIX",
      slot_ids: [],
      professional_id: null,
      reply_text: "",
    };
    const r = renderStructuredResponse(parsed, buildCtx());
    expect(r.text).toContain("Dr. Carlos");
    expect(r.text).toContain("12345678900");
  });
});

describe("structured-renderer / SEND_FEE", () => {
  it("injeta R$ do profissional cobrado", () => {
    const parsed: StructuredAIResponse = {
      action: "SEND_FEE",
      slot_ids: [],
      professional_id: "p2",
      reply_text: "Sem problema.",
    };
    const r = renderStructuredResponse(parsed, buildCtx());
    expect(r.text).toContain("R$ 350");
  });

  it("convenio NUNCA recebe valor — degrada para mensagem de cobertura", () => {
    const parsed: StructuredAIResponse = {
      action: "SEND_FEE",
      slot_ids: [],
      professional_id: "p1",
      reply_text: "",
    };
    const r = renderStructuredResponse(parsed, buildCtx({ isInsuranceContact: true }));
    expect(r.text).not.toMatch(/R\$\s*\d/);
    expect(r.text.toLowerCase()).toMatch(/convenio|coberto/);
  });
});

describe("structured-renderer / ASK_INFO + ESCALATE + JUST_REPLY", () => {
  it("ASK_INFO devolve reply_text como esta (sem injetar nada)", () => {
    const parsed: StructuredAIResponse = {
      action: "ASK_INFO",
      slot_ids: [],
      professional_id: null,
      reply_text: "Voce vai usar plano ou e particular?",
    };
    const r = renderStructuredResponse(parsed, buildCtx());
    expect(r.text).toBe("Voce vai usar plano ou e particular?");
    expect(r.shouldCreateAppointment).toBe(false);
  });

  it("ESCALATE devolve mensagem de transferencia humana se reply vazio", () => {
    const parsed: StructuredAIResponse = {
      action: "ESCALATE",
      slot_ids: [],
      professional_id: null,
      reply_text: "",
    };
    const r = renderStructuredResponse(parsed, buildCtx());
    expect(r.text.toLowerCase()).toMatch(/equipe|atender|aguard/);
  });

  it("JUST_REPLY devolve reply_text puro", () => {
    const parsed: StructuredAIResponse = {
      action: "JUST_REPLY",
      slot_ids: [],
      professional_id: null,
      reply_text: "Que bom saber!",
    };
    const r = renderStructuredResponse(parsed, buildCtx());
    expect(r.text).toBe("Que bom saber!");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. Validador fino
// ─────────────────────────────────────────────────────────────────────────

describe("response-validator / validateConstrainedReply", () => {
  it("particular: nenhuma violacao mesmo com termos de venda", () => {
    const v = validateConstrainedReply(
      "Esta e uma oportunidade unica! Garanta ja sua vaga.",
      { isInsuranceContact: false },
    );
    expect(v).toEqual([]);
  });

  it("convenio: termos de venda agressivos sao reportados", () => {
    const v = validateConstrainedReply(
      "Esta e uma oportunidade unica, nao perca a vaga, aproveite!",
      { isInsuranceContact: true },
    );
    expect(v.length).toBeGreaterThan(0);
    expect(v.every((x) => x.type === "insurance_sales_term")).toBe(true);
  });

  it("convenio sem termos proibidos: sem violacoes", () => {
    const v = validateConstrainedReply(
      "Tudo certo, ja deixei reservado pra voce. Te espero!",
      { isInsuranceContact: true },
    );
    expect(v).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. Helpers de formatacao
// ─────────────────────────────────────────────────────────────────────────

describe("constrained-output / formatadores", () => {
  it("formatSlotLabel produz rotulo curto correto", () => {
    const label = formatSlotLabel({ date: "2026-04-27", time: "14:30", professionalId: 1 } as AvailableSlot, "Dr. Carlos");
    expect(label).toContain("27/04");
    expect(label).toContain("14h30");
    expect(label).toContain("Dr. Carlos");
  });

  it("formatSlotForReply usa formato humano de reply", () => {
    const out = formatSlotForReply({ date: "2026-04-27", time: "09:00", professionalId: 1 } as AvailableSlot, "Dr. Carlos");
    expect(out).toMatch(/09h/);
    expect(out).toContain("Dr. Carlos");
    expect(out).toContain("as ");
  });
});
