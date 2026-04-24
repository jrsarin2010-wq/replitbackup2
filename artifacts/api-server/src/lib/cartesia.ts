import axios from "axios";
import { spawn } from "child_process";
import { logger } from "./logger";
import { normalizeTtsText } from "./elevenlabs";

const CARTESIA_BASE = "https://api.cartesia.ai";
const CARTESIA_VERSION = "2024-06-10";
const PREVIEW_TEXT_SHORT = "Olá! Seja bem-vindo à nossa clínica. Como posso te ajudar hoje?";
const PREVIEW_TEXT_LONG = "Oi, tudo bem? Aqui é da clínica. Olha, eu consegui dois horários ótimos pra você: posso encaixar amanhã, terça-feira, às quatorze e trinta com a Doutora Marina, ou na quinta às dez e quinze. Os dois encaixes já incluem a avaliação inicial, e se você quiser começar o tratamento na hora, ainda dá pra fechar com um descontinho à vista. Qual desses dois fica melhor pra você?";

export interface CartesiaVoice {
  id: string;
  name: string;
  description?: string;
  language: string;
  gender?: string;
}

// Curated PT-BR voices ordered by perceived naturalness for clinic phone-style
// reception (warmer, more conversational voices first).
const CURATED_VOICES: CartesiaVoice[] = [
  { id: "1cf751f6-8749-43ab-98bd-230dd633abdb", name: "Ana Paula - Calorosa e Natural", language: "pt", gender: "feminine", description: "Voz feminina brasileira calorosa, soa como uma recepcionista real" },
  { id: "8d826d43-20ad-4c56-8d37-1048eccca1bf", name: "Larissa - Acessível e Próxima", language: "pt", gender: "feminine", description: "Voz feminina amigável, sotaque brasileiro suave para o dia a dia" },
  { id: "d4b44b9a-82bc-4b65-b456-763fce4c52f9", name: "Beatriz - Simpática e Engajada", language: "pt", gender: "feminine", description: "Voz feminina natural e envolvente, ótima para conversas longas" },
  { id: "c9611be8-aae9-4a93-bb1c-98dd6b7d52a4", name: "Isabella - Expressiva e Rica", language: "pt", gender: "feminine", description: "Voz feminina expressiva com prosódia rica, ideal para mensagens explicativas" },
  { id: "700d1ee3-a641-4018-ba6e-899dcadc9e2b", name: "Luana - Clara e Agradável", language: "pt", gender: "feminine", description: "Voz feminina clara e simpática para conversas casuais" },
  { id: "2f4d204f-a5dc-4196-81bc-155986b76ab6", name: "Mirella - Jovem e Animada", language: "pt", gender: "feminine", description: "Voz feminina jovem e animada para um tom mais leve" },
  { id: "f39bf583-3b3d-402f-9ffb-6179d9ec3e35", name: "Isabel - Confiante e Profissional", language: "pt", gender: "feminine", description: "Voz feminina firme e profissional para comunicação séria" },
  { id: "b0f46533-d4bb-493f-a26f-a99e1f2e86e3", name: "Heitor - Simpático e Próximo", language: "pt", gender: "masculine", description: "Voz masculina calorosa com charme brasileiro, soa próxima" },
  { id: "5063f45b-d9e0-4095-b056-8f3ee055d411", name: "Camilo - Suave e Acolhedor", language: "pt", gender: "masculine", description: "Voz masculina calmante e calorosa para conversas agradáveis" },
  { id: "a37639f0-2f0a-4de4-9942-875a187af878", name: "Felipe - Descontraído e Tranquilo", language: "pt", gender: "masculine", description: "Voz masculina relaxada para conversas reconfortantes" },
];

const DEFAULT_VOICE_ID = "1cf751f6-8749-43ab-98bd-230dd633abdb";

export function resolveCartesiaKey(): string | null {
  return process.env.CARTESIA_API_KEY || null;
}

function cartesiaHeaders(apiKey: string) {
  return {
    "X-API-Key": apiKey,
    "Cartesia-Version": CARTESIA_VERSION,
    "Content-Type": "application/json",
  };
}

/**
 * Strip emojis, markdown formatting, and other symbols that sound
 * awkward when read aloud by a TTS engine.
 */
