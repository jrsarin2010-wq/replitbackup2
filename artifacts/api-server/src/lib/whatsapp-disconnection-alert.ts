import { db, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { getCachedSettings } from "./cache";
import { getRedis } from "./redis";

const ALERT_TTL_SEC = 60 * 60;
const _localLastAlertSent = new Map<string, number>();

const _instanceToTenantCache = new Map<string, { tenantId: number; clinicName: string | null; expiresAt: number }>();
const TENANT_CACHE_TTL_MS = 5 * 60 * 1000;

const DISCONNECTION_PATTERNS = [
  "connection closed",
  "connection lost",
  "connection terminated",
  "not connected",
  "instance not connected",
];

export function isWhatsappDisconnectionError(responseBody: unknown): boolean {
  if (!responseBody) return false;
  const text = typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody);
  const lower = text.toLowerCase();
  return DISCONNECTION_PATTERNS.some((p) => lower.includes(p));
}

async function wasAlertRecentlySent(instanceName: string): Promise<boolean> {
  const key = `alert:wpp_disconnect:${instanceName}`;
  const redis = getRedis();
  if (redis) {
    try {
      const exists = await redis.exists(key);
      return exists === 1;
    } catch {
    }
  }
  const lastSent = _localLastAlertSent.get(instanceName);
  const oneHourAgo = Date.now() - ALERT_TTL_SEC * 1000;
  return !!(lastSent && lastSent > oneHourAgo);
}

async function recordAlertSent(instanceName: string): Promise<void> {
  const key = `alert:wpp_disconnect:${instanceName}`;
  const redis = getRedis();
  if (redis) {
    try {
      await redis.setex(key, ALERT_TTL_SEC, "1");
      return;
    } catch {
    }
  }
  _localLastAlertSent.set(instanceName, Date.now());
}

async function resolveTenantByInstance(instanceName: string): Promise<{ tenantId: number; clinicName: string | null } | null> {
  const cached = _instanceToTenantCache.get(instanceName);
  if (cached && cached.expiresAt > Date.now()) {
    return { tenantId: cached.tenantId, clinicName: cached.clinicName };
  }
  const tenant = await db.query.tenantsTable.findFirst({
    where: eq(tenantsTable.evolutionInstanceName, instanceName),
  });
  if (!tenant) return null;
  const clinicName = (tenant as { clinicName?: string | null; name?: string | null }).clinicName
    ?? (tenant as { name?: string | null }).name
    ?? null;
  _instanceToTenantCache.set(instanceName, {
    tenantId: tenant.id,
    clinicName,
    expiresAt: Date.now() + TENANT_CACHE_TTL_MS,
  });
  return { tenantId: tenant.id, clinicName };
}

export async function notifyWhatsappDisconnected(
  instanceName: string,
  errorDetail?: string,
): Promise<void> {
  try {
    if (await wasAlertRecentlySent(instanceName)) return;

    const tenant = await resolveTenantByInstance(instanceName);
    if (!tenant) {
      logger.warn({ instanceName }, "WhatsApp disconnection detected but no tenant found for instance");
      await recordAlertSent(instanceName);
      return;
    }

    await recordAlertSent(instanceName);

    const settings = await getCachedSettings(tenant.tenantId);
    if (!settings?.telegramEscalationEnabled || !settings?.telegramBotToken || !settings?.telegramChatId) {
      logger.warn({ tenantId: tenant.tenantId, instanceName }, "WhatsApp disconnected; Telegram alerts not configured");
      return;
    }

    const { sendTelegramMessage } = await import("./telegram");
    const clinicLine = tenant.clinicName ? `🏥 <b>${tenant.clinicName}</b>\n` : "";
    const detailLine = errorDetail ? `\n<i>Detalhe: ${errorDetail.slice(0, 200)}</i>` : "";
    const message =
      `🔴 <b>WhatsApp DESCONECTADO!</b>\n\n` +
      clinicLine +
      `Instância: <code>${instanceName}</code>\n\n` +
      `As mensagens dos pacientes não estão sendo entregues. ` +
      `A IA está respondendo, mas o WhatsApp não consegue enviar.\n\n` +
      `<b>Ação necessária:</b>\n` +
      `1. Acesse o painel da OdontoFlow\n` +
      `2. Vá em WhatsApp\n` +
      `3. Desconecte e escaneie o QR Code novamente` +
      detailLine;

    const result = await sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, message);
    if (!result.ok) {
      logger.warn({ tenantId: tenant.tenantId, instanceName, error: result.error }, "Failed to send WhatsApp disconnection Telegram alert");
    } else {
      logger.info({ tenantId: tenant.tenantId, instanceName }, "WhatsApp disconnection Telegram alert sent");
    }
  } catch (err) {
    logger.error({ err, instanceName }, "Error processing WhatsApp disconnection alert");
  }
}
