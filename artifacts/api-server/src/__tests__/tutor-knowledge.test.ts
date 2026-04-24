import { describe, it, expect, beforeEach } from "vitest";
import {
  loadKnowledgeSections,
  loadChangelog,
  buildRecentChangelogBlock,
  getSystemPromptBase,
  validateTutorKnowledge,
  clearTutorKnowledgeCache,
} from "../lib/tutor-knowledge";
import { CREDIT_PACKAGES } from "../lib/abacatepay";

describe("tutor-knowledge loader", () => {
  beforeEach(() => clearTutorKnowledgeCache());

  it("carrega múltiplas seções .md em ordem alfabética", () => {
    const sections = loadKnowledgeSections();
    expect(sections.length).toBeGreaterThanOrEqual(10);
    const last = sections[sections.length - 1];
    expect(last).toMatch(/INSTRUÇÕES DE COMPORTAMENTO/);
  });

  it("substitui placeholder {{CREDIT_PACKAGES}} pelos pacotes oficiais", () => {
    const sections = loadKnowledgeSections();
    const all = sections.join("\n");
    expect(all).not.toContain("{{CREDIT_PACKAGES}}");
    for (const pkg of CREDIT_PACKAGES) {
      expect(all).toContain(pkg.name);
    }
  });

  it("não contém preços hallucinados antigos (R$ 99,90 / R$ 199,90 nos pacotes)", () => {
    const sections = loadKnowledgeSections();
    const all = sections.join("\n");
    expect(all).not.toMatch(/R\$\s*99,90/);
    expect(all).not.toMatch(/R\$\s*199,90/);
  });

  it("changelog parseia entradas em ordem (mais recente primeiro)", () => {
    const entries = loadChangelog();
    expect(entries.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i - 1].date >= entries[i].date).toBe(true);
    }
  });

  it("buildRecentChangelogBlock injeta as N entradas mais recentes", () => {
    const block = buildRecentChangelogBlock(3);
    expect(block).toMatch(/NOVIDADES RECENTES/);
    const dates = block.match(/\d{4}-\d{2}-\d{2}/g) || [];
    expect(dates.length).toBe(3);
  });

  it("getSystemPromptBase combina seções + changelog", () => {
    const prompt = getSystemPromptBase();
    expect(prompt).toMatch(/PRIMEIROS PASSOS/);
    expect(prompt).toMatch(/PAGAMENTO E ASSINATURA/);
    expect(prompt).toMatch(/DÚVIDAS TÉCNICAS GERAIS/);
    expect(prompt).toMatch(/NOVIDADES RECENTES/);
    expect(prompt).toMatch(/INSTRUÇÕES DE COMPORTAMENTO/);
    const novidadesIdx = prompt.indexOf("NOVIDADES RECENTES");
    const instrucoesIdx = prompt.indexOf("INSTRUÇÕES DE COMPORTAMENTO");
    expect(novidadesIdx).toBeLessThan(instrucoesIdx);
  });

  it("getSystemPromptBase é cacheado entre chamadas", () => {
    const a = getSystemPromptBase();
    const b = getSystemPromptBase();
    expect(a).toBe(b);
  });

  it("validateTutorKnowledge retorna ok=true sem erros", () => {
    const result = validateTutorKnowledge();
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.sectionsCount).toBeGreaterThanOrEqual(10);
    expect(result.changelogEntries).toBeGreaterThanOrEqual(5);
  });
});
