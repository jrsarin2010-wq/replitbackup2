import { db } from "@workspace/db";
import { platformAlertsTable } from "@workspace/db";
import { logger } from "./logger";
import type { DeepHealthResult, DependencyStatus } from "./health-checker";

type ServiceName = "db" | "redis" | "evolutionApi" | "uazapi" | "openai";

interface ServiceState {
  status: "ok" | "error" | "skipped" | "unknown";
  lastDownAlertAt: number;
  lastRecoveryAlertAt: number;
}

const DEBOUNCE_MS = 10 * 60 * 1000;

const serviceState = new Map<ServiceName, ServiceState>();

function getState(service: ServiceName): ServiceState {
  if (!serviceState.has(service)) {
    serviceState.set(service, { status: "unknown", lastDownAlertAt: 0, lastRecoveryAlertAt: 0 });
  }
  return serviceState.get(service)!;
}

function serviceLabel(service: ServiceName): string {
  const labels: Record<ServiceName, string> = {
    db: "Banco de Dados (PostgreSQL)",
    redis: "Redis",
    evolutionApi: "Evolution API (WhatsApp)",
    uazapi: "uazapi (WhatsApp)",
    openai: "OpenAI (IA)",
  };
  return labels[service];
}

function isCritical(service: ServiceName): boolean {
  if (service === "db") return true;
  const defaultProvider = (process.env.WHATSAPP_PROVIDER || "evolution").toLowerCase();
  if (service === "evolutionApi" && defaultProvider === "evolution") return true;
  if (service === "uazapi" && defaultProvider === "uazapi") return true;
  return false;
}

async function recordAlert(opts: {
  service: ServiceName | "platform";
  kind: "down" | "recovery" | "degraded";
  severity: "critical" | "warning" | "info";
  message: string;
  error?: string | null;
}): Promise<void> {
  try {
    await db.insert(platformAlertsTable).values({
      service: opts.service,
      kind: opts.kind,
      severity: opts.severity,
      message: opts.message,
      error: opts.error ?? null,
    });
  } catch (err) {
    logger.warn({ err, opts }, "Health alerts: failed to record platform alert");
  }
}

export async function processHealthAlerts(result: DeepHealthResult): Promise<void> {
  const checks: Array<[ServiceName, DependencyStatus]> = [
    ["db", result.db],
    ["redis", result.redis],
    ["evolutionApi", result.evolutionApi],
    ["uazapi", result.uazapi],
    ["openai", result.openai],
  ];

  for (const [service, check] of checks) {
    const state = getState(service);
    const now = Date.now();

    if (check.status === "skipped") {
      state.status = "skipped";
      continue;
    }

    const prevStatus = state.status;
    const isNowHealthy = check.status === "ok";

    if (prevStatus === "unknown") {
      state.status = check.status;
      continue;
    }

    const downDebounceElapsed = now - state.lastDownAlertAt > DEBOUNCE_MS;
    const recoveryDebounceElapsed = now - state.lastRecoveryAlertAt > DEBOUNCE_MS;
    const label = serviceLabel(service);
    const severity: "critical" | "warning" = isCritical(service) ? "critical" : "warning";

    if (isNowHealthy && prevStatus === "error") {
      state.status = "ok";
      if (recoveryDebounceElapsed) {
        logger.info({ service, latencyMs: check.latencyMs }, `Health: ${service} recovered`);
        await recordAlert({
          service,
          kind: "recovery",
          severity: "info",
          message: `${label} voltou a operar normalmente (latência ${check.latencyMs}ms).`,
        });
        state.lastRecoveryAlertAt = now;
      } else {
        logger.debug({ service }, `Health: ${service} recovered (recovery alert suppressed by debounce)`);
      }
    } else if (!isNowHealthy && prevStatus === "ok") {
      state.status = "error";
      if (downDebounceElapsed) {
        logger.warn({ service, latencyMs: check.latencyMs, error: check.error }, `Health: ${service} is DOWN`);
        await recordAlert({
          service,
          kind: "down",
          severity,
          message: `${label} está fora do ar.`,
          error: check.error ?? "unknown error",
        });
        state.lastDownAlertAt = now;
      } else {
        logger.debug({ service }, `Health: ${service} went DOWN (down alert suppressed by debounce)`);
      }
    } else if (!isNowHealthy && prevStatus === "error") {
      if (downDebounceElapsed) {
        logger.warn({ service, latencyMs: check.latencyMs, error: check.error }, `Health: ${service} still DOWN (reminder)`);
        await recordAlert({
          service,
          kind: "down",
          severity,
          message: `${label} continua fora do ar (lembrete).`,
          error: check.error ?? "unknown error",
        });
        state.lastDownAlertAt = now;
      }
    }
  }
}

let degradedModeAlertSent = false;

export async function notifyDegradedModeMultiInstance(instanceCount: number, fallbackTtlSeconds: number): Promise<void> {
  if (degradedModeAlertSent) return;
  degradedModeAlertSent = true;

  await recordAlert({
    service: "platform",
    kind: "degraded",
    severity: "warning",
    message: `Modo degradado: ${instanceCount} instâncias rodando sem Redis compartilhado. Caches podem ficar até ${fallbackTtlSeconds}s desatualizados entre instâncias. Configure REDIS_URL para corrigir.`,
  });
}

export function getServiceStates(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of serviceState.entries()) {
    out[k] = v.status;
  }
  return out;
}
