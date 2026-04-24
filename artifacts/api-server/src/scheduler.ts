import cron from "node-cron";
import { getRedis } from "./lib/redis";
import { db } from "@workspace/db";
import {
  appointmentFollowUpsTable,
  appointmentsTable,
  patientsTable,
  dentalLeadsTable,
  dentalConversationsTable,
  dentalMessagesTable,
  dentalActivityTable,
  dentalSettingsTable,
  tenantsTable,
} from "@workspace/db";
import { eq, and, lte, lt, desc, sql } from "drizzle-orm";
import { getProviderForTenant } from "./lib/whatsapp-provider";
import { getCachedSettings } from "./lib/cache";
import { generateRemarketingMessage, getOpenAIClient } from "./lib/ai-engine";
import { logger } from "./lib/logger";
import { maskPhone, maskName } from "./lib/pii-mask";
import { resetAllMonthlyQuotas } from "./lib/credit-manager";
import { resetAllMonthlyConversationQuotas } from "./lib/conversation-quota-manager";
import { applyDueScheduledDowngrades } from "./lib/plan-downgrade";
import { runDeepHealthCheck } from "./lib/health-checker";
import { processHealthAlerts } from "./lib/health-alerts";
import { processHotLeadCalls, processConfirmationCalls } from "./lib/call-engine";
import { runInsuranceAuditJob } from "./lib/insurance-audit";
import { runUnconfirmedAppointmentsJob } from "./lib/unconfirmed-alert";
import { insertChainedMessage } from "./lib/audit-chain";
import {
  sendSubscriptionExpiryWarningEmail,
  sendSubscriptionSuspendedEmail,
  sendSubscriptionReactivatedEmail,
  sendTrialExpiryWarningEmail,
} from "./lib/email";
import {
  sendTelegramMessage,
  buildSubscriptionExpiryWarningMessage,
  buildSubscriptionSuspendedMessage,
  buildSubscriptionReactivatedMessage,
  buildTrialExpiryWarningMessage,
  buildWhatsappDisconnectedMessage,
} from "./lib/telegram";

// ─── Anti-spam utilities ──────────────────────────────────────────────────────

/** Random delay between min and max milliseconds — simulates human typing cadence */
function sleepRandom(minMs: number, maxMs: number): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Daily per-contact send tracker.
 * Prevents the same phone number from receiving more than one automated
 * outbound message per day across all message types (follow-up, remarketing,
 * recovery, birthday). Resets automatically at midnight via date-keyed buckets.
 * Uses Redis when available for cross-instance coordination; falls back to in-memory.
 */
const _localDailySendTracker = new Map<string, Set<string>>();
const DAILY_TRACKER_TTL_SEC = 25 * 3600;

function todayKey(): string {
  return brasiliaDateKey(); // "YYYY-MM-DD" in Brasília time (UTC-3)
}

async function canSendToday(tenantId: number, phone: string): Promise<boolean> {
  const redis = getRedis();
  const member = `${tenantId}:${phone}`;
  if (redis) {
    try {
      const isMember = await redis.sismember(`daily:${todayKey()}`, member);
      return isMember === 0;
    } catch {
    }
  }
  const bucket = _localDailySendTracker.get(todayKey());
  if (!bucket) return true;
  return !bucket.has(member);
}

async function markSentToday(tenantId: number, phone: string): Promise<void> {
  const redis = getRedis();
  const member = `${tenantId}:${phone}`;
  const key = `daily:${todayKey()}`;
  if (redis) {
    try {
      await redis.sadd(key, member);
      await redis.expire(key, DAILY_TRACKER_TTL_SEC);
      return;
    } catch {
    }
  }
  const dateKey = todayKey();
  if (!_localDailySendTracker.has(dateKey)) {
    _localDailySendTracker.clear();
    _localDailySendTracker.set(dateKey, new Set());
  }
  _localDailySendTracker.get(dateKey)!.add(member);
}

/** Returns the current hour in Brasília time (UTC-3) */
function brasiliaHour(): number {
  const now = new Date();
  // UTC-3 = subtract 3 hours from UTC
  return ((now.getUTCHours() - 3 + 24) % 24);
}

/** Returns the current day-of-week in Brasília time (0=Sunday, 6=Saturday) */
function brasiliaDay(): number {
  const now = new Date();
  const brasiliaMs = now.getTime() - 3 * 3600 * 1000;
  return new Date(brasiliaMs).getUTCDay();
}

/** Returns today's date string (YYYY-MM-DD) in Brasília time */
function brasiliaDateKey(): string {
  const now = new Date();
  const brasiliaMs = now.getTime() - 3 * 3600 * 1000;
  return new Date(brasiliaMs).toISOString().slice(0, 10);
}

/** Allowed send window: 8h–19h Brasília time (conservative anti-ban window) */
function isWithinSendWindow(): boolean {
  const hour = brasiliaHour();
  return hour >= 8 && hour < 19;
}

/**
 * Per-contact 48-hour spacing tracker.
 * Prevents the same phone number from receiving more than one automated outbound
 * message in any rolling 48-hour window — across all message types and all clinics
 * sharing the same WhatsApp instance. Uses Redis when available (with TTL),
 * with an in-memory fallback that auto-expires.
 */
const SPACING_HOURS = 48;
const SPACING_TTL_SEC = SPACING_HOURS * 3600;
const _localSpacingTracker = new Map<string, number>();

/**
 * Atomically reserves a 48-hour spacing slot for (tenantId, phone).
 * Returns true if the reservation succeeded (caller may proceed to send),
 * false if another worker already reserved (caller must skip).
 * Uses Redis `SET NX EX` for cross-instance atomicity; falls back to a
 * single-process check-and-set when Redis is unavailable.
 */
async function tryReserveSend48h(tenantId: number, phone: string): Promise<boolean> {
  const redis = getRedis();
  const key = `spacing:${tenantId}:${phone}`;
  if (redis) {
    try {
      const result = await redis.set(key, "1", "EX", SPACING_TTL_SEC, "NX");
      return result === "OK";
    } catch {
    }
  }
  const exp = _localSpacingTracker.get(key);
  if (exp && exp > Date.now()) return false;
  _localSpacingTracker.set(key, Date.now() + SPACING_TTL_SEC * 1000);
  return true;
}

/** Releases a reservation after a failed send so legitimate retries are not blocked for 48h. */
async function releaseSend48h(tenantId: number, phone: string): Promise<void> {
  const redis = getRedis();
  const key = `spacing:${tenantId}:${phone}`;
  if (redis) {
    try {
      await redis.del(key);
      return;
    } catch {
    }
  }
  _localSpacingTracker.delete(key);
}

/**
 * Per-tenant daily cap of 80 automated messages (Brasília calendar day).
 * Atomic INCR + EXPIRE in Redis ensures the cap holds across workers/instances.
 * Falls back to a single-process counter when Redis is unavailable.
 */
