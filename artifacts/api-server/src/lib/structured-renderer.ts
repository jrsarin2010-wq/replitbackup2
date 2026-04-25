/**
 * Task #25 — Render layer determinístico para constrained generation.
 *
 * Recebe a `StructuredAIResponse` parseada pelo modelo + contexto do tenant
 * e devolve o texto final do WhatsApp. Toda data, hora, preço, nome próprio,
 * card PIX e marcador APT_CARD é injetado AQUI — nunca pelo modelo.
 *
 * Cada renderer é puro (input → string), o que torna o conjunto trivialmente
 * testável em golden tests.
 */

import type {
  ConstrainedAction,
  ProfessionalWithId,
  SlotWithId,
  StructuredAIResponse,
} from "./constrained-output";
import { formatSlotForReply } from "./constrained-output";
import { buildPixCardText } from "./prompt-helpers";
import { resolveConsultationFee, resolveChargesConsultation } from "./insurance-policy";

export type RenderableProfessional = {
  id: number;
  name: string;
  pixEnabled?: boolean | null;
  pixKey?: string | null;
  pixBank?: string | null;
  pixKeyType?: string | null;
  pixMode?: string | null;
  consultationFee?: string | null;
  chargesConsultation?: boolean | null;
  isOwner?: boolean | null;
  /**
   * Bug fix (Task #1, post-review #2) — campos de convênio por profissional.
   * `acceptsInsurance=false` significa "atende SÓ particular"; oferecer
   * agenda dele a um paciente de convênio é o bug que motivou esse fix.
   * `insurancePlans` é a lista textual ("Bradesco, Amil") quando atende.
   */
  acceptsInsurance?: boolean | null;
  insurancePlans?: string | null;
};

export interface RenderContext {
  slots: SlotWithId[];
  professionals: ProfessionalWithId[];
  professionalsFull: RenderableProfessional[];
  isInsuranceContact: boolean;
  settingsConsultationFee?: string | null;
  settingsChargesConsultation?: boolean | null;
  /** Nome curto da clínica (já resolvido pelo prompt-builder). */
  clinicName: string;
}