export function stripForTTS(text: string): string {
  let result = text;

  // 1. Remove bullet points FIRST (before italic regex eats the * prefix)
  result = result.replace(/^[\s]*[-•]\s+/gm, "");
  result = result.replace(/^\s*\*\s+/gm, "");       // "* item" bullet
  result = result.replace(/^[\s]*\d+\.\s+/gm, "");  // "1. item" numbered list

  // 2. Collapse multiple newlines into a natural pause
  // If already ends with punctuation, just add a space; otherwise add ". "
  result = result.replace(/([.!?])\n{2,}/g, "$1 ");
  result = result.replace(/([^.!?])\n{2,}/g, "$1. ");
  // Single newlines become a comma pause
  result = result.replace(/\n/g, ", ");

  // 3. Remove markdown headers (## Título)
  result = result.replace(/^#{1,6}\s+/gm, "");

  // 4. Remove markdown links [text](url) → keep text
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // 5. Remove inline code `code` → keep content
  result = result.replace(/`([^`]+)`/g, "$1");

  // 6. Remove markdown bold/italic (**text**, *text*, __text__, _text_)
  result = result.replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1");
  result = result.replace(/_{1,3}([^_]+)_{1,3}/g, "$1");

  // 7. Remove emojis — broad Unicode ranges including misc symbols (⭐❤️🌟 etc.)
  result = result.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E0}-\u{1F1FF}\u{200D}\u{20E3}\u{FE0F}]/gu,
    ""
  );

  // 8. Remove special chars that sound odd aloud (pipe, tilde, caret)
  result = result.replace(/[|~^]/g, " ");

  // 9. Collapse multiple spaces and trim
  result = result.replace(/\s{2,}/g, " ").trim();

  return result;
}

/**
 * Splits a single very long sentence (>140 chars) on a soft conjunction (" e "
 * or " ou ") found after position 70, replacing it with ", e " / ", ou " so the
 * TTS engine inserts a breath rather than reading the whole thing in one rajada.
 * Returns text unchanged if no good split point is found.
 */
function breatheLongSentence(sentence: string): string {
  const TRIGGER_LEN = 140;
  if (sentence.length < TRIGGER_LEN) return sentence;
  // Already has plenty of commas? Don't double up.
  const commaCount = (sentence.match(/,/g) || []).length;
  if (commaCount >= 3) return sentence;

  const candidates: Array<{ idx: number; conj: string }> = [];
  const re = / (e|ou|porque|porém|mas) /gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence)) !== null) {
    if (m.index >= 60 && m.index <= sentence.length - 30) {
      candidates.push({ idx: m.index, conj: m[1] });
    }
  }
  if (candidates.length === 0) return sentence;
  // Pick the one closest to the middle for a balanced breath.
  const mid = sentence.length / 2;
  candidates.sort((a, b) => Math.abs(a.idx - mid) - Math.abs(b.idx - mid));
  const pick = candidates[0];
  // Don't double the comma if there's already one right before.
  const before = sentence.substring(0, pick.idx);
  if (/,\s*$/.test(before)) return sentence;
  const after = sentence.substring(pick.idx + 1); // skip leading space
  return `${before}, ${after}`;
}

/**
 * Add natural speech rhythm to text before TTS:
 * - Inserts breathing-like pauses at sentence transitions
 * - Adds natural connective hesitations (mas, então, por isso, ...)
 * - Softens greetings with a comma micro-pause ("Olá," instead of "Olá!")
 * - Breaks very long sentences with a comma so the TTS takes a real breath
 * This makes the TTS model generate more human-paced speech.
 */
export function addSpeechRhythm(text: string): string {
  let result = text;

  // Add a breath pause after sentence-ending punctuation before next sentence
  // The comma after period helps TTS engines pause more naturally
  result = result.replace(/([.!?])\s+([A-ZÁÉÍÓÚÀÂÊÔÃÕÇ])/g, "$1 $2");

  // Natural hesitation before contrast/transition words (em português)
  result = result.replace(/\b(mas|porém|entretanto|todavia|contudo)\s+/gi, ", $1 ");
  result = result.replace(/\b(então|portanto|assim|por isso|por conta disso)\s+/gi, ", $1 ");
  result = result.replace(/\b(além disso|inclusive|de fato|na verdade|aliás|ou seja|por exemplo)\s+/gi, ", $1 ");

  // Greetings — natural micro-pause after the name call (warm, not mechanical)
  result = result.replace(
    /^(Olá|Oi|Oie|Bom dia|Boa tarde|Boa noite|Tudo bem|E aí)([,!.]?\s)/i,
    "$1, "
  );

  // Long-sentence breathing: split each long sentence on a natural conjunction
  // so the TTS engine inhales mid-thought instead of speeding through.
  const sentenceParts = result.split(/(?<=[.!?])\s+/);
  if (sentenceParts.length > 0) {
    result = sentenceParts.map(breatheLongSentence).join(" ");
  }

  // Collapse any double/triple commas, stray comma-period sequences and extra spaces.
  result = result.replace(/,\s*,/g, ",");
  result = result.replace(/\s+,/g, ",");
  result = result.replace(/\s{2,}/g, " ").trim();

  return result;
}

/**
 * Render a soft synthetic inhale as an MP3 buffer using FFmpeg.
 *
 * This is called ONCE per process (lazily on the first applyBreathEffect call)
 * and the resulting MP3 bytes are cached in memory. Subsequent calls skip
 * FFmpeg entirely — see `applyBreathEffect` for the hot-path concat strategy.
 *
 * The output format (44.1kHz mono MP3) matches Cartesia's TTS output so the
 * two streams can be concatenated at the byte level without resampling.
 */
function renderBreathMp3(): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const proc = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel", "error",
        "-nostdin",
        // 0.45s of pink noise — shaped into a soft inhale (band-limited around
        // 300-2000Hz, smooth in/out envelope, low overall volume).
        "-f", "lavfi",
        "-t", "0.45",
        "-i", "anoisesrc=color=pink:amplitude=0.35:sample_rate=44100",
        "-af",
        "highpass=f=300,lowpass=f=2000,volume=0.18,afade=t=in:st=0:d=0.12,afade=t=out:st=0.30:d=0.15",
        "-codec:a", "libmp3lame",
        "-q:a", "5",
        "-ac", "1",
        "-ar", "44100",
        "-f", "mp3",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("ffmpeg breath render timed out"));
    }, 15000);

    proc.stdout.on("data", (c: Buffer) => chunks.push(c));
    proc.stderr.on("data", (c: Buffer) => errChunks.push(c));
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(
          new Error(
            `ffmpeg exited with code ${code}: ${Buffer.concat(errChunks).toString("utf8").slice(0, 500)}`
          )
        );
      }
    });
  });
}

let cachedBreathMp3: Buffer | null = null;
let cachedBreathPromise: Promise<Buffer> | null = null;

/**
 * Lazily get the cached breath MP3 (rendered once per process). Returns null
 * if FFmpeg failed — callers should fall back to passing audio through.
 */
async function getBreathMp3(): Promise<Buffer | null> {
  if (cachedBreathMp3) return cachedBreathMp3;
  if (!cachedBreathPromise) {
    cachedBreathPromise = renderBreathMp3()
      .then((buf) => {
        cachedBreathMp3 = buf;
        return buf;
      })
      .catch((err) => {
        logger.warn(
          { err },
          "cartesia: failed to pre-render breath MP3 — TTS will play without inhale"
        );
        cachedBreathPromise = null;
        throw err;
      });
  }
  try {
    return await cachedBreathPromise;
  } catch {
    return null;
  }
}

/**
 * Reset the cached breath MP3 — exposed for tests that want to measure cold-
 * vs. warm-path latency. Not used in production code.
 */
export function __resetBreathCacheForTests(): void {
  cachedBreathMp3 = null;
  cachedBreathPromise = null;
}

/**
 * Add a humanizing inhale to the start of a TTS MP3 buffer.
 *
 * Hot path is intentionally cheap: the inhale is rendered once via FFmpeg
 * (lazily on first call) and cached in memory. Per-call work is just an
 * in-memory `Buffer.concat`, which keeps latency well under the 500ms budget
 * defined in task #17's acceptance criteria (the FFmpeg startup alone takes
 * ~500ms on our CI hardware, so any per-call FFmpeg invocation cannot fit).
 *
 * Both streams use the same MP3 format (44.1kHz mono) as Cartesia's output,
 * so byte-level concatenation produces a valid playable MP3. The effect is
 * fail-safe: if FFmpeg is unavailable or breath rendering errored, the raw
 * audio buffer is returned unchanged.
 */
export async function applyBreathEffect(audioBuffer: Buffer): Promise<Buffer> {
  try {
    const breath = await getBreathMp3();
    if (!breath) return audioBuffer;
    return Buffer.concat([breath, audioBuffer]);
  } catch (err) {
    logger.warn({ err }, "cartesia: breath effect failed — returning raw audio");
    return audioBuffer;
  }
}

export async function listCartesiaVoices(apiKey: string): Promise<CartesiaVoice[] | { error: string }> {
  try {
    const res = await axios.get(`${CARTESIA_BASE}/voices`, {
      headers: cartesiaHeaders(apiKey),
    });

    const allVoices: Array<{ id: string; name: string; description?: string; language: string; gender?: string }> =
      Array.isArray(res.data) ? res.data : (res.data as { voices?: typeof res.data }).voices || [];

    const ptVoices: CartesiaVoice[] = allVoices
      .filter((v) => v.language && (v.language.startsWith("pt")))
      .map((v) => ({
        id: v.id,
        name: v.name,
        description: v.description,
        language: v.language,
        gender: v.gender,
      }));

    if (ptVoices.length > 0) {
      const curatedIds = new Set(CURATED_VOICES.map((c) => c.id));
      return ptVoices.map((v) => ({
        ...v,
        name: curatedIds.has(v.id)
          ? (CURATED_VOICES.find((c) => c.id === v.id)?.name || v.name)
          : v.name,
      })).sort((a, b) => {
        const aIdx = CURATED_VOICES.findIndex((c) => c.id === a.id);
        const bIdx = CURATED_VOICES.findIndex((c) => c.id === b.id);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
        return 0;
      });
    }

    return CURATED_VOICES;
  } catch (err: unknown) {
    logger.error({ err }, "Failed to list Cartesia voices");
    const axiosErr = err as { response?: { status?: number } };
    if (axiosErr?.response?.status === 401) {
      return { error: "Chave API do Cartesia inválida. Verifique em cartesia.ai → API Keys." };
    }
    return CURATED_VOICES;
  }
}

export async function cartesiaTTS(
  text: string,
  voiceId: string,
  apiKey: string
): Promise<Buffer> {
  const finalVoiceId = voiceId || DEFAULT_VOICE_ID;

  // 1. Normalize numbers/times (e.g. "15h" → "quinze horas", "15:00" → "quinze horas da tarde")
  // 2. Strip emojis and markdown
  // 3. Add natural speech rhythm (breathing-pause markers via punctuation)
  const cleanText = addSpeechRhythm(stripForTTS(normalizeTtsText(text)));

  const res = await axios.post(
    `${CARTESIA_BASE}/tts/bytes`,
    {
      transcript: cleanText,
      model_id: "sonic-2",
      voice: {
        mode: "id",
        id: finalVoiceId,
        // Humanization controls: slightly slower than default, warm and curious
        // — this combo gives the most "recepcionista real" feel in PT-BR.
        __experimental_controls: {
          speed: "slow",
          emotion: [
            "positivity:high",
            "curiosity:high",
          ],
        },
      },
      output_format: {
        container: "mp3",
        encoding: "mp3",
        sample_rate: 44100,
      },
      language: "pt",
    },
    {
      headers: {
        ...cartesiaHeaders(apiKey),
        Accept: "audio/mpeg",
      },
      responseType: "arraybuffer",
    }
  );

  const rawAudio = Buffer.from(res.data as ArrayBuffer);

  // 3. Post-process with FFmpeg: add breath + warmth
  const humanizedAudio = await applyBreathEffect(rawAudio);
  return humanizedAudio;
}

export type PreviewPhrase = "short" | "long";

export async function cartesiaPreview(
  voiceId: string,
  apiKey: string,
  phrase: PreviewPhrase = "short"
): Promise<Buffer> {
  const text = phrase === "long" ? PREVIEW_TEXT_LONG : PREVIEW_TEXT_SHORT;
  return cartesiaTTS(text, voiceId, apiKey);
}

export function getDefaultCartesiaVoiceId(): string {
  return DEFAULT_VOICE_ID;
}

export { CURATED_VOICES as CARTESIA_CURATED_VOICES };
