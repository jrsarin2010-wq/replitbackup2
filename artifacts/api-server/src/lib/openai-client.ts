import { openai as defaultOpenai, OpenAI } from "@workspace/integrations-openai-ai-server";

// openaiClientCache is intentionally kept in-memory: OpenAI SDK instances hold live
// HTTP connection state and are not JSON-serializable. Each instance maintains its
// own cache independently, which is acceptable since re-creation is cheap (< 1ms).
const openaiClientCache = new Map<number, { client: OpenAI; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function getOpenAIClient(tenantId: number): Promise<OpenAI> {
  const cached = openaiClientCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached.client;

  const { getTenantWithDecryptedKeys } = await import("./tenant-helpers");
  const tenant = await getTenantWithDecryptedKeys(tenantId);
  const client = tenant?.openaiApiKey ? new OpenAI({ apiKey: tenant.openaiApiKey }) : defaultOpenai;
  openaiClientCache.set(tenantId, { client, expiresAt: Date.now() + CACHE_TTL_MS });
  return client;
}

export function invalidateOpenAIClient(tenantId: number): void {
  openaiClientCache.delete(tenantId);
}
