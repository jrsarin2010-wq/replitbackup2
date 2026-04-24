import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

declare global {
  namespace Express {
    interface Request {
      isAdmin?: boolean;
    }
  }
}

/**
 * Task #15 — admin-only gate for /api/admin/* (auditoria, ops, painel SaaS).
 * Requer header `X-Admin-API-Key` (ou `Authorization: Bearer <key>`) batendo
 * exatamente com `process.env.ADMIN_API_KEY`. Comparação em tempo constante.
 *
 * Sem ADMIN_API_KEY no ambiente, o gate REJEITA TUDO — fail-closed por
 * razões de segurança (o anterior era um no-op que liberava qualquer chamador).
 */
export async function adminMiddleware(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) {
    res.status(503).json({ error: "Admin API not configured (ADMIN_API_KEY missing)" });
    return;
  }

  // Aceita `x-admin-api-key` (canônico) e `x-admin-key` (alias usado pelo
  // painel admin do dental-ai) por compatibilidade.
  const headerKey = (
    (req.headers["x-admin-api-key"] as string | undefined) ??
    (req.headers["x-admin-key"] as string | undefined) ??
    ""
  ).trim();
  const authHeader = ((req.headers["authorization"] as string | undefined) ?? "").trim();
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const provided = headerKey || bearer;
  const expectedTrim = expected.trim();

  if (!provided) {
    res.status(401).json({ error: "Missing admin credentials" });
    return;
  }

  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expectedTrim, "utf8");
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  req.isAdmin = true;
  next();
}
