import type { AvailableSlot } from "./schedule-engine";
import type { ConversationMode } from "./mode-resolver";

export interface ProfessionalSchedule {
  workingDays: string;
  insuranceDays: string | null | undefined;
  slotDurationMinutes: number;
}

export interface ProcedureInfo {
  durationMinutes: number;
}

const INSURANCE_MODES = new Set<ConversationMode>(["CONVENIO_TRIAGEM", "CONVENIO_AGENDAR"]);

/**
 * Valida se um slot respeita a ficha do profissional para o modo dado.
 *
 * - Modos CONVENIO_*: dia precisa estar em insuranceDays (fallback: workingDays)
 * - Demais modos: dia precisa estar em workingDays
 * - Se procedure fornecido: procedure.durationMinutes <= slotDurationMinutes
 */
export function isSlotValidForMode(
  slot: AvailableSlot,
  mode: ConversationMode | null,
  schedule: ProfessionalSchedule,
  procedure?: ProcedureInfo,
): boolean {
  const slotDayOfWeek = new Date(slot.date + "T00:00:00Z").getUTCDay();
  const slotDayStr = slotDayOfWeek.toString();

  const isInsuranceMode = mode !== null && INSURANCE_MODES.has(mode);
  const rawDays = isInsuranceMode && schedule.insuranceDays?.trim()
    ? schedule.insuranceDays
    : schedule.workingDays;

  const allowedDays = rawDays.split(",").map((d) => d.trim());

  if (!allowedDays.includes(slotDayStr)) {
    return false;
  }

  if (procedure && procedure.durationMinutes > schedule.slotDurationMinutes) {
    return false;
  }

  return true;
}

/**
 * Filtra uma lista de slots, retornando apenas os válidos para o modo e ficha dados.
 */
export function filterValidSlots(
  slots: AvailableSlot[],
  mode: ConversationMode | null,
  schedule: ProfessionalSchedule,
  procedure?: ProcedureInfo,
): AvailableSlot[] {
  return slots.filter((slot) => isSlotValidForMode(slot, mode, schedule, procedure));
}
