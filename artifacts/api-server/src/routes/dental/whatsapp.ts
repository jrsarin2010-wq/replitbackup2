import { Router } from "express";
import { db } from "@workspace/db";
import { tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { tenantMiddleware } from "../../middlewares/tenant";
import { getProviderForTenant, getGlobalProvider, getWebhookUrl, EvolutionApiProvider, getDefaultProviderKind } from "../../lib/whatsapp-provider";
import { UazapiProvider, getGlobalUazapiAdmin } from "../../lib/whatsapp-providers/uazapi";
import { logger } from "../../lib/logger";
import { encryptIfNeeded } from "../../lib/encryption";
import { getTenantWithDecryptedKeys } from "../../lib/tenant-helpers";

const router = Router();
router.use(tenantMiddleware);

async function ensureInstanceProvisioned(tenantId: number): Promise<{ instanceName: string; freshQrCode?: string | null; providerKind: "evolution" | "uazapi" }> {
  const tenant = await getTenantWithDecryptedKeys(tenantId);
  if (!tenant) throw new Error("Tenant not found");

  const providerKind = (tenant.whatsappProvider as "evolution" | "uazapi") || getDefaultProviderKind();
  const webhookUrl = getWebhookUrl();

  if (providerKind === "uazapi") {
    const globalAdmin = getGlobalUazapiAdmin();
    const host = tenant.uazapiHost || globalAdmin?.host || process.env.UAZAPI_HOST;
    const adminToken = tenant.uazapiAdminToken || globalAdmin?.adminToken || process.env.UAZAPI_ADMIN_TOKEN || null;
    if (!host || !adminToken) {
      throw new Error("uazapi não está configurado no sistema. Contate o administrador.");
    }

    const instanceName = tenant.evolutionInstanceName || `dental-${tenantId}`;

    if (tenant.uazapiInstanceToken && tenant.uazapiInstanceId) {
      const existing = new UazapiProvider(host, tenant.uazapiInstanceToken, adminToken);
      try {
        await existing.setupWebhook(instanceName, webhookUrl);
      } catch {
        logger.warn({ instanceName }, "Could not reconfigure uazapi webhook");
      }
      return { instanceName, providerKind };
    }

    const adminProvider = new UazapiProvider(host, "", adminToken);
    const created = await adminProvider.createInstance(instanceName);
    if (!created.instanceToken) {
      throw new Error("uazapi não retornou um token de instância");
    }
    await db.update(tenantsTable)
      .set({
        evolutionInstanceName: instanceName,
        whatsappProvider: "uazapi",
        uazapiHost: host,
        uazapiInstanceId: created.instanceId || null,
        uazapiInstanceToken: encryptIfNeeded(created.instanceToken),
      })
      .where(eq(tenantsTable.id, tenantId));

    const newProvider = new UazapiProvider(host, created.instanceToken, adminToken);
    try {
      await newProvider.setupWebhook(instanceName, webhookUrl);
    } catch (err) {
      logger.warn({ err, instanceName }, "Could not configure uazapi webhook on fresh instance");
    }
    return { instanceName, providerKind, freshQrCode: created.qrCode };
  }

  const globalProvider = getGlobalProvider();
  if (!globalProvider) {
    throw new Error("Nenhuma Evolution API configurada no sistema. Contate o administrador.");
  }
  const globalUrl = process.env.EVOLUTION_API_URL!;
  const globalKey = process.env.EVOLUTION_API_KEY!;

  if (tenant.evolutionInstanceName && tenant.evolutionApiUrl) {
    const stillExists = await globalProvider.instanceExists(tenant.evolutionInstanceName);
    if (stillExists) {
      try {
        await globalProvider.setupWebhook(tenant.evolutionInstanceName, webhookUrl);
      } catch {
        logger.warn({ instanceName: tenant.evolutionInstanceName }, "Could not reconfigure webhook");
      }
      return { instanceName: tenant.evolutionInstanceName, providerKind };
    }
    logger.warn({ tenantId, instanceName: tenant.evolutionInstanceName }, "Saved instance no longer exists in Evolution API — reprovisioning");
  }

  const instanceName = `dental-${tenantId}`;
  const exists = await globalProvider.instanceExists(instanceName);
  let freshQrCode: string | null = null;
  if (!exists) {
    try {
      const created = await globalProvider.createInstance(instanceName);
      freshQrCode = created.qrCode;
      await globalProvider.setupWebhook(instanceName, webhookUrl);
      logger.info({ tenantId, instanceName, webhookUrl }, "Instance auto-provisioned for tenant");
    } catch (err) {
      logger.error({ err, tenantId, instanceName }, "Failed to auto-create Evolution instance");
      throw new Error("Não foi possível criar a instância WhatsApp automaticamente. Por favor, contate o administrador do sistema.");
    }
  } else {
    try {
      await globalProvider.setupWebhook(instanceName, webhookUrl);
    } catch {
      logger.warn({ instanceName }, "Could not reconfigure webhook for existing instance");
    }
  }

  await db.update(tenantsTable)
    .set({
      evolutionInstanceName: instanceName,
      evolutionApiUrl: globalUrl,
      evolutionApiKey: encryptIfNeeded(globalKey),
    })
    .where(eq(tenantsTable.id, tenantId));

  return { instanceName, providerKind, freshQrCode };
}

router.get("/connect", async (req, res) => {
  try {
    const { instanceName, freshQrCode, providerKind } = await ensureInstanceProvisioned(req.tenantId);
    const { provider } = await getProviderForTenant(req.tenantId);

    if (providerKind === "evolution") {
      const globalProvider = getGlobalProvider();
      const activeProvider = globalProvider || provider;
      if (!(activeProvider instanceof EvolutionApiProvider)) {
        res.json({ status: "qr_pending", qrCode: "MOCK_QR_CODE_DATA" });
        return;
      }
    }

    const status = await provider.getStatus(instanceName);
    if (status.connected) {
      await db.update(tenantsTable).set({ whatsappConnected: "true" }).where(eq(tenantsTable.id, req.tenantId));
      res.json({ status: "connected", qrCode: null, message: "Already connected" });
      return;
    }

    if (freshQrCode) {
      logger.info({ instanceName, providerKind }, "Returning QR code from fresh instance creation");
      res.json({ status: "qr_pending", qrCode: freshQrCode });
      return;
    }

    const result = await provider.getQRCode(instanceName);
    logger.info({ instanceName, providerKind, hasQr: !!result.qrCode, qrStatus: result.status }, "QR code fetch result");

    if (result.status === "open") {
      await db.update(tenantsTable).set({ whatsappConnected: "true" }).where(eq(tenantsTable.id, req.tenantId));
      res.json({ status: "connected", qrCode: null, message: "Already connected" });
      return;
    }

    res.json({ status: result.status || "qr_pending", qrCode: result.qrCode });
  } catch (err) {
    logger.error({ err }, "WhatsApp connect error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to get WhatsApp QR code" });
  }
});

