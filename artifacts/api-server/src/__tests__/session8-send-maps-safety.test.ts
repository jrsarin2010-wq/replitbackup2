/**
 * Session 8 — SEND_MAPS safety suite.
 *
 * Garante que renderSendMaps usa SEMPRE dados do servidor (RenderContext),
 * nunca campos que o LLM poderia ter alucinado (mapUrl / address no parsed).
 *
 * Cenários:
 *   1. LLM inventa mapUrl → renderer usa clinicMapUrl do contexto
 *   2. LLM inventa address → renderer usa clinicAddress do contexto
 *   3. Sem clinicAddress → degrada para JUST_REPLY genérica
 *   4. clinicMapUrl ausente mas address presente → gera URL automática
 *   5. LLM tenta inventar endereço elaborado → renderer ignora completamente
 *   6. LLM tenta injetar URL maliciosa → renderer ignora
 *   7. Regressão: cenários anteriores continuam funcionando
 *   8. End-to-end: lead pergunta "onde fica?" com clinic configurado
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

// ─────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────

const PROS: RenderableProfessional[] = [
  {
    id: 1,
    name: "Dr. Carlos",
    pixEnabled: false,
    pixKey: null,
    pixBank: null,
    pixKeyType: null,
    pixMode: null,
    consultationFee: "200",
    chargesConsultation: true,
  },
];

function buildCtx(overrides: Partial<RenderContext> = {}): RenderContext {
  const slotsWithIds = assignSlotIds([], PROS.map((p) => ({ id: p.id, name: p.name })));
  const profsWithIds = assignProfessionalIds(PROS.map((p) => ({ id: p.id, name: p.name })));
  return {
    slots: slotsWithIds,
    professionals: profsWithIds,
    professionalsFull: PROS,
    isInsuranceContact: false,
    settingsConsultationFee: null,
    settingsChargesConsultation: null,
    clinicName: "Clínica Teste",
    clinicAddress: "Rua das Flores, 123 — São Paulo, SP",
    clinicMapUrl: "https://maps.google.com/?q=Cl%C3%ADnica+Teste",
    ...overrides,
  };
}

function makeSendMaps(overrides: Partial<StructuredAIResponse> = {}): StructuredAIResponse {
  return {
    action: "SEND_MAPS",
    slot_ids: [],
    professional_id: null,
    reply_text: "Claro! Aqui está nossa localização.",
    request_more_slots: false,
    mapUrl: null,
    address: null,
    mapsMessage: "Aqui tá nossa localização!",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 1. LLM inventa mapUrl → renderer usa clinicMapUrl do contexto
// ─────────────────────────────────────────────────────────────────────────

describe("renderSendMaps / segurança contra alucinação", () => {
  it("ignora mapUrl do LLM e usa clinicMapUrl do contexto", () => {
    const parsed = makeSendMaps({
      mapUrl: "https://maps.google.com/?q=ENDERECO+INVENTADO+PELO+LLM",
    });
    const r = renderStructuredResponse(parsed, buildCtx());

    expect(r.text).toContain("https://maps.google.com/?q=Cl%C3%ADnica+Teste");
    expect(r.text).not.toContain("INVENTADO");
    expect(r.text).not.toContain("ENDERECO+INVENTADO");
  });

  // ─────────────────────────────────────────────────────────────────────
  // 2. LLM inventa address → renderer usa clinicAddress do contexto
  // ─────────────────────────────────────────────────────────────────────

  it("ignora address do LLM e usa clinicAddress do contexto", () => {
    const parsed = makeSendMaps({
      address: "Av. Alucinada, 999 — Cidade Inventada",
    });
    const r = renderStructuredResponse(parsed, buildCtx());

    expect(r.text).toContain("Rua das Flores, 123 — São Paulo, SP");
    expect(r.text).not.toContain("Alucinada");
    expect(r.text).not.toContain("Inventada");
  });

  // ─────────────────────────────────────────────────────────────────────
  // 3. Sem clinicAddress → degrada para JUST_REPLY genérica
  // ─────────────────────────────────────────────────────────────────────

  it("sem clinicAddress degrada para JUST_REPLY com mensagem segura", () => {
    const parsed = makeSendMaps();
    const r = renderStructuredResponse(
      parsed,
      buildCtx({ clinicAddress: null, clinicMapUrl: null }),
    );

    expect(r.shouldCreateAppointment).toBe(false);
    expect(r.chosenSlot).toBeNull();
    expect(r.text).toContain("confirmar alguns detalhes");
    expect(r.text).not.toMatch(/maps\.google\.com/);
  });

  // ─────────────────────────────────────────────────────────────────────
  // 4. clinicMapUrl ausente mas address presente → gera URL automática
  // ─────────────────────────────────────────────────────────────────────

  it("gera URL automática quando clinicMapUrl está ausente mas clinicAddress existe", () => {
    const parsed = makeSendMaps();
    const r = renderStructuredResponse(
      parsed,
      buildCtx({ clinicMapUrl: null }),
    );

    const expectedEncoded = encodeURIComponent("Rua das Flores, 123 — São Paulo, SP");
    expect(r.text).toContain(`https://maps.google.com/?q=${expectedEncoded}`);
    expect(r.text).toContain("Rua das Flores, 123 — São Paulo, SP");
  });

  // ─────────────────────────────────────────────────────────────────────
  // 5. LLM tenta inventar endereço elaborado → renderer ignora completamente
  // ─────────────────────────────────────────────────────────────────────

  it("LLM com endereço elaborado alucinado é completamente ignorado", () => {
    const parsed = makeSendMaps({
      address: "Rua dos Bobos, Número Zero, Bairro da Fantasia, 00000-000, Lugar Nenhum",
      mapUrl: "https://maps.google.com/?q=Rua+dos+Bobos+0",
    });
    const r = renderStructuredResponse(parsed, buildCtx());

    expect(r.text).toContain("Rua das Flores, 123 — São Paulo, SP");
    expect(r.text).not.toContain("Bobos");
    expect(r.text).not.toContain("Fantasia");
    expect(r.text).not.toContain("Lugar+Nenhum");
  });

  // ─────────────────────────────────────────────────────────────────────
  // 6. LLM tenta injetar URL maliciosa → renderer ignora
  // ─────────────────────────────────────────────────────────────────────

  it("URL maliciosa do LLM é descartada", () => {
    const parsed = makeSendMaps({
      mapUrl: "https://evil.example.com/phishing?redirect=https://maps.google.com",
    });
    const r = renderStructuredResponse(parsed, buildCtx());

    expect(r.text).not.toContain("evil.example.com");
    expect(r.text).not.toContain("phishing");
    expect(r.text).toContain("https://maps.google.com/?q=Cl%C3%ADnica+Teste");
  });

  // ─────────────────────────────────────────────────────────────────────
  // 7. Regressão: campos corretos do SEND_MAPS continuam funcionando
  // ─────────────────────────────────────────────────────────────────────

  it("regressão: mapsMessage do LLM ainda é usado no texto de apresentação", () => {
    const parsed = makeSendMaps({
      mapsMessage: "Segue nosso endereço, boa visita!",
    });
    const r = renderStructuredResponse(parsed, buildCtx());

    expect(r.text).toContain("Segue nosso endereço, boa visita!");
    expect(r.text).toContain("Rua das Flores, 123 — São Paulo, SP");
    expect(r.shouldCreateAppointment).toBe(false);
    expect(r.chosenSlot).toBeNull();
    expect(r.markers).toEqual([]);
  });

  it("regressão: mapsMessage null usa mensagem padrão", () => {
    const parsed = makeSendMaps({ mapsMessage: null });
    const r = renderStructuredResponse(parsed, buildCtx());

    expect(r.text).toContain("Aqui tá nossa localização!");
    expect(r.text).toContain("Rua das Flores, 123 — São Paulo, SP");
  });

  // ─────────────────────────────────────────────────────────────────────
  // 8. End-to-end: lead pergunta "onde fica?" com clinic configurado
  // ─────────────────────────────────────────────────────────────────────

  it("end-to-end: resposta completa com endereço correto para 'onde fica?'", () => {
    const parsed = makeSendMaps({
      mapsMessage: "Olha onde a gente fica!",
      // LLM tenta mandar seus próprios dados — ambos devem ser ignorados
      address: "Endereço inventado pelo modelo",
      mapUrl: "https://maps.google.com/?q=inventado",
    });

    const ctx = buildCtx({
      clinicAddress: "Av. Paulista, 1000 — Bela Vista, SP",
      clinicMapUrl: "https://maps.google.com/?q=Av.+Paulista+1000",
    });

    const r = renderStructuredResponse(parsed, ctx);

    // Estrutura esperada: mensagem + endereço server-side + mapUrl server-side
    expect(r.text).toContain("Olha onde a gente fica!");
    expect(r.text).toContain("Av. Paulista, 1000 — Bela Vista, SP");
    expect(r.text).toContain("https://maps.google.com/?q=Av.+Paulista+1000");

    // Dados do LLM não devem aparecer
    expect(r.text).not.toContain("inventado");
    expect(r.text).not.toContain("Endereço inventado");

    // Estrutura de RenderedReply correta
    expect(r.shouldCreateAppointment).toBe(false);
    expect(r.chosenSlot).toBeNull();
    expect(r.chosenProfessional).toBeNull();
    expect(r.markers).toEqual([]);
  });
});
