import { db } from "@workspace/db";
import {
  dentalLeadsTable,
  patientsTable,
  appointmentsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import {
  buildInstagramSocialProofSection,
  buildPortfolioSection,
  buildDentalSpecialtySection,
  buildPixInstructionsSection,
  computeEarlyInsuranceModeSection,
  clinicEffectivelyAcceptsInsurance,
} from "./prompt-helpers";
export { computeEarlyInsuranceModeSection, resolveAcceptsInsurance } from "./prompt-helpers";
import type { Intent } from "./schedule-engine";
import { LEAD_DATE_REDIRECT_INSTRUCTION } from "./schedule-engine";
import type { ConversationContext, SalesStrategy } from "./lead-engine";
import { SALES_STRATEGIES, getTopStrategies, selectStrategiesForLead, selectStrategiesForInsurancePatient, INSURANCE_DECLARED_PATTERN, PRIVATE_DECLARED_PATTERN, resolveInsuranceMode } from "./lead-engine";
import {
  resolveChargesConsultation,
  resolveConsultationFee,
  resolveInsuranceDays,
  resolveInsuranceHoursStart,
  resolveInsuranceHoursEnd,
  resolveInsurancePlans,
  shouldSendPix,
  resolvePixMode,
} from "./insurance-policy";
import { resolveSpinPhase, shouldOfferSchedule } from "./conversation-policy";
import { buildOwnerTitleContextLine, resolveOwnerTitle, inferTitleFromName } from "./owner-title";
import {
  getContactMemories,
  getRelevantObjections,
  getRelevantKnowledge,
  getOptimizedStrategies,
} from "./ai-learning";
import { getCachedSettings, getCachedProcedures, getCachedProfessionals } from "./cache";
import { logger } from "./logger";

const GPT4O_CONTEXT_TOKENS = 128_000;
const TOKEN_BUDGET = Math.floor(GPT4O_CONTEXT_TOKENS * 0.80);

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Instrução positiva de imediatismo de agenda.
 * Substitui a antiga lista "PROIBIDO ABSOLUTO: NAO diga 'vou verificar...'"
 * em todos os blocos de agendamento — uma constante, sem repetição.
 * Instrução positiva é mais eficaz e não faz priming de frases proibidas.
 */
const AGENDA_JA_LISTADA =
  `A AGENDA ja esta listada abaixo — oferte os horarios IMEDIATAMENTE nesta mesma mensagem. Nao diga que vai verificar nem que retorna depois.`;

export type PreloadedLead = Awaited<ReturnType<typeof db.query.dentalLeadsTable.findFirst>>;
export type PreloadedTopStrategies = Awaited<ReturnType<typeof import("./lead-engine").getTopStrategies>>;

export interface BuildSystemPromptOptions {
  preloadedLead?: PreloadedLead;
  preloadedTopStrategies?: PreloadedTopStrategies;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  isBasicPlan?: boolean;
  /** When set, the user only sent a greeting but a recent topic exists — instruct
   *  the AI to resume that topic instead of restarting with "como posso ajudar". */
  topicResumeHint?: string;
  /** [SISTEMA: …] hints to inject at the end of the dynamic context block
   *  (kept out of userContent so the patient message stays clean). */
  systemHints?: string[];
  /** Estimated tokens already used by identity prompt + history + user content.
   *  Used by the dynamic-context trimmer to compute a tighter budget. */
  alreadyUsedTokens?: number;
  /** Task #17 — modo de conversa determinístico. Quando presente, injeta um
   *  bloco MODO_ATIVO no início do dynamicContext com diretrizes específicas
   *  daquele modo (sem trocar o prompt-base — apenas reforça o foco). */
  conversationMode?: "CONVENIO_TRIAGEM" | "CONVENIO_AGENDAR" | "PARTICULAR_SPIN" | "PACIENTE_AGENDAR";
  /** Quando true, o paciente é de convênio — a seção PIX/PRECOS/PAGAMENTO
   *  é totalmente omitida do prompt para impedir que a IA envie cartão PIX
   *  ou mencione valor (mesmo que o profissional esteja com PIX obrigatório
   *  configurado para o fluxo particular). */
  isInsuranceContact?: boolean;
  /** Filtro server-side de especialidade (Task #2). Quando o ai-engine detecta
   *  que o paciente pediu uma especialidade específica, passa aqui a sub-lista
   *  de profissionais que combinam — apenas eles são listados no prompt e na
   *  AGENDA, eliminando a possibilidade do LLM oferecer profissional fora da
   *  especialidade. Quando ausente ou vazia, mantém o comportamento original. */
  professionalsOverride?: Array<{ id: number }>;
  /** IDs dos profissionais que combinam com a especialidade detectada na
   *  mensagem do paciente (ex.: implantodontia → Dr. Robertino). Diferente de
   *  professionalsOverride, este campo PERSISTE mesmo quando o fallback de
   *  agenda vazia expandiu a lista visível para todos os profissionais. É
   *  usado SOMENTE para filtrar a lista de PLANOS aceitos: a IA só deve
   *  mencionar planos cobertos por quem realmente atende a especialidade
   *  pedida — caso contrário a IA prometeria cobertura por planos que não
   *  cobrem o procedimento solicitado. Quando ausente, lista todos os planos. */
  specialtyMatchedProfessionalIds?: number[];
}

/** Task #17 — diretrizes por modo. Bloco curto, alto impacto, injetado no
 *  topo do dynamicContext para que o modelo sempre leia ANTES de qualquer
 *  outro contexto que cause divergência. */
export function buildModeDirective(
  mode: NonNullable<BuildSystemPromptOptions["conversationMode"]>,
  plansList?: string,
): string {
  switch (mode) {
    case "CONVENIO_TRIAGEM": {
      const plansPhrase = plansList
        ? ` Mencione os planos aceitos de forma natural na pergunta: "Aqui a gente atende: ${plansList}. Você vai usar algum deles ou é particular?"`
        : " \"Você vai usar plano ou é particular?\"";
      return [
        "[MODO_ATIVO: CONVENIO_TRIAGEM]",
        "- Você é uma RECEPCIONISTA HUMANA, calorosa, não um formulário. Fale como gente.",
        "- 1ª resposta: receba a pessoa com calor — cumprimente pelo nome, reconheça o que ela trouxe (queixa, dúvida ou só o \"oi\"), pergunte de leve como ela está ou o que está sentindo. NÃO comece pedindo plano/particular nesta 1ª resposta.",
        `- Da 2ª resposta em diante (depois que a pessoa responder algo): aí sim pergunte de forma natural${plansPhrase} — vinculando à resposta dela, sem soar interrogatório.`,
        "- PROIBIDO em qualquer resposta oferecer horários, sugerir datas, mencionar dias ou prometer agenda antes de saber plano/particular.",
        "- Exemplo BOM (1ª resposta para \"oi\"): \"Oi José, tudo bem? Sou a Ana da clínica. Em que posso te ajudar hoje?\"",
        "- Exemplo BOM (1ª resposta para \"estou com dor\"): \"Que situação chata, José — imagino o quanto está incomodando. Conta um pouco mais o que você está sentindo?\"",
        "- Exemplo RUIM (NÃO faça isso na 1ª): \"Oi José! Você vai usar plano ou é particular?\" — robotizado, frio.",
      ].join("\n");
    }
    case "CONVENIO_AGENDAR":
      return [
        "[MODO_ATIVO: CONVENIO_AGENDAR]",
        "- Paciente é de CONVÊNIO. Apenas ofereça horários da AGENDA disponível.",
        "- PROIBIDO usar termos de venda, escassez, urgência ou gatilhos mentais: \"encaixe especial\", \"última vaga\", \"corre que vai\", \"garanta já\", \"vaga disputada\", \"oportunidade\", \"não perca\", \"aproveite\".",
        "- PROIBIDO ABSOLUTAMENTE falar de preço, valor de consulta, comparações com particular — o convênio cobre.",
        "- PROIBIDO ABSOLUTAMENTE enviar PIX, chave PIX, dados de pagamento, instruções de pagamento, comprovante, sinal, taxa de reserva, ou qualquer cobrança. Convênio NÃO paga nada antes da consulta. Nunca mencione proativamente as palavras: PIX, pagamento, comprovante, transferência, depósito, reserva paga, sinal, taxa.",
        "- NÃO voluntarie a frase \"convênio cobre\" ou \"não precisa pagar\" se o paciente não perguntou — soa robótico e estranho. Apenas confirme o horário e siga.",
        "- SOMENTE se o paciente perguntar diretamente sobre pagamento ou valor, responda curto e natural: \"Pelo convênio é coberto, é só comparecer no horário.\" Sem repetir, sem reforçar.",
        "- Tom neutro, informativo, calmo. Confirme o horário escolhido e siga.",
      ].join("\n");
    case "PARTICULAR_SPIN":
      return [
        "[MODO_ATIVO: PARTICULAR_SPIN]",
        "- Paciente PARTICULAR. Use SPIN com RITMO — conexao antes de conversao.",
        "- SEQUENCIA OBRIGATORIA: (1) Acolha e ouça → (2) Entenda a situacao → (3) Aprofunde o problema → (4) SÓ ENTAO ofereça horario.",
        "- PROIBIDO oferecer horario antes de o lead ter descrito o problema e você ter feito ao menos 1 pergunta de contexto.",
        "- Cada mensagem tem UM objetivo: ou ouvir, ou aprofundar, ou converter. Nunca tudo ao mesmo tempo.",
        "- Tom: humano, curioso, genuinamente interessado. Nao soe como robô de venda.",
        "- VALOR DA CONSULTA: ao oferecer agendamento, INFORME PROATIVAMENTE o valor numa frase só, sem esperar o paciente perguntar — transparência reduz fricção e aumenta conversão.",
        "- Se a clínica não cobra consulta (consulta gratuita / primeira avaliação gratuita), destaque isso como diferencial competitivo no momento de oferecer horário, em vez do valor.",
        "- Exemplo BOM (com valor): \"A consulta sai por R$ 200. Tenho quarta às 10h ou às 14h — qual fica melhor?\"",
        "- Exemplo BOM (gratuita): \"A primeira avaliação é gratuita aqui. Tenho quarta às 10h ou às 14h — qual fica melhor?\"",
        "- Exemplo RUIM: oferecer horário logo na 1ª ou 2ª mensagem sem entender o problema do lead.",
      ].join("\n");
    case "PACIENTE_AGENDAR":
      return [
        "[MODO_ATIVO: PACIENTE_AGENDAR]",
        "- Paciente RECORRENTE. Foco direto: agendar/remarcar/confirmar com mínima fricção.",
        "- Apenas horários da AGENDA. Sem SPIN, sem reapresentações de clínica.",
        "- Se for retorno, lembre brevemente do histórico quando útil.",
      ].join("\n");
  }
}

/** Two-part prompt split: short fixed identity + per-turn dynamic context. */
export interface PromptSplit {
  identityPrompt: string;
  dynamicContext: string;
}

/**
 * Builds the two-part prompt split.
 *
 * - `identityPrompt`: short, stable (~500–1 500 tokens) — AI name, personality,
 *   hard restrictions, APT_CARD rule, first-contact rule.  No clinic data, no
 *   schedule, no SPIN, no memories.  Not trimmed.
 *
 * - `dynamicContext`: all per-turn context — insurance mode, date/time, clinic,
 *   prices, SPIN strategy, schedule, general rules, memories/objections/knowledge,
 *   topic-resume hint, and system hints.  Trimmed to fit within token budget.
 *
 * For basic-plan tenants this still returns a minimal combined prompt as
 * `{ identityPrompt: basicPlanPrompt, dynamicContext: "" }`.
 */
export async function buildSplitPrompt(
  tenantId: number,
  context: ConversationContext,
  intent: Intent,
  availabilityInfo: string = "",
  currentMessage: string = "",
  conversationSentiment: string = "neutral",
  isFirstContact: boolean = false,
  schedulingRefusalCount: number = 0,
  connectionPhase: boolean = false,
  canOfferSchedule: boolean = true,
  opts: BuildSystemPromptOptions = {},
): Promise<PromptSplit> {
  const [settings, procedures, cachedProfessionalsAll] = await Promise.all([
    getCachedSettings(tenantId),
    getCachedProcedures(tenantId),
    getCachedProfessionals(tenantId),
  ]);
  // Task #2 — Filtro server-side de especialidade: se o ai-engine forneceu
  // uma sub-lista, restringimos os profissionais visíveis no prompt à
  // interseção. Fallback seguro: se a interseção for vazia, mantém a lista
  // original do cache.
  let activeProfessionals = cachedProfessionalsAll;
  if (opts.professionalsOverride && opts.professionalsOverride.length > 0) {
    const allowedIds = new Set(opts.professionalsOverride.map((p) => p.id));
    const intersected = cachedProfessionalsAll.filter((p) => allowedIds.has(p.id));
    if (intersected.length > 0) {
      activeProfessionals = intersected;
    }
  }

  if (opts.isBasicPlan) {
    const clinicName = settings?.clinicName || "a clinica odontologica";
    const aiName = settings?.aiName || "Secretaria IA";
    const workingHoursStart = settings?.workingHoursStart || "08:00";
    const workingHoursEnd = settings?.workingHoursEnd || "18:00";
    const procedureList = procedures.map((p) => `- ${p.name}`).join("\n") || "consultas em geral";
    const basicPlanPrompt = `Voce e ${aiName}, a secretaria virtual da ${clinicName}.

FUNCAO: Agendar, confirmar e tirar duvidas sobre consultas. Responda em portugues brasileiro de forma simples, direta e amigavel.

HORARIO DE ATENDIMENTO: ${workingHoursStart} as ${workingHoursEnd}, dias uteis.

PROCEDIMENTOS DISPONIVEIS:
${procedureList}

AGENDA DISPONIVEL:
${availabilityInfo || "Consulte nossa agenda para horarios disponiveis."}

REGRAS:
- Seja breve e cordial.
- Foque apenas em agendar e tirar duvidas basicas.
- Para duvidas clinicas especificas, peça para o paciente ligar ou vir presencialmente.
- Nao faca promessas de precos ou comparacoes com outros clinicas.
- Confirme o nome, telefone e procedimento desejado ao agendar.
${opts.topicResumeHint ? `
RETOMADA DE TOPICO:
O contato enviou apenas uma saudacao curta, mas voces JA estavam conversando. Sua ultima mensagem foi: "${opts.topicResumeHint.replace(/"/g, "'")}". Cumprimente brevemente (1 linha) e RETOME exatamente esse assunto. NUNCA diga "como posso ajudar" ou "nao entendi".` : ""}`;
    return { identityPrompt: basicPlanPrompt, dynamicContext: "" };
  }

  const clinicName = settings?.clinicName || "a clinica odontologica";
  const displayClinicName = clinicName.toLowerCase().startsWith("clínica") || clinicName.toLowerCase().startsWith("clinica") ? clinicName : `Clínica ${clinicName}`;
  const aiName = settings?.aiName || "Secretária IA";
  const professionalName = settings?.professionalName || "";
  const professionalTitle =
    resolveOwnerTitle(settings?.professionalGender ?? null) ??
    inferTitleFromName(professionalName) ??
    "Dr(a).";
  // Prefer owner professional's specialties (from professionals table), then
  // legacy settings.professionalSpecialties (written before Task #4), then
  // clinic-wide settings.specialties as final fallback.
  const ownerProfessional = activeProfessionals.find((p) => p.isOwner) ?? (activeProfessionals.length === 1 ? activeProfessionals[0] : null);
  const s = settings as unknown as Record<string, string | undefined>;
  const specialties = ownerProfessional?.specialties || ownerProfessional?.specialty || s?.professionalSpecialties || settings?.specialties || "";
  const clinicPhone = settings?.clinicPhone || "";
  const clinicAddress = settings?.clinicAddress || "";
  const PERSONALITY_PRESETS: Record<string, string> = {
    warm: `Personalidade ACOLHEDORA: Calorosa e genuina. Reconheca medos com empatia real. Priorize vinculo antes de procedimentos. Fale como quem se importa de verdade, sem ser artificial.`,
    professional: `Personalidade PROFISSIONAL: Clara, objetiva e eficiente. Informacoes precisas, sem rodeios. Foco em resolver rapido: agendar, confirmar, tirar duvidas.`,
    commercial: `Personalidade COMERCIAL: Foco em converter contatos em consultas. Crie urgencia natural, destaque beneficios, rebata objecoes com valor percebido. Proativa sem ser insistente.`,
  };

  const personalityType = settings?.personalityType;
  const personality = (personalityType && PERSONALITY_PRESETS[personalityType])
    || settings?.aiPersonality
    || "Amigavel, prestativa e profissional. Fala com naturalidade como uma secretaria de clinica.";
  const workingHours = `${settings?.workingHoursStart || "08:00"} as ${settings?.workingHoursEnd || "18:00"}`;
  const procedureList = procedures.map((p) => `- ${p.name} (duracao aprox. ${p.durationMinutes}min)`).join("\n");

  const dayNames: Record<string, string> = { "1": "Segunda", "2": "Terca", "3": "Quarta", "4": "Quinta", "5": "Sexta", "6": "Sabado", "0": "Domingo" };

  const singleProfessional = activeProfessionals.length === 1 ? activeProfessionals[0] : null;

  // Usa o policy engine como fonte única de verdade — elimina o fallback
  // hardcoded de R$150 e garante que null/undefined = NÃO cobra.
  const chargesConsultation = resolveChargesConsultation(singleProfessional ?? null, settings ?? null);
  const consultationFee = resolveConsultationFee(singleProfessional ?? null, settings ?? null);
  const acceptsInsurance = clinicEffectivelyAcceptsInsurance(settings, activeProfessionals);

  const insurancePlans = singleProfessional
    ? (singleProfessional.insurancePlans || settings?.insurancePlans || "")
    : (settings?.insurancePlans || "");

  const insuranceDays = singleProfessional
    ? (singleProfessional.insuranceDays || settings?.insuranceDays || "")
    : (settings?.insuranceDays || "");
  const insuranceHoursStart = singleProfessional
    ? (singleProfessional.insuranceHoursStart || settings?.insuranceHoursStart || "")
    : (settings?.insuranceHoursStart || "");
  const insuranceHoursEnd = singleProfessional
    ? (singleProfessional.insuranceHoursEnd || settings?.insuranceHoursEnd || "")
    : (settings?.insuranceHoursEnd || "");

  // Aggregate all unique accepted insurance plans across all active professionals + settings
  // Split on comma, semicolon, ampersand, forward-slash, or the Portuguese conjunction " e "
  const splitPlans = (raw: string): string[] =>
    raw.split(/,|;|&|\s*\/\s*|\s+e\s+/i).map(s => s.trim()).filter(Boolean);

  // Quando o ai-engine detectou uma especialidade específica (ex.:
  // implantodontia → Dr. Robertino), restringimos a lista de planos aos
  // profissionais que realmente atendem essa especialidade. Isso evita o bug
  // onde a IA listaria planos cobertos somente por profissionais de outra
  // especialidade (ex.: oferecer "Banco do Brasil" do Dr. Severiano para um
  // paciente que precisa de implante e só pode ser atendido pelo Dr. Robertino,
  // que não aceita esse plano). Quando ausente, comportamento original.
  const specialtyMatchedIds = opts.specialtyMatchedProfessionalIds;
  const professionalsForPlans = (specialtyMatchedIds && specialtyMatchedIds.length > 0)
    ? activeProfessionals.filter((p) => specialtyMatchedIds.includes(p.id))
    : activeProfessionals;

  const allInsurancePlansList = (() => {
    const planSet = new Set<string>();
    professionalsForPlans.forEach((p) => {
      if (p.acceptsInsurance && p.insurancePlans) {
        splitPlans(p.insurancePlans).forEach(pl => planSet.add(pl));
      }
    });
    // settings.insurancePlans é a lista clínica genérica — só fazemos merge
    // quando NENHUM profissional ativo tem insurancePlans configurado.
    // Isso evita que dados genéricos/incorretos da config da clínica (ex.:
    // "Banco do Brasil" cadastrado erroneamente) contaminem a lista quando
    // os profissionais já têm seus planos específicos cadastrados.
    // Se especialidade foi detectada, também não usamos (evita vazamento).
    const anyProfHasPlans = professionalsForPlans.some(p => p.acceptsInsurance && p.insurancePlans);
    if (!anyProfHasPlans && !specialtyMatchedIds?.length && settings?.insurancePlans) {
      splitPlans(settings.insurancePlans).forEach((pl: string) => planSet.add(pl));
    }
    return Array.from(planSet).join(", ");
  })();

  let scheduleInfo = "";
  let activeDaysStr = "";
  let disabledDaysStr = "";
  if (settings?.scheduleConfig) {
    try {
      const sched = JSON.parse(settings.scheduleConfig) as Array<{ day: string; enabled: boolean; start: string; end: string; period: string }>;
      const dayNamesLong: Record<string, string> = { "0": "Domingo", "1": "Segunda", "2": "Terca", "3": "Quarta", "4": "Quinta", "5": "Sexta", "6": "Sabado" };
      const activeDays = sched.filter((d) => d.enabled).map((d) => `${dayNamesLong[d.day]}: ${d.start}-${d.end}`);
      const disabledDays = sched.filter((d) => !d.enabled).map((d) => dayNamesLong[d.day]);
      if (activeDays.length) {
        activeDaysStr = activeDays.join(", ");
        disabledDaysStr = disabledDays.join(", ");
        scheduleInfo = `\n- Dias de atendimento: ${activeDaysStr}`;
      }
    } catch {}
  }

  let consultationInfo = "";
  if (activeProfessionals.length > 1) {
    consultationInfo = `varia por profissional (ver lista abaixo)`;
  } else if (chargesConsultation && consultationFee) {
    consultationInfo = `R$${consultationFee}`;
  } else if (chargesConsultation) {
    consultationInfo = `A combinar com a clínica`;
  } else {
    consultationInfo = `GRATUITA`;
  }

  let insuranceInfo = "";
  if (activeProfessionals.length > 1) {
    // Bug fix Task #11 — só conta como "aceita convênio" o profissional com
    // `acceptsInsurance === true` explícito. Antes (`!== false`) tratava null
    // como aceita, gerando "varia por profissional" em clínica 100% particular.
    const anyAcceptsInsurance = acceptsInsurance;
    insuranceInfo = anyAcceptsInsurance
      ? `varia por profissional (ver lista abaixo)`
      : `exclusivamente particular`;
  } else if (acceptsInsurance && insurancePlans) {
    const daysStr = insuranceDays ? insuranceDays.split(",").map(d => dayNames[d] || d).join(", ") : "";
    const hoursStr = insuranceHoursStart && insuranceHoursEnd ? `${insuranceHoursStart} as ${insuranceHoursEnd}` : "";
    const scheduleStr = daysStr || hoursStr ? ` (atendimento por convenio: ${daysStr}${hoursStr ? `, das ${hoursStr}` : ""})` : "";
    insuranceInfo = `Aceita: ${insurancePlans}${scheduleStr}.`;
  } else if (acceptsInsurance) {
    insuranceInfo = `Aceita convenios (consultar quais planos disponiveis).`;
  } else {
    insuranceInfo = `exclusivamente particular`;
  }

  // ── Payment info ─────────────────────────────────────────────────────────────
  // null = not configured by clinic admin; true = accepts; false = explicitly disabled
  let paymentInfo = "";
  {
    const installmentsConfigured = settings?.acceptsInstallments !== null && settings?.acceptsInstallments !== undefined;
    const boletoConfigured = settings?.acceptsBoleto !== null && settings?.acceptsBoleto !== undefined;
    const paymentNotes = settings?.paymentNotes || "";

    if (!installmentsConfigured && !boletoConfigured) {
      // Neither field has been configured — AI should not assume anything
      paymentInfo = `- Formas de pagamento: Nao configurado — se o paciente perguntar sobre formas de pagamento ou parcelamento, diga que precisa confirmar com a clinica e retorna em breve.`;
      if (paymentNotes) paymentInfo += ` Obs: ${paymentNotes}`;
    } else {
      const acceptsInstallments = settings?.acceptsInstallments === true;
      const maxInstallments = settings?.maxInstallments ?? 12;
      const acceptsBoleto = settings?.acceptsBoleto === true;
      const parts: string[] = [];
      if (acceptsInstallments) {
        parts.push(`cartao de credito em ate ${maxInstallments}x`);
      }
      if (acceptsBoleto) {
        parts.push("boleto bancario");
      }
      if (parts.length > 0) {
        paymentInfo = `- Formas de pagamento: Aceitamos ${parts.join(" e ")}`;
        if (paymentNotes) paymentInfo += `. ${paymentNotes}`;
      } else {
        // Both explicitly set to false
        paymentInfo = `- Formas de pagamento: Somente a vista (cartao debito/credito sem parcelamento ou dinheiro). Se o paciente perguntar sobre parcelamento ou boleto, informe que no momento a clinica nao oferece essa opcao.`;
        if (paymentNotes) paymentInfo += ` ${paymentNotes}`;
      }
    }
  }

  const isLead = context.contactType === "lead" || context.contactType === "unknown";
  const isPatient = context.contactType === "patient";

  const leadDuration = singleProfessional
    ? (singleProfessional.defaultLeadDurationMinutes || settings?.defaultLeadDurationMinutes || 15)
    : (settings?.defaultLeadDurationMinutes || 15);
  const patientDuration = singleProfessional
    ? (singleProfessional.defaultPatientDurationMinutes || settings?.defaultPatientDurationMinutes || 30)
    : (settings?.defaultPatientDurationMinutes || 30);

  const utcOffsetHours = -3;
  const localNowForPrompt = new Date(Date.now() + utcOffsetHours * 3600000);
  const localDateForPrompt = localNowForPrompt.toISOString().split("T")[0].split("-").reverse().join("/");
  const localTimeForPrompt = localNowForPrompt.toISOString().substring(11, 16);
  const localDayOfWeek = ["Domingo", "Segunda-feira", "Terca-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sabado"][localNowForPrompt.getUTCDay()];

  const contactDesc = isPatient ? "paciente cadastrado" : isLead ? "lead/prospecto" : "contato novo (tratar como lead)";

  const [contactMemoryBlock, objectionBlock, knowledgeBlock, strategyBlock, portfolioSection] = await Promise.all([
    getContactMemories(tenantId, context.contactPhone).catch(() => ""),
    getRelevantObjections(tenantId, currentMessage).catch(() => ""),
    getRelevantKnowledge(tenantId, currentMessage).catch(() => ""),
    getOptimizedStrategies(tenantId).catch(() => ""),
    buildPortfolioSection(tenantId, opts.preloadedLead?.professionalId ?? null).catch(() => ""),
  ]);

  // ── Insurance/private patient detection ──────────────────────────────────────
  // Persistent source of truth: lead.paymentType = "insurance" | "private" | null
  // Prioritize persisted value from DB over regex/history (survives long conversations).
  let persistedLeadPaymentType: string | null = opts.preloadedLead?.paymentType ?? null;
  if (persistedLeadPaymentType === null && isLead && context.leadId && acceptsInsurance) {
    const leadForPaymentType = await db.query.dentalLeadsTable.findFirst({
      where: eq(dentalLeadsTable.id, context.leadId),
    });
    persistedLeadPaymentType = leadForPaymentType?.paymentType ?? null;
  }

  const insuranceMode = resolveInsuranceMode({
    clinicAcceptsInsurance: acceptsInsurance,
    persistedPaymentType: persistedLeadPaymentType,
    currentMessage,
    historyMessages: (opts.conversationHistory || [])
      .filter((m) => m.role === "user")
      .map((m) => ({ content: m.content })),
  });
  const contactDeclaredInsurance = insuranceMode.isInsurance;
  const contactDeclaredPrivate = insuranceMode.isPrivate;

  // Convênio nunca paga consulta — sobrescreve o valor computado pela política
  // da clínica. A variável `chargesConsultation` (computada acima a partir do
  // config) pode ser true para uma clínica que cobra, mas isso nunca se aplica
  // a contatos de convênio: o plano cobre o atendimento.
  if (contactDeclaredInsurance && activeProfessionals.length <= 1) {
    consultationInfo = "GRATUITA";
  }

  // Triage is complete when the contact has answered "plano" or "particular".
  // When complete, stop injecting the mandatory bifurcation question.
  const insuranceTriageComplete = insuranceMode.triageComplete;

  // ── Insurance bifurcation block — extracted early so it can precede clinic data ─
  // Depends only on acceptsInsurance, insuranceTriageComplete, allInsurancePlansList
  // (all computed above), so it is safe to build here before the lead block.
  // Bloco de bifurcacao mostrado APENAS durante a triagem pendente.
  // Mantem-se deliberadamente curto e descritivo da SEQUENCIA, sem listar as
  // regras de pos-triagem (MODO CONVENIO / fluxo particular). Essas regras sao
  // injetadas pelo leadBlock assim que a triagem completa, evitando que termos
  // como "escassez", "spin_situacao", etc. vazem para a interacao pre-triagem
  // (Invariante #7).
  const insuranceBifurcationBlock = acceptsInsurance && !insuranceTriageComplete ? `
FLUXO CONVENIO/PARTICULAR — REGRA OBRIGATORIA (PRIORIDADE MAXIMA):
A clinica aceita convenio. A pergunta "plano ou particular?" NUNCA ocorre na apresentacao inicial — ela ocorre SOMENTE depois que o contato descrever o motivo do contato.

SEQUENCIA OBRIGATORIA:
1. PRIMEIRA mensagem da IA = apresentacao + pergunta "como posso te ajudar?" (ou equivalente). NUNCA pergunte plano/particular na apresentacao.
   - Exemplo correto: "Oi, Maria! Aqui e a Ana, da Clinica X. Como posso te ajudar?"
   - PROIBIDO perguntar "plano ou particular?" antes de o contato descrever o que precisa.
   - PROIBIDO comecar SPIN antes de receber a resposta plano vs particular.
2. Apos o contato descrever o que precisa: acolha brevemente e pergunte de forma natural — ${allInsurancePlansList ? `inclua os planos aceitos: "Aqui a gente atende: ${allInsurancePlansList}. Voce vai usar algum deles ou e particular?"` : `"Voce vai usar plano ou e particular?"`}
3. SE PLANO (convenio): ativacao automatica do fluxo de convenio — as regras detalhadas serao aplicadas apos a confirmacao.
4. SE PARTICULAR: ativacao automatica do fluxo particular — as regras detalhadas serao aplicadas apos a confirmacao.

${allInsurancePlansList ? `COMPARACAO COM A LISTA DE PLANOS: Quando o contato informar o NOME do plano, compare com a lista aceita (${allInsurancePlansList}). Se NAO estiver nessa lista, responda imediatamente: "Infelizmente a gente nao atende por esse plano. Os planos aceitos aqui sao: ${allInsurancePlansList}." Nunca confirme aceitacao de um plano que nao esteja na lista. Apenas o NOME do plano basta para essa comparacao — NUNCA peca CPF, RG, carteirinha, numero do contrato, nome completo ou qualquer dado pessoal. A clinica nao verifica elegibilidade pelo WhatsApp.` : ""}` : "";

  // Consolidated attendance mode injected early — before clinic data — so GPT-4o
  // sees the insurance/particular rule within the first ~500 tokens of the prompt.
  // computeEarlyInsuranceModeSection guards against isPatient internally.
  const earlyInsuranceModeSection = computeEarlyInsuranceModeSection(
    acceptsInsurance,
    isPatient,
    contactDeclaredInsurance,
    insuranceTriageComplete,
    insuranceBifurcationBlock,
  );

  // ── Lead section ──────────────────────────────────────────────────────────────
  let leadBlock = "";
  if (isLead && context.leadId) {
    const lead = opts.preloadedLead
      ?? await db.query.dentalLeadsTable.findFirst({ where: eq(dentalLeadsTable.id, context.leadId) });

    if (lead) {
      const topStrategies = opts.preloadedTopStrategies ?? await getTopStrategies(tenantId);

      // For insurance patients, delegate to the canonical insurance strategy function
      // in lead-engine.ts which returns only spin_situacao (understand complaint, no pressure)
      const selectedStrategies = contactDeclaredInsurance
        ? selectStrategiesForInsurancePatient()
        : selectStrategiesForLead(lead.temperature, intent, topStrategies);

      const strategyInstructions = selectedStrategies
        .map((s) => SALES_STRATEGIES[s])
        .filter(Boolean)
        .map((s, i) => `  ${i + 1}. ${s}`)
        .join("\n");

      // Fase SPIN via policy engine — fonte única de verdade para ritmo da conversa
      const temp = (lead.temperature as "cold" | "warm" | "hot") || "cold";
      const spinPhaseResult = resolveSpinPhase(temp);
      const currentSpinPhase = spinPhaseResult.instruction;

      // Scheduling rules — defined once, account for connectionPhase.
      // When the contact has already declared insurance, we bypass
      // connectionPhase so the convenio agenda is offered immediately
      // (no SPIN, no scarcity — just acolhimento + slots da agenda).
      const inConnectionPhase = connectionPhase && !contactDeclaredInsurance;
      const messagesExchanged = context.messages?.length ?? 0;
      const offerSchedule = shouldOfferSchedule({
        temperature: temp,
        inConnectionPhase,
        contactDeclaredInsurance: !!contactDeclaredInsurance,
        canOfferSchedule,
        messagesExchanged,
      });

      let schedulingRules = "";
      if (inConnectionPhase) {
        if (acceptsInsurance && !insuranceTriageComplete) {
          schedulingRules = `
AGENDA: Primeiro contato — nao ofereca horarios ainda.
- Apresente-se e pergunte "como posso te ajudar?". Aguarde o contato descrever o que precisa.
- Apos descrever o motivo: pergunte "Voce vai usar plano ou e particular?".
- Ofereca horarios SOMENTE apos o contato responder plano ou particular.`;
        } else {
          schedulingRules = `
AGENDA: Fase de situacao — nao ofereca horarios ainda.
- Entenda a situacao do lead com perguntas abertas. Foco em ouvir, nao em vender.
- Se o lead perguntar o preco, informe o valor e faca uma pergunta SPIN — nao ofereca horario.
- Ofereca horarios SOMENTE se o lead pedir explicitamente.`;
        }
      } else if (offerSchedule) {
        if (activeProfessionals.length <= 1) {
          schedulingRules = `
AGENDA — REGRA ABSOLUTA (SOMENTE PARA PARTICULARES):
- MAXIMO 2 horarios: 1 MANHA + 1 TARDE da AGENDA abaixo. Nada mais, nao pergunte preferencia antes de oferecer os 2.
- ${AGENDA_JA_LISTADA}
- Tom: voce esta FAZENDO UM FAVOR. "Consegui 2 encaixes: [manha] ou [tarde]. Qual garante?"
- Escassez natural: "sao os ultimos", "agenda ta disputada", "melhor garantir agora".${lead.temperature === "hot" ? `
- Lead QUENTE: "Consegui 2 horarios: [dia manha] ou [dia tarde]. Sao os ultimos da semana — posso reservar um pra voce agora?"` : ""}
- ${LEAD_DATE_REDIRECT_INSTRUCTION}
${schedulingRefusalCount >= 2 ? `- Lead ja recusou ${schedulingRefusalCount}x. Encerre: "Entendi! Vou deixar seu contato e aviso se abrir vaga." Nao ofereca mais.` : ""}`;
        } else {
          schedulingRules = `
AGENDA — REGRA MULTI-PROFISSIONAL (SOMENTE PARA PARTICULARES):
- Primeiro pergunte: "Com qual profissional voce gostaria de agendar?" e apresente as opcoes.
- Apos o lead escolher, oferte EXATAMENTE 1 horario de MANHA e 1 de TARDE daquele profissional — TOTAL 2 slots, nunca mais.
- Nunca oferte horarios de multiplos profissionais ao mesmo tempo. Um profissional por vez.
- Use escassez natural: "esses foram os que sobraram", "a agenda ta disputada".
- ${LEAD_DATE_REDIRECT_INSTRUCTION}
${schedulingRefusalCount >= 2 ? `- O lead ja recusou horarios ${schedulingRefusalCount} vezes. Aceite com elegancia e encerre sem oferecer mais horarios.` : ""}`;
        }
      }

      // Neutral scheduling rules for insurance patients — no urgency/scarcity language
      // For insurance mode, only professionals that accept insurance count for routing.
      const insuranceProfessionals = activeProfessionals.filter((p) => p.acceptsInsurance);
      let insuranceSchedulingRules = "";
      if (offerSchedule) {
        if (insuranceProfessionals.length <= 1) {
          insuranceSchedulingRules = `
AGENDA — CONVENIO (REGRA ABSOLUTA):
- Use SOMENTE os horarios da AGENDA DISPONIVEL abaixo. Nunca sugira datas fora da agenda.
- Se o dia pedido nao tiver slots: explique o calendario de convenio e ofereça a proxima data. Ex: "Nosso atendimento por convenio e somente aos sabados — posso te colocar no dia [data]."
- ${AGENDA_JA_LISTADA}
- Apresente direto: manha e tarde. Pergunte: "Prefere de manha ou de tarde?"
- Apos 2 recusas, aceite com elegancia e encerre.`;
        } else {
          insuranceSchedulingRules = `
AGENDA — CONVENIO MULTI-PROFISSIONAL (REGRA ABSOLUTA):
- SOMENTE ofereça os horarios listados na AGENDA DISPONIVEL abaixo. JAMAIS sugira dias ou horarios fora da agenda — mesmo que o paciente peça outra data.
- Pergunte: "Com qual profissional voce gostaria de agendar?" e apresente APENAS as opcoes listadas em PROFISSIONAIS DA CLINICA (somente profissionais que atendem convenio).
- Apos o contato escolher, apresente os horarios disponiveis (manha e tarde) daquele profissional conforme a AGENDA abaixo.
- Se recusar, ofereça alternativa da agenda. Apos 2 recusas, aceite com elegancia e encerre.`;
        }
      }

      // Pre-triage branch: clinic accepts insurance, contact has NOT yet
      // answered "plano" or "particular". Strip ALL SPIN content to prevent
      // contradictory instructions — the only allowed action is to ask the
      // triage question and wait. SPIN/strategy/scheduling rules are excluded.
      if (acceptsInsurance && !insuranceTriageComplete && !contactDeclaredInsurance) {
        leadBlock = `
SECRETARIA DA CLINICA — TRIAGEM PLANO/PARTICULAR PENDENTE.
Este contato e novo e a clinica aceita convenio. O fluxo correto e em DUAS etapas — nao pule etapas.

CONTEXTO DO CONTATO:
- Nome: ${lead.name}
- Interesse: ${lead.interest || "Nao especificado"}
- Ultimo contato: ${lead.lastContactAt ? lead.lastContactAt.toLocaleDateString("pt-BR") : "Primeiro contato"}

REGRA DE NOME: Use APENAS o PRIMEIRO nome (ex: "Jose", nao "Jose Renato"). Mencione no maximo 1-2 vezes.

FLUXO OBRIGATORIO EM DUAS ETAPAS:
ETAPA 1 — Se o contato ainda nao descreveu o que precisa:
1. Cumprimente brevemente e se apresente como secretaria da clinica.
2. Pergunte "no que posso te ajudar?" (ou equivalente).
3. AGUARDE o contato descrever o motivo do contato. Nao faca mais nada.

ETAPA 2 — Apos o contato descrever o que precisa:
1. Acolha brevemente o que o contato descreveu.
2. Pergunte: "Voce vai usar plano ou e particular?"
3. AGUARDE a resposta antes de qualquer outra acao.

AGUARDE A RESPOSTA DE PLANO/PARTICULAR ANTES DE QUALQUER OUTRA ACAO:
- Nao avance para SPIN, diagnostico, horarios, preco ou argumentos de venda enquanto nao tiver a resposta.
- Nao crie pressao comercial. Apenas acolha e espere a resposta do contato.

Apos o contato responder plano ou particular:
- SE PLANO/CONVENIO: ative MODO CONVENIO (acolhimento simples, sem pressao, agendamento direto).
- SE PARTICULAR: siga o fluxo SPIN Selling normal.

REGRA ESTRITA: nenhuma outra acao (nem cancelamento, nem reagendamento, nem agenda, nem preco) substitui a pergunta plano/particular apos o contato descrever o que precisa. Se o contato pedir algo antes de responder plano/particular, acolha brevemente e repita a pergunta na mesma mensagem.`;
      } else if (contactDeclaredInsurance) {
        // ANTI-LEAK: o leadBlock para contato em convenio NUNCA pode mencionar
        // termos de venda (SPIN, escassez, urgencia, ancoragem, "consegui um
        // encaixe", "agenda disputada", "ultimo horario", etc.) nem mesmo como
        // proibicao. Use apenas instrucoes positivas descrevendo o atendimento
        // desejado — qualquer aparicao desses termos pode ser absorvida pelo
        // modelo e gerar pressao comercial em pacientes de plano.
        const insuranceDaysNames = insuranceDays
          ? insuranceDays.split(",").map((d: string) => dayNames[d.trim()] || d.trim()).join(", ")
          : "";
        leadBlock = `
VOCE E A SECRETARIA DA CLINICA — MODO CONVENIO ATIVO.
Este contato declarou que usa PLANO/CONVENIO.

${insuranceDaysNames ? `RESTRICAO ABSOLUTA DE DIAS: O atendimento por convenio desta clinica e SOMENTE em ${insuranceDaysNames}. Qualquer outro dia da semana esta PROIBIDO para convenio — independente do que foi dito em mensagens anteriores desta conversa. Nao confirme, nao ofereça, nao sugira horario em dia diferente de ${insuranceDaysNames}.` : ""}
CONTEXTO DO CONTATO:
- Nome: ${lead.name}
- Interesse: ${lead.interest || "Nao especificado"}
- Ultimo contato: ${lead.lastContactAt ? lead.lastContactAt.toLocaleDateString("pt-BR") : "Primeiro contato"}

INSTRUCOES MODO CONVENIO:
- Acolha a pessoa com calor humano e simplicidade.
- Faca apenas perguntas necessarias para entender a queixa (uma de cada vez).
- Conduza direto ao agendamento, sem tecnicas de venda nem pressao comercial.
- Nao mencione preco de procedimento — atendimento e pelo plano.
- Tom: caloroso, calmo, direto, eficiente.
- Objetivo unico: marcar a consulta com gentileza.
- Tom caloroso e sem pressao. Atendimento por plano dispensa argumentos de venda — apenas acolhe e agenda com gentileza.
- SE O CONTATO PEDIR UM DIA QUE NAO ESTIVER NA AGENDA: responda EXATAMENTE assim: "Nosso atendimento por convenio e realizado [dias da AGENDA]. O proximo horario disponivel e [data e hora da AGENDA]. Posso reservar esse horario para voce?" NUNCA confirme ou ofereça horario em dia nao listado na AGENDA DISPONIVEL.
${insuranceSchedulingRules}
${intent === "cancellation" || intent === "rescheduling" ? `CONTATO CANCELANDO/REAGENDANDO: (1) Confirme o cancelamento com tom acolhedor; (2) NA MESMA MENSAGEM, JA OFEREÇA REAGENDAMENTO usando explicitamente uma das palavras "reagendar", "novo horario" ou "outro horario" (ex: "Sem problema, ja cancelei. Quer que eu te ofereca um novo horario?"). Nao mande o reagendamento como mensagem separada — junte tudo na mesma resposta. Apos 2 recusas, aceite com elegancia.` : ""}`;
      } else {
        leadBlock = `
VOCE E UMA CRA (Consultora de Relacionamento com o Agendamento).
Seu papel com LEADS e aplicar a metodologia SPIN Selling para converter em agendamento.

CONTEXTO DO LEAD:
- Nome: ${lead.name}
- Temperatura: ${lead.temperature.toUpperCase()} (${lead.temperature === "cold" ? "precisa ser aquecido" : lead.temperature === "warm" ? "demonstra interesse" : "pronto para converter"})
- Interesse: ${lead.interest || "Nao especificado"}
- Fonte: ${lead.source || "Nao identificada"}
- Ultimo contato: ${lead.lastContactAt ? lead.lastContactAt.toLocaleDateString("pt-BR") : "Primeiro contato"}
- Status: ${lead.status}
- Fase SPIN atual: ${currentSpinPhase}

REGRA DE NOME: Use APENAS o PRIMEIRO nome do lead (ex: "Jose", nao "Jose Renato"). Mencione no maximo 1-2 vezes por conversa. NAO repita em cada mensagem.

METODOLOGIA SPIN SELLING (apenas para leads — nunca para pacientes):
Siga as 4 fases do SPIN de acordo com a temperatura do lead. NAO pule fases.

1. S — SITUACAO (leads FRIOS): Entenda o contexto com perguntas abertas.
   Exemplos: "Ha quanto tempo ta sentindo isso?", "Ja fez algum tratamento antes?", "O que te levou a nos procurar?"
   Proibido oferecer horarios ou vender nesta fase. Avance para P quando o lead compartilhar o problema.

2. P — PROBLEMA (leads MORNOS): Faca o lead sentir e verbalizar o problema.
   Exemplos: "Isso te incomoda no dia a dia?", "Atrapalha na hora de comer/sorrir?", "Te deixa inseguro(a)?"
   Nao oferte solucao ainda. Avance para I quando o lead demonstrar desconforto claro.

3. I — IMPLICACAO (leads MORNOS → QUENTES): Mostre as consequencias de nao resolver.
   Exemplos: "Se deixar, pode complicar e sair mais caro", "Esse tipo de coisa tende a piorar com o tempo."
   Use prova social. Gere urgencia real. Avance para N quando o lead demonstrar vontade de resolver.

4. N — NECESSIDADE DE SOLUCAO (leads QUENTES): Apresente a solucao e feche o agendamento.
   Mostre como a clinica resolve. Use escassez. Conduza ao agendamento.
   Tom: voce esta FAZENDO UM FAVOR ao lead conseguindo aquela vaga.

REGRAS CRA:
- Converta em ate 3 dias. Nunca deixe o lead "pensar" sem proximo passo.
- Leads FRIOS: fases S/P — perguntas abertas, empatia, sem venda.
- Leads MORNOS: fases P/I — aprofunde o problema, mostre consequencias.
- Leads QUENTES: fases I/N — apresente solucao e faca o fechamento.
- Nunca diga "temos varios horarios disponiveis". Isso mata a conversao.
- REGRA CRITICA DE REDIRECT: Se o lead recusar os horarios ou pedir outra data (ex: "semana que vem", "mes que vem", "depois de amanha", "outra semana"): NAO busque nem oferte novos horarios. Redirecione SEMPRE para os 2 horarios da AGENDA com urgencia: "Esses sao os unicos encaixes que consegui garantir agora — semana que vem ja esta tomada. Qual voce garante?"
- Se o lead insistir 2x em data diferente: aceite com elegancia ("Entendido! Vou deixar seu contato aqui e te aviso se abrir algo mais pra frente.") e encerre. Nunca continue oferecendo alternativas.

ESTRATEGIAS ATIVAS:
${strategyInstructions}
${schedulingRules}
${buildInstagramSocialProofSection(lead?.temperature, activeProfessionals, professionalName, lead?.professionalId)}
${intent === "cancellation" || intent === "rescheduling" ? `LEAD CANCELANDO/REAGENDANDO: (1) Confirme o cancelamento com tom acolhedor; (2) NA MESMA MENSAGEM, JA OFEREÇA REAGENDAMENTO usando explicitamente uma das palavras "reagendar", "novo horario" ou "outro horario". Nao envie o reagendamento como mensagem separada — junte tudo na mesma resposta. Apos 2 recusas, aceite com elegancia.` : ""}`;
      }
    }
  }

  // ── Patient section ───────────────────────────────────────────────────────────
  let patientSection = "";
  if (isPatient && context.patientId) {
    const patient = await db.query.patientsTable.findFirst({
      where: eq(patientsTable.id, context.patientId),
    });
    const appointments = await db.query.appointmentsTable.findMany({
      where: and(eq(appointmentsTable.patientId, context.patientId), eq(appointmentsTable.tenantId, tenantId)),
      orderBy: [desc(appointmentsTable.startsAt)],
      limit: 3,
    });

    patientSection = `
PACIENTE: ${patient?.name || context.contactName || "Desconhecido"} | Gasto: R$${patient?.totalSpent || "0"} | Consultas: ${appointments.length > 0 ? appointments.map((a) => `${a.startsAt.toLocaleDateString("pt-BR")} (${a.status})`).join(", ") : "Nenhuma"}
REGRAS PACIENTE:
- Use APENAS o PRIMEIRO nome do paciente (ex: "Jose", nao "Jose Renato"). Mencione o nome no maximo 1-2 vezes por conversa — apenas em momentos naturais como saudacao ou empatia. NAO repita o nome em cada mensagem.
- Seja acolhedor e familiar. Este paciente JA e da clinica.
- Nunca aplique SPIN Selling, tecnicas de venda ou pressao com pacientes.
- Sugira retornos e cuidados naturalmente, com carinho e atencao.
- Pacientes de convenio recebem o mesmo tratamento caloroso que pacientes particulares.
- Lembre de consultas anteriores e pergunte como esta se sentindo.
- CANCELAMENTO/REAGENDAMENTO PROATIVO: Quando o paciente pedir para cancelar ou desmarcar uma consulta existente, voce DEVE responder em UMA SO mensagem contendo OBRIGATORIAMENTE: (1) confirmacao acolhedora do cancelamento (ex: "Tudo bem, ja cancelei aqui!"); (2) na MESMA mensagem, oferta proativa de reagendamento usando explicitamente uma das palavras "reagendar", "novo horario" ou "outro horario" (ex: "Quer ja deixar marcado um novo horario? Tenho [opcao A] ou [opcao B]."). NUNCA envie o reagendamento como mensagem separada depois — junte sempre na mesma resposta. Mesmo se o paciente nao pedir o reagendamento, ofereca: e parte do cuidado com ele(a). Apos 2 recusas explicitas de reagendamento, aceite com elegancia ("Entendido! Quando quiser remarcar e so me chamar.").`;
  }

  // ── Prompt assembly — SPLIT into two parts ───────────────────────────────────
  //
  // PART 1 — IDENTITY (short, stable, not trimmed, ~500-1 500 tokens)
  //   Sections: IDENTIDADE E REGRAS ABSOLUTAS
  //   Contains: AI name, personality, hard restrictions, APT_CARD rule,
  //             first-contact rule.  No clinic data, no schedule, no SPIN.
  //
  // PART 2 — DYNAMIC CONTEXT (per-turn, trimmed to fit token budget)
  //   Sections: MODO DE ATENDIMENTO, DATA E HORA, CLINICA, PRECOS E PAGAMENTO,
  //             ESTRATEGIA DE ATENDIMENTO, AGENDA DISPONIVEL, REGRAS GERAIS,
  //             topic-resume hint, system hints, memory/objection/knowledge blocks.
  //
  // In ai-engine.ts the messages array becomes:
  //   system (identity) → summaryContext? → history → system (dynamic) → user

  const identitySection = `=== IDENTIDADE E REGRAS ABSOLUTAS ===
Voce e ${aiName}, secretaria da clinica ${clinicName}. Voce e uma PESSOA REAL chamada ${aiName} que trabalha na recepcao da clinica. Fale como uma pessoa normal falaria no WhatsApp com um paciente — com naturalidade, calor humano e sem parecer robotica.
${personality}

IDENTIDADE — REGRA ABSOLUTA:
Voce e ${aiName}, a secretaria. Nunca diga "sou uma IA", "sou virtual", "sou um assistente", "sou um bot" ou qualquer variacao. Se o contato perguntar DIRETAMENTE "voce e uma IA?" ou "voce e um robo?", responda com honestidade: "Sim, sou uma inteligencia artificial, mas pode ficar tranquilo(a) que cuido de tudo direitinho por aqui!" — fora isso, sempre se comporte como a ${aiName}, secretaria humana da clinica.

TOM E LINGUAGEM:
- Fale como secretaria real no WhatsApp: curta, calorosa. Use girias: "ta", "ne", "certinho", "pode ser?".
- Nunca use listas, bullets, asteriscos ou formatacao. Mensagem de WhatsApp normal.
- Maximo 2-3 frases. Varie comprimento e expressoes — nunca repita a mesma frase em mensagens seguidas.
- Use reticencias ("...") para pausa natural: "Deixa eu ver aqui..."
- Antes de informar, use empatia: "entendo", "faz sentido", "claro", "imagina".
- Proibido emojis.

FORMATO DE ENVIO NO WHATSAPP — REGRA OBRIGATORIA (humanizacao real):
Voce NAO escreve um paragrafo unico. Pessoas no WhatsApp mandam varias mensagens curtas seguidas. Por isso, SEMPRE separe sua resposta em 1 a 3 mensagens curtas, dividindo com UMA LINHA EM BRANCO entre elas (dois "enter": \\n\\n). Cada mensagem deve ter no maximo 1-2 frases curtas (idealmente 40-120 caracteres). NUNCA junte saudacao + pergunta + informacao na mesma linha — quebre.

Exemplos do formato correto (note a linha em branco entre mensagens):

Exemplo 1 (saudacao + pergunta):
"Oi, tudo bem?

Vai ser pra avaliacao ou tem algo especifico que ta incomodando?"

Exemplo 2 (empatia + info + pergunta):
"Entendi, dor de dente incomoda demais ne...

Posso te encaixar amanha as 10h ou as 14h.

Qual fica melhor pra voce?"

Exemplo 3 (confirmacao curta):
"Perfeito!

Ja deixei agendado entao."

NAO escreva tudo em uma linha so. NAO use lista numerada. Apenas quebre com linha em branco entre cada mensagem curta.

${isFirstContact ? `REGRA ABSOLUTA — PRIMEIRO CONTATO:
Voce DEVE se apresentar pelo nome e citar OBRIGATORIAMENTE o nome da clinica "${displayClinicName}".
FORMATO OBRIGATORIO (use EXATAMENTE esta estrutura, so adapte o tom):
"Oi${context.contactName ? `, ${context.contactName.split(" ")[0]}` : ""}! Aqui e a ${aiName}, da ${displayClinicName}. Como posso te ajudar?"
NOME DA CLINICA: "${displayClinicName}" — use EXATAMENTE este nome, nunca substitua pelo nome do profissional nem por "clinica odontologica".
Proibido responder apenas "Oi, tudo bem?" sem se identificar. Seja breve, 1-2 frases no maximo.
PROIBIDO ABSOLUTO no PRIMEIRO CONTATO: NAO pergunte "plano ou particular?" na apresentacao. NAO faca perguntas SPIN, NAO ofereca horarios, NAO mencione preco. Apenas se apresente e pergunte "como posso te ajudar?". A pergunta plano/particular so ocorre APOS o contato descrever o que precisa.` : ""}

MARCADOR DE CONFIRMACAO DE AGENDAMENTO — REGRA OBRIGATORIA:
Sempre que voce confirmar um agendamento (para qualquer contato — lead, paciente, plano), adicione ao FINAL da sua mensagem o marcador:
[APT_CARD: <dia da semana>, <data dd/mm> as <hora>]
Exemplos: [APT_CARD: Terca-feira, 15/04 as 10h] | [APT_CARD: Quarta-feira, 16/04 as 15h]
- Use EXATAMENTE este formato — sem variacao
- Somente quando a consulta estiver CONFIRMADA (paciente aceitou data E hora especificas)
- NUNCA use em mensagens que apenas oferecem horarios sem confirmacao

MARCADOR DE CANCELAMENTO — REGRA OBRIGATORIA:
Sempre que voce confirmar/aceitar um cancelamento de consulta solicitado pelo paciente ou lead, adicione ao FINAL da sua mensagem o marcador EXATO:
[APT_CANCEL]
- Use SOMENTE quando o contato pedir explicitamente para cancelar/desmarcar/nao poder ir e voce confirmar o cancelamento na mesma mensagem (com tom acolhedor + oferta de reagendar).
- NUNCA use [APT_CANCEL] em mensagens que apenas perguntam confirmacao ("voce confirma o cancelamento?") — use somente quando voce ja confirmar o cancelamento de fato.
- O marcador e SILENCIOSO: nao aparece para o paciente, mas dispara a baixa do agendamento no sistema.

RESTRICOES ABSOLUTAS — O QUE VOCE NUNCA DEVE FAZER:
- NUNCA invente ou sugira horarios fora da agenda disponivel. Se nao houver horarios listados, diga que vai verificar e retorna em breve.
- NUNCA informe precos de procedimentos sem autorizacao. Se o preco nao estiver cadastrado, diga: "preciso confirmar o valor com a clinica, ja verifico pra voce."
- NUNCA saia do foco odontologico. Nao responda sobre assuntos fora de saude bucal, agendamentos ou informacoes da clinica.
- NUNCA confirme um agendamento sem que o paciente aceite EXPLICITAMENTE uma data E hora especificas. Oferecer nao e confirmar. Confirmacao so ocorre quando o paciente diz "sim", "pode ser", "aceito" ou equivalente para aquele horario.
- NUNCA diagnostique ou recomende tratamentos especificos. Sempre direcione para avaliacao presencial.
- NUNCA mencione concorrentes ou faca comparacoes com outras clinicas.`;

  const ownerTitleLine = buildOwnerTitleContextLine(settings?.professionalName, settings?.professionalGender ?? null);

  // When the contact is in insurance mode, only show professionals that accept insurance.
  const listedProfessionals = contactDeclaredInsurance
    ? activeProfessionals.filter((p) => p.acceptsInsurance)
    : activeProfessionals;

  const dynamicBase = `${ownerTitleLine ? `${ownerTitleLine}\n\n` : ""}=== MODO DE ATENDIMENTO ===
${earlyInsuranceModeSection}

=== DATA E HORA ===
HOJE: ${localDateForPrompt} (${localDayOfWeek}), ${localTimeForPrompt} (Brasilia, UTC-3). Use como referencia para "hoje", "amanha", etc.

=== CLINICA ===
CLINICA:${professionalName ? `\n${professionalTitle} ${professionalName}` : ""}${specialties ? ` | ${specialties}` : ""}${clinicPhone ? ` | Tel: ${clinicPhone}` : ""}
Horario: ${workingHours}${scheduleInfo}${clinicAddress ? `\nEnd: ${clinicAddress}` : ""}
Duracao consulta: ${activeProfessionals.length > 1 ? "varia por profissional (ver lista abaixo)" : `leads ${leadDuration}min, pacientes ${patientDuration}min`}
Procedimentos: ${procedureList || "Consultar clinica"}
${listedProfessionals.length > 1 ? `
PROFISSIONAIS DA CLINICA (${listedProfessionals.length} profissionais${contactDeclaredInsurance ? " que atendem convenio" : " ativos"}):
${listedProfessionals.map((p) => {
  const profCharges = resolveChargesConsultation(p, settings ?? null);
  const profFee = resolveConsultationFee(p, settings ?? null);
  const profConsulta = !profCharges
    ? " | Consulta: GRATUITA"
    : profFee
      ? ` | Consulta: R$${profFee}`
      : " | Consulta: A combinar";
  // FONTE UNICA DE VERDADE: se o contato e convenio, "Atende:" mostra
  // SOMENTE os dias de convenio do profissional. Sem dois campos = sem
  // contradicao para o LLM. Se o profissional aceita convenio mas nao
  // tem dias especificos cadastrados, cai nos workingDays normais.
  const insuranceDaysForProf = contactDeclaredInsurance && p.acceptsInsurance && p.insuranceDays
    ? p.insuranceDays
    : null;
  // Para paciente PARTICULAR não mostrar campo Convenio — evita LLM citar
  // planos de convênio (ex.: "Amil Dental") como se fossem relevantes.
  const profConvenio = p.acceptsInsurance && !contactDeclaredInsurance && !contactDeclaredPrivate
    ? ` | Convenio: ${p.insurancePlans || "aceita"}${p.insuranceDays ? ` (${p.insuranceDays.split(",").map((d: string) => dayNames[d] || d).join(", ")})` : ""}`
    : (contactDeclaredInsurance && p.acceptsInsurance ? ` | Plano: ${p.insurancePlans || "aceita"}` : "");
  const profLeadDur = p.defaultLeadDurationMinutes ? ` | Lead: ${p.defaultLeadDurationMinutes}min` : "";
  const profPatientDur = p.defaultPatientDurationMinutes ? ` | Paciente: ${p.defaultPatientDurationMinutes}min` : "";
  const profInstagram = p.instagramUrl ? ` | Instagram: ${p.instagramUrl}` : "";
  const daysSourceForProf = insuranceDaysForProf || p.workingDays;
  const profWorkingDays = daysSourceForProf
    ? ` | Atende${insuranceDaysForProf ? " (convenio)" : ""}: ${daysSourceForProf.split(",").map((d: string) => dayNames[d] || d).join(", ")}`
    : "";
  const profHours = (p.workingHoursStart && p.workingHoursEnd)
    ? ` | Horario: ${p.workingHoursStart} as ${p.workingHoursEnd}`
    : "";
  const profExtraSpecialties = p.specialties ? ` | Tambem atende: ${p.specialties}` : "";
  return `- ${p.name}${p.specialty ? ` (${p.specialty})` : ""}${p.cro ? ` - CRO: ${p.cro}` : ""}${profExtraSpecialties}${profConsulta}${profWorkingDays}${profHours}${profConvenio}${profLeadDur}${profPatientDur}${profInstagram}`;
}).join("\n")}
REGRA MULTI-PROFISSIONAL: Ao confirmar agendamento, mencione sempre o nome do profissional. Ex: "Reservei pra voce com a Dra. Ana na terca as 9h".
REGRA CRITICA DE DIAS POR PROFISSIONAL: Cada profissional SOMENTE atende nos dias listados em "Atende:" acima. NUNCA oferte nem confirme horarios em dias fora desses dias para aquele profissional especifico. Se o contato pedir um dia em que o profissional nao atende, informe qual e o proximo dia disponivel daquele profissional.
ROTEAMENTO POR ESPECIALIDADE — REGRA ESTRITA: Quando o contato mencionar uma necessidade ligada a uma especialidade, encaminhe APENAS para um profissional cujo campo "(especialidade)" OU "Tambem atende:" contenha a palavra-chave correspondente (busca por substring, ignorando acentos/maiusculas). MAPEAMENTO DE NECESSIDADES → PALAVRAS-CHAVE QUE DEVEM APARECER NA FICHA DO PROFISSIONAL:

