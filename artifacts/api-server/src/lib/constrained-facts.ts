/**
 * Task #1 — Engenharia de contexto da geração restrita.
 *
 * Constrói o bloco [FATOS] determinístico injetado no prompt restrito a partir
 * de fontes 100% server-side (sem tocar no histórico de mensagens):
 *   - dental_leads.paymentType / professionalId  → preferência de pagamento e
 *     profissional já mapeados pelo onboarding/captura.
 *   - ai_contact_memory                           → fatos extraídos das conversas
 *     anteriores (medos, preferências, histórico médico, etc.).
 *
 * Também expõe `persistConfirmSlotSignal()` que registra um fato de "agendou
 * com X em Y" sempre que CONFIRM_SLOT é despachado pelo motor restrito.
 *
 * Contrato:
 *   - Texto retornado é compacto (≤ ~6 bullets, ≤ ~80 chars cada) e sanitizado
 *     contra prompt injection — qualquer instrução textual em ai_contact_memory
 *     é neutralizada antes de virar parte do prompt.
 *   - Falhas NUNCA quebram a resposta da IA: tudo é try/catch com logger.warn.
 */

import type { OpenAI } from "@workspace/integrations-openai-ai-server";
import { db } from "@workspace/db";
import { dentalLeadsTable, aiContactMemoryTable } from "@workspace/db";
import { and, eq, desc, ne } from "drizzle-orm";
import { logger } from "./logger";
import { maskPhone } from "./pii-mask";

const MAX_MEMORIES_IN_FACTS = 4;
const MAX_FACT_CHARS = 80;
/** Memory types reservados — controlados pelo motor restrito, não exibidos como bullets livres. */
const RESERVED_MEMORY_TYPES = new Set(["agendamento", "ultima_oferta", "slot_offset"]);
const MAX_OFFER_OUTCOME_CHARS = 90;

/**
 * Sanitização defensiva idêntica em espírito à de ai-learning.ts:
 * neutraliza papéis (system:/assistant:), tentativas de jailbreak e trunca
 * para evitar inflar o prompt. ai_contact_memory.content é texto livre vindo
 * de uma extração LLM — tratar como conteúdo do paciente, não como instrução.
 */
function sanitizeFactContent(text: string): string {
  return text
    .replace(/\b(system|assistant|user|SYSTEM|ASSISTANT|USER)\s*:/gi, "")
    .replace(/ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/gi, "[filtrado]")
    .replace(/you\s+(are|must|should|will)\s+now/gi, "[filtrado]")
    .replace(/new\s+(instructions?|rules?|role|persona)/gi, "[filtrado]")
    .replace(/pretend\s+(to\s+be|you\s+are)/gi, "[filtrado]")
    .replace(/act\s+as\s+(a|an|if)/gi, "[filtrado]")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, MAX_FACT_CHARS);
}

function normalizePaymentType(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.toLowerCase().trim();
  if (v.includes("conv") || v.includes("plano")) return "convenio";
  if (v.includes("part")) return "particular";
  return v.substring(0, 20);
}

export interface FactsBlockResult {
  /** Texto do bloco [FATOS] já formatado, ou null quando não há fatos. */
  text: string | null;
  /** Quantos bullets foram efetivamente renderizados (para métricas). */
  factCount: number;
}

/**
 * Carrega fatos persistidos do contato e devolve o bloco [FATOS] pronto para
 * concatenação no prompt restrito. Ordem de prioridade:
 *   1. pagamento (decisão comercial mais relevante)
 *   2. profissional preferido (curto: usa pId interno)
 *   3. memórias livres (medo / preferência / histórico_medico / interesse)
 *
 * Lookup de profissional preferido é resolvido fora desta função (passado
 * via `profIdShortByDbId`) porque o engine já tem essa tabela em memória.
 */
