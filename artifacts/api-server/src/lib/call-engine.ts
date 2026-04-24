import { db } from "@workspace/db";
import {
  callLogsTable,
  dentalLeadsTable,
  patientsTable,
  appointmentsTable,
  dentalSettingsTable,
  tenantsTable,
} from "@workspace/db";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { getCachedSettings } from "./cache";
import { initiateOutboundCall, buildDentalAssistantOverrides, resolveVapiKey } from "./vapi";
import { logger } from "./logger";

export type CallTrigger = "hot_lead_followup" | "appointment_confirmation" | "patient_recovery";

/** Returns hour and minute in Brasília time (UTC-3) */
function brasiliaTimeNow(): { hour: number; minute: number } {
  const now = new Date();
  const brasiliaMs = now.getTime() - 3 * 3600 * 1000;
  const bDate = new Date(brasiliaMs);
  return { hour: bDate.getUTCHours(), minute: bDate.getUTCMinutes() };
}

function isWithinCallWindow(windowStart: string, windowEnd: string): boolean {
  const { hour, minute } = brasiliaTimeNow();
  const current = hour * 60 + minute;

  const [startH, startM] = windowStart.split(":").map(Number);
  const [endH, endM] = windowEnd.split(":").map(Number);
  const start = startH * 60 + (startM || 0);
  const end = endH * 60 + (endM || 0);

  return current >= start && current < end;
}

async function countCallsToday(tenantId: number): Promise<number> {
  // Use start of today in Brasília time
  const now = new Date();
  const brasiliaMs = now.getTime() - 3 * 3600 * 1000;
  const brasiliaDate = new Date(brasiliaMs);
  const todayStr = brasiliaDate.toISOString().slice(0, 10);
  const today = new Date(todayStr + "T03:00:00.000Z"); // midnight Brasília = 03:00 UTC

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(callLogsTable)
    .where(
      and(
        eq(callLogsTable.tenantId, tenantId),
        gte(callLogsTable.createdAt, today)
      )
    );

  return Number(result[0]?.count ?? 0);
}

async function wasCalledRecently(tenantId: number, phone: string, hours: number): Promise<boolean> {
  const since = new Date(Date.now() - hours * 3600 * 1000);
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(callLogsTable)
    .where(
      and(
        eq(callLogsTable.tenantId, tenantId),
        eq(callLogsTable.phone, phone),
        gte(callLogsTable.createdAt, since)
      )
    );
  return Number(result[0]?.count ?? 0) > 0;
}

export async function triggerCall(params: {
  tenantId: number;
  phone: string;
  trigger: CallTrigger;
  leadId?: number;
  patientId?: number;
  patientName?: string;
  appointmentDate?: string;
  procedure?: string;
}): Promise<{ callId: string | null; error?: string }> {
  const { tenantId, phone, trigger, leadId, patientId, patientName, appointmentDate, procedure } = params;

  const settings = await getCachedSettings(tenantId);

  if (!settings?.callsEnabled) {
    return { callId: null, error: "calls_disabled" };
  }

  const vapiKey = resolveVapiKey(settings.vapiApiKey);
  if (!vapiKey || !settings.vapiPhoneNumberId) {
    return { callId: null, error: "vapi_not_configured" };
  }

  if (!isWithinCallWindow(settings.callWindowStart, settings.callWindowEnd)) {
    return { callId: null, error: "outside_call_window" };
  }

  const callsToday = await countCallsToday(tenantId);
  if (callsToday >= settings.callMaxPerDay) {
    return { callId: null, error: "daily_limit_reached" };
  }

  const alreadyCalled = await wasCalledRecently(
    tenantId,
    phone,
    settings.callIntervalHoursAfterWhatsapp
  );
  if (alreadyCalled) {
    return { callId: null, error: "recently_called" };
  }

  const assistantOverrides = buildDentalAssistantOverrides({
    clinicName: settings.clinicName || "nossa clínica",
    aiName: settings.aiName || "Secretária",
    patientName,
    trigger,
    appointmentDate,
    procedure,
    voiceId: settings.callVoiceId || settings.cartesiaVoiceId || null,
  });

  const [logEntry] = await db.insert(callLogsTable).values({
    tenantId,
    leadId: leadId ?? null,
    patientId: patientId ?? null,
    phone,
    direction: "outbound",
    status: "initiated",
    trigger,
  }).returning();

  try {
    const callResponse = await initiateOutboundCall(vapiKey, {
      phoneNumberId: settings.vapiPhoneNumberId,
      phone,
      assistantId: settings.vapiAssistantId || undefined,
      assistantOverrides,
      metadata: {
        tenantId: String(tenantId),
        callLogId: String(logEntry.id),
        trigger,
      },
    });

    await db.update(callLogsTable)
      .set({ vapiCallId: callResponse.id, status: "ringing" })
      .where(eq(callLogsTable.id, logEntry.id));

    logger.info({ tenantId, callId: callResponse.id, trigger, phone }, "Outbound call initiated");

    return { callId: callResponse.id };
  } catch (err) {
    await db.update(callLogsTable)
      .set({ status: "failed" })
      .where(eq(callLogsTable.id, logEntry.id));

    logger.error({ err, tenantId, phone, trigger }, "Failed to initiate call");
    return { callId: null, error: "vapi_error" };
  }
}

