/**
 * Sanitize a WhatsApp pushName field.
 *
 * When a contact sends a message without being saved in the recipient's
 * phone contacts, Evolution API (and WhatsApp itself) often fills pushName
 * with the bare phone number (e.g. "558599260930"). This helper detects
 * that pattern and returns an empty string so callers can fall back
 * gracefully instead of greeting users with their phone number.
 */
export function sanitizePushName(name: string | null | undefined): string {
  if (!name) return "";
  const stripped = name.replace(/[+\-\s().]/g, "");
  if (/^\d{8,15}$/.test(stripped)) return "";
  return name.trim();
}
