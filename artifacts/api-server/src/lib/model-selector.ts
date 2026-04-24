/**
 * Model routing by conversation complexity.
 *
 * Uses the strong model (gpt-5.4) only when the conversation is genuinely
 * hard — first-contact SPIN, multi-professional specialty ambiguity, or a
 * large clinic without a clear specialty signal. Keeps gpt-5.1 for
 * everything else (patients re-scheduling, confirmed insurance contacts, etc.)
 *
 * CALIBRATION: adjust the constants at the top of this file. No other changes
 * needed — each constant is named after the criterion it controls.
 */

/** Conversation mode type — must match ConversationMode in mode-resolver.ts */
type ConversationMode =
  | "PARTICULAR_SPIN"
  | "CONVENIO_TRIAGEM"
  | "CONVENIO_AGENDAR"
  | "PACIENTE_AGENDAR"
  | "PACIENTE_CONVENIO"
  | string;

// ── Calibration constants ──────────────────────────────────────────────────
// Change these to recalibrate routing. One line per criterion.

/** Model to use when the conversation is determined complex. */
export const STRONG_MODEL = "gpt-5.4";

/** Model to use for routine conversations. */
export const STANDARD_MODEL = "gpt-5.1";

/**
 * Min number of routed professionals (after specialty filter) that triggers
 * the complex path when specialty routing IS active.
 * E.g. 2 means: if filter narrowed down to 2+ professionals, it's ambiguous.
 */
const COMPLEX_MULTI_PRO_WITH_SPECIALTY = 2;

/**
 * Min number of total professionals that triggers the complex path when
 * specialty routing is NOT active (no specialty signal detected).
 * E.g. 3 means: clinic has 3+ professionals and patient didn't specify one.
 */
const COMPLEX_MULTI_PRO_NO_SPECIALTY = 3;

// ── Types ──────────────────────────────────────────────────────────────────

export interface ModelSelectionContext {
  /** Current conversation mode resolved by mode-resolver. */
  conversationMode: ConversationMode;
  /** True when no outbound AI message has been sent yet in this conversation. */
  isFirstContact: boolean;
  /** True when the specialty router narrowed down the professional list. */
  routingFiltered: boolean;
  /** Number of professionals after specialty filter (only meaningful when routingFiltered=true). */
  routedProfessionalsCount: number;
  /** Total number of professionals for the tenant. */
  totalProfessionalsCount: number;
  /** Number of specialty labels detected in the routing window (0 = no specialty signal). */
  routingLabelsDetected: number;
}

export interface ModelSelection {
  model: string;
  reason: string;
}

// ── Selector ───────────────────────────────────────────────────────────────

/**
 * Returns the best model for this conversation context.
 * Call this BEFORE the OpenAI completion call and use the returned `model`
 * as the primary model. The existing timeout/429/503 fallback to gpt-5.4-nano
 * continues to act as a secondary safety net regardless of which model is
 * selected here.
 */
export function selectModelForComplexity(ctx: ModelSelectionContext): ModelSelection {
  const {
    conversationMode,
    isFirstContact,
    routingFiltered,
    routedProfessionalsCount,
    totalProfessionalsCount,
    routingLabelsDetected,
  } = ctx;

  // ── Criterion 1: First-contact SPIN ──────────────────────────────────────
  // The most nuanced moment: the AI must simultaneously qualify, empathise,
  // and apply SPIN technique. Errors here lose the lead permanently.
  if (conversationMode === "PARTICULAR_SPIN" && isFirstContact) {
    return { model: STRONG_MODEL, reason: "first_contact_spin" };
  }

  // ── Criterion 2: Specialty filter active with multiple candidates ─────────
  // The router detected a specialty but multiple professionals match it.
  // The AI must reason about the right one — errors cause wrong referrals.
  if (routingFiltered && routedProfessionalsCount >= COMPLEX_MULTI_PRO_WITH_SPECIALTY) {
    return { model: STRONG_MODEL, reason: "specialty_filter_multi_pro" };
  }

  // ── Criterion 3: Many professionals, no specialty detected ────────────────
  // Large clinic, patient didn't name a specialty. The AI must guide the
  // patient without over-committing to the wrong professional.
  if (!routingFiltered && totalProfessionalsCount >= COMPLEX_MULTI_PRO_NO_SPECIALTY && routingLabelsDetected === 0) {
    return { model: STRONG_MODEL, reason: "multi_pro_no_specialty" };
  }

  // All other cases: patients re-scheduling, confirmed insurance contacts,
  // single-professional clinics, follow-up turns after SPIN is resolved, etc.
  return { model: STANDARD_MODEL, reason: "standard" };
}
