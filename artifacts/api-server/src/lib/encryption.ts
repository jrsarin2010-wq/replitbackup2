import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const keyHex = process.env.DATA_ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error("DATA_ENCRYPTION_KEY environment variable is not set");
  }
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw new Error("DATA_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)");
  }
  return key;
}

export function encrypt(plaintext: string): string {
  if (!plaintext) return plaintext;
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${encrypted.toString("hex")}:${authTag.toString("hex")}`;
}

export function decrypt(ciphertext: string): string {
  if (!ciphertext) return ciphertext;
  const parts = ciphertext.split(":");
  if (parts.length !== 3) return ciphertext;
  const key = getKey();
  try {
    const iv = Buffer.from(parts[0], "hex");
    const encrypted = Buffer.from(parts[1], "hex");
    const authTag = Buffer.from(parts[2], "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return ciphertext;
  }
}

export function isEncrypted(value: string): boolean {
  if (!value) return false;
  const parts = value.split(":");
  if (parts.length !== 3) return false;
  return parts[0].length === IV_LENGTH * 2 && parts[2].length === AUTH_TAG_LENGTH * 2;
}

export function encryptIfNeeded(value: string | null | undefined): string | null | undefined {
  if (!value) return value;
  if (isEncrypted(value)) return value;
  return encrypt(value);
}

export function decryptIfNeeded(value: string | null | undefined): string | null | undefined {
  if (!value) return value;
  if (!isEncrypted(value)) return value;
  return decrypt(value);
}

export function hasEncryptionKey(): boolean {
  return !!process.env.DATA_ENCRYPTION_KEY;
}