export interface RenderedReply {
  text: string;
  /** Quando true, o caller deve disparar criação determinística do agendamento
   *  usando o slot escolhido. */
  shouldCreateAppointment: boolean;
  /** Slot escolhido para CONFIRM_SLOT (já validado pelo enum do JSON Schema). */
  chosenSlot: SlotWithId | null;
  /** Profissional escolhido em CONFIRM_SLOT (resolvido via slot ou prof_id). */
  chosenProfessional: RenderableProfessional | null;
  /** Marcadores que ainda devem aparecer no texto final
   *  (compatibilidade com pipeline de envio, ex.: APT_CARD). */
  markers: string[];
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function findSlot(ctx: RenderContext, id: string | undefined | null): SlotWithId | null {
  if (!id) return null;
  return ctx.slots.find((s) => s.id === id) ?? null;
}

function findProfessional(ctx: RenderContext, id: string | undefined | null): RenderableProfessional | null {
  if (!id) return null;
  const ref = ctx.professionals.find((p) => p.id === id);
  if (!ref) return null;
  return ctx.professionalsFull.find((p) => p.id === ref.professionalId) ?? null;
}

function professionalForSlot(ctx: RenderContext, slot: SlotWithId | null): RenderableProfessional | null {
  if (!slot || slot.professionalId == null) {
    // Single-prof fallback
    if (ctx.professionalsFull.length === 1) return ctx.professionalsFull[0];
    return null;
  }
  return ctx.professionalsFull.find((p) => p.id === slot.professionalId) ?? null;
}

function aptCardMarker(slot: SlotWithId): string {
  const [y, m, d] = slot.date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayNames = ["Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"];
  const dow = dayNames[dt.getUTCDay()] + "-feira";
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const [hh, mi] = slot.time.split(":");
  const timeStr = mi === "00" ? `${hh}h` : `${hh}h${mi}`;
  return `[APT_CARD: ${dow}, ${dd}/${mm} as ${timeStr}]`;
}

function joinParts(parts: Array<string | null | undefined>): string {
  return parts.filter((p) => !!p && p.trim().length > 0).join("\n\n");
}

// ─────────────────────────────────────────────────────────────────────────
// Sanitização HARD — Task #25 enforcement
// O reply_text deve trazer SOMENTE empatia. Datas, horas, preços, PIX e
// nomes próprios são injetados pelo servidor. Se o LLM tentar furar o
// contrato, removemos os trechos infratores aqui (não confiamos só no prompt).
// ─────────────────────────────────────────────────────────────────────────

const FORBIDDEN_PATTERNS: ReadonlyArray<RegExp> = [
  /R\$\s*\d[\d.,]*/gi,                       // R$ 200, R$ 1.500,00
  /\d{1,2}\s*\/\s*\d{1,2}(?:\s*\/\s*\d{2,4})?/g, // 27/04, 27/04/2026
  /\b\d{1,2}h(?:\d{2})?\b/gi,                // 14h, 14h30
  /\b\d{1,2}:\d{2}\b/g,                      // 14:30
  /\b(?:segunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo)(?:-?feira)?\b/gi,
  /\b(?:janeiro|fevereiro|marco|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/gi,
  /\b\d{11,}\b/g,                            // CPF/PIX-like long numeric
  /\bpix\b/gi,                               // não falar de PIX no texto livre
];

/**
 * Remove qualquer dado factual que o LLM possa ter colocado no reply_text
 * (datas, horas, R$, PIX, nomes próprios). O texto resultante é tratado
 * como prefácio empático opcional. Se sobrar string vazia, ignoramos.
 */
function sanitizeReplyText(text: string | null | undefined, ctx: RenderContext): string {
  if (!text) return "";
  let out = text;

  // 1. Padrões factuais regex.
  for (const re of FORBIDDEN_PATTERNS) {
    out = out.replace(re, "");
  }

  // 2. Nomes próprios dos profissionais do tenant.
  for (const p of ctx.professionalsFull) {
    if (!p?.name) continue;
    const escaped = p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped, "gi"), "");
    // Também remove primeiro nome, "Dr." ou "Dra." prefixos comuns.
    const first = p.name.split(/\s+/).filter((w) => w.length > 2 && !/^Dr[a]?\.?$/i.test(w))[0];
    if (first && first.length > 2) {
      out = out.replace(new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "");
    }
  }

  // 3. Limpa espaços duplicados, vírgulas órfãs, parênteses vazios.
  out = out
    .replace(/\(\s*\)/g, "")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();

  // Frases muito curtas após sanitização provavelmente ficaram quebradas →
  // descarta. Nada melhor que silêncio + render determinístico.
  if (out.length < 6) return "";
  return out;
}

/** Helper público — também usado em render*/
export function sanitizeForTest(text: string, ctx: RenderContext): string {
  return sanitizeReplyText(text, ctx);
}

// ─────────────────────────────────────────────────────────────────────────
// Renderers por ação
// ─────────────────────────────────────────────────────────────────────────

function renderOfferSlots(parsed: StructuredAIResponse, ctx: RenderContext): RenderedReply {
  const slots = parsed.slot_ids
    .map((id) => findSlot(ctx, id))
    .filter((s): s is SlotWithId => s !== null)
    .slice(0, 2); // contrato: máximo 2 horários

  const empathy = sanitizeReplyText(parsed.reply_text, ctx);

  // Sem slots resolvidos → cai pra ASK_INFO determinístico.
  if (slots.length === 0) {
    return {
      text: empathy || "Deixa eu confirmar a agenda com a clinica e ja te aviso, ta bom?",
      shouldCreateAppointment: false,
      chosenSlot: null,
      chosenProfessional: null,
      markers: [],
    };
  }

  // O reply_text vem SEM datas/horas (regra do prompt). Servidor injeta.
  const slotPhrase =
    slots.length === 1
      ? `Posso te encaixar ${formatSlotForReply(slots[0], professionalForSlot(ctx, slots[0])?.name)}.`
      : `Posso te encaixar ${formatSlotForReply(slots[0], professionalForSlot(ctx, slots[0])?.name)} ou ${formatSlotForReply(slots[1], professionalForSlot(ctx, slots[1])?.name)}.`;

  const closer =
    slots.length === 1 ? "Confirmo pra voce?" : "Qual fica melhor?";

  return {
    text: joinParts([empathy, slotPhrase, closer]),
    shouldCreateAppointment: false,
    chosenSlot: null,
    chosenProfessional: null,
    markers: [],
  };
}

