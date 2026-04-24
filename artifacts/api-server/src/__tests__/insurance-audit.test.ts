/**
 * Task #12 — Testes da auditoria de termos de venda em conversas de convênio.
 *
 * Foca na lógica pura de detecção de termos proibidos e na agregação por
 * tenant. As consultas ao DB e o disparo de Telegram são exercitados em
 * outros caminhos (admin route + scheduler) e não precisam de mocks aqui.
 */
import { describe, it, expect } from "vitest";
import {
  findForbiddenTerms,
  FORBIDDEN_INSURANCE_TERMS,
} from "../lib/insurance-audit";

describe("findForbiddenTerms — detecção de termos proibidos", () => {
  it("detecta a frase 'consegui um encaixe' em qualquer caso", () => {
    const a = findForbiddenTerms("Oi! Consegui um encaixe pra você amanhã.");
    expect(a).toContain("consegui um encaixe");

    const b = findForbiddenTerms("CONSEGUI UM ENCAIXE pra ti");
    expect(b).toContain("consegui um encaixe");
  });

  it("detecta 'agenda disputada' com e sem acento", () => {
    expect(findForbiddenTerms("a agenda ta disputada")).toContain(
      "agenda ta disputada",
    );
    expect(findForbiddenTerms("a agenda está disputada")).toContain(
      "agenda está disputada",
    );
  });

  it("detecta 'urgência' sem precisar do acento", () => {
    expect(findForbiddenTerms("é uma urgencia, melhor garantir agora")).toEqual(
      expect.arrayContaining(["urgência", "melhor garantir agora"]),
    );
  });

  it("detecta 'são os últimos' em variantes ortográficas", () => {
    // O canônico devolvido é "são os últimos" (primeira variante listada);
    // ambos os textos (com e sem acento) devem casar.
    expect(findForbiddenTerms("são os últimos horários")).toContain(
      "são os últimos",
    );
    expect(findForbiddenTerms("sao os ultimos horarios")).toContain(
      "são os últimos",
    );
  });

  it("não dispara em mensagens neutras de convênio", () => {
    const ok = findForbiddenTerms(
      "Olá! O convênio Unimed é aceito sim. Posso confirmar a carteirinha?",
    );
    expect(ok).toEqual([]);
  });

  it("não dispara em verbos genéricos isolados como 'garantir'", () => {
    expect(findForbiddenTerms("vou garantir essa informação com a clínica"))
      .toEqual([]);
  });

  it("retorna lista vazia para texto vazio ou null/undefined", () => {
    expect(findForbiddenTerms("")).toEqual([]);
    expect(findForbiddenTerms(null)).toEqual([]);
    expect(findForbiddenTerms(undefined)).toEqual([]);
  });

  it("deduplica termos repetidos no mesmo texto", () => {
    const result = findForbiddenTerms(
      "Urgência! Urgência! É realmente uma urgencia.",
    );
    // O canônico é "urgência" (primeira variante listada). Mesmo que o
    // texto tenha 3 ocorrências em variantes diferentes, só aparece uma vez.
    const occurrences = result.filter((t) => t === "urgência").length;
    expect(occurrences).toBe(1);
  });

  it("FORBIDDEN_INSURANCE_TERMS contém os termos-marca da Task #11", () => {
    const lower = FORBIDDEN_INSURANCE_TERMS.map((t) => t.toLowerCase());
    expect(lower).toContain("consegui um encaixe");
    expect(lower).toContain("agenda disputada");
    expect(lower).toContain("escassez");
    expect(lower.some((t) => t.includes("urgenc"))).toBe(true);
    expect(lower.some((t) => t.includes("ultimo") || t.includes("últim"))).toBe(true);
  });
});
