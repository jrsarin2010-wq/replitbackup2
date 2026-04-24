import { describe, it, expect } from "vitest";
import {
  selectStrategiesForLead,
  selectStrategiesForInsurancePatient,
  SALES_STRATEGIES,
} from "../lib/lead-engine.js";
import type { SalesStrategy, StrategyScore } from "../lib/lead-engine.js";

describe("selectStrategiesForInsurancePatient — estratégias para pacientes de convênio", () => {
  it("retorna apenas spin_situacao", () => {
    const strategies = selectStrategiesForInsurancePatient();
    expect(strategies).toEqual(["spin_situacao"]);
  });

  it("NÃO inclui estratégias de pressão comercial", () => {
    const strategies = selectStrategiesForInsurancePatient();
    const proibidas: SalesStrategy[] = ["urgency", "scarcity", "loss_aversion", "micro_commitment"];
    proibidas.forEach((s) => {
      expect(strategies).not.toContain(s);
    });
  });

  it("retorna array com exatamente 1 estratégia", () => {
    expect(selectStrategiesForInsurancePatient()).toHaveLength(1);
  });
});

describe("selectStrategiesForLead — seleção de estratégias por temperatura e intenção", () => {
  const noTopStrategies: StrategyScore[] = [];

  describe("cold leads", () => {
    it("cold + greeting → spin_situacao + authority_positioning + reactivation", () => {
      const result = selectStrategiesForLead("cold", "greeting", noTopStrategies);
      expect(result).toContain("spin_situacao");
      expect(result).toContain("authority_positioning");
      expect(result).toContain("reactivation");
    });

    it("cold + objection → spin_situacao + educational_trust + benefit_focused", () => {
      const result = selectStrategiesForLead("cold", "objection", noTopStrategies);
      expect(result).toContain("spin_situacao");
      expect(result).toContain("educational_trust");
      expect(result).toContain("benefit_focused");
    });

    it("cold + price_inquiry → spin_situacao + price_anchoring + comparison_cost", () => {
      const result = selectStrategiesForLead("cold", "price_inquiry", noTopStrategies);
      expect(result).toContain("spin_situacao");
      expect(result).toContain("price_anchoring");
      expect(result).toContain("comparison_cost");
    });

    it("cold + question → spin_situacao + educational_trust + authority_positioning", () => {
      const result = selectStrategiesForLead("cold", "question", noTopStrategies);
      expect(result).toContain("spin_situacao");
      expect(result).toContain("educational_trust");
      expect(result).toContain("authority_positioning");
    });

    it("cold + scheduling → spin_situacao + future_pacing + storytelling", () => {
      const result = selectStrategiesForLead("cold", "scheduling", noTopStrategies);
      expect(result).toContain("spin_situacao");
      expect(result).toContain("future_pacing");
      expect(result).toContain("storytelling");
    });
  });

  describe("warm leads", () => {
    it("warm + greeting → spin_problema + spin_implicacao + social_proof", () => {
      const result = selectStrategiesForLead("warm", "greeting", noTopStrategies);
      expect(result).toContain("spin_problema");
      expect(result).toContain("spin_implicacao");
      expect(result).toContain("social_proof");
    });

    it("warm + objection → spin_problema + loss_aversion + benefit_focused", () => {
      const result = selectStrategiesForLead("warm", "objection", noTopStrategies);
      expect(result).toContain("spin_problema");
      expect(result).toContain("loss_aversion");
      expect(result).toContain("benefit_focused");
    });

    it("warm + scheduling → spin_implicacao + future_pacing + social_proof", () => {
      const result = selectStrategiesForLead("warm", "scheduling", noTopStrategies);
      expect(result).toContain("spin_implicacao");
      expect(result).toContain("future_pacing");
      expect(result).toContain("social_proof");
    });
  });

  describe("hot leads", () => {
    it("hot + greeting → spin_necessidade + micro_commitment + urgency", () => {
      const result = selectStrategiesForLead("hot", "greeting", noTopStrategies);
      expect(result).toContain("spin_necessidade");
      expect(result).toContain("micro_commitment");
      expect(result).toContain("urgency");
    });

    it("hot + scheduling → micro_commitment + spin_necessidade + scarcity", () => {
      const result = selectStrategiesForLead("hot", "scheduling", noTopStrategies);
      expect(result).toContain("micro_commitment");
      expect(result).toContain("spin_necessidade");
      expect(result).toContain("scarcity");
    });

    it("hot + objection → spin_implicacao + spin_necessidade + loss_aversion", () => {
      const result = selectStrategiesForLead("hot", "objection", noTopStrategies);
      expect(result).toContain("spin_implicacao");
      expect(result).toContain("spin_necessidade");
      expect(result).toContain("loss_aversion");
    });

    it("hot + price_inquiry → spin_necessidade + price_anchoring + micro_commitment", () => {
      const result = selectStrategiesForLead("hot", "price_inquiry", noTopStrategies);
      expect(result).toContain("spin_necessidade");
      expect(result).toContain("price_anchoring");
      expect(result).toContain("micro_commitment");
    });
  });

  describe("topStrategies influencia seleção", () => {
    it("com 2+ top strategies, usa preferred + fallback por temperatura", () => {
      const topStrategies: StrategyScore[] = [
        { strategy: "storytelling", successRate: 0.9, totalUses: 10 },
        { strategy: "social_proof", successRate: 0.8, totalUses: 8 },
      ];
      const result = selectStrategiesForLead("warm", "other", topStrategies);
      expect(result).toContain("storytelling");
      expect(result).toContain("social_proof");
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("com 1 top strategy (< 2), usa fallback por temperatura", () => {
      const topStrategies: StrategyScore[] = [
        { strategy: "urgency", successRate: 0.7, totalUses: 5 },
      ];
      const result = selectStrategiesForLead("hot", "other", topStrategies);
      expect(result).toContain("spin_necessidade");
    });
  });

  describe("retorna no máximo 3 estratégias", () => {
    it("cold + scheduling retorna 3", () => {
      expect(selectStrategiesForLead("cold", "scheduling", noTopStrategies)).toHaveLength(3);
    });
    it("hot + objection retorna 3", () => {
      expect(selectStrategiesForLead("hot", "objection", noTopStrategies)).toHaveLength(3);
    });
    it("com topStrategies retorna no máximo 3", () => {
      const top: StrategyScore[] = [
        { strategy: "storytelling", successRate: 0.9, totalUses: 10 },
        { strategy: "social_proof", successRate: 0.8, totalUses: 8 },
        { strategy: "urgency", successRate: 0.7, totalUses: 5 },
      ];
      expect(selectStrategiesForLead("warm", "other", top).length).toBeLessThanOrEqual(3);
    });
  });

  describe("todas as estratégias retornadas existem em SALES_STRATEGIES", () => {
    const temps = ["cold", "warm", "hot"];
    const intents = ["scheduling", "rescheduling", "price_inquiry", "question", "objection", "greeting", "cancellation", "other"] as const;

    for (const temp of temps) {
      for (const intent of intents) {
        it(`${temp} + ${intent} — todas válidas`, () => {
          const result = selectStrategiesForLead(temp, intent, noTopStrategies);
          result.forEach((s) => {
            expect(SALES_STRATEGIES).toHaveProperty(s);
          });
        });
      }
    }
  });
});

describe("SALES_STRATEGIES — dicionário de estratégias", () => {
  it("contém pelo menos 15 estratégias", () => {
    expect(Object.keys(SALES_STRATEGIES).length).toBeGreaterThanOrEqual(15);
  });

  it("cada estratégia tem uma descrição não-vazia", () => {
    Object.entries(SALES_STRATEGIES).forEach(([key, desc]) => {
      expect(typeof desc).toBe("string");
      expect(desc.length).toBeGreaterThan(10);
    });
  });

  it("contém todas as estratégias SPIN", () => {
    expect(SALES_STRATEGIES).toHaveProperty("spin_situacao");
    expect(SALES_STRATEGIES).toHaveProperty("spin_problema");
    expect(SALES_STRATEGIES).toHaveProperty("spin_implicacao");
    expect(SALES_STRATEGIES).toHaveProperty("spin_necessidade");
  });
});
