/**
 * Filtro server-side de especialidade.
 *
 * Antes de montar o prompt para o LLM, detectamos no texto do paciente quais
 * especialidades odontológicas estão sendo solicitadas. Em seguida filtramos a
 * lista de profissionais para incluir apenas aqueles cuja ficha (specialty +
 * specialties) contém pelo menos uma das palavras-chave da especialidade. Isso
 * elimina a possibilidade do LLM oferecer profissional fora da especialidade
 * solicitada — o profissional simplesmente não aparece no prompt.
 *
 * Fallback seguro: se a mensagem não casa com nenhum grupo, ou se nenhum
 * profissional corresponde, devolvemos a lista original. Assim a IA continua
 * funcionando para pedidos genéricos (limpeza, dor leve, primeira consulta) e
 * pode dizer "não temos especialista" quando não há profissional adequado.
 */

export interface SpecialtyRoutableProfessional {
  specialty?: string | null;
  specialties?: string | null;
  name?: string;
}

interface SpecialtyNeedGroup {
  label: string;
  /** RegExp aplicado à mensagem do paciente (case-insensitive). */
  needPattern: RegExp;
  /** Substrings (já normalizadas — sem acento, lowercase) procuradas em specialty + specialties. */
  specialtyKeywords: string[];
}

/**
 * Mapeamento autoritário: necessidade do paciente → palavras-chave que precisam
 * estar na ficha do profissional. Cobre as 17 áreas que já estão documentadas
 * na regra de texto do prompt-builder. Mantenha sincronizado com aquele mapa.
 */
const SPECIALTY_NEED_GROUPS: SpecialtyNeedGroup[] = [
  {
    label: "ortodontia",
    needPattern: /\b(aparelho|dente\s+torto|dentes?\s+tortos?|alinha(?:r|mento)|mordida\s+cruzada|invisalign|aparelho\s+invis[ií]vel|aparelho\s+fixo|aparelho\s+m[oó]vel|conten[cç][aã]o)\b/i,
    specialtyKeywords: ["ortodont"],
  },
  {
    label: "odontopediatria",
    needPattern: /\b(crian[cç]a|crian[cç]as|filho|filha|filhinho|filhinha|beb[eê]|criancinha|pedi[aá]trico)\b/i,
    specialtyKeywords: ["odontopediat", "infantil", "pediatr"],
  },
  {
    label: "implantodontia",
    needPattern: /\b(implante[s]?|dente\s+caiu|dente\s+perdido|dente\s+faltando|falta\s+dente|sem\s+dente|colocar\s+dente|parafuso\s+no\s+osso|perdi\s+(?:\w+\s+)?dente|dente\s+(?:foi\s+|que\s+)?arrancad[ao]|arrancad[ao]\s+(?:\w+\s+)?dente|caiu\s+(?:\w+\s+)?dente|dente\s+que\s+caiu|arrancaram\s+(?:\w+\s+)?dente)\b/i,
    specialtyKeywords: ["implant"],
  },
  {
    label: "protese",
    needPattern: /\b(pr[oó]tese|dentadura|chapa(?:\s+nova)?|ponte\s+fixa|ponte\s+m[oó]vel|coroa(?:\s+de\s+porcelana)?|protocolo|pr[oó]tese\s+sobre\s+implante)\b/i,
    specialtyKeywords: ["protese", "protetic", "implant"],
  },
  {
    label: "endodontia",
    needPattern: /\b(canal|tratamento\s+de\s+canal|dor\s+profunda|dor\s+latejante|nervo\s+do\s+dente|desvitaliza|endodontia)\b/i,
    specialtyKeywords: ["endodont"],
  },
  {
    label: "periodontia",
    needPattern: /\b(gengiva|sangramento\s+gengival|gengiva\s+inchada|mau\s+h[aá]lito|piorreia|retra[cç][aã]o\s+gengival|periodontite|gengivite|raspagem)\b/i,
    specialtyKeywords: ["periodont"],
  },
  {
    label: "dentistica",
    needPattern: /\b(c[aá]rie|restaura[cç][aã]o|obtura[cç][aã]o|dente\s+quebrado|dente\s+lascado|cavidade|massinha\s+branca)\b/i,
    specialtyKeywords: ["dentistic", "restaurad", "clinico", "clinica geral", "clinica-geral"],
  },
  {
    label: "cirurgia bucal",
    needPattern: /\b(siso|dente\s+do\s+siso|dente\s+do\s+ju[ií]zo|extra[cç][aã]o|arrancar\s+dente|cisto\s+na\s+boca|fratura\s+de\s+mand[ií]bula|trauma\s+facial)\b/i,
    specialtyKeywords: ["cirurg", "buco", "maxilofacial", "exodont"],
  },
  {
    label: "estetica dental",
    needPattern: /\b(clarear|clareamento|dente\s+amarelo|branqueamento|sorriso\s+branco|manchas?\s+nos?\s+dentes?)\b/i,
    specialtyKeywords: ["estetic", "cosmetic", "clareament"],
  },
  {
    label: "lente / faceta",
    needPattern: /\b(lente\s+de\s+contato|lente\s+dental|facetas?(?:\s+de\s+(?:porcelana|resina))?|harmonizar\s+sorriso)\b/i,
    specialtyKeywords: ["lente", "faceta", "estetic", "protese"],
  },
  {
    label: "harmonizacao orofacial",
    needPattern: /\b(harmoniza[cç][aã]o|botox|preenchimento\s+(?:labial|facial)|toxina\s+botul[ií]nica|bichectomia|bigode\s+chin[eê]s|olheiras)\b/i,
    specialtyKeywords: ["harmoniza", "estetic"],
  },
  {
    label: "DTM / oclusao",
    needPattern: /\b(bruxismo|range\s+os?\s+dentes?|placa\s+miorrelaxante|\bdtm\b|\batm\b|dor\s+na\s+mand[ií]bula|estala\s+a\s+mand[ií]bula|dor\s+de\s+cabe[cç]a\s+tensional)\b/i,
    specialtyKeywords: ["oclus", "dtm", "bruxismo", "disfun", "protese"],
  },
  {
    label: "odontologia do sono",
    needPattern: /\b(ronco|apneia|aparelho\s+para\s+ronco|dispositivo\s+intraoral)\b/i,
    specialtyKeywords: ["sono", "ronco", "dtm"],
  },
  {
    label: "odontogeriatria",
    needPattern: /\b(idoso|idosa|paciente\s+idoso|vov[oó]|vov[oó]zinha|dentadura\s+velha)\b/i,
    specialtyKeywords: ["geriat", "idoso", "protese"],
  },
  {
    label: "estomatologia",
    needPattern: /\b(afta\s+persistente|les[aã]o\s+na\s+boca|mancha\s+branca\s+na\s+l[ií]ngua|n[oó]dulo|caro[cç]o\s+na\s+gengiva|biopsia)\b/i,
    specialtyKeywords: ["estomat", "patolog", "cirurg"],
  },
  {
    label: "radiologia",
    needPattern: /\b(raio[-\s]?x|radiografia|panor[aâ]mica|tomografia\s+odontol[oó]gica)\b/i,
    specialtyKeywords: ["radiolog", "imagem"],
  },
  {
    label: "odontologia esportiva",
    needPattern: /\b(protetor\s+bucal|mouthguard|esporte\s+de\s+contato)\b/i,
    specialtyKeywords: ["esportiv", "protese"],
  },
  {
    label: "pacientes especiais",
    needPattern: /\b(autista|s[ií]ndrome\s+de\s+down|paciente\s+especial|defici[eê]ncia)\b/i,
    specialtyKeywords: ["especial", "pcd", "hospital"],
  },
  {
    label: "gestantes",
    needPattern: /\b(gestante|gravida|gr[aá]vida|gravidez|gesta[cç][aã]o|pre[\s-]?natal|pr[eé][\s-]?natal\s+odontol[oó]gico|estou\s+gr[aá]vida|estou\s+esperando\s+beb[eê]|amamentando|lactante)\b/i,
    specialtyKeywords: ["gestante", "gravid", "gesta", "pre-natal", "prenatal", "materno"],
  },
];

