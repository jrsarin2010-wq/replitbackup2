import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import router from "./routes";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { requestTimeout, globalErrorHandler } from "./middlewares/error-handler";
import { settingsCache, proceduresCache, professionalsCache } from "./lib/cache";
import { getGlobalProvider } from "./lib/whatsapp-provider";
import { runDeepHealthCheck } from "./lib/health-checker";

const app: Express = express();

app.set("trust proxy", 1);

app.use(requestTimeout(30000));

app.use(
  pinoHttp({
    logger,
    genReqId: (req) => (req.headers["x-request-id"] as string) || crypto.randomUUID(),
    autoLogging: {
      ignore: (req) => req.url === "/api/health" || req.url === "/api/health/deep",
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

const JWT_SECRET = process.env.JWT_SECRET || "";

function extractTenantId(req: express.Request): string {
  try {
    const authHeader = req.headers["authorization"];
    if (authHeader?.startsWith("Bearer ")) {
      const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET) as { tenantId?: number };
      if (decoded.tenantId) return `tenant:${decoded.tenantId}`;
    }
  } catch {}
  return req.ip || "unknown";
}

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: extractTenantId,
  validate: { ip: false, keyGeneratorIpFallback: false },
  message: { error: "Too many requests, please try again later." },
  skip: (req) => req.originalUrl === "/api/health" || req.originalUrl.startsWith("/api/dental/webhook"),
});
app.use("/api", apiLimiter);

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false, keyGeneratorIpFallback: false },
  keyGenerator: (req) => {
    const token = req.query?.token || req.params?.token || "";
    return token ? `webhook:${token}` : req.ip || "unknown";
  },
});
app.use("/api/dental/webhook", webhookLimiter);

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    const poolStats = { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
    const evolutionProvider = getGlobalProvider();
    res.json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      pool: poolStats,
      cache: { settings: settingsCache.size, procedures: proceduresCache.size, professionals: professionalsCache.size },
      memory: {
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heap: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
      integrations: {
        evolutionApi: evolutionProvider !== null ? "configured" : "not_configured",
        uazapi: process.env.UAZAPI_HOST && process.env.UAZAPI_ADMIN_TOKEN ? "configured" : "not_configured",
        defaultProvider: (process.env.WHATSAPP_PROVIDER || "evolution").toLowerCase(),
      },
    });
  } catch {
    res.status(503).json({ status: "error", message: "Database unreachable" });
  }
});

const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "";

function requireAdminKey(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const header = req.headers["authorization"];
  const provided = header?.startsWith("Bearer ") ? header.slice(7) : (req.headers["x-admin-key"] as string | undefined);
  if (!ADMIN_API_KEY || !provided || provided !== ADMIN_API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

app.get("/api/health/deep", requireAdminKey, async (_req, res) => {
  const result = await runDeepHealthCheck();
  const criticalFailed =
    result.db.status === "error" ||
    result.evolutionApi.status === "error" ||
    result.schema.status === "error";
  const overallStatus = criticalFailed ? "error" : "ok";
  const httpStatus = criticalFailed ? 503 : 200;
  res.status(httpStatus).json({ status: overallStatus, ...result });
});

app.use("/api", router);

app.use(globalErrorHandler);

export default app;
