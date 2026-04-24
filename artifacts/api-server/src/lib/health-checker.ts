import axios from "axios";
import { pool } from "@workspace/db";
import { getRedis, isRedisAvailable } from "./redis";
import { getGlobalProvider, getDefaultProviderKind } from "./whatsapp-provider";
import { getGlobalUazapiAdmin } from "./whatsapp-providers/uazapi";
import { logger } from "./logger";
import { openai as globalOpenai } from "@workspace/integrations-openai-ai-server";

const CHECK_TIMEOUT_MS = 5000;

export interface DependencyStatus {
  status: "ok" | "error" | "skipped";
  latencyMs: number;
  error?: string;
}

export interface DeepHealthResult {
  db: DependencyStatus;
  redis: DependencyStatus;
  evolutionApi: DependencyStatus;
  uazapi: DependencyStatus;
  openai: DependencyStatus;
  schema: SchemaStatus;
  defaultProvider?: string;
  checkedAt: string;
}

export interface SchemaStatus {
  status: "ok" | "error";
  latencyMs: number;
  missing: { table: string; column: string }[];
  error?: string;
}

const REQUIRED_COLUMNS: { table: string; column: string }[] = [
  { table: "tos_versions", column: "kind" },
  { table: "tos_versions", column: "active" },
  { table: "tos_acceptances", column: "tos_version_id" },
  { table: "tenants", column: "evolution_api_url" },
  { table: "tenants", column: "evolution_api_key" },
  { table: "tenants", column: "evolution_instance_name" },
  { table: "tenants", column: "whatsapp_provider" },
];

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

export async function checkDb(): Promise<DependencyStatus> {
  const t = Date.now();
  try {
    await withTimeout(pool.query("SELECT 1"), CHECK_TIMEOUT_MS);
    return { status: "ok", latencyMs: Date.now() - t };
  } catch (err) {
    return { status: "error", latencyMs: Date.now() - t, error: String(err) };
  }
}

export async function checkRedis(): Promise<DependencyStatus> {
  const t = Date.now();
  const redisUrl = process.env["REDIS_URL"];
  if (!redisUrl) {
    return { status: "skipped", latencyMs: 0, error: "REDIS_URL not configured" };
  }
  const redis = getRedis();
  if (!redis || !isRedisAvailable()) {
    return { status: "error", latencyMs: Date.now() - t, error: "Redis not connected" };
  }
  try {
    const pong = await withTimeout(redis.ping(), CHECK_TIMEOUT_MS);
    if (pong !== "PONG") throw new Error(`Unexpected PING response: ${pong}`);
    return { status: "ok", latencyMs: Date.now() - t };
  } catch (err) {
    return { status: "error", latencyMs: Date.now() - t, error: String(err) };
  }
}

export async function checkEvolutionApi(): Promise<DependencyStatus> {
  const t = Date.now();
  const provider = getGlobalProvider();
  if (!provider) {
    return { status: "skipped", latencyMs: 0, error: "Evolution API not configured (EVOLUTION_API_URL/EVOLUTION_API_KEY missing)" };
  }
  const apiUrl = process.env.EVOLUTION_API_URL!.replace(/\/$/, "");
  const apiKey = process.env.EVOLUTION_API_KEY!;
  try {
    await withTimeout(
      axios.get(`${apiUrl}/instance/fetchInstances`, {
        headers: { apikey: apiKey, "Content-Type": "application/json" },
        timeout: CHECK_TIMEOUT_MS,
      }),
      CHECK_TIMEOUT_MS + 500
    );
    return { status: "ok", latencyMs: Date.now() - t };
  } catch (err) {
    const msg = axios.isAxiosError(err)
      ? `HTTP ${err.response?.status ?? "network"}: ${err.message}`
      : String(err);
    return { status: "error", latencyMs: Date.now() - t, error: msg };
  }
}

