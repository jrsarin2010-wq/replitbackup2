/**
 * Session 7 — Suite de regressão para conexão de leadIsEscaping ao prompt.
 *
 * Cobre sem chamada à OpenAI/rede:
 *   - detectLeadEscape: positivos e negativos
 *   - buildConstrainedPrompt: bloco RESGATE ativado e desativado
 *   - runConstrainedGeneration: leadIsEscaping=true propaga bloco ao prompt
 *   - regressão: chamada sem leadIsEscaping continua funcionando
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectLeadEscape } from "../lib/constrained-engine";
import { buildConstrainedPrompt } from "../lib/constrained-prompt";

// ── Mocks de side-effects com DB ─────────────────────────────────────────────
vi.mock("../lib/constrained-facts", () => ({
  updateLastOfferOutcome: vi.fn().mockResolvedValue({ wasRefusal: false }),
  persistConfirmSlotSignal: vi.fn().mockResolvedValue(undefined),
  persistOfferSlotsSignal: vi.fn().mockResolvedValue(undefined),
  persistOfferSlotsRefusal: vi.fn().mockResolvedValue(undefined),
  setSlotOffset: vi.fn().mockResolvedValue(undefined),
  persistSlotExhaustedSignal: vi.fn().mockResolvedValue(undefined),
  clearSlotExhaustedSignal: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/telegram", () => ({
  sendTelegramMessage: vi.fn().mockResolvedValue(undefined),
}));

// Contexto mínimo válido para buildConstrainedPrompt.
const BASE_CTX = {
  aiName: "Júlia",
  clinicName: "Sorrizin Maxx",
  mode: null as null,
  isInsuranceContact: false,
  isFirstContact: false,
  contactType: "lead",
  intent: "agendar",
  slots: [],
  professionals: [],
  procedureNames: [],
  todayLabel: "Seg 28/04/2026",
  pixMode: "DESATIVADO" as const,
};

// Resposta mínima válida do OpenAI para o mock.
const MOCK_OPENAI_RESPONSE = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          action: "JUST_REPLY",
          slot_ids: [],
          professional_id: null,
          reply_text: "Tá bom!",
          request_more_slots: false,
          mapUrl: null,
          address: null,
          mapsMessage: null,
        }),
      },
    },
  ],
  usage: {
    prompt_tokens: 100,
    completion_tokens: 50,
    prompt_tokens_details: { cached_tokens: 0 },
  },
};

// ── T1: detectLeadEscape positivo ─────────────────────────────────────────────
describe("T1: detectLeadEscape com 'vou pensar'", () => {
  it("retorna true para mensagem de fuga", () => {
    expect(detectLeadEscape("oi, vou pensar e te ligo depois")).toBe(true);
  });
});

// ── T2: detectLeadEscape negativo ─────────────────────────────────────────────
describe("T2: detectLeadEscape com 'vou marcar'", () => {
  it("retorna false para intenção de agendar", () => {
    expect(detectLeadEscape("vou marcar sim, pode reservar")).toBe(false);
  });
});

// ── T3: bloco RESGATE presente quando leadIsEscaping=true ─────────────────────
describe("T3: buildConstrainedPrompt com leadIsEscaping=true", () => {
  it("inclui bloco === RESGATE DE LEAD === no prompt", () => {
    const prompt = buildConstrainedPrompt({ ...BASE_CTX, leadIsEscaping: true });
    expect(prompt).toContain("=== RESGATE DE LEAD ===");
  });
});

// ── T4: bloco RESGATE ausente quando leadIsEscaping=false ─────────────────────
describe("T4: buildConstrainedPrompt com leadIsEscaping=false", () => {
  it("NÃO inclui bloco === RESGATE DE LEAD === no prompt", () => {
    const prompt = buildConstrainedPrompt({ ...BASE_CTX, leadIsEscaping: false });
    expect(prompt).not.toContain("=== RESGATE DE LEAD ===");
  });
});

// ── T5: end-to-end via runConstrainedGeneration ───────────────────────────────
describe("T5: runConstrainedGeneration com leadIsEscaping=true", () => {
  it("envia prompt com bloco RESGATE ao modelo", async () => {
    const capturedMessages: { role: string; content: string }[] = [];

    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(
            async (params: { messages: { role: string; content: string }[] }) => {
              capturedMessages.push(...params.messages);
              return MOCK_OPENAI_RESPONSE;
            },
          ),
        },
      },
    };

    const { runConstrainedGeneration } = await import("../lib/constrained-engine");

    await runConstrainedGeneration({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: mockClient as any,
      tenantId: 1,
      conversationId: 1,
      contactName: "Lead Teste",
      contactPhone: "5511900000001",
      contactType: "lead",
      intent: "agendar",
      conversationMode: null,
      isInsuranceContact: false,
      isFirstContact: false,
      availableSlots: [],
      professionals: [],
      procedureNames: [],
      clinicName: "Sorrizin Maxx",
      aiName: "Júlia",
      userContent: "vou pensar e te ligo depois",
      todayLabel: "Seg 28/04/2026",
      model: "gpt-4o-mini",
      leadIsEscaping: true,
    });

    const systemMessage = capturedMessages.find((m) => m.role === "system");
    expect(systemMessage).toBeDefined();
    expect(systemMessage!.content).toContain("=== RESGATE DE LEAD ===");
  });
});

// ── T6: regressão — sem leadIsEscaping não quebra ────────────────────────────
describe("T6: regressão — runConstrainedGeneration sem leadIsEscaping", () => {
  it("funciona normalmente quando leadIsEscaping não é passado", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue(MOCK_OPENAI_RESPONSE),
        },
      },
    };

    const { runConstrainedGeneration } = await import("../lib/constrained-engine");

    const result = await runConstrainedGeneration({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: mockClient as any,
      tenantId: 1,
      conversationId: 2,
      contactName: "Lead Regressão",
      contactPhone: "5511900000002",
      contactType: "lead",
      intent: "agendar",
      conversationMode: null,
      isInsuranceContact: false,
      isFirstContact: true,
      availableSlots: [],
      professionals: [],
      procedureNames: [],
      clinicName: "Sorrizin Maxx",
      aiName: "Júlia",
      userContent: "Olá! Quero agendar uma consulta.",
      todayLabel: "Seg 28/04/2026",
      model: "gpt-4o-mini",
      // leadIsEscaping omitido intencionalmente
    });

    expect(result.reply).toBeDefined();
    expect(typeof result.reply).toBe("string");
  });
});
