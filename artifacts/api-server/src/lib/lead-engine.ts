import { db } from "@workspace/db";
import {
  dentalLeadsTable,
  dentalActivityTable,
  dentalProceduresTable,
  dentalSettingsTable,
  dentalMessagesTable,
  aiStrategyAnalyticsTable,
} from "@workspace/db";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { logger } from "./logger";
import { classifyLeadTemperature } from "./intent-detector";
import { getCachedSettings, TenantCache } from "./cache";
import type { Intent } from "./schedule-engine";
import {
  recordStrategyAnalytics,
} from "./ai-learning";

export type SalesStrategy = "spin_situacao" | "spin_problema" | "spin_implicacao" | "spin_necessidade" | "social_proof" | "scarcity" | "reciprocity" | "urgency" | "pain_agitation" | "consultative" | "benefit_focused" | "follow_up_gentle" | "reactivation" | "future_pacing" | "loss_aversion" | "price_anchoring" | "micro_commitment" | "authority_positioning" | "educational_trust" | "storytelling" | "comparison_cost";

export type ContactType = "patient" | "lead" | "unknown";

export interface ConversationContext {
  tenantId: number;
  conversationId: number;
  contactPhone: string;
  contactName?: string;
  contactType: ContactType;
  patientId?: number;
  leadId?: number;
}

export interface StrategyScore {
  strategy: SalesStrategy;
  successRate: number;
  totalUses: number;
}

const topStrategiesCache = new TenantCache<StrategyScore[]>("top-strategies", 900);

