import { describe, it, expect } from "vitest";
import { getRemarketingIntervalDays, isLeadEligibleForRemarketing } from "../scheduler.js";
import type { RemarketingSettings } from "../scheduler.js";

const defaultSettings: Pick<RemarketingSettings, "remarketingIntervalHot" | "remarketingIntervalWarm" | "remarketingIntervalCold"> = {
  remarketingIntervalHot: 2,
  remarketingIntervalWarm: 5,
  remarketingIntervalCold: 10,
};

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

describe("getRemarketingIntervalDays — intervalo por temperatura", () => {
  it("hot → remarketingIntervalHot (2 dias)", () => {
    expect(getRemarketingIntervalDays("hot", defaultSettings)).toBe(2);
  });

  it("warm → remarketingIntervalWarm (5 dias)", () => {
    expect(getRemarketingIntervalDays("warm", defaultSettings)).toBe(5);
  });

  it("cold → remarketingIntervalCold (10 dias)", () => {
    expect(getRemarketingIntervalDays("cold", defaultSettings)).toBe(10);
  });

  it("temperatura desconhecida → fallback para cold", () => {
    expect(getRemarketingIntervalDays("unknown", defaultSettings)).toBe(10);
  });

  it("string vazia → fallback para cold", () => {
    expect(getRemarketingIntervalDays("", defaultSettings)).toBe(10);
  });
});

describe("isLeadEligibleForRemarketing — elegibilidade para remarketing", () => {
  const now = new Date();

  describe("status do lead", () => {
    it("lead ativo → elegível (quando intervalo cumprido)", () => {
      expect(isLeadEligibleForRemarketing("active", daysAgo(15), "cold", null, now, defaultSettings)).toBe(true);
    });

    it("lead inativo → NÃO elegível", () => {
      expect(isLeadEligibleForRemarketing("inactive", daysAgo(15), "cold", null, now, defaultSettings)).toBe(false);
    });

    it("lead convertido → NÃO elegível", () => {
      expect(isLeadEligibleForRemarketing("converted", daysAgo(15), "cold", null, now, defaultSettings)).toBe(false);
    });

    it("lead perdido → NÃO elegível", () => {
      expect(isLeadEligibleForRemarketing("lost", daysAgo(15), "cold", null, now, defaultSettings)).toBe(false);
    });
  });

  describe("lastContactAt — tempo desde último contato", () => {
    it("sem lastContactAt → elegível (lead novo sem interação)", () => {
      expect(isLeadEligibleForRemarketing("active", null, "cold", null, now, defaultSettings)).toBe(true);
    });

    it("hot + contato há 3 dias (> 2 dias) → elegível", () => {
      expect(isLeadEligibleForRemarketing("active", daysAgo(3), "hot", null, now, defaultSettings)).toBe(true);
    });

    it("hot + contato há 1 dia (< 2 dias) → NÃO elegível", () => {
      expect(isLeadEligibleForRemarketing("active", daysAgo(1), "hot", null, now, defaultSettings)).toBe(false);
    });

    it("warm + contato há 6 dias (> 5 dias) → elegível", () => {
      expect(isLeadEligibleForRemarketing("active", daysAgo(6), "warm", null, now, defaultSettings)).toBe(true);
    });

    it("warm + contato há 3 dias (< 5 dias) → NÃO elegível", () => {
      expect(isLeadEligibleForRemarketing("active", daysAgo(3), "warm", null, now, defaultSettings)).toBe(false);
    });

    it("cold + contato há 11 dias (> 10 dias) → elegível", () => {
      expect(isLeadEligibleForRemarketing("active", daysAgo(11), "cold", null, now, defaultSettings)).toBe(true);
    });

    it("cold + contato há 7 dias (< 10 dias) → NÃO elegível", () => {
      expect(isLeadEligibleForRemarketing("active", daysAgo(7), "cold", null, now, defaultSettings)).toBe(false);
    });
  });

  describe("lastRemarketingAt — evita remarketing repetido", () => {
    it("remarketing recente (< intervalo) → NÃO elegível", () => {
      expect(isLeadEligibleForRemarketing("active", daysAgo(15), "cold", daysAgo(5), now, defaultSettings)).toBe(false);
    });

    it("remarketing antigo (> intervalo) → elegível", () => {
      expect(isLeadEligibleForRemarketing("active", daysAgo(15), "cold", daysAgo(12), now, defaultSettings)).toBe(true);
    });

    it("sem remarketing anterior → elegível", () => {
      expect(isLeadEligibleForRemarketing("active", daysAgo(15), "cold", null, now, defaultSettings)).toBe(true);
    });

    it("hot + remarketing há 1 dia (< 2) → NÃO elegível", () => {
      expect(isLeadEligibleForRemarketing("active", daysAgo(5), "hot", daysAgo(1), now, defaultSettings)).toBe(false);
    });

    it("hot + remarketing há 3 dias (> 2) → elegível", () => {
      expect(isLeadEligibleForRemarketing("active", daysAgo(5), "hot", daysAgo(3), now, defaultSettings)).toBe(true);
    });
  });

  describe("cenários combinados de regressão", () => {
    it("lead ativo + cold + contato há 15 dias + sem remarketing → elegível", () => {
      expect(isLeadEligibleForRemarketing("active", daysAgo(15), "cold", null, now, defaultSettings)).toBe(true);
    });

    it("lead ativo + hot + contato há 3 dias + remarketing ontem → NÃO elegível (intervalo remarketing)", () => {
      expect(isLeadEligibleForRemarketing("active", daysAgo(3), "hot", daysAgo(1), now, defaultSettings)).toBe(false);
    });

    it("lead inativo + cold + contato há 30 dias + sem remarketing → NÃO elegível (status)", () => {
      expect(isLeadEligibleForRemarketing("inactive", daysAgo(30), "cold", null, now, defaultSettings)).toBe(false);
    });

    it("lead ativo + warm + contato hoje → NÃO elegível (muito recente)", () => {
      expect(isLeadEligibleForRemarketing("active", now, "warm", null, now, defaultSettings)).toBe(false);
    });
  });
});
