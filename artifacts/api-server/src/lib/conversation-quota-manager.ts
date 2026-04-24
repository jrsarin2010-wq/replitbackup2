import { db } from "@workspace/db";
import {
  dentalConversationQuotasTable,
  dentalMessagesTable,
  dentalConversationsTable,
  tenantsTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "./logger";
import { getMonthlyConversationsLimit } from "./plan-features";
import { getCachedSettings } from "./cache";
import { sendTelegramMessage } from "./telegram";

const CONVERSATIONS_PER_RECHARGE = 400;
const RECHARGE_PRICE_CENTS = 4700;
const MESSAGES_PER_CONVERSATION = 50;

export const CONVERSATION_RECHARGE_PACKAGE = {
  id: "conversas-400",
  name: "400 Conversas",
  conversations: CONVERSATIONS_PER_RECHARGE,
  priceInCents: RECHARGE_PRICE_CENTS,
  priceLabel: "R$\u00a047,00",
  description: "+400 conversas de IA (saldo não expira)",
};

function isNewMonth(resetDate: Date): boolean {
  const now = new Date();
  return (
    now.getFullYear() > resetDate.getFullYear() ||
    (now.getFullYear() === resetDate.getFullYear() && now.getMonth() > resetDate.getMonth())
  );
}

/**
 * Returns the first day of the next calendar month after lastResetDate,
 * which is the date when the monthly quota will next be reset.
 * Trial tenants have no scheduled reset, so return null.
 */
function computeNextResetDate(lastResetDate: Date): Date {
  const d = new Date(lastResetDate);
  d.setMonth(d.getMonth() + 1);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function getOrCreateAndResetRecord(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  tenantId: number
) {
  const [existing, tenant] = await Promise.all([
    tx.query.dentalConversationQuotasTable.findFirst({
      where: eq(dentalConversationQuotasTable.tenantId, tenantId),
    }),
    tx.query.tenantsTable.findFirst({
      where: eq(tenantsTable.id, tenantId),
      columns: { plan: true },
    }),
  ]);

  const isTrial = tenant?.plan === "trial";

  if (!existing) {
    const [created] = await tx
      .insert(dentalConversationQuotasTable)
      .values({
        tenantId,
        monthlyConversationsUsed: 0,
        rechargeBalance: 0,
        monthlyResetDate: new Date(),
      })
      .returning();
    return created!;
  }

  // Trial tenants have a single fixed pool — never reset their quota between months
  if (!isTrial && isNewMonth(existing.monthlyResetDate)) {
    const [reset] = await tx
      .update(dentalConversationQuotasTable)
      .set({
        monthlyConversationsUsed: 0,
        monthlyResetDate: new Date(),
        alert80SentAt: null,
        alert100SentAt: null,
      })
      .where(eq(dentalConversationQuotasTable.tenantId, tenantId))
      .returning();
    logger.info({ tenantId }, "Monthly conversation quota reset");
    return reset!;
  }

  return existing;
}

// Count inbound messages from this contact stored in dental_messages in the last 24h.
// The current inbound message hasn't been persisted yet at call time, so the count
// reflects prior messages.  0 means a new conversation (first message in 24h window).
async function countInboundMessages24h(tenantId: number, contactPhone: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<string>`COUNT(*)` })
    .from(dentalMessagesTable)
    .innerJoin(dentalConversationsTable, eq(dentalMessagesTable.conversationId, dentalConversationsTable.id))
    .where(and(
      eq(dentalMessagesTable.tenantId, tenantId),
      eq(dentalConversationsTable.contactPhone, contactPhone),
      eq(dentalMessagesTable.direction, "inbound"),
      sql`${dentalMessagesTable.sentAt} > NOW() - INTERVAL '24 hours'`,
    ));
  return Number(row?.n ?? 0);
}

