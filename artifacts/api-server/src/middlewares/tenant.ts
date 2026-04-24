import { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { tenantExistsCache } from "../lib/cache";

declare global {
  namespace Express {
    interface Request {
      tenantId: number;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is not set");
}

export async function tenantMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.slice(7);

  let payload: { tenantId: number };
  try {
    payload = jwt.verify(token, JWT_SECRET!) as { tenantId: number };
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const tenantId = payload.tenantId;
  if (!tenantId || typeof tenantId !== "number") {
    res.status(401).json({ error: "Invalid token payload" });
    return;
  }

  const cached = await tenantExistsCache.get(tenantId);
  if (cached !== true) {
    const tenant = await db.query.tenantsTable.findFirst({
      where: eq(tenantsTable.id, tenantId),
      columns: { id: true },
    });
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    await tenantExistsCache.set(tenantId, true);
  }

  req.tenantId = tenantId;
  next();
}