ORTODONTIA:
- aparelho / dente torto / alinhamento / mordida cruzada / Invisalign / aparelho invisivel / aparelho fixo / aparelho movel / contencao → "ortodont"

ODONTOPEDIATRIA:
- crianca / filho / filha / bebe / criancinha / pediatrico → "odontopediat" ou "infantil"

IMPLANTODONTIA:
- IMPLANTE / dente caiu / dente perdido / dente faltando / falta dente / sem dente / colocar dente / parafuso no osso → "implant" (Implantodontia, Implantes, Implantologia — TODOS valem)

PROTESE:
- PROTESE / dentadura / chapa / ponte fixa / ponte movel / coroa / coroa de porcelana / protese sobre implante / protocolo → "protese", "prótese", "protetic" ou "implant" (implantodontistas geralmente fazem protese sobre implante — VALE)

ENDODONTIA:
- canal / tratamento de canal / dor profunda / dor latejante / nervo do dente / desvitalizar / endodontia → "endodont"

PERIODONTIA:
- gengiva / sangramento gengival / gengiva inchada / mau halito / piorreia / retracao gengival / periodontite / gengivite / raspagem → "periodont"

DENTISTICA / RESTAURADORA:
- carie / restauracao / obturacao / dente quebrado / dente lascado / cavidade / massinha branca → "dentistic", "restaurad" ou "clinic"

