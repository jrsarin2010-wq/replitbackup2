/**
 * Task #29 — Validador determinístico de obediência da IA.
 *
 * Recebe a resposta gerada pelo modelo + contexto do tenant e devolve
 * a lista de violações encontradas. Usado pelo ai-engine para disparar
 * um único retry com hint de correção e, se o retry também falhar, cair
 * num fallback determinístico seguro.
 */

export type ViolationType =
  | "procedure_not_listed"
  | "time_outside_agenda"
  | "triage_ignored"
  | "owner_title_wrong"
  | "price_invented"
  | "policy_violation"
  | "insurance_sales_term"
  | "pix_card_omitted"
  | "dropped_professional_mentioned"
  | "insurance_wrong_day";

import { findForbiddenTerms } from "./insurance-audit";

export interface Violation {
  type: ViolationType;
  detail: string;
}

export interface ValidatorContext {
  reply: string;
  /** Raw agenda string injected no prompt (mesma usada por buildSplitPrompt). */
  availabilityInfo: string;
  /** True quando triagem plano/particular está pendente (Task #28). */
  triagePending: boolean;
  procedureNames: string[];
  ownerTitle: "Dr." | "Dra." | null;
  ownerFirstName: string | null;
  consultationFee: string | null;
  procedurePrices: number[];
  /** Comma-separated payment methods configured by tenant (e.g. "Cartão, PIX"). */
  paymentMethods?: string | null;
  /** Comma-separated insurance plans accepted (when acceptsInsurance=true). */
  insurancePlans?: string | null;
  acceptsInsurance?: boolean;
  chargesConsultation?: boolean;
  /** True when this contact has been identified as an insurance patient.
   *  When true, the validator blocks sales/scarcity terms (FORBIDDEN_INSURANCE_TERMS). */
  isInsuranceContact?: boolean;
  /** Task #17 — modo de conversa determinístico. Quando presente, é a fonte
   *  autoritativa: triagePending e isInsuranceContact são derivados do modo
   *  para garantir que prompt e validador estejam sempre coerentes. */
  mode?: "CONVENIO_TRIAGEM" | "CONVENIO_AGENDAR" | "PARTICULAR_SPIN" | "PACIENTE_AGENDAR";
  /** Task #23 — true quando esta é a 1ª resposta da IA na conversa. Em
   *  CONVENIO_TRIAGEM permite resposta puramente empática (acolhimento) sem
   *  já incluir a pergunta plano/particular — desde que NÃO ofereça agenda
   *  E a mensagem do paciente NÃO seja apenas uma saudação genérica.
   *  A 2ª resposta em diante volta a exigir a pergunta. */
  isFirstAIReplyInMode?: boolean;
  /** Task #23 — true quando a última mensagem do paciente foi apenas uma
   *  saudação curta ("oi", "bom dia", "tudo bem?") sem queixa específica.
   *  Quando true, a 1ª resposta JÁ deve incluir a pergunta plano/particular
   *  (não há contexto a acolher em profundidade). */
  incomingIsGreeting?: boolean;
  /** Task #5 — mensagem original do paciente (usada para detectar intenção
   *  de pagamento/PIX e verificar se o card PIX foi incluído na resposta). */
  incomingMessage?: string | null;
  /** Task #5 — lista de profissionais ativos com dados de PIX para validar
   *  se o card PIX deve estar presente na resposta. */
  pixProfessionals?: Array<{
    pixEnabled?: boolean | null;
    pixKey?: string | null;
    pixMode?: string | null;
  }> | null;
  /** Task #20 — Nomes dos profissionais que foram dropados pelo filtro de
   *  especialidade neste turno. A IA NAO pode mencioná-los na resposta atual,
   *  mesmo que apareçam no histórico. */
  droppedProfessionalNames?: string[];
  /** Task #20 — Nomes dos profissionais que passaram o filtro de especialidade
   *  (usado para evitar falso-positivo quando um nome dropado compartilha
   *  prefixo com um nome permitido). */
  keptProfessionalNames?: string[];
  /** Dias de atendimento por convênio (comma-separated day numbers, 0=Dom … 6=Sab).
   *  Quando presente e mode=CONVENIO_AGENDAR, o validador bloqueia respostas que
   *  oferecem horário em dia fora da lista (ex.: "hoje às 14h" numa quinta quando
   *  só há sábado permitido). */
  insuranceDays?: string | null;
  /** Task #20 — Rótulos de especialidade detectados (auditoria/debug). */
  detectedSpecialtyLabels?: string[];
}

/** Task #23 — detecta saudação genérica curta sem queixa/dúvida específica. */
const GREETING_REGEX = /^(?:\s*(?:oi+|ol[áa]|al[ôo]|hey|hi|hello|bom\s*dia|boa\s*tarde|boa\s*noite|tudo\s*bem|tudo\s*bom|e\s*a[íi]|hello+)[\s,!.?]*)+$/i;
export function isGenericGreeting(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 60) return false;
  return GREETING_REGEX.test(trimmed);
}

