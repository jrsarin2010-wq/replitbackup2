import { db } from "@workspace/db";
import { dentalAudioCreditsTable, dentalCreditTransactionsTable, tenantsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";

export const MONTHLY_QUOTA_CHARS = 27_000;

/** Per-plan monthly audio quota in chars (1 min ≈ 1 350 chars at normal speech rate). */
export const PLAN_MONTHLY_AUDIO_CHARS: Record<string, number> = {
  basic:      0,       // no audio credits on Básico
  trial:      0,
  essencial:  40_500,  // 30 min
  pro:        81_000,  // 60 min
  premium:    81_000,
  enterprise: 81_000,
};

function getPlanAudioQuota(plan: string | null | undefined): number {
  if (!plan) return MONTHLY_QUOTA_CHARS;
  return PLAN_MONTHLY_AUDIO_CHARS[plan] ?? MONTHLY_QUOTA_CHARS;
}

function isNewMonth(resetDate: Date): boolean {
  const now = new Date();
  return (
    now.getFullYear() > resetDate.getFullYear() ||
    (now.getFullYear() === resetDate.getFullYear() && now.getMonth() > resetDate.getMonth())
  );
}

async function getOrCreateAndResetRecord(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  tenantId: number
) {
  const existing = await tx.query.dentalAudioCreditsTable.findFirst({
    where: eq(dentalAudioCreditsTable.tenantId, tenantId),
  });

  if (!existing) {
    const [created] = await tx
      .insert(dentalAudioCreditsTable)
      .values({
        tenantId,
        balance: 0,
        monthlyCharsUsed: 0,
        monthlyResetDate: new Date(),
      })
      .returning();
    if (!created) throw new Error(`Failed to create audio credits record for tenant ${tenantId}`);
    return created;
  }

  if (isNewMonth(existing.monthlyResetDate)) {
    const [reset] = await tx
      .update(dentalAudioCreditsTable)
      .set({ monthlyCharsUsed: 0, monthlyResetDate: new Date() })
      .where(eq(dentalAudioCreditsTable.tenantId, tenantId))
      .returning();
    if (!reset) throw new Error(`Failed to reset audio credits for tenant ${tenantId}`);
    logger.info({ tenantId }, "Monthly audio quota reset");
    return reset;
  }

  return existing;
}

export async function getAudioCreditStatus(tenantId: number) {
  const tenant = await db.query.tenantsTable.findFirst({
    where: eq(tenantsTable.id, tenantId),
    columns: { plan: true },
  });
  const planQuota = getPlanAudioQuota(tenant?.plan);

  return db.transaction(async (tx) => {
    const record = await getOrCreateAndResetRecord(tx, tenantId);
    const monthlyCharsUsed = record.monthlyCharsUsed ?? 0;
    const monthlyCharsRemaining = Math.max(0, planQuota - monthlyCharsUsed);
    const rechargeBalance = record.balance ?? 0;

    return {
      tenantId,
      rechargeBalance,
      monthlyCharsUsed,
      monthlyQuota: planQuota,
      monthlyCharsRemaining,
      totalAvailable: monthlyCharsRemaining + rechargeBalance,
    };
  });
}

export async function getBalance(tenantId: number): Promise<number> {
  const record = await db.query.dentalAudioCreditsTable.findFirst({
    where: eq(dentalAudioCreditsTable.tenantId, tenantId),
  });
  return record?.balance ?? 0;
}

export async function hasEnoughCredits(tenantId: number, requiredChars: number): Promise<boolean> {
  const status = await getAudioCreditStatus(tenantId);
  return status.totalAvailable >= requiredChars;
}

export async function deductCredits(
  tenantId: number,
  chars: number,
  description: string
): Promise<{ success: boolean; newBalance: number; fromMonthly: number; fromRecharge: number }> {
  const tenant = await db.query.tenantsTable.findFirst({
    where: eq(tenantsTable.id, tenantId),
    columns: { plan: true },
  });
  const planQuota = getPlanAudioQuota(tenant?.plan);

  return db.transaction(async (tx) => {
    const record = await getOrCreateAndResetRecord(tx, tenantId);

    const monthlyCharsUsed = record.monthlyCharsUsed ?? 0;

    const monthlyCharsRemaining = Math.max(0, planQuota - monthlyCharsUsed);
    const rechargeBalance = record.balance ?? 0;
    const totalAvailable = monthlyCharsRemaining + rechargeBalance;

    if (totalAvailable < chars) {
      logger.warn({ tenantId, chars, totalAvailable }, "Credit deduction failed: insufficient balance");
      return { success: false, newBalance: rechargeBalance, fromMonthly: 0, fromRecharge: 0 };
    }

    const fromMonthly = Math.min(chars, monthlyCharsRemaining);
    const fromRecharge = chars - fromMonthly;

    const newMonthlyUsed = monthlyCharsUsed + fromMonthly;
    const newRechargeBalance = rechargeBalance - fromRecharge;

    const [updated] = await tx
      .update(dentalAudioCreditsTable)
      .set({
        monthlyCharsUsed: newMonthlyUsed,
        balance: newRechargeBalance,
      })
      .where(
        sql`${dentalAudioCreditsTable.tenantId} = ${tenantId}
            AND ${dentalAudioCreditsTable.balance} = ${record.balance}
            AND ${dentalAudioCreditsTable.monthlyCharsUsed} = ${record.monthlyCharsUsed}`
      )
      .returning();

    if (!updated) {
      logger.warn({ tenantId, chars }, "Credit deduction lost race condition — retrying not implemented, will refund if audio fails");
      return { success: false, newBalance: record.balance, fromMonthly: 0, fromRecharge: 0 };
    }

    const sourceDesc = fromMonthly > 0 && fromRecharge > 0
      ? `${fromMonthly} da cota mensal + ${fromRecharge} de recarga`
      : fromMonthly > 0
        ? `${fromMonthly} da cota mensal`
        : `${fromRecharge} de recarga`;

    await tx.insert(dentalCreditTransactionsTable).values({
      tenantId,
      amount: -chars,
      type: "deduct",
      description: `${description} [${sourceDesc}]`,
    });

    logger.info(
      { tenantId, chars, fromMonthly, fromRecharge, newMonthlyUsed, newRechargeBalance },
      "Credits deducted (monthly-first, atomic)"
    );

    return { success: true, newBalance: newRechargeBalance, fromMonthly, fromRecharge };
  });
}

export async function checkAndDeductCredits(
  tenantId: number,
  chars: number,
  description: string
): Promise<{ success: boolean; newBalance: number }> {
  const result = await deductCredits(tenantId, chars, description);
  return { success: result.success, newBalance: result.newBalance };
}

export async function refundCredits(
  tenantId: number,
  chars: number,
  description: string
): Promise<{ newBalance: number }> {
  return db.transaction(async (tx) => {
    const existing = await tx.query.dentalAudioCreditsTable.findFirst({
      where: eq(dentalAudioCreditsTable.tenantId, tenantId),
    });

    let newBalance: number;
    if (existing) {
      newBalance = existing.balance + chars;
      await tx
        .update(dentalAudioCreditsTable)
        .set({ balance: newBalance })
        .where(eq(dentalAudioCreditsTable.tenantId, tenantId));
    } else {
      newBalance = chars;
      await tx
        .insert(dentalAudioCreditsTable)
        .values({ tenantId, balance: newBalance, monthlyCharsUsed: 0, monthlyResetDate: new Date() });
    }

    await tx.insert(dentalCreditTransactionsTable).values({
      tenantId,
      amount: chars,
      type: "add",
      description,
    });

    logger.info({ tenantId, chars, newBalance }, "Credits refunded");
    return { newBalance };
  });
}

export async function addCredits(
  tenantId: number,
  chars: number,
  description: string
): Promise<{ newBalance: number }> {
  return db.transaction(async (tx) => {
    const existing = await tx.query.dentalAudioCreditsTable.findFirst({
      where: eq(dentalAudioCreditsTable.tenantId, tenantId),
    });

    let newBalance: number;
    if (existing) {
      newBalance = existing.balance + chars;
      await tx
        .update(dentalAudioCreditsTable)
        .set({ balance: newBalance })
        .where(eq(dentalAudioCreditsTable.tenantId, tenantId));
    } else {
      newBalance = chars;
      await tx
        .insert(dentalAudioCreditsTable)
        .values({ tenantId, balance: newBalance, monthlyCharsUsed: 0, monthlyResetDate: new Date() });
    }

    await tx.insert(dentalCreditTransactionsTable).values({
      tenantId,
      amount: chars,
      type: "add",
      description,
    });

    logger.info({ tenantId, chars, newBalance }, "Credits added");
    return { newBalance };
  });
}

/** Chars por minuto de áudio (taxa de fala normal). */
const CHARS_PER_MINUTE = 1_350;

/**
 * Credita minutos de áudio ao tenant após pagamento de recarga confirmado.
 * Converte minutos → chars e usa addCredits para manter trilha de transação.
 */
export async function addAudioMinutes(
  tenantId: number,
  minutes: number,
  billingId: string,
): Promise<{ newBalance: number }> {
  const chars = minutes * CHARS_PER_MINUTE;
  return addCredits(tenantId, chars, `Recarga de áudio +${minutes}min [billing:${billingId}]`);
}

export async function resetAllMonthlyQuotas(): Promise<number> {
  const now = new Date();
  const result = await db
    .update(dentalAudioCreditsTable)
    .set({ monthlyCharsUsed: 0, monthlyResetDate: now })
    .where(
      sql`EXTRACT(YEAR FROM ${dentalAudioCreditsTable.monthlyResetDate}) < EXTRACT(YEAR FROM NOW())
        OR (EXTRACT(YEAR FROM ${dentalAudioCreditsTable.monthlyResetDate}) = EXTRACT(YEAR FROM NOW())
            AND EXTRACT(MONTH FROM ${dentalAudioCreditsTable.monthlyResetDate}) < EXTRACT(MONTH FROM NOW()))`
    )
    .returning({ id: dentalAudioCreditsTable.id });

  logger.info({ count: result.length }, "Monthly audio quotas reset via cron");
  return result.length;
}

export async function getTransactions(tenantId: number, limit = 50) {
  const transactions = await db.query.dentalCreditTransactionsTable.findMany({
    where: eq(dentalCreditTransactionsTable.tenantId, tenantId),
    orderBy: (t, { desc: d }) => [d(t.createdAt)],
    limit,
  });
  return transactions;
}

export async function getAllTransactions(limit = 100) {
  const transactions = await db.query.dentalCreditTransactionsTable.findMany({
    orderBy: (t, { desc: d }) => [d(t.createdAt)],
    limit,
  });
  return transactions;
}