const DAILY_LIMIT_PER_TENANT = 80;
const DAILY_QUOTA_TTL_SEC = 25 * 3600;
const _localDailyTenantCounter = new Map<string, number>();

async function tryConsumeDailyQuota(tenantId: number): Promise<boolean> {
  const date = todayKey();
  const redis = getRedis();
  const key = `tenant-daily:${date}:${tenantId}`;
  if (redis) {
    try {
      const newVal = await redis.incr(key);
      if (newVal === 1) {
        try { await redis.expire(key, DAILY_QUOTA_TTL_SEC); } catch {}
      }
      if (newVal > DAILY_LIMIT_PER_TENANT) {
        try { await redis.decr(key); } catch {}
        return false;
      }
      return true;
    } catch {
    }
  }
  const k = `${date}:${tenantId}`;
  // Drop old date buckets to keep memory bounded
  for (const dk of _localDailyTenantCounter.keys()) {
    if (!dk.startsWith(`${date}:`)) _localDailyTenantCounter.delete(dk);
  }
  const cur = _localDailyTenantCounter.get(k) ?? 0;
  if (cur >= DAILY_LIMIT_PER_TENANT) return false;
  _localDailyTenantCounter.set(k, cur + 1);
  return true;
}

async function releaseDailyQuota(tenantId: number): Promise<void> {
  const date = todayKey();
  const redis = getRedis();
  const key = `tenant-daily:${date}:${tenantId}`;
  if (redis) {
    try { await redis.decr(key); return; } catch {}
  }
  const k = `${date}:${tenantId}`;
  const cur = _localDailyTenantCounter.get(k) ?? 0;
  if (cur > 0) _localDailyTenantCounter.set(k, cur - 1);
}

export async function processFollowUps() {
  // Only send follow-ups during safe hours (8h–20h) to avoid disturbing patients
  if (!isWithinSendWindow()) return;

  const now = new Date();

  const pending = await db.query.appointmentFollowUpsTable.findMany({
    where: and(
      eq(appointmentFollowUpsTable.status, "pending"),
      lte(appointmentFollowUpsTable.scheduledAt, now)
    ),
    limit: 50,
  });

  for (const followUp of pending) {
    try {
      const appointment = await db.query.appointmentsTable.findFirst({
        where: eq(appointmentsTable.id, followUp.appointmentId),
      });
      if (!appointment) continue;
      if (appointment.status === "cancelled") {
        await db.update(appointmentFollowUpsTable).set({ status: "skipped" }).where(eq(appointmentFollowUpsTable.id, followUp.id));
        continue;
      }

      const settings = await getCachedSettings(followUp.tenantId);

      if (settings?.automationsPaused || settings?.followupPaused) {
        logger.info({ followUpId: followUp.id }, "Follow-up skipped: automations paused");
        continue;
      }

      if (followUp.type === "reminder_24h" && settings?.followUpReminder === false) {
        await db.update(appointmentFollowUpsTable).set({ status: "skipped" }).where(eq(appointmentFollowUpsTable.id, followUp.id));
        continue;
      }
      if (followUp.type === "confirmation") {
        await db.update(appointmentFollowUpsTable).set({ status: "skipped" }).where(eq(appointmentFollowUpsTable.id, followUp.id));
        continue;
      }
      if (followUp.type === "post_appointment" && settings?.followUpPostAppointment === false) {
        await db.update(appointmentFollowUpsTable).set({ status: "skipped" }).where(eq(appointmentFollowUpsTable.id, followUp.id));
        continue;
      }
      if (followUp.type === "no_show_patient_contact") {
        if (!settings?.noShowEnabled || appointment.status !== "no_show") {
          await db.update(appointmentFollowUpsTable).set({ status: "skipped" }).where(eq(appointmentFollowUpsTable.id, followUp.id));
          continue;
        }
        if (!appointment.patientId && !appointment.leadId) {
          await db.update(appointmentFollowUpsTable).set({ status: "skipped" }).where(eq(appointmentFollowUpsTable.id, followUp.id));
          continue;
        }
        const rescheduledRows = await db.execute<{ exists: boolean }>(sql`
          SELECT EXISTS (
            SELECT 1 FROM appointments
            WHERE tenant_id = ${followUp.tenantId}
              AND status IN ('scheduled', 'confirmed')
              AND created_at > ${appointment.startsAt}
              AND ${appointment.patientId ? sql`patient_id = ${appointment.patientId}` : sql`lead_id = ${appointment.leadId}`}
          ) AS exists
        `);
        if (rescheduledRows.rows[0]?.exists) {
          await db.update(appointmentFollowUpsTable).set({ status: "skipped" }).where(eq(appointmentFollowUpsTable.id, followUp.id));
          continue;
        }
      }

      let contactPhone: string | undefined;
      let contactName: string = "paciente";

      if (appointment.patientId) {
        const patient = await db.query.patientsTable.findFirst({
          where: eq(patientsTable.id, appointment.patientId),
        });
        contactPhone = patient?.phone ?? undefined;
        contactName = patient?.name ?? "paciente";
      } else if (appointment.leadId) {
        const lead = await db.query.dentalLeadsTable.findFirst({
          where: eq(dentalLeadsTable.id, appointment.leadId),
        });
        contactPhone = lead?.phone ?? undefined;
        contactName = lead?.name ?? "paciente";
      }

      if (!contactPhone) continue;

      const tenant = await db.query.tenantsTable.findFirst({
        where: eq(tenantsTable.id, followUp.tenantId),
      });
      const clinicName = tenant?.name ?? "Clinica";

      const startsAt = appointment.startsAt;
      const dateStr = startsAt.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
      const timeStr = startsAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

      function applyTemplate(template: string): string {
        return template
          .replace(/\{nome\}/gi, contactName)
          .replace(/\{data\}/gi, dateStr)
          .replace(/\{horario\}/gi, timeStr)
          .replace(/\{clinica\}/gi, clinicName);
      }

      const DEFAULT_TEMPLATES: Record<string, string> = {
        reminder_24h: `Ola {nome}! 😊 Lembrando que voce tem uma consulta marcada para {data}, as {horario}. Por favor, confirme sua presenca respondendo SIM ou NAO. Esperamos por voce!`,
        post_appointment: `{nome}, esperamos que tenha gostado do atendimento! Se tiver alguma duvida ou precisar de algo, estamos a disposicao.`,
      };

      let message = "";
      switch (followUp.type) {
        case "reminder_24h": {
          message = applyTemplate(DEFAULT_TEMPLATES.reminder_24h);
          break;
        }
        case "post_appointment": {
          message = applyTemplate(DEFAULT_TEMPLATES.post_appointment);
          break;
        }
        case "no_show_patient_contact": {
          const customMsg = followUp.message || settings?.noShowPatientMessage;
          message = customMsg
            ? applyTemplate(customMsg)
            : applyTemplate(`Ola {nome}! Notamos que nao conseguiu comparecer a sua consulta de {data} as {horario}. Gostaríamos de reagendar quando preferir. Entre em contato e marcaremos um novo horario!`);
          break;
        }
        default:
          message = followUp.message || "";
      }

      if (message) {
        // Daily cap: skip if this contact already received an automated message today
        if (!await canSendToday(followUp.tenantId, contactPhone)) {
          logger.info({ followUpId: followUp.id, phone: maskPhone(contactPhone) }, "Follow-up deferred: daily cap reached for this contact");
          continue;
        }

        // Per-tenant daily cap of 80 automated messages
        if (!await tryConsumeDailyQuota(followUp.tenantId)) {
          logger.info({ followUpId: followUp.id, tenantId: followUp.tenantId, dailyLimit: DAILY_LIMIT_PER_TENANT }, "Follow-up deferred: tenant daily cap reached");
          continue;
        }

        // 48h spacing: atomic reservation across workers; release on send failure
        if (!await tryReserveSend48h(followUp.tenantId, contactPhone)) {
          await releaseDailyQuota(followUp.tenantId);
          logger.info({ followUpId: followUp.id, phone: maskPhone(contactPhone) }, "Follow-up deferred: 48h spacing rule");
          continue;
        }

        try {
          const { provider, instanceName } = await getProviderForTenant(followUp.tenantId);
          await provider.sendMessage(contactPhone, message, instanceName);
          await markSentToday(followUp.tenantId, contactPhone);
          logger.info({ followUpId: followUp.id, type: followUp.type, phone: maskPhone(contactPhone) }, "Follow-up sent");
        } catch (sendErr) {
          await releaseSend48h(followUp.tenantId, contactPhone);
          await releaseDailyQuota(followUp.tenantId);
          throw sendErr;
        }

        // Anti-spam: random 8–20 s delay before next send (conservative)
        await sleepRandom(8000, 20000);
      }

      await db.update(appointmentFollowUpsTable).set({ status: "sent", sentAt: new Date() }).where(eq(appointmentFollowUpsTable.id, followUp.id));
    } catch (err) {
      logger.error({ err, followUpId: followUp.id }, "Follow-up failed");
      await db.update(appointmentFollowUpsTable).set({ status: "failed" }).where(eq(appointmentFollowUpsTable.id, followUp.id));
    }
  }
}