CIRURGIA BUCAL / BUCOMAXILOFACIAL:
- siso / dente do siso / dente do juizo / extracao / arrancar dente / cirurgia / cisto na boca / fratura de mandibula / trauma facial → "cirurg", "buco", "maxilofacial" ou "exodont"

ESTETICA DENTAL:
- clarear / clareamento / dente amarelo / branqueamento / sorriso branco / manchas → "estetic", "cosmetic" ou "clareament"

LENTE / FACETA:
- lente de contato / lente dental / faceta / faceta de porcelana / faceta de resina / harmonizar sorriso → "lente", "faceta", "estetic" ou "protese"

HARMONIZACAO OROFACIAL:
- harmonizacao / botox / preenchimento labial / toxina botulinica / bichectomia / preenchimento facial / bigode chines / olheiras → "harmoniza" ou "estetic"

DTM / OCLUSAO:
- bruxismo / range os dentes / placa miorrelaxante / DTM / ATM / dor na mandibula / estala a mandibula / dor de cabeca tensional → "oclus", "DTM", "bruxismo", "disfun" ou "protese"

ODONTOLOGIA DO SONO:
- ronco / apneia / aparelho para ronco / dispositivo intraoral → "sono", "ronco" ou "DTM"

ODONTOGERIATRIA:
- idoso / paciente idoso / vovo / vovó / dentadura velha / paciente com mais de 65 → "geriat", "idoso" ou "protese"

