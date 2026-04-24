import { db } from "@workspace/db";
import { dentalSettingsTable, dentalActivityTable } from "@workspace/db";
import { eq, and, gte } from "drizzle-orm";
import { sendTelegramMessage } from "./telegram";
import { logger } from "./logger";
import { getCachedSettings } from "./cache";
import { getRedis } from "./redis";

const LOW_CREDIT_THRESHOLD = 2_000;
const CREDIT_ALERT_TTL_SEC = 24 * 3600;

const _localLastAlertSent = new Map<number, number>();

async function wasAlertRecentlySent(tenantId: number): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    try {
      const exists = await redis.exists(`alert:credits:${tenantId}`);
      return exists === 1;
    } catch {
    }
  }
  const lastSent = _localLastAlertSent.get(tenantId);
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  return !!(lastSent && lastSent > oneDayAgo);
}

async function recordAlertSent(tenantId: number): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.setex(`alert:credits:${tenantId}`, CREDIT_ALERT_TTL_SEC, "1");
      return;
    } catch {
    }
  }
  _localLastAlertSent.set(tenantId, Date.now());
}

export async function checkLowCreditsAlert(
  tenantId: number,
  currentBalance: number
): Promise<void> {
  if (currentBalance > LOW_CREDIT_THRESHOLD) return;

  if (await wasAlertRecentlySent(tenantId)) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const recentAlert = await db.query.dentalActivityTable.findFirst({
    where: and(
      eq(dentalActivityTable.tenantId, tenantId),
      eq(dentalActivityTable.type, "low_credits_alert"),
      gte(dentalActivityTable.createdAt, today),
    ),
  });
  if (recentAlert) {
    await recordAlertSent(tenantId);
    return;
  }

  await recordAlertSent(tenantId);

  const settings = await getCachedSettings(tenantId);

  let telegramSent = false;
  if (settings?.telegramEscalationEnabled && settings?.telegramBotToken && settings?.telegramChatId) {
    const message = currentBalance <= 0
      ? `🔴 <b>Créditos de áudio ESGOTADOS!</b>\n\n` +
        `${settings.clinicName ? `🏥 ${settings.clinicName}\n` : ""}` +
        `Saldo atual: <b>0 créditos</b>\n\n` +
        `As respostas por áudio foram desativadas automaticamente.\n` +
        `Recarregue seus créditos em Configurações > Áudio IA.`
      : `⚠️ <b>Créditos de áudio baixos!</b>\n\n` +
        `${settings.clinicName ? `🏥 ${settings.clinicName}\n` : ""}` +
        `Saldo atual: <b>${currentBalance.toLocaleString("pt-BR")} créditos</b>\n\n` +
        `Seus créditos estão acabando. Recarregue em Configurações > Áudio IA para não interromper as respostas por áudio.`;

    const result = await sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, message);
    telegramSent = result.ok;
    if (!result.ok) {
      logger.warn({ tenantId, error: result.error }, "Failed to send low credits Telegram alert");
    }
  }

  await db.insert(dentalActivityTable).values({
    tenantId,
    type: "low_credits_alert",
    description: `Alerta de créditos baixos: saldo ${currentBalance}`,
    entityType: "system",
    metadata: JSON.stringify({ balance: currentBalance, telegramSent }),
  });

  logger.info({ tenantId, balance: currentBalance, telegramSent }, "Low credits alert processed");
}