export interface RemarketingSettings {
  remarketingMaxLeads: number;
  remarketingIntervalHot: number;
  remarketingIntervalWarm: number;
  remarketingIntervalCold: number;
}

export function getRemarketingIntervalDays(
  temperature: string,
  settings: Pick<RemarketingSettings, "remarketingIntervalHot" | "remarketingIntervalWarm" | "remarketingIntervalCold">,
): number {
  return temperature === "hot"
    ? settings.remarketingIntervalHot
    : temperature === "warm"
      ? settings.remarketingIntervalWarm
      : settings.remarketingIntervalCold;
}

export function isLeadEligibleForRemarketing(
  leadStatus: string,
  lastContactAt: Date | null,
  temperature: string,
  lastRemarketingAt: Date | null,
  now: Date,
  settings: Pick<RemarketingSettings, "remarketingIntervalHot" | "remarketingIntervalWarm" | "remarketingIntervalCold">,
): boolean {
  if (leadStatus !== "active") return false;
  if (!lastContactAt) return true;
  const intervalDays = getRemarketingIntervalDays(temperature, settings);
  const minIntervalMs = intervalDays * 24 * 60 * 60 * 1000;
  if (now.getTime() - lastContactAt.getTime() < minIntervalMs) return false;
  if (lastRemarketingAt && now.getTime() - lastRemarketingAt.getTime() < minIntervalMs) return false;
  return true;
}

export async function processLeadRemarketingForTenant(tenantId: number, settings: {
  remarketingMaxLeads: number;
  remarketingIntervalHot: number;
  remarketingIntervalWarm: number;
  remarketingIntervalCold: number;
}) {
  const now = new Date();
  const minDaysAgo = Math.min(settings.remarketingIntervalHot, settings.remarketingIntervalWarm, settings.remarketingIntervalCold);
  const cutoff = new Date(now.getTime() - minDaysAgo * 24 * 60 * 60 * 1000);

  const leadsToRemarket = await db.query.dentalLeadsTable.findMany({
    where: and(
      eq(dentalLeadsTable.tenantId, tenantId),
      eq(dentalLeadsTable.status, "active"),
      lte(dentalLeadsTable.lastContactAt, cutoff)
    ),
    limit: settings.remarketingMaxLeads,
  });

  for (const lead of leadsToRemarket) {
    try {
      const recentRemarketing = await db.query.dentalActivityTable.findFirst({
        where: and(
          eq(dentalActivityTable.tenantId, lead.tenantId),
          eq(dentalActivityTable.type, "remarketing_sent"),
          eq(dentalActivityTable.entityType, "lead"),
          eq(dentalActivityTable.entityId, lead.id)
        ),
        orderBy: [desc(dentalActivityTable.createdAt)],
      });

      if (!isLeadEligibleForRemarketing(
        lead.status,
        lead.lastContactAt,
        lead.temperature,
        recentRemarketing?.createdAt ?? null,
        now,
        settings,
      )) {
        continue;
      }

      // Daily cap: skip if this contact already received an automated message today
      if (!await canSendToday(lead.tenantId, lead.phone)) {
        logger.info({ leadId: lead.id, phone: maskPhone(lead.phone) }, "Remarketing deferred: daily cap reached for this contact");
        continue;
      }

      const message = await generateRemarketingMessage(lead.tenantId, lead.id);
      if (!message) continue;

      // Per-tenant daily cap of 80 automated messages
      if (!await tryConsumeDailyQuota(lead.tenantId)) {
        logger.info({ leadId: lead.id, tenantId: lead.tenantId, dailyLimit: DAILY_LIMIT_PER_TENANT }, "Remarketing deferred: tenant daily cap reached");
        continue;
      }

      // 48h spacing: atomic reservation across workers; release on send failure
      if (!await tryReserveSend48h(lead.tenantId, lead.phone)) {
        await releaseDailyQuota(lead.tenantId);
        logger.info({ leadId: lead.id, phone: maskPhone(lead.phone) }, "Remarketing deferred: 48h spacing rule");
        continue;
      }

      try {
        const { provider, instanceName } = await getProviderForTenant(lead.tenantId);
        await provider.sendMessage(lead.phone, message, instanceName);
        await markSentToday(lead.tenantId, lead.phone);
      } catch (sendErr) {
        await releaseSend48h(lead.tenantId, lead.phone);
        await releaseDailyQuota(lead.tenantId);
        throw sendErr;
      }

      // Anti-spam: random 8–20 s delay before next send (conservative)
      await sleepRandom(8000, 20000);

      let conversation = await db.query.dentalConversationsTable.findFirst({
        where: and(
          eq(dentalConversationsTable.tenantId, lead.tenantId),
          eq(dentalConversationsTable.leadId, lead.id)
        ),
        orderBy: [desc(dentalConversationsTable.updatedAt)],
      });

      if (!conversation) {
        const [newConv] = await db.insert(dentalConversationsTable).values({
          tenantId: lead.tenantId,
          contactPhone: lead.phone,
          contactName: lead.name,
          contactType: "lead",
          leadId: lead.id,
          status: "open",
        }).returning();
        conversation = newConv;
      }

      await insertChainedMessage({
        tenantId: lead.tenantId,
        conversationId: conversation.id,
        direction: "outbound",
        type: "text",
        content: message,
        // Task #12: marca a origem para auditoria de termos de venda.
        externalId: `ai:remarketing:${Date.now()}`,
        aiModel: process.env.AI_MODEL_NAME || "gpt-5-nano",
        promptVersion: process.env.AI_PROMPT_VERSION || "v1",
      });

      await db.update(dentalConversationsTable).set({
        lastMessageAt: new Date(),
        lastMessagePreview: message.substring(0, 100),
      }).where(eq(dentalConversationsTable.id, conversation.id));

      await db.insert(dentalActivityTable).values({
        tenantId: lead.tenantId,
        type: "remarketing_sent",
        description: `Remarketing enviado para lead ${lead.name} (${lead.temperature})`,
        entityType: "lead",
        entityId: lead.id,
        metadata: JSON.stringify({
          leadTemperature: lead.temperature,
          messagePreview: message.substring(0, 100),
          intervalDays,
        }),
      });

      logger.info({ leadId: lead.id, temperature: lead.temperature, phone: maskPhone(lead.phone), intervalDays }, "Remarketing sent to lead");
    } catch (err) {
      logger.error({ err, leadId: lead.id }, "Lead remarketing failed");
      await db.insert(dentalActivityTable).values({
        tenantId: lead.tenantId,
        type: "remarketing_failed",
        description: `Falha no envio de remarketing para lead ${lead.name}: ${err instanceof Error ? err.message : "unknown error"}`,
        entityType: "lead",
        entityId: lead.id,
        metadata: JSON.stringify({ error: err instanceof Error ? err.message : "unknown" }),
      }).catch(() => {});
    }
  }
}

