/**
 * Métricas de custo da IA principal (gpt-5-mini).
 *
 * Mantém um ring buffer in-memory das últimas 100 chamadas para que o painel
 * admin mostre, em tempo real:
 *   - taxa de cache hit (quanto da entrada está sendo cobrada com desconto)
 *   - nível de reasoning_effort em uso
 *
 * Não persiste em DB — é puramente um indicador "ao vivo". Reinicia em cada
 * deploy. Custo zero quando não há chamadas.
 */

const RING_SIZE = 100;

interface CallSample {
  promptTokens: number;
  cachedTokens: number;
  ts: number;
}

const ring: CallSample[] = [];

export function recordAiCall(sample: { promptTokens?: number; cachedTokens?: number }) {
  const promptTokens = Number(sample.promptTokens ?? 0);
  const cachedTokens = Number(sample.cachedTokens ?? 0);
  if (!Number.isFinite(promptTokens) || promptTokens <= 0) return;
  ring.push({ promptTokens, cachedTokens: Number.isFinite(cachedTokens) ? cachedTokens : 0, ts: Date.now() });
  if (ring.length > RING_SIZE) ring.shift();
}

export function getAiCostStats() {
  // Import local para evitar ciclo — ai-tuning não importa ai-cost-metrics.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resolveReasoningEffort } = require("./ai-tuning") as typeof import("./ai-tuning");
  const totalPrompt = ring.reduce((acc, s) => acc + s.promptTokens, 0);
  const totalCached = ring.reduce((acc, s) => acc + s.cachedTokens, 0);
  const cacheHitRate = totalPrompt > 0 ? totalCached / totalPrompt : 0;
  // Usa o mesmo resolver do runtime — assim UI e comportamento real concordam
  // mesmo se a env estiver com valor inválido (cai em "medium").
  const reasoningEffort = resolveReasoningEffort();
  return {
    samples: ring.length,
    cacheHitRate: Math.round(cacheHitRate * 1000) / 1000,
    cacheHitPct: Math.round(cacheHitRate * 100),
    totalPromptTokens: totalPrompt,
    totalCachedTokens: totalCached,
    reasoningEffort,
    windowSize: RING_SIZE,
  };
}

export function _resetAiCostMetricsForTests() {
  ring.length = 0;
}
