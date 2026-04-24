import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { callLogsTable, dentalSettingsTable, dentalLeadsTable, patientsTable } from "@workspace/db";
import { eq, and, like } from "drizzle-orm";
import { logger } from "../../lib/logger";
import {
  parseVapiWebhook,
  VapiWebhookPayload,
  buildInboundAssistantConfig,
  normalizeCallerPhone,
} from "../../lib/vapi";
import { getDefaultCartesiaVoiceId } from "../../lib/cartesia";

const router = Router();

/**
 * Look up the tenant whose inbound number matches. We deliberately match ONLY
 * the explicit inbound column to avoid two tenants colliding because of the
 * outbound phoneNumberId. If a tenant wants to share one number for both
 * directions, they set the same value into both columns from the UI.
 */
async function findTenantByInboundPhoneNumberId(phoneNumberId: string) {
  if (!phoneNumberId) return null;
  const rows = await db
    .select()
    .from(dentalSettingsTable)
    .where(eq(dentalSettingsTable.vapiInboundPhoneNumberId, phoneNumberId))
    .limit(2);
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    logger.error(
      { phoneNumberId, tenants: rows.map((r) => r.tenantId) },
      "Multiple tenants share the same inbound Vapi phoneNumberId — refusing to route",
    );
    return null;
  }
  return rows[0];
}

async function linkOrCreateLead(tenantId: number, rawPhone: string): Promise<{ leadId: number | null; patientId: number | null }> {
  const digits = normalizeCallerPhone(rawPhone);
  if (!digits) return { leadId: null, patientId: null };
  const tail = digits.slice(-9);

  // Try existing patient first
  const [patient] = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(and(eq(patientsTable.tenantId, tenantId), like(patientsTable.phone, `%${tail}%`)))
    .limit(1);
  if (patient) return { leadId: null, patientId: patient.id };

  // Try existing lead
  const [lead] = await db
    .select({ id: dentalLeadsTable.id })
    .from(dentalLeadsTable)
    .where(and(eq(dentalLeadsTable.tenantId, tenantId), like(dentalLeadsTable.phone, `%${tail}%`)))
    .limit(1);
  if (lead) return { leadId: lead.id, patientId: null };

  // Create new lead with origin "inbound_call"
  try {
    const [newLead] = await db.insert(dentalLeadsTable).values({
      tenantId,
      name: `Ligação recebida ${rawPhone}`,
      phone: rawPhone,
      source: "inbound_call",
      temperature: "warm",
      status: "active",
    }).returning({ id: dentalLeadsTable.id });
    return { leadId: newLead?.id ?? null, patientId: null };
  } catch (err) {
    logger.warn({ err, tenantId, rawPhone }, "Failed to create inbound lead");
    return { leadId: null, patientId: null };
  }
}

