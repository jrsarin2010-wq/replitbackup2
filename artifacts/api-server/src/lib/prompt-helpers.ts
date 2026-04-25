import { db } from "@workspace/db";
import { dentalPortfolioItemsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export function buildInstagramSocialProofSection(
  temperature: string | undefined,
  professionals: Array<{ id: number; instagramUrl?: string | null; profilePhotoUrl?: string | null; name: string; isOwner: boolean }>,
  fallbackProfName: string,
  leadProfessionalId?: number | null
): string {
  let selectedProf: typeof professionals[number] | null = null;
  if (leadProfessionalId) {
    selectedProf = professionals.find((p) => p.id === leadProfessionalId && p.instagramUrl) || null;
  }
  if (!selectedProf) {
    selectedProf = professionals.find((p) => p.isOwner && p.instagramUrl) || null;
  }
  if (!selectedProf) {
    selectedProf = professionals.find((p) => p.instagramUrl) || null;
  }
  const rawHandle = selectedProf?.instagramUrl;
  if (!rawHandle) return "";
  const cleaned = rawHandle
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/^@/, "")
    .replace(/\/$/, "")
    .trim();
  if (!cleaned) return "";
  const instagramUrl = `https://instagram.com/${cleaned}`;
  const profName = selectedProf?.name || fallbackProfName || "profissional";

  return `
PROVA SOCIAL — INSTAGRAM (use com naturalidade, apenas 1 vez por conversa):
- Use o Instagram como argumento de confianca mostrando trabalhos realizados.
- NUNCA envie o card do Instagram na primeira mensagem da conversa. Espere o momento certo.
- Momentos estrategicos para usar o card (inclua [INSTAGRAM_CARD] na resposta):
  1. Quando o lead hesitar ou demonstrar duvida ("vou pensar", "nao sei", "ta caro", "sera que e bom?")
  2. Quando o lead pedir para ver trabalhos, resultados, fotos ou o Instagram do profissional
  3. Quando perguntarem sobre qualidade, resultados ou experiencia do profissional
  4. Apos apresentar um procedimento, se o lead ainda nao se decidiu
- PROIBIDO: enviar [INSTAGRAM_CARD] na primeira mensagem, no primeiro contato, ou antes de entender a necessidade do lead.
- Como usar: coloque [INSTAGRAM_CARD] no ponto da mensagem onde quer que o card seja enviado. O sistema envia automaticamente a foto do(a) ${profName} com o link do Instagram.
- Exemplo: "Que tal dar uma olhada nos trabalhos do(a) ${profName} antes de decidir? [INSTAGRAM_CARD]"
- Use [INSTAGRAM_CARD] no maximo 1 vez por conversa. Nao repita. Nao mencione o link manualmente.
- Instagram do profissional: ${instagramUrl}`;
}

/**
 * Cross-specialty insurance routing.
 *
 * When an insurance lead asks for a procedure that no insurance-accepting
 * professional in the clinic handles (typical aesthetic/implant cases), the AI
 * must NOT slip into convênio scarcity mode. Instead it should:
 *   1. Explain the convênio doesn't cover that procedure here.
 *   2. Redirect to the private professional(s) who do handle it,
 *      mentioning whether the consultation is free or paid (+ value).
 *
 * Pure function — used by ai-engine.ts to build a [SISTEMA: ...] hint and to
 * suppress the AGENDA block (so the model has no slot data to push under
 * commercial pressure).
 */
