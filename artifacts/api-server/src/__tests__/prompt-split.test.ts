import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const PROMPT_SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../lib/prompt-builder.ts"),
  "utf-8",
);

const ENGINE_SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../lib/ai-engine.ts"),
  "utf-8",
);

// ── Seções dinâmicas (não devem aparecer na identidade, devem estar no dinâmico) ─
const DYNAMIC_MARKERS = [
  "=== AGENDA DISPONIVEL ===",
  "=== MODO DE ATENDIMENTO ===",
  "=== DATA E HORA ===",
  "=== CLINICA ===",
  "=== PRECOS E PAGAMENTO ===",
  "=== ESTRATEGIA DE ATENDIMENTO ===",
  "=== REGRAS GERAIS ===",
];

// ── Marcadores presentes apenas na seção de identidade ───────────────────────
const IDENTITY_MARKERS = [
  "=== IDENTIDADE E REGRAS ABSOLUTAS ===",
  "MARCADOR DE CONFIRMACAO DE AGENDAMENTO",
  "RESTRICOES ABSOLUTAS",
];

describe("buildSplitPrompt — estrutura do código", () => {
  it("buildSplitPrompt é exportada em prompt-builder.ts", () => {
    expect(PROMPT_SOURCE).toContain("export async function buildSplitPrompt(");
  });

  it("buildSystemPrompt ainda é exportada como wrapper legado", () => {
    expect(PROMPT_SOURCE).toContain("export async function buildSystemPrompt(");
  });

  it("buildSplitPrompt retorna PromptSplit (identityPrompt e dynamicContext)", () => {
    expect(PROMPT_SOURCE).toContain("identityPrompt");
    expect(PROMPT_SOURCE).toContain("dynamicContext");
  });

  it("PromptSplit é exportada como interface", () => {
    expect(PROMPT_SOURCE).toContain("export interface PromptSplit");
  });
});

describe("buildSplitPrompt — separação dos blocos no código", () => {
  it("identitySection NÃO contém marcadores de seções dinâmicas", () => {
    const identityStart = PROMPT_SOURCE.indexOf("const identitySection = `");
    const dynamicStart = PROMPT_SOURCE.indexOf("const dynamicBase = `");
    expect(identityStart).toBeGreaterThan(-1);
    expect(dynamicStart).toBeGreaterThan(identityStart);
    const identityCode = PROMPT_SOURCE.slice(identityStart, dynamicStart);
    for (const marker of DYNAMIC_MARKERS) {
      expect(identityCode).not.toContain(marker);
    }
  });

  it("identitySection contém marcadores de identidade", () => {
    const identityStart = PROMPT_SOURCE.indexOf("const identitySection = `");
    const dynamicStart = PROMPT_SOURCE.indexOf("const dynamicBase = `");
    const identityCode = PROMPT_SOURCE.slice(identityStart, dynamicStart);
    for (const marker of IDENTITY_MARKERS) {
      expect(identityCode).toContain(marker);
    }
  });

  it("dynamicBase contém todas as seções dinâmicas", () => {
    const dynamicStart = PROMPT_SOURCE.indexOf("const dynamicBase = `");
    const dynamicEnd = PROMPT_SOURCE.indexOf("const identityTokens");
    expect(dynamicStart).toBeGreaterThan(-1);
    expect(dynamicEnd).toBeGreaterThan(dynamicStart);
    const dynamicCode = PROMPT_SOURCE.slice(dynamicStart, dynamicEnd);
    for (const marker of DYNAMIC_MARKERS) {
      expect(dynamicCode).toContain(marker);
    }
  });

  it("dynamicBase NÃO contém marcadores exclusivos de identidade (APT_CARD, RESTRICOES ABSOLUTAS)", () => {
    const dynamicStart = PROMPT_SOURCE.indexOf("const dynamicBase = `");
    const dynamicEnd = PROMPT_SOURCE.indexOf("const identityTokens");
    const dynamicCode = PROMPT_SOURCE.slice(dynamicStart, dynamicEnd);
    expect(dynamicCode).not.toContain("=== IDENTIDADE E REGRAS ABSOLUTAS ===");
    expect(dynamicCode).not.toContain("MARCADOR DE CONFIRMACAO DE AGENDAMENTO");
    expect(dynamicCode).not.toContain("RESTRICOES ABSOLUTAS");
  });

  it("topicResumeHint está no bloco dinâmico, não no de identidade", () => {
    const identityStart = PROMPT_SOURCE.indexOf("const identitySection = `");
    const dynamicStart = PROMPT_SOURCE.indexOf("const dynamicBase = `");
    const identityCode = PROMPT_SOURCE.slice(identityStart, dynamicStart);
    expect(identityCode).not.toContain("topicResumeHint");
    const dynamicCode = PROMPT_SOURCE.slice(dynamicStart, PROMPT_SOURCE.indexOf("const identityTokens"));
    expect(dynamicCode).toContain("topicResumeHint");
  });

  it("systemHints estão no bloco dinâmico, não no de identidade", () => {
    const identityStart = PROMPT_SOURCE.indexOf("const identitySection = `");
    const dynamicStart = PROMPT_SOURCE.indexOf("const dynamicBase = `");
    const identityCode = PROMPT_SOURCE.slice(identityStart, dynamicStart);
    expect(identityCode).not.toContain("systemHints");
    const dynamicCode = PROMPT_SOURCE.slice(dynamicStart, PROMPT_SOURCE.indexOf("const identityTokens"));
    expect(dynamicCode).toContain("systemHints");
  });
});

