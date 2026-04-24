import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Anti-regression: garante que getContactMemories / getRelevantObjections /
// getRelevantKnowledge filtram por status='approved' antes de injetar conteudo
// no prompt. Sem isso, dados pendentes/rejeitados vazariam pra IA.

const SRC = readFileSync(
  join(__dirname, "..", "lib", "ai-learning.ts"),
  "utf-8",
);

function fnBody(name: string): string {
  const start = SRC.indexOf(`export async function ${name}`);
  if (start < 0) throw new Error(`fn nao encontrada: ${name}`);
  // pega ate o proximo "export async function" ou EOF
  const after = SRC.indexOf("\nexport async function ", start + 1);
  return SRC.slice(start, after < 0 ? undefined : after);
}

describe("AI Learning — filtro status='approved' nas leituras (anti-regressao)", () => {
  it("getContactMemories filtra por status='approved'", () => {
    const body = fnBody("getContactMemories");
    expect(body).toMatch(/aiContactMemoryTable\.status[^]*?["']approved["']/);
  });

  it("getRelevantObjections filtra por status='approved'", () => {
    const body = fnBody("getRelevantObjections");
    expect(body).toMatch(/aiObjectionPatternsTable\.status[^]*?["']approved["']/);
  });

  it("getRelevantKnowledge filtra por status='approved'", () => {
    const body = fnBody("getRelevantKnowledge");
    expect(body).toMatch(/aiKnowledgeBaseTable\.status[^]*?["']approved["']/);
  });

  it("getContactMemories prefere editedContent quando presente", () => {
    const body = fnBody("getContactMemories");
    expect(body).toMatch(/editedContent\s*\?\?\s*[a-zA-Z_.]*content/);
  });

  it("getRelevantObjections prefere editedCounterArgument quando presente", () => {
    const body = fnBody("getRelevantObjections");
    expect(body).toMatch(/editedCounterArgument\s*\?\?/);
  });

  it("getRelevantKnowledge prefere editedAnswer quando presente", () => {
    const body = fnBody("getRelevantKnowledge");
    expect(body).toMatch(/editedAnswer\s*\?\?/);
  });
});