const PROCEDURE_SPECIALTY_GROUPS: Array<{
  procedureLabel: string;
  procedureKeywords: RegExp;
  specialtyKeywords: RegExp;
}> = [
  {
    procedureLabel: "implante",
    procedureKeywords: /\b(implante[s]?|implante\s+dental|implante\s+dent[aá]rio|dente\s+caiu|dente\s+perdido|dente\s+faltando|falta\s+dente|sem\s+dente|perdi\s+(?:\w+\s+)?dente|dente\s+(?:foi\s+|que\s+)?arrancad[ao]|arrancad[ao]\s+(?:\w+\s+)?dente|caiu\s+(?:\w+\s+)?dente|dente\s+que\s+caiu|arrancaram\s+(?:\w+\s+)?dente|colocar\s+dente)\b/i,
    specialtyKeywords: /implant/i,
  },
  {
    procedureLabel: "clareamento",
    procedureKeywords: /\b(clareamento|clarear|branqueamento|branquear|dente\s+amarelo|manchas?\s+nos?\s+dentes?)\b/i,
    specialtyKeywords: /(estetic|est[eé]tic|clareament|cosmetic)/i,
  },
  {
    procedureLabel: "lente / faceta",
    procedureKeywords: /\b(lente\s+de\s+contato|facetas?|porcelana|lente\s+de\s+resina)\b/i,
    specialtyKeywords: /(estetic|est[eé]tic|protese|pr[oó]tese)/i,
  },
  {
    procedureLabel: "harmonizacao facial",
    procedureKeywords: /\b(harmoniza[cç][aã]o|botox|preenchimento|toxina\s+botul[ií]nica)\b/i,
    specialtyKeywords: /(harmoniza|estetic|est[eé]tic)/i,
  },
];

export interface NonCoveredRoutingProfessional {
  name: string;
  specialties?: string | null;
  specialty?: string | null;
  acceptsInsurance?: boolean | null;
  chargesConsultation?: boolean | null;
  consultationFee?: string | null;
  isActive?: boolean | null;
}

export interface NonCoveredRoutingResult {
  procedureLabel: string;
  privateProfs: Array<{
    name: string;
    chargesConsultation: boolean;
    consultationFee: string | null;
  }>;
}

export function detectNonCoveredProcedureRouting(
  currentMessage: string,
  professionals: NonCoveredRoutingProfessional[],
): NonCoveredRoutingResult | null {
  if (!currentMessage) return null;
  const active = professionals.filter((p) => p.isActive !== false);
  if (active.length === 0) return null;

  for (const group of PROCEDURE_SPECIALTY_GROUPS) {
    if (!group.procedureKeywords.test(currentMessage)) continue;

    const profsWithSpec = active.filter((p) => {
      const spec = `${p.specialties || ""} ${p.specialty || ""}`.trim();
      return spec.length > 0 && group.specialtyKeywords.test(spec);
    });
    if (profsWithSpec.length === 0) continue;

    const insuranceCovers = profsWithSpec.some((p) => p.acceptsInsurance === true);
    if (insuranceCovers) return null;

    const privateProfs = profsWithSpec
      .filter((p) => p.acceptsInsurance !== true)
      .map((p) => ({
        name: p.name,
        chargesConsultation: p.chargesConsultation !== false,
        consultationFee: p.consultationFee || null,
      }));
    if (privateProfs.length === 0) return null;

    return { procedureLabel: group.procedureLabel, privateProfs };
  }

  return null;
}

export function buildNonCoveredRoutingHint(
  result: NonCoveredRoutingResult,
): string {
  const profDescriptions = result.privateProfs.map((p) => {
    if (!p.chargesConsultation) {
      return `${p.name} (consulta de avaliacao GRATUITA)`;
    }
    if (p.consultationFee) {
      return `${p.name} (consulta particular R$${p.consultationFee}, pode ser pago via PIX)`;
    }
    return `${p.name} (atendimento particular)`;
  });
  const profList = profDescriptions.join(" ou ");

  return `[SISTEMA: ROTEAMENTO POR PROCEDIMENTO NAO COBERTO POR CONVENIO. O contato usa plano, mas pediu "${result.procedureLabel}" — nenhum profissional desta clinica atende esse procedimento por convenio. PROIBIDO ABSOLUTO usar escassez, "encaixes hoje", "ultimo horario", oferta de horarios ou pressao comercial. PROIBIDO oferecer agendamento por convenio para esse procedimento. RESPOSTA OBRIGATORIA nesta mensagem (nesta ordem, em tom acolhedor): (1) explique com gentileza que o convenio nao cobre ${result.procedureLabel} aqui na clinica; (2) ofereca como alternativa o atendimento PARTICULAR com ${profList}; (3) pergunte se a pessoa tem interesse em seguir como particular para que voce possa apresentar os horarios. NAO ofereca horarios nesta resposta — primeiro confirme se ela aceita seguir particular.]`;
}

