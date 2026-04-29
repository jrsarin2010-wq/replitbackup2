/**
 * Session 9 — PIX OBRIGATORIO safety suite.
 *
 * Garante que em pixMode=OBRIGATORIO o agendamento SÓ é confirmado APÓS
 * comprovante PIX ser detectado — renderConfirmSlot retorna
 * shouldCreateAppointment=false e delega a confirmação ao engine.
 *
 * Cenários:
 *   1. pixMode=null (particular/desativado) → shouldCreateAppointment=true
 *   2. pixMode=OBRIGATORIO → shouldCreateAppointment=false
 *   3. pixMode=OBRIGATORIO + slot válido → chosenSlot preservado para uso futuro
 *   4. detectProofOfPayment("transferi") → true
 *   5. detectProofOfPayment("comprovante") → true
 *   6. detectProofOfPayment("paguei") → true
 *   7. detectProofOfPayment mensagem normal → false
 *   8. End-to-end: aceita slot + OBRIGATORIO → shouldCreate=false + prova → true
 *   9. ALL_MODES inclui PIX_PENDING (buildConstrainedPrompt não quebra)
 *  10. modeBlock PIX_PENDING tem instruções corretas
 *  11. Regressão: pixMode=OPCIONAL → shouldCreateAppointment=true (não bloqueia)
 *  12. Regressão: sem pixMode → shouldCreateAppointment=true (comportamento legado)
 */

import { describe, it, expect } from "vitest";
import {
  assignSlotIds,
  assignProfessionalIds,
  type StructuredAIResponse,
} from "../lib/constrained-output";
import {
  renderStructuredResponse,
  type RenderContext,
  type RenderableProfessional,
} from "../lib/structured-renderer";
import { detectProofOfPayment } from "../lib/constrained-engine";
import { buildConstrainedPrompt } from "../lib/constrained-prompt";
import type { AvailableSlot } from "../lib/schedule-engine";

// ─────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────

const SLOTS: AvailableSlot[] = [
  { date: "2026-05-05", time: "09:00", professionalId: 1 },
  { date: "2026-05-05", time: "14:00", professionalId: 1 },
] as AvailableSlot[];

const PROS: RenderableProfessional[] = [
  {
    id: 1,
    name: "Dr. Carlos",
    pixEnabled: true,
    pixKey: "12345678900",
    pixBank: "Itau",
    pixKeyType: "cpf",
    pixMode: "required",
    consultationFee: "200",
    chargesConsultation: true,
  },
];

function buildCtx(overrides: Partial<RenderContext> = {}): RenderContext {
  const slotsWithIds = assignSlotIds(SLOTS, PROS.map((p) => ({ id: p.id, name: p.name })));
  const profsWithIds = assignProfessionalIds(PROS.map((p) => ({ id: p.id, name: p.name })));
  return {
    slots: slotsWithIds,
    professionals: profsWithIds,
    professionalsFull: PROS,
    isInsuranceContact: false,
    settingsConsultationFee: null,
    settingsChargesConsultation: null,
    clinicName: "Clínica Teste",
    pixMode: null,
    ...overrides,
  };
}