function renderConfirmSlot(parsed: StructuredAIResponse, ctx: RenderContext): RenderedReply {
  const slot = findSlot(ctx, parsed.slot_ids[0] ?? null);
  if (!slot) {
    // Fallback seguro: trata como ASK_INFO se o LLM esqueceu de passar slot.
    // IMPORTANTE: NÃO usamos `empathy` aqui — o reply_text da IA pode conter
    // uma falsa confirmação ("Perfeito, ja deixei agendado") mesmo sem slot
    // resolvido. Sempre forçamos o texto determinístico de pergunta para
    // evitar que o paciente acredite que agendou sem nada gravado em DB.
    return {
      text: "Pode me confirmar qual horario voce escolheu? Quero garantir que vou marcar o certo.",
      shouldCreateAppointment: false,
      chosenSlot: null,
      chosenProfessional: null,
      markers: [],
    };
  }

  const prof = findProfessional(ctx, parsed.professional_id) ?? professionalForSlot(ctx, slot);
  const slotStr = formatSlotForReply(slot, prof?.name);
  const marker = aptCardMarker(slot);

  // Frase de confirmação determinística + reply_text empático opcional do LLM.
  const empathy = sanitizeReplyText(parsed.reply_text, ctx);
  const confirm = `Perfeito, ja deixei agendado pra ${slotStr}.`;
  const closer = "Te espero por aqui!";

  return {
    text: joinParts([empathy, confirm, closer, marker]),
    shouldCreateAppointment: true,
    chosenSlot: slot,
    chosenProfessional: prof,
    markers: [marker],
  };
}

function renderSendPix(parsed: StructuredAIResponse, ctx: RenderContext): RenderedReply {
  const empathy = sanitizeReplyText(parsed.reply_text, ctx);
  if (ctx.isInsuranceContact) {
    // Convênio nunca recebe PIX — degrada graciosamente para JUST_REPLY.
    return {
      text:
        empathy ||
        "Pelo convenio nao tem cobranca antecipada, viu? O atendimento ja esta coberto.",
      shouldCreateAppointment: false,
      chosenSlot: null,
      chosenProfessional: null,
      markers: [],
    };
  }

  // Resolve o profissional dono do PIX: prof escolhido > primeiro com PIX habilitado.
  const chosenProf =
    findProfessional(ctx, parsed.professional_id) ??
    ctx.professionalsFull.find((p) => p.pixEnabled && p.pixKey) ??
    null;

  if (!chosenProf || !chosenProf.pixEnabled || !chosenProf.pixKey) {
    return {
      text:
        empathy ||
        "Vou confirmar os dados de pagamento com a clinica e ja te envio, ta bom?",
      shouldCreateAppointment: false,
      chosenSlot: null,
      chosenProfessional: null,
      markers: [],
    };
  }

  const card = buildPixCardText({
    name: chosenProf.name,
    pixKey: chosenProf.pixKey,
    pixBank: chosenProf.pixBank,
    pixKeyType: chosenProf.pixKeyType,
    consultationFee: chosenProf.consultationFee,
    chargesConsultation: chosenProf.chargesConsultation,
  });

  return {
    text: joinParts([empathy, card]),
    shouldCreateAppointment: false,
    chosenSlot: null,
    chosenProfessional: chosenProf,
    markers: [],
  };
}