export const DENTAL_SPECIALTY_KEYWORDS: Array<{ keywords: string[]; section: string }> = [
  {
    keywords: ["lente de resina", "lente resina", "resina", "faceta de resina", "faceta resina"],
    section: `ESPECIALIDADE — LENTES DE CONTATO DE RESINA:
- Tom: entusiasmo discreto, foque em naturalidade e acessibilidade.
- Como apresentar: solucao estetica acessivel, sem desgaste do dente, resultado rapido na mesma consulta.
- Argumento de venda sutil: "E a forma mais rapida e acessivel de transformar o sorriso sem mexer no dente."
- Como diferenciar da ceramica: resina = mais acessivel, mais rapida, dura 3-5 anos; ceramica = mais duravel (10-15 anos), resultado mais natural, feita em lab.
- Regra: NUNCA recomende um procedimento especifico. Apresente as opcoes e direcione para avaliacao.`,
  },
  {
    keywords: ["lente de ceramica", "lente ceramica", "porcelana", "faceta de porcelana", "faceta ceramica", "lente de porcelana"],
    section: `ESPECIALIDADE — LENTES DE CONTATO DE CERAMICA (PORCELANA):
- Tom: aspiracional, qualidade premium, resultado de longo prazo.
- Como apresentar: solucao mais sofisticada, durabilidade de 10-15 anos, resultado extremamente natural.
- Argumento de venda sutil: "E o padrao ouro do sorriso estetico — quase impossivel distinguir do dente natural."
- Como diferenciar da resina: ceramica = mais duravel, mais cara, feita em lab (algumas sessoes); resina = mais rapida, mais acessivel.
- Regra: NUNCA recomende um procedimento especifico. Apresente as opcoes e direcione para avaliacao.`,
  },
  {
    keywords: ["harmonizacao", "botox", "preenchimento", "harmonizacao facial", "toxina botulinica", "lip", "labio"],
    section: `ESPECIALIDADE — HARMONIZACAO FACIAL (BOTOX E PREENCHIMENTO):
- Tom: estetico, natural, empoderador. Enfase em naturalidade e personalizacao.
- Como apresentar: conjunto de procedimentos que equilibram os tracos do rosto sem exageros.
- Argumento de venda sutil: "O objetivo e sempre um resultado natural — realcar, nao transformar. Cada caso e personalizado."
- Botox: suaviza linhas de expressao, resultado em dias, dura 4-6 meses.
- Preenchimento labial: volumiza e define labios, resultado imediato, pode ter leve inchaco nos primeiros dias.
- Regra: NUNCA faca indicacao clinica. Sempre direcione para avaliacao. Nunca minimize medos — acolha e tranquilize.`,
  },
  {
    keywords: ["clareamento", "clarear", "dente amarelo", "branquear", "branqueamento", "manchas nos dentes"],
    section: `ESPECIALIDADE — CLAREAMENTO DENTAL:
- Tom: acessivel, resultado visivel, transformacao simples.
- Como apresentar: procedimento seguro que clareia o esmalte do dente de forma controlada.
- Argumento de venda sutil: "O clareamento e um dos tratamentos com melhor custo-beneficio — muda muito o sorriso com pouco investimento."
- Tipos: clareamento a laser (na clinica, mais rapido); moldeirinha caseira (resultado gradual em casa).
- Sensibilidade: normal ter sensibilidade leve durante o tratamento, passa rapido, protocolo minimiza o desconforto.
- Regra: nunca garanta quantos tons vai clarear — varia por pessoa. Sempre direcione para avaliacao.`,
  },
  {
    keywords: ["implante", "implante dental", "implante dentario", "dente caiu", "dente perdido", "dente faltando"],
    section: `ESPECIALIDADE — IMPLANTES DENTARIOS:
- Tom: confiante, solucao definitiva, qualidade de vida.
- Como apresentar: solucao mais proxima de ter o dente natural de volta — fixo, funcional, sem tirar pra limpar.
- Argumento de venda sutil: "E o padrao ouro pra substituicao de dente — funciona como se fosse seu proprio dente."
- Processo: implante de titanio no osso + coroa definitiva em cima. Integracao leva 3-6 meses, mas ja sai com provisorio bonito.
- Sobre medo: procedimento com anestesia, a maioria fica surpresa como e tranquilo. Recuperacao rapida.
- Regra: nunca garantir que implante e possivel sem avaliacao — depende de osso disponivel. Sempre direcione para avaliacao.`,
  },
  {
    keywords: ["alinhador", "invisalign", "aparelho invisivel", "aparelho transparente", "alinhadores", "dente torto", "alinhamento"],
    section: `ESPECIALIDADE — ALINHADORES INVISIVEIS:
- Tom: moderno, discreto, pratico. Enfase em liberdade e estetica durante o tratamento.
- Como apresentar: alternativa ao aparelho fixo — praticamente invisivel, removivel pra comer e escovar, confortavel.
- Argumento de venda sutil: "Voce corrige os dentes sem ninguem perceber que esta fazendo tratamento."
- Como diferenciar do aparelho fixo: alinhador = invisivel, removivel, mais confortavel; fixo = pode ser necessario em casos mais complexos.
- Duracao: varia de 6 meses a 2 anos dependendo do caso.
- Regra: nunca garanta que alinhador e possivel sem avaliacao — depende da complexidade do caso.`,
  },
];