export const SALES_STRATEGIES: Record<SalesStrategy, string> = {
  spin_situacao: "SPIN - SITUACAO: Faca perguntas abertas para entender o contexto do lead. Exemplos: 'Ha quanto tempo ta sentindo isso?', 'Voce ja fez algum tratamento parecido antes?', 'Como ta sua rotina de cuidados com os dentes?'. Objetivo: coletar informacoes sobre a realidade do lead SEM vender nada ainda.",
  spin_problema: "SPIN - PROBLEMA: Identifique e explore o problema especifico do lead. Exemplos: 'Isso te incomoda no dia a dia, ne?', 'Aposto que isso atrapalha na hora de comer/sorrir', 'E chato ficar com essa preocupacao, ne?'. Objetivo: fazer o lead SENTIR o problema e verbalizar o incomodo.",
  spin_implicacao: "SPIN - IMPLICACAO: Mostre as consequencias de nao resolver o problema. Exemplos: 'Se deixar muito tempo, pode complicar e sair mais caro depois', 'Esse tipo de coisa tende a piorar se nao tratar logo', 'Muita gente deixa pra depois e acaba precisando de um tratamento mais invasivo'. Objetivo: gerar senso de urgencia REAL sem pressionar.",
  spin_necessidade: "SPIN - NECESSIDADE DE SOLUCAO: Apresente a solucao e conduza ao agendamento. Exemplos: 'A boa noticia e que resolve rapido e sem dor', 'Imagina poder sorrir sem preocupacao? A gente resolve isso pra voce', 'Consegui um encaixe especial pra voce'. Objetivo: mostrar que a clinica e a solucao e converter em agendamento.",
  social_proof: "Use prova social: mencione que muitos pacientes na regiao ja fizeram o procedimento e ficaram satisfeitos. Ex: 'Temos mais de X pacientes satisfeitos com esse tratamento este mes!'",
  scarcity: "Use escassez real e contundente: diga 'restam apenas X vagas esta semana', 'este e o ultimo horario disponivel para amanha', 'temos pacientes na fila de espera para esse horario'. Use a tecnica de reserva temporaria: 'Vou reservar esse horario para voce por 30 minutos enquanto decide'. Nao invente dados falsos, mas destaque fortemente a limitacao real de vagas.",
  reciprocity: "Ofereca valor primeiro: de uma dica de saude bucal gratuita, oferte uma avaliacao sem compromisso, ou compartilhe informacao util antes de sugerir agendamento.",
  urgency: "Crie urgencia com honestidade: explique que adiar tratamentos dentarios pode agravar o problema e aumentar o custo. Priorize horarios proximos (HOJE > AMANHA > proximo dia util). Se o lead sugerir data distante, redirecione com empatia: 'Entendo! Mas como a agenda ta concorrida, recomendo garantir logo.' NUNCA minta que a clinica so atende em determinado dia — sempre diga a verdade sobre os dias disponiveis.",
  pain_agitation: "Explore a dor: pergunte sobre o desconforto do lead, empatize com o problema, e mostre como o tratamento resolve definitivamente.",
  consultative: "Venda consultiva: faca perguntas abertas para entender as necessidades reais, oferte solucoes personalizadas, posicione-se como consultor de saude bucal.",
  benefit_focused: "Foque em beneficios: destaque como o sorriso impacta autoestima, carreira e relacionamentos. Transforme caracteristicas tecnicas em beneficios emocionais.",
  follow_up_gentle: "Follow-up suave: retome o contato de forma amigavel, pergunte como o lead esta, relembre do interesse demonstrado sem ser invasivo.",
  reactivation: "Reativacao: para leads frios, oferte algo novo (procedimento, tecnologia, condicao especial) como motivo natural para retomar o contato.",
  future_pacing: "FUTURE PACING: Projete o lead para o futuro apos o tratamento. Exemplos: 'Imagina voce sorrindo com confianca nas fotos da sua formatura', 'Como seria seu dia a dia sem essa dor de dente?', 'Pensa em como voce vai se sentir quando puder comer sem desconforto'. Objetivo: criar uma visao emocional positiva do resultado, ideal para leads esteticos e emocionais.",
  loss_aversion: "AVERSAO A PERDA: Enfatize o que o lead perde ao nao agir. Exemplos: 'Cada mes sem tratar pode comprometer mais o dente vizinho', 'Voce ja investiu tempo pesquisando — nao deixe isso virar so um plano', 'Quem adia perde a oportunidade de resolver com um tratamento simples'. Objetivo: ativar o medo de perda (mais poderoso que ganho) para impulsionar a decisao.",
  price_anchoring: "ANCORAGEM DE PRECO: Contextualize o valor do tratamento para parecer acessivel. Exemplos: 'E menos que uma consulta com especialista particular', 'Parcelado fica menos de um cafezinho por dia', 'Comparado ao custo de extrair e colocar implante depois, sai muito mais em conta agora'. Objetivo: reposicionar a percepcao de preco usando comparacoes concretas do cotidiano.",
  micro_commitment: "MICRO COMPROMISSO: Obtenha pequenos 'sins' antes de pedir o agendamento. Exemplos: 'Posso te contar rapidinho como funciona a avaliacao?', 'Voce prefere pela manha ou a tarde?', 'So para eu entender melhor: e mais o desconforto ou a estetica que te preocupa?'. Objetivo: reduzir a resistencia do lead quente que trava, criando comprometimento progressivo com passos minimos.",
  authority_positioning: "POSICIONAMENTO DE AUTORIDADE: Reforce a credibilidade da clinica com dados e especializacao. Exemplos: 'Nossa equipe e especializada em casos assim ha mais de X anos', 'Utilizamos a mesma tecnologia de clinicas referencia no Brasil', 'Ja tratamos mais de X pacientes com esse tipo de queixa'. Objetivo: construir confianca com leads frios que precisam de seguranca antes de decidir.",
  educational_trust: "CONFIANCA EDUCACIONAL: Eduque o lead sobre o problema e o tratamento para diminuir o medo. Exemplos: 'Muita gente tem medo, mas com anestesia local voce praticamente nao sente nada', 'Deixa eu te explicar como e o processo — e muito mais simples do que parece', 'Esse procedimento e um dos mais comuns que fazemos, dura menos de 1 hora'. Objetivo: transformar medo e duvida em confianca atraves da informacao clara e acolhedora.",
  storytelling: "STORYTELLING: Conte uma historia de um paciente semelhante ao lead (sem identificar). Exemplos: 'Tivemos uma paciente com a mesma situacao, que ficou meses postergando e quando veio resolver, ficou encantada com o resultado', 'A maioria das pessoas que atendemos com esse tipo de queixa diz que so arrependeu de nao ter feito antes'. Objetivo: usar narrativa para criar identificacao emocional e reduzir resistencia, especialmente eficaz para leads esteticos.",
  comparison_cost: "COMPARACAO DE CUSTO: Compare o custo do tratamento com as consequencias de nao tratar. Exemplos: 'Tratar agora custa X. Deixar piorar e precisar de implante pode custar 5x mais', 'Alem do custo financeiro, pense no custo de continuar com dor ou sem conseguir mastigar bem', 'Investir em prevencao e sempre mais barato que tratamento de emergencia'. Objetivo: justificar o investimento mostrando que o custo de nao agir e maior, especialmente para objecoes de preco.",
};

