import axios from "axios";
import { logger } from "./logger";

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";
const PREVIEW_TEXT_SHORT = "Olá, seja bem-vindo à nossa clínica! Como posso ajudar você hoje?";
const PREVIEW_TEXT_LONG = "Oi, tudo bem? Aqui é da clínica. Olha, eu consegui dois horários ótimos pra você: posso encaixar amanhã, terça-feira, às quatorze e trinta com a Doutora Marina, ou na quinta às dez e quinze. Os dois encaixes já incluem a avaliação inicial, e se você quiser começar o tratamento na hora, ainda dá pra fechar com um descontinho à vista. Qual desses dois fica melhor pra você?";

export type PreviewPhrase = "short" | "long";

export function resolveElevenLabsKey(tenantKey: string | null | undefined): string | null {
  return tenantKey || process.env.ELEVENLABS_API_KEY || null;
}

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  labels: Record<string, string>;
  preview_url: string;
}

export interface ElevenLabsSharedVoice {
  voice_id: string;
  name: string;
  accent: string;
  gender: string;
  age: string;
  descriptive: string;
  use_case: string;
  category: string;
  language: string;
  locale: string;
  description: string;
  preview_url: string;
}

export interface BrazilianVoice {
  voiceId: string;
  name: string;
  category: string;
  accent: string;
  gender: string;
  previewUrl: string;
  description?: string;
}

function parseElevenLabsError(err: unknown): { error: string } {
  const axiosErr = err as { response?: { data?: { detail?: { message?: string; status?: string } | string } }; message?: string };
  const detail = axiosErr?.response?.data?.detail;
  if (typeof detail === "object" && detail?.status === "missing_permissions") {
    return { error: `Permissão ausente na chave API: ${detail.message || "voices_read"}. Crie uma nova chave sem restrições em elevenlabs.io → Profile → API Keys.` };
  }
  if (typeof detail === "object" && detail?.status === "invalid_api_key") {
    return { error: "Chave API inválida. Verifique e cole novamente em Configurações → Audio." };
  }
  return { error: axiosErr?.message || "Erro ao conectar com ElevenLabs." };
}

const CURATED_VOICES: BrazilianVoice[] = [
  { voiceId: "33B4UnXyTNbgLmdEDh5P", name: "Keren - Jovem Brasileira", category: "professional", accent: "brasileiro", gender: "female", previewUrl: "", description: "Voz feminina jovem brasileira (requer plano pago)" },
  { voiceId: "EXAVITQu4vr4xnSDxMaL", name: "Sarah - Madura e Confiante", category: "premade", accent: "brasileiro", gender: "female", previewUrl: "", description: "Voz feminina madura e segura (plano free)" },
  { voiceId: "cgSgspJ2msm6clMCkdW9", name: "Jessica - Alegre e Calorosa", category: "premade", accent: "brasileiro", gender: "female", previewUrl: "", description: "Voz feminina alegre e acolhedora (plano free)" },
  { voiceId: "hpp4J3VqNfWAUOO0d1Us", name: "Bella - Profissional e Calorosa", category: "premade", accent: "brasileiro", gender: "female", previewUrl: "", description: "Voz feminina profissional e simpática (plano free)" },
  { voiceId: "pFZP5JQG7iQjIQuC4Bku", name: "Lily - Suave e Elegante", category: "premade", accent: "brasileiro", gender: "female", previewUrl: "", description: "Voz feminina suave e sofisticada (plano free)" },
  { voiceId: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice - Clara e Educadora", category: "premade", accent: "brasileiro", gender: "female", previewUrl: "", description: "Voz feminina clara e didática (plano free)" },
  { voiceId: "XrExE9yKIg1WjnnlVkGX", name: "Matilda - Profissional e Séria", category: "premade", accent: "brasileiro", gender: "female", previewUrl: "", description: "Voz feminina profissional e conhecedora (plano free)" },
  { voiceId: "cjVigY5qzO86Huf0OWal", name: "Eric - Suave e Confiável", category: "premade", accent: "brasileiro", gender: "male", previewUrl: "", description: "Voz masculina suave e confiável (plano free)" },
  { voiceId: "nPczCjzI2devNBz1zQrb", name: "Brian - Profundo e Acolhedor", category: "premade", accent: "brasileiro", gender: "male", previewUrl: "", description: "Voz masculina profunda e confortante (plano free)" },
  { voiceId: "JBFqnCBsd6RMkjVDRZzb", name: "George - Narrador Caloroso", category: "premade", accent: "brasileiro", gender: "male", previewUrl: "", description: "Voz masculina calorosa e envolvente (plano free)" },
];

export async function listBrazilianVoices(apiKey: string): Promise<BrazilianVoice[] | { error: string }> {
  try {
    const ownRes = await axios.get(`${ELEVENLABS_BASE}/voices`, {
      headers: { "xi-api-key": apiKey },
    });
    const ownVoiceIds = new Set(
      ((ownRes.data as { voices: ElevenLabsVoice[] }).voices || []).map((v) => v.voice_id)
    );

    return CURATED_VOICES.map((v) => ({
      ...v,
      name: ownVoiceIds.has(v.voiceId) ? `⭐ ${v.name}` : v.name,
    }));
  } catch (err: unknown) {
    logger.error({ err }, "Failed to list ElevenLabs voices");
    return parseElevenLabsError(err);
  }
}

export async function textToSpeech(
  text: string,
  voiceId: string,
  apiKey: string
): Promise<Buffer> {
  const res = await axios.post(
    `${ELEVENLABS_BASE}/text-to-speech/${voiceId}`,
    {
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
      },
    },
    {
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      responseType: "arraybuffer",
    }
  );

  return Buffer.from(res.data as ArrayBuffer);
}

