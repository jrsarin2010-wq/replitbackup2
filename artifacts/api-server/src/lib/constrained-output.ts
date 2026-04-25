/**
 * Task #25 — Constrained AI generation.
 *
 * Schema JSON estruturado que força a IA a escolher slots e profissionais por
 * ID em vez de escrever data/hora/nomes próprios em texto livre. Eliminação
 * arquitetural dos bugs de "horário fantasma", "profissional inválido" e
 * "agenda inventada".
 *
 * Fluxo:
 *   1. Servidor pré-computa slots disponíveis e atribui IDs estáveis (s1, s2…).
 *   2. Servidor monta JSON Schema com enums dinâmicos (slot_ids ⊆ {s1,s2,…},
 *      professional_id ⊆ {p1,p2,…}).
 *   3. OpenAI retorna `StructuredAIResponse` — qualquer ID fora dos enums é
 *      rejeitado pelo próprio JSON Schema (strict: true).
 *   4. Render layer transforma a resposta em texto final do WhatsApp,
 *      injetando determinísticamente data/hora/nome do profissional.
 *
 * IDs são válidos apenas durante o turno. Não persistir.
 */

import type { AvailableSlot } from "./schedule-engine";

// ──────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ──────────────────────────────────────────────────────────────────────────

export type ConstrainedAction =
  | "OFFER_SLOTS"
  | "CONFIRM_SLOT"
  | "SEND_PIX"
  | "SEND_FEE"
  | "ASK_INFO"
  | "ESCALATE"
  | "JUST_REPLY";

export interface SlotWithId extends AvailableSlot {
  /** ID estável dentro do turno (s1, s2, …). */
  id: string;
  /** Rótulo legível em pt-BR (ex.: "Sex 25/04 14h00 — Dr. Carlos"). Usado pelo render layer. */
  label: string;
  /** Rótulo compacto p/ uso APENAS dentro do prompt (ex.: "sex 25/04 14h|p1"). */
  compactLabel: string;
}

export interface ProfessionalWithId {
  /** ID estável dentro do turno (p1, p2, …). */
  id: string;
  /** ID numérico no banco. */
  professionalId: number;
  name: string;
}

