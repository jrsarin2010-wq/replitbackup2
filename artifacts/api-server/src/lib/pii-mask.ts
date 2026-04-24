export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "[no-phone]";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 0) return "[no-phone]";
  if (digits.length <= 8) {
    return digits.slice(0, 2) + "****";
  }
  const prefixLen = Math.min(5, Math.floor(digits.length / 2));
  return digits.slice(0, prefixLen) + "****" + digits.slice(-4);
}

export function maskName(name: string | null | undefined): string {
  if (!name) return "[no-name]";
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "[no-name]";
  return words.map((w) => w[0] + "***").join(" ");
}

export function maskJid(jid: string | null | undefined): string {
  if (!jid) return "[no-jid]";
  const atIdx = jid.indexOf("@");
  if (atIdx === -1) return maskPhone(jid);
  return maskPhone(jid.slice(0, atIdx)) + jid.slice(atIdx);
}
