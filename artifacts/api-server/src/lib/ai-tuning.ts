/**
 * Helpers de otimização de custo do gpt-5.4-mini.
 *
 * - resolveReasoningEffort: lê AI_REASONING_EFFORT (default: "medium" — sem mudança).
 *   Valores aceitos: "minimal" | "low" | "medium" | "high".
 * - buildGpt5Extras: monta os parâmetros opcionais (`prompt_cache_key`,
 *   `reasoning_effort`) que vão para `chat.completions.create`. Quando o
 *   reasoning_effort é o default ("medium"), o parâmetro NÃO é enviado, para
 *   manter o comportamento idêntico ao atual.
 * - bumpTokensForLowReasoning: quando reasoning é "low" / "minimal", o modelo
 *   usa menos tokens internos de raciocínio — sobra orçamento, então
 *   aumentamos o teto da resposta em ~200 para evitar truncamento.
 */

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

const VALID: ReadonlySet<ReasoningEffort> = new Set(["minimal", "low", "medium", "high"]);

export function resolveReasoningEffort(): ReasoningEffort {
  const raw = (process.env.AI_REASONING_EFFORT ?? "medium").toLowerCase();
  return (VALID.has(raw as ReasoningEffort) ? raw : "medium") as ReasoningEffort;
}

export function buildGpt5Extras(opts: { tenantId?: number | string; namespace?: string }): Record<string, unknown> {
  const extras: Record<string, unknown> = {};
  if (opts.tenantId !== undefined && opts.tenantId !== null) {
    const ns = opts.namespace ?? "tenant";
    extras.prompt_cache_key = `${ns}-${opts.tenantId}`;
  }
  const effort = resolveReasoningEffort();
  // Só enviamos o parâmetro quando o operador explicitamente configurou algo
  // diferente do default — assim, sem env, o comportamento permanece idêntico
  // ao de antes da Task #20.
  if ((process.env.AI_REASONING_EFFORT ?? "").toLowerCase() && VALID.has(effort)) {
    extras.reasoning_effort = effort;
  }
  return extras;
}

export function bumpTokensForLowReasoning(maxTokens: number): number {
  const effort = resolveReasoningEffort();
  if (effort === "low" || effort === "minimal") return maxTokens + 200;
  return maxTokens;
}
