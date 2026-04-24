import { describe, it, expect } from "vitest";
import {
  generateSlots,
  addMinutes,
  toLocalDateStr,
  utcToLocalTimeStr,
  isDateBlocked,
  filterInsuranceDays,
  resolveInsuranceHours,
  getProfessionalSlotsForDay,
  buildProfessionalSchedule,
} from "../lib/schedule-engine.js";
import type { DentalBlockedPeriod, DentalProfessional } from "@workspace/db";

describe("generateSlots — geração de slots de horário", () => {
  it("gera slots de 30 min entre 08:00 e 10:00 (4 slots)", () => {
    const slots = generateSlots("08:00", "10:00", 30, "2025-01-15", -3);
    expect(slots).toHaveLength(4);
  });

  it("gera slots de 60 min entre 08:00 e 12:00 (4 slots)", () => {
    const slots = generateSlots("08:00", "12:00", 60, "2025-01-15", -3);
    expect(slots).toHaveLength(4);
  });

  it("gera 0 slots quando duração > intervalo", () => {
    const slots = generateSlots("08:00", "08:30", 60, "2025-01-15", -3);
    expect(slots).toHaveLength(0);
  });

  it("slots são strings ISO com data correta", () => {
    const slots = generateSlots("08:00", "09:00", 30, "2025-01-15", -3);
    slots.forEach((s) => {
      expect(s).toContain("2025-01-15");
      expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  it("converte horário local para UTC corretamente (BRT = UTC-3)", () => {
    const slots = generateSlots("08:00", "08:30", 30, "2025-01-15", -3);
    expect(slots[0]).toBe("2025-01-15T11:00:00.000Z");
  });

  it("não gera slot que ultrapassaria o horário final", () => {
    const slots = generateSlots("08:00", "08:45", 30, "2025-01-15", -3);
    expect(slots).toHaveLength(1);
  });
});

describe("addMinutes — soma minutos a uma data", () => {
  it("adiciona 30 minutos", () => {
    const d = new Date("2025-01-15T10:00:00Z");
    const result = addMinutes(d, 30);
    expect(result.toISOString()).toBe("2025-01-15T10:30:00.000Z");
  });

  it("adiciona 60 minutos", () => {
    const d = new Date("2025-01-15T10:00:00Z");
    const result = addMinutes(d, 60);
    expect(result.toISOString()).toBe("2025-01-15T11:00:00.000Z");
  });

  it("não muta a data original", () => {
    const d = new Date("2025-01-15T10:00:00Z");
    const original = d.getTime();
    addMinutes(d, 30);
    expect(d.getTime()).toBe(original);
  });
});

describe("toLocalDateStr — conversão para data local", () => {
  it("converte UTC para BRT (UTC-3)", () => {
    const d = new Date("2025-01-15T02:00:00Z");
    expect(toLocalDateStr(d, -3)).toBe("2025-01-14");
  });

  it("mantém data quando horário é > 3h UTC", () => {
    const d = new Date("2025-01-15T12:00:00Z");
    expect(toLocalDateStr(d, -3)).toBe("2025-01-15");
  });
});

describe("utcToLocalTimeStr — conversão de horário UTC para local", () => {
  it("converte 11:00 UTC para 08:00 BRT", () => {
    expect(utcToLocalTimeStr("2025-01-15T11:00:00.000Z", -3)).toBe("08:00");
  });

  it("converte 15:30 UTC para 12:30 BRT", () => {
    expect(utcToLocalTimeStr("2025-01-15T15:30:00.000Z", -3)).toBe("12:30");
  });

  it("converte 00:00 UTC para 21:00 BRT (dia anterior)", () => {
    expect(utcToLocalTimeStr("2025-01-15T00:00:00.000Z", -3)).toBe("21:00");
  });
});

describe("isDateBlocked — verificação de períodos bloqueados", () => {
  const blocked: DentalBlockedPeriod[] = [
    {
      id: 1,
      tenantId: 1,
      startDate: "2025-01-20",
      endDate: "2025-01-22",
      reason: "Férias",
      isActive: true,
      professionalId: null,
      createdAt: new Date(),
    },
    {
      id: 2,
      tenantId: 1,
      startDate: "2025-02-01",
      endDate: "2025-02-01",
      reason: "Feriado",
      isActive: true,
      professionalId: null,
      createdAt: new Date(),
    },
  ];

  it("retorna período quando data está no range", () => {
    const result = isDateBlocked("2025-01-21", blocked);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe("Férias");
  });

  it("retorna período no início do range", () => {
    expect(isDateBlocked("2025-01-20", blocked)).not.toBeNull();
  });

  it("retorna período no final do range", () => {
    expect(isDateBlocked("2025-01-22", blocked)).not.toBeNull();
  });

  it("retorna null quando data não está bloqueada", () => {
    expect(isDateBlocked("2025-01-19", blocked)).toBeNull();
  });

  it("retorna null quando data está entre ranges", () => {
    expect(isDateBlocked("2025-01-25", blocked)).toBeNull();
  });

  it("detecta bloqueio de dia único", () => {
    const result = isDateBlocked("2025-02-01", blocked);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe("Feriado");
  });

  it("retorna null para lista vazia de bloqueios", () => {
    expect(isDateBlocked("2025-01-20", [])).toBeNull();
  });
});

describe("getProfessionalSlotsForDay — slots por profissional/dia", () => {
  const mockProf = {
    id: 1,
    tenantId: 1,
    name: "Dr. Teste",
    specialty: "Geral",
    workingDays: "1,2,3,4,5",
    workingHoursStart: "08:00",
    workingHoursEnd: "18:00",
    lunchStart: "12:00",
    lunchEnd: "13:00",
    slotDurationMinutes: 30,
    isOwner: true,
    active: true,
  } as unknown as DentalProfessional;

  const sched = buildProfessionalSchedule(mockProf);

  it("retorna slots para dia útil (segunda=1)", () => {
    const slots = getProfessionalSlotsForDay(sched, 1, "2025-01-13", -3);
    expect(slots.length).toBeGreaterThan(0);
  });

  it("retorna vazio para dia não habilitado (domingo=0)", () => {
    const slots = getProfessionalSlotsForDay(sched, 0, "2025-01-12", -3);
    expect(slots).toHaveLength(0);
  });

  it("retorna vazio para sábado (6) quando não está nos workingDays", () => {
    const slots = getProfessionalSlotsForDay(sched, 6, "2025-01-18", -3);
    expect(slots).toHaveLength(0);
  });

  it("gera slots de manhã e tarde (sem horário de almoço)", () => {
    const slots = getProfessionalSlotsForDay(sched, 1, "2025-01-13", -3);
    const localTimes = slots.map((s) => utcToLocalTimeStr(s, -3));
    const hasMorning = localTimes.some((t) => t < "12:00");
    const hasAfternoon = localTimes.some((t) => t >= "13:00");
    expect(hasMorning).toBe(true);
    expect(hasAfternoon).toBe(true);
  });

  it("nenhum slot cai no horário de almoço (12:00-13:00)", () => {
    const slots = getProfessionalSlotsForDay(sched, 1, "2025-01-13", -3);
    const localTimes = slots.map((s) => utcToLocalTimeStr(s, -3));
    const lunchSlots = localTimes.filter((t) => t >= "12:00" && t < "13:00");
    expect(lunchSlots).toHaveLength(0);
  });
});

describe("buildProfessionalSchedule — construção do schedule", () => {
  it("parseia workingDays corretamente", () => {
    const prof = {
      workingDays: "1,3,5",
      workingHoursStart: "09:00",
      workingHoursEnd: "17:00",
      lunchStart: "12:00",
      lunchEnd: "13:00",
      slotDurationMinutes: 45,
    } as unknown as DentalProfessional;
    const sched = buildProfessionalSchedule(prof);
    expect(sched.enabledDays).toEqual(new Set([1, 3, 5]));
    expect(sched.morningStart).toBe("09:00");
    expect(sched.afternoonEnd).toBe("17:00");
    expect(sched.slotDuration).toBe(45);
  });

  it("usa defaults quando campos são null/undefined", () => {
    const prof = {
      workingDays: "1,2,3,4,5",
      workingHoursStart: null,
      workingHoursEnd: null,
      lunchStart: null,
      lunchEnd: null,
      slotDurationMinutes: null,
    } as unknown as DentalProfessional;
    const sched = buildProfessionalSchedule(prof);
    expect(sched.morningStart).toBe("08:00");
    expect(sched.afternoonEnd).toBe("18:00");
    expect(sched.morningEnd).toBe("12:00");
    expect(sched.afternoonStart).toBe("13:00");
    expect(sched.slotDuration).toBe(30);
  });
});

describe("filterInsuranceDays — restrição de dias para convênio (regressão)", () => {
  it("insuranceDays='6' → retorna apenas sábado", () => {
    const allWeek = new Set([0, 1, 2, 3, 4, 5, 6]);
    expect(filterInsuranceDays(allWeek, "6")).toEqual(new Set([6]));
  });

  it("insuranceDays vazio → retorna enabledDays inalterado", () => {
    const days = new Set([1, 2, 3, 4, 5]);
    expect(filterInsuranceDays(days, "")).toEqual(days);
  });

  it("insuranceDays='6' sobrescreve dias úteis (REPLACEMENT, não interseção)", () => {
    const weekdays = new Set([1, 2, 3, 4, 5]);
    expect(filterInsuranceDays(weekdays, "6")).toEqual(new Set([6]));
  });

  it("múltiplos dias: '6,1' → segunda e sábado", () => {
    const allWeek = new Set([0, 1, 2, 3, 4, 5, 6]);
    expect(filterInsuranceDays(allWeek, "6,1")).toEqual(new Set([1, 6]));
  });

  it("espaços em torno das vírgulas são tolerados", () => {
    const allWeek = new Set([0, 1, 2, 3, 4, 5, 6]);
    expect(filterInsuranceDays(allWeek, " 6 , 1 ")).toEqual(new Set([1, 6]));
  });

  it("não muta o conjunto original", () => {
    const days = new Set([1, 2, 3, 4, 5, 6]);
    const original = new Set(days);
    filterInsuranceDays(days, "6");
    expect(days).toEqual(original);
  });
});

describe("resolveInsuranceHours — resolução de horários do convênio (regressão)", () => {
  it("retorna horários do profissional quando ambos configurados", () => {
    expect(resolveInsuranceHours("08:00", "12:00", null, null)).toEqual({ start: "08:00", end: "12:00" });
  });

  it("retorna horários do settings quando profissional não tem", () => {
    expect(resolveInsuranceHours(null, null, "09:00", "13:00")).toEqual({ start: "09:00", end: "13:00" });
  });

  it("profissional tem precedência sobre settings", () => {
    expect(resolveInsuranceHours("08:00", "12:00", "09:00", "13:00")).toEqual({ start: "08:00", end: "12:00" });
  });

  it("retorna null quando nenhum horário configurado", () => {
    expect(resolveInsuranceHours(null, null, null, null)).toBeNull();
  });

  it("retorna null quando start sem end", () => {
    expect(resolveInsuranceHours("08:00", null, null, null)).toBeNull();
  });

  it("retorna null quando end sem start", () => {
    expect(resolveInsuranceHours(null, "12:00", null, null)).toBeNull();
  });

  it("suporta undefined como ausente", () => {
    expect(resolveInsuranceHours(undefined, undefined, "08:00", "12:00")).toEqual({ start: "08:00", end: "12:00" });
  });
});