async function sendQuotaAlerts(
  tenantId: number,
  percentUsed: number,
  used: number,
  limit: number,
  record: typeof dentalConversationQuotasTable.$inferSelect,
  totalAvailable: number
) {
  const settings = await getCachedSettings(tenantId).catch(() => null);
  const botToken = settings?.telegramBotToken ?? null;
  const chatId = settings?.telegramChatId ?? null;
  const clinicName = settings?.clinicName ?? `Clínica #${tenantId}`;

  const now = new Date();

  // 100% alert: fire only when TOTAL availability (monthly + recharge) reaches zero.
  // Using monthly percentUsed alone would incorrectly alert when monthly is full
  // but recharge balance remains — the AI is still operational in that case.
  if (totalAvailable <= 0) {
    const alreadySent100 = record.alert100SentAt && isNewMonth(record.alert100SentAt) === false;
    if (!alreadySent100) {
      await db
        .update(dentalConversationQuotasTable)
        .set({ alert100SentAt: now, lastZeroedNotifSentAt: now })
        .where(eq(dentalConversationQuotasTable.tenantId, tenantId));

      if (botToken && chatId) {
        const msg = `🚨 <b>${clinicName}</b>\n\nConversas de IA <b>esgotadas</b>!\n\nUsadas: ${used} / ${limit}\n\nA IA está pausada para novos pacientes. Recarregue para reativar o atendimento automático.\n\n<a href="${process.env.APP_BASE_URL ?? "https://dentalai.app"}/dental-ai/subscription">→ Recarregar agora</a>`;
        await sendTelegramMessage(botToken, chatId, msg, "HTML").catch((err) =>
          logger.warn({ err, tenantId }, "Failed to send quota-100 Telegram alert")
        );
      }
      logger.warn({ tenantId, used, limit }, "Conversation quota exhausted — AI paused, alert sent");
    }
  } else if (percentUsed >= 80) {
    const alreadySent80 = record.alert80SentAt && isNewMonth(record.alert80SentAt) === false;
    if (!alreadySent80) {
      await db
        .update(dentalConversationQuotasTable)
        .set({ alert80SentAt: now })
        .where(eq(dentalConversationQuotasTable.tenantId, tenantId));

      if (botToken && chatId) {
        const remaining = limit - used;
        const msg = `⚠️ <b>${clinicName}</b>\n\n80% das conversas de IA usadas neste mês.\n\nUsadas: ${used} / ${limit} (restam ${remaining})\n\nRecomendamos recarregar agora para não interromper o atendimento.\n\n<a href="${process.env.APP_BASE_URL ?? "https://dentalai.app"}/dental-ai/subscription">→ Comprar recarga</a>`;
        await sendTelegramMessage(botToken, chatId, msg, "HTML").catch((err) =>
          logger.warn({ err, tenantId }, "Failed to send quota-80 Telegram alert")
        );
      }
      logger.info({ tenantId, used, limit }, "Conversation quota at 80% — alert sent");
    }
  }
}

export async function getConversationQuotaStatus(tenantId: number) {
  return db.transaction(async (tx) => {
    const record = await getOrCreateAndResetRecord(tx, tenantId);
    const tenant = await tx.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, tenantId) });
    const isTrial = tenant?.plan === "trial";
    const limit = getMonthlyConversationsLimit(tenant?.plan, tenant?.maxProfessionals ?? 1);
    const used = record.monthlyConversationsUsed;
    const monthlyRemaining = Math.max(0, limit - used);
    const rechargeBalance = record.rechargeBalance;
    const percentUsed = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
    // nextResetDate: the first day of the next calendar month — the future date
    // when the monthly quota will be refilled.  Trial tenants never get an auto-reset.
    const nextResetDate = isTrial ? null : computeNextResetDate(record.monthlyResetDate);

    return {
      tenantId,
      monthlyConversationsUsed: used,
      monthlyLimit: limit,
      monthlyRemaining,
      rechargeBalance,
      totalAvailable: monthlyRemaining + rechargeBalance,
      percentUsed,
      nextResetDate,
      isExhausted: monthlyRemaining <= 0 && rechargeBalance <= 0,
    };
  });
}

