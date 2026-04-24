import { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { dataAuditLogTable } from "@workspace/db";
import { logger } from "../lib/logger";

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.ip || "unknown";
}

function mapMethodToAction(method: string): string {
  switch (method.toUpperCase()) {
    case "GET": return "read";
    case "POST": return "create";
    case "PUT":
    case "PATCH": return "update";
    case "DELETE": return "delete";
    default: return method.toLowerCase();
  }
}

function extractEntityInfo(path: string): { entityType: string; entityId?: number } | null {
  const patterns: Array<{ regex: RegExp; entityType: string }> = [
    { regex: /\/patients\/(\d+)/, entityType: "patient" },
    { regex: /\/patients\/?$/, entityType: "patient" },
    { regex: /\/leads\/(\d+)/, entityType: "lead" },
    { regex: /\/leads\/?$/, entityType: "lead" },
    { regex: /\/conversations\/(\d+)/, entityType: "conversation" },
    { regex: /\/conversations\/?$/, entityType: "conversation" },
    { regex: /\/appointments\/(\d+)/, entityType: "appointment" },
    { regex: /\/appointments\/?$/, entityType: "appointment" },
    { regex: /\/treatments\/(\d+)/, entityType: "treatment" },
    { regex: /\/treatments\/?$/, entityType: "treatment" },
  ];

  for (const { regex, entityType } of patterns) {
    const match = path.match(regex);
    if (match) {
      return {
        entityType,
        entityId: match[1] ? parseInt(match[1], 10) : undefined,
      };
    }
  }
  return null;
}

export function auditMiddleware(req: Request, res: Response, next: NextFunction) {
  const entityInfo = extractEntityInfo(req.path);

  if (!entityInfo) {
    next();
    return;
  }

  res.on("finish", () => {
    const statusCode = res.statusCode;
    if (statusCode >= 200 && statusCode < 400 && req.tenantId) {
      const action = mapMethodToAction(req.method);
      db.insert(dataAuditLogTable)
        .values({
          tenantId: req.tenantId,
          action,
          entityType: entityInfo.entityType,
          entityId: entityInfo.entityId || null,
          ipAddress: getClientIp(req),
          userAgent: req.headers["user-agent"] || null,
          metadata: req.method !== "GET" && req.body ? JSON.stringify({ fields: Object.keys(req.body) }) : null,
        })
        .catch((err) => {
          logger.error({ err }, "Failed to write audit log");
        });
    }
  });

  next();
}