export async function checkUazapi(): Promise<DependencyStatus> {
  const t = Date.now();
  const admin = getGlobalUazapiAdmin();
  if (!admin) {
    return { status: "skipped", latencyMs: 0, error: "uazapi not configured (UAZAPI_HOST/UAZAPI_ADMIN_TOKEN missing)" };
  }
  try {
    await withTimeout(
      axios.get(`${admin.host}/instance/all`, {
        headers: { admintoken: admin.adminToken, "Content-Type": "application/json" },
        timeout: CHECK_TIMEOUT_MS,
      }),
      CHECK_TIMEOUT_MS + 500,
    );
    return { status: "ok", latencyMs: Date.now() - t };
  } catch (err) {
    const msg = axios.isAxiosError(err)
      ? `HTTP ${err.response?.status ?? "network"}: ${err.message}`
      : String(err);
    return { status: "error", latencyMs: Date.now() - t, error: msg };
  }
}

export async function checkOpenAI(): Promise<DependencyStatus> {
  const t = Date.now();
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!baseURL || !apiKey) {
    return { status: "skipped", latencyMs: 0, error: "OpenAI credentials not configured" };
  }
  try {
    await withTimeout(
      globalOpenai.chat.completions.create({
        model: "gpt-5-nano",
        messages: [{ role: "user", content: "ping" }],
        max_completion_tokens: 1,
      }),
      CHECK_TIMEOUT_MS
    );
    return { status: "ok", latencyMs: Date.now() - t };
  } catch (err) {
    return { status: "error", latencyMs: Date.now() - t, error: String(err) };
  }
}

export async function checkSchema(): Promise<SchemaStatus> {
  const t = Date.now();
  try {
    const tables = Array.from(new Set(REQUIRED_COLUMNS.map((c) => c.table)));
    const result = await withTimeout(
      pool.query<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
        [tables],
      ),
      CHECK_TIMEOUT_MS,
    );
    const present = new Set(result.rows.map((r) => `${r.table_name}.${r.column_name}`));
    const missing = REQUIRED_COLUMNS.filter((c) => !present.has(`${c.table}.${c.column}`));
    return {
      status: missing.length === 0 ? "ok" : "error",
      latencyMs: Date.now() - t,
      missing,
      ...(missing.length > 0
        ? { error: `Schema drift: ${missing.length} required column(s) missing — run 'pnpm --filter @workspace/db run push'` }
        : {}),
    };
  } catch (err) {
    return { status: "error", latencyMs: Date.now() - t, missing: [], error: String(err) };
  }
}

export async function runDeepHealthCheck(): Promise<DeepHealthResult> {
  const [db, redis, evolutionApi, uazapi, openai, schema] = await Promise.all([
    checkDb().catch((err): DependencyStatus => ({ status: "error", latencyMs: 0, error: String(err) })),
    checkRedis().catch((err): DependencyStatus => ({ status: "error", latencyMs: 0, error: String(err) })),
    checkEvolutionApi().catch((err): DependencyStatus => ({ status: "error", latencyMs: 0, error: String(err) })),
    checkUazapi().catch((err): DependencyStatus => ({ status: "error", latencyMs: 0, error: String(err) })),
    checkOpenAI().catch((err): DependencyStatus => ({ status: "error", latencyMs: 0, error: String(err) })),
    checkSchema().catch((err): SchemaStatus => ({ status: "error", latencyMs: 0, missing: [], error: String(err) })),
  ]);

  const result: DeepHealthResult = { db, redis, evolutionApi, uazapi, openai, schema, defaultProvider: getDefaultProviderKind(), checkedAt: new Date().toISOString() };

  logger.debug(
    {
      db: { status: db.status, latencyMs: db.latencyMs },
      redis: { status: redis.status, latencyMs: redis.latencyMs },
      evolutionApi: { status: evolutionApi.status, latencyMs: evolutionApi.latencyMs },
      openai: { status: openai.status, latencyMs: openai.latencyMs },
    },
    "Health: deep check completed"
  );

  return result;
}