export async function buildFactsBlock(
  tenantId: number,
  contactPhone: string,
  profIdShortByDbId: Map<number, string>,
): Promise<FactsBlockResult> {
  if (!tenantId || !contactPhone) return { text: null, factCount: 0 };

  try {
    const [lead, memories] = await Promise.all([
      db.query.dentalLeadsTable.findFirst({
        where: and(eq(dentalLeadsTable.tenantId, tenantId), eq(dentalLeadsTable.phone, contactPhone)),
      }),
      db.query.aiContactMemoryTable.findMany({
        where: and(
          eq(aiContactMemoryTable.tenantId, tenantId),
          eq(aiContactMemoryTable.contactPhone, contactPhone),
          ne(aiContactMemoryTable.status, "rejected"),
        ),
        orderBy: [desc(aiContactMemoryTable.createdAt)],
        limit: MAX_MEMORIES_IN_FACTS * 2,
      }),
    ]);

    const bullets: string[] = [];

    const pay = normalizePaymentType(lead?.paymentType);
    if (pay) bullets.push(`pagamento: ${pay}`);

    if (lead?.professionalId != null) {
      const pIdShort = profIdShortByDbId.get(lead.professionalId);
      if (pIdShort) bullets.push(`prof preferido: ${pIdShort}`);
    }

    // Task #1 — incluir bullet de "ultima oferta" + desfecho ANTES das memórias
    // livres, pois é o sinal mais relevante para evitar reoferta de slots
    // recusados / repetir uma oferta já aceita. A memória reservada
    // "ultima_oferta" é mantida pelo motor (persistOfferSlotsSignal +
    // updateLastOfferOutcome).
    const lastOffer = memories.find((m) => m.memoryType === "ultima_oferta");
    if (lastOffer) {
      const cleaned = (lastOffer.editedContent || lastOffer.content || "")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, MAX_OFFER_OUTCOME_CHARS);
      if (cleaned) bullets.push(`ultima oferta: ${cleaned}`);
    }

    // Dedup case-insensitive de conteúdo, preserva tipo p/ etiqueta.
    // Pula tipos reservados (agendamento/ultima_oferta/slot_offset) — esses
    // são tratados separadamente ou são metadados internos.
    const seen = new Set<string>();
    let memCount = 0;
    for (const m of memories) {
      if (memCount >= MAX_MEMORIES_IN_FACTS) break;
      if (RESERVED_MEMORY_TYPES.has(m.memoryType || "")) continue;
      const cleaned = sanitizeFactContent(m.editedContent || m.content || "");
      if (!cleaned) continue;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const type = (m.memoryType || "fato").substring(0, 20);
      bullets.push(`${type}: ${cleaned}`);
      memCount += 1;
    }

    if (bullets.length === 0) return { text: null, factCount: 0 };

    const text = `[FATOS] (contexto persistente — NAO repita literalmente no reply)\n${bullets
      .map((b) => `- ${b}`)
      .join("\n")}`;

    return { text, factCount: bullets.length };
  } catch (err) {
    logger.warn(
      { err, tenantId, contactPhone: maskPhone(contactPhone) },
      "constrained-facts: failed to build facts block",
    );
    return { text: null, factCount: 0 };
  }
}

/**
 * Dedup in-memory por chave (tenant|phone|date|time) com TTL curto.
 *
 * O check `existing.some(...)` no DB cobre a janela de horas/dias, mas duas
 * chamadas concorrentes (ex.: webhook duplicado, retry da Evolution API)
 * podem fazer read-then-insert ao mesmo tempo e duplicar a memória. Este
 * mutex local elimina esse caso comum (mesmo processo, mesma janela curta)
 * sem exigir mudança de schema/migration.
 *
 * O TTL é alto o suficiente p/ cobrir retries simultâneos (60s) e baixo o
 * suficiente p/ não acumular memória no processo (limpeza preguiçosa).
 */
const inflightConfirmSignals = new Map<string, number>();
const INFLIGHT_TTL_MS = 60_000;

function reserveInflight(key: string): boolean {
  const now = Date.now();
  // Limpeza preguiçosa: se a tabela passou de 200 entradas, varre uma vez.
  if (inflightConfirmSignals.size > 200) {
    for (const [k, exp] of inflightConfirmSignals) {
      if (exp <= now) inflightConfirmSignals.delete(k);
    }
  }
  const existing = inflightConfirmSignals.get(key);
  if (existing && existing > now) return false;
  inflightConfirmSignals.set(key, now + INFLIGHT_TTL_MS);
  return true;
}