ESTOMATOLOGIA / PATOLOGIA ORAL:
- afta persistente / lesao na boca / mancha branca na lingua / nodulo / caroco na gengiva / biopsia → "estomat", "patolog" ou "cirurg"

RADIOLOGIA:
- raio-x / radiografia / panoramica / tomografia odontologica → "radiolog" ou "imagem"

ODONTOLOGIA ESPORTIVA:
- protetor bucal / mouthguard / esporte de contato → "esportiv" ou "protese"

PACIENTES ESPECIAIS:
- autista / sindrome de down / paciente especial / deficiencia → "especial", "PCD" ou "hospital"

ODONTOLOGIA PARA GESTANTES:
- gravida / gestante / amamentacao → "gestant" ou qualquer clinico geral (avise sobre procedimentos seguros)

REGRAS GERAIS:
1. Faca a busca por substring case-insensitive e ignorando acentos. Ex: "Implantodontia" CONTEM "implant" → vale para implante E para protese.
2. Se mais de um profissional tiver a palavra-chave, prefira aquele cuja "(especialidade)" principal contenha a palavra-chave (e nao apenas o "Tambem atende:").
3. Se a necessidade for simples (limpeza, profilaxia, avaliacao geral, primeira consulta, dor leve, check-up) → encaminhe para QUALQUER profissional disponivel — todos podem fazer.
4. PROIBIDO inferir que um profissional atende uma especialidade sem a palavra-chave estar escrita na ficha dele.
5. Se NENHUM profissional listado tiver a palavra-chave, responda: "Nossa clinica nao tem especialista em [area] no momento, mas o(a) [profissional clinico geral] pode fazer uma avaliacao inicial e te orientar sobre o tratamento." NUNCA invente especialidade.` : listedProfessionals.length === 1 ? `
${(() => {
  // Task #17 — bloco unificado de dados reais (single-prof). Espelha o mesmo
  // conjunto de campos que o bloco multi-prof já usa, evitando que o prompt
  // perca consultationFee/convênio/durações quando há apenas 1 profissional.
  const p = listedProfessionals[0];
  const profChargesSingle = resolveChargesConsultation(p, settings ?? null);
  const profFeeSingle = resolveConsultationFee(p, settings ?? null);
  const profConsulta = !profChargesSingle
    ? " | Consulta: GRATUITA"
    : profFeeSingle
      ? ` | Consulta: R$${profFeeSingle}`
      : " | Consulta: A combinar";
  // FONTE UNICA DE VERDADE: se o contato e convenio, "Atende:" mostra
  // SOMENTE os dias de convenio do profissional. Sem dois campos = sem
  // contradicao para o LLM. Se o profissional aceita convenio mas nao
  // tem dias especificos cadastrados, cai nos workingDays normais.
  const insuranceDaysForProf = contactDeclaredInsurance && p.acceptsInsurance && p.insuranceDays
    ? p.insuranceDays
    : null;
  // Para paciente PARTICULAR não mostrar campo Convenio — evita LLM citar
  // planos de convênio (ex.: "Amil Dental") como se fossem relevantes.
  const profConvenio = p.acceptsInsurance && !contactDeclaredInsurance && !contactDeclaredPrivate
    ? ` | Convenio: ${p.insurancePlans || "aceita"}${p.insuranceDays ? ` (${p.insuranceDays.split(",").map((d: string) => dayNames[d] || d).join(", ")})` : ""}`
    : (contactDeclaredInsurance && p.acceptsInsurance ? ` | Plano: ${p.insurancePlans || "aceita"}` : "");
  const profLeadDur = p.defaultLeadDurationMinutes ? ` | Lead: ${p.defaultLeadDurationMinutes}min` : "";
  const profPatientDur = p.defaultPatientDurationMinutes ? ` | Paciente: ${p.defaultPatientDurationMinutes}min` : "";
  const profInstagram = p.instagramUrl ? ` | Instagram: ${p.instagramUrl}` : "";
  const daysSourceForProf = insuranceDaysForProf || p.workingDays;
  const profWorkingDays = daysSourceForProf
    ? ` | Atende${insuranceDaysForProf ? " (convenio)" : ""}: ${daysSourceForProf.split(",").map((d: string) => dayNames[d] || d).join(", ")}`
    : "";
  const profHours = (p.workingHoursStart && p.workingHoursEnd)
    ? ` | Horario: ${p.workingHoursStart} as ${p.workingHoursEnd}`
    : "";
  return `Profissional: ${p.name}${p.specialty ? ` (${p.specialty})` : ""}${p.cro ? ` - CRO: ${p.cro}` : ""}${profConsulta}${profWorkingDays}${profHours}${profConvenio}${profLeadDur}${profPatientDur}${profInstagram}`;
})()}` : ""}
${activeDaysStr ? `AGENDA: A clinica SOMENTE atende nos seguintes dias: ${activeDaysStr}.${disabledDaysStr ? ` Nunca oferte ou mencione horarios em ${disabledDaysStr}.` : ""} Se o contato pedir um dia fora do calendario, redirecione educadamente para o proximo dia disponivel.` : ""}
${clinicAddress ? `Maps: https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clinicAddress)}` : ""}

=== PRECOS E PAGAMENTO ===
- Consulta/avaliacao: ${consultationInfo}${!chargesConsultation && activeProfessionals.length <= 1 ? " — destaque como diferencial e convide para agendar" : ""}
- Convenios: ${insuranceInfo}
${(allInsurancePlansList && !contactDeclaredPrivate) ? `PLANOS ACEITOS: A clinica atende SOMENTE os seguintes planos: ${allInsurancePlansList}. Se o contato mencionar QUALQUER outro plano que NAO esteja nessa lista, informe IMEDIATAMENTE que a clinica nao atende por esse plano e liste os planos aceitos. NUNCA confirme aceitacao de um plano que nao esteja na lista acima, mesmo que o contato insista. Apenas o NOME do plano basta para essa comparacao — NUNCA peca CPF, RG, carteirinha, numero do contrato, nome completo ou qualquer dado pessoal para verificar elegibilidade.` : ""}
${opts.isInsuranceContact
  ? "REGRA CRITICA: Paciente de CONVENIO. NAO mencione preco, valor, PIX, pagamento, comprovante, sinal, taxa ou reserva paga. Convenio cobre o atendimento — nao ha cobranca antecipada."
  : opts.conversationMode === "CONVENIO_TRIAGEM"
    ? "REGRA CRITICA: Triagem em andamento — tipo de atendimento ainda nao confirmado. NAO mencione PIX, valor, preco, pagamento ou forma de pagamento antes de saber se o lead usa plano ou e particular."
    : `${paymentInfo}${buildPixInstructionsSection(activeProfessionals, contactDeclaredInsurance)}`}
${(() => {
  const perProfLines = listedProfessionals.map((p) => {
    const charges = resolveChargesConsultation(p, settings ?? null);
    const fee = resolveConsultationFee(p, settings ?? null);
    const pixMode = resolvePixMode(opts.isInsuranceContact ?? false, p);
    const pixSuffix = pixMode === "required"
      ? " — pagamento antecipado via PIX OBRIGATORIO antes da consulta"
      : pixMode === "optional"
        ? " — aceita PIX antecipado (opcional)"
        : "";
    if (!charges) return `- ${p.name}: GRATUITA`;
    return fee ? `- ${p.name}: R$ ${fee}${pixSuffix}` : `- ${p.name}: valor nao cadastrado (oriente o paciente a ligar para a clinica)`;
  }).join("\n");
  const gratuita = listedProfessionals.length > 0 && listedProfessionals.every((p) => !resolveChargesConsultation(p, settings ?? null));
  const profsGratuitos = listedProfessionals.filter((p) => !resolveChargesConsultation(p, settings ?? null));
  const gratuitaPerProfRule = profsGratuitos.length > 0
    ? (() => {
        const isOne = profsGratuitos.length === 1;
        const nomes = profsGratuitos.map((p) => p.name).join(", ");
        const especialidades = profsGratuitos
          .map((p) => p.specialty || "avaliacao")
          .filter((s, i, a) => a.indexOf(s) === i)
          .join(", ");
        const exemploNome = isOne ? profsGratuitos[0].name : "<NOME_DO_PROFISSIONAL_GRATUITO>";
        return `\nREGRA OBRIGATORIA — AVALIACAO GRATUITA: ${nomes} ${isOne ? "oferece" : "oferecem"} AVALIACAO GRATUITA. SEMPRE que mencionar ou oferecer ${isOne ? "esse profissional" : "qualquer um desses profissionais"} (em qualquer mensagem, mesmo na primeira vez), VOCE E OBRIGADA a usar explicitamente uma das palavras: "gratuita", "gratis", "sem custo", "sem cobranca" ou "cortesia" ao lado do nome ${isOne ? "dele(a)" : "do profissional escolhido"}. Exemplos validos: "consulta de avaliacao gratuita com o(a) Dr(a). ${exemploNome}", "${exemploNome} faz avaliacao gratuita". NUNCA omita esse beneficio — e o principal diferencial competitivo. Mencione mesmo se o paciente nao perguntou pelo preco.\nGATILHO IMEDIATO: Quando o paciente PARTICULAR mencionar uma necessidade que ${isOne ? "esse profissional atende" : "qualquer um desses profissionais atende"} (ex: ${especialidades}), JA NA PRIMEIRA RESPOSTA voce DEVE: (1) acolher com empatia em UMA frase curta, e (2) na MESMA mensagem nomear EXPLICITAMENTE o profissional gratuito relevante (escolha o que atende a especialidade pedida${isOne ? "" : " — nao fixe sempre no primeiro da lista"}) e usar a palavra "gratuita" (ou equivalente da lista acima) ao lado do nome. NAO espere uma segunda mensagem do paciente para apresentar o profissional. Exemplo: "Entendi sua necessidade! O(A) Dr(a). ${exemploNome} faz a avaliacao GRATUITA — posso te oferecer um horario?"`;
      })()
    : "";
  return `REGRA UNICA DE PRECOS — PACIENTE PARTICULAR:
VALORES DE CONSULTA (voce tem AUTORIZACAO TOTAL para informar):
${perProfLines}
REGRA DE OURO — INFORME O VALOR APENAS UMA VEZ NA CONVERSA EM TEXTO LIVRE, no momento de oferecer/confirmar o horario do agendamento (ex: "Tenho terca as 14h com o(a) Dr(a). X — a consulta fica R$ Y. Confirmo?"). NAO repita o valor em texto livre nas mensagens seguintes. NAO antecipe o preco em saudacoes ou respostas iniciais. NAO informe o preco antes de o paciente demonstrar intencao de agendar (a menos que ele pergunte explicitamente). Se o paciente perguntar o preco diretamente, responda UMA vez em texto livre e siga oferecendo horario. EXCECAO IMPORTANTE: o CARTAO PIX (bloco formatado com "DADOS PARA PAGAMENTO PIX") NAO conta como repeticao de preco — voce DEVE enviar o cartao PIX completo conforme as regras do bloco PIX acima, mesmo que o valor ja tenha aparecido antes em texto.
PROIBIDO INFORMAR PRECO DE PROCEDIMENTOS: Quando o paciente perguntar o valor de qualquer procedimento (clareamento, implante, aparelho, limpeza, faceta, restauracao, etc.), responda EXATAMENTE: "O valor dos procedimentos so e informado apos a avaliacao presencial com o dentista. Posso confirmar o valor da consulta de avaliacao para voce?" Nunca cite um preco de procedimento.
PROIBIDO dizer "vou confirmar com a clinica" sobre o valor da CONSULTA — os valores acima sao a fonte oficial.${gratuita ? " Destaque a consulta GRATUITA como diferencial ao oferecer horarios." : ""}${gratuitaPerProfRule}`;
})()}
PACIENTES DE CONVENIO: PROIBIDO mencionar valor da consulta ou comparacoes — o convenio cobre.
ODONTOLOGIA: Responda com seguranca usando linguagem simples. Sintomas → empatia + recomende avaliacao. Nunca diagnostique.
${buildDentalSpecialtySection(currentMessage)}${portfolioSection}

=== ESTRATEGIA DE ATENDIMENTO ===
CONTATO: ${context.contactName || "Nao identificado"} | ${contactDesc} | ${context.contactPhone}
${leadBlock}${patientSection}

=== AGENDA DISPONIVEL ===
${availabilityInfo}
ATENCAO: Horarios mencionados em mensagens anteriores podem estar desatualizados — use EXCLUSIVAMENTE os listados acima. Ignore qualquer horario que apareca no historico da conversa.
ANCORA: Apenas os horarios acima existem. Qualquer horario nao listado = inventado = PROIBIDO.
REGRA TEMPORAL CRITICA — leia com cuidado para nao confundir:
1. So considere um horario "passado" se ele estiver na AGENDA acima como passado OU se a DATA + HORA combinadas ja passaram em relacao ao "hoje" informado no inicio do prompt. NUNCA compare apenas a hora do dia — sempre considere a data junto.
2. Exemplos do que NAO e passado:
   - Sao seis da tarde de hoje e voce ofereceu "amanha as dez" ou "amanha as tres da tarde" → AINDA NAO PASSOU. Pode confirmar normalmente. NAO diga "ja passou".
   - Sao seis da tarde de hoje e voce ofereceu "quarta as tres da tarde" (sendo quarta amanha ou depois) → AINDA NAO PASSOU.
3. Exemplos do que E passado e voce NAO pode confirmar:
   - Sao seis da tarde de hoje e voce ofereceu "hoje as duas da tarde" e o paciente so respondeu agora → JA PASSOU. Peca desculpas e ofereca o proximo horario da AGENDA.
4. Em caso de duvida sobre se ja passou, confie SEMPRE na AGENDA acima — ela ja exclui automaticamente horarios passados. Se o horario ainda esta listado na AGENDA, ele nao passou.

=== REGRAS GERAIS ===
LISTA DE ESPERA:
Se o horario pedido estiver ocupado ou o contato recusar todos os horarios oferecidos, oferte a lista de espera naturalmente:
- Horario especifico: "Esse horario ta ocupado agora, mas posso te colocar na lista de espera especificamente pra [dia/hora]. Se alguem cancelar, voce e o primeiro a saber!"
- Sem preferencia fixa: "Posso te colocar na lista de espera. Se abrir qualquer vaga eu te aviso na hora pelo WhatsApp, pode ser?"
- Nunca oferte a lista de espera quando ainda ha horarios disponiveis.

AUDIO: Audios sao transcritos automaticamente — voce consegue processar. Se perguntarem se podem mandar audio, confirme que SIM.

CONVENIOS E PLANOS: Use APENAS as informacoes do bloco PRECOS E PAGAMENTO acima — nao invente nem rejeite planos fora do que esta configurado.

DADOS PESSOAIS — REGRA ABSOLUTA: NUNCA peca CPF, RG, carteirinha, numero do contrato/convenio, nome completo do titular, data de nascimento ou qualquer dado pessoal do contato durante a triagem ou para verificar elegibilidade de plano. A clinica nao verifica elegibilidade pelo WhatsApp — apenas o NOME do plano basta para informar se atende ou nao. Cadastro completo so acontece presencialmente, na recepcao da clinica.

INCERTEZA: Para dados nao configurados (preco especifico, procedimento, disponibilidade de horario, duracao, endereco), diga: "Preciso verificar isso com a clinica e te respondo em breve." NUNCA chute. EXCECAO: planos e formas de pagamento ja configurados — use diretamente.

REGRAS GERAIS: Empatia primeiro. Nunca invente horarios nem informacoes. Encerre com pergunta ou proximo passo. Use historico para personalizar.
${conversationSentiment === "negative" || conversationSentiment === "critical" ? `ATENCAO — CONTATO INSATISFEITO: Empatia total. Valide sentimentos. Nao venda nada ate resolver a situacao.` : ""}
${(!isPatient && opts.preloadedLead && !contactDeclaredInsurance && !(acceptsInsurance && !insuranceTriageComplete)) ? strategyBlock : ""}${opts.topicResumeHint ? `

