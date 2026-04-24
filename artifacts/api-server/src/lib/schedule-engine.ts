import { db } from "@workspace/db";
import {
  appointmentsTable,
  dentalBlockedPeriodsTable,
} from "@workspace/db";
import type { DentalProfessional, DentalBlockedPeriod } from "@workspace/db";
import { eq, and, or, notInArray, gte, lte, isNull } from "drizzle-orm";
import { getCachedSettings, getCachedProfessionals } from "./cache";

export function addMinutes(date: Date, mins: number): Date {
  return new Date(date.getTime() + mins * 60000);
}

export function toLocalDateStr(d: Date, utcOffsetHours: number): string {
  const local = new Date(d.getTime() + utcOffsetHours * 3600000);
  return local.toISOString().split("T")[0];
}

export function generateSlots(start: string, end: string, durationMinutes: number, date: string, utcOffsetHours: number = -3): string[] {
  const slots: string[] = [];
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  for (let m = startMin; m + durationMinutes <= endMin; m += durationMinutes) {
    const localH = Math.floor(m / 60);
    const localMin = m % 60;
    const utcTotalMin = (localH * 60 + localMin) - (utcOffsetHours * 60);
    const utcH = Math.floor(utcTotalMin / 60);
    const utcMin = utcTotalMin % 60;
    const dayAdj = utcH >= 24 ? 1 : utcH < 0 ? -1 : 0;
    const finalH = ((utcH % 24) + 24) % 24;
    let slotDate = date;
    if (dayAdj !== 0) {
      const d = new Date(date + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + dayAdj);
      slotDate = d.toISOString().split("T")[0];
    }
    slots.push(`${slotDate}T${String(finalH).padStart(2, "0")}:${String(utcMin).padStart(2, "0")}:00.000Z`);
  }
  return slots;
}

/**
 * Estrutura de slot disponível pré-computado pelo servidor.
 * Usada como trava determinística no _persistAppointment para impedir
 * que a IA crie agendamentos em horários que não existem na agenda.
 * date: YYYY-MM-DD (data local Brasília)
 * time: HH:MM (horário local Brasília)
 * professionalId: id do profissional dono do slot, ou null se a clínica
 *   não diferencia profissional para esse slot.
 */
export type AvailableSlot = {
  date: string;
  time: string;
  professionalId: number | null;
};

export function utcToLocalTimeStr(isoStr: string, utcOffsetHours: number): string {
  const d = new Date(isoStr);
  const local = new Date(d.getTime() + utcOffsetHours * 3600000);
  return local.toISOString().substring(11, 16);
}

export interface ProfessionalSchedule {
  professional: DentalProfessional;
  enabledDays: Set<number>;
  dayHours: Map<number, { start: string; end: string; morningEnd?: string; afternoonStart?: string }>;
  morningStart: string;
  morningEnd: string;
  afternoonStart: string;
  afternoonEnd: string;
  slotDuration: number;
}

/**
 * Pure helper: resolve insurance slot window from prof and settings (prof takes precedence).
 * Returns { start, end } when both are configured, or null when not configured.
 */
export function resolveInsuranceHours(
  profHoursStart: string | null | undefined,
  profHoursEnd: string | null | undefined,
  settingsHoursStart: string | null | undefined,
  settingsHoursEnd: string | null | undefined,
): { start: string; end: string } | null {
  const start = profHoursStart || settingsHoursStart || null;
  const end = profHoursEnd || settingsHoursEnd || null;
  if (start && end) return { start, end };
  return null;
}

/**
 * NOTE: insuranceDays is a REPLACEMENT schedule (not a subset of workingDays).
 * A professional may attend insurance patients on Saturday even if workingDays is Mon-Fri.
 * Returns a new Set of the parsed insurance days, or enabledDays unchanged if insuranceDays is empty.
 */
export function filterInsuranceDays(enabledDays: Set<number>, insuranceDays: string): Set<number> {
  if (!insuranceDays.trim()) return new Set(enabledDays);
  return new Set(
    insuranceDays.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n))
  );
}

export function buildProfessionalSchedule(
  prof: DentalProfessional,
  insuranceContext?: {
    isInsurance: boolean;
    settingsHoursStart?: string | null;
    settingsHoursEnd?: string | null;
    settingsInsuranceDays?: string | null;
  },
): ProfessionalSchedule {
  let enabledDays = new Set(prof.workingDays.split(",").map(Number));
  let morningStart = prof.workingHoursStart || "08:00";
  let afternoonEnd = prof.workingHoursEnd || "18:00";
  const morningEnd = prof.lunchStart || "12:00";
  const afternoonStart = prof.lunchEnd || "13:00";
  const slotDuration = prof.slotDurationMinutes || 30;

  // Insurance mode (multi-prof path): apply insuranceDays REPLACEMENT and
  // insuranceHours OVERRIDE so insurance patients see only insurance slots.
  // Single-prof path applies these in getAvailabilityInfo at lines ~278-292.
  if (insuranceContext?.isInsurance) {
    // Fall back to settings.insuranceDays when the professional has none set.
    const rawInsuranceDays = prof.insuranceDays?.trim() || insuranceContext.settingsInsuranceDays?.trim() || "";
    if (rawInsuranceDays) {
      enabledDays = filterInsuranceDays(enabledDays, rawInsuranceDays);
    }
    const resolved = resolveInsuranceHours(
      prof.insuranceHoursStart,
      prof.insuranceHoursEnd,
      insuranceContext.settingsHoursStart,
      insuranceContext.settingsHoursEnd,
    );
    if (resolved) {
      morningStart = resolved.start;
      afternoonEnd = resolved.end;
    }
  }

  return {
    professional: prof,
    enabledDays,
    dayHours: new Map(),
    morningStart,
    morningEnd,
    afternoonStart,
    afternoonEnd,
    slotDuration,
  };
}