function makeConfirmSlot(overrides: Partial<StructuredAIResponse> = {}): StructuredAIResponse {
  return {
    action: "CONFIRM_SLOT",
    slot_ids: ["s1"],
    professional_id: "p1",
    reply_text: "Ótimo!",
    request_more_slots: false,
    mapUrl: null,
    address: null,
    mapsMessage: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 1. pixMode=null → shouldCreateAppointment=true (sem PIX obrigatório)
// ─────────────────────────────────────────────────────────────────────────

describe("renderConfirmSlot / pixMode safety", () => {
  it("pixMode=null → cria appointment imediatamente", () => {
    const r = renderStructuredResponse(makeConfirmSlot(), buildCtx({ pixMode: null }));
    expect(r.shouldCreateAppointment).toBe(true);
    expect(r.chosenSlot).not.toBeNull();
  });

  // ───────────────────────────────────────────────────────────────────────
  // 2. pixMode=OBRIGATORIO → shouldCreateAppointment=false
  // ───────────────────────────────────────────────────────────────────────

  it("pixMode=OBRIGATORIO → NÃO cria appointment, aguarda comprovante", () => {
    const r = renderStructuredResponse(
      makeConfirmSlot(),
      buildCtx({ pixMode: "OBRIGATORIO" }),
    );
    expect(r.shouldCreateAppointment).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 3. pixMode=OBRIGATORIO → chosenSlot preservado para uso futuro
  // ───────────────────────────────────────────────────────────────────────

  it("pixMode=OBRIGATORIO → chosenSlot preservado no resultado (para criar após comprovante)", () => {
    const r = renderStructuredResponse(
      makeConfirmSlot(),
      buildCtx({ pixMode: "OBRIGATORIO" }),
    );
    expect(r.chosenSlot).not.toBeNull();
    expect(r.chosenSlot?.date).toBe("2026-05-05");
    expect(r.chosenSlot?.time).toBe("09:00");
  });

  // ───────────────────────────────────────────────────────────────────────
  // 4–6. detectProofOfPayment — keywords de comprovante
  // ───────────────────────────────────────────────────────────────────────

  it("detectProofOfPayment: 'transferi' → true", () => {
    expect(detectProofOfPayment("transferi R$ 200 agora")).toBe(true);
  });

  it("detectProofOfPayment: 'comprovante' → true", () => {
    expect(detectProofOfPayment("Aqui está o comprovante")).toBe(true);
  });

  it("detectProofOfPayment: 'paguei' → true", () => {
    expect(detectProofOfPayment("paguei sim, pode confirmar")).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 7. detectProofOfPayment — mensagem normal
  // ───────────────────────────────────────────────────────────────────────

  it("detectProofOfPayment: mensagem normal → false", () => {
    expect(detectProofOfPayment("Oi, que horários vocês têm disponíveis?")).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 8. End-to-end: OBRIGATORIO → false + prova → true (duas fases)
  // ───────────────────────────────────────────────────────────────────────

  it("end-to-end: fase 1 aceita slot (OBRIGATORIO) → shouldCreate=false + fase 2 comprovante → detectProofOfPayment=true", () => {
    // Fase 1: lead aceita slot com pixMode OBRIGATORIO
    const fase1 = renderStructuredResponse(
      makeConfirmSlot(),
      buildCtx({ pixMode: "OBRIGATORIO" }),
    );
    expect(fase1.shouldCreateAppointment).toBe(false);
    expect(fase1.chosenSlot).not.toBeNull();

    // Fase 2: lead envia comprovante — detectProofOfPayment sinaliza ao engine
    const leadMessage = "segue o comprovante de transferência";
    expect(detectProofOfPayment(leadMessage)).toBe(true);

    // O engine usaria fase1.chosenSlot para criar o appointment após a detecção.
    // Aqui apenas validamos que os dois sinais necessários estão corretos.
    expect(fase1.chosenSlot?.date).toBeDefined();
    expect(fase1.chosenProfessional?.name).toBeDefined();
  });

  // ───────────────────────────────────────────────────────────────────────
  // 9. ALL_MODES inclui PIX_PENDING (buildConstrainedPrompt não quebra)
  // ───────────────────────────────────────────────────────────────────────

  it("buildConstrainedPrompt aceita mode=PIX_PENDING sem quebrar", () => {
    const ctx = {
      clinicName: "Clínica Teste",
      aiName: "Julia",
      mode: "PIX_PENDING" as const,
      isInsuranceContact: false,
      isFirstContact: false,
      contactType: "lead",
      intent: "agendar",
      slots: [],
      professionals: [],
      procedureNames: [],
      todayLabel: "Seg 05/05/2026",
      pixMode: "OBRIGATORIO" as const,
      pixKey: "clinica@pix.com",
      pixAmount: "200",
      pixHolderName: "Clínica Teste LTDA",
    };
    expect(() => buildConstrainedPrompt(ctx)).not.toThrow();
  });

  // ───────────────────────────────────────────────────────────────────────
  // 10. modeBlock PIX_PENDING tem instruções corretas
  // ───────────────────────────────────────────────────────────────────────

  it("buildConstrainedPrompt em mode=PIX_PENDING inclui instrução de aguardar comprovante", () => {
    const ctx = {
      clinicName: "Clínica Teste",
      aiName: "Julia",
      mode: "PIX_PENDING" as const,
      isInsuranceContact: false,
      isFirstContact: false,
      contactType: "lead",
      intent: "agendar",
      slots: [],
      professionals: [],
      procedureNames: [],
      todayLabel: "Seg 05/05/2026",
      pixMode: "OBRIGATORIO" as const,
      pixKey: "clinica@pix.com",
      pixAmount: "200",
      pixHolderName: "Clínica Teste LTDA",
    };
    const prompt = buildConstrainedPrompt(ctx);
    expect(prompt).toContain("PIX_PENDING");
    expect(prompt).toContain("comprovante");
    expect(prompt).toContain("AGUARDANDO");
  });

  // ───────────────────────────────────────────────────────────────────────
  // 11. Regressão: pixMode=OPCIONAL → cria appointment normalmente
  // ───────────────────────────────────────────────────────────────────────

  it("regressão: pixMode=OPCIONAL → shouldCreateAppointment=true", () => {
    const r = renderStructuredResponse(
      makeConfirmSlot(),
      buildCtx({ pixMode: "OPCIONAL" }),
    );
    expect(r.shouldCreateAppointment).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 12. Regressão: sem pixMode → comportamento legado (cria appointment)
  // ───────────────────────────────────────────────────────────────────────

  it("regressão: pixMode=DESATIVADO → shouldCreateAppointment=true", () => {
    const r = renderStructuredResponse(
      makeConfirmSlot(),
      buildCtx({ pixMode: "DESATIVADO" }),
    );
    expect(r.shouldCreateAppointment).toBe(true);
  });

  it("regressão: pixMode não passado → shouldCreateAppointment=true (comportamento legado)", () => {
    const ctx = buildCtx();
    delete (ctx as Partial<RenderContext>).pixMode;
    const r = renderStructuredResponse(makeConfirmSlot(), ctx);
    expect(r.shouldCreateAppointment).toBe(true);
  });
});