export async function getTopStrategies(tenantId: number, limit = 3): Promise<StrategyScore[]> {
  const cached = await topStrategiesCache.get(tenantId);
  if (cached !== undefined) return cached.slice(0, limit);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const activities = await db.query.dentalActivityTable.findMany({
    where: and(
      eq(dentalActivityTable.tenantId, tenantId),
      eq(dentalActivityTable.type, "ai_strategy"),
      gte(dentalActivityTable.createdAt, thirtyDaysAgo)
    ),
  });

  const strategyMap = new Map<string, { total: number; positive: number }>();

  for (const act of activities) {
    if (!act.metadata) continue;
    try {
      const meta = JSON.parse(act.metadata);
      const key = meta.strategy as string;
      if (!key) continue;
      const entry = strategyMap.get(key) || { total: 0, positive: 0 };
      entry.total++;
      if (meta.outcome === "positive") entry.positive++;
      strategyMap.set(key, entry);
    } catch {}
  }

  const scores: StrategyScore[] = [];
  for (const [strategy, data] of strategyMap) {
    if (data.total >= 2) {
      scores.push({
        strategy: strategy as SalesStrategy,
        successRate: data.positive / data.total,
        totalUses: data.total,
      });
    }
  }

  scores.sort((a, b) => b.successRate - a.successRate);
  await topStrategiesCache.set(tenantId, scores);
  return scores.slice(0, limit);
}

// Regex to detect when a contact has declared they use an insurance plan (convênio).
// Used consistently across modules — do not duplicate this pattern.
// IMPORTANT — false positive prevention:
// Bare "plano" / "convênio" excluded (matches questions like "atendem plano?").
// "tenho plano" and "meu plano" excluded without a dental qualifier — they also
// match non-insurance uses: "tenho plano de visitar", "meu plano é ir semana
// que vem", "tenho plano de pagar parcelado". Dental context must be explicit.
// Bare "plano"/"tenho plano"/"meu plano" responses to the triage question are
// handled contextually via `isBareInsuranceAnswer` in ai-engine.ts.
// Specific plan names (unimed, amil, etc.) remain reliable standalone signals.
// Negative lookahead on `tenho\s*plano`: blocks "tenho plano de [non-dental]"
// (e.g., "tenho plano de pagar", "tenho plano de visitar") while allowing
// "tenho plano", "tenho plano de saúde", "tenho plano odontológico".
// `meu\s*plano` requires explicit dental qualifier — "meu plano é unimed" is
// still captured via the "unimed" alternative; "meu plano é ir semana que vem"
// is correctly ignored.
export const INSURANCE_DECLARED_PATTERN = /\b(no\s*plano|com\s*plano|pelo\s*plano|pelo\s*conv[eê]nio|tenho\s*(?:o\s*)?plano(?!\s+de\s+(?!(?:sa[uú]de|odontol[oó]gico|dental|bucal)))|(?:uso|usar)\s*(?:(?:o|meu)\s*)?plano|meu\s*plano\s+(?:odontol[oó]gico|dental|bucal|de\s*sa[uú]de(?:\s*bucal)?)|tenho\s*(?:o\s*)?conv[eê]nio|(?:uso|usar)\s*(?:(?:o|meu)\s*)?conv[eê]nio|meu\s*conv[eê]nio|por\s*conv[eê]nio|e\s*pelo\s*(?:meu\s*)?(?:plano|conv[eê]nio)|conv[eê]nio\s*(?:do|da)\s*(?:trabalho|empresa)|plano\s*(?:do|da)\s*(?:trabalho|empresa)|unimed|amil|bradesco\s*(?:sa[uú]de|dental|odontol[oó]gico)|sul\s*am[eé]rica|hapvida|notredame|interm[eé]dica|gndi|porto\s*seguro\s*sa[uú]de|assim\s*sa[uú]de|cassi|geap|fusex|samp|postal\s*sa[uú]de|sa[uú]de\s*caixa|ipes|prontomed)\b/i;