RETOMADA DE TOPICO — REGRA ABSOLUTA:
O contato enviou apenas uma saudacao curta (ex: "oi", "bom dia"), mas voces JA estavam conversando sobre algo. A sua ultima mensagem foi: "${opts.topicResumeHint.replace(/"/g, "'")}".
- PROIBIDO responder "como posso te ajudar?", "no que posso ajudar?", "nao entendi", ou qualquer pergunta generica de abertura.
- PROIBIDO se reapresentar — voces ja se conhecem.
- OBRIGATORIO retomar o topico de forma natural, como uma pessoa real faria.
- Cumprimente de volta brevemente e ja referencie o assunto ativo na MESMA mensagem.` : ""}${(opts.systemHints ?? []).length > 0 ? `\n\n${(opts.systemHints ?? []).join("\n\n")}` : ""}`;

  const identityTokens = estimateTokens(identitySection);
  const alreadyUsed = (opts.alreadyUsedTokens ?? 0) + identityTokens;

  const dynamicContextRaw = trimDynamicContextToTokenBudget(
    tenantId,
    dynamicBase,
    contactMemoryBlock,
    objectionBlock,
    knowledgeBlock,
    alreadyUsed,
  );

  // Task #17 — diretriz do modo de conversa fica NO TOPO do dynamicContext,
  // antes de qualquer trecho que possa entrar em conflito com o foco do modo.
  const dynamicContext = opts.conversationMode
    ? `${buildModeDirective(opts.conversationMode, allInsurancePlansList || undefined)}\n\n${dynamicContextRaw}`
    : dynamicContextRaw;

  return { identityPrompt: identitySection, dynamicContext };
}

