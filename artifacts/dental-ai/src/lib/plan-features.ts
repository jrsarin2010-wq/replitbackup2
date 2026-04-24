export type PlanType = "basic" | "premium" | "trial" | "essencial" | "pro";

export interface PlanFeatures {
  aiScheduling: boolean;
  followUp: boolean;
  remarketing: boolean;
  patientRecovery: boolean;
  reports: boolean;
  financeiro: boolean;
  audioCredits: boolean;
  audioMode: boolean;
  conversations: boolean;
  leads: boolean;
  telegram: boolean;
  salesStrategies: boolean;
  vapiCalls: boolean;
  aiLearning: boolean;
  riskControl: boolean;
  resultados: boolean;
}

const BASIC_FEATURES: PlanFeatures = {
  aiScheduling: true,
  followUp: false,
  remarketing: false,
  patientRecovery: false,
  reports: false,
  financeiro: false,
  audioCredits: false,
  audioMode: false,
  conversations: true,
  leads: false,
  telegram: true,
  salesStrategies: false,
  vapiCalls: false,
  aiLearning: true,
  riskControl: false,
  resultados: false,
};

const ESSENCIAL_FEATURES: PlanFeatures = {
  aiScheduling: true,
  followUp: true,
  remarketing: true,
  patientRecovery: false,
  reports: false,
  financeiro: false,
  audioCredits: true,
  audioMode: true,
  conversations: true,
  leads: true,
  telegram: true,
  salesStrategies: true,
  vapiCalls: false,
  aiLearning: true,
  riskControl: false,
  resultados: false,
};

const ALL_FEATURES: PlanFeatures = {
  aiScheduling: true,
  followUp: true,
  remarketing: true,
  patientRecovery: true,
  reports: true,
  financeiro: true,
  audioCredits: true,
  audioMode: true,
  conversations: true,
  leads: true,
  telegram: true,
  salesStrategies: true,
  vapiCalls: false,
  aiLearning: true,
  riskControl: true,
  resultados: true,
};

export function getPlanFeatures(plan?: string | null): PlanFeatures {
  if (plan === "basic") return BASIC_FEATURES;
  if (plan === "essencial") return ESSENCIAL_FEATURES;
  return ALL_FEATURES;
}

export function getPlanLabel(plan?: string | null): string {
  if (plan === "basic") return "Básico";
  if (plan === "essencial") return "Essencial";
  if (plan === "pro") return "Pro";
  return "Premium";
}

export function getPlanPrice(plan?: string | null): string {
  if (plan === "basic") return "R$ 97,00 / mês";
  if (plan === "essencial") return "R$ 197,00 / mês";
  if (plan === "pro") return "R$ 447,00 / mês";
  return "R$ 197,00 / mês";
}

export function getPlanOriginalPrice(plan?: string | null): string | null {
  if (plan === "basic") return "R$ 197,00";
  if (plan === "essencial") return "R$ 297,00";
  if (plan === "pro") return null;
  return null;
}

export function getPlanPromoLabel(plan?: string | null): string | null {
  if (plan === "basic") return "Promoção: R$97/mês por 3 meses — após, R$197/mês";
  if (plan === "essencial") return "Promoção: R$197/mês por 3 meses — após, R$297/mês";
  if (plan === "pro") return null;
  return null;
}

export function isBasicPlan(plan?: string | null): boolean {
  return plan === "basic";
}


export const CONVERSATIONS_PER_EXTRA_PROFESSIONAL = 200;

export function getMonthlyConversationsLimit(plan?: string | null, maxProfessionals = 1): number {
  const extraProfessionals = Math.max(0, (maxProfessionals ?? 1) - 1);
  const extraFromProfessionals = extraProfessionals * CONVERSATIONS_PER_EXTRA_PROFESSIONAL;
  if (plan === "trial") return 50;
  if (plan === "basic") return 400 + extraFromProfessionals;
  if (plan === "essencial") return 900 + extraFromProfessionals;
  if (plan === "pro") return 1500 + extraFromProfessionals;
  return 900 + extraFromProfessionals;
}
export const CONVERSATION_RECHARGE_AMOUNT = 400;
export const CONVERSATION_RECHARGE_PRICE_LABEL = "R$47";

/** Returns a human-readable label for the included monthly conversation quota. */
export function getMonthlyConversationsLabel(plan?: string | null, maxProfessionals = 1): string {
  const limit = getMonthlyConversationsLimit(plan, maxProfessionals);
  return `${limit.toLocaleString("pt-BR")} conversas/mês incluídas`;
}

/** Explains what "conversa" means — shown in plan cards to avoid confusion with "mensagem". */
export const CONVERSATION_DEFINITION_NOTE =
  `💬 1 conversa = todas as mensagens trocadas com 1 paciente em até 24h — não uma mensagem avulsa.`;

/** Reusable copy for the "extra professional" rule shown in plan cards. */
export const EXTRA_PROFESSIONAL_CONVERSATIONS_NOTE =
  `+${CONVERSATIONS_PER_EXTRA_PROFESSIONAL} conversas/mês por profissional adicional`;

/** Reusable copy for the conversation recharge offering shown in plan cards. */
export const CONVERSATION_RECHARGE_NOTE =
  `Recarga: ${CONVERSATION_RECHARGE_AMOUNT} conversas extras por ${CONVERSATION_RECHARGE_PRICE_LABEL} via PIX`;
