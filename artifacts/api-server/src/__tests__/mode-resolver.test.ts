import { describe, it, expect } from "vitest";
import { resolveConversationMode, type ConversationMode } from "../lib/mode-resolver";
import type { InsuranceModeResult } from "../lib/lead-engine";

const im = (over: Partial<InsuranceModeResult> = {}): InsuranceModeResult => ({
  isInsurance: false,
  isPrivate: false,
  triageComplete: false,
  triageNeeded: false,
  ...over,
});

describe("resolveConversationMode (Task #17 — golden suite)", () => {
  const cases: Array<{
    name: string;
    input: Parameters<typeof resolveConversationMode>[0];
    expected: ConversationMode;
  }> = [
    {
      name: "lead novo + clínica aceita convênio + nada declarado → CONVENIO_TRIAGEM",
      input: { contactType: "lead", clinicAcceptsInsurance: true, insuranceMode: im({ triageNeeded: true }) },
      expected: "CONVENIO_TRIAGEM",
    },
    {
      name: "lead + declarou plano → CONVENIO_AGENDAR",
      input: { contactType: "lead", clinicAcceptsInsurance: true, insuranceMode: im({ isInsurance: true, triageComplete: true }) },
      expected: "CONVENIO_AGENDAR",
    },
    {
      name: "lead + declarou particular → PARTICULAR_SPIN",
      input: { contactType: "lead", clinicAcceptsInsurance: true, insuranceMode: im({ isPrivate: true, triageComplete: true }) },
      expected: "PARTICULAR_SPIN",
    },
    {
      name: "lead + clínica NÃO aceita convênio → PARTICULAR_SPIN",
      input: { contactType: "lead", clinicAcceptsInsurance: false, insuranceMode: im() },
      expected: "PARTICULAR_SPIN",
    },
    {
      name: "paciente recorrente + nada declarado → PACIENTE_AGENDAR",
      input: { contactType: "patient", clinicAcceptsInsurance: true, insuranceMode: im({ triageNeeded: true }) },
      expected: "PACIENTE_AGENDAR",
    },
    {
      name: "paciente + declarou plano → CONVENIO_AGENDAR (convênio sempre prioritário)",
      input: { contactType: "patient", clinicAcceptsInsurance: true, insuranceMode: im({ isInsurance: true, triageComplete: true }) },
      expected: "CONVENIO_AGENDAR",
    },
    {
      name: "paciente + clínica só particular → PACIENTE_AGENDAR",
      input: { contactType: "patient", clinicAcceptsInsurance: false, insuranceMode: im() },
      expected: "PACIENTE_AGENDAR",
    },
    {
      name: "unknown contact + clínica particular → PARTICULAR_SPIN",
      input: { contactType: "unknown", clinicAcceptsInsurance: false, insuranceMode: im() },
      expected: "PARTICULAR_SPIN",
    },
    {
      name: "unknown contact + clínica convênio + sem triagem → CONVENIO_TRIAGEM",
      input: { contactType: "unknown", clinicAcceptsInsurance: true, insuranceMode: im({ triageNeeded: true }) },
      expected: "CONVENIO_TRIAGEM",
    },
    {
      name: "unknown contact + isInsurance=true → CONVENIO_AGENDAR",
      input: { contactType: "unknown", clinicAcceptsInsurance: true, insuranceMode: im({ isInsurance: true, triageComplete: true }) },
      expected: "CONVENIO_AGENDAR",
    },
    {
      name: "lead + ambos isInsurance e isPrivate (conflito) → CONVENIO_AGENDAR (insurance ganha)",
      input: { contactType: "lead", clinicAcceptsInsurance: true, insuranceMode: im({ isInsurance: true, isPrivate: true, triageComplete: true }) },
      expected: "CONVENIO_AGENDAR",
    },
    {
      name: "paciente + isPrivate declarado → PACIENTE_AGENDAR",
      input: { contactType: "patient", clinicAcceptsInsurance: true, insuranceMode: im({ isPrivate: true, triageComplete: true }) },
      expected: "PACIENTE_AGENDAR",
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const r = resolveConversationMode(c.input);
      expect(r.mode).toBe(c.expected);
      expect(r.reason).toMatch(/\w+/);
    });
  }

  it("retorna sempre um dos 4 modos", () => {
    const valid = new Set(["CONVENIO_TRIAGEM", "CONVENIO_AGENDAR", "PARTICULAR_SPIN", "PACIENTE_AGENDAR"]);
    for (const ct of ["lead", "patient", "unknown"] as const) {
      for (const cai of [true, false]) {
        for (const isI of [true, false]) {
          for (const isP of [true, false]) {
            const r = resolveConversationMode({
              contactType: ct,
              clinicAcceptsInsurance: cai,
              insuranceMode: im({ isInsurance: isI, isPrivate: isP, triageComplete: isI || isP, triageNeeded: cai && !(isI || isP) }),
            });
            expect(valid.has(r.mode)).toBe(true);
          }
        }
      }
    }
  });
});
