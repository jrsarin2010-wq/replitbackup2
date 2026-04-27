import { describe, it, expect } from "vitest";
import { isSlotValidForMode, filterValidSlots, type ProfessionalSchedule } from "../lib/schedule-validator";
import { buildConstrainedPrompt } from "../lib/constrained-prompt";
import type { AvailableSlot } from "../lib/schedule-engine";

// Dates chosen so days-of-week are deterministic (verified via getUTCDay):
//   2026-05-04 = Monday    (getUTCDay=1)
//   2026-05-05 = Tuesday   (getUTCDay=2)
//   2026-05-06 = Wednesday (getUTCDay=3)
//   2026-05-07 = Thursday  (getUTCDay=4)
//   2026-05-08 = Friday    (getUTCDay=5)

const SCHEDULE: ProfessionalSchedule = {
  workingDays: "1,2,3,4,5",   // Mon–Fri
  insuranceDays: "2,3,4",      // Tue–Thu (plano só nesses dias)
  slotDurationMinutes: 30,
};

const SLOTS: AvailableSlot[] = [
  { date: "2026-05-04", time: "09:00", professionalId: 1 }, // Monday   (1)
  { date: "2026-05-05", time: "10:00", professionalId: 1 }, // Tuesday  (2)
  { date: "2026-05-06", time: "11:00", professionalId: 1 }, // Wednesday(3)
  { date: "2026-05-08", time: "14:00", professionalId: 1 }, // Friday   (5)
];

describe("Schedule Validation — respecting professional schedule", () => {
  describe("T1: sexta-feira com CONVENIO_TRIAGEM", () => {
    it("deve rejeitar — plano nao atende sexta (dia 5 nao esta em insuranceDays 2,3,4)", () => {
      expect(isSlotValidForMode(SLOTS[3], "CONVENIO_TRIAGEM", SCHEDULE)).toBe(false);
    });
  });

  describe("T2: quarta-feira com CONVENIO_TRIAGEM", () => {
    it("deve aceitar — quarta (dia 3) esta em insuranceDays 2,3,4", () => {
      expect(isSlotValidForMode(SLOTS[2], "CONVENIO_TRIAGEM", SCHEDULE)).toBe(true);
    });
  });

  describe("T3: segunda-feira com PARTICULAR_SPIN", () => {
    it("deve aceitar — segunda (dia 1) esta em workingDays 1,2,3,4,5", () => {
      expect(isSlotValidForMode(SLOTS[0], "PARTICULAR_SPIN", SCHEDULE)).toBe(true);
    });
  });

  describe("T4: slot de 30min com procedimento de 60min", () => {
    it("deve rejeitar — procedimento exige mais tempo que o slot oferece", () => {
      expect(
        isSlotValidForMode(SLOTS[1], "PARTICULAR_SPIN", SCHEDULE, { durationMinutes: 60 }),
      ).toBe(false);
    });
  });

  describe("T5: slot de 30min com procedimento de 30min", () => {
    it("deve aceitar — duracao bate com o slot", () => {
      expect(
        isSlotValidForMode(SLOTS[1], "PARTICULAR_SPIN", SCHEDULE, { durationMinutes: 30 }),
      ).toBe(true);
    });
  });

  describe("T6: filterValidSlots com CONVENIO_TRIAGEM", () => {
    it("deve retornar apenas slots de ter/qua/qui (insuranceDays 2,3,4)", () => {
      const result = filterValidSlots(SLOTS, "CONVENIO_TRIAGEM", SCHEDULE);
      expect(result.length).toBe(2); // terça e quarta (segunda e sexta fora)
      expect(result[0].date).toBe("2026-05-05"); // terça
      expect(result[1].date).toBe("2026-05-06"); // quarta
    });
  });

  describe("T7: filterValidSlots com PARTICULAR_SPIN", () => {
    it("deve retornar todos os slots dentro de workingDays seg-sex", () => {
      const result = filterValidSlots(SLOTS, "PARTICULAR_SPIN", SCHEDULE);
      expect(result.length).toBe(4); // seg, ter, qua, sex — todos em workingDays
    });
  });

  describe("T8: modo URGENCIA respeita workingDays", () => {
    it("deve aceitar slot dentro de workingDays", () => {
      expect(isSlotValidForMode(SLOTS[1], "URGENCIA", SCHEDULE)).toBe(true);
    });
  });

  describe("T9: modo null tratado como particular (usa workingDays)", () => {
    it("deve aceitar slot de segunda que esta em workingDays", () => {
      expect(isSlotValidForMode(SLOTS[0], null, SCHEDULE)).toBe(true);
    });
  });
});

// ─── Helpers para os testes de prompt ────────────────────────────────────────

function makePromptCtx(overrides: Record<string, unknown>) {
  return {
    clinicName: "Sorrizin Maxx",
    aiName: "Julia",
    mode: null as null,
    isInsuranceContact: false,
    isFirstContact: false,
    contactType: "lead",
    intent: "agendar",
    slots: [],
    professionals: [],
    procedureNames: [],
    todayLabel: "Seg 04/05/2026",
    ...overrides,
  };
}

describe("Parcelamento no prompt", () => {
  describe("T10: acceptsInstallments=true, maxInstallments=3", () => {
    it("prompt deve mencionar parcelamento e o numero de parcelas", () => {
      const prompt = buildConstrainedPrompt(makePromptCtx({
        acceptsInstallments: true,
        maxInstallments: 3,
      }));
      expect(prompt).toContain("parcelar");
      expect(prompt).toContain("3x");
    });
  });

  describe("T11: acceptsInstallments=false", () => {
    it("prompt deve mencionar pagamento a vista e nao mencionar parcelamento como opcao", () => {
      const prompt = buildConstrainedPrompt(makePromptCtx({
        acceptsInstallments: false,
        maxInstallments: 1,
      }));
      expect(prompt).toContain("a vista");
      expect(prompt).not.toContain("parcelar em ate");
    });
  });
});