async function processLeadRemarketing() {
  const now = new Date();
  const currentHour = brasiliaHour();
  const currentDay = brasiliaDay();

  const allTenants = await db.query.tenantsTable.findMany();

  for (const tenant of allTenants) {
    try {
      const settings = await getCachedSettings(tenant.id);

      if (!settings || settings.remarketingEnabled === false) continue;
      if (settings.automationsPaused || settings.remarketingPaused) {
        logger.info({ tenantId: tenant.id }, "Lead remarketing skipped: automations paused");
        continue;
      }

      const allowedDays = (settings.remarketingDays || "1,2,3,4,5,6").split(",").map(Number);
      if (!allowedDays.includes(currentDay)) continue;

      const allowedHours = (settings.remarketingHours || "10,15").split(",").map(Number);
      if (!allowedHours.includes(currentHour)) continue;

      await processLeadRemarketingForTenant(tenant.id, {
        remarketingMaxLeads: settings.remarketingMaxLeads ?? 10,
        remarketingIntervalHot: settings.remarketingIntervalHot ?? 2,
        remarketingIntervalWarm: settings.remarketingIntervalWarm ?? 4,
        remarketingIntervalCold: settings.remarketingIntervalCold ?? 7,
      });
    } catch (err) {
      logger.error({ err, tenantId: tenant.id }, "Tenant remarketing processing failed");
    }
  }
}

export async function triggerRemarketingForAll(): Promise<{ tenantId: number; leadsProcessed: string }[]> {
  const allTenants = await db.query.tenantsTable.findMany();
  const results: { tenantId: number; leadsProcessed: string }[] = [];

  for (const tenant of allTenants) {
    try {
      const settings = await getCachedSettings(tenant.id);

      if (!settings || settings.remarketingEnabled === false) {
        results.push({ tenantId: tenant.id, leadsProcessed: "skipped (remarketing disabled)" });
        continue;
      }

      await processLeadRemarketingForTenant(tenant.id, {
        remarketingMaxLeads: settings.remarketingMaxLeads ?? 10,
        remarketingIntervalHot: settings.remarketingIntervalHot ?? 2,
        remarketingIntervalWarm: settings.remarketingIntervalWarm ?? 4,
        remarketingIntervalCold: settings.remarketingIntervalCold ?? 7,
      });

      results.push({ tenantId: tenant.id, leadsProcessed: "triggered" });
    } catch (err) {
      logger.error({ err, tenantId: tenant.id }, "Forced tenant remarketing failed");
      results.push({ tenantId: tenant.id, leadsProcessed: `error: ${err instanceof Error ? err.message : "unknown"}` });
    }
  }

  return results;
}

async function processExpiredTakeovers() {
  const now = new Date();
  const expired = await db.query.dentalConversationsTable.findMany({
    where: and(
      eq(dentalConversationsTable.status, "human_takeover"),
      lte(dentalConversationsTable.humanTakeoverExpiresAt, now),
    ),
    limit: 100,
  });

  for (const conv of expired) {
    try {
      await db.update(dentalConversationsTable).set({
        status: "open",
        humanTakeoverAt: null,
        humanTakeoverExpiresAt: null,
      }).where(eq(dentalConversationsTable.id, conv.id));

      logger.info({ conversationId: conv.id, tenantId: conv.tenantId, contactPhone: maskPhone(conv.contactPhone) }, "Human takeover expired — AI auto-resumed");
    } catch (err) {
      logger.error({ err, conversationId: conv.id }, "Failed to auto-resume takeover");
    }
  }
}