export interface StructuredAIResponse {
  action: ConstrainedAction;
  /** IDs dos slots envolvidos (obrigatório p/ OFFER_SLOTS e CONFIRM_SLOT). */
  slot_ids: string[];
  /** ID do profissional escolhido (obrigatório p/ CONFIRM_SLOT). */
  professional_id: string | null;
  /** Texto empático/conversacional. NÃO deve conter datas, horas, preços nem
   *  nomes próprios — esses são injetados pelo render layer. */
  reply_text: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Atribuição de IDs
// ──────────────────────────────────────────────────────────────────────────

/**
 * Recebe a lista bruta de slots disponíveis e devolve até `limit` slots com
 * IDs estáveis e label legível. Ordem preservada (mesma do schedule-engine).
 */
export function assignSlotIds(
  slots: AvailableSlot[],
  professionals: Array<{ id: number; name: string }>,
  limit = 6,
): SlotWithId[] {
  const profById = new Map(professionals.map((p) => [p.id, p.name]));
  // pId mapping (numeric profId → "pN") deve seguir a MESMA ordem que
  // assignProfessionalIds usa, garantindo que compactLabel referencie o
  // mesmo "pX" que o prompt apresenta no bloco [PROFISSIONAIS].
  const pIdByProfId = new Map<number, string>();
  professionals.forEach((p, i) => pIdByProfId.set(p.id, `p${i + 1}`));
  return slots.slice(0, limit).map((slot, i) => {
    const profName = slot.professionalId != null ? profById.get(slot.professionalId) : null;
    const pIdShort = slot.professionalId != null ? pIdByProfId.get(slot.professionalId) ?? null : null;
    return {
      ...slot,
      id: `s${i + 1}`,
      label: formatSlotLabel(slot, profName),
      compactLabel: formatSlotCompact(slot, pIdShort),
    };
  });
}

export function assignProfessionalIds(
  professionals: Array<{ id: number; name: string }>,
): ProfessionalWithId[] {
  return professionals.map((p, i) => ({
    id: `p${i + 1}`,
    professionalId: p.id,
    name: p.name,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// JSON Schema dinâmico
// ──────────────────────────────────────────────────────────────────────────

/**
 * Constrói o JSON Schema para `response_format: { type: "json_schema" }`.
 * Os enums de `slot_ids` e `professional_id` são derivados das listas reais —
 * a IA não consegue escolher um ID que não existe.
 *
 * Quando não há slots ou profissionais, ainda devolvemos um schema válido
 * (a IA deve emitir `JUST_REPLY` ou `ASK_INFO`).
 */
export function buildResponseSchema(
  slots: SlotWithId[],
  professionals: ProfessionalWithId[],
) {
  const slotIdEnum = slots.length > 0 ? slots.map((s) => s.id) : [""];
  const proIdEnum = professionals.length > 0 ? professionals.map((p) => p.id) : [""];

  return {
    type: "json_schema" as const,
    json_schema: {
      name: "dental_constrained_response",
      strict: true,
      schema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "OFFER_SLOTS",
              "CONFIRM_SLOT",
              "SEND_PIX",
              "SEND_FEE",
              "ASK_INFO",
              "ESCALATE",
              "JUST_REPLY",
            ],
            description: "Ação determinística que o servidor vai executar.",
          },
          slot_ids: {
            type: "array",
            items: { type: "string", enum: slotIdEnum },
            description:
              "IDs dos slots (s1, s2…). OFFER_SLOTS=1-2, CONFIRM_SLOT=1, demais=[].",
          },
          professional_id: {
            anyOf: [
              { type: "string", enum: proIdEnum },
              { type: "null" },
            ],
            description: "ID do profissional escolhido (p1, p2…). null quando não aplicável.",
          },
          reply_text: {
            type: "string",
            description:
              "Texto empático em pt-BR (1-3 frases, WhatsApp). PROIBIDO: datas, horas, preços, nomes próprios — o servidor injeta tudo isso ao renderizar.",
          },
        },
        required: ["action", "slot_ids", "professional_id", "reply_text"],
        additionalProperties: false,
      },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Formatação interna
// ──────────────────────────────────────────────────────────────────────────

const DAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];

/** "Sex 25/04 14h00 — Dr. Carlos" / "Sex 25/04 14h00" se prof = null. */
export function formatSlotLabel(slot: AvailableSlot, profName: string | null | undefined): string {
  const [y, m, d] = slot.date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = DAY_SHORT[dt.getUTCDay()];
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const [hh, mi] = slot.time.split(":");
  const timeStr = mi === "00" ? `${hh}h` : `${hh}h${mi}`;
  return profName ? `${dow} ${dd}/${mm} ${timeStr} — ${profName}` : `${dow} ${dd}/${mm} ${timeStr}`;
}

const DAY_COMPACT = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];

/**
 * Versão compacta usada APENAS dentro do prompt do LLM. Reduz tokens em ~30%
 * por slot vs. `formatSlotLabel`. Formato: "seg 27/04 14h|p1" (ou "...|s/p" quando
 * o slot não tem profissional). Não usar no texto enviado ao paciente.
 */
export function formatSlotCompact(slot: AvailableSlot, profIdShort: string | null | undefined): string {
  const [y, m, d] = slot.date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = DAY_COMPACT[dt.getUTCDay()];
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const [hh, mi] = slot.time.split(":");
  const timeStr = mi === "00" ? `${hh}h` : `${hh}h${mi}`;
  return `${dow} ${dd}/${mm} ${timeStr}|${profIdShort ?? "s/p"}`;
}

/** Versão "humana" usada na resposta final do WhatsApp. */
export function formatSlotForReply(slot: AvailableSlot, profName: string | null | undefined): string {
  const [y, m, d] = slot.date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const todayLocal = new Date();
  const todayUtc = Date.UTC(todayLocal.getUTCFullYear(), todayLocal.getUTCMonth(), todayLocal.getUTCDate());
  const slotUtc = dt.getTime();
  const diffDays = Math.round((slotUtc - todayUtc) / 86400000);
  const dayPart =
    diffDays === 0 ? "hoje" :
    diffDays === 1 ? "amanha" :
    `${["domingo","segunda","terca","quarta","quinta","sexta","sabado"][dt.getUTCDay()]} (${String(d).padStart(2,"0")}/${String(m).padStart(2,"0")})`;
  const [hh, mi] = slot.time.split(":");
  const timeStr = mi === "00" ? `${hh}h` : `${hh}h${mi}`;
  return profName ? `${dayPart} as ${timeStr} com ${profName}` : `${dayPart} as ${timeStr}`;
}