function renderSendFee(parsed: StructuredAIResponse, ctx: RenderContext): RenderedReply {
  const empathy = sanitizeReplyText(parsed.reply_text, ctx);
  if (ctx.isInsuranceContact) {
    return {
      text:
        empathy ||
        "Pelo convenio o atendimento ja esta coberto, sem cobranca extra.",
      shouldCreateAppointment: false,
      chosenSlot: null,
      chosenProfessional: null,
      markers: [],
    };
  }

  const chosenProf =
    findProfessional(ctx, parsed.professional_id) ??
    ctx.professionalsFull.find((p) => p.consultationFee) ??
    null;

  const charges = chosenProf
    ? resolveChargesConsultation(chosenProf, {
        chargesConsultation: ctx.settingsChargesConsultation ?? null,
        consultationFee: ctx.settingsConsultationFee ?? null,
      })
    : ctx.settingsChargesConsultation !== false;

  if (!charges) {
    return {
      text: joinParts([empathy, "A consulta e gratuita."]),
      shouldCreateAppointment: false,
      chosenSlot: null,
      chosenProfessional: chosenProf,
      markers: [],
    };
  }

  const fee = chosenProf
    ? resolveConsultationFee(chosenProf, {
        chargesConsultation: ctx.settingsChargesConsultation ?? null,
        consultationFee: ctx.settingsConsultationFee ?? null,
      })
    : ctx.settingsConsultationFee ?? null;

  const feeStr = fee ? `A consulta sai por R$ ${fee}.` : "Vou confirmar o valor com a clinica e ja te aviso.";

  return {
    text: joinParts([empathy, feeStr]),
    shouldCreateAppointment: false,
    chosenSlot: null,
    chosenProfessional: chosenProf,
    markers: [],
  };
}

function renderAskInfo(parsed: StructuredAIResponse, ctx: RenderContext): RenderedReply {
  const safe = sanitizeReplyText(parsed.reply_text, ctx);
  return {
    text: safe || "Pode me passar mais um detalhinho pra eu te ajudar melhor?",
    shouldCreateAppointment: false,
    chosenSlot: null,
    chosenProfessional: null,
    markers: [],
  };
}

function renderEscalate(parsed: StructuredAIResponse, ctx: RenderContext): RenderedReply {
  const safe = sanitizeReplyText(parsed.reply_text, ctx);
  return {
    text:
      safe ||
      "Vou chamar alguem da equipe pra te atender direitinho. Aguarda um instante, ta bom?",
    shouldCreateAppointment: false,
    chosenSlot: null,
    chosenProfessional: null,
    markers: [],
  };
}

function renderJustReply(parsed: StructuredAIResponse, ctx: RenderContext): RenderedReply {
  const safe = sanitizeReplyText(parsed.reply_text, ctx);
  return {
    text: safe || "Tudo certo!",
    shouldCreateAppointment: false,
    chosenSlot: null,
    chosenProfessional: null,
    markers: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Dispatcher público
// ─────────────────────────────────────────────────────────────────────────

const DISPATCH: Record<ConstrainedAction, (p: StructuredAIResponse, c: RenderContext) => RenderedReply> = {
  OFFER_SLOTS: renderOfferSlots,
  CONFIRM_SLOT: renderConfirmSlot,
  SEND_PIX: renderSendPix,
  SEND_FEE: renderSendFee,
  ASK_INFO: renderAskInfo,
  ESCALATE: renderEscalate,
  JUST_REPLY: renderJustReply,
};

export function renderStructuredResponse(
  parsed: StructuredAIResponse,
  ctx: RenderContext,
): RenderedReply {
  const renderer = DISPATCH[parsed.action] ?? renderJustReply;
  return renderer(parsed, ctx);
}

/**
 * Enforcement: se validateConstrainedReply reportar termos comerciais
 * proibidos (ex.: convênio recebendo "oportunidade unica"), o caller usa
 * este helper para devolver um texto seguro no lugar do reply original.
 *
 * Mantém slot/marker/criação de agendamento, só substitui o texto exibido.
 */
export function applyViolationFallback(rendered: RenderedReply, hadViolations: boolean): RenderedReply {
  if (!hadViolations) return rendered;
  const safeText = rendered.markers.length > 0
    ? joinParts(["Tudo certo, ja deixei agendado pra voce. Te espero!", ...rendered.markers])
    : "Tudo certo, ja anotei aqui. Qualquer coisa me avisa, ta?";
  return { ...rendered, text: safeText };
}