export async function processHotLeadCalls(tenantId: number): Promise<void> {
  const settings = await getCachedSettings(tenantId);
  if (!settings?.callsEnabled || !settings?.callTriggerHotLead) return;

  const intervalMs = settings.callIntervalHoursAfterWhatsapp * 3600 * 1000;
  const since = new Date(Date.now() - intervalMs);

  const hotLeads = await db
    .select()
    .from(dentalLeadsTable)
    .where(
      and(
        eq(dentalLeadsTable.tenantId, tenantId),
        eq(dentalLeadsTable.temperature, "hot"),
        eq(dentalLeadsTable.status, "active"),
        lte(dentalLeadsTable.lastContactAt, since)
      )
    )
    .limit(3);

  for (const lead of hotLeads) {
    const result = await triggerCall({
      tenantId,
      phone: lead.phone,
      trigger: "hot_lead_followup",
      leadId: lead.id,
      patientName: lead.name || undefined,
    });

    if (result.callId) {
      logger.info({ tenantId, leadId: lead.id, callId: result.callId }, "Call initiated for hot lead");
    }
  }
}

export async function processConfirmationCalls(tenantId: number): Promise<void> {
  const settings = await getCachedSettings(tenantId);
  if (!settings?.callsEnabled || !settings?.callTriggerConfirmation) return;

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const dayAfter = new Date(tomorrow);
  dayAfter.setDate(dayAfter.getDate() + 1);

  const appointments = await db
    .select({
      id: appointmentsTable.id,
      patientId: appointmentsTable.patientId,
      scheduledAt: appointmentsTable.scheduledAt,
      phone: patientsTable.phone,
      name: patientsTable.name,
    })
    .from(appointmentsTable)
    .leftJoin(patientsTable, eq(appointmentsTable.patientId, patientsTable.id))
    .where(
      and(
        eq(appointmentsTable.tenantId, tenantId),
        eq(appointmentsTable.status, "scheduled"),
        gte(appointmentsTable.scheduledAt, tomorrow),
        lte(appointmentsTable.scheduledAt, dayAfter)
      )
    )
    .limit(5);

  for (const appt of appointments) {
    if (!appt.phone) continue;

    const dateStr = appt.scheduledAt
      ? new Date(appt.scheduledAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      : undefined;

    await triggerCall({
      tenantId,
      phone: appt.phone,
      trigger: "appointment_confirmation",
      patientId: appt.patientId ?? undefined,
      patientName: appt.name ?? undefined,
      appointmentDate: dateStr,
    });
  }
}