export async function ensureBirthdayTable() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS birthday_greetings_sent (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        patient_id INTEGER NOT NULL,
        year INTEGER NOT NULL,
        sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(tenant_id, patient_id, year)
      )
    `);
  } catch (err) {
    logger.error({ err }, "Failed to create birthday_greetings_sent table");
  }
}

export async function processBirthdayGreetings() {
  const now = new Date();
  const currentHour = brasiliaHour();
  // Use Brasília date for month/day/year
  const brasiliaDate = new Date(now.getTime() - 3 * 3600 * 1000);
  const currentMonth = brasiliaDate.getUTCMonth() + 1;
  const currentDay = brasiliaDate.getUTCDate();
  const currentYear = brasiliaDate.getUTCFullYear();

  const allTenants = await db.query.tenantsTable.findMany();

  for (const tenant of allTenants) {
    try {
      const settings = await getCachedSettings(tenant.id);

      if (!settings || !settings.birthdayEnabled) continue;
      if (settings.automationsPaused || settings.birthdayPaused) {
        logger.info({ tenantId: tenant.id }, "Birthday greetings skipped: automations paused");
        continue;
      }
      if (currentHour !== (settings.birthdayHour ?? 9)) continue;

      const birthdayPatients = await db.execute<{
        id: number;
        name: string;
        phone: string;
      }>(sql`
        SELECT id, name, phone FROM patients
        WHERE tenant_id = ${tenant.id}
          AND birth_date IS NOT NULL
          AND birth_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          AND EXTRACT(MONTH FROM TO_DATE(birth_date, 'YYYY-MM-DD')) = ${currentMonth}
          AND EXTRACT(DAY FROM TO_DATE(birth_date, 'YYYY-MM-DD')) = ${currentDay}
          AND id NOT IN (
            SELECT patient_id FROM birthday_greetings_sent
            WHERE tenant_id = ${tenant.id} AND year = ${currentYear}
          )
      `);

      if (!birthdayPatients.rows.length) continue;

      const defaultMessage = `Feliz aniversario, {nome}! 🎂🎉 A equipe da {clinica} deseja um dia maravilhoso para voce. Estamos aqui para cuidar do seu sorriso!`;
      const messageTemplate = settings.birthdayMessage || defaultMessage;
      const clinicName = tenant.name || "Clinica";

      const { provider, instanceName } = await getProviderForTenant(tenant.id);

      for (const patient of birthdayPatients.rows) {
        try {
          // Daily cap: skip if this contact already received an automated message today
          if (!await canSendToday(tenant.id, patient.phone)) {
            logger.info({ tenantId: tenant.id, patientId: patient.id }, "Birthday greeting deferred: daily cap reached for this contact");
            continue;
          }

          // Per-tenant daily cap of 80 automated messages
          if (!await tryConsumeDailyQuota(tenant.id)) {
            logger.info({ tenantId: tenant.id, patientId: patient.id, dailyLimit: DAILY_LIMIT_PER_TENANT }, "Birthday greeting deferred: tenant daily cap reached");
            continue;
          }

          // 48h spacing: atomic reservation across workers; release on send failure
          if (!await tryReserveSend48h(tenant.id, patient.phone)) {
            await releaseDailyQuota(tenant.id);
            logger.info({ tenantId: tenant.id, patientId: patient.id }, "Birthday greeting deferred: 48h spacing rule");
            continue;
          }

          const message = messageTemplate
            .replace(/\{nome\}/gi, patient.name || "paciente")
            .replace(/\{clinica\}/gi, clinicName);

          try {
            await provider.sendMessage(patient.phone, message, instanceName);
            await markSentToday(tenant.id, patient.phone);
          } catch (sendErr) {
            await releaseSend48h(tenant.id, patient.phone);
            await releaseDailyQuota(tenant.id);
            throw sendErr;
          }

          await db.execute(sql`
            INSERT INTO birthday_greetings_sent (tenant_id, patient_id, year)
            VALUES (${tenant.id}, ${patient.id}, ${currentYear})
            ON CONFLICT (tenant_id, patient_id, year) DO NOTHING
          `);

          await db.insert(dentalActivityTable).values({
            tenantId: tenant.id,
            type: "birthday_greeting_sent",
            description: `Mensagem de aniversario enviada para ${patient.name}`,
            entityType: "patient",
            entityId: patient.id,
            metadata: JSON.stringify({ patientName: patient.name, phone: patient.phone }),
          });

          logger.info({ tenantId: tenant.id, patientId: patient.id, patientName: maskName(patient.name) }, "Birthday greeting sent");

          // Anti-spam: random 8–20 s delay before next birthday send (conservative)
          await sleepRandom(8000, 20000);
        } catch (err) {
          logger.error({ err, tenantId: tenant.id, patientId: patient.id }, "Birthday greeting failed");
        }
      }
    } catch (err) {
      logger.error({ err, tenantId: tenant.id }, "Birthday processing failed for tenant");
    }
  }
}

async function generateRecoveryMessage(
  tenantId: number,
  contactName: string,
  contextType: "inactive_patient" | "no_show_lead",
  customInstructions?: string | null
): Promise<string> {
  try {
    const client = await getOpenAIClient(tenantId);
    const contextDesc = contextType === "inactive_patient"
      ? "um paciente que não visita a clínica há algum tempo"
      : "um lead que agendou uma consulta mas não compareceu";
    const instructions = customInstructions
      ? `\n\nInstruções específicas: ${customInstructions}`
      : "";

    const response = await client.chat.completions.create({
      model: "gpt-5-nano",
      max_completion_tokens: 150,
      temperature: 0.6,
      messages: [
        {
          role: "system",
          content: `Você é uma secretária de clínica odontológica. Gere uma mensagem curta e acolhedora de reativação para ${contextDesc}. A mensagem deve ser pessoal, empática e convidar o contato a retornar ou reagendar. Use o nome da pessoa. Seja breve (máximo 3 frases). Escreva em português do Brasil informal. Não use emojis excessivos.${instructions}`,
        },
        {
          role: "user",
          content: `Nome do contato: ${contactName}`,
        },
      ],
    });

    return response.choices[0]?.message?.content || `Oi ${contactName}! Sentimos sua falta por aqui. Que tal marcarmos um horário? Estamos esperando por você!`;
  } catch (err) {
    logger.error({ err, tenantId }, "Failed to generate recovery message");
    return `Oi ${contactName}! Sentimos sua falta por aqui. Que tal marcarmos um horário? Estamos esperando por você!`;
  }
}

export async function processPatientRecoveryForTenant(
  tenantId: number,
  options?: { manualEntityType?: "patient" | "lead"; manualEntityId?: number }
): Promise<void> {
  const settings = await getCachedSettings(tenantId);

  if (!settings) return;

  const inactivityDays = settings.recoveryInactivityDays ?? 60;
  const noShowDays = settings.recoveryNoShowDays ?? 14;
  const maxPerRun = settings.recoveryMaxPerRun ?? 10;
  const aiInstructions = settings.recoveryAiInstructions;

  const now = new Date();
  const patientCutoff = new Date(now.getTime() - inactivityDays * 24 * 60 * 60 * 1000);
  const noShowCutoff = new Date(now.getTime() - noShowDays * 24 * 60 * 60 * 1000);
  const recentlySentCutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  if (options?.manualEntityType && options?.manualEntityId) {
    const { manualEntityType, manualEntityId } = options;

    const recentActivity = await db.query.dentalActivityTable.findFirst({
      where: and(
        eq(dentalActivityTable.tenantId, tenantId),
        eq(dentalActivityTable.entityType, manualEntityType),
        eq(dentalActivityTable.entityId, manualEntityId),
        eq(dentalActivityTable.type, "recovery_sent"),
      ),
      orderBy: [desc(dentalActivityTable.createdAt)],
    });

    if (recentActivity && recentActivity.createdAt > recentlySentCutoff) {
      logger.info({ tenantId, manualEntityType, manualEntityId }, "Recovery skipped: recently sent");
      return;
    }

    let contactPhone = "";
    let contactName = "";

    if (manualEntityType === "patient") {
      const patient = await db.query.patientsTable.findFirst({
        where: and(eq(patientsTable.id, manualEntityId), eq(patientsTable.tenantId, tenantId)),
      });
      if (!patient) return;
      contactPhone = patient.phone;
      contactName = patient.name;
    } else {
      const lead = await db.query.dentalLeadsTable.findFirst({
        where: and(eq(dentalLeadsTable.id, manualEntityId), eq(dentalLeadsTable.tenantId, tenantId)),
      });
      if (!lead) return;
      contactPhone = lead.phone;
      contactName = lead.name;
    }

    const message = await generateRecoveryMessage(tenantId, contactName, manualEntityType === "patient" ? "inactive_patient" : "no_show_lead", aiInstructions);

    // Manual recovery is operator-triggered: bypass tenant daily cap and 48h spacing.
    const { provider, instanceName } = await getProviderForTenant(tenantId);
    await provider.sendMessage(contactPhone, message, instanceName);
    await markSentToday(tenantId, contactPhone);

    await db.insert(dentalActivityTable).values({
      tenantId,
      type: "recovery_sent",
      description: `Mensagem de recuperação enviada (manual) para ${contactName}`,
      entityType: manualEntityType,
      entityId: manualEntityId,
      metadata: JSON.stringify({ manual: true, messagePreview: message.substring(0, 100) }),
    });

    logger.info({ tenantId, manualEntityType, manualEntityId }, "Manual recovery message sent");
    return;
  }

  const inactivePatients = await db.execute<{ id: number; name: string; phone: string }>(sql`
    SELECT id, name, phone FROM patients
    WHERE tenant_id = ${tenantId}
      AND (last_visit IS NULL OR last_visit < ${patientCutoff.toISOString()})
    LIMIT ${maxPerRun}
  `);

  const noShowLeads = await db.execute<{ id: number; name: string; phone: string }>(sql`
    SELECT DISTINCT dl.id, dl.name, dl.phone
    FROM dental_leads dl
    INNER JOIN appointments a ON a.lead_id = dl.id
    WHERE dl.tenant_id = ${tenantId}
      AND dl.status = 'active'
      AND a.status = 'no_show'
      AND a.starts_at < ${noShowCutoff.toISOString()}
    LIMIT ${maxPerRun}
  `);

  const allCandidates: Array<{ id: number; name: string; phone: string; entityType: "patient" | "lead" }> = [
    ...inactivePatients.rows.map((p) => ({ ...p, entityType: "patient" as const })),
    ...noShowLeads.rows.map((l) => ({ ...l, entityType: "lead" as const })),
  ];

  let sent = 0;
  for (const candidate of allCandidates) {
    if (sent >= maxPerRun) break;

    try {
      const recentActivity = await db.query.dentalActivityTable.findFirst({
        where: and(
          eq(dentalActivityTable.tenantId, tenantId),
          eq(dentalActivityTable.entityType, candidate.entityType),
          eq(dentalActivityTable.entityId, candidate.id),
          eq(dentalActivityTable.type, "recovery_sent"),
        ),
        orderBy: [desc(dentalActivityTable.createdAt)],
      });

      if (recentActivity && recentActivity.createdAt > recentlySentCutoff) continue;

      // Daily cap: skip if this contact already received an automated message today
      if (!await canSendToday(tenantId, candidate.phone)) {
        logger.info({ tenantId, entityType: candidate.entityType, entityId: candidate.id }, "Recovery deferred: daily cap reached for this contact");
        continue;
      }

      const message = await generateRecoveryMessage(
        tenantId,
        candidate.name,
        candidate.entityType === "patient" ? "inactive_patient" : "no_show_lead",
        aiInstructions
      );

      // Per-tenant daily cap of 80 automated messages
      if (!await tryConsumeDailyQuota(tenantId)) {
        logger.info({ tenantId, entityType: candidate.entityType, entityId: candidate.id, dailyLimit: DAILY_LIMIT_PER_TENANT }, "Recovery deferred: tenant daily cap reached");
        continue;
      }

      // 48h spacing: atomic reservation across workers; release on send failure
      if (!await tryReserveSend48h(tenantId, candidate.phone)) {
        await releaseDailyQuota(tenantId);
        logger.info({ tenantId, entityType: candidate.entityType, entityId: candidate.id }, "Recovery deferred: 48h spacing rule");
        continue;
      }

      try {
        const { provider, instanceName } = await getProviderForTenant(tenantId);
        await provider.sendMessage(candidate.phone, message, instanceName);
        await markSentToday(tenantId, candidate.phone);
      } catch (sendErr) {
        await releaseSend48h(tenantId, candidate.phone);
        await releaseDailyQuota(tenantId);
        throw sendErr;
      }

      // Anti-spam: random 8–20 s delay before next send (conservative)
      await sleepRandom(8000, 20000);

      await db.insert(dentalActivityTable).values({
        tenantId,
        type: "recovery_sent",
        description: `Mensagem de recuperação enviada para ${candidate.name}`,
        entityType: candidate.entityType,
        entityId: candidate.id,
        metadata: JSON.stringify({ messagePreview: message.substring(0, 100) }),
      });

      sent++;
      logger.info({ tenantId, entityType: candidate.entityType, entityId: candidate.id }, "Recovery message sent");
    } catch (err) {
      logger.error({ err, tenantId, entityType: candidate.entityType, entityId: candidate.id, phone: maskPhone(candidate.phone), name: maskName(candidate.name) }, "Recovery send failed");
    }
  }
}

async function processPatientRecovery() {
  const now = new Date();
  const currentHour = brasiliaHour();
  const currentDay = brasiliaDay();

  const allTenants = await db.query.tenantsTable.findMany();

  for (const tenant of allTenants) {
    try {
      const settings = await getCachedSettings(tenant.id);

      if (!settings || !settings.recoveryEnabled) continue;
      if (settings.automationsPaused || settings.recoveryPaused) {
        logger.info({ tenantId: tenant.id }, "Patient recovery skipped: automations paused");
        continue;
      }

      const allowedDays = (settings.recoveryDays || "1,2,3,4,5,6").split(",").map(Number);
      if (!allowedDays.includes(currentDay)) continue;

      const allowedHours = (settings.recoveryHours || "10,15").split(",").map(Number);
      if (!allowedHours.includes(currentHour)) continue;

      await processPatientRecoveryForTenant(tenant.id);
    } catch (err) {
      logger.error({ err, tenantId: tenant.id }, "Tenant recovery processing failed");
    }
  }
}

async function sendSubscriptionNotifications(
  tenantId: number,
  tenantEmail: string | null | undefined,
  telegramBotToken: string | null | undefined,
  telegramChatId: string | null | undefined,
  clinicName: string,
  event: "expiry_warning" | "suspended" | "reactivated" | "trial_warning",
  extra?: { daysLeft?: number; expiresAt?: Date }
): Promise<void> {
  const daysLeft = extra?.daysLeft ?? 0;
  const expiresAt = extra?.expiresAt ?? new Date();

  if (tenantEmail) {
    try {
      switch (event) {
        case "expiry_warning":
          await sendSubscriptionExpiryWarningEmail(tenantEmail, clinicName, daysLeft, expiresAt);
          break;
        case "suspended":
          await sendSubscriptionSuspendedEmail(tenantEmail, clinicName);
          break;
        case "reactivated":
          await sendSubscriptionReactivatedEmail(tenantEmail, clinicName);
          break;
        case "trial_warning":
          await sendTrialExpiryWarningEmail(tenantEmail, clinicName, daysLeft, expiresAt);
          break;
      }
    } catch (err) {
      logger.error({ err, tenantId, event }, "Subscription email notification failed");
    }
  }

  if (telegramBotToken && telegramChatId) {
    try {
      let message: string;
      switch (event) {
        case "expiry_warning":
          message = buildSubscriptionExpiryWarningMessage(clinicName, daysLeft, expiresAt);
          break;
        case "suspended":
          message = buildSubscriptionSuspendedMessage(clinicName);
          break;
        case "reactivated":
          message = buildSubscriptionReactivatedMessage(clinicName);
          break;
        case "trial_warning":
          message = buildTrialExpiryWarningMessage(clinicName, daysLeft, expiresAt);
          break;
      }
      await sendTelegramMessage(telegramBotToken, telegramChatId, message, "HTML");
    } catch (err) {
      logger.error({ err, tenantId, event }, "Subscription Telegram notification failed");
    }
  }
}

async function processSubscriptionNotifications(): Promise<void> {
  const now = new Date();
  const allTenants = await db.query.tenantsTable.findMany();

  for (const tenant of allTenants) {
    try {
      const settings = await getCachedSettings(tenant.id);
      const telegramBotToken = settings?.telegramBotToken ?? null;
      const telegramChatId = settings?.telegramChatId ?? null;
      const clinicName = settings?.clinicName ?? tenant.name;
      const email = tenant.email;

      const hasContact = email || (telegramBotToken && telegramChatId);
      if (!hasContact) continue;

      if (tenant.plan === "trial") {
        const trialStart = tenant.subscribedAt ?? tenant.createdAt;
        const trialEnd = tenant.subscriptionExpiresAt ?? new Date(trialStart.getTime() + 14 * 24 * 3600 * 1000);
        const msLeft = trialEnd.getTime() - now.getTime();
        // Use floor so the value is the number of full days remaining (0 = expires today)
        const daysLeft = Math.max(0, Math.floor(msLeft / (24 * 3600 * 1000)));

        // Exactly 7 days before: daysLeft in [7, 7] (tolerance: fires within the 7-day window before 3 days)
        if (daysLeft <= 7 && daysLeft > 1 && !tenant.trialNotif7DaySent) {
          await sendSubscriptionNotifications(tenant.id, email, telegramBotToken, telegramChatId, clinicName, "trial_warning", { daysLeft: 7, expiresAt: trialEnd });
          await db.update(tenantsTable).set({ trialNotif7DaySent: true }).where(eq(tenantsTable.id, tenant.id));
          logger.info({ tenantId: tenant.id, daysLeft }, "Trial 7-day warning sent");
        } else if (daysLeft <= 1 && !tenant.trialNotif1DaySent) {
          // Fires at 1 day or 0 days (today): always report "1 day" so the message is accurate
          await sendSubscriptionNotifications(tenant.id, email, telegramBotToken, telegramChatId, clinicName, "trial_warning", { daysLeft: Math.max(daysLeft, 1), expiresAt: trialEnd });
          await db.update(tenantsTable).set({ trialNotif1DaySent: true }).where(eq(tenantsTable.id, tenant.id));
          logger.info({ tenantId: tenant.id, daysLeft }, "Trial 1-day warning sent");
        }
        continue;
      }

      if (!tenant.subscriptionExpiresAt) continue;
      // Skip tenants that are already suspended (notified via route) or cancelled (no longer active)
      if (tenant.subscriptionStatus === "suspended" || tenant.subscriptionStatus === "cancelled") {
        // If a paid tenant is now overdue AND we haven't sent the suspension notice yet via scheduler, send it
        const daysOverdue = Math.floor((now.getTime() - tenant.subscriptionExpiresAt.getTime()) / (24 * 3600 * 1000));
        if (daysOverdue >= 0 && !tenant.subscriptionNotifSuspendedSent) {
          await sendSubscriptionNotifications(tenant.id, email, telegramBotToken, telegramChatId, clinicName, "suspended");
          await db.update(tenantsTable).set({ subscriptionNotifSuspendedSent: true }).where(eq(tenantsTable.id, tenant.id));
          logger.info({ tenantId: tenant.id, subscriptionStatus: tenant.subscriptionStatus }, "Subscription suspended notification sent via scheduler");
        }
        continue;
      }

      const msLeft = tenant.subscriptionExpiresAt.getTime() - now.getTime();
      const daysLeft = Math.max(0, Math.floor(msLeft / (24 * 3600 * 1000)));

      // 7-day window: fire once when daysLeft enters [4, 7] range
      if (daysLeft <= 7 && daysLeft > 3 && !tenant.subscriptionNotif7DaySent) {
        await sendSubscriptionNotifications(tenant.id, email, telegramBotToken, telegramChatId, clinicName, "expiry_warning", { daysLeft: 7, expiresAt: tenant.subscriptionExpiresAt });
        await db.update(tenantsTable).set({ subscriptionNotif7DaySent: true }).where(eq(tenantsTable.id, tenant.id));
        logger.info({ tenantId: tenant.id, daysLeft }, "Subscription 7-day warning sent");
      } else if (daysLeft <= 3 && daysLeft > 0 && !tenant.subscriptionNotif3DaySent) {
        // 3-day window: fire once when daysLeft enters [1, 3] range
        await sendSubscriptionNotifications(tenant.id, email, telegramBotToken, telegramChatId, clinicName, "expiry_warning", { daysLeft: 3, expiresAt: tenant.subscriptionExpiresAt });
        await db.update(tenantsTable).set({ subscriptionNotif3DaySent: true }).where(eq(tenantsTable.id, tenant.id));
        logger.info({ tenantId: tenant.id, daysLeft }, "Subscription 3-day warning sent");
      } else if (daysLeft === 0 && !tenant.subscriptionNotifDueDaySent) {
        // Due today: fire once on the expiry day
        await sendSubscriptionNotifications(tenant.id, email, telegramBotToken, telegramChatId, clinicName, "expiry_warning", { daysLeft: 0, expiresAt: tenant.subscriptionExpiresAt });
        await db.update(tenantsTable).set({ subscriptionNotifDueDaySent: true }).where(eq(tenantsTable.id, tenant.id));
        logger.info({ tenantId: tenant.id }, "Subscription due-day warning sent");
      }
    } catch (err) {
      logger.error({ err, tenantId: tenant.id }, "Subscription notification check failed for tenant");
    }
  }
}

export { sendSubscriptionNotifications };

async function checkWhatsappConnectionStatus(): Promise<void> {
  const allTenants = await db.query.tenantsTable.findMany();

  for (const tenant of allTenants) {
    try {
      if (!tenant.evolutionInstanceName) continue;

      const { provider, instanceName } = await getProviderForTenant(tenant.id);
      const result = await provider.getStatus(instanceName);

      const wasConnected = tenant.whatsappConnected === "true";
      const isConnected = result.connected;

      await db.update(tenantsTable)
        .set({ whatsappConnected: isConnected ? "true" : "false" })
        .where(eq(tenantsTable.id, tenant.id));

      if (wasConnected && !isConnected) {
        logger.warn({ tenantId: tenant.id, instanceName }, "WhatsApp disconnected — sending Telegram alert");

        const settings = await getCachedSettings(tenant.id);
        const telegramBotToken = settings?.telegramBotToken;
        const telegramChatId = settings?.telegramChatId;
        const clinicName = settings?.clinicName ?? tenant.name;

        if (telegramBotToken && telegramChatId) {
          try {
            const message = buildWhatsappDisconnectedMessage(clinicName);
            const result = await sendTelegramMessage(telegramBotToken, telegramChatId, message, "HTML");
            if (result.ok) {
              logger.info({ tenantId: tenant.id }, "WhatsApp disconnection alert sent via Telegram");
            } else {
              logger.warn({ tenantId: tenant.id, error: result.error }, "WhatsApp disconnection Telegram alert failed to deliver");
            }
          } catch (err) {
            logger.error({ err, tenantId: tenant.id }, "Failed to send WhatsApp disconnection Telegram alert");
          }
        }
      }
    } catch (err) {
      logger.warn({ err, tenantId: tenant.id }, "WhatsApp connection check failed for tenant");
    }
  }
}

/**
 * Deletes `merged_sibling` placeholder rows from `dental_messages` older than 7 days.
 * These rows are inserted by the dedup logic so the polling window (~24h) can
 * detect grouped sibling IDs, but they are no longer needed afterwards.
 * Returns the number of rows removed.
 */
export async function cleanupOldMergedSiblingPlaceholders(): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM dental_messages
    WHERE type = 'merged_sibling'
      AND created_at < NOW() - INTERVAL '7 days'
  `);
  const count = result.rowCount ?? 0;
  if (count > 0) {
    logger.info({ count }, "Old merged_sibling placeholders purged");
  }
  return count;
}