export async function generatePreview(
  voiceId: string,
  apiKey: string,
  phrase: PreviewPhrase = "short"
): Promise<Buffer> {
  const rawText = phrase === "long" ? PREVIEW_TEXT_LONG : PREVIEW_TEXT_SHORT;
  // Dynamic import avoids circular dep (cartesia.ts already imports from this file).
  const { stripForTTS, addSpeechRhythm, applyBreathEffect } = await import("./cartesia");
  const cleanText = addSpeechRhythm(stripForTTS(normalizeTtsText(rawText)));
  const rawAudio = await textToSpeech(cleanText, voiceId, apiKey);
  const humanized = await applyBreathEffect(rawAudio);
  return humanized;
}

export function countCharacters(text: string): number {
  return text.length;
}

const UNITS = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
const TEENS = ["dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const TENS = ["", "", "vinte", "trinta", "quarenta", "cinquenta"];

function numberToWords(n: number): string {
  if (n === 0) return "zero";
  if (n < 10) return UNITS[n];
  if (n < 20) return TEENS[n - 10];
  if (n < 60) {
    const t = Math.floor(n / 10);
    const u = n % 10;
    return u === 0 ? TENS[t] : `${TENS[t]} e ${UNITS[u]}`;
  }
  return String(n);
}

function timeToWords(h: number, m: number): string {
  const hWord = numberToWords(h);
  if (m === 0) {
    if (h === 1) return `${hWord} hora`;
    return `${hWord} horas`;
  }
  const mWord = numberToWords(m);
  return `${hWord} e ${mWord}`;
}

export function normalizeTtsText(text: string): string {
  let result = text;

  result = result.replace(/(\d{1,2}):(\d{2})\s*(d[ae]\s+manh[ãa]|d[ae]\s+tarde|d[ae]\s+noite|h(?:s|oras?)?)/gi, (_m, hStr, mStr, suffix) => {
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    const time = timeToWords(h, m);
    const cleanSuffix = suffix.replace(/^h(?:s|oras?)?$/i, "").trim();
    if (cleanSuffix) {
      const normalized = cleanSuffix.replace(/^de\s+/i, "da ").replace(/^da\s+manh[ãa]$/i, "da manhã").replace(/^da\s+tarde$/i, "da tarde").replace(/^da\s+noite$/i, "da noite");
      return `${time} ${normalized}`;
    }
    if (h < 12) return `${time} da manhã`;
    if (h < 19) return `${time} da tarde`;
    return `${time} da noite`;
  });

  result = result.replace(/(\d{1,2}):(\d{2})/g, (_m, hStr, mStr) => {
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    const time = timeToWords(h, m);
    if (h < 12) return `${time} da manhã`;
    if (h < 19) return `${time} da tarde`;
    return `${time} da noite`;
  });

  result = result.replace(/R\$\s?(\d{1,3}(?:\.\d{3})*),(\d{2})/g, (_m, intPart, cents) => {
    const value = parseInt(intPart.replace(/\./g, ""), 10);
    const c = parseInt(cents, 10);
    let r = `${value} reais`;
    if (c > 0) r += ` e ${c} centavos`;
    return r;
  });
  result = result.replace(/R\$\s?(\d{1,3}(?:\.\d{3})*)/g, (_m, intPart) => {
    const value = parseInt(intPart.replace(/\./g, ""), 10);
    return `${value} reais`;
  });

  // "15h", "10h", "9h" → "quinze horas", "dez horas", "nove horas"
  result = result.replace(/\b(\d{1,2})h\b/gi, (_m, hStr) => {
    const h = parseInt(hStr, 10);
    const hWord = numberToWords(h);
    return `${hWord} ${h === 1 ? "hora" : "horas"}`;
  });

  result = result.replace(/\bhs\b/gi, "horas");
  result = result.replace(/\bhr\b/gi, "hora");
  result = result.replace(/\bmin\b/gi, "minutos");
  result = result.replace(/\bDr\(a\)\.(?=[\s,!?;:]|$)/g, "Doutor");
  result = result.replace(/\bDra\.(?=[\s,!?;:]|$)/g, "Doutora");
  result = result.replace(/\bDr\.(?=[\s,!?;:]|$)/g, "Doutor");

  // "12x", "6X", "3 x" → "12 vezes", "6 vezes", "3 vezes"
  // \b after x ensures we don't match "12x12" (dimension) or "12x zoom"
  result = result.replace(/(\d+)\s*[xX]\b/g, "$1 vezes");

  return result;
}