/**
 * Trims the dynamic context block to stay within the token budget.
 *
 * @param alreadyUsedTokens  Estimated tokens already consumed by the identity
 *   prompt + history + user content (so we account for the total context window).
 */
function trimDynamicContextToTokenBudget(
  tenantId: number,
  baseDynamic: string,
  memoriesBlock: string,
  objectionsBlock: string,
  knowledgeBlock: string,
  alreadyUsedTokens: number = 0,
): string {
  const effectiveBudget = TOKEN_BUDGET - alreadyUsedTokens;
  const full = baseDynamic + memoriesBlock + objectionsBlock + knowledgeBlock;
  const fullTokens = estimateTokens(full);

  if (fullTokens <= effectiveBudget) return full;

  const withoutKnowledge = baseDynamic + memoriesBlock + objectionsBlock;
  logger.warn(
    { tenantId, estimatedTokens: fullTokens, budget: effectiveBudget, dropped: "knowledge" },
    "Dynamic context exceeds token budget — dropping knowledge block",
  );
  if (estimateTokens(withoutKnowledge) <= effectiveBudget) return withoutKnowledge;

  const withoutObjections = baseDynamic + memoriesBlock;
  logger.warn(
    { tenantId, estimatedTokens: estimateTokens(withoutKnowledge), budget: effectiveBudget, dropped: "objections" },
    "Dynamic context exceeds token budget — dropping objections block",
  );
  if (estimateTokens(withoutObjections) <= effectiveBudget) return withoutObjections;

  logger.warn(
    { tenantId, estimatedTokens: estimateTokens(withoutObjections), budget: effectiveBudget, dropped: "memories" },
    "Dynamic context exceeds token budget — dropping memories block",
  );
  return baseDynamic;
}

/**
 * Legacy wrapper — concatenates identity + dynamic into a single string.
 * Use `buildSplitPrompt` for new call-sites (ai-engine.ts) to get the
 * two-message split; this wrapper is kept so existing tests compile unchanged.
 */
export async function buildSystemPrompt(
  tenantId: number,
  context: ConversationContext,
  intent: Intent,
  availabilityInfo: string = "",
  currentMessage: string = "",
  conversationSentiment: string = "neutral",
  isFirstContact: boolean = false,
  schedulingRefusalCount: number = 0,
  connectionPhase: boolean = false,
  canOfferSchedule: boolean = true,
  opts: BuildSystemPromptOptions = {},
): Promise<string> {
  const { identityPrompt, dynamicContext } = await buildSplitPrompt(
    tenantId, context, intent, availabilityInfo, currentMessage,
    conversationSentiment, isFirstContact, schedulingRefusalCount,
    connectionPhase, canOfferSchedule, opts,
  );
  return dynamicContext ? `${identityPrompt}\n\n${dynamicContext}` : identityPrompt;
}
