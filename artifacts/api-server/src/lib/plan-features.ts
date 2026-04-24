export function isBasicPlan(plan: string | null | undefined): boolean {
  return plan === "basic";
}


export function canUseSalesStrategies(plan: string | null | undefined): boolean {
  return !isBasicPlan(plan);
}

export function canUseAudio(plan: string | null | undefined): boolean {
  return !isBasicPlan(plan);
}

export function canUseRemarketing(plan: string | null | undefined): boolean {
  return !isBasicPlan(plan);
}

export function canUseVapiCalls(_plan: string | null | undefined): boolean {
  return false;
}

export function canUseAiLearning(_plan: string | null | undefined): boolean {
  return true;
}

export function canUseFollowUps(plan: string | null | undefined): boolean {
  return !isBasicPlan(plan);
}

export const EXTRA_CONVERSATIONS_PER_PROFESSIONAL = 200;

export function getMonthlyConversationsLimit(plan: string | null | undefined, maxProfessionals = 1): number {
  const extraProfessionals = Math.max(0, (maxProfessionals ?? 1) - 1);
  const extraFromProfessionals = extraProfessionals * EXTRA_CONVERSATIONS_PER_PROFESSIONAL;
  if (plan === "trial") return 50;
  if (plan === "basic") return 400 + extraFromProfessionals;
  if (plan === "essencial") return 900 + extraFromProfessionals;
  if (plan === "pro") return 1500 + extraFromProfessionals;
  return 900 + extraFromProfessionals;
}
