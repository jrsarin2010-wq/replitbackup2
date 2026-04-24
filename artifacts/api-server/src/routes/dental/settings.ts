import { Router } from "express";
import { db } from "@workspace/db";
import { dentalSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { tenantMiddleware } from "../../middlewares/tenant";
import { UpdateSettingsBody } from "@workspace/api-zod";
import { settingsCache, getCachedSettings } from "../../lib/cache";
import { invalidateOpenAIClient } from "../../lib/openai-client";
import { encryptIfNeeded, decryptIfNeeded, hasEncryptionKey } from "../../lib/encryption";

const router = Router();
router.use(tenantMiddleware);

function maskSensitiveKey(rawValue: string | null | undefined): string | null {
  if (!rawValue) return null;
  const plain = hasEncryptionKey() ? (decryptIfNeeded(rawValue) ?? rawValue) : rawValue;
  return "••••••" + plain.slice(-6);
}

router.get("/", async (req, res) => {
  const settings = await getCachedSettings(req.tenantId);

  if (!settings) {
    const [created] = await db.insert(dentalSettingsTable).values({ tenantId: req.tenantId }).returning();
    const { telegramBotToken, vapiApiKey, ...safe } = created;
    res.json({
      ...safe,
      telegramBotToken: maskSensitiveKey(telegramBotToken),
      vapiApiKey: maskSensitiveKey(vapiApiKey),
    });
    return;
  }

  const { telegramBotToken, vapiApiKey, ...safe } = settings;
  res.json({
    ...safe,
    telegramBotToken: maskSensitiveKey(telegramBotToken),
    vapiApiKey: maskSensitiveKey(vapiApiKey),
  });
});

router.put("/", async (req, res) => {
  // vapiApiKey is not in the generated Zod schema (handled out-of-band), but we
  // still read it from the raw body so it can be encrypted and persisted if present.
  const body = {
    ...UpdateSettingsBody.parse(req.body),
    ...(req.body?.vapiApiKey !== undefined && { vapiApiKey: req.body.vapiApiKey as string | null }),
    // Task #15 — campos de configuração do alerta diário de não confirmados.
    // Lidos out-of-band (não estão no Zod gerado) e validados manualmente.
    ...(typeof req.body?.unconfirmedAlertEnabled === "boolean" && {
      unconfirmedAlertEnabled: req.body.unconfirmedAlertEnabled as boolean,
    }),
    // Task #14 — inbound calls + Cartesia voice config (out-of-band).
    ...(req.body?.vapiInboundPhoneNumberId !== undefined && {
      vapiInboundPhoneNumberId: req.body.vapiInboundPhoneNumberId as string | null,
    }),
    ...(req.body?.vapiInboundAssistantId !== undefined && {
      vapiInboundAssistantId: req.body.vapiInboundAssistantId as string | null,
    }),
    ...(typeof req.body?.inboundCallsEnabled === "boolean" && {
      inboundCallsEnabled: req.body.inboundCallsEnabled as boolean,
    }),
    ...(req.body?.callVoiceId !== undefined && {
      callVoiceId: req.body.callVoiceId as string | null,
    }),
    ...(Number.isInteger(req.body?.unconfirmedAlertHour) &&
      req.body.unconfirmedAlertHour >= 0 &&
      req.body.unconfirmedAlertHour <= 23 && {
        unconfirmedAlertHour: req.body.unconfirmedAlertHour as number,
      }),
    ...(Number.isInteger(req.body?.tenantTzOffsetHours) &&
      req.body.tenantTzOffsetHours >= -12 &&
      req.body.tenantTzOffsetHours <= 14 && {
        tenantTzOffsetHours: req.body.tenantTzOffsetHours as number,
      }),
  };

  // Fields removed from Clínica tab — now owned exclusively by the professionals table.
  // Strip all of them from incoming payloads so legacy clients can't overwrite DB values.
  // The prompt-builder still reads existing DB values as fallbacks for legacy installations.
  const {
    professionalCro: _cro,
    professionalSpecialties: _specs,
    chargesConsultation: _chargesConsultation,
    consultationFee: _consultationFee,
    defaultLeadDurationMinutes: _leadDur,
    defaultPatientDurationMinutes: _patientDur,
    acceptsInsurance: _acceptsInsurance,
    insurancePlans: _insurancePlans,
    insuranceDays: _insuranceDays,
    insuranceHoursStart: _insuranceHoursStart,
    insuranceHoursEnd: _insuranceHoursEnd,
    ...sanitizedBody
  } = body;

  const toSave = {
    ...sanitizedBody,
    ...(body.telegramBotToken !== undefined && {
      telegramBotToken: encryptIfNeeded(body.telegramBotToken),
    }),
    ...(body.vapiApiKey !== undefined && {
      vapiApiKey: encryptIfNeeded(body.vapiApiKey),
    }),
  };

  const existing = await db.query.dentalSettingsTable.findFirst({ where: eq(dentalSettingsTable.tenantId, req.tenantId) });

  let saved: typeof existing;
  if (existing) {
    const [updated] = await db.update(dentalSettingsTable).set(toSave).where(eq(dentalSettingsTable.tenantId, req.tenantId)).returning();
    saved = updated;
  } else {
    const [created] = await db.insert(dentalSettingsTable).values({ tenantId: req.tenantId, ...toSave }).returning();
    saved = created;
  }

  // Invalidate AFTER the DB write so no concurrent request can cache the stale value
  await settingsCache.invalidate(req.tenantId);
  invalidateOpenAIClient(req.tenantId);

  const { telegramBotToken, vapiApiKey, ...safe } = saved!;
  res.json({
    ...safe,
    telegramBotToken: maskSensitiveKey(telegramBotToken),
    vapiApiKey: maskSensitiveKey(vapiApiKey),
  });
});

export default router;