// Regex to detect when a contact has explicitly declared they will pay privately (particular).
// Used to mark the plano/particular triage as complete when the answer is "particular".
//
// IMPORTANT: bare "particular" alone is too broad — it matches questions
// ("atende particular?"), adjectives ("consulta particular urgente",
// "consultório particular") and other non-declarative uses, falsely closing
// the triage and skipping the convênio question. We require either:
//   - a declarative verb/preposition before "particular" (sou/é/será/vai
//     ser/fica/vou/vou de/pago/pagar/prefiro/faço ...particular)
//   - "particular mesmo" as a reinforcing suffix
//   - or one of the explicit "sem plano/convenio", "não tenho/uso plano",
//     "por conta própria" forms.
//
// The bare single-word answer "particular" (response to "plano ou particular?")
// is detected separately via `isBareParticularAnswer` and handled
// contextually by ai-engine.ts when the previous AI message asked the
// triage question.
export const PRIVATE_DECLARED_PATTERN = /\b(?:(?:sou|[eé]|ser[aá]|vai\s+ser|fica|ficar[aá]|vou(?:\s+(?:de|ir|pagar|fazer))?|vamos|pago|paga|pagar|pagarei|fa[cç]o|prefiro)\s+particular|particular\s+mesm[ao]|sem\s+(?:plano|conv[eê]nio)|n[aã]o\s+(?:tenho|uso)\s+(?:plano|conv[eê]nio)|por\s+conta\s+pr[oó]pria)\b/i;

/**
 * True when the message is just the word "particular" (with optional
 * punctuation/whitespace) — typical answer to "plano ou particular?".
 *
 * This is intentionally separate from PRIVATE_DECLARED_PATTERN: ai-engine
 * combines it with the prior outbound message check so that a bare
 * "particular" only counts as a declaration when the AI actually asked
 * the triage question (avoids false positives in unrelated contexts).
 */
export function isBareParticularAnswer(text: string): boolean {
  if (!text) return false;
  return /^\s*particular[\s.!?,;:]*$/i.test(text);
}

/**
 * True when the message is just "plano" or "convênio" — typical answer to
 * "plano ou particular?". Handled contextually in ai-engine.ts; intentionally
 * separate from INSURANCE_DECLARED_PATTERN to avoid false positives in
 * questions like "atende plano?" / "aceita convênio?".
 */
export function isBareInsuranceAnswer(text: string): boolean {
  if (!text) return false;
  // Matches solo "plano" / "convênio" or short declarative forms like
  // "tenho plano" / "tenho o plano" / "meu plano" — all typical bare
  // answers to the "plano ou particular?" triage question.
  return /^\s*(?:(?:tenho\s+(?:o\s+)?|meu\s+)?(?:plano|conv[eê]nio))[\s.!?,;:]*$/i.test(text);
}

// Negation guard: phrases like "nao tenho plano" / "sem plano" / "nao uso convenio"
// would falsely match INSURANCE_DECLARED_PATTERN due to the bare "plano|convenio"
// alternatives. We strip these out before testing for insurance declaration.
const NEGATED_PLAN_PATTERN = /\b(?:n[aã]o\s+(?:tenho|uso|tem)\s+(?:o\s+|nenhum\s+)?(?:plano|conv[eê]nio)s?|sem\s+(?:plano|conv[eê]nio)s?)\b/gi;

/** True when the text declares the contact uses an insurance plan, ignoring negated mentions. */
export function detectsInsuranceDeclaration(text: string): boolean {
  if (!text) return false;
  const cleaned = text.replace(NEGATED_PLAN_PATTERN, " ");
  return INSURANCE_DECLARED_PATTERN.test(cleaned);
}

// ── resolveInsuranceMode ──────────────────────────────────────────────────────
// Single source of truth for convênio/particular triage detection.
// Used by both ai-engine.ts (schedule override) and prompt-builder.ts (prompt generation).
// Pure function — no DB access, no side effects.

export interface InsuranceModeParams {
  /** Whether the clinic (or any of its professionals) accepts insurance plans. */
  clinicAcceptsInsurance: boolean;
  /** Persisted paymentType from DB: "insurance" | "private" | null. */
  persistedPaymentType: string | null;
  /** Current inbound message from the contact. */
  currentMessage: string;
  /** Conversation history messages to scan for prior declarations. */
  historyMessages: ReadonlyArray<{ content: string }>;
}

