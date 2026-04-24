import { Router } from "express";
import { db, pool } from "@workspace/db";
import { tenantsTable, dentalSettingsTable, dentalProfessionalsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db";
import { CreateTenantBody, UpdateTenantBody, GetTenantParams, UpdateTenantParams, DeleteTenantParams, OnboardTenantBody } from "@workspace/api-zod";
import { tenantMiddleware } from "../../middlewares/tenant";
import { encryptIfNeeded, hasEncryptionKey } from "../../lib/encryption";
import { invalidateOpenAIClient } from "../../lib/openai-client";
import { tenantExistsCache } from "../../lib/cache";

type TenantInsert = typeof tenantsTable.$inferInsert;

function encryptTenantKeys<T extends Partial<TenantInsert>>(body: T): T {
  const hasKeys = body.evolutionApiKey || body.elevenLabsApiKey || body.openaiApiKey || body.uazapiAdminToken || body.uazapiInstanceToken;
  if (!hasKeys) return body;
  if (!hasEncryptionKey()) {
    throw new Error("DATA_ENCRYPTION_KEY is required to store sensitive API keys");
  }
  const result = { ...body };
  if (result.evolutionApiKey) result.evolutionApiKey = encryptIfNeeded(result.evolutionApiKey);
  if (result.elevenLabsApiKey) result.elevenLabsApiKey = encryptIfNeeded(result.elevenLabsApiKey);
  if (result.openaiApiKey) result.openaiApiKey = encryptIfNeeded(result.openaiApiKey);
  if (result.uazapiAdminToken) result.uazapiAdminToken = encryptIfNeeded(result.uazapiAdminToken);
  if (result.uazapiInstanceToken) result.uazapiInstanceToken = encryptIfNeeded(result.uazapiInstanceToken);
  return result;
}

const router = Router();

router.get("/", tenantMiddleware, async (req, res) => {
  const tenant = await db.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, req.tenantId) });
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }
  const { evolutionApiKey, openaiApiKey, elevenLabsApiKey, uazapiAdminToken, uazapiInstanceToken, ...safe } = tenant;
  res.json([{
    ...safe,
    elevenLabsConfigured: Boolean(elevenLabsApiKey),
    uazapiAdminTokenConfigured: Boolean(uazapiAdminToken),
    uazapiInstanceTokenConfigured: Boolean(uazapiInstanceToken),
  }]);
});

router.post("/", async (req, res) => {
  const body = CreateTenantBody.parse(req.body);
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  const encrypted = encryptTenantKeys(body);
  const [tenant] = await db.insert(tenantsTable).values({
    ...encrypted,
    subscriptionStatus: "active",
    subscribedAt: now,
    subscriptionExpiresAt: expiresAt,
  }).returning();
  res.status(201).json(tenant);
});

router.post("/onboarding", async (req, res) => {
  const body = OnboardTenantBody.parse(req.body);
  const extraBody = req.body as Record<string, unknown>;

  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const txDb = drizzle(client, { schema });

    const [tenant] = await txDb.insert(tenantsTable).values({
      name: body.name,
      slug: body.slug,
      plan: body.plan,
      subscriptionStatus: "active",
      subscribedAt: now,
      subscriptionExpiresAt: expiresAt,
    }).returning();

    await txDb.insert(dentalSettingsTable).values({
      tenantId: tenant.id,
      clinicName: body.clinicName || tenant.name,
      clinicPhone: String(extraBody.clinicPhone || ""),
      clinicAddress: String(extraBody.clinicAddress || ""),
      workingHoursStart: body.workingHoursStart || "08:00",
      workingHoursEnd: body.workingHoursEnd || "18:00",
      slotDurationMinutes: Number(extraBody.slotDurationMinutes) || 30,
      aiPersonality: String(extraBody.aiPersonality || ""),
      aiLanguage: String(extraBody.aiLanguage || "pt-BR"),
    });

    await txDb.insert(dentalProfessionalsTable).values({
      tenantId: tenant.id,
      name: body.clinicName || body.name,
      cro: String(extraBody.cro || ""),
      specialty: null,
      specialties: null,
      isOwner: true,
      workingDays: "1,2,3,4,5",
      workingHoursStart: body.workingHoursStart || "08:00",
      workingHoursEnd: body.workingHoursEnd || "18:00",
      lunchStart: "12:00",
      lunchEnd: "13:00",
      slotDurationMinutes: Number(extraBody.slotDurationMinutes) || 30,
      acceptsInsurance: false,
      consultationFee: null,
    });

    await client.query("COMMIT");
    res.status(201).json(tenant);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

router.get("/:tenantId", tenantMiddleware, async (req, res) => {
  const { tenantId } = GetTenantParams.parse(req.params);
  if (tenantId !== req.tenantId) {
    res.status(403).json({ error: "Acesso negado: tenant incompativel" });
    return;
  }
  const tenant = await db.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, tenantId) });
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }
  const { evolutionApiKey, openaiApiKey, elevenLabsApiKey, uazapiAdminToken, uazapiInstanceToken, ...safe } = tenant;
  res.json({
    ...safe,
    elevenLabsConfigured: Boolean(elevenLabsApiKey),
    uazapiAdminTokenConfigured: Boolean(uazapiAdminToken),
    uazapiInstanceTokenConfigured: Boolean(uazapiInstanceToken),
  });
});

router.patch("/:tenantId", tenantMiddleware, async (req, res) => {
  const { tenantId } = UpdateTenantParams.parse(req.params);
  if (tenantId !== req.tenantId) {
    res.status(403).json({ error: "Acesso negado: tenant incompativel" });
    return;
  }
  const body = UpdateTenantBody.parse(req.body);
  const encrypted = encryptTenantKeys(body);
  const [tenant] = await db.update(tenantsTable).set(encrypted).where(eq(tenantsTable.id, tenantId)).returning();
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }
  if (Object.prototype.hasOwnProperty.call(body, "openaiApiKey")) {
    invalidateOpenAIClient(tenantId);
  }
  const { evolutionApiKey: _a, openaiApiKey: _b, elevenLabsApiKey: _c, uazapiAdminToken: _d, uazapiInstanceToken: _e, ...safeTenant } = tenant;
  res.json(safeTenant);
});

router.delete("/:tenantId", tenantMiddleware, async (req, res) => {
  const { tenantId } = DeleteTenantParams.parse(req.params);
  if (tenantId !== req.tenantId) {
    res.status(403).json({ error: "Acesso negado: tenant incompativel" });
    return;
  }
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  await tenantExistsCache.invalidate(tenantId);
  invalidateOpenAIClient(tenantId);
  res.status(204).send();
});

export default router;
