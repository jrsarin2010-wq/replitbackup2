/**
 * Suíte de testes — conversation-policy.ts
 *
 * Cobre as regras de RITMO da conversa com leads particulares.
 * Princípio: CONEXÃO ANTES DE CONVERSÃO.
 *
 * Bug central que este arquivo previne:
 *   A IA oferecer horário de agendamento cedo demais, antes de entender
 *   o problema do lead e criar rapport — o que soa robótico e derruba conversão.
 */

import { describe, it, expect } from "vitest";
import {
  resolveSpinPhase,
  shouldOfferSchedule,
  minExchangesBeforeScheduleOffer,
  buildSpinPacingInstruction,
} from "../lib/conversation-policy";

// ─────────────────────────────────────────────────────────────────────────────
// resolveSpinPhase
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveSpinPhase", () => {
  it("cold → fase S, NÃO pode oferecer horário", () => {
    const result = resolveSpinPhase("cold");
    expect(result.phase).toBe("S");
    expect(result.canOfferSchedule).toBe(false);
  });

  it("cold → instrução contém proibição de oferecer horário", () => {
    const result = resolveSpinPhase("cold");
    expect(result.instruction.toLowerCase()).toContain("nao oferte");
    expect(result.instruction.toLowerCase()).toContain("nao venda");
  });

  it("warm → fase P/I, AINDA NÃO pode oferecer horário", () => {
    const result = resolveSpinPhase("warm");
    expect(result.phase).toBe("PI");
    // BUG que previne: warm não pode pular direto para horário
    expect(result.canOfferSchedule).toBe(false);
  });

  it("warm → instrução exige pergunta ANTES de oferecer horário", () => {
    const result = resolveSpinPhase("warm");
    // Deve conter instrução de gate — não oferecer antes de explorar o problema
    expect(result.instruction.toLowerCase()).toContain("gate");
    expect(result.instruction.toLowerCase()).toContain("nao oferecer horario");
  });

  it("hot → fase N, PODE oferecer horário", () => {
    const result = resolveSpinPhase("hot");
    expect(result.phase).toBe("N");
    expect(result.canOfferSchedule).toBe(true);
  });

  it("hot → instrução menciona conduzir ao agendamento", () => {
    const result = resolveSpinPhase("hot");
    expect(result.instruction.toLowerCase()).toContain("agendamento");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// minExchangesBeforeScheduleOffer
// ─────────────────────────────────────────────────────────────────────────────

describe("minExchangesBeforeScheduleOffer", () => {
  it("cold → mínimo 2 trocas", () => {
    expect(minExchangesBeforeScheduleOffer("cold")).toBe(2);
  });

  it("warm → mínimo 2 trocas", () => {
    expect(minExchangesBeforeScheduleOffer("warm")).toBe(2);
  });

  it("hot → mínimo 1 troca (lead sinalizou intenção)", () => {
    expect(minExchangesBeforeScheduleOffer("hot")).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// shouldOfferSchedule — cenários de cada combinação
// ─────────────────────────────────────────────────────────────────────────────

describe("shouldOfferSchedule — bloqueios", () => {
  const base = {
    inConnectionPhase: false,
    contactDeclaredInsurance: false,
    canOfferSchedule: true,
    messagesExchanged: 4,
  };

  it("lead FRIO (cold) → NUNCA oferece, mesmo com muitas trocas", () => {
    expect(shouldOfferSchedule({ ...base, temperature: "cold" })).toBe(false);
  });

  it("lead MORNO (warm) → NÃO oferece (fase P/I exige explorar problema primeiro)", () => {
    // BUG que previne: warm não pode pular para horário sem explorar o problema
    expect(shouldOfferSchedule({ ...base, temperature: "warm" })).toBe(false);
  });

  it("lead QUENTE (hot) com trocas suficientes → PODE oferecer", () => {
    expect(shouldOfferSchedule({ ...base, temperature: "hot" })).toBe(true);
  });

  it("inConnectionPhase=true → NUNCA oferece independente da temperatura", () => {
    expect(shouldOfferSchedule({ ...base, temperature: "hot", inConnectionPhase: true })).toBe(false);
    expect(shouldOfferSchedule({ ...base, temperature: "warm", inConnectionPhase: true })).toBe(false);
    expect(shouldOfferSchedule({ ...base, temperature: "cold", inConnectionPhase: true })).toBe(false);
  });

  it("canOfferSchedule=false → NUNCA oferece (agenda não disponível)", () => {
    expect(shouldOfferSchedule({ ...base, temperature: "hot", canOfferSchedule: false })).toBe(false);
  });

  it("hot mas messagesExchanged=0 → NÃO oferece ainda (gate mínimo 1 troca)", () => {
    expect(shouldOfferSchedule({ ...base, temperature: "hot", messagesExchanged: 0 })).toBe(false);
  });

  it("hot com messagesExchanged=1 → PODE oferecer (gate satisfeito)", () => {
    expect(shouldOfferSchedule({ ...base, temperature: "hot", messagesExchanged: 1 })).toBe(true);
  });

  it("hot com messagesExchanged=2 → PODE oferecer", () => {
    expect(shouldOfferSchedule({ ...base, temperature: "hot", messagesExchanged: 2 })).toBe(true);
  });
});

describe("shouldOfferSchedule — convênio declarado bypassa connectionPhase", () => {
  it("insurance declared + inConnectionPhase → NÃO bloqueia (convênio vai direto para agenda)", () => {
    // Convênio não faz SPIN — quando o contato declara plano, vai direto para horário
    // Mas como o temperature seria cold e canOfferSchedule controls isso, verificamos o gate
    const result = shouldOfferSchedule({
      temperature: "hot",
      inConnectionPhase: true,
      contactDeclaredInsurance: true, // bypass connection phase
      canOfferSchedule: true,
      messagesExchanged: 2,
    });
    // contactDeclaredInsurance=true bypassa o inConnectionPhase → pode oferecer
    expect(result).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildSpinPacingInstruction
// ─────────────────────────────────────────────────────────────────────────────

describe("buildSpinPacingInstruction", () => {
  it("cold com 0 trocas → menciona trocas restantes", () => {
    const instruction = buildSpinPacingInstruction("cold", 0);
    expect(instruction.toLowerCase()).toContain("troca");
  });

  it("warm com 1 troca → menciona trocas restantes", () => {
    const instruction = buildSpinPacingInstruction("warm", 1);
    expect(instruction.toLowerCase()).toContain("troca");
  });

  it("hot com 0 trocas → ainda menciona trocas restantes (gate mínimo)", () => {
    const instruction = buildSpinPacingInstruction("hot", 0);
    expect(instruction.toLowerCase()).toContain("troca");
  });

  it("hot com 2 trocas → instrução de necessidade, sem mencionar trocas restantes", () => {
    const instruction = buildSpinPacingInstruction("hot", 2);
    // Lead quente com trocas suficientes → instrução de fechar
    expect(instruction.toLowerCase()).toContain("agendamento");
    expect(instruction.toLowerCase()).not.toContain("troca");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cenários de regressão — bugs de ritmo que já aconteceram
// ─────────────────────────────────────────────────────────────────────────────

describe("Regressões de ritmo — bugs de spin selling", () => {
  it("BUG #6: IA não deve oferecer horário no 1º ou 2º contato com lead frio", () => {
    // Lead acabou de chegar, temperatura cold, 0 trocas
    const result = shouldOfferSchedule({
      temperature: "cold",
      inConnectionPhase: false,
      contactDeclaredInsurance: false,
      canOfferSchedule: true,
      messagesExchanged: 0,
    });
    expect(result).toBe(false);
  });

  it("BUG #7: lead morno não deve receber oferta de horário sem explorar o problema", () => {
    // Lead warm = 2ª fase SPIN, mas ainda não explorou o problema
    // A IA estava pulando direto para horário quando temperature=warm
    const result = shouldOfferSchedule({
      temperature: "warm",
      inConnectionPhase: false,
      contactDeclaredInsurance: false,
      canOfferSchedule: true,
      messagesExchanged: 5,
    });
    expect(result).toBe(false);
  });

  it("BUG #8: fase warm deve exigir exploração do problema — instrução proíbe oferta prematura", () => {
    const phase = resolveSpinPhase("warm");
    // A instrução da fase warm DEVE conter "gate" de bloqueio
    expect(phase.canOfferSchedule).toBe(false);
    expect(phase.instruction).toContain("Gate");
  });
});