export interface InsuranceModeResult {
  /** Contact declared they use an insurance plan (plano/convênio). */
  isInsurance: boolean;
  /** Contact declared they will pay privately (particular). */
  isPrivate: boolean;
  /** Either isInsurance or isPrivate — triage question has been answered. */
  triageComplete: boolean;
  /** Clinic accepts insurance AND triage has NOT been answered yet. */
  triageNeeded: boolean;
}

/**
 * Resolves the insurance/private triage state for a contact.
 *
 * Evidence is merged additively (OR-based): a declaration found in any source
 * (persistedPaymentType, currentMessage regex, or historyMessages regex) sets
 * the corresponding flag to true. This means isInsurance and isPrivate can
 * both be true when conflicting evidence exists across different sources.
 *
 * When clinicAcceptsInsurance=false, all fields are false (no triage needed).
 */
export function resolveInsuranceMode(params: InsuranceModeParams): InsuranceModeResult {
  const { clinicAcceptsInsurance, persistedPaymentType, currentMessage, historyMessages } = params;

  if (!clinicAcceptsInsurance) {
    return { isInsurance: false, isPrivate: false, triageComplete: false, triageNeeded: false };
  }

  // Also accept bare-answer messages ("particular" alone, "plano" alone, etc.)
  // as triage signals when present in history. These are intentionally rejected
  // by PRIVATE_DECLARED_PATTERN / INSURANCE_DECLARED_PATTERN to avoid false
  // positives in standalone questions, but in conversational history a solo
  // "particular" is almost certainly an answer to "plano ou particular?".
  // This is a safety net for the case where persisted paymentType failed to
  // write (race) or was cleared — prevents the triage loop bug.
  const insuranceMentionedInHistory = historyMessages.some(
    (m) => detectsInsuranceDeclaration(m.content) || isBareInsuranceAnswer(m.content),
  );
  const privateMentionedInHistory = historyMessages.some(
    (m) => PRIVATE_DECLARED_PATTERN.test(m.content) || isBareParticularAnswer(m.content),
  );

  const isInsurance =
    persistedPaymentType === "insurance" ||
    detectsInsuranceDeclaration(currentMessage) ||
    isBareInsuranceAnswer(currentMessage) ||
    insuranceMentionedInHistory;

  const isPrivate =
    persistedPaymentType === "private" ||
    PRIVATE_DECLARED_PATTERN.test(currentMessage) ||
    isBareParticularAnswer(currentMessage) ||
    privateMentionedInHistory;

  const triageComplete = isInsurance || isPrivate;
  const triageNeeded = !triageComplete;

  return { isInsurance, isPrivate, triageComplete, triageNeeded };
}

// ── shouldSuppressAgendaForTriage ────────────────────────────────────────────
// Single source of truth used by ai-engine.ts to decide whether to ZERO the
// AGENDA block in the prompt when the clinic accepts insurance and the lead
// has not yet declared "plano" or "particular". Pure function — no IO.
//
// Returns true ONLY when ALL of the following hold:
//   - clinic accepts insurance (master toggle ON or any professional accepts)
//   - contact is NOT a known patient (patients keep full agenda)
//   - triage has NOT been answered yet (resolveInsuranceMode().triageNeeded)
//
// When true the caller MUST:
//   1. Replace `availabilityInfo` with "" before calling buildSplitPrompt.
//   2. Inject the [SISTEMA: pergunte plano/particular] hint regardless of
//      isFirstContact / intent classification.
//   3. Log `availability_suppressed_reason: "insurance_triage_pending"`.
export interface AgendaSuppressionParams {
  clinicAcceptsInsurance: boolean;
  contactType: ContactType;
  insuranceMode: InsuranceModeResult;
}

export function shouldSuppressAgendaForTriage(p: AgendaSuppressionParams): boolean {
  if (!p.clinicAcceptsInsurance) return false;
  if (p.contactType === "patient") return false;
  return p.insuranceMode.triageNeeded;
}

// Strategy list for declared insurance (convênio) patients — only situational understanding,
// no commercial pressure, no SPIN selling, no urgency/scarcity strategies
const INSURANCE_PATIENT_STRATEGIES: SalesStrategy[] = ["spin_situacao"];

export function selectStrategiesForInsurancePatient(): SalesStrategy[] {
  return INSURANCE_PATIENT_STRATEGIES;
}

