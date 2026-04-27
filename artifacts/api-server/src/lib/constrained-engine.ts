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
import { filterValidSlots, type ProfessionalSchedule } from "./schedule-validator";
import {
  assignSlotIds,
  rankSlotsForRelevance,
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
import { clinicEffectivelyAcceptsInsurance } from "./prompt-helpers";
import {
  persistConfirmSlotSignal,
  persistOfferSlotsSignal,
  persistOfferSlotsRefusal,
  updateLastOfferOutcome,
  setSlotOffset,
  // Task #11 — marcador de "agenda esgotou" para sinalizar didReset à IA
  // via [FATOS]+REGRA #7. Persist quando wrap-around acontece;
  // clear em CONFIRM_SLOT (paciente fechou agenda).
  persistSlotExhaustedSignal,
  clearSlotExhaustedSignal,
} from "./constrained-facts";

const PEAK_TIMEOUT_MS = 8_000;

/**
 * Detecta se o lead enviou comprovante de pagamento PIX via padrões de texto
 * comuns em comprovantes/transferências. Usado no modo PIX_PENDING.
 */
export function detectProofOfPayment(userMessage: string): boolean {
  const proofKeywords = [
    "comprovante",
    "transferi",
    "paguei",
    "comprovei",
    "enviando comprovante",
    "aqui tá o comprovante",
    "aqui ta o comprovante",
    "segue comprovante",
    "confirmado",
    "efetuado",
  ];
  const messageLower = userMessage?.toLowerCase() || "";
  return proofKeywords.some((keyword) => messageLower.includes(keyword));
}

export interface ConstrainedRunInput {
  client: OpenAI;
  tenantId: number;
  conversationId: number;
  contactName: string | null | undefined;
  contactPhone: string;
  contactType: string;
  intent: string;
  conversationMode: "CONVENIO_TRIAGEM" | "CONVENIO_AGENDAR" | "PARTICULAR_SPIN" | "PACIENTE_AGENDAR" | "LEAD_INDICACAO" | "PIX_PENDING" | null;
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
  /**
   * Bloco [FATOS] já formatado e sanitizado por `buildFactsBlock` (Task #1).
   * null/undefined = nenhum fato disponível, não injeta no prompt.
   */
  factsBlock?: string | null;
  /**
   * Quantos slots foram efetivamente recebidos pelo schedule-engine ANTES do
   * Top-K (Task #1). Usado para a métrica `slots_shown_vs_available`. Quando
   * undefined, assume-se que `availableSlots.length` já é o total bruto.
   */
  totalAvailableSlots?: number;
  /**
   * Task #1 — Offset de paginação determinística de slots. Quando > 0, o
   * engine pula esse número de slots antes de aplicar o Top-K. Persistido
   * por `setSlotOffset` quando o LLM responde `request_more_slots: true`,
   * resetado para 0 em CONFIRM_SLOT. Caller (ai-engine.ts) carrega via
   * `getSlotOffset` antes de chamar.
   */
  slotOffset?: number;
  /** Ficha do profissional principal (dias de atendimento e duração de slot). */
  professional?: { workingDays: string; insuranceDays?: string | null; slotDurationMinutes: number } | null;
  /** Procedimento solicitado (para validação de duração). */
  procedure?: { durationMinutes: number } | null;
  /** Clínica aceita parcelamento (vindo de dental_settings). */
  settingsAcceptsInstallments?: boolean | null;
  /** Máximo de parcelas aceitas (vindo de dental_settings). */
  settingsMaxInstallments?: number | null;
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
  /** Métricas de observabilidade (Task #1). */
  factsBlockPresent: boolean;
  summaryBlockPresent: boolean;
  slotsShown: number;
  slotsAvailableTotal: number;
  promptTokensSavedEstimate: number;
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

// ──────────────────────────────────────────────────────────────────────────
// Task #1 (post-review #2) — helpers puros de paginação. Extraídos para
// facilitar testes unitários da lógica sem precisar mockar OpenAI/DB.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Aplica offset à lista bruta de slots. Se o offset estourar (>= total),
 * auto-reseta para 0 (wrap), sinalizando ao chamador que precisa também
 * persistir o reset para evitar exibir página vazia ao paciente.
 *
 * @returns paged: slots após o offset; effectiveOffset: offset realmente usado
 *          (0 quando houve auto-reset); didReset: true quando wrap aconteceu.
 */
export function applyPagination<T>(
  slots: readonly T[],
  rawOffset: number,
): { paged: readonly T[]; effectiveOffset: number; didReset: boolean } {
  const total = slots.length;
  const offset = Math.max(0, Math.floor(rawOffset || 0));
  if (offset === 0) return { paged: slots, effectiveOffset: 0, didReset: false };
  // Auto-reset: se a paginação saltaria além do total, volta ao começo.
  // Caso contrário o engine exibiria [SLOTS] vazio e a IA poderia escalar
  // sem motivo. Reset preserva o offer-loop natural.
  if (offset >= total) return { paged: slots, effectiveOffset: 0, didReset: true };
  return { paged: slots.slice(offset), effectiveOffset: offset, didReset: false };
}

/**
 * Calcula o próximo offset a persistir a partir do estado pós-dispatch.
 *
 * Regras (contrato):
 *   - CONFIRM_SLOT                       → 0 (reset)
 *   - OFFER_SLOTS + request_more=true    → currentOffset + offered (cap em total)
 *   - qualquer outra ação                → 0 (reset; conversa mudou de contexto)
 *
 * `offered` deve ser o número de slot_ids que viraram CARDS para o paciente
 * (parsed.slot_ids.length), e NÃO o tamanho do Top-K visto pelo LLM. Assim
 * nunca pulamos slots que o paciente jamais chegou a ver.
 */
export function computeNextSlotOffset(args: {
  action: string;
  requestMoreSlots: boolean;
  currentOffset: number;
  offered: number;
  totalRawSlots: number;
}): number {
  const { action, requestMoreSlots, currentOffset, offered, totalRawSlots } = args;
  if (action === "CONFIRM_SLOT") return 0;
  if (action !== "OFFER_SLOTS" || !requestMoreSlots) return 0;
  const next = Math.max(0, Math.floor(currentOffset || 0)) + Math.max(0, Math.floor(offered || 0));
  // Cap: nunca passa do total — o próximo turno faria wrap/reset de qualquer jeito.
  if (next >= totalRawSlots) return 0;
  return next;
}

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
      // Task #1 — strict schema garante presença, mas defendemos contra
      // payloads não-strict (fallback path, modelos que retornam parcial).
      request_more_slots: obj.request_more_slots === true,
    };
  } catch {
    return null;
  }
}

