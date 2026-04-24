export type PlanId = "basic" | "essencial" | "pro";

export const PLAN_PRICES_CENTS: Record<PlanId, number> = {
  basic: 9700,
  essencial: 19700,
  pro: 44700,
};

export const PLAN_LABELS: Record<PlanId, string> = {
  basic: "Básico",
  essencial: "Essencial",
  pro: "Pro",
};

export const PLAN_MAX_PROFESSIONALS: Record<PlanId, number> = {
  basic: 1,
  essencial: 1,
  pro: 2,
};

export const PLAN_ORDER: PlanId[] = ["basic", "essencial", "pro"];

export function normalizePlanId(plan: string | null | undefined): PlanId | null {
  if (plan === "free" || plan === "basic" || plan === "basico") return "basic";
  if (plan === "essencial") return "essencial";
  if (plan === "pro") return "pro";
  return null;
}

export function isManagedPlan(plan: string | null | undefined): plan is PlanId {
  return normalizePlanId(plan) !== null;
}

export function comparePlans(a: PlanId, b: PlanId): number {
  return PLAN_PRICES_CENTS[a] - PLAN_PRICES_CENTS[b];
}

export interface ProrationResult {
  fromPlan: PlanId;
  targetPlan: PlanId;
  targetPriceCents: number;
  currentDailyPriceCents: number;
  daysRemaining: number;
  creditCents: number;
  finalChargeCents: number;
}

/**
 * Compute upgrade proration:
 *   credit = floor(currentMonthlyPrice / 30 * daysRemaining), >= 0
 *   finalCharge = max(0, targetMonthlyPrice - credit)
 * daysRemaining is computed as ceil((expiresAt - now) / 1 day), clamped to [0, 30].
 */
export function computeUpgradeProration(
  fromPlan: PlanId,
  targetPlan: PlanId,
  subscriptionExpiresAt: Date | null,
  now: Date = new Date(),
): ProrationResult {
  const targetPriceCents = PLAN_PRICES_CENTS[targetPlan];
  const currentMonthlyCents = PLAN_PRICES_CENTS[fromPlan];
  const currentDailyPriceCents = Math.floor(currentMonthlyCents / 30);

  let daysRemaining = 0;
  if (subscriptionExpiresAt) {
    const msLeft = subscriptionExpiresAt.getTime() - now.getTime();
    if (msLeft > 0) {
      daysRemaining = Math.min(30, Math.ceil(msLeft / (24 * 3600 * 1000)));
    }
  }

  const creditCents = Math.max(0, currentDailyPriceCents * daysRemaining);
  const finalChargeCents = Math.max(0, targetPriceCents - creditCents);

  return {
    fromPlan,
    targetPlan,
    targetPriceCents,
    currentDailyPriceCents,
    daysRemaining,
    creditCents,
    finalChargeCents,
  };
}