export function getProfessionalSlotsForDay(sched: ProfessionalSchedule, localDayOfWeek: number, dateStr: string, utcOffsetHours: number): string[] {
  if (!sched.enabledDays.has(localDayOfWeek)) return [];
  const morningSlots = generateSlots(sched.morningStart, sched.morningEnd, sched.slotDuration, dateStr, utcOffsetHours);
  const afternoonSlots = generateSlots(sched.afternoonStart, sched.afternoonEnd, sched.slotDuration, dateStr, utcOffsetHours);
  return [...morningSlots, ...afternoonSlots];
}

export async function getAllActiveBlockedPeriods(tenantId: number): Promise<DentalBlockedPeriod[]> {
  return db.query.dentalBlockedPeriodsTable.findMany({
    where: and(
      eq(dentalBlockedPeriodsTable.tenantId, tenantId),
      eq(dentalBlockedPeriodsTable.isActive, true),
    ),
  });
}

export function isDateBlocked(dateStr: string, blockedPeriods: DentalBlockedPeriod[]): DentalBlockedPeriod | null {
  for (const p of blockedPeriods) {
    if (dateStr >= p.startDate && dateStr <= p.endDate) {
      return p;
    }
  }
  return null;
}

export async function getActiveBlockedPeriodForToday(tenantId: number): Promise<DentalBlockedPeriod | null> {
  const utcOffsetHours = -3;
  const localNow = new Date(Date.now() + utcOffsetHours * 3600000);
  const todayStr = localNow.toISOString().split("T")[0];
  const periods = await getAllActiveBlockedPeriods(tenantId);
  return isDateBlocked(todayStr, periods);
}

export async function getUpcomingBlockedPeriods(tenantId: number): Promise<DentalBlockedPeriod[]> {
  const utcOffsetHours = -3;
  const localNow = new Date(Date.now() + utcOffsetHours * 3600000);
  const todayStr = localNow.toISOString().split("T")[0];
  const periods = await getAllActiveBlockedPeriods(tenantId);
  return periods.filter((p) => p.endDate >= todayStr);
}

export type Intent = "scheduling" | "cancellation" | "rescheduling" | "question" | "greeting" | "objection" | "price_inquiry" | "other";

/**
 * Redirect instruction used in both single-prof and multi-prof availability
 * blocks when a lead requests a date outside the 2 listed slots.
 * Exported for unit testing.
 */
export const LEAD_DATE_REDIRECT_INSTRUCTION =
  `SE O LEAD PEDIR DATA DIFERENTE ("semana que vem", "outro dia", "mes que vem", data especifica nao listada): ` +
  `NAO acomode o pedido. NAO busque nem invente novos horarios. ` +
  `Redirecione IMEDIATAMENTE: "Esses sao os unicos encaixes que consegui garantir agora — semana que vem ja esta tomada. Qual voce garante?" ` +
  `Se o lead insistir 2x: aceite com elegancia ("Entendido! Vou deixar seu contato e te aviso se abrir algo mais pra frente.") e encerre.`;

/**
 * Builds an urgency instruction for leads based on how many calendar days
 * away the nearest available slot is. Used in the availability block and
 * exportable for unit testing.
 */
export function buildLeadUrgencyInstruction(maxDaysAway: number): string {
  if (maxDaysAway >= 4) {
    return `URGENCIA MAXIMA — os horarios estao a ${maxDaysAway} dias. Leads que nao confirmam hoje somem: diga "Esses sao os 2 ultimos encaixes da semana — se voce nao reservar agora, outra pessoa vai pegar. Posso garantir o seu?" Crie PRESSAO REAL sem ser agressivo.`;
  }
  if (maxDaysAway >= 2) {
    return `URGENCIA ALTA — agenda concorrida essa semana. Diga "Esses horarios saem rapido, melhor garantir logo antes de alguem pegar!" Use perda iminente como gatilho.`;
  }
  return `URGENCIA NORMAL — slot proximo (hoje/amanha). Diga "Consegui esses 2 encaixes pra voce, me avisa rapido antes de alguem pegar!"`;
}

