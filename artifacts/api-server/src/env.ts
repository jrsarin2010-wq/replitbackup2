const CRITICAL_ENV_VARS: { key: string; description: string }[] = [
  {
    key: "JWT_SECRET",
    description: "Secret used to sign and verify JWT tokens for tenant authentication",
  },
  {
    key: "DATA_ENCRYPTION_KEY",
    description:
      "64-character hex string (32 bytes) used for AES-256-GCM encryption of sensitive data at rest. " +
      "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
  },
  {
    key: "DATABASE_URL",
    description: "PostgreSQL connection string for the primary database",
  },
  {
    key: "AI_INTEGRATIONS_OPENAI_API_KEY",
    description:
      "OpenAI API key — required at boot because ai-engine is eagerly imported by webhook routes " +
      "(provided by the Replit OpenAI integration)",
  },
  {
    key: "AI_INTEGRATIONS_OPENAI_BASE_URL",
    description:
      "OpenAI base URL — required at boot alongside AI_INTEGRATIONS_OPENAI_API_KEY " +
      "(provided by the Replit OpenAI integration)",
  },
  {
    key: "ADMIN_API_KEY",
    description: "API key for protected admin-only endpoints",
  },
];

const OPTIONAL_WHATSAPP_PROVIDER_ENV_VARS: { key: string; description: string }[] = [
  {
    key: "WHATSAPP_PROVIDER",
    description: "Default WhatsApp provider for tenants without an explicit override. One of: evolution | uazapi. Defaults to 'evolution'.",
  },
  {
    key: "EVOLUTION_API_URL",
    description: "Global Evolution API base URL (used as fallback when a tenant doesn't have its own credentials).",
  },
  {
    key: "EVOLUTION_API_KEY",
    description: "Global Evolution API key (used as fallback when a tenant doesn't have its own credentials).",
  },
  {
    key: "UAZAPI_HOST",
    description: "Global uazapi host URL (e.g. https://your-uazapi.example.com). Required when WHATSAPP_PROVIDER=uazapi or for tenants without their own host.",
  },
  {
    key: "UAZAPI_ADMIN_TOKEN",
    description: "Global uazapi admin token used to create/list/delete instances and to manage tenants without their own admin token.",
  },
];

const OBJECT_STORAGE_ENV_VARS: { key: string; description: string }[] = [
  {
    key: "DEFAULT_OBJECT_STORAGE_BUCKET_ID",
    description:
      "GCS bucket ID for Object Storage (e.g. replit-objstore-<uuid>). " +
      "Set automatically by Replit Object Storage provisioning.",
  },
  {
    key: "PRIVATE_OBJECT_DIR",
    description:
      "GCS path prefix for private object uploads (e.g. /bucket-name/.private). " +
      "Set automatically by Replit Object Storage provisioning.",
  },
  {
    key: "PUBLIC_OBJECT_SEARCH_PATHS",
    description:
      "Comma-separated GCS path prefixes for public asset serving. " +
      "Set automatically by Replit Object Storage provisioning.",
  },
];

const missing: string[] = [];
for (const { key, description } of CRITICAL_ENV_VARS) {
  if (!process.env[key]) {
    missing.push(`  - ${key}: ${description}`);
  }
}

if (missing.length > 0) {
  throw new Error(
    `Server startup aborted — the following required environment variables are not set:\n${missing.join("\n")}\n\n` +
    `Set them in Replit Secrets (for sensitive values) or environment variables before starting the server.`,
  );
}

const missingObjectStorage = OBJECT_STORAGE_ENV_VARS.filter((v) => !process.env[v.key]);
if (missingObjectStorage.length > 0) {
  console.warn(
    "[startup] Object Storage env vars missing — upload/serve features will not work:\n" +
    missingObjectStorage.map((v) => `  - ${v.key}: ${v.description}`).join("\n") + "\n\n" +
    "Provision Object Storage in the Replit Object Storage tool to set these automatically.",
  );
} else {
  console.log(
    `[startup] Object Storage configured — bucket=${process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID}, PRIVATE_OBJECT_DIR and PUBLIC_OBJECT_SEARCH_PATHS are present.`,
  );
}

const keyHex = process.env["DATA_ENCRYPTION_KEY"]!;
if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
  throw new Error(
    `DATA_ENCRYPTION_KEY is invalid: expected exactly a 64-character hex string (32 bytes), got "${keyHex.length}" characters.\n` +
    `Generate a valid key with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
  );
}
const keyBuf = Buffer.from(keyHex, "hex");

const provider = (process.env.WHATSAPP_PROVIDER || "evolution").toLowerCase();
const presentWhatsappVars = OPTIONAL_WHATSAPP_PROVIDER_ENV_VARS.filter((v) => !!process.env[v.key]).map((v) => v.key);
console.log(
  `[startup] WhatsApp provider default = ${provider} — present optional vars: ${presentWhatsappVars.join(", ") || "(none)"}`,
);

console.log(
  "[startup] Env preflight OK — all required environment variables are present and valid:",
  CRITICAL_ENV_VARS.map((v) => v.key).join(", "),
);
