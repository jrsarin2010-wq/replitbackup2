import "./env";
import app from "./app";
import { logger } from "./lib/logger";
import { initRedis, closeRedis } from "./lib/redis";
import { startScheduler } from "./scheduler";
import { syncAllWebhooks } from "./lib/webhook-sync";
import { startMessagePolling } from "./lib/message-polling";
import { getWebhookUrl } from "./lib/whatsapp-provider";
import { drainPendingBatches } from "./lib/conversation-aggregator";
import { pool } from "@workspace/db";
import type { Server } from "http";

initRedis();


const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const webhookBaseSource = process.env["WEBHOOK_BASE_URL"]
  ? "WEBHOOK_BASE_URL"
  : process.env["REPLIT_DEPLOYMENT_URL"]
  ? "REPLIT_DEPLOYMENT_URL"
  : process.env["REPLIT_DOMAINS"]
  ? "REPLIT_DOMAINS"
  : "localhost-fallback";

logger.info(
  { webhookUrl: getWebhookUrl(), source: webhookBaseSource, env: process.env["NODE_ENV"] },
  "Webhook URL resolved"
);

let server: Server;

function gracefulShutdown(signal: string) {
  logger.info({ signal }, "Received shutdown signal, closing gracefully...");
  server?.close(async () => {
    logger.info("HTTP server closed");
    try {
      const drainMaxWaitMs = 5000;
      const drained = await drainPendingBatches(drainMaxWaitMs);
      logger.info({ drained, drainMaxWaitMs }, "Aggregator: drain completed before shutdown");
    } catch (err) {
      logger.warn({ err }, "Aggregator: drain failed during shutdown");
    }
    closeRedis()
      .catch(() => {})
      .finally(() =>
        pool.end().then(() => {
          logger.info("Database pool closed");
          process.exit(0);
        }).catch(() => {
          process.exit(1);
        })
      );
  });
  setTimeout(() => {
    logger.warn("Forced shutdown after timeout");
    process.exit(1);
  }, 15000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception");
  gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
});

server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startScheduler();
  syncAllWebhooks().catch((e) => {
    logger.error({ err: e }, "Failed to sync webhooks on startup");
  });
  startMessagePolling();
  logger.info("Message polling enabled (30s staggered per-tenant) + direct webhooks as dual delivery");
});