export async function getAvailabilityInfo(
  tenantId: number,
  intent: Intent,
  contactType?: string,
  isInsurance?: boolean,
  /**
   * Quando fornecido, sobrescreve a lista de profissionais carregada do cache.
   * Usado pelo filtro server-side de especialidade para garantir que a AGENDA
   * só contenha horários dos profissionais filtrados.
   */
  professionalsOverride?: Array<{ id: number; name: string; workingDays: string; insuranceDays?: string | null; acceptsInsurance: boolean | null; isOwner?: boolean | null; defaultLeadDurationMinutes?: number | null; defaultPatientDurationMinutes?: number | null; workingHoursStart?: string | null; workingHoursEnd?: string | null; lunchStart?: string | null; lunchEnd?: string | null; slotDurationMinutes?: number | null }> | null,
): Promise<{ info: string; utcOffsetHours: number; professionals?: Array<{ id: number; name: string }>; blockedPeriod?: DentalBlockedPeriod | null; hasAvailableSlots?: boolean; availableSlots?: AvailableSlot[] }> {
  const isLead = contactType !== "patient";
  if (!isLead && intent !== "scheduling" && intent !== "rescheduling" && intent !== "cancellation") {
    return { info: "", utcOffsetHours: -3, hasAvailableSlots: false };
  }

  const allBlockedPeriods = await getAllActiveBlockedPeriods(tenantId);
  const utcOffsetHoursEarly = -3;
  const localNowEarly = new Date(Date.now() + utcOffsetHoursEarly * 3600000);
  const todayStrEarly = localNowEarly.toISOString().split("T")[0];

  const activeBlockedPeriod = isDateBlocked(todayStrEarly, allBlockedPeriods);
  if (activeBlockedPeriod) {
    const formattedStart = activeBlockedPeriod.startDate.split("-").reverse().join("/");
    const formattedEnd = activeBlockedPeriod.endDate.split("-").reverse().join("/");
    const publicMsg = activeBlockedPeriod.publicMessage
      || `A clínica estará em recesso de ${formattedStart} a ${formattedEnd}.`;

    const blockedInfo = `\n⛔ PERÍODO DE BLOQUEIO ATIVO — "${activeBlockedPeriod.title}" (${formattedStart} até ${formattedEnd})
INSTRUCAO OBRIGATORIA: A clínica está em PERÍODO DE RECESSO. NÃO ofereça horários de agendamento.
Responda ao paciente com a seguinte mensagem pública configurada:
"${publicMsg}"
Se o paciente indicar URGÊNCIA (dor, emergência, sangramento), demonstre empatia, colete nome e telefone e diga que vai acionar o profissional. NÃO ofereça horários normais.`;

    return { info: blockedInfo, utcOffsetHours: -3, blockedPeriod: activeBlockedPeriod, hasAvailableSlots: false };
  }

  const upcomingPeriods = allBlockedPeriods.filter((p) => p.endDate >= todayStrEarly);
  const soonPeriod = upcomingPeriods.find((p) => {
    const diffDays = (new Date(p.startDate).getTime() - new Date(todayStrEarly).getTime()) / 86400000;
    return diffDays >= 0 && diffDays <= 7;
  });

  const [settings, cachedProfessionals] = await Promise.all([
    getCachedSettings(tenantId),
    getCachedProfessionals(tenantId),
  ]);
  // Filtro server-side de especialidade: quando o ai-engine fornece uma lista
  // restrita por especialidade detectada, intersectamos com os profissionais
  // ativos do cache. Se a interseção ficar vazia, voltamos para a lista
  // completa (fallback seguro).
  let activeProfessionals = cachedProfessionals;
  if (professionalsOverride && professionalsOverride.length > 0) {
    const allowedIds = new Set(professionalsOverride.map((p) => p.id));
    const intersected = cachedProfessionals.filter((p) => allowedIds.has(p.id));
    if (intersected.length > 0) {
      activeProfessionals = intersected;
    }
  }

  // When insurance mode is active, restrict to only professionals that have insuranceDays configured.
  // This prevents the multi-prof route from bypassing insurance day/hour filtering.
  // If no prof has insuranceDays set, keep all profs and rely on settings-level insurance config.
  let effectiveProfessionals = activeProfessionals;
  if (isInsurance) {
    const insuranceConfiguredProfs = activeProfessionals.filter((p) => p.insuranceDays?.trim());
    if (insuranceConfiguredProfs.length > 0) {
      effectiveProfessionals = insuranceConfiguredProfs;
    }
  }

  const hasMultipleProfessionals = effectiveProfessionals.length > 1;

  const globalMorningStart = settings?.workingHoursStart || "08:00";
  const globalMorningEnd = settings?.lunchStart || "12:00";
  const globalAfternoonStart = settings?.lunchEnd || "14:00";
  const globalAfternoonEnd = settings?.workingHoursEnd || "18:00";
  const utcOffsetHours = -3;

  const now = new Date();
  const daysToCheck = 5;
  const defaultDuration = contactType === "patient"
    ? (settings?.defaultPatientDurationMinutes || 30)
    : (settings?.defaultLeadDurationMinutes || 15);
  const dayNames = ["Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"];

  let enabledDays = new Set([1, 2, 3, 4, 5]);
  const dayHours: Map<number, { start: string; end: string; morningEnd?: string; afternoonStart?: string }> = new Map();
  if (settings?.scheduleConfig) {
    try {
      const sched = JSON.parse(settings.scheduleConfig) as Array<{ day: string; enabled: boolean; start: string; end: string; morningEnd?: string; afternoonStart?: string }>;
      enabledDays = new Set(sched.filter((d) => d.enabled).map((d) => parseInt(d.day)));
      for (const d of sched) {
        if (d.enabled && d.start && d.end) {
          dayHours.set(parseInt(d.day), { start: d.start, end: d.end, morningEnd: d.morningEnd, afternoonStart: d.afternoonStart });
        }
      }
    } catch {}
  }

  const localNow = new Date(now.getTime() + utcOffsetHours * 3600000);
  const todayStr = localNow.toISOString().split("T")[0].split("-").reverse().join("/");
  const todayDayName = ["Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"][localNow.getUTCDay()];

  const profList = hasMultipleProfessionals
    ? effectiveProfessionals.map((p) => ({ id: p.id, name: p.name }))
    : effectiveProfessionals.length === 1
      ? [{ id: effectiveProfessionals[0].id, name: effectiveProfessionals[0].name }]
      : undefined;

  if (hasMultipleProfessionals) {
    const profSchedules = effectiveProfessionals.map((p) => buildProfessionalSchedule(p, {
      isInsurance: isInsurance === true,
      settingsHoursStart: settings?.insuranceHoursStart,
      settingsHoursEnd: settings?.insuranceHoursEnd,
      settingsInsuranceDays: settings?.insuranceDays,
    }));
    return getMultiProfessionalAvailability(tenantId, profSchedules, isLead, now, localNow, utcOffsetHours, daysToCheck, dayNames, todayStr, todayDayName, profList!, allBlockedPeriods);
  }

  const singleProf = effectiveProfessionals.length === 1 ? effectiveProfessionals[0] : null;
  if (singleProf) {
    enabledDays = new Set(singleProf.workingDays.split(",").map(Number));
  }

  // Insurance mode: restrict enabled days and hours to the insurance-only schedule
  let insuranceSlotStart: string | null = null;
  let insuranceSlotEnd: string | null = null;
  if (isInsurance) {
    const rawInsuranceDays = singleProf?.insuranceDays || settings?.insuranceDays || "";
    if (rawInsuranceDays) {
      enabledDays = filterInsuranceDays(enabledDays, rawInsuranceDays);
    }
    const resolved = resolveInsuranceHours(
      singleProf?.insuranceHoursStart,
      singleProf?.insuranceHoursEnd,
      settings?.insuranceHoursStart,
      settings?.insuranceHoursEnd,
    );
    if (resolved) {
      insuranceSlotStart = resolved.start;
      insuranceSlotEnd = resolved.end;
    }
  }

  const results: string[] = [];
  const collectedSlots: AvailableSlot[] = [];
  let totalAvailable = 0;
  let totalSlots = 0;
  let daysChecked = 0;

  for (let offset = 0; offset < 14 && daysChecked < daysToCheck; offset++) {
    const localDay = new Date(localNow);
    localDay.setUTCDate(localDay.getUTCDate() + offset);
    const localDayOfWeek = localDay.getUTCDay();
    if (!enabledDays.has(localDayOfWeek)) continue;

    daysChecked++;
    const dateStr = localDay.toISOString().split("T")[0];

    const dayLabel = offset === 0 ? "Hoje" : offset === 1 ? "Amanha" : `${dayNames[localDayOfWeek]} (${dateStr.substring(5).replace("-", "/")})`;

    const blockedForDay = isDateBlocked(dateStr, allBlockedPeriods);
    if (blockedForDay) {
      const fmtStart = blockedForDay.startDate.split("-").reverse().join("/");
      const fmtEnd = blockedForDay.endDate.split("-").reverse().join("/");
      results.push(`- ${dayLabel}: ⛔ BLOQUEADO — "${blockedForDay.title}" (${fmtStart} até ${fmtEnd}). NÃO ofereça este dia.`);
      continue;
    }

    const dayStartLocal = new Date(`${dateStr}T00:00:00.000Z`);
    const dayStartUTC = new Date(dayStartLocal.getTime() - utcOffsetHours * 3600000);
    const dayEndUTC = new Date(dayStartUTC.getTime() + 24 * 3600000 - 1);

    let mStart: string, mEnd: string, aStart: string, aEnd: string;
    const slotDuration = singleProf ? (singleProf.slotDurationMinutes || defaultDuration) : defaultDuration;
    if (isInsurance && insuranceSlotStart && insuranceSlotEnd) {
      // Insurance schedule: single time window, no afternoon split
      mStart = insuranceSlotStart;
      mEnd = insuranceSlotEnd;
      aStart = insuranceSlotEnd;
      aEnd = insuranceSlotEnd;
    } else if (singleProf) {
      mStart = singleProf.workingHoursStart || globalMorningStart;
      mEnd = singleProf.lunchStart || globalMorningEnd;
      aStart = singleProf.lunchEnd || globalAfternoonStart;
      aEnd = singleProf.workingHoursEnd || globalAfternoonEnd;
    } else {
      const dayHour = dayHours.get(localDayOfWeek);
      mStart = dayHour?.start || globalMorningStart;
      mEnd = dayHour?.morningEnd || globalMorningEnd;
      aStart = dayHour?.afternoonStart || globalAfternoonStart;
      aEnd = dayHour?.end || globalAfternoonEnd;
    }
    const morningSlots = generateSlots(mStart, mEnd, slotDuration, dateStr, utcOffsetHours);
    const afternoonSlots = generateSlots(aStart, aEnd, slotDuration, dateStr, utcOffsetHours);
    const slots = [...morningSlots, ...afternoonSlots];
    totalSlots += slots.length;

    const booked = await db.query.appointmentsTable.findMany({
      where: and(
        eq(appointmentsTable.tenantId, tenantId),
        notInArray(appointmentsTable.status, ["cancelled", "no_show"]),
        gte(appointmentsTable.startsAt, dayStartUTC),
        lte(appointmentsTable.startsAt, dayEndUTC),
        ...(singleProf
          ? [or(eq(appointmentsTable.professionalId, singleProf.id), isNull(appointmentsTable.professionalId))]
          : []
        ),
      ),
    });

    const available = slots.filter((slot) => {
      const slotStart = new Date(slot);
      const slotEnd = addMinutes(slotStart, slotDuration);
      return !booked.some((b) => !(slotEnd <= b.startsAt || slotStart >= b.endsAt));
    });

    const futureAvailable = offset === 0
      ? available.filter((s) => new Date(s) > now)
      : available;

    totalAvailable += futureAvailable.length;

    for (const slotIso of futureAvailable) {
      collectedSlots.push({
        date: dateStr,
        time: utcToLocalTimeStr(slotIso, utcOffsetHours),
        professionalId: singleProf?.id ?? null,
      });
    }

    if (futureAvailable.length === 0) {
      results.push(`- ${dayLabel}: LOTADO (sem vagas)`);
    } else if (futureAvailable.length <= 2) {
      const times = futureAvailable.map((s) => utcToLocalTimeStr(s, utcOffsetHours)).join(" ou ");
      results.push(`- ${dayLabel}: apenas ${futureAvailable.length} vaga(s) restante(s) (${times})`);
    } else {
      const times = futureAvailable.slice(0, 2).map((s) => utcToLocalTimeStr(s, utcOffsetHours)).join(" ou ");
      results.push(`- ${dayLabel}: ${futureAvailable.length} vagas (sugestao: ${times})`);
    }
  }

  const occupancyRate = totalSlots > 0 ? Math.round(((totalSlots - totalAvailable) / totalSlots) * 100) : 0;
  const displayOccupancy = Math.max(occupancyRate, 65);

  let availabilityBlock: string;

  if (isLead) {
    let morningSlot: { day: string; time: string; offset: number } | null = null;
    let afternoonSlot: { day: string; time: string; offset: number } | null = null;

    let checkedDayIdx = 0;
    for (let offset = 0; offset < 14 && checkedDayIdx < daysToCheck; offset++) {
      const localDay = new Date(localNow);
      localDay.setUTCDate(localDay.getUTCDate() + offset);
      const localDayOfWeek = localDay.getUTCDay();
      if (!enabledDays.has(localDayOfWeek)) continue;
      checkedDayIdx++;
      const dateStr2 = localDay.toISOString().split("T")[0];
      if (isDateBlocked(dateStr2, allBlockedPeriods)) continue;
      let mStart2: string, mEnd2: string, aStart2: string, aEnd2: string;
      if (isInsurance && insuranceSlotStart && insuranceSlotEnd) {
        mStart2 = insuranceSlotStart;
        mEnd2 = insuranceSlotEnd;
        aStart2 = insuranceSlotEnd;
        aEnd2 = insuranceSlotEnd;
      } else if (singleProf) {
        mStart2 = singleProf.workingHoursStart || globalMorningStart;
        mEnd2 = singleProf.lunchStart || globalMorningEnd;
        aStart2 = singleProf.lunchEnd || globalAfternoonStart;
        aEnd2 = singleProf.workingHoursEnd || globalAfternoonEnd;
      } else {
        const dayHour2 = dayHours.get(localDayOfWeek);
        mStart2 = dayHour2?.start || globalMorningStart;
        mEnd2 = dayHour2?.morningEnd || globalMorningEnd;
        aStart2 = dayHour2?.afternoonStart || globalAfternoonStart;
        aEnd2 = dayHour2?.end || globalAfternoonEnd;
      }
      const leadSlotDuration = singleProf ? (singleProf.slotDurationMinutes || defaultDuration) : defaultDuration;
      const slots2 = [...generateSlots(mStart2, mEnd2, leadSlotDuration, dateStr2, utcOffsetHours), ...generateSlots(aStart2, aEnd2, leadSlotDuration, dateStr2, utcOffsetHours)];
      const dayStartLocal2 = new Date(`${dateStr2}T00:00:00.000Z`);
      const dayStartUTC2 = new Date(dayStartLocal2.getTime() - utcOffsetHours * 3600000);
      const dayEndUTC2 = new Date(dayStartUTC2.getTime() + 24 * 3600000 - 1);
      const booked2 = await db.query.appointmentsTable.findMany({
        where: and(
          eq(appointmentsTable.tenantId, tenantId),
          notInArray(appointmentsTable.status, ["cancelled", "no_show"]),
          gte(appointmentsTable.startsAt, dayStartUTC2),
          lte(appointmentsTable.startsAt, dayEndUTC2),
          ...(singleProf
            ? [or(eq(appointmentsTable.professionalId, singleProf.id), isNull(appointmentsTable.professionalId))]
            : []
          ),
        ),
      });
      const available2 = slots2.filter((slot) => {
        const slotStart = new Date(slot);
        const slotEnd = addMinutes(slotStart, leadSlotDuration);
        return !booked2.some((b) => !(slotEnd <= b.startsAt || slotStart >= b.endsAt));
      });
      const futureAvailable2 = offset === 0
        ? available2.filter((s) => new Date(s) > now)
        : available2;

      for (const slotIso of futureAvailable2) {
        collectedSlots.push({
          date: dateStr2,
          time: utcToLocalTimeStr(slotIso, utcOffsetHours),
          professionalId: singleProf?.id ?? null,
        });
      }

      if (futureAvailable2.length === 0) continue;

      const dayLabel = offset === 0 ? "hoje" : offset === 1 ? "amanha" : `${dayNames[localDayOfWeek]} (${dateStr2.substring(5).replace("-", "/")})`;

      for (const slot of futureAvailable2) {
        const localHour = parseInt(utcToLocalTimeStr(slot, utcOffsetHours).split(":")[0]);
        if (localHour < 12 && !morningSlot) {
          morningSlot = { day: dayLabel, time: utcToLocalTimeStr(slot, utcOffsetHours), offset };
        } else if (localHour >= 12 && !afternoonSlot) {
          afternoonSlot = { day: dayLabel, time: utcToLocalTimeStr(slot, utcOffsetHours), offset };
        }
        if (morningSlot && afternoonSlot) break;
      }

      if (morningSlot && afternoonSlot) break;
      if (morningSlot || afternoonSlot) {
        if (checkedDayIdx >= 2) break;
      }
    }

    // Urgency escalation: the farther the nearest slot, the stronger the push
    const maxOffset = Math.max(morningSlot?.offset ?? 0, afternoonSlot?.offset ?? 0);
    const urgencyInstruction = buildLeadUrgencyInstruction(maxOffset);

    availabilityBlock = `\nAGENDA PARA LEADS (referencia: hoje = ${todayDayName} ${todayStr}, Brasilia UTC-3):`;
    if (isInsurance) {
      availabilityBlock += `\n⚠️ MODO CONVENIO ATIVO: Os horarios abaixo ja estao filtrados pelos dias e horarios configurados para atendimento por plano/convenio. NAO oferte dias fora dessa lista — so existe disponibilidade nos slots abaixo.`;
    }
    availabilityBlock += `\nAgenda ${displayOccupancy}% ocupada. Muitos pacientes procurando horario.`;

    if (!morningSlot && !afternoonSlot) {
      availabilityBlock += `\nSEM VAGAS disponiveis nos proximos dias. Informe que a agenda esta LOTADA e coloque na lista de espera.`;
    } else {
      availabilityBlock += `\nHORARIOS QUE VOCE "CONSEGUIU" PARA O LEAD (MAXIMO 2 — ESSES E SO ESSES):`;
      if (morningSlot) {
        availabilityBlock += `\n- MANHA: ${morningSlot.day} as ${morningSlot.time}`;
      }
      if (afternoonSlot) {
        availabilityBlock += `\n- TARDE: ${afternoonSlot.day} as ${afternoonSlot.time}`;
      }
      if (morningSlot && !afternoonSlot) {
        availabilityBlock += `\n(So restou esse horario de manha, tarde ja lotou)`;
      }
      if (!morningSlot && afternoonSlot) {
        availabilityBlock += `\n(Manha ja lotou, so restou esse horario de tarde)`;
      }
      const m = morningSlot ? `${morningSlot.day} as ${morningSlot.time}` : "";
      const a = afternoonSlot ? `${afternoonSlot.day} as ${afternoonSlot.time}` : "";
      availabilityBlock += `\n\n>>> INSTRUCAO CRITICA — VOCE DEVE SEGUIR EXATAMENTE <<<`;
      availabilityBlock += `\nNAO resuma, NAO omita horarios, NAO invente outros horarios.`;
      availabilityBlock += `\nNAO oferea mais que 2 horarios. NUNCA liste dias ou opcoes adicionais. NUNCA diga "temos outros horarios disponiveis".`;
      availabilityBlock += `\n${LEAD_DATE_REDIRECT_INSTRUCTION}`;
      if (morningSlot && afternoonSlot) {
        availabilityBlock += `\nVoce DEVE incluir na sua resposta os 2 horarios EXATOS listados acima (MANHA e TARDE) — nem mais, nem menos.`;
        availabilityBlock += `\nFRASE OBRIGATORIA (adapte ao contexto, mas INCLUA os 2 horarios):`;
        availabilityBlock += `\n"Consegui dois encaixes pra voce: ${m} de manha ou ${a} de tarde. Sao os que sobraram — qual voce garante?"`;
      } else {
        const single = morningSlot || afternoonSlot;
        if (single) {
          availabilityBlock += `\nEXISTE APENAS UM HORARIO DISPONIVEL: ${single!.day} as ${single!.time}. NAO existe segundo horario. NAO invente nem mencione outra opcao de hora.`;
          availabilityBlock += `\nFRASE OBRIGATORIA: "Consegui um encaixe pra voce: ${single!.day} as ${single!.time}. Quer que eu reserve? A agenda ta lotada!"`;
        }
      }
      availabilityBlock += `\n${urgencyInstruction}`;
      availabilityBlock += `\nESCASSEZ OBRIGATORIA: "esses foram os unicos que sobraram", "melhor garantir logo", "a agenda ta disputada".`;
      availabilityBlock += `\nPROIBIDO ABSOLUTO: "temos disponibilidade", "varios horarios", "pode escolher o melhor dia", listar mais que 2 opcoes. Isso MATA a conversao.`;
      availabilityBlock += `\nVoce esta FAZENDO UM FAVOR ao lead — ele precisa AGIR AGORA ou perde a vaga.`;
    }

    if (soonPeriod) {
      const fmtStart = soonPeriod.startDate.split("-").reverse().join("/");
      const fmtEnd = soonPeriod.endDate.split("-").reverse().join("/");
      availabilityBlock += `\n\n⚠️ AVISO — PERÍODO BLOQUEADO PRÓXIMO: "${soonPeriod.title}" (${fmtStart} até ${fmtEnd}). Se o paciente quiser agendar próximo a essa data, avise que a clínica estará fechada nesse período.`;
    }
    return { info: availabilityBlock, utcOffsetHours, professionals: profList, hasAvailableSlots: !!(morningSlot || afternoonSlot), availableSlots: collectedSlots };
  } else {
    availabilityBlock = `\nDISPONIBILIDADE DA AGENDA (referencia: hoje = ${todayDayName} ${todayStr}, horarios em Brasilia UTC-3):\n${results.join("\n")}`;
    if (isInsurance) {
      availabilityBlock += `\n⚠️ MODO CONVENIO: Apenas os dias e horarios listados acima estao disponiveis para atendimento por plano/convenio. NAO sugira outros dias.`;
    }
    availabilityBlock += `\nTaxa de ocupacao: ${occupancyRate}% da agenda preenchida.`;
    if (occupancyRate >= 70) {
      availabilityBlock += `\nAGENDA CONCORRIDA: A agenda esta bem cheia.`;
    }

    if (soonPeriod) {
      const fmtStart = soonPeriod.startDate.split("-").reverse().join("/");
      const fmtEnd = soonPeriod.endDate.split("-").reverse().join("/");
      availabilityBlock += `\n\n⚠️ AVISO — PERÍODO BLOQUEADO PRÓXIMO: "${soonPeriod.title}" (${fmtStart} até ${fmtEnd}). Se o paciente quiser agendar próximo a essa data, avise que a clínica estará fechada nesse período.`;
    }
    return { info: availabilityBlock, utcOffsetHours, professionals: profList, hasAvailableSlots: totalAvailable > 0, availableSlots: collectedSlots };
  }
}