export async function checkAndConsumeConversationQuota(
  tenantId: number,
  contactPhone: string,
  options: { forceCharge?: boolean } = {}
): Promise<{
  allowed: boolean;
  isExhausted: boolean;
  percentUsed: number;
  remaining: number;
}> {
  // Count inbound messages from this contact already persisted in dental_messages
  // (last 24h).  The current message is saved BEFORE this function is called, so
  // subtract 1 to get the count of messages *prior* to the one being processed now.
  // priorCount=0 → first message in 24h window → new conversa → charge 1 quota unit.
  // priorCount divisible by MESSAGES_PER_CONVERSATION → anti-abuse cap → charge again.
  //
  // forceCharge: bypass the heuristic and always debit 1 unit. Used by the
  // quota_blocked auto-unblock path, where the original blocked message was
  // already persisted (so priorCount would be ≥1 and shouldCharge=false), but
  // that first attempt was never actually charged — the conversation was blocked.
  const rawCount = await countInboundMessages24h(tenantId, contactPhone);
  const priorCount = Math.max(0, rawCount - 1);
  const shouldCharge = options.forceCharge === true
    || priorCount === 0
    || priorCount % MESSAGES_PER_CONVERSATION === 0;

  if (!shouldCharge) {
    // Mid-conversation message: the contact is within their 24h window and below the
    // next 50-message anti-abuse boundary.  No new quota unit is consumed; ongoing
    // conversations are never blocked even if the global quota is exhausted by other
    // contacts.
    const status = await getConversationQuotaStatus(tenantId);
    return {
      allowed: true,
      isExhausted: status.isExhausted,
      percentUsed: status.percentUsed,
      remaining: status.totalAvailable,
    };
  }

  const phoneLog = contactPhone.slice(-4).padStart(contactPhone.length, "*");

  return db.transaction(async (tx) => {
    // Ensure the row exists first, then acquire an exclusive row lock to serialize
    // concurrent consumption and prevent balance from going negative under load.
    await getOrCreateAndResetRecord(tx, tenantId);
    const result = await tx.execute(
      sql`SELECT
            id,
            tenant_id                 AS "tenantId",
            monthly_conversations_used AS "monthlyConversationsUsed",
            monthly_reset_date         AS "monthlyResetDate",
            recharge_balance           AS "rechargeBalance",
            alert_80_sent_at           AS "alert80SentAt",
            alert_100_sent_at          AS "alert100SentAt",
            last_zeroed_notif_sent_at  AS "lastZeroedNotifSentAt"
          FROM dental_conversation_quotas
          WHERE tenant_id = ${tenantId}
          FOR UPDATE`
    );
    const rowsArray = (result as any).rows ?? (result as any);
    let record = rowsArray[0] as typeof dentalConversationQuotasTable.$inferSelect | undefined;
    if (!record) {
      // Fallback defensivo: se o lock SELECT não retornou nada (ex: race com reset),
      // recria via getOrCreateAndResetRecord para evitar fail-closed que bloqueia a IA.
      record = await getOrCreateAndResetRecord(tx, tenantId);
    }
    const tenant = await tx.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, tenantId) });
    const limit = getMonthlyConversationsLimit(tenant?.plan, tenant?.maxProfessionals ?? 1);
    const used = record.monthlyConversationsUsed;
    const monthlyRemaining = Math.max(0, limit - used);
    const rechargeBalance = record.rechargeBalance;
    const totalAvailable = monthlyRemaining + rechargeBalance;

    if (totalAvailable <= 0) {
      const percentUsed = 100;
      sendQuotaAlerts(tenantId, percentUsed, used, limit, record, 0).catch(() => {});
      logger.warn({ tenantId, contactPhone: phoneLog }, "Conversation quota exhausted");
      return { allowed: false, isExhausted: true, percentUsed, remaining: 0 };
    }

    const fromMonthly = monthlyRemaining > 0 ? 1 : 0;
    const fromRecharge = fromMonthly === 0 ? 1 : 0;
    const newUsed = used + fromMonthly;
    const newRechargeBalance = rechargeBalance - fromRecharge;

    await tx
      .update(dentalConversationQuotasTable)
      .set({
        monthlyConversationsUsed: sql`${dentalConversationQuotasTable.monthlyConversationsUsed} + ${fromMonthly}`,
        rechargeBalance: sql`${dentalConversationQuotasTable.rechargeBalance} - ${fromRecharge}`,
      })
      .where(eq(dentalConversationQuotasTable.tenantId, tenantId));

    const newPercentUsed = limit > 0 ? Math.min(100, Math.round((newUsed / limit) * 100)) : 0;
    const newTotalAvailable = Math.max(0, (limit - newUsed)) + newRechargeBalance;

    sendQuotaAlerts(tenantId, newPercentUsed, newUsed, limit, record, newTotalAvailable).catch(() => {});

    logger.info(
      { tenantId, newUsed, limit, fromMonthly, fromRecharge, priorCount },
      "Conversation quota consumed"
    );

    return {
      allowed: true,
      isExhausted: false,
      percentUsed: newPercentUsed,
      remaining: newTotalAvailable,
    };
  });
}

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Add conversation recharge credits to a tenant's quota balance.
 *
 * Accepts an optional `txOrDb` parameter so callers can pass an existing
 * transaction context, making the credit grant part of the same atomic unit
 * as the status update that triggered it.  When omitted, a new transaction
 * is created automatically (backwards-compatible).
 */
