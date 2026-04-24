import { Router } from "express";
import { db } from "@workspace/db";
import {
  dentalSettingsTable,
  dentalActivityTable,
  appointmentFollowUpsTable,
} from "@workspace/db";
import { eq, and, gte, sql } from "drizzle-orm";
import { tenantMiddleware } from "../../middlewares/tenant";
import { settingsCache } from "../../lib/cache";
import { z } from "zod/v4";

const router = Router();
router.use(tenantMiddleware);

const DAILY_LIMIT = 80;

function brasiliaStartOfDay(daysAgo: number): Date {
  const now = new Date();
  const brasiliaMs = now.getTime() - 3 * 3600 * 1000;
  const brasiliaDate = new Date(brasiliaMs);
  brasiliaDate.setUTCHours(0, 0, 0, 0);
  brasiliaDate.setUTCDate(brasiliaDate.getUTCDate() - daysAgo);
  return new Date(brasiliaDate.getTime() + 3 * 3600 * 1000);
}

router.get("/metrics", async (req, res) => {
  const tenantId = req.tenantId;

  const todayStart = brasiliaStartOfDay(0);
  const sevenDaysStart = brasiliaStartOfDay(7);
  const thirtyDaysStart = brasiliaStartOfDay(30);

  const [
    remarketingToday,
    remarketingLast7,
    remarketingLast30,
    birthdayToday,
    birthdayLast7,
    birthdayLast30,
    recoveryToday,
    recoveryLast7,
    recoveryLast30,
    followupToday,
    followupLast7,
    followupLast30,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(dentalActivityTable)
      .where(
        and(
          eq(dentalActivityTable.tenantId, tenantId),
          eq(dentalActivityTable.type, "remarketing_sent"),
          gte(dentalActivityTable.createdAt, todayStart)
        )
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(dentalActivityTable)
      .where(
        and(
          eq(dentalActivityTable.tenantId, tenantId),
          eq(dentalActivityTable.type, "remarketing_sent"),
          gte(dentalActivityTable.createdAt, sevenDaysStart)
        )
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(dentalActivityTable)
      .where(
        and(
          eq(dentalActivityTable.tenantId, tenantId),
          eq(dentalActivityTable.type, "remarketing_sent"),
          gte(dentalActivityTable.createdAt, thirtyDaysStart)
        )
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(dentalActivityTable)
      .where(
        and(
          eq(dentalActivityTable.tenantId, tenantId),
          eq(dentalActivityTable.type, "birthday_greeting_sent"),
          gte(dentalActivityTable.createdAt, todayStart)
        )
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(dentalActivityTable)
      .where(
        and(
          eq(dentalActivityTable.tenantId, tenantId),
          eq(dentalActivityTable.type, "birthday_greeting_sent"),
          gte(dentalActivityTable.createdAt, sevenDaysStart)
        )
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(dentalActivityTable)
      .where(
        and(
          eq(dentalActivityTable.tenantId, tenantId),
          eq(dentalActivityTable.type, "birthday_greeting_sent"),
          gte(dentalActivityTable.createdAt, thirtyDaysStart)
        )
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(dentalActivityTable)
      .where(
        and(
          eq(dentalActivityTable.tenantId, tenantId),
          eq(dentalActivityTable.type, "recovery_sent"),
          gte(dentalActivityTable.createdAt, todayStart),
          sql`(metadata IS NULL OR metadata::jsonb->>'manual' IS NULL OR metadata::jsonb->>'manual' = 'false')`
        )
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(dentalActivityTable)
      .where(
        and(
          eq(dentalActivityTable.tenantId, tenantId),
          eq(dentalActivityTable.type, "recovery_sent"),
          gte(dentalActivityTable.createdAt, sevenDaysStart),
          sql`(metadata IS NULL OR metadata::jsonb->>'manual' IS NULL OR metadata::jsonb->>'manual' = 'false')`
        )
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(dentalActivityTable)
      .where(
        and(
          eq(dentalActivityTable.tenantId, tenantId),
          eq(dentalActivityTable.type, "recovery_sent"),
          gte(dentalActivityTable.createdAt, thirtyDaysStart),
          sql`(metadata IS NULL OR metadata::jsonb->>'manual' IS NULL OR metadata::jsonb->>'manual' = 'false')`
        )
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(appointmentFollowUpsTable)
      .where(
        and(
          eq(appointmentFollowUpsTable.tenantId, tenantId),
          eq(appointmentFollowUpsTable.status, "sent"),
          gte(appointmentFollowUpsTable.sentAt, todayStart)
        )
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(appointmentFollowUpsTable)
      .where(
        and(
          eq(appointmentFollowUpsTable.tenantId, tenantId),
          eq(appointmentFollowUpsTable.status, "sent"),
          gte(appointmentFollowUpsTable.sentAt, sevenDaysStart)
        )
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(appointmentFollowUpsTable)
      .where(
        and(
          eq(appointmentFollowUpsTable.tenantId, tenantId),
          eq(appointmentFollowUpsTable.status, "sent"),
          gte(appointmentFollowUpsTable.sentAt, thirtyDaysStart)
        )
      ),
  ]);

  const rToday = remarketingToday[0]?.count ?? 0;
  const bToday = birthdayToday[0]?.count ?? 0;
  const recToday = recoveryToday[0]?.count ?? 0;
  const fToday = followupToday[0]?.count ?? 0;
  const totalToday = rToday + bToday + recToday + fToday;

  const rLast7 = remarketingLast7[0]?.count ?? 0;
  const bLast7 = birthdayLast7[0]?.count ?? 0;
  const recLast7 = recoveryLast7[0]?.count ?? 0;
  const fLast7 = followupLast7[0]?.count ?? 0;
  const totalLast7 = rLast7 + bLast7 + recLast7 + fLast7;

  const rLast30 = remarketingLast30[0]?.count ?? 0;
  const bLast30 = birthdayLast30[0]?.count ?? 0;
  const recLast30 = recoveryLast30[0]?.count ?? 0;
  const fLast30 = followupLast30[0]?.count ?? 0;
  const totalLast30 = rLast30 + bLast30 + recLast30 + fLast30;

  res.json({
    dailyLimit: DAILY_LIMIT,
    totals: {
      today: totalToday,
      last7Days: totalLast7,
      last30Days: totalLast30,
    },
    byType: {
      remarketing: { today: rToday, last7Days: rLast7, last30Days: rLast30 },
      followup: { today: fToday, last7Days: fLast7, last30Days: fLast30 },
      birthday: { today: bToday, last7Days: bLast7, last30Days: bLast30 },
      recovery: { today: recToday, last7Days: recLast7, last30Days: recLast30 },
    },
  });
});

router.get("/pause-status", async (req, res) => {
  const tenantId = req.tenantId;

  const settings = await db.query.dentalSettingsTable.findFirst({
    where: eq(dentalSettingsTable.tenantId, tenantId),
  });

  res.json({
    automationsPaused: settings?.automationsPaused ?? false,
    remarketingPaused: settings?.remarketingPaused ?? false,
    followupPaused: settings?.followupPaused ?? false,
    birthdayPaused: settings?.birthdayPaused ?? false,
    recoveryPaused: settings?.recoveryPaused ?? false,
  });
});

const PauseStatusBody = z.object({
  automationsPaused: z.boolean().optional(),
  remarketingPaused: z.boolean().optional(),
  followupPaused: z.boolean().optional(),
  birthdayPaused: z.boolean().optional(),
  recoveryPaused: z.boolean().optional(),
});

router.patch("/pause-status", async (req, res) => {
  const tenantId = req.tenantId;
  const body = PauseStatusBody.parse(req.body);

  if (Object.keys(body).length === 0) {
    res.status(400).json({ error: "At least one pause flag must be specified" });
    return;
  }

  const existing = await db.query.dentalSettingsTable.findFirst({
    where: eq(dentalSettingsTable.tenantId, tenantId),
  });

  if (existing) {
    const [updated] = await db
      .update(dentalSettingsTable)
      .set(body)
      .where(eq(dentalSettingsTable.tenantId, tenantId))
      .returning();
    // Invalidate AFTER the DB write so no concurrent request can cache the stale value
    await settingsCache.invalidate(tenantId);
    res.json({
      automationsPaused: updated.automationsPaused,
      remarketingPaused: updated.remarketingPaused,
      followupPaused: updated.followupPaused,
      birthdayPaused: updated.birthdayPaused,
      recoveryPaused: updated.recoveryPaused,
    });
  } else {
    const [created] = await db
      .insert(dentalSettingsTable)
      .values({ tenantId, ...body })
      .returning();
    // Invalidate AFTER the DB write
    await settingsCache.invalidate(tenantId);
    res.json({
      automationsPaused: created.automationsPaused,
      remarketingPaused: created.remarketingPaused,
      followupPaused: created.followupPaused,
      birthdayPaused: created.birthdayPaused,
      recoveryPaused: created.recoveryPaused,
    });
  }
});

export default router;
