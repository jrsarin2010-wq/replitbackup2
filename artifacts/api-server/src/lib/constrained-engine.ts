/**
 * Task #25 — Motor restrito de geração da IA.
 *
 * Encapsula toda a interação com a OpenAI quando o tenant está em modo
 * `useConstrainedGeneration=true`:
 *   1. Atribui IDs aos slots e profissionais.
 *   2. Constrói JSON Schema dinâmico que LIMITA a IA a esses IDs.
 *   3. Chama o modelo com `response_format: json_schema` (strict).
 *   4. Parseia a resposta estruturada.
 *   5. Renderiza determinísticamente o texto final.
 *   6. Valida apenas termos proibidos (camada fina de segurança).
 *
 * Vantagens:
 *   - Impossível inventar slot/profissional/preço.
 *   - Validador caí de 779 → ~50 linhas no caminho restrito.
 *   - Dispatch claro e logado por ação.
 */

import type { OpenAI } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";
import { buildGpt5Extras, bumpTokensForLowReasoning } from "./ai-tuning";
import { recordAiCall } from "./ai-cost-metrics";
import type { AvailableSlot } from "./schedule-engine";
import type { AppointmentExtraction } from "./appointment-extractor";
import {
  assignSlotIds,
  assignProfessionalIds,
  buildResponseSchema,
  type SlotWithId,
  type ProfessionalWithId,
  type StructuredAIResponse,
} from "./constrained-output";
import { buildConstrainedPrompt } from "./constrained-prompt";
import {
  renderStructuredResponse,
  applyViolationFallback,
  type RenderableProfessional,
  type RenderContext,
} from "./structured-renderer";
import { validateConstrainedReply } from "./response-validator";

const PEAK_TIMEOUT_MS = 8_000;

export interface ConstrainedRunInput {
  client: OpenAI;
  tenantId: number;
  conversationId: number;
  contactName: string | null | undefined;
  contactPhone: string;
  contactType: string;
  intent: string;
  conversationMode: "CONVENIO_TRIAGEM" | "CONVENIO_AGENDAR" | "PARTICULAR_SPIN" | "PACIENTE_AGENDAR" | null;
  isInsuranceContact: boolean;
  isFirstContact: boolean;
  /** Slots crus do schedule-engine (já filtrados pelo modo). */
  availableSlots: AvailableSlot[];
  /** Profissionais ativos (lista usada para resolver IDs). */
  professionals: RenderableProfessional[];
  /** Procedimentos cadastrados (nomes). */
  procedureNames: string[];
  /** Convênios aceitos. */
  insurancePlans?: string | null;
  clinicName: string;
  aiName: string;
  personalityHint?: string | null;
  /** Settings-level fee fallback. */
  settingsConsultationFee?: string | null;
  settingsChargesConsultation?: boolean | null;
  /** Histórico recente em texto (compactado pelo caller). */
  recentHistoryText?: string | null;
  /** Mensagem do usuário (já com timestamp). */
  userContent: string;
  /** Hoje em pt-BR ("Sex 25/04/2026"). */
  todayLabel: string;
  /** Modelo a ser usado (vindo do model-selector). */
  model: string;
  /** Resumo curto do paciente, se houver. */
  patientContext?: string | null;
}

export interface ConstrainedRunResult {
  /** Texto final pronto para envio no WhatsApp. */
  reply: string;
  /** Quando action=CONFIRM_SLOT, traz a extração já validada para persistência. */
  inlineAppointment: AppointmentExtraction | null;
  /** Resposta estruturada bruta (auditoria). */
  structured: StructuredAIResponse;
  modelUsed: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  violations: string[];
}

const ALLOWED_ACTIONS = new Set([
  "OFFER_SLOTS",
  "CONFIRM_SLOT",
  "SEND_PIX",
  "SEND_FEE",
  "ASK_INFO",
  "ESCALATE",
  "JUST_REPLY",
]);

function safeParseStructured(raw: string): StructuredAIResponse | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Partial<StructuredAIResponse>;
    if (!obj || typeof obj !== "object") return null;
    if (!ALLOWED_ACTIONS.has(String(obj.action ?? ""))) return null;
    return {
      action: obj.action as StructuredAIResponse["action"],
      slot_ids: Array.isArray(obj.slot_ids) ? obj.slot_ids.map((s) => String(s)) : [],
      professional_id: typeof obj.professional_id === "string" ? obj.professional_id : null,
      reply_text: typeof obj.reply_text === "string" ? obj.reply_text : "",
    };
  } catch {
    return null;
  }
}