const TIME_REGEX = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;
const PRICE_REGEX = /R\$\s*([\d.,]*\d)/g;

/**
 * Parser canônico de valores monetários (BRL e numérico US).
 * Aceita: "1.500,00" (BR), "1500.00" (US), "1500", "150,5", número direto.
 * Retorna `null` quando não consegue interpretar com segurança.
 */
export function parseMoney(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  const s = String(input).trim();
  if (!s) return null;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  let normalized: string;
  if (hasComma && hasDot) {
    // Formato BR: "1.500,00" → "1500.00"
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    // Vírgula como separador decimal: "150,5" → "150.5"
    normalized = s.replace(",", ".");
  } else if (hasDot) {
    // Ambíguo "1.500" pode ser milhar BR ou 1.5 US.
    // Heurística: se houver exatamente 3 dígitos depois do ÚLTIMO ponto e
    // não houver vírgula, assume milhar BR (1.500 → 1500). Caso contrário
    // mantém como decimal US.
    const lastDot = s.lastIndexOf(".");
    const decimals = s.length - lastDot - 1;
    if (decimals === 3 && /^\d{1,3}(\.\d{3})+$/.test(s)) {
      normalized = s.replace(/\./g, "");
    } else {
      normalized = s;
    }
  } else {
    normalized = s;
  }
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * Lista de procedimentos odontológicos comuns. Usada apenas para detectar
 * quando a IA promete um procedimento específico que NÃO está cadastrado
 * no tenant. Mantida pequena de propósito para minimizar falsos positivos.
 */
const DENTAL_PROCEDURE_KEYWORDS = [
  // Implantodontia
  "implante",
  "implantes",
  "implantodontia",
  "osseointegração",
  "carga imediata",
  // Clareamento
  "clareamento",
  "branqueamento",
  "whitening",
  // Ortodontia
  "ortodontia",
  "aparelho",
  "alinhador",
  "alinhadores",
  "invisalign",
  "braquetes",
  "aparelho fixo",
  "aparelho removível",
  // Facetas / Lente de contato dental
  "faceta",
  "facetas",
  "lente de contato",
  "lentes de contato",
  "laminado",
  // Harmonização Facial
  "harmonizacao",
  "harmonização",
  "botox",
  "preenchimento",
  "toxina botulinica",
  "toxina botulínica",
  "bichectomia",
  "rinomodelacao",
  "rinomodelação",
  "bioestimulador",
  "fio de sustentacao",
  "fio de sustentação",
  // Dentística / Restauração
  "restauracao",
  "restauração",
  "resina",
  "obturacao",
  "obturação",
  "dentistica",
  "dentística",
  "carie",
  "cárie",
  // Prótese
  "protese",
  "prótese",
  "dentadura",
  "coroa",
  "ponte",
  "protocolo",
  "all on four",
  "all on 4",
  // Endodontia / Canal
  "canal",
  "endodontia",
  "retratamento de canal",
  // Periodontia
  "periodontia",
  "raspagem",
  "periodontista",
  "gengivite",
  "doenca periodontal",
  "doença periodontal",
  "curetagem",
  // Limpeza / Profilaxia
  "limpeza profunda",
  "profilaxia",
  "tartaro",
  "tártaro",
  // Cirurgia
  "cirurgia",
  "extracao",
  "extração",
  "siso",
  "terceiro molar",
  "enxerto",
];

/**
 * Mapeia keywords para os nomes dos procedimentos-pai cadastrados no tenant.
 * Quando a keyword não bate diretamente com o nome do procedimento,
 * verifica se algum alias bate — evitando falsos positivos no validador.
 *
 * As chaves são os termos populares; os valores são variações do nome
 * do procedimento como pode estar cadastrado no sistema.
 */
const KEYWORD_PROCEDURE_ALIASES: Record<string, string[]> = {
  // Implante
  "implantes":        ["implante", "implantodontia"],
  "implantodontia":   ["implante", "implantodontia"],
  "osseointegração":  ["implante", "implantodontia"],
  "carga imediata":   ["implante", "implantodontia"],

  // Clareamento
  "branqueamento":    ["clareamento"],
  "whitening":        ["clareamento"],

  // Ortodontia
  "aparelho":         ["ortodontia"],
  "alinhador":        ["ortodontia"],
  "alinhadores":      ["ortodontia"],
  "invisalign":       ["ortodontia"],
  "braquetes":        ["ortodontia"],
  "aparelho fixo":    ["ortodontia"],
  "aparelho removível": ["ortodontia"],

  // Faceta / Lente de contato dental
  "facetas":          ["faceta", "lente de contato", "laminado"],
  "lente de contato": ["faceta", "lente", "laminado"],
  "lentes de contato":["faceta", "lente", "laminado"],
  "laminado":         ["faceta", "lente de contato"],

  // Harmonização Facial
  "harmonizacao":           ["harmonizacao facial", "harmonização facial", "harmonizacao", "harmonização"],
  "harmonização":           ["harmonizacao facial", "harmonização facial", "harmonizacao", "harmonização"],
  "botox":                  ["harmonizacao", "harmonização", "harmonizacao facial", "harmonização facial", "botox"],
  "preenchimento":          ["harmonizacao", "harmonização", "harmonizacao facial", "harmonização facial", "preenchimento"],
  "toxina botulinica":      ["harmonizacao", "harmonização", "harmonizacao facial", "harmonização facial", "botox"],
  "toxina botulínica":      ["harmonizacao", "harmonização", "harmonizacao facial", "harmonização facial", "botox"],
  "bichectomia":            ["harmonizacao", "harmonização", "harmonizacao facial", "harmonização facial", "cirurgia"],
  "rinomodelacao":          ["harmonizacao", "harmonização", "harmonizacao facial", "harmonização facial"],
  "rinomodelação":          ["harmonizacao", "harmonização", "harmonizacao facial", "harmonização facial"],
  "bioestimulador":         ["harmonizacao", "harmonização", "harmonizacao facial", "harmonização facial"],
  "fio de sustentacao":     ["harmonizacao", "harmonização", "harmonizacao facial", "harmonização facial"],
  "fio de sustentação":     ["harmonizacao", "harmonização", "harmonizacao facial", "harmonização facial"],

  // Dentística / Restauração
  "restauracao":    ["dentistica", "dentística", "restauracao", "restauração", "clinica geral", "clínica geral"],
  "restauração":    ["dentistica", "dentística", "restauracao", "restauração", "clinica geral", "clínica geral"],
  "resina":         ["dentistica", "dentística", "restauracao", "restauração", "clinica geral", "clínica geral"],
  "obturacao":      ["dentistica", "dentística", "restauracao", "restauração", "clinica geral", "clínica geral"],
  "obturação":      ["dentistica", "dentística", "restauracao", "restauração", "clinica geral", "clínica geral"],
  "dentistica":     ["dentistica", "dentística"],
  "dentística":     ["dentistica", "dentística"],
  "carie":          ["dentistica", "dentística", "restauracao", "restauração", "clinica geral", "clínica geral"],
  "cárie":          ["dentistica", "dentística", "restauracao", "restauração", "clinica geral", "clínica geral"],

  // Prótese
  "protese":        ["protese", "prótese"],
  "prótese":        ["protese", "prótese"],
  "dentadura":      ["protese", "prótese"],
  "coroa":          ["protese", "prótese", "coroa"],
  "ponte":          ["protese", "prótese", "ponte"],
  "protocolo":      ["protese", "prótese", "implante", "implantodontia"],
  "all on four":    ["protese", "prótese", "implante", "implantodontia"],
  "all on 4":       ["protese", "prótese", "implante", "implantodontia"],

  // Endodontia / Canal
  "canal":                ["endodontia", "canal", "clinica geral", "clínica geral"],
  "retratamento de canal":["endodontia", "canal"],

  // Periodontia
  "raspagem":           ["periodontia"],
  "periodontista":      ["periodontia"],
  "gengivite":          ["periodontia", "clinica geral", "clínica geral"],
  "doenca periodontal": ["periodontia"],
  "doença periodontal": ["periodontia"],
  "curetagem":          ["periodontia"],

  // Limpeza / Profilaxia
  "profilaxia":     ["limpeza", "limpeza profunda", "clinica geral", "clínica geral"],
  "tartaro":        ["limpeza", "limpeza profunda", "clinica geral", "clínica geral"],
  "tártaro":        ["limpeza", "limpeza profunda", "clinica geral", "clínica geral"],
  "limpeza profunda":["limpeza profunda", "limpeza", "periodontia", "clinica geral", "clínica geral"],

  // Cirurgia
  "cirurgia":       ["cirurgia", "clinica geral", "clínica geral"],
  "extracao":       ["cirurgia", "extracao", "extração", "clinica geral", "clínica geral"],
  "extração":       ["cirurgia", "extracao", "extração", "clinica geral", "clínica geral"],
  "siso":           ["cirurgia", "clinica geral", "clínica geral"],
  "terceiro molar": ["cirurgia", "clinica geral", "clínica geral"],
  "enxerto":        ["cirurgia", "implante", "implantodontia", "periodontia"],
};

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function isInsideHourRange(reply: string, time: string): boolean {
  const t = time.replace(":", "\\:");
  const before = new RegExp(`\\b\\d{1,2}:\\d{2}\\s*(?:as|às|a|-|—|até)\\s*${t}\\b`, "i");
  const after = new RegExp(`\\b${t}\\s*(?:as|às|a|-|—|até)\\s*\\d{1,2}:\\d{2}\\b`, "i");
  return before.test(reply) || after.test(reply);
}

export function validateAIResponse(ctx: ValidatorContext): Violation[] {
  // Task #17 — quando o modo determinístico vier preenchido, ele é a fonte
  // autoritativa para triagePending/isInsuranceContact. Evita divergência
  // entre o roteador de modo (prompt) e o validador.
  if (ctx.mode) {
    const fromMode = {
      triagePending: ctx.mode === "CONVENIO_TRIAGEM",
      isInsuranceContact: ctx.mode === "CONVENIO_AGENDAR",
    };
    ctx = { ...ctx, ...fromMode };
  }
  const violations: Violation[] = [];
  const reply = ctx.reply || "";
  const lowerNorm = normalize(reply);

  const times = Array.from(reply.matchAll(TIME_REGEX)).map((m) => m[0]);

  if (ctx.triagePending && times.length > 0) {
    violations.push({
      type: "time_outside_agenda",
      detail: `Ofertou horário(s) ${times.join(", ")} durante triagem plano/particular pendente.`,
    });
  } else if (times.length > 0 && ctx.availabilityInfo) {
    const allowed = new Set(
      Array.from(ctx.availabilityInfo.matchAll(TIME_REGEX)).map((m) => m[0]),
    );
    const bogus = times.filter((t) => !allowed.has(t) && !isInsideHourRange(reply, t));
    if (bogus.length > 0) {
      violations.push({
        type: "time_outside_agenda",
        detail: `Horário(s) ${bogus.join(", ")} não estão na AGENDA configurada.`,
      });
    }
  }

  if (ctx.triagePending) {
    // Distingue oferta concreta (com horário) de menção conversacional
    // ("antes de marcar, posso saber..."). A oferta concreta é violação
    // SEMPRE durante a triagem, mesmo que a IA também faça a pergunta
    // plano/particular na mesma resposta — não dá pra prometer slot sem
    // saber se atende o convênio da pessoa.
    const offeredConcreteSlot = times.length > 0;
    const mentionedSchedulingVerb = /\b(marcar|agendar|encaixe|encaixar|reservar|encaixei|reservei)\b/i.test(reply);
    const askedTriage = /(plano|conv[eê]nio|particular)/i.test(reply);
    if (offeredConcreteSlot) {
      violations.push({
        type: "triage_ignored",
        detail: askedTriage
          ? "Ofereceu horário na MESMA mensagem em que pergunta plano/particular — proibido durante a triagem; só ofereça agenda DEPOIS de saber se a pessoa é plano ou particular."
          : "Ofereceu agendamento sem perguntar plano/particular durante triagem pendente.",
      });
    } else if (mentionedSchedulingVerb && !askedTriage) {
      // Verbo de agendamento sem horário concreto e sem perguntar triagem
      // → ainda é uma promessa indevida (ex.: "posso te encaixar amanhã").
      violations.push({
        type: "triage_ignored",
        detail: "Ofereceu agendamento sem perguntar plano/particular durante triagem pendente.",
      });
    }
    // Task #17 + Task #23 — em CONVENIO_TRIAGEM a resposta DEVE conter a
    // pergunta plano/particular. Exceção (Task #23): a 1ª resposta da IA
    // pode ser puramente empática (acolher o paciente) desde que NÃO
    // ofereça agenda. A 2ª resposta em diante volta a exigir a pergunta.
    // Exceção da 1ª resposta vale SEMPRE que a IA não tocar em agenda
    // (mesmo quando o paciente só disse "oi"). O objetivo é que a IA
    // pareça uma recepcionista humana — calorosa, perguntando como a
    // pessoa está / o que a trouxe — ANTES de partir para a pergunta
    // plano/particular. A 2ª resposta em diante volta a exigir a pergunta.
    const firstReplyExempt =
      ctx.isFirstAIReplyInMode === true &&
      !offeredConcreteSlot &&
      !mentionedSchedulingVerb;
    if (
      ctx.mode === "CONVENIO_TRIAGEM" &&
      !askedTriage &&
      reply.trim().length > 0 &&
      !firstReplyExempt
    ) {
      violations.push({
        type: "triage_ignored",
        detail: "Modo CONVENIO_TRIAGEM exige perguntar se a pessoa vai usar plano ou é particular.",
      });
    }
  }

  // procedure_not_listed roda mesmo com lista vazia: catálogo vazio significa
  // que NENHUM procedimento dental específico pode ser prometido pela IA.
  const tenantProcsNorm = ctx.procedureNames.map(normalize);
  for (const kw of DENTAL_PROCEDURE_KEYWORDS) {
    const kwNorm = normalize(kw);
    if (!lowerNorm.includes(kwNorm)) continue;
    const directMatch = tenantProcsNorm.some(
      (p) => p.includes(kwNorm) || kwNorm.includes(p),
    );
    const aliasMatch = !directMatch && (KEYWORD_PROCEDURE_ALIASES[kw] || []).some((alias) => {
      const aliasNorm = normalize(alias);
      return tenantProcsNorm.some((p) => p.includes(aliasNorm) || aliasNorm.includes(p));
    });
    if (!directMatch && !aliasMatch) {
      violations.push({
        type: "procedure_not_listed",
        detail: `Mencionou "${kw}", que não está nos procedimentos cadastrados.`,
      });
      break;
    }
  }

  if (ctx.ownerTitle && ctx.ownerFirstName) {
    const wrong = ctx.ownerTitle === "Dr." ? "Dra" : "Dr";
    const firstName = ctx.ownerFirstName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const wrongRegex = new RegExp(`\\b${wrong}\\.?\\s+${firstName}\\b`, "i");
    if (wrongRegex.test(reply)) {
      violations.push({
        type: "owner_title_wrong",
        detail: `Tratou ${ctx.ownerFirstName} como "${wrong}." (correto: "${ctx.ownerTitle}").`,
      });
    }
  }

  const priceMatches = Array.from(reply.matchAll(PRICE_REGEX))
    .map((m) => parseMoney(m[1]))
    .filter((n): n is number => n !== null);
  if (priceMatches.length > 0) {
    const allowedPrices: number[] = [];
    const fee = parseMoney(ctx.consultationFee);
    if (fee !== null) allowedPrices.push(fee);
    ctx.procedurePrices.forEach((p) => allowedPrices.push(p));
    // Accept values within ±10% of any registered price to cover "a partir de",
    // rounding, and natural range mentions by the AI (e.g. R$270 ≈ R$300 * 0.9).
    const isWithinTolerance = (mentioned: number) =>
      allowedPrices.some((ref) => {
        if (ref === 0) return mentioned === 0;
        return Math.abs(mentioned - ref) / ref <= 0.10;
      });
    const bogus = priceMatches.filter((p) => !isWithinTolerance(p));
    if (bogus.length > 0) {
      violations.push({
        type: "price_invented",
        detail: `Preço(s) R$${bogus.join(", R$")} não estão cadastrados (tolerância ±10%).`,
      });
    }
  }

  // policy_violation — promessas fora das políticas configuradas pela clínica:
  //   (a) "consulta gratuita / sem custo / não cobramos" quando chargesConsultation=true
  //   (b) plano/convênio prometido fora de insurancePlans
  //   (c) clínica NÃO aceita convênio mas IA promete aceitar
  //   (d) método de pagamento prometido fora de paymentMethods
  if (ctx.chargesConsultation === true) {
    const freeClaims =
      /\b(gr[áa]tis|gratuita|sem\s+(custo|cobran[cç]a)|n[ãa]o\s+(cobramos|tem\s+custo|paga))\b/i;
    if (freeClaims.test(reply)) {
      violations.push({
        type: "policy_violation",
        detail: "Prometeu consulta gratuita/sem custo, mas a clínica cobra consulta.",
      });
    }
  }

  if (ctx.acceptsInsurance === false) {
    const insuranceMention =
      /\b(aceit\w*\s+(plano|conv[eê]nio)|atend\w*\s+(plano|conv[eê]nio)|cobre\w*\s+pelo?\s+(plano|conv[eê]nio))\b/i;
    if (insuranceMention.test(reply)) {
      violations.push({
        type: "policy_violation",
        detail: "Prometeu aceitar plano/convênio, mas a clínica é apenas particular.",
      });
    }
  } else if (ctx.acceptsInsurance === true && ctx.insurancePlans) {
    const tenantPlans = ctx.insurancePlans
      .split(/[,;|]/)
      .map((s) => normalize(s.trim()))
      .filter(Boolean);
    if (tenantPlans.length > 0) {
      const COMMON_INSURANCE = [
        "amil", "unimed", "bradesco", "sulamerica", "sul america", "hapvida",
        "notredame", "notre dame", "porto seguro", "golden cross", "biosaude",
        "biosaúde", "interodonto", "odontoprev", "uniodonto", "metlife",
      ];
      for (const plan of COMMON_INSURANCE) {
        const planNorm = normalize(plan);
        if (!lowerNorm.includes(planNorm)) continue;
        const matched = tenantPlans.some(
          (p) => p.includes(planNorm) || planNorm.includes(p),
        );
        if (!matched) {
          violations.push({
            type: "policy_violation",
            detail: `Mencionou plano "${plan}" que não está na lista cadastrada (${ctx.insurancePlans}).`,
          });
          break;
        }
      }
    }
  }

  if (ctx.paymentMethods) {
    const tenantMethods = ctx.paymentMethods
      .split(/[,;|]/)
      .map((s) => normalize(s.trim()))
      .filter(Boolean);
    if (tenantMethods.length > 0) {
      const PAY_KEYWORDS: Array<{ kw: string; alias: string[] }> = [
        { kw: "pix", alias: ["pix"] },
        { kw: "cartao", alias: ["cartao", "cartão", "credito", "crédito", "debito", "débito"] },
        { kw: "boleto", alias: ["boleto"] },
        { kw: "dinheiro", alias: ["dinheiro", "especie", "espécie"] },
        { kw: "cheque", alias: ["cheque"] },
      ];
      for (const { kw, alias } of PAY_KEYWORDS) {
        const mentioned =
          alias.some((a) => lowerNorm.includes(normalize(a))) &&
          /\b(aceit\w*|paga\w*|parcel\w*|forma\s+de\s+pagamento)\b/i.test(reply);
        if (!mentioned) continue;
        const matched = tenantMethods.some((m) => m.includes(kw) || kw.includes(m));
        if (!matched) {
          violations.push({
            type: "policy_violation",
            detail: `Prometeu pagamento via "${kw}" não cadastrado em paymentMethods.`,
          });
          break;
        }
      }
    }
  }

  // pix_card_omitted — Task #5: quando paciente particular pergunta sobre
  // pagamento/PIX e há profissional com PIX habilitado, a resposta DEVE
  // conter o card formatado "DADOS PARA PAGAMENTO PIX". Convênio é excluído
  // pois a validação de modo convênio já proíbe PIX nesse fluxo.
  const isConvenioMode =
    ctx.mode === "CONVENIO_TRIAGEM" ||
    ctx.mode === "CONVENIO_AGENDAR" ||
    ctx.isInsuranceContact === true;
  if (!isConvenioMode && ctx.pixProfessionals && ctx.incomingMessage) {
    const hasPixProf = ctx.pixProfessionals.some((p) => p.pixEnabled && p.pixKey);
    if (hasPixProf) {
      const PAYMENT_INTENT_REGEX =
        /\b(pix|forma\s+de\s+pagamento|formas\s+de\s+pagamento|como\s+(?:\S+\s+){0,3}pagamento|como\s+pago|como\s+fa[cç]o\s+o\s+pagamento|posso\s+pagar|quero\s+pagar|como\s+se\s+paga|qual\s+(?:\S+\s+)?forma\s+de\s+pagamento|aceita\s+pix|dados\s+do\s+pix|chave\s+pix)\b/i;
      const askedAboutPayment = PAYMENT_INTENT_REGEX.test(ctx.incomingMessage);
      if (askedAboutPayment) {
        const hasPixCard = reply.includes("DADOS PARA PAGAMENTO PIX");
        if (!hasPixCard) {
          violations.push({
            type: "pix_card_omitted",
            detail:
              "Paciente perguntou sobre pagamento/PIX mas a resposta não incluiu o card PIX formatado (\"DADOS PARA PAGAMENTO PIX\"). Envie o card completo na mesma resposta.",
          });
        }
      }
    }
  }

  // Task #20 — dropped_professional_mentioned: a IA mencionou na resposta um
  // profissional que foi DROPADO pelo filtro de especialidade neste turno
  // (ex.: paciente disse "dente torto" → ortodontia → Dr. Robertino, que é
  // implantodontista, ficou de fora da lista permitida; mesmo assim a IA
  // o ofereceu lembrando do histórico). Comparamos por "stem" do primeiro
  // nome para tolerar typos do modelo (ex.: "Robertin" vs "Robertino"). Para
  // evitar falsos positivos quando um nome dropado compartilha prefixo com um
  // nome permitido (ex.: "Robson" permitido x "Roberto" dropado), pulamos
  // stems que coincidam com qualquer nome mantido.
  if (ctx.droppedProfessionalNames && ctx.droppedProfessionalNames.length > 0) {
    const stripTitle = (n: string) => n.replace(/^\s*(dr\.?|dra\.?)\s+/i, "").trim();
    const firstNameStem = (raw: string): string => {
      const first = normalize(stripTitle(raw)).split(/\s+/)[0] || "";
      if (first.length < 4) return first;
      // 6-char prefix is enough to disambiguate similar dental names while
      // tolerating typos in the trailing characters (Robertino → "robert").
      return first.length > 6 ? first.slice(0, 6) : first;
    };
    const keptStems = new Set<string>(
      (ctx.keptProfessionalNames || [])
        .map((n) => firstNameStem(n))
        .filter((s) => s.length >= 4),
    );
    const labelsStr = (ctx.detectedSpecialtyLabels || []).join(" / ") || "essa area";
    for (const dropped of ctx.droppedProfessionalNames) {
      const stem = firstNameStem(dropped);
      if (stem.length < 4) continue;
      if (keptStems.has(stem)) continue;
      const stemRegex = new RegExp(`\\b${stem}\\w*`, "i");
      if (stemRegex.test(lowerNorm)) {
        violations.push({
          type: "dropped_professional_mentioned",
          detail: `Mencionou "${dropped}" que foi filtrado da lista de profissionais para a necessidade detectada (${labelsStr}). Esse profissional NAO atende essa especialidade — nao pode ser oferecido nesta resposta, mesmo que apareca no historico.`,
        });
        break;
      }
    }
  }

  // insurance_wrong_day — Para CONVENIO_AGENDAR, bloqueia respostas que
  // oferecem horário em dia que NÃO está em insurance_days do profissional.
  // Ex.: Siverino tem insurance_days=6 (sábado) mas o modelo disse "hoje às 14h"
  // numa quinta-feira → violação imediata antes de chegar ao paciente.
  if (ctx.mode === "CONVENIO_AGENDAR" && ctx.insuranceDays?.trim()) {
    const allowedDayNums = ctx.insuranceDays
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));
    if (allowedDayNums.length > 0) {
      const DAY_PATTERNS: Array<[RegExp, number]> = [
        [/\bdomingo\b/i, 0],
        [/\bsegunda(-feira)?\b/i, 1],
        [/\bter[cç]a(-feira)?\b/i, 2],
        [/\bquarta(-feira)?\b/i, 3],
        [/\bquinta(-feira)?\b/i, 4],
        [/\bsexta(-feira)?\b/i, 5],
        [/\bs[aá]bado\b/i, 6],
      ];
      // "hoje" → resolve to current local day (UTC-3 Brazil)
      if (/\bhoje\b/i.test(reply)) {
        const localNow = new Date(Date.now() - 3 * 3600000);
        const todayDay = localNow.getUTCDay();
        if (!allowedDayNums.includes(todayDay)) {
          violations.push({
            type: "insurance_wrong_day",
            detail: `Ofereceu horário "hoje" (dia ${todayDay}) mas hoje não é dia de atendimento por convênio (insurance_days=${ctx.insuranceDays}). Ofereça apenas os dias permitidos.`,
          });
        }
      }
      // Explicit weekday names
      if (!violations.some((v) => v.type === "insurance_wrong_day")) {
        for (const [re, dayNum] of DAY_PATTERNS) {
          if (re.test(reply) && !allowedDayNums.includes(dayNum)) {
            violations.push({
              type: "insurance_wrong_day",
              detail: `Ofereceu dia não permitido para convênio (dia ${dayNum} não está em insurance_days=${ctx.insuranceDays}). Use apenas os dias configurados.`,
            });
            break;
          }
        }
      }
    }
  }

  // insurance_sales_term — bloqueia termos de venda/escassez em respostas
  // para pacientes de convênio E pacientes recorrentes. Usa a mesma lista do
  // insurance-audit.ts, garantindo consistência entre validação em tempo real
  // e auditoria retroativa.
  // Task #17 — PACIENTE_AGENDAR também é "no-SPIN/no-scarcity": paciente já é
  // da casa, não cabe argumentação de venda nem escassez.
  const blockSalesTerms = ctx.isInsuranceContact === true || ctx.mode === "PACIENTE_AGENDAR";
  if (blockSalesTerms) {
    const forbidden = findForbiddenTerms(reply);
    if (forbidden.length > 0) {
      const contextLabel = ctx.mode === "PACIENTE_AGENDAR" ? "conversa com paciente recorrente" : "conversa de convênio";
      violations.push({
        type: "insurance_sales_term",
        detail: `Usou termo(s) proibido(s) em ${contextLabel}: "${forbidden.join('", "')}".`,
      });
    }
  }

  // Task #24 — em CONVENIO_AGENDAR a IA NÃO pode mencionar valor da consulta
  // (o convênio cobre). Detecta padrões de preço ("R$", "valor da consulta",
  // "sai por R$") em respostas de modo convênio e flag como policy_violation.
  if (ctx.mode === "CONVENIO_AGENDAR" || ctx.isInsuranceContact === true) {
    const priceMention = /R\$\s*\d|valor\s+da\s+consulta|consulta\s+sai\s+por|sai\s+por\s+R\$/i;
    if (priceMention.test(reply)) {
      violations.push({
        type: "policy_violation",
        detail: "Mencionou valor de consulta em conversa de convênio (proibido — o convênio cobre).",
      });
    }
    // Detecta envio de cartão PIX, chave PIX, ou instruções de pagamento
    // antecipado em conversa de convênio. Convênio NÃO paga nada antes da
    // consulta — qualquer menção a PIX/comprovante/sinal é violação dura.
    const pixMention = /\b(pix|chave\s+pix|dados\s+para\s+pagamento|comprovante|sinal|reserva\s+paga|transfer[eê]ncia|dep[oó]sito)\b|💠/i;
    if (pixMention.test(reply)) {
      violations.push({
        type: "policy_violation",
        detail: "Enviou PIX/cobrança em conversa de convênio (proibido — convênio não paga antes).",
      });
    }
  }

  return violations;
}

