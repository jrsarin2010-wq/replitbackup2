/**
 * db-stamp: Registra migrações baseline no tracking table do Drizzle.
 *
 * Use APENAS UMA VEZ em bancos de dados existentes que já tiveram o schema
 * aplicado pelo antigo runAllMigrations() (boot-time DDL). Isso permite que
 * `pnpm db:migrate` se torne a fonte da verdade sem re-executar DDL já aplicado.
 *
 * Baseline migrations registradas: 0000 e 0001 (DDL já aplicado)
 * Migrations novas (0002+) ficam pendentes para `pnpm db:migrate` aplicar normalmente.
 *
 * Uso em produção existente:
 *   pnpm db:stamp      → registra 0000 e 0001 como aplicadas
 *   pnpm db:migrate    → aplica 0002+ (indexes com IF NOT EXISTS — seguro em DBs existentes)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationsFolder = path.resolve(__dirname, "../../lib/db/drizzle");
const journalPath = path.join(migrationsFolder, "meta", "_journal.json");

const BASELINE_TAGS = ["0000_add_cartesia_voice", "0001_brave_frightful_four"];

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  entries: JournalEntry[];
}

async function main() {
  if (!fs.existsSync(journalPath)) {
    console.error(`db-stamp: _journal.json não encontrado em ${journalPath}`);
    process.exit(1);
  }

  const journal: Journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
  const baselineEntries = journal.entries.filter((e) => BASELINE_TAGS.includes(e.tag));

  if (baselineEntries.length === 0) {
    console.warn("db-stamp: nenhuma migration baseline encontrada no journal.");
    await pool.end();
    return;
  }

  console.log("db-stamp: Criando schema e tabela de tracking do Drizzle...");

  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  let stamped = 0;
  let skipped = 0;

  for (const entry of baselineEntries) {
    const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);

    if (!fs.existsSync(sqlPath)) {
      console.warn(`  AVISO: arquivo não encontrado — ${entry.tag}.sql`);
      continue;
    }

    const content = fs.readFileSync(sqlPath, "utf-8");
    const hash = crypto.createHash("sha256").update(content).digest("hex");

    const existing = await db.execute(
      sql`SELECT id FROM drizzle.__drizzle_migrations WHERE hash = ${hash}`
    );

    if (existing.rows.length > 0) {
      console.log(`  Já registrada (skip): ${entry.tag}`);
      skipped++;
      continue;
    }

    await db.execute(
      sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${hash}, ${entry.when})`
    );
    console.log(`  Registrada como baseline: ${entry.tag}`);
    stamped++;
  }

  await pool.end();
  console.log(
    `db-stamp: Concluído — ${stamped} registradas, ${skipped} já existentes.`,
    `\n         Execute 'pnpm db:migrate' para aplicar migrations pendentes (0002+).`
  );
}

main().catch((err) => {
  console.error("db-stamp falhou:", err);
  process.exit(1);
});
