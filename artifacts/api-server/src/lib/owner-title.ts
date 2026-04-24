export type OwnerGender = "male" | "female" | "unspecified" | null | undefined;

export function resolveOwnerTitle(gender: OwnerGender): "Dr." | "Dra." | null {
  if (gender === "male") return "Dr.";
  if (gender === "female") return "Dra.";
  return null;
}

export function stripOwnerTitlePrefix(name: string): string {
  return name.replace(/^\s*(Dr\.?|Dra\.?)\s+/i, "").trim();
}

/**
 * Extrai o título "Dr." ou "Dra." do prefixo do nome, caso o gênero não esteja configurado.
 * Exemplo: "Dr. João Silva" → "Dr.", "Dra. Maria" → "Dra.", "João Silva" → null.
 */
export function inferTitleFromName(name: string): "Dr." | "Dra." | null {
  const m = name.match(/^\s*(Dra\.?|Dr\.?)\s+/i);
  if (!m) return null;
  return /^dra/i.test(m[1]) ? "Dra." : "Dr.";
}

/**
 * Infere o gênero a partir da terminação do primeiro nome, seguindo padrões do
 * português brasileiro. Retorna "male", "female" ou null quando ambíguo.
 *
 * Exemplos:
 *   "Robertin" → "male"   (sufixo -in é masculino)
 *   "Marcinho" → "male"   (diminutivo -inho é masculino)
 *   "Carlinhos" → "male"  (diminutivo -inhos é masculino)
 *   "Marcelinha" → "female" (diminutivo -inha é feminino)
 *   "Roberto" → "male"    (termina em -o)
 *   "Maria"   → "female"  (termina em -a)
 *   "Raquel"  → null      (ambíguo)
 */
export function inferGenderFromNameEnding(
  name: string,
): "male" | "female" | null {
  const first = name.trim().split(/\s+/)[0].toLowerCase();

  if (/zinhos?$/.test(first)) return "male";
  if (/zinhas?$/.test(first)) return "female";
  if (/inhos?$/.test(first)) return "male";
  if (/inhas?$/.test(first)) return "female";

  if (/(?:in|im|on|om)$/.test(first)) return "male";

  if (/o$/.test(first)) return "male";

  if (/a$/.test(first)) return "female";

  return null;
}

export function buildOwnerTitleContextLine(
  ownerName: string | null | undefined,
  gender: OwnerGender,
): string | null {
  const raw = ownerName?.trim() ?? "";
  if (!raw) return null;

  const cleanName = stripOwnerTitlePrefix(raw);
  if (!cleanName) return null;

  const titleFromGender = resolveOwnerTitle(gender);
  const titleFromPrefix = inferTitleFromName(raw);
  const inferredGender =
    !titleFromGender && !titleFromPrefix
      ? inferGenderFromNameEnding(cleanName)
      : null;
  const inferredTitle =
    inferredGender === "male"
      ? "Dr."
      : inferredGender === "female"
        ? "Dra."
        : null;

  const title = titleFromGender ?? titleFromPrefix ?? inferredTitle;

  if (title) {
    return `• Tratamento do titular: ${title} ${cleanName} — sempre se refira ao titular como "${title} ${cleanName}". Nunca troque "${title}" por outro tratamento nem omita.`;
  }
  return `• Tratamento do titular: Dr(a). ${cleanName} — gênero não configurado, use exatamente "Dr(a). ${cleanName}" em todas as respostas. Nunca omita o "Dr(a)." nem tente adivinhar o gênero.`;
}
