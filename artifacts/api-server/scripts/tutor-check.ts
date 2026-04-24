import { validateTutorKnowledge } from "../src/lib/tutor-knowledge";

const result = validateTutorKnowledge();
console.log("[tutor:check] Seções carregadas:", result.sectionsCount);
console.log("[tutor:check] Entradas no changelog:", result.changelogEntries);
if (result.ok) {
  console.log("[tutor:check] ✅ OK — base de conhecimento do Tutor IA está saudável");
  process.exit(0);
} else {
  console.error("[tutor:check] ❌ Problemas encontrados:");
  for (const e of result.errors) console.error("  •", e);
  process.exit(1);
}
