import { db } from "@workspace/db";
import { tenantsTable } from "@workspace/db";
import { or, isNotNull } from "drizzle-orm";
import { EvolutionApiProvider, getWebhookUrl } from "./whatsapp-provider";
import { UazapiProvider, getGlobalUazapiAdmin } from "./whatsapp-providers/uazapi";
import { logger } from "./logger";
import { decryptTenantKeys } from "./tenant-helpers";

const CONCURRENCY = 5;

async function processInBatches<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    await Promise.allSettled(batch.map(fn));
  }
}

export async function syncAllWebhooks(): Promise<void> {
  const currentWebhookUrl = getWebhookUrl();

  const rawTenants = await db.query.tenantsTable.findMany({
    where: or(isNotNull(tenantsTable.evolutionInstanceName), isNotNull(tenantsTable.uazapiInstanceId)),
  });
  const connectedTenants = rawTenants.map(decryptTenantKeys);

  if (connectedTenants.length === 0) {
    logger.info("Webhook sync: no tenants with WhatsApp instances found");
    return;
  }

  logger.info({ tenantCount: connectedTenants.length, webhookUrl: currentWebhookUrl }, "Webhook sync: updating webhook URLs for all connected tenants");

  let successCount = 0;
  let failCount = 0;
  const globalUazapi = getGlobalUazapiAdmin();

  await processInBatches(connectedTenants, CONCURRENCY, async (tenant) => {
    const providerKind = (tenant.whatsappProvider as "evolution" | "uazapi") || "evolution";

    try {
      if (providerKind === "uazapi") {
        const host = tenant.uazapiHost || globalUazapi?.host || process.env.UAZAPI_HOST;
        const instanceToken = tenant.uazapiInstanceToken;
        const adminToken = tenant.uazapiAdminToken || globalUazapi?.adminToken || process.env.UAZAPI_ADMIN_TOKEN || null;
        const instanceName = tenant.uazapiInstanceId || tenant.evolutionInstanceName;
        if (!host || !instanceToken || !instanceName) {
          logger.warn({ tenantId: tenant.id }, "Webhook sync: skipping uazapi tenant — missing host/token/instance");
          return;
        }
        const provider = new UazapiProvider(host, instanceToken, adminToken);
        await provider.setupWebhook(instanceName, currentWebhookUrl);
        successCount++;
        logger.info({ tenantId: tenant.id, instanceName, providerKind }, "Webhook sync: updated successfully");
        return;
      }

      if (!tenant.evolutionInstanceName) return;
      const apiUrl = tenant.evolutionApiUrl || process.env.EVOLUTION_API_URL;
      const apiKey = tenant.evolutionApiKey || process.env.EVOLUTION_API_KEY;
      if (!apiUrl || !apiKey) {
        logger.warn({ tenantId: tenant.id }, "Webhook sync: skipping tenant — no Evolution API credentials");
        return;
      }
      const provider = new EvolutionApiProvider(apiUrl, apiKey);
      await provider.ensureMessageStorage(tenant.evolutionInstanceName);
      await provider.setupWebhook(tenant.evolutionInstanceName, currentWebhookUrl);
      successCount++;
      logger.info({ tenantId: tenant.id, instanceName: tenant.evolutionInstanceName, providerKind }, "Webhook sync: updated successfully");
    } catch (err) {
      failCount++;
      logger.error({ err, tenantId: tenant.id, providerKind }, "Webhook sync: failed to update webhook");
    }
  });

  logger.info({ successCount, failCount, total: connectedTenants.length }, "Webhook sync: completed");
}
