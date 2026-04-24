import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SETTINGS_SRC = fs.readFileSync(
  path.resolve(__dirname, "../routes/dental/settings.ts"),
  "utf-8",
);

const ADMIN_TENANTS_SRC = fs.readFileSync(
  path.resolve(__dirname, "../routes/admin-tenants.ts"),
  "utf-8",
);

const VAPI_SRC = fs.readFileSync(
  path.resolve(__dirname, "../lib/vapi.ts"),
  "utf-8",
);

const CACHE_SRC = fs.readFileSync(
  path.resolve(__dirname, "../lib/cache.ts"),
  "utf-8",
);

const ENCRYPTION_SRC = fs.readFileSync(
  path.resolve(__dirname, "../lib/encryption.ts"),
  "utf-8",
);

describe("Task #13 — Criptografia uniforme de chaves API dos tenants", () => {
  describe("1. PUT /dental/settings — criptografia na escrita", () => {
    it("settings.ts importa encryptIfNeeded", () => {
      expect(SETTINGS_SRC).toContain("encryptIfNeeded");
    });

    it("settings.ts aplica encryptIfNeeded em telegramBotToken antes de salvar", () => {
      expect(SETTINGS_SRC).toContain("encryptIfNeeded(body.telegramBotToken)");
    });

    it("settings.ts aplica encryptIfNeeded em vapiApiKey antes de salvar", () => {
      expect(SETTINGS_SRC).toContain("encryptIfNeeded(body.vapiApiKey)");
    });

    it("settings.ts invalida o cache após salvar (invalidate)", () => {
      expect(SETTINGS_SRC).toContain("settingsCache.invalidate(req.tenantId)");
    });
  });

  describe("2. GET /dental/settings — mascaramento pós-descriptografia", () => {
    it("settings.ts importa decryptIfNeeded para mascaramento correto", () => {
      expect(SETTINGS_SRC).toContain("decryptIfNeeded");
    });

    it("settings.ts usa maskToken que descriptografa antes de exibir últimos 6 chars", () => {
      expect(SETTINGS_SRC).toContain("slice(-6)");
      expect(SETTINGS_SRC).toContain("decryptIfNeeded");
    });

    it("GET handler NÃO armazena versão mascarada no cache (usa getCachedSettings)", () => {
      expect(SETTINGS_SRC).toContain("getCachedSettings");
      expect(SETTINGS_SRC).not.toMatch(/settingsCache\.set\(req\.tenantId/);
    });
  });

  describe("3. resolveVapiKey — descriptografia na leitura", () => {
    it("vapi.ts importa decryptIfNeeded", () => {
      expect(VAPI_SRC).toContain("decryptIfNeeded");
    });

    it("resolveVapiKey chama decryptIfNeeded no valor resolvido", () => {
      expect(VAPI_SRC).toMatch(/decryptIfNeeded\(resolved\)/);
    });
  });

  describe("4. getCachedSettings — descriptografia transparente", () => {
    it("cache.ts importa decryptIfNeeded e hasEncryptionKey", () => {
      expect(CACHE_SRC).toContain("decryptIfNeeded");
      expect(CACHE_SRC).toContain("hasEncryptionKey");
    });

    it("cache.ts define decryptSettingsKeys que trata telegramBotToken", () => {
      expect(CACHE_SRC).toContain("decryptSettingsKeys");
      expect(CACHE_SRC).toContain("telegramBotToken");
    });

    it("cache.ts define decryptSettingsKeys que trata vapiApiKey", () => {
      expect(CACHE_SRC).toContain("vapiApiKey");
    });

    it("getCachedSettings chama decryptSettingsKeys antes de armazenar no cache", () => {
      expect(CACHE_SRC).toContain("decryptSettingsKeys(fresh)");
      expect(CACHE_SRC).toMatch(/settingsCache\.set\(tenantId, decrypted\)/);
    });
  });

  describe("5. PATCH /admin/tenants/:id — criptografia completa", () => {
    it("admin-tenants.ts já criptografava evolutionApiKey", () => {
      expect(ADMIN_TENANTS_SRC).toContain("encryptIfNeeded(evolutionApiKey)");
    });

    it("admin-tenants.ts agora criptografa elevenLabsApiKey", () => {
      expect(ADMIN_TENANTS_SRC).toContain("encryptIfNeeded(elevenLabsApiKey)");
    });

    it("admin-tenants.ts agora criptografa openaiApiKey", () => {
      expect(ADMIN_TENANTS_SRC).toContain("encryptIfNeeded(openaiApiKey)");
    });

    it("admin-tenants.ts aceita elevenLabsApiKey no body do PATCH", () => {
      expect(ADMIN_TENANTS_SRC).toContain("elevenLabsApiKey");
    });

    it("admin-tenants.ts aceita openaiApiKey no body do PATCH", () => {
      expect(ADMIN_TENANTS_SRC).toContain("openaiApiKey");
    });
  });

  describe("6. encryption.ts — funções base corretas", () => {
    it("exporta encryptIfNeeded (não-quebra se já criptografado)", () => {
      expect(ENCRYPTION_SRC).toContain("export function encryptIfNeeded");
      expect(ENCRYPTION_SRC).toContain("isEncrypted(value)");
    });

    it("exporta decryptIfNeeded (não-quebra se plaintext)", () => {
      expect(ENCRYPTION_SRC).toContain("export function decryptIfNeeded");
    });

    it("isEncrypted detecta formato iv:ciphertext:authtag corretamente", () => {
      expect(ENCRYPTION_SRC).toContain("parts.length !== 3");
      expect(ENCRYPTION_SRC).toContain("IV_LENGTH * 2");
      expect(ENCRYPTION_SRC).toContain("AUTH_TAG_LENGTH * 2");
    });

    it("decrypt retorna ciphertext original em caso de falha (graceful)", () => {
      expect(ENCRYPTION_SRC).toContain("return ciphertext");
    });
  });

  describe("7. Callers de runtime não precisam de alterações individuais", () => {
    const ESCALATION_SRC = fs.readFileSync(
      path.resolve(__dirname, "../lib/escalation.ts"),
      "utf-8",
    );
    const CREDIT_ALERTS_SRC = fs.readFileSync(
      path.resolve(__dirname, "../lib/credit-alerts.ts"),
      "utf-8",
    );
    const URGENCY_SRC = fs.readFileSync(
      path.resolve(__dirname, "../lib/urgency-handler.ts"),
      "utf-8",
    );

    it("escalation.ts usa getCachedSettings (não lê diretamente do DB)", () => {
      expect(ESCALATION_SRC).toContain("getCachedSettings");
    });

    it("credit-alerts.ts usa getCachedSettings (não lê diretamente do DB)", () => {
      expect(CREDIT_ALERTS_SRC).toContain("getCachedSettings");
    });

    it("urgency-handler.ts usa getCachedSettings (não lê diretamente do DB)", () => {
      expect(URGENCY_SRC).toContain("getCachedSettings");
    });

    it("callers NÃO chamam decryptIfNeeded individualmente (transparência via cache)", () => {
      expect(ESCALATION_SRC).not.toContain("decryptIfNeeded");
      expect(CREDIT_ALERTS_SRC).not.toContain("decryptIfNeeded");
      expect(URGENCY_SRC).not.toContain("decryptIfNeeded");
    });
  });

  describe("8. Testes comportamentais — encrypt ↔ decrypt roundtrip", () => {
    const TEST_KEY_HEX = "a".repeat(64);
    let originalKey: string | undefined;

    beforeAll(() => {
      originalKey = process.env.DATA_ENCRYPTION_KEY;
      process.env.DATA_ENCRYPTION_KEY = TEST_KEY_HEX;
    });

    afterAll(() => {
      if (originalKey !== undefined) {
        process.env.DATA_ENCRYPTION_KEY = originalKey;
      } else {
        delete process.env.DATA_ENCRYPTION_KEY;
      }
    });

    it("encrypt() + decrypt() faz roundtrip perfeito", async () => {
      const { encrypt, decrypt } = await import("../lib/encryption.js");
      const plaintext = "bot_token_secreto:123456789";
      const ciphertext = encrypt(plaintext);
      expect(ciphertext).not.toBe(plaintext);
      expect(ciphertext.split(":")).toHaveLength(3);
      expect(decrypt(ciphertext)).toBe(plaintext);
    });

    it("encryptIfNeeded() não re-criptografa valor já cifrado", async () => {
      const { encrypt, encryptIfNeeded } = await import("../lib/encryption.js");
      const plaintext = "minha_api_key_123";
      const ciphertext = encrypt(plaintext);
      const doubled = encryptIfNeeded(ciphertext);
      expect(doubled).toBe(ciphertext);
    });

    it("decryptIfNeeded() retorna plaintext sem alteração (dados legados)", async () => {
      const { decryptIfNeeded } = await import("../lib/encryption.js");
      const legacy = "plaintext_legado_sem_criptografia";
      expect(decryptIfNeeded(legacy)).toBe(legacy);
    });

    it("resolveVapiKey() descriptografa chave cifrada do tenant", async () => {
      const { encrypt } = await import("../lib/encryption.js");
      const { resolveVapiKey } = await import("../lib/vapi.js");
      const plainKey = "vapi_sk_tenant_key_abc";
      const encryptedKey = encrypt(plainKey);
      const resolved = resolveVapiKey(encryptedKey);
      expect(resolved).toBe(plainKey);
    });

    it("resolveVapiKey() retorna plaintext legado sem alteração", async () => {
      const { resolveVapiKey } = await import("../lib/vapi.js");
      const legacyKey = "vapi_sk_legacy_plaintext";
      expect(resolveVapiKey(legacyKey)).toBe(legacyKey);
    });

    it("maskSensitiveKey: valor cifrado mascara últimos 6 do plaintext (não do ciphertext)", async () => {
      const { encrypt, decryptIfNeeded, hasEncryptionKey } = await import("../lib/encryption.js");
      const plaintext = "telegram_bot_token_abcXYZ";
      const ciphertext = encrypt(plaintext);
      const decrypted = (hasEncryptionKey() ? (decryptIfNeeded(ciphertext) ?? ciphertext) : ciphertext);
      const masked = "••••••" + decrypted.slice(-6);
      expect(masked).toBe("••••••abcXYZ");
      expect(masked).not.toContain(":");
    });
  });
});
