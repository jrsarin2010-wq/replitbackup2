/**
 * DEPRECADO — Task #11 (2026-04-16)
 *
 * Migrações DDL (CREATE TABLE, ALTER TABLE, CREATE INDEX) foram movidas para
 * arquivos SQL versionados em lib/db/drizzle/ e aplicadas via:
 *
 *   pnpm db:migrate        → aplica migrações pendentes (drizzle-kit migrate)
 *   pnpm db:stamp          → marca migrações existentes como aplicadas (1ª vez em prod)
 *   pnpm db:migrate-data   → migra dados (professionals, seeds) — scripts/src/migrate-data.ts
 *
 * Este arquivo existe apenas para evitar erros de import em código legado.
 * Não adicione novas migrações aqui.
 */

export function runAllMigrations(): void {
  // no-op: migrações DDL agora são responsabilidade do Drizzle Kit (pnpm db:migrate)
}