router.get("/status", async (req, res) => {
  try {
    const { provider, instanceName, kind } = await getProviderForTenant(req.tenantId);
    const result = await provider.getStatus(instanceName);

    const connected = result.connected || result.status === "open";
    await db.update(tenantsTable).set({ whatsappConnected: connected ? "true" : "false" }).where(eq(tenantsTable.id, req.tenantId));

    let normalizedStatus: "connected" | "disconnected" | "qr_pending" = "disconnected";
    if (connected) normalizedStatus = "connected";
    else if (result.status === "qr_pending" || result.status === "qr" || result.status === "connecting") normalizedStatus = "qr_pending";
    res.json({ connected, status: normalizedStatus, phone: result.phone || null, provider: kind });
  } catch (err) {
    logger.error({ err }, "WhatsApp status error");
    res.status(500).json({ error: "Failed to get WhatsApp status" });
  }
});

router.post("/disconnect", async (req, res) => {
  try {
    const { provider, instanceName } = await getProviderForTenant(req.tenantId);
    await provider.disconnect(instanceName);
    await db.update(tenantsTable).set({ whatsappConnected: "false" }).where(eq(tenantsTable.id, req.tenantId));
    res.json({ success: true, message: "Disconnected" });
  } catch (err) {
    logger.error({ err }, "WhatsApp disconnect error");
    res.status(500).json({ error: "Failed to disconnect WhatsApp" });
  }
});

