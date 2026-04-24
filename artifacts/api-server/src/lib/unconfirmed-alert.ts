/**
 * Task #15 — Alerta diário de agendamentos não confirmados.
 *
 * Job:
 *  - Roda a cada hora (cron 0 * * * *).
 *  - Para cada tenant ativo, verifica se a hora local (tenant_tz_offset_hours)
 *    bate com `unconfirmed_alert_hour` configurado (default 18).
 *  - Conta agendamentos do dia seguinte (no fuso da clínica) com `confirmed='false'`
 *    e status ainda agendável (não cancelados/no_show/realizados).
 *  - Se há pendências e o tenant tem Telegram configurado, envia mensagem.
 *  - Em todos os casos com pendências (com ou sem Telegram), grava em
 *    `dental_activity` o tipo `unconfirmed_appointments_alert` com a lista de
 *    agendamentos no metadata — serve como prova jurídica de que o dentista
 *    foi avisado.
 *  - Dedup por dia: não dispara duas vezes para o mesmo (tenant, alvo).
 */

import { db } from "@workspace/db";
import {
  appointmentsTable,
  dentalActivityTable,
  dentalSettingsTable,
  tenantsTable,
  patientsTable,
  dentalLeadsTable,
  dentalProfessionalsTable,
} from "@workspace/db";
import { and, eq, gte, lt, sql, ne, inArray, desc } from "drizzle-orm";
import { logger } from "./logger";
import { sendTelegramMessage, escapeHtml } from "./telegram";
import { maskPhone } from "./pii-mask";

interface UnconfirmedItem {
  appointmentId: number;
  patientName: string;
  professionalName: string | null;
  startsAtIso: string;
  startsAtLocal: string;
  contactPhone: string | null;
}

function utcDateRangeForTenantTomorrow(offsetHours: number): { fromUtc: Date; toUtc: Date; targetDateStr: string } {
  const nowMs = Date.now();
  const localNow = new Date(nowMs + offsetHours * 3600_000);
  // tomorrow in tenant local. Date.UTC normalizes overflow (day=32 → next month),
  // but we re-read the resulting Date so the formatted YYYY-MM-DD string is also
  // normalized — avoids labels like "2026-04-31".
  const y = localNow.getUTCFullYear();
  const m = localNow.getUTCMonth();
  const d = localNow.getUTCDate() + 1;
  const localStartMs = Date.UTC(y, m, d, 0, 0, 0);
  // upper bound EXCLUSIVE: dia seguinte 00:00:00 (não 23:59:59), evita perder
  // agendamentos no último segundo/fração quando combinado com lt(...).
  const localEndMs = Date.UTC(y, m, d + 1, 0, 0, 0);
  const normalized = new Date(localStartMs);
  const ny = normalized.getUTCFullYear();
  const nm = normalized.getUTCMonth() + 1;
  const nd = normalized.getUTCDate();
  const fromUtc = new Date(localStartMs - offsetHours * 3600_000);
  const toUtc = new Date(localEndMs - offsetHours * 3600_000);
  const targetDateStr = `${ny.toString().padStart(4, "0")}-${nm.toString().padStart(2, "0")}-${nd.toString().padStart(2, "0")}`;
  return { fromUtc, toUtc, targetDateStr };
}

export async function gatherUnconfirmedForTenant(
  tenantId: number,
  offsetHours: number,
): Promise<{ items: UnconfirmedItem[]; targetDate: string }> {
  const { fromUtc, toUtc, targetDateStr } = utcDateRangeForTenantTomorrow(offsetHours);

  const rows = await db
    .select({
      id: appointmentsTable.id,
      startsAt: appointmentsTable.startsAt,
      patientName: patientsTable.name,
      leadName: dentalLeadsTable.name,
      patientPhone: patientsTable.phone,
      leadPhone: dentalLeadsTable.phone,
      professionalName: dentalProfessionalsTable.name,
    })
    .from(appointmentsTable)
    .leftJoin(patientsTable, eq(patientsTable.id, appointmentsTable.patientId))
    .leftJoin(dentalLeadsTable, eq(dentalLeadsTable.id, appointmentsTable.leadId))
    .leftJoin(dentalProfessionalsTable, eq(dentalProfessionalsTable.id, appointmentsTable.professionalId))
    .where(
      and(
        eq(appointmentsTable.tenantId, tenantId),
        gte(appointmentsTable.startsAt, fromUtc),
        lt(appointmentsTable.startsAt, toUtc),
        eq(appointmentsTable.confirmed, "false"),
        ne(appointmentsTable.status, "cancelled"),
        ne(appointmentsTable.status, "no_show"),
        ne(appointmentsTable.status, "completed"),
      ),
    );

  const items: UnconfirmedItem[] = rows.map((r) => {
    const localMs = r.startsAt.getTime() + offsetHours * 3600_000;
    const localDate = new Date(localMs);
    const hh = localDate.getUTCHours().toString().padStart(2, "0");
    const mm = localDate.getUTCMinutes().toString().padStart(2, "0");
    return {
      appointmentId: r.id,
      patientName: r.patientName ?? r.leadName ?? "(sem nome)",
      professionalName: r.professionalName,
      startsAtIso: r.startsAt.toISOString(),
      startsAtLocal: `${hh}:${mm}`,
      contactPhone: r.patientPhone ?? r.leadPhone ?? null,
    };
  });

  return { items, targetDate: targetDateStr };
}