/**
 * Persiste um sinal de "agendou com X em Y" no `ai_contact_memory` quando o
 * motor restrito despacha CONFIRM_SLOT. Fire-and-forget: NUNCA throw.
 *
 * Dedup em duas camadas:
 *   1. In-memory mutex (tenant|phone|date|time) com TTL de 60s — protege
 *      contra retries simultâneos no MESMO processo.
 *   2. find-then-insert no DB — protege contra reentradas em janelas longas
 *      (post-restart, distribuição cross-process).
 */
export async function persistConfirmSlotSignal(args: {
  tenantId: number;
  contactPhone: string;
  conversationId: number;
  professionalName: string | null;
  date: string;
  time: string;
}): Promise<void> {
  const { tenantId, contactPhone, conversationId, professionalName, date, time } = args;
  if (!tenantId || !contactPhone || !date) return;

  // Camada 1: in-memory dedup. Se outra task já está inserindo este sinal,
  // simplesmente retorna sem tocar no DB.
  const inflightKey = `${tenantId}|${contactPhone}|${date}|${time}`;
  if (!reserveInflight(inflightKey)) return;

  try {
    const [y, m, d] = date.split("-");
    const dateBR = `${d}/${m}/${y.slice(2)}`;
    const profPart = professionalName ? ` com ${professionalName.substring(0, 60)}` : "";
    const content = `agendou${profPart} em ${dateBR} ${time}`;

    const existing = await db.query.aiContactMemoryTable.findMany({
      where: and(
        eq(aiContactMemoryTable.tenantId, tenantId),
        eq(aiContactMemoryTable.contactPhone, contactPhone),
        eq(aiContactMemoryTable.memoryType, "agendamento"),
      ),
      orderBy: [desc(aiContactMemoryTable.createdAt)],
      limit: 5,
    });
    if (existing.some((e) => (e.content || "").toLowerCase() === content.toLowerCase())) {
      return;
    }

    await db.insert(aiContactMemoryTable).values({
      tenantId,
      contactPhone,
      memoryType: "agendamento",
      content,
      source: "auto",
      conversationId,
    });

    logger.info(
      { tenantId, contactPhone: maskPhone(contactPhone), conversationId },
      "constrained-facts: persisted CONFIRM_SLOT signal",
    );
  } catch (err) {
    logger.warn(
      { err, tenantId, contactPhone: maskPhone(contactPhone), conversationId },
      "constrained-facts: failed to persist CONFIRM_SLOT signal",
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Task #1 — Captura de OFFER_SLOTS + desfecho do paciente.
//
// Estratégia: ao despachar OFFER_SLOTS, gravamos uma memória "ultima_oferta"
// com `pendente`. No turno seguinte, antes de chamar o LLM, atualizamos o
// desfecho conforme o que aconteceu:
//   - CONFIRM_SLOT  → "aceitou: sX (DD/MM HH:mm)"
//   - OFFER_SLOTS   → "recusou (reofertou)"
//   - ASK_INFO/REPLY/ESCALATE → "recusou (sem reoferta)"
//   - SEND_PIX/SEND_FEE → mantém pendente (não é resposta direta sobre a oferta)
//
// O bullet aparece em [FATOS] como "ultima oferta: <conteudo>" — assim a IA
// vê tanto a oferta anterior quanto o desfecho e evita repetir slots
// recusados ou reoferecer um já aceito.
// ──────────────────────────────────────────────────────────────────────────

function ymdToBR(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

/**
 * Persiste sinal de OFFER_SLOTS recém-despachado. Substitui qualquer
 * "ultima_oferta" anterior do mesmo contato (mantemos só a mais recente
 * para não inflar o [FATOS]).
 */
export async function persistOfferSlotsSignal(args: {
  tenantId: number;
  contactPhone: string;
  conversationId: number;
  slotIds: string[];
  slotLabels: string[]; // ex.: ["27/04 09h", "28/04 14h"]
  professionalId: string | null;
}): Promise<void> {
  const { tenantId, contactPhone, conversationId, slotIds, slotLabels, professionalId } = args;
  if (!tenantId || !contactPhone || slotIds.length === 0) return;

  try {
    const labelStr = slotIds
      .map((id, i) => `${id}=${slotLabels[i] ?? "?"}`)
      .join(", ")
      .substring(0, 60);
    const profPart = professionalId ? ` ${professionalId}` : "";
    const content = `ofereceu${profPart} ${labelStr} | desfecho: pendente`;

    // Apaga ofertas anteriores do mesmo contato (mantemos só a mais recente).
    await db
      .delete(aiContactMemoryTable)
      .where(
        and(
          eq(aiContactMemoryTable.tenantId, tenantId),
          eq(aiContactMemoryTable.contactPhone, contactPhone),
          eq(aiContactMemoryTable.memoryType, "ultima_oferta"),
        ),
      );

    await db.insert(aiContactMemoryTable).values({
      tenantId,
      contactPhone,
      memoryType: "ultima_oferta",
      content,
      source: "auto",
      conversationId,
    });
  } catch (err) {
    logger.warn(
      { err, tenantId, contactPhone: maskPhone(contactPhone), conversationId },
      "constrained-facts: failed to persist OFFER_SLOTS signal",
    );
  }
}

/**
 * Atualiza o desfecho da última oferta pendente. Chamado APÓS o dispatch
 * do turno atual. Map de ações para desfecho:
 *
 *   action atual        | desfecho registrado na ultima_oferta
 *   --------------------|---------------------------------------
 *   CONFIRM_SLOT        | "aceitou: <slotId> (<DD/MM HH:mm>)"
 *   OFFER_SLOTS         | "recusou (reofertou)"
 *   ASK_INFO/JUST_REPLY | "recusou (sem reoferta)"
 *   ESCALATE            | "recusou (escalou p/ humano)"
 *   SEND_PIX/SEND_FEE   | (mantém pendente — não é resposta sobre a oferta)
 */
export interface UpdateLastOfferOutcomeResult {
  /** Se houve transição de pendente → recusou (qualquer flavor). Sinaliza ao caller para extrair preferências da recusa (Task #3). */
  wasRefusal: boolean;
}

export async function updateLastOfferOutcome(args: {
  tenantId: number;
  contactPhone: string;
  currentAction: string;
  acceptedSlotId?: string | null;
  acceptedSlotLabel?: string | null;
}): Promise<UpdateLastOfferOutcomeResult> {
  const { tenantId, contactPhone, currentAction, acceptedSlotId, acceptedSlotLabel } = args;
  if (!tenantId || !contactPhone) return { wasRefusal: false };

  // Ações que não desfecham a oferta — mantemos pendente.
  if (currentAction === "SEND_PIX" || currentAction === "SEND_FEE") return { wasRefusal: false };

  let outcome: string;
  let wasRefusal = false;
  if (currentAction === "CONFIRM_SLOT") {
    outcome = acceptedSlotId
      ? `aceitou: ${acceptedSlotId}${acceptedSlotLabel ? ` (${acceptedSlotLabel})` : ""}`
      : "aceitou";
  } else if (currentAction === "OFFER_SLOTS") {
    outcome = "recusou (reofertou)";
    wasRefusal = true;
  } else if (currentAction === "ESCALATE") {
    outcome = "recusou (escalou p/ humano)";
    wasRefusal = true;
  } else {
    outcome = "recusou (sem reoferta)";
    wasRefusal = true;
  }

  try {
    const [lastOffer] = await db
      .select()
      .from(aiContactMemoryTable)
      .where(
        and(
          eq(aiContactMemoryTable.tenantId, tenantId),
          eq(aiContactMemoryTable.contactPhone, contactPhone),
          eq(aiContactMemoryTable.memoryType, "ultima_oferta"),
        ),
      )
      .orderBy(desc(aiContactMemoryTable.createdAt))
      .limit(1);

    if (!lastOffer) return { wasRefusal: false };
    // Só atualiza se ainda estiver pendente (evita sobrescrever decisões já registradas).
    // Importante: se já não está pendente, não conta como recusa "deste turno"
    // — caller não deve disparar o extractor de preferências de novo.
    if (!/desfecho:\s*pendente/i.test(lastOffer.content || "")) return { wasRefusal: false };

    const newContent = (lastOffer.content || "")
      .replace(/desfecho:\s*pendente/i, `desfecho: ${outcome}`)
      .substring(0, MAX_OFFER_OUTCOME_CHARS);

    await db
      .update(aiContactMemoryTable)
      .set({ content: newContent })
      .where(eq(aiContactMemoryTable.id, lastOffer.id));

    return { wasRefusal };
  } catch (err) {
    logger.warn(
      { err, tenantId, contactPhone: maskPhone(contactPhone), currentAction },
      "constrained-facts: failed to update last offer outcome",
    );
    return { wasRefusal: false };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Task #3 — Captura de preferências a partir de RECUSA de oferta.
//
// Quando a IA OFERECE horários e o paciente RECUSA ("só de manhã", "essa
// semana não dá", "quarta não consigo"), extraímos as preferências/restrições
// implícitas e persistimos como memória do tipo "preferencia". O bloco
// [FATOS] já passa essas memórias livres para o próximo turno, então a IA
// para de reoferecer slots inviáveis automaticamente.
//
// Trigger: `runConstrainedGeneration` chama esta função APÓS
// `updateLastOfferOutcome` retornar wasRefusal=true. Fire-and-forget: o
// custo do gpt-5-nano é baixo (<$0.0001/chamada) e a chamada NUNCA bloqueia
// a resposta enviada ao paciente.
// ──────────────────────────────────────────────────────────────────────────

const MAX_REFUSAL_PREFS_PER_TURN = 3;
const MIN_REFUSAL_MSG_LEN = 4;
const MAX_REFUSAL_MSG_LEN = 500;

const REFUSAL_EXTRACTION_PROMPT = `Voce recebe a MENSAGEM de um paciente que acabou de RECUSAR horarios de consulta odontologica oferecidos pela secretaria.
Sua tarefa e extrair as PREFERENCIAS ou RESTRICOES de horario implicitas na recusa, para que a secretaria nao reoferezca slots inviaveis no proximo turno.

Exemplos de extracao (mensagem -> preferencia):
- "so de manha" -> "so pode de manha"
- "tarde nao da" -> "recusou: tarde"
- "essa semana to viajando" -> "recusou: essa semana"
- "quarta nao consigo" -> "recusou: quarta-feira"
- "depois das 18h" -> "so pode depois das 18h"
- "nenhum desses serve" -> NAO extraia nada (sem informacao util)
- "ok obrigado" -> NAO extraia nada
- "pode ser amanha?" -> NAO extraia nada (e contraproposta, nao restricao)

Regras:
- Extraia APENAS informacoes que ajudem a filtrar slots futuros (periodo do dia, dia da semana, semana, faixa de horario).
- NAO invente. Se a recusa nao traz informacao especifica, retorne lista vazia.
- Cada preferencia deve caber em ate 60 caracteres.
- Maximo de 3 preferencias.

Responda APENAS com JSON valido (sem markdown):
{"preferences": [{"content": "texto curto da preferencia/restricao"}]}`;

function sanitizeRefusalPref(text: string): string {
  return text
    .replace(/\b(system|assistant|user|SYSTEM|ASSISTANT|USER)\s*:/gi, "")
    .replace(/ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/gi, "[filtrado]")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 60);
}

/**
 * Extrai e persiste preferencias/restricoes de horario a partir da mensagem
 * de RECUSA do paciente. Fire-and-forget — NUNCA throw, NUNCA bloqueia a
 * resposta ao paciente (chamado pelo engine via `void` em background).
 *
 * Idempotente: faz dedup case-insensitive contra memorias "preferencia"
 * existentes do mesmo contato antes de inserir.
 */
export async function persistOfferSlotsRefusal(args: {
  tenantId: number;
  contactPhone: string;
  conversationId: number;
  userMessage: string;
  openaiClient: OpenAI;
}): Promise<void> {
  const { tenantId, contactPhone, conversationId, userMessage, openaiClient } = args;
  if (!tenantId || !contactPhone || !openaiClient) return;

  const cleanedMsg = (userMessage || "").trim();
  if (cleanedMsg.length < MIN_REFUSAL_MSG_LEN || cleanedMsg.length > MAX_REFUSAL_MSG_LEN) return;

  try {
    const response = await openaiClient.chat.completions.create({
      model: "gpt-5-nano",
      max_completion_tokens: 200,
      temperature: 0.2,
      messages: [
        { role: "system", content: REFUSAL_EXTRACTION_PROMPT },
        { role: "user", content: cleanedMsg },
      ],
    });

    const text = response.choices[0]?.message?.content || "{}";
    const stripped = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(stripped) as { preferences?: Array<{ content?: string }> };

    const prefs = (parsed.preferences || [])
      .map((p) => (p && typeof p.content === "string" ? sanitizeRefusalPref(p.content) : ""))
      .filter((c): c is string => !!c)
      .slice(0, MAX_REFUSAL_PREFS_PER_TURN);

    if (prefs.length === 0) return;

    // Dedup contra memorias "preferencia" existentes do mesmo contato.
    const existing = await db.query.aiContactMemoryTable.findMany({
      where: and(
        eq(aiContactMemoryTable.tenantId, tenantId),
        eq(aiContactMemoryTable.contactPhone, contactPhone),
        eq(aiContactMemoryTable.memoryType, "preferencia"),
        ne(aiContactMemoryTable.status, "rejected"),
      ),
    });
    const existingSet = new Set(
      existing.map((e) => (e.editedContent || e.content || "").toLowerCase().trim()),
    );

    const toInsert = prefs.filter((c) => !existingSet.has(c.toLowerCase()));
    if (toInsert.length === 0) return;

    await db.insert(aiContactMemoryTable).values(
      toInsert.map((content) => ({
        tenantId,
        contactPhone,
        memoryType: "preferencia",
        content,
        source: "auto" as const,
        conversationId,
      })),
    );

    logger.info(
      { tenantId, contactPhone: maskPhone(contactPhone), conversationId, count: toInsert.length },
      "constrained-facts: persisted OFFER_SLOTS refusal preferences",
    );
  } catch (err) {
    logger.warn(
      { err, tenantId, contactPhone: maskPhone(contactPhone), conversationId },
      "constrained-facts: failed to persist OFFER_SLOTS refusal preferences",
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Task #1 — Paginação determinística de slots (request_more_slots).
//
// Quando a IA responde com `request_more_slots: true`, persistimos um offset
// numérico em ai_contact_memory (tipo "slot_offset", content = "12") para
// que o próximo turno comece exibindo a partir desse offset. Reset para 0
// quando há CONFIRM_SLOT ou quando passa muito tempo sem oferta.
// ──────────────────────────────────────────────────────────────────────────

const MAX_SLOT_OFFSET = 60; // saneamento: nunca pular mais que 60 slots à frente.

export async function getSlotOffset(tenantId: number, contactPhone: string): Promise<number> {
  if (!tenantId || !contactPhone) return 0;
  try {
    const [row] = await db
      .select()
      .from(aiContactMemoryTable)
      .where(
        and(
          eq(aiContactMemoryTable.tenantId, tenantId),
          eq(aiContactMemoryTable.contactPhone, contactPhone),
          eq(aiContactMemoryTable.memoryType, "slot_offset"),
        ),
      )
      .orderBy(desc(aiContactMemoryTable.createdAt))
      .limit(1);
    const v = Number(row?.content ?? 0);
    if (!Number.isFinite(v) || v < 0) return 0;
    return Math.min(v, MAX_SLOT_OFFSET);
  } catch {
    return 0;
  }
}

export async function setSlotOffset(args: {
  tenantId: number;
  contactPhone: string;
  conversationId: number;
  offset: number;
}): Promise<void> {
  const { tenantId, contactPhone, conversationId, offset } = args;
  if (!tenantId || !contactPhone) return;
  const safe = Math.max(0, Math.min(MAX_SLOT_OFFSET, Math.floor(offset)));
  try {
    // Sempre apaga e recria — só queremos a versão mais recente.
    await db
      .delete(aiContactMemoryTable)
      .where(
        and(
          eq(aiContactMemoryTable.tenantId, tenantId),
          eq(aiContactMemoryTable.contactPhone, contactPhone),
          eq(aiContactMemoryTable.memoryType, "slot_offset"),
        ),
      );
    if (safe > 0) {
      await db.insert(aiContactMemoryTable).values({
        tenantId,
        contactPhone,
        memoryType: "slot_offset",
        content: String(safe),
        source: "auto",
        conversationId,
      });
    }
  } catch (err) {
    logger.warn(
      { err, tenantId, contactPhone: maskPhone(contactPhone), offset: safe },
      "constrained-facts: failed to set slot offset",
    );
  }
}

// Exporta funções utilitárias usadas em testes.
export const _internal = { ymdToBR };
