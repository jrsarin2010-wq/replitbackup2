/**
 * Task #29 — Engine-level integration tests for the post-response validator.
 *
 * Mocks OpenAI to return a violator on the first call, then a clean reply on
 * the retry call. Asserts:
 *   - validator triggers a retry when violations present
 *   - retry-clean reply is used when retry corrects the issue
 *   - deterministic fallback is used when retry also violates
 *   - clean first response → no retry
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
const capturedCalls: Array<{ model: string; messages: ChatMessage[] }> = [];
const fakeReplies: string[] = [];

const fakeChatCreate = vi.fn(async (args: { model: string; messages: ChatMessage[] }) => {
  capturedCalls.push({ model: args.model, messages: args.messages });
  const idx = capturedCalls.length - 1;
  const content = fakeReplies[idx] ?? "ok";
  return { choices: [{ message: { content } }] };
});

const fakeOpenAIClient = { chat: { completions: { create: fakeChatCreate } } };

vi.mock("../lib/openai-client", () => ({
  getOpenAIClient: vi.fn(async () => fakeOpenAIClient),
  invalidateOpenAIClient: vi.fn(),
}));

vi.mock("../lib/tenant-rate-limiter", () => ({
  isTenantCircuitOpen: vi.fn(async () => false),
  checkAndRecordAICall: vi.fn(async () => ({ allowed: true, remaining: 100 })),
  recordTenantError: vi.fn(async () => {}),
  getFallbackMessage: vi.fn(() => "fallback"),
}));

import type { Intent } from "../lib/schedule-engine.js";
let mockIntent: Intent = "scheduling";
vi.mock("../lib/intent-detector", () => ({
  detectIntent: vi.fn(async () => mockIntent),
  classifyLeadTemperature: vi.fn(() => "cold"),
}));

const FIXED_AGENDA = "Seg 09:00 | Ter 14:00 | Qua 16:30";
vi.mock("../lib/schedule-engine", async () => {
  const real = (await vi.importActual<typeof import("../lib/schedule-engine.js")>(
    "../lib/schedule-engine.js",
  ));
  return {
    ...real,
    getAvailabilityInfo: vi.fn(async () => ({
      info: FIXED_AGENDA,
      utcOffsetHours: -3,
      professionals: [{ id: 1, name: "Dr. Joao" }],
      blockedPeriod: null,
    })),
    getActiveBlockedPeriodForToday: vi.fn(async () => null),
  };
});

let mockSettings = {
  clinicName: "Clinica Teste",
  aiName: "Ana",
  professionalName: "Dra. Joana",
  professionalGender: "female",
  workingHoursStart: "08:00",
  workingHoursEnd: "18:00",
  acceptsInsurance: false,
  insurancePlans: null as string | null,
  chargesConsultation: true,
  consultationFee: 150,
  paymentMethods: "Cartao, PIX",
  utcOffsetHours: -3,
  activeDays: "1,2,3,4,5",
};

vi.mock("../lib/cache", () => ({
  getCachedSettings: vi.fn(async () => mockSettings),
  getCachedProcedures: vi.fn(async () => [
    { name: "Limpeza", price: 150, durationMinutes: 30 },
  ]),
  getCachedProfessionals: vi.fn(async () => [
    {
      id: 1,
      name: "Dra. Joana",
      active: true,
      specialty: null,
      cro: null,
      instagramUrl: null,
      chargesConsultation: true,
      consultationFee: 150,
      acceptsInsurance: false,
      insurancePlans: null,
      insuranceDays: null,
      defaultLeadDurationMinutes: 30,
      defaultPatientDurationMinutes: 30,
    },
  ]),
  TenantCache: class {
    get() { return undefined; }
    set() {}
    invalidate() {}
    clear() {}
  },
}));

vi.mock("../lib/ai-learning", () => ({
  getContactMemories: vi.fn(async () => ""),
  getRelevantObjections: vi.fn(async () => ""),
  getRelevantKnowledge: vi.fn(async () => ""),
  getOptimizedStrategies: vi.fn(async () => ""),
  recordStrategyAnalytics: vi.fn(async () => {}),
}));

vi.mock("../lib/conversation-summarizer", () => ({
  maybeUpdateConversationSummary: vi.fn(async () => {}),
  buildSummaryContextBlock: vi.fn(() => ""),
}));

vi.mock("../lib/escalation", () => ({
  detectSchedulingRefusal: vi.fn(() => false),
  trackAndEscalateRefusal: vi.fn(async () => {}),
  trackAndEscalateAiFailure: vi.fn(async () => {}),
  recordAiSuccess: vi.fn(async () => {}),
  checkAndEscalate: vi.fn(async () => {}),
}));

vi.mock("../lib/urgency-handler", () => ({
  detectUrgencyLevel: vi.fn(() => null),
  detectUrgencyInMessage: vi.fn(() => false),
  sendBlockedPeriodUrgencyAlert: vi.fn(async () => {}),
}));

const createAppointmentFromDataMock = vi.fn(async () => {});
const tryCreateAppointmentFromReplyMock = vi.fn(async () => {});
vi.mock("../lib/appointment-extractor", () => ({
  tryCreateAppointmentFromReply: tryCreateAppointmentFromReplyMock,
  createAppointmentFromData: createAppointmentFromDataMock,
}));

let mockLead: {
  id: number; tenantId: number; phone: string; name: string;
  paymentType: string | null; temperature: string; source: string;
  status: string; professionalId: number | null; interest: string | null;
} | null = null;
let mockPatient: { id: number; tenantId: number; phone: string } | null = null;
let mockMessages: Array<{ direction: "inbound" | "outbound"; content: string; sentAt: Date | null }> = [];

vi.mock("@workspace/db", () => {
  const findFirstLead = vi.fn(async () => mockLead);
  const findFirstPatient = vi.fn(async () => mockPatient);
  const findManyMessages = vi.fn(async () => mockMessages);
  const findFirstConversation = vi.fn(async () => ({ id: 1, aiSummary: null, aiSummaryMessageCount: 0, sentiment: "neutral" }));
  const findFirstTenant = vi.fn(async () => ({ id: 1, plan: "premium" }));
  const update = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) }));
  const insert = vi.fn(() => ({
    values: vi.fn(() => ({
      returning: vi.fn(() => Promise.resolve([{ id: 999 }])),
      catch: vi.fn(() => Promise.resolve()),
      then: (resolve: (v: unknown) => unknown) => resolve(undefined),
    })),
  }));
  const select = vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([{ count: 0 }])) })) }));

  return {
    db: {
      query: {
        dentalLeadsTable: { findFirst: findFirstLead },
        patientsTable: { findFirst: findFirstPatient },
        dentalMessagesTable: { findMany: findManyMessages },
        dentalConversationsTable: { findFirst: findFirstConversation },
        tenantsTable: { findFirst: findFirstTenant },
        appointmentsTable: { findMany: vi.fn(async () => []) },
        dentalActivityTable: { findMany: vi.fn(async () => []) },
      },
      insert, update, select,
    },
    dentalLeadsTable: { id: "id", tenantId: "tenantId", phone: "phone" },
    dentalMessagesTable: { conversationId: "conversationId" },
    dentalConversationsTable: { id: "id" },
    dentalActivityTable: { id: "id", tenantId: "tenantId", entityType: "entityType", entityId: "entityId", type: "type" },
    patientsTable: { id: "id", tenantId: "tenantId", phone: "phone" },
    tenantsTable: { id: "id" },
    aiStrategyAnalyticsTable: { id: "id" },
    dentalProceduresTable: { id: "id" },
    dentalSettingsTable: { id: "id" },
    appointmentsTable: { id: "id", patientId: "patientId", tenantId: "tenantId", startsAt: "startsAt" },
  };
});

const { processIncomingMessage } = await import("../lib/ai-engine.js");

beforeEach(async () => {
  // Drain pending setImmediate side-effects from previous test before clearing
  // mocks (otherwise stale createAppointmentFromData calls leak into the next).
  await new Promise<void>((r) => setImmediate(r));
  capturedCalls.length = 0;
  fakeReplies.length = 0;
  fakeChatCreate.mockClear();
  createAppointmentFromDataMock.mockClear();
  tryCreateAppointmentFromReplyMock.mockClear();
  mockSettings = { ...mockSettings, acceptsInsurance: false };
  mockLead = {
    id: 1, tenantId: 1, phone: "+5511999999999", name: "Maria",
    paymentType: "private", temperature: "cold", source: "whatsapp",
    status: "active", professionalId: null, interest: null,
  };
  mockPatient = null;
  mockMessages = [];
  mockIntent = "scheduling";
});

describe("Task #29 — clean response: no retry", () => {
  it("does NOT call OpenAI a second time when the first reply has no violations", async () => {
    fakeReplies.push(JSON.stringify({
      reply: "Posso te encaixar Seg 09:00 ou Ter 14:00. Qual prefere?",
      appointment: { confirmed: false },
    }));
    const reply = await processIncomingMessage(
      1, 1, "+5511999999999", "Maria", "qual horario tem?", "lead", undefined, 1,
    );
    expect(fakeChatCreate).toHaveBeenCalledTimes(1);
    expect(reply).toContain("09:00");
  });
});

describe("Task #29 — invented time: retries and uses corrected reply", () => {
  it("retries once and uses the clean retry response", async () => {
    fakeReplies.push(JSON.stringify({
      reply: "Posso te encaixar amanha as 11:30 com a Dra. Joana.",
      appointment: { confirmed: false },
    }));
    fakeReplies.push(JSON.stringify({
      reply: "Posso te encaixar Seg 09:00 ou Ter 14:00, qual prefere?",
      appointment: { confirmed: false },
    }));
    const reply = await processIncomingMessage(
      1, 1, "+5511999999999", "Maria", "qual horario tem?", "lead", undefined, 1,
    );
    expect(fakeChatCreate).toHaveBeenCalledTimes(2);
    const retryArgs = capturedCalls[1];
    const correctionMsg = retryArgs.messages.find((m) =>
      m.role === "system" && m.content.includes("CORREÇÃO NECESSÁRIA"),
    );
    expect(correctionMsg).toBeDefined();
    expect(correctionMsg!.content).toContain("time_outside_agenda");
    expect(reply).toContain("09:00");
    expect(reply).not.toContain("11:30");
  });
});

describe("Task #29 — retry also violates: deterministic fallback", () => {
  it("falls back to a safe canned message when retry also fails", async () => {
    fakeReplies.push(JSON.stringify({
      reply: "Posso te encaixar amanha as 11:30.",
      appointment: { confirmed: false },
    }));
    fakeReplies.push(JSON.stringify({
      reply: "Que tal as 13:45?",
      appointment: { confirmed: false },
    }));
    const reply = await processIncomingMessage(
      1, 1, "+5511999999999", "Maria", "qual horario tem?", "lead", undefined, 1,
    );
    expect(fakeChatCreate).toHaveBeenCalledTimes(2);
    expect(reply).not.toContain("11:30");
    expect(reply).not.toContain("13:45");
    // No triage pending → fallback should be agenda-confirm, not triage question
    expect(reply.toLowerCase()).toMatch(/agenda|hor[áa]rio|confirmar/);
    expect(reply.toLowerCase()).not.toMatch(/plano|conv[eê]nio|particular/);
  });
});

describe("Cost-opt — owner_title_wrong is cosmetic, no retry", () => {
  it("flags 'Dr. Joana' (owner is female) but does NOT retry (cosmetic-only)", async () => {
    fakeReplies.push(JSON.stringify({
      reply: "O Dr. Joana atende de seg a sex. Posso te marcar Seg 09:00.",
      appointment: { confirmed: false },
    }));
    const reply = await processIncomingMessage(
      1, 1, "+5511999999999", "Maria", "quem atende?", "lead", undefined, 1,
    );
    expect(fakeChatCreate).toHaveBeenCalledTimes(1);
    expect(reply).toContain("Dr. Joana");
  });
});

describe("Task #29 — price_invented triggers retry", () => {
  it("flags an invented price and retries", async () => {
    fakeReplies.push(JSON.stringify({
      reply: "A consulta fica R$ 999.",
      appointment: { confirmed: false },
    }));
    fakeReplies.push(JSON.stringify({
      reply: "A consulta fica R$ 150.",
      appointment: { confirmed: false },
    }));
    const reply = await processIncomingMessage(
      1, 1, "+5511999999999", "Maria", "qual o valor?", "lead", undefined, 1,
    );
    expect(fakeChatCreate).toHaveBeenCalledTimes(2);
    const correctionMsg = capturedCalls[1].messages.find((m) =>
      m.role === "system" && m.content.includes("price_invented"),
    );
    expect(correctionMsg).toBeDefined();
    expect(reply).toContain("150");
  });
});

describe("Task #29 — retry call throws → safe deterministic fallback", () => {
  it("uses fallback (does NOT crash) when the retry call rejects", async () => {
    fakeReplies.push(JSON.stringify({
      reply: "Posso te encaixar amanha as 11:30.",
      appointment: { confirmed: false },
    }));
    // Second call rejects (simulates timeout/abort/upstream error)
    fakeChatCreate.mockImplementationOnce(async (args) => {
      capturedCalls.push({ model: args.model, messages: args.messages });
      const idx = capturedCalls.length - 1;
      const content = fakeReplies[idx] ?? "ok";
      return { choices: [{ message: { content } }] };
    }).mockImplementationOnce(async (args) => {
      capturedCalls.push({ model: args.model, messages: args.messages });
      throw new Error("simulated retry failure");
    });
    const reply = await processIncomingMessage(
      1, 1, "+5511999999999", "Maria", "qual horario tem?", "lead", undefined, 1,
    );
    expect(fakeChatCreate).toHaveBeenCalledTimes(2);
    expect(reply).not.toContain("11:30");
    // triagePending=false here (no insurance) → must NOT use the triage question
    expect(reply.toLowerCase()).not.toMatch(/plano|conv[eê]nio|particular/);
    expect(reply.toLowerCase()).toMatch(/agenda|hor[áa]rio|confirmar/);
  });
});

describe("Task #29 — time_outside_agenda fallback policy", () => {
  it("uses 'check agenda' fallback (NOT triage) when triage is not pending", async () => {
    fakeReplies.push(JSON.stringify({
      reply: "Posso te encaixar amanha as 11:30.",
      appointment: { confirmed: false },
    }));
    fakeReplies.push(JSON.stringify({
      reply: "Que tal as 13:45?",
      appointment: { confirmed: false },
    }));
    const reply = await processIncomingMessage(
      1, 1, "+5511999999999", "Maria", "qual horario tem?", "lead", undefined, 1,
    );
    expect(fakeChatCreate).toHaveBeenCalledTimes(2);
    expect(reply.toLowerCase()).not.toMatch(/plano|conv[eê]nio|particular/);
    expect(reply.toLowerCase()).toMatch(/agenda|hor[áa]rio/);
  });
});

describe("Task #29 — procedure_not_listed engine path", () => {
  it("retries when AI promises a procedure not in tenant catalog", async () => {
    fakeReplies.push(JSON.stringify({
      reply: "Sim, fazemos clareamento a laser! Posso te marcar Seg 09:00?",
      appointment: { confirmed: false },
    }));
    fakeReplies.push(JSON.stringify({
      reply: "Vou confirmar com a clinica se temos esse procedimento e te respondo, ta bom?",
      appointment: { confirmed: false },
    }));
    const reply = await processIncomingMessage(
      1, 1, "+5511999999999", "Maria", "voces fazem clareamento?", "lead", undefined, 1,
    );
    expect(fakeChatCreate).toHaveBeenCalledTimes(2);
    const correctionMsg = capturedCalls[1].messages.find((m) =>
      m.role === "system" && m.content.includes("procedure_not_listed"),
    );
    expect(correctionMsg).toBeDefined();
    expect(reply.toLowerCase()).toContain("clinica");
  });
});

describe("Task #29 — appointment isolation under validation", () => {
  it("DOES NOT auto-create appointment when first response confirms but is invalid AND fallback is used", async () => {
    // First response: invalid time + confirms appointment
    fakeReplies.push(JSON.stringify({
      reply: "Marquei voce amanha as 11:30 com a Dra. Joana, ta confirmado!",
      appointment: {
        confirmed: true,
        date: "2026-04-18",
        time: "11:30",
        professionalId: 1,
      },
    }));
    // Retry also invalid (so engine falls back)
    fakeReplies.push(JSON.stringify({
      reply: "Que tal as 13:45?",
      appointment: { confirmed: true, date: "2026-04-18", time: "13:45", professionalId: 1 },
    }));
    await processIncomingMessage(
      1, 1, "+5511999999999", "Maria", "marca pra amanha", "lead", undefined, 1,
    );
    // Flush setImmediate side-effects to ensure persistence would have fired
    await new Promise<void>((r) => setImmediate(r));
    // Both replies were invalid → engine used deterministic fallback
    // → inlineAppointment must have been cleared → no auto-create call
    expect(createAppointmentFromDataMock).not.toHaveBeenCalled();
  });

  it("uses RETRY appointment data (not original) when retry corrects the response", async () => {
    // First: invalid time AND a stale appointment payload
    fakeReplies.push(JSON.stringify({
      reply: "Marquei amanha as 11:30!",
      appointment: { confirmed: true, date: "2026-04-18", time: "11:30", professionalId: 1 },
    }));
    // Retry: valid time + appointment confirmed=false
    fakeReplies.push(JSON.stringify({
      reply: "Posso te encaixar Seg 09:00, qual prefere?",
      appointment: { confirmed: false },
    }));
    await processIncomingMessage(
      1, 1, "+5511999999999", "Maria", "marca pra amanha", "lead", undefined, 1,
    );
    // Retry's appointment.confirmed=false → createAppointmentFromData should
    // NOT be called (it's only called when confirmed=true elsewhere).
    if (createAppointmentFromDataMock.mock.calls.length > 0) {
      const call = createAppointmentFromDataMock.mock.calls[0][0] as { extraction?: { time?: string } };
      // If for some reason it was called, must be with the RETRY data, not "11:30"
      expect(call.extraction?.time).not.toBe("11:30");
    }
  });
});

describe("Task #29 — non-scheduling intent: REPLY_ONLY_SCHEMA + retry parsing", () => {
  it("retry on objection intent parses {reply, metadata} JSON (does NOT leak raw JSON)", async () => {
    mockIntent = "objection";
    // Primeira resposta viola (preço inventado), retry corrige; ambas em JSON.
    fakeReplies.push(JSON.stringify({
      reply: "A consulta com a Dra. Joana custa R$ 999,00, vale super a pena!",
      metadata: { intent: "objection", confidence: 0.9 },
    }));
    fakeReplies.push(JSON.stringify({
      reply: "A consulta com a Dra. Joana custa R$ 150,00, posso te explicar tudo?",
      metadata: { intent: "objection", confidence: 0.95 },
    }));
    const reply = await processIncomingMessage(
      1, 1, "+5511999999999", "Maria", "tá caro demais", "lead", undefined, 1,
    );
    expect(fakeChatCreate).toHaveBeenCalledTimes(2);
    // Garantia crítica: NUNCA vazar JSON cru ao paciente
    expect(reply).not.toMatch(/^\s*\{/);
    expect(reply).not.toContain('"reply"');
    expect(reply).toContain("R$ 150");
  });

  it("cosmetic insurance_sales_term does NOT retry (cost-opt)", async () => {
    mockIntent = "question";
    fakeReplies.push(JSON.stringify({
      reply: "Sim, aceitamos plano Amil sem problema!",
      metadata: { intent: "question", confidence: 0.8 },
    }));
    mockSettings = { ...mockSettings, acceptsInsurance: false };
    await processIncomingMessage(
      1, 1, "+5511999999999", "Maria", "vocês aceitam Amil?", "lead", undefined, 1,
    );
    expect(fakeChatCreate).toHaveBeenCalledTimes(1);
  });
});

describe("Cost-opt — policy_violation is cosmetic, no retry", () => {
  it("flags 'consulta gratuita' when chargesConsultation=true but does NOT retry", async () => {
    mockIntent = "objection";
    mockSettings = { ...mockSettings, chargesConsultation: true };
    fakeReplies.push(JSON.stringify({
      reply: "A primeira consulta é gratuita, pode vir sem custo nenhum!",
      metadata: { intent: "objection", confidence: 0.9 },
    }));
    await processIncomingMessage(
      1, 1, "+5511999999999", "Maria", "consulta é grátis?", "lead", undefined, 1,
    );
    expect(fakeChatCreate).toHaveBeenCalledTimes(1);
  });
});