export function buildCorrectionHint(violations: Violation[]): string {
  const lines = violations.map((v) => `- [${v.type}] ${v.detail}`);
  return [
    "[CORREÇÃO NECESSÁRIA — sua resposta anterior violou regras da clínica. Reescreva respeitando:]",
    ...lines,
    "Reescreva a resposta sem essas violações. Se faltar dado, diga que vai confirmar com a clínica e responder em breve.",
  ].join("\n");
}

export function deterministicFallback(
  violations: Violation[],
  opts: {
    triagePending?: boolean;
    /** Task #17 — modo de conversa para escolher fallback apropriado. */
    mode?: "CONVENIO_TRIAGEM" | "CONVENIO_AGENDAR" | "PARTICULAR_SPIN" | "PACIENTE_AGENDAR";
  } = {},
): string {
  const types = new Set(violations.map((v) => v.type));
  const triagePending = opts.triagePending || opts.mode === "CONVENIO_TRIAGEM";
  if (types.has("triage_ignored") || (types.has("time_outside_agenda") && triagePending)) {
    return "Antes de te passar horários, posso confirmar: você vai usar plano/convênio ou é particular?";
  }
  if (types.has("time_outside_agenda")) {
    return "Vou conferir a agenda atualizada com a clínica e já te retorno com os horários disponíveis, tá bom?";
  }
  if (types.has("procedure_not_listed")) {
    return "Vou confirmar essa informação com a clínica e te respondo em breve, tá bom?";
  }
  if (types.has("price_invented")) {
    return "Deixa eu confirmar o valor exato com a clínica e já te retorno, tá bom?";
  }
  if (types.has("owner_title_wrong")) {
    return "Vou confirmar isso com a clínica e te respondo em breve.";
  }
  if (types.has("insurance_sales_term")) {
    // Task #17 — fallback é mode-aware: paciente recorrente nunca recebe
    // menção a convênio (pode ser de clínica particular). Particular sem
    // SPIN também tem texto neutro.
    if (opts.mode === "PACIENTE_AGENDAR") {
      return "Qual o melhor dia da semana pra te receber aqui na clínica?";
    }
    if (opts.mode === "PARTICULAR_SPIN") {
      return "Qual seria o melhor dia pra você vir até a clínica?";
    }
    return "Posso te ajudar a agendar sua consulta pelo convênio. Qual seria o melhor dia pra você?";
  }
  if (types.has("pix_card_omitted")) {
    return "Para pagamento via PIX, por favor aguarde um momento que te mando os dados completos!";
  }
  if (types.has("dropped_professional_mentioned")) {
    // Resposta segura sem nomear profissionais nem prometer agenda. Permite
    // ao operador humano corrigir o roteamento sem expor o nome bloqueado.
    return "Deixa eu confirmar com a clínica qual profissional vai poder te atender e já te retorno, tá bom?";
  }
  if (types.has("insurance_wrong_day")) {
    return "Vou confirmar o dia disponível para atendimento pelo convênio e já te retorno, tá bom?";
  }
  if (types.has("policy_violation")) {
    return "Deixa eu confirmar essa política com a clínica e já te retorno com a informação correta, tá bom?";
  }
  return "Vou confirmar isso com a clínica e te respondo em breve.";
}