export function selectStrategiesForLead(
  temperature: string,
  intent: Intent,
  topStrategies: StrategyScore[]
): SalesStrategy[] {
  const preferred = topStrategies.map((s) => s.strategy);

  const spinByTemp: Record<string, SalesStrategy[]> = {
    cold: ["spin_situacao", "authority_positioning", "reactivation"],
    warm: ["spin_problema", "spin_implicacao", "social_proof"],
    hot: ["spin_necessidade", "micro_commitment", "urgency"],
  };

  const intentByTemp: Partial<Record<Intent, Record<string, SalesStrategy[]>>> = {
    objection: {
      cold: ["spin_situacao", "educational_trust", "benefit_focused"],
      warm: ["spin_problema", "loss_aversion", "benefit_focused"],
      hot: ["spin_implicacao", "spin_necessidade", "loss_aversion"],
    },
    price_inquiry: {
      cold: ["spin_situacao", "price_anchoring", "comparison_cost"],
      warm: ["spin_problema", "price_anchoring", "comparison_cost"],
      hot: ["spin_necessidade", "price_anchoring", "micro_commitment"],
    },
    question: {
      cold: ["spin_situacao", "educational_trust", "authority_positioning"],
      warm: ["spin_problema", "educational_trust", "storytelling"],
      hot: ["spin_implicacao", "spin_necessidade", "micro_commitment"],
    },
    scheduling: {
      cold: ["spin_situacao", "future_pacing", "storytelling"],
      warm: ["spin_implicacao", "future_pacing", "social_proof"],
      hot: ["micro_commitment", "spin_necessidade", "scarcity"],
    },
  };

  const tempOverrides = intentByTemp[intent];
  if (tempOverrides) {
    return tempOverrides[temperature] || tempOverrides.warm || spinByTemp.warm;
  }

  if (preferred.length >= 2) {
    const tempFallback = spinByTemp[temperature] || spinByTemp.warm;
    return [...new Set([...preferred.slice(0, 2), tempFallback[0]])].slice(0, 3);
  }

  return spinByTemp[temperature] || spinByTemp.warm;
}

export async function logStrategy(
  tenantId: number,
  leadId: number | undefined,
  conversationId: number,
  strategies: SalesStrategy[],
  intent: Intent
): Promise<void> {
  if (!leadId) return;

  const lead = await db.query.dentalLeadsTable.findFirst({
    where: eq(dentalLeadsTable.id, leadId),
  });

  for (const strategy of strategies) {
    await db.insert(dentalActivityTable).values({
      tenantId,
      type: "ai_strategy",
      description: `Estrategia '${strategy}' usada para lead #${leadId} (intencao: ${intent})`,
      entityType: "lead",
      entityId: leadId,
      metadata: JSON.stringify({
        strategy,
        leadId,
        conversationId,
        intent,
        outcome: "pending",
        timestamp: new Date().toISOString(),
      }),
    });

    await recordStrategyAnalytics(
      tenantId,
      strategy,
      lead?.temperature || null,
      lead?.interest || null,
      false,
      conversationId
    );
  }
}

export async function markStrategyOutcome(
  tenantId: number,
  leadId: number,
  outcome: "positive" | "negative" | "neutral"
): Promise<void> {
  const recentActivities = await db.query.dentalActivityTable.findMany({
    where: and(
      eq(dentalActivityTable.tenantId, tenantId),
      eq(dentalActivityTable.type, "ai_strategy"),
      eq(dentalActivityTable.entityType, "lead"),
      eq(dentalActivityTable.entityId, leadId)
    ),
    orderBy: [desc(dentalActivityTable.createdAt)],
    limit: 10,
  });

  for (const act of recentActivities) {
    if (!act.metadata) continue;
    try {
      const meta = JSON.parse(act.metadata);
      if (meta.outcome === "pending") {
        meta.outcome = outcome;
        await db
          .update(dentalActivityTable)
          .set({ metadata: JSON.stringify(meta) })
          .where(eq(dentalActivityTable.id, act.id));

        if (outcome === "positive" && meta.conversationId) {
          await db
            .update(aiStrategyAnalyticsTable)
            .set({ converted: true })
            .where(
              and(
                eq(aiStrategyAnalyticsTable.tenantId, tenantId),
                eq(aiStrategyAnalyticsTable.strategy, meta.strategy),
                eq(aiStrategyAnalyticsTable.conversationId, meta.conversationId)
              )
            );
        }
      }
    } catch {}
  }
}

