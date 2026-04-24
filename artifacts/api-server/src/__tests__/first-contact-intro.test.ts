import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ENGINE_SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../lib/ai-engine.ts"),
  "utf-8",
);

const PROMPT_SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../lib/prompt-builder.ts"),
  "utf-8",
);

describe("Task #8 — primeiro contato: fonte única de verdade no prompt", () => {
  describe("ai-engine.ts NÃO contém lógica de firstContactIntro", () => {
    it("não declara variável firstContactIntro", () => {
      expect(ENGINE_SOURCE).not.toContain("firstContactIntro");
    });

    it("não faz detecção de alreadyIntroduced via substring", () => {
      expect(ENGINE_SOURCE).not.toContain("alreadyIntroduced");
    });

    it("não faz strip de saudação com regex de oi/olá", () => {
      expect(ENGINE_SOURCE).not.toMatch(
        /cleanReply\s*=\s*reply\.replace\(\s*\/\^\(oi\|ol/,
      );
    });

    it("não concatena intro hardcoded no início da reply", () => {
      expect(ENGINE_SOURCE).not.toContain("Aqui e a ${fcAiName}");
    });

    it("não usa array de saudações hardcoded (Oi/Ola/Oie)", () => {
      expect(ENGINE_SOURCE).not.toMatch(
        /\["Oi",\s*"Ola",\s*"Oie"\]/,
      );
    });
  });

  describe("max_completion_tokens condicional 400/600", () => {
    it("não contém ternário isFirstContact para max_completion_tokens (anti-regressão original)", () => {
      expect(ENGINE_SOURCE).not.toMatch(/isFirstContact\s*\?\s*250/);
    });

    it("define replyMaxTokens condicional baseado em skipAvailability (400 sem agenda, 600 com agenda)", () => {
      expect(ENGINE_SOURCE).toMatch(
        /const\s+replyMaxTokens\s*=\s*skipAvailability\s*\?\s*400\s*:\s*600/,
      );
    });

    it("usa replyMaxTokens na chamada do OpenAI (não literal)", () => {
      expect(ENGINE_SOURCE).toMatch(/max_completion_tokens:\s*replyMaxTokens/);
    });

    it("loga max_tokens_used para observabilidade em produção", () => {
      expect(ENGINE_SOURCE).toMatch(/max_tokens_used:\s*replyMaxTokens/);
    });
  });

  describe("isFirstContact ainda é passado ao buildSplitPrompt", () => {
    it("chama buildSplitPrompt com isFirstContact", () => {
      expect(ENGINE_SOURCE).toMatch(
        /buildSplitPrompt\([^)]*isFirstContact/,
      );
    });
  });

  describe("prompt-builder.ts mantém REGRA ABSOLUTA — PRIMEIRO CONTATO", () => {
    it("contém a seção condicional isFirstContact", () => {
      expect(PROMPT_SOURCE).toContain("isFirstContact");
    });

    it("contém instrução 'REGRA ABSOLUTA — PRIMEIRO CONTATO'", () => {
      expect(PROMPT_SOURCE).toContain(
        "REGRA ABSOLUTA — PRIMEIRO CONTATO",
      );
    });

    it("contém template de apresentação com aiName e clínica", () => {
      expect(PROMPT_SOURCE).toMatch(/Aqui e a \$\{aiName\}/);
    });

    it("proíbe responder sem se identificar", () => {
      expect(PROMPT_SOURCE).toContain(
        "Proibido responder apenas",
      );
    });
  });
});