function buildTelegramMessage(
  clinicName: string | null,
  items: UnconfirmedItem[],
  targetDate: string,
): string {
  const head = clinicName ? `🏥 <b>${escapeHtml(clinicName)}</b>\n\n` : "";
  const lines = items
    .slice(0, 30)
    .map((it) => {
      const phone = it.contactPhone ? ` — ${escapeHtml(maskPhone(it.contactPhone))}` : "";
      const prof = it.professionalName ? ` (${escapeHtml(it.professionalName)})` : "";
      return `• <b>${escapeHtml(it.startsAtLocal)}</b> — ${escapeHtml(it.patientName)}${prof}${phone}`;
    })
    .join("\n");
  const more = items.length > 30 ? `\n\n…e mais ${items.length - 30} agendamento(s).` : "";
  return (
    `⚠️ <b>Agendamentos NÃO confirmados pela IA — amanhã (${targetDate})</b>\n\n` +
    head +
    `Total pendente: <b>${items.length}</b>\n\n` +
    lines +
    more +
    `\n\nRevise no painel e confirme manualmente os pacientes.`
  );
}

export interface AlertJobResult {
  tenantId: number;
  triggered: boolean;
  reason?: string;
  itemCount?: number;
  telegramSent?: boolean;
}

async function alreadyAlertedToday(tenantId: number, targetDate: string): Promise<boolean> {
  // Look back 30h for a matching alert for this targetDate
  const since = new Date(Date.now() - 30 * 3600_000);
  const found = await db
    .select({ id: dentalActivityTable.id })
    .from(dentalActivityTable)
    .where(
      and(
        eq(dentalActivityTable.tenantId, tenantId),
        eq(dentalActivityTable.type, "unconfirmed_appointments_alert"),
        gte(dentalActivityTable.createdAt, since),
        sql`${dentalActivityTable.metadata} LIKE ${"%\"targetDate\":\"" + targetDate + "\"%"}`,
      ),
    )
    .limit(1);
  return found.length > 0;
}