/** Remove acentos e baixa caixa para comparações de substring. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export interface DetectedSpecialtyNeed {
  /** Rótulos das áreas que casaram (auditoria). */
  labels: string[];
  /** Conjunto de substrings que devem aparecer em specialty/specialties. */
  keywords: string[];
}

export function detectNeededSpecialty(currentMessage: string): DetectedSpecialtyNeed {
  if (!currentMessage) return { labels: [], keywords: [] };
  const labels: string[] = [];
  const keywordSet = new Set<string>();
  for (const group of SPECIALTY_NEED_GROUPS) {
    if (group.needPattern.test(currentMessage)) {
      labels.push(group.label);
      for (const kw of group.specialtyKeywords) keywordSet.add(kw);
    }
  }
  return { labels, keywords: Array.from(keywordSet) };
}

export interface SpecialtyFilterResult<P extends SpecialtyRoutableProfessional> {
  /** Lista efetivamente passada ao prompt. */
  professionals: P[];
  /** True se o filtro encolheu a lista (para auditoria/log). */
  filtered: boolean;
  /** True se a busca casou keywords mas nenhum profissional bateu (fallback). */
  noMatchFallback: boolean;
  detected: DetectedSpecialtyNeed;
}

export function filterProfessionalsByDetectedSpecialty<P extends SpecialtyRoutableProfessional>(
  professionals: P[],
  detected: DetectedSpecialtyNeed,
): SpecialtyFilterResult<P> {
  if (!professionals.length || !detected.keywords.length) {
    return { professionals, filtered: false, noMatchFallback: false, detected };
  }
  const matched = professionals.filter((p) => {
    const haystack = normalize(`${p.specialty || ""} ${p.specialties || ""}`);
    if (!haystack.trim()) return false;
    return detected.keywords.some((kw) => haystack.includes(normalize(kw)));
  });
  if (matched.length === 0) {
    // Fallback: nenhum profissional com a especialidade pedida — devolve a
    // lista original para que a IA possa dizer "não temos especialista" usando
    // as regras já existentes no prompt.
    return { professionals, filtered: false, noMatchFallback: true, detected };
  }
  if (matched.length === professionals.length) {
    return { professionals, filtered: false, noMatchFallback: false, detected };
  }
  return { professionals: matched, filtered: true, noMatchFallback: false, detected };
}

/** Atalho: detecta e filtra em uma chamada. */
export function applySpecialtyRouting<P extends SpecialtyRoutableProfessional>(
  currentMessage: string,
  professionals: P[],
): SpecialtyFilterResult<P> {
  const detected = detectNeededSpecialty(currentMessage);
  return filterProfessionalsByDetectedSpecialty(professionals, detected);
}
