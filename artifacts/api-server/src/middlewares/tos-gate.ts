import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { tosVersionsTable, tosAcceptancesTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";

/**
 * Task #15 + #17 — server-side enforcement do aceite dos documentos legais.
 *
 * Bloqueia (HTTP 451) qualquer chamada autenticada de tenant para
 * /api/dental/* enquanto o tenant não tiver aceite TODAS as versões ativas
 * dos documentos legais (kind = "tos" e kind = "subscription").
 *
 * Sem isso, um cliente direto da API conseguiria contornar o modal do
 * frontend.
 *
 * Esta middleware é montada NO TOPO do router /api/dental — antes dos
 * sub-routers que têm seu próprio tenantMiddleware. Por isso a gate faz
 * sua própria verificação inline do JWT (sem hit no DB) para extrair o
 * tenantId.
 *
 * Caminhos isentos (sub-paths relativos ao mount /api/dental):
 *   /tos/*, /auth/*, /tenants/*, /webhook/*, /pixwebhook/*, /support/*, /calls/*
 *
 * Comportamento fail-closed: se a verificação não puder ser feita por erro
 * de DB, responde 503 — preferimos derrubar a request a deixar a
 * proteção legal aberta.
 */

interface ActiveCache { ids: number[]; expires: number; }
let activeCache: ActiveCache | null = null;
const tenantAcceptedCache = new Map<string, number>(); // `${tenantId}:${joinedIds}` -> expires

const EXEMPT_PREFIXES = [
  "/tos",
  "/auth",
  "/tenants",
  "/webhook",
  "/pixwebhook",
  "/support",
  "/calls",
];

const JWT_SECRET = process.env.JWT_SECRET;

async function getActiveVersionIds(): Promise<number[]> {
  const now = Date.now();
  if (activeCache && activeCache.expires > now) return activeCache.ids;
  const versions = await db.query.tosVersionsTable.findMany({
    where: eq(tosVersionsTable.active, true),
    orderBy: [desc(tosVersionsTable.publishedAt)],
    columns: { id: true, kind: true },
  });
  // Uma versão ativa por kind. Se houver duplicidade, pega a mais recente por kind.
  const byKind = new Map<string, number>();
  for (const v of versions) {
    if (!byKind.has(v.kind)) byKind.set(v.kind, v.id);
  }
  const ids = Array.from(byKind.values()).sort((a, b) => a - b);
  activeCache = { ids, expires: now + 60_000 };
  return ids;
}

export async function tosGateMiddleware(req: Request, res: Response, next: NextFunction) {
  const sub = req.path; // path relative to /api/dental mount
  if (EXEMPT_PREFIXES.some((p) => sub === p || sub.startsWith(p + "/"))) {
    return next();
  }

  const auth = (req.headers["authorization"] as string | undefined) ?? "";
  if (!auth.startsWith("Bearer ")) return next(); // tenantMiddleware downstream rejeitará com 401

  let tenantId: number | undefined;
  try {
    if (!JWT_SECRET) return next();
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as { tenantId?: number };
    if (typeof payload.tenantId === "number") tenantId = payload.tenantId;
  } catch {
    return next(); // token inválido — deixa o tenantMiddleware retornar 401
  }
  if (!tenantId) return next();

  let activeIds: number[];
  try {
    activeIds = await getActiveVersionIds();
  } catch {
    res.status(503).json({ error: "tos_check_failed", message: "Não foi possível validar o aceite dos termos." });
    return;
  }
  if (activeIds.length === 0) return next(); // sem documentos ativos seedados, não há o que exigir

  const cacheKey = `${tenantId}:${activeIds.join(",")}`;
  const exp = tenantAcceptedCache.get(cacheKey);
  if (exp && exp > Date.now()) return next();

  try {
    const acceptedRows = await db.query.tosAcceptancesTable.findMany({
      where: and(eq(tosAcceptancesTable.tenantId, tenantId)),
      columns: { tosVersionId: true },
    });
    const acceptedIds = new Set(acceptedRows.map((r) => r.tosVersionId));
    const missing = activeIds.filter((id) => !acceptedIds.has(id));
    if (missing.length === 0) {
      tenantAcceptedCache.set(cacheKey, Date.now() + 5 * 60_000);
      return next();
    }
    res.status(451).json({
      error: "tos_not_accepted",
      message: "Aceite os documentos legais vigentes para usar a plataforma.",
      missingVersionIds: missing,
    });
    return;
  } catch {
    res.status(503).json({ error: "tos_check_failed", message: "Não foi possível validar o aceite dos termos." });
    return;
  }
}

/** Limpa o cache de aceitação de um tenant — chamar após POST /tos/accept. */
export function invalidateTosCacheForTenant(tenantId: number) {
  for (const k of Array.from(tenantAcceptedCache.keys())) {
    if (k.startsWith(`${tenantId}:`)) tenantAcceptedCache.delete(k);
  }
}