export async function runUnconfirmedAppointmentsJob(opts: { force?: boolean; tenantId?: number } = {}): Promise<AlertJobResult[]> {
  const tenants = opts.tenantId
    ? await db.select({ id: tenantsTable.id }).from(tenantsTable).where(eq(tenantsTable.id, opts.tenantId))
    : await db.select({ id: tenantsTable.id }).from(tenantsTable).where(eq(tenantsTable.subscriptionStatus, "active"));

  const out: AlertJobResult[] = [];
  const nowUtcHour = new Date().getUTCHours();

  for (const t of tenants) {
    try {
      const settings = await db.query.dentalSettingsTable.findFirst({
        where: eq(dentalSettingsTable.tenantId, t.id),
      });
      if (!settings) {
        out.push({ tenantId: t.id, triggered: false, reason: "no_settings" });
        continue;
      }
      if (!settings.unconfirmedAlertEnabled) {
        out.push({ tenantId: t.id, triggered: false, reason: "disabled" });
        continue;
      }
      const offset = settings.tenantTzOffsetHours ?? -3;
      const localHour = (((nowUtcHour + offset) % 24) + 24) % 24;
      if (!opts.force && localHour !== settings.unconfirmedAlertHour) {
        out.push({ tenantId: t.id, triggered: false, reason: "wrong_hour" });
        continue;
      }

      const { items, targetDate } = await gatherUnconfirmedForTenant(t.id, offset);
      if (items.length === 0) {
        out.push({ tenantId: t.id, triggered: false, reason: "no_pending" });
        continue;
      }
      if (!opts.force && (await alreadyAlertedToday(t.id, targetDate))) {
        out.push({ tenantId: t.id, triggered: false, reason: "already_alerted" });
        continue;
      }

      let telegramSent = false;
      if (settings.telegramBotToken && settings.telegramChatId && settings.telegramEscalationEnabled) {
        const msg = buildTelegramMessage(settings.clinicName, items, targetDate);
        const r = await sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, msg);
        telegramSent = r.ok;
        if (!r.ok) {
          logger.warn({ tenantId: t.id, error: r.error }, "Unconfirmed alert: Telegram delivery failed");
        }
      }

      // Always persist the activity (proof of dashboard alert + Telegram attempt)
      await db.insert(dentalActivityTable).values({
        tenantId: t.id,
        type: "unconfirmed_appointments_alert",
        description: `Alerta diário: ${items.length} agendamento(s) sem confirmação para ${targetDate}.`,
        entityType: "system",
        entityId: null,
        metadata: JSON.stringify({
          targetDate,
          itemCount: items.length,
          telegramSent,
          handled: false,
          items: items.slice(0, 100),
        }),
      });

      out.push({ tenantId: t.id, triggered: true, itemCount: items.length, telegramSent });
      logger.info({ tenantId: t.id, items: items.length, telegramSent }, "Unconfirmed appointments alert dispatched");
    } catch (err) {
      logger.error({ err, tenantId: t.id }, "Unconfirmed appointments alert failed for tenant");
      out.push({ tenantId: t.id, triggered: false, reason: "error" });
    }
  }
  return out;
}

/** Marks a previously-emitted alert as "handled" by the dentist (for audit). */
export async function markAlertHandled(tenantId: number, activityId: number): Promise<boolean> {
  const row = await db.query.dentalActivityTable.findFirst({
    where: and(
      eq(dentalActivityTable.id, activityId),
      eq(dentalActivityTable.tenantId, tenantId),
      eq(dentalActivityTable.type, "unconfirmed_appointments_alert"),
    ),
  });
  if (!row) return false;
  let meta: Record<string, unknown> = {};
  try { meta = row.metadata ? JSON.parse(row.metadata) : {}; } catch { meta = {}; }
  meta.handled = true;
  meta.handledAt = new Date().toISOString();
  await db
    .update(dentalActivityTable)
    .set({ metadata: JSON.stringify(meta) })
    .where(eq(dentalActivityTable.id, activityId));

  await db.insert(dentalActivityTable).values({
    tenantId,
    type: "unconfirmed_alert_acknowledged",
    description: `Dentista marcou alerta #${activityId} como tratado.`,
    entityType: "activity",
    entityId: activityId,
    metadata: JSON.stringify({ originalAlertId: activityId, ackAt: new Date().toISOString() }),
  });
  return true;
}

/** Returns the most recent un-handled alert for a tenant (for dashboard card). */
export async function getLatestUnconfirmedAlert(tenantId: number): Promise<{
  id: number;
  createdAt: Date;
  targetDate: string;
  itemCount: number;
  items: UnconfirmedItem[];
  handled: boolean;
} | null> {
  const since = new Date(Date.now() - 36 * 3600_000);
  const row = await db
    .select()
    .from(dentalActivityTable)
    .where(
      and(
        eq(dentalActivityTable.tenantId, tenantId),
        eq(dentalActivityTable.type, "unconfirmed_appointments_alert"),
        gte(dentalActivityTable.createdAt, since),
      ),
    )
    .orderBy(desc(dentalActivityTable.createdAt))
    .limit(1);
  if (row.length === 0) return null;
  const r = row[0];
  let meta: { targetDate?: string; itemCount?: number; items?: UnconfirmedItem[]; handled?: boolean } = {};
  try { meta = r.metadata ? JSON.parse(r.metadata) : {}; } catch { meta = {}; }
  return {
    id: r.id,
    createdAt: r.createdAt,
    targetDate: meta.targetDate ?? "",
    itemCount: meta.itemCount ?? 0,
    items: meta.items ?? [],
    handled: !!meta.handled,
  };
}
