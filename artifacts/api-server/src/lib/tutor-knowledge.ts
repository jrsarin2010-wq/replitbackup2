import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CREDIT_PACKAGES } from "./abacatepay";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function resolveKnowledgeDir(): string {
  const candidates = [
    path.resolve(HERE, "../routes/dental/tutor-knowledge"),
    path.resolve(HERE, "./tutor-knowledge"),
    path.resolve(HERE, "../tutor-knowledge"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    `[tutor-knowledge] Diretório de conhecimento não encontrado. Tentei: ${candidates.join(", ")}`,
  );
}

const KNOWLEDGE_DIR = resolveKnowledgeDir();

export interface ChangelogEntry {
  date: string;
  title: string;
  body: string;
}

function renderCreditPackages(): string {
  return CREDIT_PACKAGES.map(
    (p) =>
      `• ${p.name}: ${p.priceLabel.replace(/\u00a0/g, " ")} → ${p.description} (${Math.round(
        p.chars / 1000,
      )} mil caracteres)`,
  ).join("\n");
}

function substitutePlaceholders(content: string): string {
  return content.replace(/\{\{CREDIT_PACKAGES\}\}/g, renderCreditPackages());
}

export function loadKnowledgeSections(): string[] {
  const files = readdirSync(KNOWLEDGE_DIR)
    .filter((f) => f.endsWith(".md") && f !== "tutor-changelog.md")
    .sort();
  if (files.length === 0) {
    throw new Error(`[tutor-knowledge] Nenhum arquivo .md encontrado em ${KNOWLEDGE_DIR}`);
  }
  return files.map((f) =>
    substitutePlaceholders(readFileSync(path.join(KNOWLEDGE_DIR, f), "utf-8")).trimEnd(),
  );
}

const CHANGELOG_ENTRY_RE = /^##\s+(\d{4}-\d{2}-\d{2})\s+—\s+(.+)$/;

export function loadChangelog(): ChangelogEntry[] {
  const filePath = path.join(KNOWLEDGE_DIR, "tutor-changelog.md");
  if (!existsSync(filePath)) {
    throw new Error(`[tutor-knowledge] Changelog não encontrado em ${filePath}`);
  }
  const raw = readFileSync(filePath, "utf-8");
  const lines = raw.split("\n");
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  for (const line of lines) {
    const m = line.match(CHANGELOG_ENTRY_RE);
    if (m) {
      if (current) entries.push(current);
      current = { date: m[1], title: m[2].trim(), body: "" };
    } else if (current) {
      current.body += (current.body ? "\n" : "") + line;
    }
  }
  if (current) entries.push(current);
  return entries.map((e) => ({ ...e, body: e.body.trim() }));
}

export function buildRecentChangelogBlock(maxEntries = 10): string {
  const entries = loadChangelog().slice(0, maxEntries);
  if (entries.length === 0) return "";
  const formatted = entries
    .map((e) => `• ${e.date} — ${e.title}\n  ${e.body.replace(/\n/g, "\n  ")}`)
    .join("\n");
  return `═══════════════════════════════════════════
NOVIDADES RECENTES (changelog do OdontoFlow)
═══════════════════════════════════════════

Use este bloco SEMPRE que o dentista perguntar "o que mudou?", "tem novidade?" ou "o que tem de novo?". Cite as entradas pela data e descreva em linguagem simples.

${formatted}`;
}

let cachedSystemPromptBase: string | null = null;

export function getSystemPromptBase(): string {
  if (cachedSystemPromptBase) return cachedSystemPromptBase;
  const sections = loadKnowledgeSections();
  const changelog = buildRecentChangelogBlock(10);
  // Insert changelog right BEFORE INSTRUÇÕES DE COMPORTAMENTO (last section)
  const lastIdx = sections.length - 1;
  const head = sections.slice(0, lastIdx).join("\n\n");
  const tail = sections[lastIdx];
  cachedSystemPromptBase = `${head}\n\n${changelog}\n\n${tail}`;
  return cachedSystemPromptBase;
}

export function clearTutorKnowledgeCache(): void {
  cachedSystemPromptBase = null;
}

export function validateTutorKnowledge(): {
  ok: boolean;
  sectionsCount: number;
  changelogEntries: number;
  errors: string[];
} {
  const errors: string[] = [];
  let sectionsCount = 0;
  let changelogEntries = 0;
  try {
    const sections = loadKnowledgeSections();
    sectionsCount = sections.length;
    if (sectionsCount < 5) errors.push(`Esperava >=5 seções, encontrei ${sectionsCount}`);
    const last = sections[sections.length - 1];
    if (!/INSTRUÇÕES DE COMPORTAMENTO/.test(last)) {
      errors.push("Última seção precisa ser INSTRUÇÕES DE COMPORTAMENTO");
    }
    const all = sections.join("\n");
    if (!/PRIMEIROS PASSOS/.test(all)) errors.push("Faltando bloco PRIMEIROS PASSOS");
    if (!/PAGAMENTO E ASSINATURA/.test(all)) errors.push("Faltando bloco PAGAMENTO E ASSINATURA");
    if (!/DÚVIDAS TÉCNICAS GERAIS/.test(all)) errors.push("Faltando bloco DÚVIDAS TÉCNICAS GERAIS");
  } catch (e) {
    errors.push(String(e));
  }
  try {
    const entries = loadChangelog();
    changelogEntries = entries.length;
    if (changelogEntries === 0) errors.push("Changelog está vazio");
    for (const e of entries) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) errors.push(`Data inválida: ${e.date}`);
      if (!e.title) errors.push(`Entrada sem título: ${e.date}`);
    }
    for (let i = 1; i < entries.length; i++) {
      if (entries[i - 1].date < entries[i].date) {
        errors.push(
          `Changelog fora de ordem cronológica decrescente: ${entries[i - 1].date} aparece antes de ${entries[i].date}`,
        );
      }
    }
    const filePath = path.join(KNOWLEDGE_DIR, "tutor-changelog.md");
    const raw = readFileSync(filePath, "utf-8");
    let inCodeFence = false;
    for (const line of raw.split("\n")) {
      if (line.startsWith("```")) {
        inCodeFence = !inCodeFence;
        continue;
      }
      if (inCodeFence) continue;
      if (line.startsWith("## ") && !/^##\s+\d{4}-\d{2}-\d{2}\s+—\s+.+$/.test(line)) {
        errors.push(`Cabeçalho de changelog malformado: "${line.slice(0, 80)}"`);
      }
    }
  } catch (e) {
    errors.push(String(e));
  }
  try {
    const prompt = getSystemPromptBase();
    if (prompt.length < 1000) errors.push("Prompt montado parece curto demais");
    if (!/NOVIDADES RECENTES/.test(prompt)) errors.push("Bloco NOVIDADES RECENTES não foi injetado");
  } catch (e) {
    errors.push(String(e));
  }
  return { ok: errors.length === 0, sectionsCount, changelogEntries, errors };
}