export async function buildPortfolioSection(
  tenantId: number,
  professionalId?: number | null
): Promise<string> {
  try {
    const baseCondition = and(
      eq(dentalPortfolioItemsTable.tenantId, tenantId),
      eq(dentalPortfolioItemsTable.active, true),
      ...(professionalId ? [eq(dentalPortfolioItemsTable.professionalId, professionalId)] : [])
    );
    const items = await db
      .select({ keywords: dentalPortfolioItemsTable.keywords })
      .from(dentalPortfolioItemsTable)
      .where(baseCondition);

    if (!items.length) return "";

    const allKeywords: string[] = [];
    for (const item of items) {
      if (!item.keywords) continue;
      const kws = item.keywords.split(/[,;\n]+/).map((k: string) => k.trim()).filter(Boolean);
      allKeywords.push(...kws);
    }

    if (!allKeywords.length) return "";

    const uniqueKeywords = [...new Set(allKeywords.map((k) => k.toLowerCase()))];

    return `
PORTFOLIO DO PROFISSIONAL — FOTOS DE RESULTADOS (use com naturalidade, apenas quando relevante):
- Quando o paciente/lead perguntar sobre resultados, procedimentos, "antes e depois" ou solicitar exemplos de trabalhos, voce PODE enviar uma foto do portfolio.
- Para enviar: inclua o marcador [PORTFOLIO_ITEM:<keyword>] na mensagem, onde <keyword> e uma das palavras-chave disponiveis.
- Palavras-chave disponiveis: ${uniqueKeywords.join(", ")}
- Exemplos de uso:
  "Quer ver um exemplo de resultado? [PORTFOLIO_ITEM:implante]"
  "Olha que resultado lindo que a gente ja fez! [PORTFOLIO_ITEM:clareamento]"
  "Posso te mostrar um antes e depois? [PORTFOLIO_ITEM:faceta]"
- Use [PORTFOLIO_ITEM:<keyword>] no maximo 1 vez por conversa. Nao repita. Escolha a keyword mais proxima do que o paciente perguntou.
- So use se o paciente perguntou sobre resultados/procedimentos — nao mande foto sem contexto.`;
  } catch {
    return "";
  }
}

export const SPECIALTY_KNOWLEDGE_LIMIT_HEADER =
  "LIMITE ABSOLUTO: Use APENAS as informacoes abaixo. Nao complemente com conhecimento proprio sobre esse procedimento.";