export async function updateLeadTemperature(leadId: number, intent: Intent, conversationId: number): Promise<void> {
  const lead = await db.query.dentalLeadsTable.findFirst({
    where: eq(dentalLeadsTable.id, leadId),
  });
  if (!lead) return;

  const messageCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(dentalMessagesTable)
    .where(eq(dentalMessagesTable.conversationId, conversationId));

  const count = Number(messageCount[0]?.count || 0);
  const newTemp = classifyLeadTemperature(intent, lead.temperature, count);
  const oldTemp = lead.temperature;

  await db
    .update(dentalLeadsTable)
    .set({ temperature: newTemp, lastContactAt: new Date() })
    .where(eq(dentalLeadsTable.id, leadId));

  if (oldTemp !== newTemp) {
    const direction = oldTemp === "cold" && newTemp !== "cold" ? "positive" : newTemp === "cold" && oldTemp !== "cold" ? "negative" : "neutral";

    if (direction !== "neutral") {
      await markStrategyOutcome(lead.tenantId, leadId, direction);
    }

    await db.insert(dentalActivityTable).values({
      tenantId: lead.tenantId,
      type: "lead_temperature_change",
      description: `Lead ${lead.name}: temperatura mudou de ${oldTemp} para ${newTemp}`,
      entityType: "lead",
      entityId: leadId,
      metadata: JSON.stringify({ oldTemp, newTemp, direction }),
    });
  }
}

export async function generateRemarketingMessage(
  tenantId: number,
  leadId: number
): Promise<string> {
  const { getOpenAIClient } = await import("./ai-engine");

  const lead = await db.query.dentalLeadsTable.findFirst({
    where: and(eq(dentalLeadsTable.id, leadId), eq(dentalLeadsTable.tenantId, tenantId)),
  });
  if (!lead) return "";

  const settings = await getCachedSettings(tenantId);
  const procedures = await db.query.dentalProceduresTable.findMany({
    where: and(eq(dentalProceduresTable.tenantId, tenantId), eq(dentalProceduresTable.active, "true")),
    limit: 5,
  });

  const clinicName = settings?.clinicName || "nossa clinica";
  const topStrategies = await getTopStrategies(tenantId);
  const strategy = topStrategies[0]?.strategy || (lead.temperature === "cold" ? "reactivation" : "follow_up_gentle");

  const tempInstructions =
    lead.temperature === "hot"
      ? settings?.remarketingInstructionsHot?.trim()
      : lead.temperature === "warm"
        ? settings?.remarketingInstructionsWarm?.trim()
        : settings?.remarketingInstructionsCold?.trim();

  const aiName = settings?.aiName || "Secretária IA";
  const prompt = `Voce e ${aiName}, a secretaria virtual de ${clinicName}. Gere uma mensagem de remarketing/follow-up para WhatsApp.

Lead: ${lead.name}
Temperatura: ${lead.temperature}
Interesse: ${lead.interest || "geral"}
Ultimo contato: ${lead.lastContactAt ? lead.lastContactAt.toLocaleDateString("pt-BR") : "ha mais de 7 dias"}

Estrategia a usar: ${SALES_STRATEGIES[strategy as SalesStrategy] || SALES_STRATEGIES.follow_up_gentle}

Procedimentos da clinica: ${procedures.map((p) => p.name).join(", ")}
${tempInstructions ? `\nINSTRUCOES PERSONALIZADAS PARA LEADS ${lead.temperature.toUpperCase()} (siga obrigatoriamente):\n${tempInstructions}\n` : ""}
REGRAS:
1. Mensagem curta (max 2 paragrafos)
2. Cordial e nao invasiva
3. Inclua um motivo natural para o contato
4. Finalize com uma pergunta ou convite
5. Nao use emojis excessivos (max 2)
6. Portugues do Brasil
7. NUNCA mencione precos ou valores de procedimentos na mensagem de remarketing`;

  const { buildGpt5Extras, bumpTokensForLowReasoning } = await import("./ai-tuning");
  const remarkClient = await getOpenAIClient(tenantId);
  const response = await remarkClient.chat.completions.create({
    model: "gpt-5.4-mini",
    max_completion_tokens: bumpTokensForLowReasoning(150),
    ...buildGpt5Extras({ tenantId, namespace: "dental-remark" }),
    messages: [{ role: "user", content: prompt }],
    temperature: 0.8,
  } as Parameters<typeof remarkClient.chat.completions.create>[0]);

  return response.choices[0]?.message?.content || "";
}