describe("ai-engine.ts — uso do split", () => {
  it("importa buildSplitPrompt de prompt-builder", () => {
    expect(ENGINE_SOURCE).toContain("buildSplitPrompt");
    expect(ENGINE_SOURCE).toContain("from \"./prompt-builder\"");
  });

  it("não importa buildSystemPrompt (removido do hot-path)", () => {
    expect(ENGINE_SOURCE).not.toContain("buildSystemPrompt");
  });

  it("monta messages com identityPrompt como primeiro system", () => {
    expect(ENGINE_SOURCE).toContain("role: \"system\", content: identityPrompt");
  });

  it("monta messages com dynamicContext posicionado antes do user", () => {
    const dynamicIdx = ENGINE_SOURCE.indexOf("content: dynamicContext");
    const userIdx = ENGINE_SOURCE.indexOf("role: \"user\", content: userContent");
    expect(dynamicIdx).toBeGreaterThan(-1);
    expect(userIdx).toBeGreaterThan(dynamicIdx);
  });

  it("userContent NÃO contém append de [SISTEMA:]", () => {
    expect(ENGINE_SOURCE).not.toMatch(/userContent\s*\+=.*SISTEMA/);
  });

  it("systemHints são coletados e passados para buildSplitPrompt", () => {
    expect(ENGINE_SOURCE).toContain("systemHints");
    expect(ENGINE_SOURCE).toContain("systemHints.push(");
  });

  it("alreadyUsedTokens é estimado e passado para buildSplitPrompt", () => {
    expect(ENGINE_SOURCE).toContain("alreadyUsedTokens");
  });
});

describe("trimDynamicContextToTokenBudget — orçamento total", () => {
  it("função existe em prompt-builder.ts", () => {
    expect(PROMPT_SOURCE).toContain("function trimDynamicContextToTokenBudget(");
  });

  it("recebe alreadyUsedTokens como parâmetro", () => {
    expect(PROMPT_SOURCE).toContain("alreadyUsedTokens: number = 0");
  });

  it("usa effectiveBudget = TOKEN_BUDGET - alreadyUsedTokens", () => {
    expect(PROMPT_SOURCE).toContain("TOKEN_BUDGET - alreadyUsedTokens");
  });

  it("identitySection NÃO passa pelo trimmer", () => {
    expect(PROMPT_SOURCE).not.toContain("trimDynamicContextToTokenBudget(tenantId, identitySection");
  });
});
