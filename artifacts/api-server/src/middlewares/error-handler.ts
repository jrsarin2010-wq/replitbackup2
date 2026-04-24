import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

export function requestTimeout(timeoutMs: number = 30000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        logger.warn({ method: req.method, url: req.originalUrl, timeoutMs }, "Request timeout");
        res.status(504).json({ error: "Request timeout" });
      }
    }, timeoutMs);

    res.on("finish", () => clearTimeout(timer));
    res.on("close", () => clearTimeout(timer));
    next();
  };
}

export function globalErrorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  const status = (err as any).status || (err as any).statusCode || 500;

  if (status >= 500) {
    logger.error({ err, method: req.method, url: req.originalUrl, tenantId: (req as any).tenantId }, "Unhandled server error");
  }

  if (res.headersSent) return;

  if (err.name === "ZodError" || err.name === "ZodValidationError") {
    res.status(400).json({ error: "Validation error", details: (err as any).issues || err.message });
    return;
  }

  if (err.message?.includes("JSON")) {
    res.status(400).json({ error: "Invalid JSON in request body" });
    return;
  }

  res.status(status).json({
    error: status >= 500 ? "Internal server error" : err.message,
  });
}