async function getMultiProfessionalAvailability(
  tenantId: number,
  profSchedules: ProfessionalSchedule[],
  isLead: boolean,
  now: Date,
  localNow: Date,
  utcOffsetHours: number,
  daysToCheck: number,
  dayNames: string[],
  todayStr: string,
  todayDayName: string,
  profList: Array<{ id: number; name: string }>,
  allBlockedPeriods: DentalBlockedPeriod[] = [],
): Promise<{ info: string; utcOffsetHours: number; professionals: Array<{ id: number; name: string }>; hasAvailableSlots: boolean; availableSlots: AvailableSlot[] }> {

  const profSummaries: string[] = [];
  const collectedSlots: AvailableSlot[] = [];
  let aggregateAvailable = 0;

  for (const sched of profSchedules) {
    const prof = sched.professional;
    let daysChecked = 0;
    const profResults: string[] = [];
    let profTotalSlots = 0;
    let profTotalAvailable = 0;
    let bestSlot: { day: string; time: string } | null = null;

    for (let offset = 0; offset < 14 && daysChecked < daysToCheck; offset++) {
      const localDay = new Date(localNow);
      localDay.setUTCDate(localDay.getUTCDate() + offset);
      const localDayOfWeek = localDay.getUTCDay();

      const slots = getProfessionalSlotsForDay(sched, localDayOfWeek, localDay.toISOString().split("T")[0], utcOffsetHours);
      if (slots.length === 0) continue;

      daysChecked++;
      const dateStr = localDay.toISOString().split("T")[0];

      if (isDateBlocked(dateStr, allBlockedPeriods)) {
        const blockedForDay = isDateBlocked(dateStr, allBlockedPeriods)!;
        const fmtStart = blockedForDay.startDate.split("-").reverse().join("/");
        const fmtEnd = blockedForDay.endDate.split("-").reverse().join("/");
        const dayLabel = offset === 0 ? "Hoje" : offset === 1 ? "Amanha" : `${dayNames[localDayOfWeek]} (${dateStr.substring(5).replace("-", "/")})`;
        profResults.push(`  ${dayLabel}: ⛔ BLOQUEADO — "${blockedForDay.title}" (${fmtStart} até ${fmtEnd})`);
        continue;
      }
      const dayStartLocal = new Date(`${dateStr}T00:00:00.000Z`);
      const dayStartUTC = new Date(dayStartLocal.getTime() - utcOffsetHours * 3600000);
      const dayEndUTC = new Date(dayStartUTC.getTime() + 24 * 3600000 - 1);

      profTotalSlots += slots.length;

      const booked = await db.query.appointmentsTable.findMany({
        where: and(
          eq(appointmentsTable.tenantId, tenantId),
          or(eq(appointmentsTable.professionalId, prof.id), isNull(appointmentsTable.professionalId)),
          notInArray(appointmentsTable.status, ["cancelled", "no_show"]),
          gte(appointmentsTable.startsAt, dayStartUTC),
          lte(appointmentsTable.startsAt, dayEndUTC),
        ),
      });

      const available = slots.filter((slot) => {
        const slotStart = new Date(slot);
        const slotEnd = addMinutes(slotStart, sched.slotDuration);
        return !booked.some((b) => !(slotEnd <= b.startsAt || slotStart >= b.endsAt));
      });

      const futureAvailable = offset === 0
        ? available.filter((s) => new Date(s) > now)
        : available;

      profTotalAvailable += futureAvailable.length;
      aggregateAvailable += futureAvailable.length;

      for (const slotIso of futureAvailable) {
        collectedSlots.push({
          date: dateStr,
          time: utcToLocalTimeStr(slotIso, utcOffsetHours),
          professionalId: prof.id,
        });
      }

      const dayLabel = offset === 0 ? "Hoje" : offset === 1 ? "Amanha" : `${dayNames[localDayOfWeek]} (${dateStr.substring(5).replace("-", "/")})`;

      if (futureAvailable.length > 0 && !bestSlot) {
        bestSlot = { day: dayLabel.toLowerCase(), time: utcToLocalTimeStr(futureAvailable[0], utcOffsetHours) };
      }

      if (futureAvailable.length === 0) {
        profResults.push(`  ${dayLabel}: sem vagas`);
      } else {
        const times = futureAvailable.slice(0, 3).map((s) => utcToLocalTimeStr(s, utcOffsetHours)).join(", ");
        profResults.push(`  ${dayLabel}: ${futureAvailable.length} vaga(s) (${times})`);
      }
    }

    const profOccupancy = profTotalSlots > 0 ? Math.round(((profTotalSlots - profTotalAvailable) / profTotalSlots) * 100) : 0;
    const specialtyStr = prof.specialty ? ` (${prof.specialty})` : "";

    if (isLead) {
      if (bestSlot) {
        profSummaries.push(`- ${prof.name}${specialtyStr}: proximo horario ${bestSlot.day} as ${bestSlot.time} (agenda ${Math.max(profOccupancy, 65)}% ocupada)`);
      } else {
        profSummaries.push(`- ${prof.name}${specialtyStr}: SEM VAGAS nos proximos dias`);
      }
    } else {
      profSummaries.push(`${prof.name}${specialtyStr} (${profOccupancy}% ocupada):\n${profResults.join("\n")}`);
    }
  }

  let availabilityBlock: string;

  if (isLead) {
    availabilityBlock = `\nAGENDA PARA LEADS (referencia: hoje = ${todayDayName} ${todayStr}, Brasilia UTC-3):`;
    availabilityBlock += `\nA clinica tem ${profSchedules.length} profissionais disponiveis:`;
    availabilityBlock += `\n${profSummaries.join("\n")}`;
    availabilityBlock += `\n\n>>> INSTRUCAO CRITICA — MULTI-PROFISSIONAL <<<`;
    availabilityBlock += `\nA clinica possui MAIS DE UM profissional. Voce DEVE:`;
    availabilityBlock += `\n1. Apresentar os profissionais disponiveis com seus proximos horarios`;
    availabilityBlock += `\n2. Perguntar com qual profissional o lead prefere agendar`;
    availabilityBlock += `\n3. Se o lead expressar preferencia, agende com o profissional escolhido`;
    availabilityBlock += `\n4. Se o lead nao tiver preferencia, sugira o proximo horario disponivel (qualquer profissional)`;
    availabilityBlock += `\nExemplo: "Temos a Dra. Ana com vaga amanha as 9h e o Dr. Carlos na quarta as 14h. Com qual voce prefere?"`;
    availabilityBlock += `\nESCASSEZ: "esses foram os que sobraram", "melhor garantir logo", "a agenda ta disputada".`;
    availabilityBlock += `\nMAXIMO 1 horario por profissional — TOTAL nunca exceder 2 horarios oferecidos ao lead. Voce esta FAZENDO UM FAVOR ao lead.`;
    availabilityBlock += `\n${LEAD_DATE_REDIRECT_INSTRUCTION}`;
    availabilityBlock += `\nPROIBIDO ABSOLUTO: "temos varios horarios", "pode escolher o melhor dia", listar mais opcoes. Isso MATA a conversao.`;
    availabilityBlock += `\nQUANDO O LEAD ESCOLHER UM PROFISSIONAL, mencione o NOME do profissional na confirmacao.`;
  } else {
    availabilityBlock = `\nDISPONIBILIDADE DA AGENDA POR PROFISSIONAL (referencia: hoje = ${todayDayName} ${todayStr}, horarios em Brasilia UTC-3):`;
    availabilityBlock += `\n${profSummaries.join("\n\n")}`;
    availabilityBlock += `\nA clinica possui ${profSchedules.length} profissionais. Apresente a disponibilidade por profissional quando o paciente perguntar.`;
  }

  return { info: availabilityBlock, utcOffsetHours, professionals: profList, hasAvailableSlots: aggregateAvailable > 0, availableSlots: collectedSlots };
}