// ─────────────────────────────────────────────────────────────────────────
// Task #25 — Validador FINO para o caminho de constrained generation.
//
// O renderer determinístico é a fonte da verdade para datas/horas/preços/
// nomes próprios — ele NÃO pode produzi-los errado por construção. Logo,
// no caminho restrito só precisamos verificar duas coisas:
//   1. termos comerciais agressivos proibidos em convênio (urgência,
//      "perde a vaga", etc.) — reaproveitando insurance-audit;
//   2. menção a planos de saúde quando isInsuranceContact=false e a clínica
//      não aceita o plano (heurística leve, evita afirmação errada).
//
// Mantém a auditoria existente (insurance-audit) viva e descarta as 8+
// regras estruturais do validador grande, que ficam impossíveis de violar.
// ─────────────────────────────────────────────────────────────────────────

export interface ConstrainedValidationOptions {
  isInsuranceContact: boolean;
  insurancePlans?: string | null;
  /** NOVO: true se ≥1 profissional ATIVO aceita plano. Quando false,
   *  validador bloqueia qualquer menção a plano/convênio na resposta. */
  clinicAcceptsAnyInsurance?: boolean;
}

export function validateConstrainedReply(
  reply: string,
  opts: ConstrainedValidationOptions,
): Array<
  | { type: "insurance_sales_term"; detail: string }
  | { type: "insurance_mention_when_not_accepted"; detail: string }
> {
  const out: Array<
    | { type: "insurance_sales_term"; detail: string }
    | { type: "insurance_mention_when_not_accepted"; detail: string }
  > = [];
  if (!reply || !reply.trim()) return out;

  if (opts.isInsuranceContact) {
    const terms = findForbiddenTerms(reply);
    for (const t of terms) {
      out.push({ type: "insurance_sales_term", detail: t });
    }
  }
  return out;
}