export function buildDentalSpecialtySection(currentMessage: string): string {
  if (!currentMessage) return "";

  const lower = currentMessage.toLowerCase();
  const matchedSections: string[] = [];

  for (const specialty of DENTAL_SPECIALTY_KEYWORDS) {
    if (specialty.keywords.some((kw) => lower.includes(kw))) {
      // Prepend the absolute-limit header to every specialty section so the AI
      // cannot mix injected clinical content with its own training data.
      matchedSections.push(`${SPECIALTY_KNOWLEDGE_LIMIT_HEADER}\n${specialty.section}`);
    }
  }

  if (!matchedSections.length) return "";

  return `\n${matchedSections.join("\n\n")}\n`;
}

const PIX_KEY_TYPE_LABELS: Record<string, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  phone: "Telefone",
  random: "Chave aleatória",
};

/**
 * Builds an elegant, WhatsApp-formatted PIX "card" with recipient name, bank,
 * key type, key and amount. Lines for fields that are not configured are
 * silently omitted. Used as the canonical text the AI must send verbatim when
 * presenting PIX data to the patient.
 */
export function buildPixCardText(prof: {
  name: string;
  pixKey: string;
  pixBank?: string | null;
  pixKeyType?: string | null;
  consultationFee?: string | null;
  chargesConsultation?: boolean | null;
}): string {
  const lines: string[] = [
    "💠 *DADOS PARA PAGAMENTO PIX* 💠",
    "━━━━━━━━━━━━━━━━━━━━━━",
    `👤 *Recebedor:* ${prof.name}`,
  ];
  if (prof.pixBank && prof.pixBank.trim()) {
    lines.push(`🏦 *Banco:* ${prof.pixBank.trim()}`);
  }
  if (prof.pixKeyType && PIX_KEY_TYPE_LABELS[prof.pixKeyType]) {
    lines.push(`🔑 *Tipo de chave:* ${PIX_KEY_TYPE_LABELS[prof.pixKeyType]}`);
  }
  lines.push(`📋 *Chave:* ${prof.pixKey}`);
  if (prof.chargesConsultation !== false && prof.consultationFee) {
    lines.push(`💰 *Valor:* R$ ${prof.consultationFee}`);
  }
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("Após o pagamento, é só me enviar o comprovante por aqui que eu confirmo seu agendamento na hora! 📸");
  return lines.join("\n");
}

export function buildPixInstructionsSection(
  professionals: Array<{ id: number; name: string; pixKey?: string | null; pixEnabled?: boolean | null; pixMode?: string | null; pixBank?: string | null; pixKeyType?: string | null; consultationFee?: string | null; chargesConsultation?: boolean | null }>,
  isInsuranceContact: boolean = false
): string {
  // Convênio nunca recebe instruções de PIX — pagamento é com o plano.
  if (isInsuranceContact) return "";
  const pixProfs = professionals.filter((p) => p.pixEnabled && p.pixKey);
  if (pixProfs.length === 0) return "";

  const lines: string[] = [];

  for (const prof of pixProfs) {
    const key = prof.pixKey!;
    const mode = prof.pixMode || "optional";
    const profLabel = professionals.length > 1 ? ` do(a) ${prof.name}` : "";
    const card = buildPixCardText({
      name: prof.name,
      pixKey: key,
      pixBank: prof.pixBank,
      pixKeyType: prof.pixKeyType,
      consultationFee: prof.consultationFee,
      chargesConsultation: prof.chargesConsultation,
    });

    if (mode === "required") {
      lines.push(`PIX OBRIGATORIO${profLabel} — PAGAMENTO ANTES DO ATENDIMENTO:
- FLUXO OBRIGATORIO: Logo apos o paciente escolher data e horario, EXPLIQUE com clareza: "O pagamento da consulta e feito antes do atendimento via PIX para garantir sua reserva." Em seguida, envie EXATAMENTE o cartao abaixo (preserve quebras de linha, emojis, asteriscos e simbolos. Nao reformule, nao resuma, nao traduza):

${card}

- Apos enviar o cartao, SOLICITE o comprovante: "Assim que voce fizer o pagamento, me envie o comprovante por aqui que eu confirmo seu agendamento na hora."
- AGUARDE o comprovante antes de confirmar definitivamente o agendamento.
- Enquanto nao receber o comprovante, o agendamento fica como "Pagamento Pendente". NUNCA emita marcador [APT_CARD: ...] de confirmacao sem o comprovante recebido.
- Se o paciente demorar, lembre uma vez de forma gentil: "Esta tudo certo com o pagamento? Qualquer duvida me chama."`);
    } else {
      lines.push(`PIX OPCIONAL${profLabel} — INFORMA QUANDO SOLICITADO:
- Informe os dados do PIX APENAS se o paciente perguntar sobre formas de pagamento, parcelamento, ou quiser pagar antecipadamente. NAO mencione proativamente.
- Quando informar, envie EXATAMENTE o cartao abaixo (preserve quebras de linha, emojis, asteriscos e simbolos. Nao reformule, nao resuma, nao traduza):

${card}

- Apos enviar o cartao, SOLICITE o comprovante: "Quando fizer o pagamento, me envie o comprovante por aqui que eu registro no seu cadastro." NAO bloqueie o agendamento aguardando comprovante — o pagamento por PIX neste modo e opcional/antecipado e o paciente pode tambem pagar na clinica.`);
    }
  }

  if (lines.length === 0) return "";

  return `\nPIX — INSTRUCOES:
${lines.join("\n\n")}`;
}