router.post("/vapi", async (req: Request, res: Response) => {
  try {
    // Optional shared-secret check. If VAPI_WEBHOOK_SECRET is set, require it.
    const expectedSecret = process.env.VAPI_WEBHOOK_SECRET;
    if (expectedSecret) {
      const got = req.headers["x-vapi-secret"] || req.headers["x-vapi-signature"];
      if (got !== expectedSecret) {
        logger.warn("Vapi webhook rejected — invalid secret");
        res.status(401).json({ ok: false });
        return;
      }
    }

    const payload = req.body as VapiWebhookPayload;
    const parsed = parseVapiWebhook(payload);

    logger.info(
      { type: parsed.type, callId: parsed.callId, isInbound: parsed.isInbound, phoneNumberId: parsed.phoneNumberId },
      "Vapi webhook received",
    );

    // ── 1. assistant-request: Vapi asks us which assistant to use for this inbound call.
    if (parsed.type === "assistant-request") {
      const settings = parsed.phoneNumberId
        ? await findTenantByInboundPhoneNumberId(parsed.phoneNumberId)
        : null;

      if (!settings) {
        logger.warn({ phoneNumberId: parsed.phoneNumberId }, "assistant-request: no tenant matched");
        res.status(404).json({ error: "phone number not configured" });
        return;
      }

      if (!settings.inboundCallsEnabled) {
        logger.info(
          { tenantId: settings.tenantId, phoneNumberId: parsed.phoneNumberId },
          "assistant-request: inbound calls disabled for tenant",
        );
        res.status(403).json({ error: "inbound calls disabled" });
        return;
      }

      // If a clinic explicitly set a Vapi assistant ID for inbound, defer to it.
      if (settings.vapiInboundAssistantId) {
        res.status(200).json({ assistantId: settings.vapiInboundAssistantId });
        return;
      }

      const voiceId =
        settings.callVoiceId || settings.cartesiaVoiceId || getDefaultCartesiaVoiceId();

      res.status(200).json({
        assistant: buildInboundAssistantConfig({
          clinicName: settings.clinicName || "nossa clínica",
          aiName: settings.aiName || "Secretária",
          voiceId,
        }),
      });
      return;
    }

    if (!parsed.callId) {
      res.status(200).json({ ok: true });
      return;
    }

    const [existing] = await db
      .select()
      .from(callLogsTable)
      .where(eq(callLogsTable.vapiCallId, parsed.callId));

    // ── 2. Inbound call-started: create the call_logs row if we don't have one yet.
    if (!existing && parsed.isInbound && parsed.phoneNumberId && parsed.phone) {
      const settings = await findTenantByInboundPhoneNumberId(parsed.phoneNumberId);
      if (!settings) {
        logger.warn(
          { phoneNumberId: parsed.phoneNumberId, callId: parsed.callId },
          "Inbound call without matching tenant — ignoring",
        );
        res.status(200).json({ ok: true });
        return;
      }
      if (!settings.inboundCallsEnabled) {
        logger.info(
          { tenantId: settings.tenantId, callId: parsed.callId },
          "Inbound call event ignored — inbound disabled",
        );
        res.status(200).json({ ok: true });
        return;
      }

      const { leadId, patientId } = await linkOrCreateLead(settings.tenantId, parsed.phone);

      await db.insert(callLogsTable).values({
        tenantId: settings.tenantId,
        leadId,
        patientId,
        vapiCallId: parsed.callId,
        phone: parsed.phone,
        direction: "inbound",
        status: parsed.type === "call-started" ? "in_progress" : "ringing",
        trigger: "inbound",
        startedAt: parsed.startedAt || new Date(),
      });

      logger.info(
        { tenantId: settings.tenantId, callId: parsed.callId, phone: parsed.phone, leadId, patientId },
        "Inbound call registered",
      );

      // For call-ended events that arrive before any call-started (rare), fall through to
      // the update path below.
      if (parsed.type !== "call-ended" && parsed.type !== "end-of-call-report" && parsed.type !== "call-failed") {
        res.status(200).json({ ok: true });
        return;
      }
    }

    if (!existing && !parsed.isInbound) {
      res.status(200).json({ ok: true });
      return;
    }

    // Re-read so updates below have the row id.
    const [row] = existing
      ? [existing]
      : await db.select().from(callLogsTable).where(eq(callLogsTable.vapiCallId, parsed.callId));

    if (!row) {
      res.status(200).json({ ok: true });
      return;
    }

    if (parsed.type === "call-started") {
      await db.update(callLogsTable)
        .set({
          status: "in_progress",
          startedAt: parsed.startedAt || new Date(),
        })
        .where(eq(callLogsTable.id, row.id));
    }

    if (parsed.type === "call-ended" || parsed.type === "end-of-call-report") {
      const outcome = determineOutcome(parsed.endedReason);

      await db.update(callLogsTable)
        .set({
          status: "completed",
          endedAt: parsed.endedAt || new Date(),
          duration: parsed.duration ? Math.round(parsed.duration) : null,
          transcript: parsed.transcript || null,
          summary: parsed.summary || null,
          recordingUrl: parsed.recordingUrl || null,
          endedReason: parsed.endedReason || null,
          cost: parsed.cost || null,
          outcome,
          answeredByHuman: parsed.endedReason !== "voicemail" && parsed.endedReason !== "no-answer",
        })
        .where(eq(callLogsTable.id, row.id));

      logger.info({
        callId: parsed.callId,
        tenantId: row.tenantId,
        direction: row.direction,
        duration: parsed.duration,
        outcome,
        endedReason: parsed.endedReason,
      }, "Call completed");
    }

    if (parsed.type === "call-failed" || parsed.type === "hang") {
      await db.update(callLogsTable)
        .set({
          status: "failed",
          endedAt: new Date(),
          endedReason: parsed.endedReason || "failed",
        })
        .where(eq(callLogsTable.id, row.id));
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Error processing Vapi webhook");
    res.status(200).json({ ok: true });
  }
});

function determineOutcome(endedReason?: string): string {
  if (!endedReason) return "unknown";
  if (endedReason === "customer-ended-call") return "completed";
  if (endedReason === "assistant-ended-call") return "completed";
  if (endedReason === "voicemail") return "voicemail";
  if (endedReason === "no-answer") return "no_answer";
  if (endedReason === "busy") return "busy";
  if (endedReason === "failed") return "failed";
  return endedReason;
}

export default router;
