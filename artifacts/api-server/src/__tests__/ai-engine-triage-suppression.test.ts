/**
 * Task #28 — Engine-level integration tests for AGENDA suppression during
 * insurance/private triage. OpenAI is mocked; we capture the `messages`
 * array passed to chat.completions.create and assert the assembled prompt
 * never leaks time slots while triage is pending.
 *
 * Scenarios (matching task acceptance criteria):
 *   (a) clinic accepts insurance + intent="other" + new lead → AGENDA suppressed
 *   (b) clinic accepts insurance + intent="scheduling" + no triage → AGENDA suppressed
 *   (c) lead replies "é particular" → AGENDA released on next call
 *   (d) clinic does NOT accept insurance → AGENDA always present
 *   (e) contactType="patient" → AGENDA always present
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Capture for OpenAI calls ────────────────────────────────────────────────
type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
const capturedCalls: Array<{ model: string; messages: ChatMessage[] }> = [];

const fakeChatCreate = vi.fn(async (args: { model: string; messages: ChatMessage[] }) => {
  capturedCalls.push({ model: args.model, messages: args.messages });
  return {
    choices: [{ message: { content: "ok" } }],
  };
});

const fakeOpenAIClient = {
  chat: { completions: { create: fakeChatCreate } },
};

vi.mock("../lib/openai-client", () => ({
  getOpenAIClient: vi.fn(async () => fakeOpenAIClient),
  invalidateOpenAIClient: vi.fn(),
}));

// Tenant rate limiter: always allow, no circuit breaker
vi.mock("../lib/tenant-rate-limiter", () => ({
  isTenantCircuitOpen: vi.fn(async () => false),
  checkAndRecordAICall: vi.fn(async () => ({ allowed: true, remaining: 100 })),
  recordTenantError: vi.fn(async () => {}),
  getFallbackMessage: vi.fn(() => "fallback"),
}));

// Intent detector — controllable per-test via setMockIntent
import type { Intent } from "../lib/schedule-engine.js";
let mockIntent: Intent = "other";
vi.mock("../lib/intent-detector", () => ({
  detectIntent: vi.fn(async () => mockIntent),
  classifyLeadTemperature: vi.fn(() => "cold"),
}));

// Schedule engine — returns a fixed agenda string so we can assert leakage
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

// Cache — settings/professionals/procedures
let mockSettings = {
  clinicName: "Clinica Teste",
  aiName: "Ana",
  professionalName: "Dr. Joao",
  workingHoursStart: "08:00",
  workingHoursEnd: "18:00",
  acceptsInsurance: true,
  insurancePlans: "Unimed, Amil",
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
      name: "Dr. Joao",
      active: true,
      specialty: null,
      cro: null,
      instagramUrl: null,
      chargesConsultation: true,
      consultationFee: 150,
      acceptsInsurance: mockSettings.acceptsInsurance,
      insurancePlans: mockSettings.insurancePlans,
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

// AI learning — empty enrichments
vi.mock("../lib/ai-learning", () => ({
  getContactMemories: vi.fn(async () => ""),
  getRelevantObjections: vi.fn(async () => ""),
  getRelevantKnowledge: vi.fn(async () => ""),
  getOptimizedStrategies: vi.fn(async () => ""),
  recordStrategyAnalytics: vi.fn(async () => {}),
}));

// Conversation summarizer — no summary
vi.mock("../lib/conversation-summarizer", () => ({
  maybeUpdateConversationSummary: vi.fn(async () => {}),
  buildSummaryContextBlock: vi.fn(() => ""),
}));

// Escalation / urgency — no-ops
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

vi.mock("../lib/appointment-extractor", () => ({
  tryCreateAppointmentFromReply: vi.fn(async () => {}),
  createAppointmentFromData: vi.fn(async () => {}),
}));

// ── Database mock ───────────────────────────────────────────────────────────
type LeadRow = {
  id: number;
  tenantId: number;
  phone: string;
  name: string;
  paymentType: string | null;
  temperature: string;
  source: string;
  status: string;
  professionalId: number | null;
  interest: string | null;
};

let mockLead: LeadRow | null = null;
let mockPatient: { id: number; tenantId: number; phone: string } | null = null;
let mockMessages: Array<{ direction: "inbound" | "outbound"; content: string; sentAt: Date | null }> = [];

vi.mock("@workspace/db", () => {
  const findFirstLead = vi.fn(async () => mockLead);
  const findFirstPatient = vi.fn(async () => mockPatient);
  const findManyMessages = vi.fn(async () => mockMessages);
  const findFirstConversation = vi.fn(async () => ({ id: 1, aiSummary: null, aiSummaryMessageCount: 0, sentiment: "neutral" }));
  const findFirstTenant = vi.fn(async () => ({ id: 1, plan: "premium" }));

  const update = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    })),
  }));
  const insert = vi.fn(() => ({
    values: vi.fn(() => ({
      returning: vi.fn(() => Promise.resolve([{ id: 999 }])),
      catch: vi.fn(() => Promise.resolve()),
      then: (resolve: (v: unknown) => unknown) => resolve(undefined),
    })),
  }));

  // For raw select(...).from(...).where(...) (refusalRows)
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve([{ count: 0 }])),
    })),
  }));

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
      insert,
      update,
      select,
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

// ── Helpers ─────────────────────────────────────────────────────────────────
function flattenPrompt(): string {
  if (capturedCalls.length === 0) return "";
  const last = capturedCalls[capturedCalls.length - 1];
  return last.messages.map((m) => m.content).join("\n---SEP---\n");
}

const { processIncomingMessage } = await import("../lib/ai-engine.js");

beforeEach(() => {
  capturedCalls.length = 0;
  fakeChatCreate.mockClear();
  mockSettings = { ...mockSettings, acceptsInsurance: true };
  mockLead = {
    id: 1, tenantId: 1, phone: "+5511999999999", name: "Maria",
    paymentType: null, temperature: "cold", source: "whatsapp", status: "active",
    professionalId: null, interest: null,
  };
  mockPatient = null;
  mockMessages = [];
  mockIntent = "other";
});

describe("Task #28 (a) — clínica COM convênio + intent='other' + lead novo → AGENDA suprimida", () => {
  it("não inclui o agenda string no prompt enviado para a OpenAI", async () => {
    mockIntent = "other";
    await processIncomingMessage(
      1, 1, "+5511999999999", "Maria", "oi tudo bem", "lead", undefined, 1,
    );
    const prompt = flattenPrompt();
    expect(prompt).not.toContain(FIXED_AGENDA);
    // E não deve haver nenhum HH:MM solto na seção de agenda do prompt principal
    const sysMsg = capturedCalls[0]?.messages.find((m) => m.role === "system" && m.content.includes("=== AGENDA DISPONIVEL ==="));
    expect(sysMsg).toBeDefined();
    const idxA = sysMsg!.content.indexOf("=== AGENDA DISPONIVEL ===");
    const idxR = sysMsg!.content.indexOf("=== REGRAS GERAIS ===");
    expect(idxR).toBeGreaterThan(idxA);
    const agendaSection = sysMsg!.content.substring(idxA, idxR);
    expect(agendaSection).not.toMatch(/\b\d{1,2}:\d{2}\b/);
  });

  it("injeta a hint [SISTEMA: ... plano ou particular ...] no prompt", async () => {
    mockIntent = "other";
    await processIncomingMessage(
      1, 1, "+5511999999999", "Maria", "queria saber sobre limpeza", "lead", undefined, 1,
    );
    const prompt = flattenPrompt();
    expect(prompt).toMatch(/SISTEMA:.*plano.*particular/i);
  });
});

describe("Task #28 (b) — clínica COM convênio + intent='scheduling' sem triagem → AGENDA suprimida", () => {
  it("não inclui o agenda string mesmo quando intent é scheduling", async () => {
    mockIntent = "scheduling";
    await processIncomingMessage(
      1, 1, "+5511999999999", "Maria", "quero marcar uma consulta", "lead", undefined, 1,
    );
    const prompt = flattenPrompt();
    expect(prompt).not.toContain(FIXED_AGENDA);
  });
});

describe("Task #28 (c) — usuário responde 'é particular' → próxima chamada recebe AGENDA", () => {
  it("inclui o agenda string quando paymentType já está persistido como 'private'", async () => {
    mockIntent = "scheduling";
    mockLead!.paymentType = "private";
    mockMessages = [
      { direction: "inbound", content: "oi", sentAt: new Date() },
      { direction: "outbound", content: "Oi! Vai usar plano ou e particular?", sentAt: new Date() },
      { direction: "inbound", content: "é particular", sentAt: new Date() },
    ];
    await processIncomingMessage(
      1, 1, "+5511999999999", "Maria", "qual horário tem amanhã?", "lead", undefined, 1,
    );
    const prompt = flattenPrompt();
    expect(prompt).toContain(FIXED_AGENDA);
  });

  it("inclui o agenda string quando o usuário declara 'é particular' nesta mensagem", async () => {
    mockIntent = "scheduling";
    await processIncomingMessage(
      1, 1, "+5511999999999", "Maria", "é particular, quero marcar", "lead", undefined, 1,
    );
    const prompt = flattenPrompt();
    expect(prompt).toContain(FIXED_AGENDA);
  });
});

describe("Task #28 (d) — clínica SEM convênio → AGENDA presente normalmente", () => {
  it("inclui o agenda string quando acceptsInsurance=false (não há triagem para fazer)", async () => {
    mockSettings = { ...mockSettings, acceptsInsurance: false };
    mockIntent = "scheduling";
    await processIncomingMessage(
      1, 1, "+5511999999999", "Maria", "quero marcar", "lead", undefined, 1,
    );
    const prompt = flattenPrompt();
    expect(prompt).toContain(FIXED_AGENDA);
  });
});

describe("Task #28 (e) — contactType='patient' → AGENDA presente normalmente", () => {
  it("inclui o agenda string para paciente conhecido mesmo em clínica de convênio sem triagem", async () => {
    mockSettings = { ...mockSettings, acceptsInsurance: true };
    mockIntent = "scheduling";
    mockLead = null;
    mockPatient = { id: 5, tenantId: 1, phone: "+5511999999999" };
    await processIncomingMessage(
      1, 1, "+5511999999999", "Maria", "quero remarcar", "patient", 5, undefined,
    );
    const prompt = flattenPrompt();
    expect(prompt).toContain(FIXED_AGENDA);
  });
});
