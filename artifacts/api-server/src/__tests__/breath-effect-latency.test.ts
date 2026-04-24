import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";
import { join } from "path";
import { readFile, unlink } from "fs/promises";
import { applyBreathEffect, __resetBreathCacheForTests } from "../lib/cartesia.js";

const execFileP = promisify(execFile);

const MAX_LATENCY_MS = 500;

async function ffmpegAvailable(): Promise<boolean> {
  try {
    await execFileP("ffmpeg", ["-version"], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function buildSampleSpeechMp3(): Promise<Buffer> {
  const ts = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const out = join(tmpdir(), `breath_sample_${ts}.mp3`);
  try {
    await execFileP(
      "ffmpeg",
      [
        "-y",
        "-f", "lavfi",
        "-t", "5",
        "-i", "sine=frequency=220:sample_rate=44100",
        "-ac", "1",
        "-ar", "44100",
        "-codec:a", "libmp3lame",
        "-q:a", "5",
        out,
      ],
      { timeout: 10000 }
    );
    return await readFile(out);
  } finally {
    await unlink(out).catch(() => {});
  }
}

// Top-level await so we can pick `it` vs `it.skip` at file load time and
// Vitest reports an honest "skipped" status when FFmpeg is missing.
const HAS_FFMPEG = await ffmpegAvailable();
if (!HAS_FFMPEG) {
  // eslint-disable-next-line no-console
  console.warn(
    "[breath-effect-latency] ffmpeg indisponível — testes de latência serão pulados"
  );
}
const itIfFfmpeg = HAS_FFMPEG ? it : it.skip;

describe("applyBreathEffect — latência do pós-processamento", () => {
  let sample: Buffer | null = null;

  beforeAll(async () => {
    if (!HAS_FFMPEG) return;
    sample = await buildSampleSpeechMp3();
    // Warm the breath-MP3 cache so the first measured call is the steady-
    // state hot path (production processes warm this on the very first TTS
    // call too — measuring cold-start would just be measuring FFmpeg startup).
    __resetBreathCacheForTests();
    await applyBreathEffect(sample);
  }, 20000);

  itIfFfmpeg(
    `processa um buffer de ~5s em menos de ${MAX_LATENCY_MS}ms (steady-state)`,
    async () => {
      const runs = 5;
      const timings: number[] = [];
      for (let i = 0; i < runs; i++) {
        const started = performance.now();
        const out = await applyBreathEffect(sample!);
        const elapsed = performance.now() - started;
        timings.push(elapsed);
        // Sanity: o efeito deve ter retornado áudio maior que o input
        // (concat com a respiração pré-renderizada).
        expect(out.length).toBeGreaterThan(sample!.length);
      }
      const median = [...timings].sort((a, b) => a - b)[Math.floor(runs / 2)];
      // eslint-disable-next-line no-console
      console.log(
        `[breath-effect-latency] timings(ms)=${timings
          .map((t) => t.toFixed(1))
          .join(",")} median=${median.toFixed(1)}`
      );
      expect(median).toBeLessThan(MAX_LATENCY_MS);
    },
    30000
  );

  itIfFfmpeg(
    "produz áudio sem erros mesmo após reset do cache (cold path)",
    async () => {
      __resetBreathCacheForTests();
      const out = await applyBreathEffect(sample!);
      expect(out.length).toBeGreaterThan(sample!.length);
    },
    30000
  );
});
