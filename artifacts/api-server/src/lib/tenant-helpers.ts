import { db } from "@workspace/db";
import { tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decryptIfNeeded, hasEncryptionKey } from "./encryption";

type TenantRecord = typeof tenantsTable.$inferSelect;

export async function getTenantWithDecryptedKeys(tenantId: number): Promise<TenantRecord | null> {
  const tenant = await db.query.tenantsTable.findFirst({
    where: eq(tenantsTable.id, tenantId),
  });
  if (!tenant) return null;
  if (!hasEncryptionKey()) return tenant;
  return {
    ...tenant,
    evolutionApiKey: decryptIfNeeded(tenant.evolutionApiKey) as string | null,
    uazapiAdminToken: decryptIfNeeded(tenant.uazapiAdminToken) as string | null,
    uazapiInstanceToken: decryptIfNeeded(tenant.uazapiInstanceToken) as string | null,
    elevenLabsApiKey: decryptIfNeeded(tenant.elevenLabsApiKey) as string | null,
    openaiApiKey: decryptIfNeeded(tenant.openaiApiKey) as string | null,
  };
}

export function decryptTenantKeys<T extends TenantRecord>(tenant: T): T {
  if (!hasEncryptionKey()) return tenant;
  return {
    ...tenant,
    evolutionApiKey: decryptIfNeeded(tenant.evolutionApiKey),
    uazapiAdminToken: decryptIfNeeded(tenant.uazapiAdminToken),
    uazapiInstanceToken: decryptIfNeeded(tenant.uazapiInstanceToken),
    elevenLabsApiKey: decryptIfNeeded(tenant.elevenLabsApiKey),
    openaiApiKey: decryptIfNeeded(tenant.openaiApiKey),
  };
}