export async function runConstrainedGeneration(input: ConstrainedRunInput): Promise<ConstrainedRunResult> {
  const startTs = Date.now();

  // 1. IDs estáveis ───────────────────────────────────────────────────────
  const slotsWithIds: SlotWithId[] = assignSlotIds(
    input.availableSlots,
    input.professionals.map((p) => ({ id: p.id, name: p.name })),
  );
  const profsWithIds: ProfessionalWithId[] = assignProfessionalIds(
    input.professionals.map((p) => ({ id: p.id, name: p.name })),
  );

  // 2. Schema dinâmico ────────────────────────────────────────────────────
  const responseSchema = buildResponseSchema(slotsWithIds, profsWithIds);

  // 3. Prompt restrito ────────────────────────────────────────────────────
  const promptText = buildConstrainedPrompt({
    clinicName: input.clinicName,
    aiName: input.aiName,
    personalityHint: input.personalityHint ?? undefined,
    mode: input.conversationMode,
    isInsuranceContact: input.isInsuranceContact,
    isFirstContact: input.isFirstContact,
    contactType: input.contactType,
    contactName: input.contactName ?? null,
    intent: input.intent,
    patientContext: input.patientContext ?? null,
    slots: slotsWithIds,
    professionals: profsWithIds,
    procedureNames: input.procedureNames,
    insurancePlans: input.insurancePlans ?? null,
    todayLabel: input.todayLabel,
    recentHistory: input.recentHistoryText ?? null,
  });

  const messages = [
    { role: "system" as const, content: promptText },
    { role: "user" as const, content: input.userContent },
  ];

  // 4. Chamada OpenAI ─────────────────────────────────────────────────────
  const isGpt5 = input.model.startsWith("gpt-5");
  const extras = isGpt5
    ? buildGpt5Extras({ tenantId: input.tenantId, namespace: "dental-constrained" })
    : {};

  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), PEAK_TIMEOUT_MS);
  let modelUsed = input.model;
  let response;
  try {
    response = await input.client.chat.completions.create(
      {
        model: input.model,
        max_completion_tokens: bumpTokensForLowReasoning(700),
        messages,
        temperature: 0.2,
        response_format: responseSchema,
        ...extras,
      } as Parameters<typeof input.client.chat.completions.create>[0],
      { signal: ac.signal },
    );
    clearTimeout(timeoutId);
  } catch (err) {
    clearTimeout(timeoutId);
    const timedOut = ac.signal.aborted;
    logger.warn(
      { err, tenantId: input.tenantId, conversationId: input.conversationId, primary_model: input.model, timed_out: timedOut },
      "constrained-engine: primary model failed — retrying with gpt-5.1",
    );
    modelUsed = "gpt-5.1";
    response = await input.client.chat.completions.create({
      model: "gpt-5.1",
      max_completion_tokens: bumpTokensForLowReasoning(700),
      messages,
      temperature: 0.2,
      response_format: responseSchema,
      ...buildGpt5Extras({ tenantId: input.tenantId, namespace: "dental-constrained" }),
    } as Parameters<typeof input.client.chat.completions.create>[0]);
  }

  const usage = (response as { usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } }).usage;
  const promptTokens = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  const cachedTokens = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  if (modelUsed.startsWith("gpt-5")) {
    recordAiCall({ promptTokens, cachedTokens });
  }

  // 5. Parse estruturado ──────────────────────────────────────────────────
  const rawContent = response.choices[0]?.message?.content || "";
  const parsed: StructuredAIResponse =
    safeParseStructured(rawContent) ?? {
      action: "JUST_REPLY",
      slot_ids: [],
      professional_id: null,
      reply_text: "Desculpe, deixa eu confirmar com a clinica e ja te aviso.",
    };

  // 6. Render determinístico ──────────────────────────────────────────────
  const renderCtx: RenderContext = {
    slots: slotsWithIds,
    professionals: profsWithIds,
    professionalsFull: input.professionals,
    isInsuranceContact: input.isInsuranceContact,
    settingsConsultationFee: input.settingsConsultationFee ?? null,
    settingsChargesConsultation: input.settingsChargesConsultation ?? null,
    clinicName: input.clinicName,
  };
  const renderedRaw = renderStructuredResponse(parsed, renderCtx);

  // 7. Inline appointment quando CONFIRM_SLOT ─────────────────────────────
  let inlineAppointment: AppointmentExtraction | null = null;
  if (parsed.action === "CONFIRM_SLOT" && renderedRaw.shouldCreateAppointment && renderedRaw.chosenSlot) {
    inlineAppointment = {
      confirmed: true,
      date: renderedRaw.chosenSlot.date,
      time: renderedRaw.chosenSlot.time,
      procedure: null,
      professionalName: renderedRaw.chosenProfessional?.name ?? null,
    };
  }

  // 8. Validação fina (apenas termos proibidos) + ENFORCEMENT ─────────────
  const violations = validateConstrainedReply(renderedRaw.text, {
    isInsuranceContact: input.isInsuranceContact,
    insurancePlans: input.insurancePlans ?? null,
  });

  // Se houver violações, o renderer substitui o texto por um fallback seguro
  // (mantém slot/marker/criação de agendamento — só protege o texto exibido).
  const rendered = applyViolationFallback(renderedRaw, violations.length > 0);

  logger.info(
    {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      constrained_action: parsed.action,
      constrained_slot_ids: parsed.slot_ids,
      constrained_prof_id: parsed.professional_id,
      slots_offered: slotsWithIds.length,
      professionals_listed: profsWithIds.length,
      model_used: modelUsed,
      latency_ms: Date.now() - startTs,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      cached_tokens: cachedTokens,
      violations: violations.map((v) => v.type),
      did_create_appointment: !!inlineAppointment,
    },
    "constrained-engine: dispatched",
  );

  return {
    reply: rendered.text,
    inlineAppointment,
    structured: parsed,
    modelUsed,
    promptTokens,
    completionTokens,
    cachedTokens,
    violations: violations.map((v) => v.type),
  };
}