export function startScheduler() {
  ensureBirthdayTable().catch((err) => logger.error({ err }, "Birthday table init failed"));
  cron.schedule("* * * * *", async () => {
    await processFollowUps().catch((err) => logger.error({ err }, "Scheduler error: follow-ups"));
    await processExpiredTakeovers().catch((err) => logger.error({ err }, "Scheduler error: expired takeovers"));
  });

  cron.schedule("0 * * * *", async () => {
    await processLeadRemarketing().catch((err) => logger.error({ err }, "Scheduler error: remarketing"));
    await processBirthdayGreetings().catch((err) => logger.error({ err }, "Scheduler error: birthday greetings"));
    await processPatientRecovery().catch((err) => logger.error({ err }, "Scheduler error: patient recovery"));
  });

  cron.schedule("*/30 * * * *", async () => {
    const tenants = await db.select({ id: tenantsTable.id }).from(tenantsTable).where(eq(tenantsTable.subscriptionStatus, "active")).catch(() => []);
    for (const tenant of tenants) {
      await processHotLeadCalls(tenant.id).catch((err) => logger.error({ err, tenantId: tenant.id }, "Scheduler error: hot lead calls"));
      await processConfirmationCalls(tenant.id).catch((err) => logger.error({ err, tenantId: tenant.id }, "Scheduler error: confirmation calls"));
    }
  });

  cron.schedule("*/2 * * * *", async () => {
    await checkWhatsappConnectionStatus().catch((err) => logger.error({ err }, "Scheduler error: whatsapp connection check"));
    const healthResult = await runDeepHealthCheck().catch((err) => {
      logger.error({ err }, "Scheduler error: deep health check");
      return null;
    });
    if (healthResult) {
      await processHealthAlerts(healthResult).catch((err) => logger.error({ err }, "Scheduler error: health alerts"));
    }
  });

  cron.schedule("0 9 * * *", async () => {
    await processSubscriptionNotifications().catch((err) => logger.error({ err }, "Scheduler error: subscription notifications"));
  });

  cron.schedule("0 0 1 * *", async () => {
    const count = await resetAllMonthlyQuotas().catch((err) => {
      logger.error({ err }, "Scheduler error: monthly audio quota reset");
      return 0;
    });
    logger.info({ count }, "Monthly audio quota reset completed");

    const convCount = await resetAllMonthlyConversationQuotas().catch((err) => {
      logger.error({ err }, "Scheduler error: monthly conversation quota reset");
      return 0;
    });
    logger.info({ convCount }, "Monthly conversation quotas reset completed");
  });

  cron.schedule("30 3 * * *", async () => {
    await cleanupOldMergedSiblingPlaceholders().catch((err) =>
      logger.error({ err }, "Scheduler error: merged_sibling cleanup"),
    );
  });

  // Task #12: auditoria diária de termos de venda em conversas reais de
  // convênio. Roda na madrugada (4h30 Brasília — UTC 7h30) cobrindo as
  // mensagens da última 24h. Alerta via Telegram quando a taxa de
  // violações por tenant supera o limiar configurado.
  cron.schedule("30 7 * * *", async () => {
    await runInsuranceAuditJob({ sinceDays: 1 }).catch((err) =>
      logger.error({ err }, "Scheduler error: insurance audit"),
    );
  });

  // Task #15 — alerta diário de agendamentos não confirmados.
  // Roda de hora em hora; cada tenant é avaliado contra sua hora local
  // configurada (default 18h, fuso default UTC-3 / Brasília).
  cron.schedule("0 * * * *", async () => {
    await runUnconfirmedAppointmentsJob().catch((err) =>
      logger.error({ err }, "Scheduler error: unconfirmed appointments alert"),
    );
  });

  // Task #22 — apply scheduled plan downgrades when subscriptionExpiresAt passes.
  // Runs every 15 min so the swap happens close to the renewal date.
  cron.schedule("*/15 * * * *", async () => {
    await applyDueScheduledDowngrades().catch((err) =>
      logger.error({ err }, "Scheduler error: scheduled plan downgrade"),
    );
  });

  logger.info("Scheduler started: follow-ups + takeover auto-resume (every minute), whatsapp connection check + deep health check + Telegram alerts (every 2 min), lead remarketing + birthday greetings + patient recovery (hourly), AI calls — hot leads + confirmations (every 30 min), subscription notifications (daily at 9h), merged_sibling placeholder cleanup (daily at 3h30), insurance sales-terms audit (daily at 4h30 Brasília), monthly audio quota reset (1st of month)");
}