router.post("/recreate", async (req, res) => {
  try {
    const tenant = await getTenantWithDecryptedKeys(req.tenantId);
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const providerKind = (tenant.whatsappProvider as "evolution" | "uazapi") || getDefaultProviderKind();
    const instanceName = tenant.evolutionInstanceName || `dental-${req.tenantId}`;
    const webhookUrl = getWebhookUrl();

    logger.info({ tenantId: req.tenantId, instanceName, providerKind }, "Recreating WhatsApp instance");

    if (providerKind === "uazapi") {
      const globalAdmin = getGlobalUazapiAdmin();
      const host = tenant.uazapiHost || globalAdmin?.host || process.env.UAZAPI_HOST;
      const adminToken = tenant.uazapiAdminToken || globalAdmin?.adminToken || process.env.UAZAPI_ADMIN_TOKEN || null;
      if (!host || !adminToken) {
        res.status(400).json({ error: "uazapi não está configurado no sistema." });
        return;
      }

      if (tenant.uazapiInstanceToken) {
        try {
          const oldProv = new UazapiProvider(host, tenant.uazapiInstanceToken, adminToken);
          await oldProv.deleteInstance(instanceName);
        } catch (err) {
          logger.warn({ err, instanceName }, "Could not delete old uazapi instance — proceeding");
        }
      }

      const adminProv = new UazapiProvider(host, "", adminToken);
      const created = await adminProv.createInstance(instanceName);
      if (!created.instanceToken) {
        res.status(500).json({ error: "uazapi não retornou um token de instância" });
        return;
      }
      const newProv = new UazapiProvider(host, created.instanceToken, adminToken);
      await newProv.setupWebhook(instanceName, webhookUrl);

      await db.update(tenantsTable)
        .set({
          evolutionInstanceName: instanceName,
          uazapiHost: host,
          uazapiInstanceId: created.instanceId || null,
          uazapiInstanceToken: encryptIfNeeded(created.instanceToken),
          whatsappConnected: "false",
        })
        .where(eq(tenantsTable.id, req.tenantId));

      logger.info({ tenantId: req.tenantId, instanceName, webhookUrl, providerKind }, "uazapi instance recreated successfully");
      res.json({ success: true, qrCode: created.qrCode, instanceName, provider: providerKind });
      return;
    }

    const globalProvider = getGlobalProvider();
    if (!globalProvider) {
      res.status(400).json({ error: "Nenhuma Evolution API configurada no sistema." });
      return;
    }
    const globalUrl = process.env.EVOLUTION_API_URL!;
    const globalKey = process.env.EVOLUTION_API_KEY!;

    try {
      await globalProvider.deleteInstance(instanceName);
    } catch (err) {
      logger.warn({ err, instanceName }, "Could not delete old instance — proceeding with creation");
    }

    const created = await globalProvider.createInstance(instanceName);
    await globalProvider.setupWebhook(instanceName, webhookUrl);

    await db.update(tenantsTable)
      .set({
        evolutionInstanceName: instanceName,
        evolutionApiUrl: globalUrl,
        evolutionApiKey: encryptIfNeeded(globalKey),
        whatsappConnected: "false",
      })
      .where(eq(tenantsTable.id, req.tenantId));

    logger.info({ tenantId: req.tenantId, instanceName, webhookUrl, providerKind }, "WhatsApp instance recreated successfully");

    res.json({ success: true, qrCode: created.qrCode, instanceName, provider: providerKind });
  } catch (err) {
    logger.error({ err }, "WhatsApp recreate error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to recreate WhatsApp instance" });
  }
});

export default router;