/**
 * Computes the early insurance attendance mode section that is placed near
 * the top of the system prompt (before clinic data) so GPT-4o processes the
 * insurance/particular triage rule within the first ~500 tokens.
 *
 * Guard: patients are excluded — they have their own patientSection with
 * "no SPIN Selling, familiar tone" rules and must NOT receive the insurance
 * triage flow ("plano ou particular?").
 */
export function computeEarlyInsuranceModeSection(
  acceptsInsurance: boolean,
  isPatient: boolean,
  contactDeclaredInsurance: boolean,
  insuranceTriageComplete: boolean,
  insuranceBifurcationBlock: string,
): string {
  if (!acceptsInsurance || isPatient) return "";
  if (contactDeclaredInsurance) {
    // Linguagem neutra deliberada: o prompt do MODO CONVENIO NUNCA pode mencionar
    // termos de venda (SPIN, escassez, urgencia, ancoragem, "consegui um encaixe",
    // "agenda disputada") nem mesmo como proibicao — qualquer aparicao desses
    // termos pode ser absorvida pelo modelo. Use apenas instrucoes positivas
    // descrevendo o tom desejado.
    return `MODO CONVENIO ATIVO: Este contato usa plano/convenio. Tom acolhedor, calmo e direto. Acolha a pessoa com empatia, entenda a queixa com perguntas simples (uma de cada vez) e conduza diretamente ao agendamento. Nao mencione preco de procedimento. Nao use tecnicas de venda nem pressao comercial. IMPORTANTE: Ofereca APENAS os horarios listados na AGENDA DISPONIVEL. Se o contato pedir um dia que nao estiver na AGENDA, explique gentilmente que o atendimento por convenio e realizado nos dias listados e ofereça a data disponivel mais proxima.`;
  }
  if (insuranceTriageComplete) {
    return `FLUXO PARTICULAR ATIVO: O contato informou que e particular. Siga o fluxo SPIN Selling normal com escassez na oferta de horarios (1 manha + 1 tarde).`;
  }
  return insuranceBifurcationBlock;
}

export function resolveAcceptsInsurance(
  clinicAcceptsInsurance: boolean,
  professionals: Array<{ acceptsInsurance?: boolean | null }>,
): boolean {
  if (!clinicAcceptsInsurance) return false;
  // Bug fix Task #11 — só conta como "aceita convênio" quando o profissional
  // tem `acceptsInsurance === true` explícito. null/undefined deixou de ser
  // tratado como aceita (antes: `!== false` cobria null como aceita, fazendo
  // a IA perguntar "plano ou particular" em clínica 100% particular).
  if (professionals.length === 1) return professionals[0].acceptsInsurance === true;
  if (professionals.length > 1) return professionals.some((p) => p.acceptsInsurance === true);
  return true;
}
