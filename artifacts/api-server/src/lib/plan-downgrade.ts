import { db } from "@workspace/db";
import { tenantsTable, dentalAudioCreditsTable, dentalConversationQuotasTable } from "@workspace/db";
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { logger } from "./logger";
import { PLAN_MAX_PROFESSIONALS, isManagedPlan } from "./plan-pricing";

/**
 * Apply scheduled plan downgrades whose effective date has been reached.
 * Idempotent: clears the scheduled fields after applying so the same row is
 * not picked up again. Quotas are reset so the new plan limits start fresh.
 */
export async function applyDueScheduledDowngrades(now: Date = new Date()): Promise<number> {
  const dueRows = await db.query.tenantsTable.findMany({
    where: and(
      isNotNull(tenantsTable.scheduledPlan),
      isNotNull(tenantsTable.scheduledPlanEffectiveAt),
      lte(tenantsTable.scheduledPlanEffectiveAt, now),
    ),
  });

  let applied = 0;
  for (const tenant of dueRows) {
    if (!tenant.scheduledPlan || !isManagedPlan(tenant.scheduledPlan)) {
      // Sanitize bad data
      await db.update(tenantsTable).set({
        scheduledPlan: null,
        scheduledPlanEffectiveAt: null,
        scheduledPlanRequestedAt: null,
      }).where(eq(tenantsTable.id, tenant.id));
      continue;
    }

    const targetPlan = tenant.scheduledPlan;
    const newMaxProfessionals = PLAN_MAX_PROFESSIONALS[targetPlan];

    try {
      await db.transaction(async (tx) => {
        // Conditional update: only apply if scheduledPlan is still the same
        // value we read (guards against races with admin/manual changes or
        // user cancellation between SELECT and UPDATE).
        const updated = await tx.update(tenantsTable).set({
          plan: targetPlan,
          maxProfessionals: newMaxProfessionals,
          scheduledPlan: null,
          scheduledPlanEffectiveAt: null,
          scheduledPlanRequestedAt: null,
        }).where(and(
          eq(tenantsTable.id, tenant.id),
          eq(tenantsTable.scheduledPlan, targetPlan),
        )).returning({ id: tenantsTable.id });

        if (updated.length === 0) {
          // Lost the race — leave quotas untouched and skip.
          throw new Error("RACE_LOST");
        }

        await tx.update(dentalAudioCreditsTable)
          .set({ monthlyCharsUsed: 0, monthlyResetDate: now })
          .where(eq(dentalAudioCreditsTable.tenantId, tenant.id));

        await tx.update(dentalConversationQuotasTable)
          .set({ monthlyConversationsUsed: 0, monthlyResetDate: now, alert80SentAt: null, alert100SentAt: null })
          .where(eq(dentalConversationQuotasTable.tenantId, tenant.id));
      });
      applied++;
      logger.info({ tenantId: tenant.id, fromPlan: tenant.plan, targetPlan }, "Scheduled downgrade applied");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "RACE_LOST") {
        logger.info({ tenantId: tenant.id }, "Scheduled downgrade skipped — state changed concurrently");
      } else {
        logger.error({ err, tenantId: tenant.id }, "Failed to apply scheduled downgrade");
      }
    }
  }

  if (applied > 0) {
    logger.info({ applied }, "Scheduled plan downgrades processed");
  }
  return applied;
}