export async function addConversationRechargeCredits(
  tenantId: number,
  conversations: number,
  description: string,
  txOrDb?: DbOrTx
): Promise<{ newBalance: number }> {
  const run = async (tx: DbOrTx) => {
    const existing = await (tx as typeof db).query.dentalConversationQuotasTable.findFirst({
      where: eq(dentalConversationQuotasTable.tenantId, tenantId),
    });

    let newBalance: number;
    if (existing) {
      newBalance = existing.rechargeBalance + conversations;
      await tx
        .update(dentalConversationQuotasTable)
        .set({ rechargeBalance: newBalance })
        .where(eq(dentalConversationQuotasTable.tenantId, tenantId));
    } else {
      newBalance = conversations;
      await tx
        .insert(dentalConversationQuotasTable)
        .values({ tenantId, rechargeBalance: newBalance, monthlyConversationsUsed: 0, monthlyResetDate: new Date() });
    }

    logger.info({ tenantId, conversations, newBalance, description }, "Conversation recharge credits added");
    return { newBalance };
  };

  if (txOrDb) {
    return run(txOrDb);
  }
  return db.transaction(run);
}

export async function resetAllMonthlyConversationQuotas(): Promise<number> {
  const now = new Date();
  const result = await db
    .update(dentalConversationQuotasTable)
    .set({
      monthlyConversationsUsed: 0,
      monthlyResetDate: now,
      alert80SentAt: null,
      alert100SentAt: null,
    })
    .where(
      and(
        sql`(EXTRACT(YEAR FROM ${dentalConversationQuotasTable.monthlyResetDate}) < EXTRACT(YEAR FROM NOW())
          OR (EXTRACT(YEAR FROM ${dentalConversationQuotasTable.monthlyResetDate}) = EXTRACT(YEAR FROM NOW())
              AND EXTRACT(MONTH FROM ${dentalConversationQuotasTable.monthlyResetDate}) < EXTRACT(MONTH FROM NOW())))`,
        sql`${dentalConversationQuotasTable.tenantId} NOT IN (
          SELECT id FROM tenants WHERE plan = 'trial'
        )`
      )
    )
    .returning({ id: dentalConversationQuotasTable.id });

  logger.info({ count: result.length }, "Monthly conversation quotas reset via cron (trial tenants excluded)");
  return result.length;
}

export { CONVERSATIONS_PER_RECHARGE, RECHARGE_PRICE_CENTS };