export async function runConstrainedGeneration(input: ConstrainedRunInput): Promise<ConstrainedRunResult> {
  const startTs = Date.now();

  // Detector de urgência via palavras-gatilho. Promove conversationMode para
  // URGENCIA antes de qualquer outra lógica. O input original não é alterado.
  const urgencyKeywords = [
    "morrendo de dor",
    "muita dor",
    "dor forte",
    "socorro",
    "urgente",
    "emergência",
    "emerg",
    "quebrei o dente",
    "quebrei meu dente",
    "quebrei dente",
    "sangrando",
    "não consigo mais",
    "não aguento mais",
    "não aguento nada",
  ];
  const userMessageLower = input.userContent?.toLowerCase() ?? "";
  const isUrgency = urgencyKeywords.some((kw) => userMessageLower.includes(kw));
  let effectiveMode: "CONVENIO_TRIAGEM" | "CONVENIO_AGENDAR" | "PARTICULAR_SPIN" | "PACIENTE_AGENDAR" | "LEAD_INDICACAO" | "URGENCIA" | "PIX_PENDING" | null =
    isUrgency ? "URGENCIA" : input.conversationMode;

  // Se estamos aguardando PIX (PIX_PENDING) e recebemos comprovante, mantemos
  // o modo para que o prompt renderize a confirmação de pagamento.
  // V2: transição para AGENDAMENTO_CONFIRMADO_COM_PIX + validação OCR de valor.
  if (effectiveMode === "PIX_PENDING" && detectProofOfPayment(input.userContent)) {
    effectiveMode = "PIX_PENDING";
  }

  // Filtrar slots respeitando a ficha do profissional (dias de atendimento e duração).
  const professionalSchedule: ProfessionalSchedule = {
    workingDays: input.professional?.workingDays ?? "1,2,3,4,5",
    insuranceDays: input.professional?.insuranceDays,
    slotDurationMinutes: input.professional?.slotDurationMinutes ?? 30,
  };
  const procedureDuration = input.procedure
    ? { durationMinutes: input.procedure.durationMinutes }
    : undefined;
  const validSlots = filterValidSlots(
    input.availableSlots,
    effectiveMode,
    professionalSchedule,
    procedureDuration,
  );

  // 1. IDs estáveis ───────────────────────────────────────────────────────
  // Bug fix (post-review #2) — quando o paciente é de CONVÊNIO, filtramos
  // slots de profissionais que NÃO atendem convênio. Antes desse filtro
  // o LLM podia oferecer slots do "Dr. Particular Só" para um paciente do
  // Bradesco (bug reportado pelo cliente). O filtro acontece ANTES da
  // paginação para que a contagem de slots reflita só o conjunto válido.
  const profAcceptsInsurance = new Map<number, boolean>(
    input.professionals.map((p) => [p.id, p.acceptsInsurance === true]),
  );
  const insuranceFilteredRaw = input.isInsuranceContact
    ? validSlots.filter((s) => profAcceptsInsurance.get(s.professionalId) === true)
    : validSlots;

  // Post-review #3 — ranking determinístico de relevância ANTES da paginação:
  // (a) profissional preferido (primeiro em `professionals` — quando o
  // roteador escolhe um profissional ele entra na posição 0); (b) data/hora
  // ascendente; (c) ordem original (estável). Só depois aplicamos offset e
  // Top-K (5) para o LLM.
  const rankedRaw = rankSlotsForRelevance(
    insuranceFilteredRaw,
    input.professionals.map((p) => ({ id: p.id, name: p.name })),
  );

  // Task #1 — paginação determinística: aplica offset (request_more_slots
  // do turno anterior) ANTES do Top-K via helper puro `applyPagination`,
  // que também trata o caso de offset estourar a lista (auto-reset wrap).
  const totalRawSlots = rankedRaw.length;
  const pagination = applyPagination(rankedRaw, input.slotOffset ?? 0);
  const slotsWithIds: SlotWithId[] = assignSlotIds(
    pagination.paged as (typeof input.availableSlots),
    input.professionals.map((p) => ({ id: p.id, name: p.name })),
  );
  const profsWithIds: ProfessionalWithId[] = assignProfessionalIds(
    input.professionals.map((p) => ({ id: p.id, name: p.name })),
  );

  // 2. Schema dinâmico ────────────────────────────────────────────────────
  const responseSchema = buildResponseSchema(slotsWithIds, profsWithIds);

  // 3. Prompt restrito ────────────────────────────────────────────────────
  // Bug fix — propaga acceptsInsurance/insurancePlans por profissional para
  // o prompt mostrar "atende convenio: X,Y" ou "nao atende convenio" no
  // bloco [PROFISSIONAIS]. O LLM passa a ver o status individual.
  const profsForPrompt = profsWithIds.map((pw, i) => {
    const full = input.professionals[i];
    return {
      id: pw.id,
      name: pw.name,
      acceptsInsurance: full?.acceptsInsurance ?? null,
      insurancePlans: full?.insurancePlans ?? null,
    };
  });
  const promptText = buildConstrainedPrompt({
    clinicName: input.clinicName,
    aiName: input.aiName,
    personalityHint: input.personalityHint ?? undefined,
    mode: effectiveMode,
    isInsuranceContact: input.isInsuranceContact,
    isFirstContact: input.isFirstContact,
    contactType: input.contactType,
    contactName: input.contactName ?? null,
    intent: input.intent,
    patientContext: input.patientContext ?? null,
    slots: slotsWithIds,
    professionals: profsForPrompt,
    procedureNames: input.procedureNames,
    insurancePlans: input.insurancePlans ?? null,
    todayLabel: input.todayLabel,
    recentHistory: input.recentHistoryText ?? null,
    factsBlock: input.factsBlock ?? null,
    acceptsInstallments: input.settingsAcceptsInstallments ?? null,
    maxInstallments: input.settingsMaxInstallments ?? null,
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
      // Post-review #3 — fallback deve respeitar o contrato strict do
      // StructuredAIResponse (campo obrigatório). Reset implícito de offset
      // garante que próxima oferta começa do início.
      request_more_slots: false,
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
  let acceptedSlotLabel: string | null = null;
  if (parsed.action === "CONFIRM_SLOT" && renderedRaw.shouldCreateAppointment && renderedRaw.chosenSlot) {
    inlineAppointment = {
      confirmed: true,
      date: renderedRaw.chosenSlot.date,
      time: renderedRaw.chosenSlot.time,
      procedure: null,
      professionalName: renderedRaw.chosenProfessional?.name ?? null,
    };
    // Label compacto p/ registrar no desfecho da última oferta.
    const [y, m, d] = renderedRaw.chosenSlot.date.split("-");
    acceptedSlotLabel = `${d}/${m}/${y.slice(2)} ${renderedRaw.chosenSlot.time}`;
    // Task #1 — persistir sinal de "agendou com X em Y" no ai_contact_memory
    // para que o próximo turno tenha o fato no bloco [FATOS]. Fire-and-forget.
    void persistConfirmSlotSignal({
      tenantId: input.tenantId,
      contactPhone: input.contactPhone,
      conversationId: input.conversationId,
      professionalName: renderedRaw.chosenProfessional?.name ?? null,
      date: renderedRaw.chosenSlot.date,
      time: renderedRaw.chosenSlot.time,
    });
  }

  // 7b. Task #1 — Atualiza desfecho da ÚLTIMA oferta (turno anterior) ANTES
  // de persistir a NOVA oferta. Ordem é crítica: se invertido, o update
  // sobrescreve a oferta recém-criada como "recusou (reofertou)" e não a
  // anterior. Encadeamos no mesmo promise para garantir ordering apesar
  // do fire-and-forget.
  const offerSideEffects = updateLastOfferOutcome({
    tenantId: input.tenantId,
    contactPhone: input.contactPhone,
    currentAction: parsed.action,
    acceptedSlotId: parsed.action === "CONFIRM_SLOT" ? (parsed.slot_ids[0] ?? null) : null,
    acceptedSlotLabel: parsed.action === "CONFIRM_SLOT" ? acceptedSlotLabel : null,
  }).then(async (outcomeResult) => {
    // Task #3 — quando a oferta anterior foi RECUSADA neste turno, extrai
    // preferencias/restricoes implicitas da mensagem do paciente ("so de
    // manha", "essa semana nao") e persiste como memoria "preferencia" para
    // alimentar o [FATOS] do proximo turno. Fire-and-forget — em paralelo
    // com a persistencia da nova oferta abaixo, ambos sao independentes.
    if (outcomeResult.wasRefusal) {
      void persistOfferSlotsRefusal({
        tenantId: input.tenantId,
        contactPhone: input.contactPhone,
        conversationId: input.conversationId,
        userMessage: input.userContent,
        openaiClient: input.client,
      });
    }

    // 7c. Persistência de OFFER_SLOTS (para ver desfecho no próximo turno).
    if (parsed.action !== "OFFER_SLOTS" || parsed.slot_ids.length === 0) return;
    const offeredSlots = parsed.slot_ids
      .map((sid) => slotsWithIds.find((s) => s.id === sid))
      .filter((s): s is SlotWithId => !!s);
    if (offeredSlots.length === 0) return;
    const slotLabels = offeredSlots.map((s) => {
      const [y, m, d] = s.date.split("-");
      return `${d}/${m} ${s.time.slice(0, 5)}`;
    });
    await persistOfferSlotsSignal({
      tenantId: input.tenantId,
      contactPhone: input.contactPhone,
      conversationId: input.conversationId,
      slotIds: parsed.slot_ids,
      slotLabels,
      professionalId: parsed.professional_id ?? null,
    });
  });
  void offerSideEffects;

  // 7d. Task #1 — Atualiza offset de paginação via helper puro
  // `computeNextSlotOffset`. Avança APENAS quando OFFER_SLOTS+request_more,
  // pelo número de slots EFETIVAMENTE oferecidos como cards (parsed.slot_ids
  // .length) — nunca pelo Top-K, para não pular slots que o paciente
  // jamais viu. Reset em CONFIRM_SLOT e em qualquer outra ação.
  // Adicionalmente, se applyPagination fez auto-reset por exhaustion,
  // persistimos o reset para limpar o estado salvo.
  const nextOffset = computeNextSlotOffset({
    action: parsed.action,
    requestMoreSlots: parsed.request_more_slots,
    currentOffset: pagination.effectiveOffset,
    offered: parsed.slot_ids.length,
    totalRawSlots,
  });
  // Só escreve se houve mudança em relação ao estado anterior (input.slotOffset).
  if (nextOffset !== (input.slotOffset ?? 0) || pagination.didReset) {
    void setSlotOffset({
      tenantId: input.tenantId,
      contactPhone: input.contactPhone,
      conversationId: input.conversationId,
      offset: nextOffset,
    });
  }

  // Task #11 — sinalização de "agenda esgotada" para o próximo turno.
  // Quando o motor fez wrap-around (paciente pediu mais até estourar), grava
  // o marcador `slot_exhausted` em ai_contact_memory; `buildFactsBlock` lê
  // no próximo turno e injeta o bullet "lista de horarios esgotada..." que
  // a IA reconhece via REGRA #7. Sem isso a IA reoferece silenciosamente os
  // mesmos primeiros slots e o paciente perde a confiança.
  // Limpamos em CONFIRM_SLOT (paciente fechou agenda) — TTL de 30min cobre
  // os demais casos (paciente desiste, conversa muda de assunto, etc.).
  if (pagination.didReset && parsed.action === "OFFER_SLOTS") {
    void persistSlotExhaustedSignal({
      tenantId: input.tenantId,
      contactPhone: input.contactPhone,
      conversationId: input.conversationId,
    });
  } else if (parsed.action === "CONFIRM_SLOT") {
    void clearSlotExhaustedSignal({
      tenantId: input.tenantId,
      contactPhone: input.contactPhone,
    });
  }

  // 8. Validação fina (apenas termos proibidos) + ENFORCEMENT ─────────────
  // Reaproveita a fonte da verdade definida no fix anterior.
  const clinicAcceptsAnyInsurance = clinicEffectivelyAcceptsInsurance(
    null, // settings.acceptsInsurance é ignorado por design
    input.professionals,
  );
  const violations = validateConstrainedReply(renderedRaw.text, {
    isInsuranceContact: input.isInsuranceContact,
    insurancePlans: input.insurancePlans ?? null,
    clinicAcceptsAnyInsurance,
  });

  // Se houver violações, o renderer substitui o texto por um fallback seguro
  // (mantém slot/marker/criação de agendamento — só protege o texto exibido).
  const rendered = applyViolationFallback(renderedRaw, violations);

  // Task #1 — métricas de observabilidade do contexto restrito.
  const factsBlockPresent = !!(input.factsBlock && input.factsBlock.trim());
  const summaryBlockPresent = !!(input.patientContext && input.patientContext.trim());
  const slotsAvailableTotal = input.totalAvailableSlots ?? input.availableSlots.length;
  const slotsShown = slotsWithIds.length;
  // Heurística: cada slot no formato compacto (`s1|seg 27/04 14h|p1`) custa ~13
  // chars a menos que o formato verboso anterior (`s1: Sex 27/04 14h00 — Dr. X`).
  // ~13 chars / 4 chars-por-token ≈ 3 tokens economizados por slot exibido.
  const promptTokensSavedEstimate = slotsShown * 3;

  // Task #4 — observabilidade da paginação de slots. `request_more_slots`
  // expõe quando a IA sinalizou "paciente quer ver mais opções" no turno
  // atual; `slot_offset_used` é o ponto de partida no array bruto que o
  // turno consumiu (vindo do turno anterior); `slot_offset_next` é o que
  // será gravado para o próximo turno (0 quando reset).
  const violationTypes: string[] = violations.map((v) => v.type);
  // Violation estrutural: IA emitiu CONFIRM_SLOT mas o slot não foi resolvido
  // (slot_id vazio ou desconhecido). O renderer já degradou para texto seguro,
  // mas registramos no log para o operador identificar quando isso ocorre —
  // tipicamente sinaliza upstream-skip de availability ou modelo confuso.
  if (parsed.action === "CONFIRM_SLOT" && !inlineAppointment) {
    violationTypes.push("confirm_slot_unresolved");
  }
  // Linha de alta visibilidade — formato grep-friendly para acompanhamento
  // operacional do caminho restrito (Task #16 follow-up). Use:
  //   refresh_all_logs / logs do workflow + filtro "[CONSTRAINED]"
  logger.info(
    `[CONSTRAINED] tenant=${input.tenantId} conv=${input.conversationId} ` +
      `action=${parsed.action} violations=[${violationTypes.join(",")}] ` +
      `slots=${slotsShown}/${slotsAvailableTotal} prof=${parsed.professional_id ?? "-"} ` +
      `model=${modelUsed} appt=${inlineAppointment ? "yes" : "no"} ` +
      `latency_ms=${Date.now() - startTs}`,
  );

  logger.info(
    {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      constrained_action: parsed.action,
      constrained_slot_ids: parsed.slot_ids,
      constrained_prof_id: parsed.professional_id,
      request_more_slots: parsed.request_more_slots === true,
      slot_offset_used: pagination.effectiveOffset,
      slot_offset_next: nextOffset,
      slot_offset_did_reset: pagination.didReset,
      slots_offered: slotsShown,
      slots_available_total: slotsAvailableTotal,
      slots_shown_vs_available: `${slotsShown}/${slotsAvailableTotal}`,
      professionals_listed: profsWithIds.length,
      facts_block_present: factsBlockPresent,
      summary_block_present: summaryBlockPresent,
      prompt_tokens_saved_estimate: promptTokensSavedEstimate,
      model_used: modelUsed,
      latency_ms: Date.now() - startTs,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      cached_tokens: cachedTokens,
      violations: violationTypes,
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
    factsBlockPresent,
    summaryBlockPresent,
    slotsShown,
    slotsAvailableTotal,
    promptTokensSavedEstimate,
  };
}
