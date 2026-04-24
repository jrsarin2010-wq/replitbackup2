import type { Intent } from "./schedule-engine";

export type { Intent };

/**
 * Normalizes a message before intent matching:
 * strips diacritics (NFD + remove combining chars), lowercases, trims.
 * This lets every regex pattern stay accent-free — no need for [eê], [aã], etc.
 */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

const INTENT_PATTERNS: Array<[Intent, RegExp]> = [
  [
    "scheduling",
    /\b(quero\s*(marcar|agendar|reservar)|quero\s*ir\s*(hoje|amanha|essa\s*semana|ao\s*dentista)|posso\s*ir\s*(hoje|amanha|essa\s*semana)|vamos\s*(marcar|agendar|reservar)|pode\s*(marcar|agendar|reservar)|(marca|agenda|reserva)\s*(pra|para)\s*mim|preciso\s*(marcar|agendar|reservar|de\s*atendimento)|gostaria\s*de\s*(marcar|agendar|reservar|fazer)|tem\s*(horario|vaga|encaixe|espaco\s*na\s*agenda)|tem\s*como\s*(marcar|agendar)|posso\s*(marcar|agendar)|(marcar|agendar|reservar|fazer)\s*(uma\s*)?(consulta|avaliacao|retorno)|(marcar|fazer)\s*hora|horario\s*(disponivel|livre|vago)|disponibilidade|vaga\s*na\s*agenda|espaco\s*na\s*agenda|preciso\s*de\s*uma\s*(consulta|avaliacao)|quero\s*(um\s*encaixe|uma?\s*(consulta|avaliacao|retorno|hora))|agendar|encaixe)\b/i,
  ],
  [
    "cancellation",
    /\b(cancelar|desmarcar|nao\s*vou\s*(poder|conseguir|comparecer|ir|mais)|nao\s*posso\s*(mais|ir|comparecer|nesse\s*dia)|cancela|cancelamento|desistir\s*da\s*(consulta|sessao)|nao\s*consigo\s*(mais\s*)?(ir|comparecer)|nao\s*da\s*pra\s*(ir|comparecer)|nao\s*vou\s*mais|preciso\s*cancelar|remarca\s*(pra\s*)?cancelar)\b/i,
  ],
  [
    "rescheduling",
    /\b(remarcar|reagendar|mudar\s*(o\s*)?horario|trocar\s*(o\s*)?dia|outro\s*horario|outra\s*data|adiar|outro\s*dia|mudar\s*a\s*data|alterar\s*o\s*horario|nao\s*posso\s*nesse\s*horario|esse\s*horario\s*nao|nao\s*da\s*(nesse\s*)?dia|consegue\s*outro\s*(horario|dia)|encaixar\s*(em\s*)?outro\s*(dia|horario))\b/i,
  ],
  [
    "price_inquiry",
    /\b(quanto\s*(custa|fica|e|seria|vai|cobram)|preco|valor|tabela\s*de\s*preco|orcamento|parcel(a(mento)?|am)|financiamento|quanto\s*vao\s*cobrar|me\s*passa\s*o\s*valor|qual\s*o\s*(preco|valor|custo)|tem\s*(previsao\s*de\s*valor|desconto)|aceita\s*parcelar|voces\s*parcelam|em\s*quantas\s*vezes|forma\s*de\s*pagamento|pix|boleto|cartao|quanto\s*fica\s*o)\b/i,
  ],
  [
    "objection",
    /\b(muito\s*caro|e\s*caro|ta\s*caro|nao\s*tenho\s*(dinheiro|grana|condicao(\s*agora)?)|sem\s*grana|apertado\s*financeiramente|nao\s*sei\s*(se\s*quero|se\s*posso|ainda)|vou\s*pensar|deixa\s*eu\s*pensar|depois\s*eu\s*(ligo|marco|vejo)|agora\s*nao|sem\s*tempo|nao\s*tenho\s*tempo|tenho\s*medo|to\s*com\s*medo|receio|medo\s*de\s*(dentista|dor|agulha|extrair|arrancar)|doi\s*muito|vai\s*doer|e\s*doloroso|trauma|nervoso|ansios[ao]|ansiedade|fobia|fico\s*nervoso|to\s*nervos[ao])\b/i,
  ],
  [
    "question",
    /\b(qual|como\s*(e|funciona|sao|fica)|onde\s*(fica|e|voces)|quando\s*(voces\s*)?(abrem|fecham|atendem)|que\s*horas|aceita\s*convenio|quais\s*convenios|voces\s*aceitam|o\s*que\s*e|diferenca\s*entre|como\s*funciona|quanto\s*tempo\s*(dura|leva)|e\s*doloroso|precisa\s*de\s*anestesia|quantas\s*sessoes|tem\s*estacionamento|como\s*chego|quais\s*sao\s*os)\b/i,
  ],
  [
    "greeting",
    /^(oi|ola|oie|oii+|ola\s*tudo\s*bem|oi\s*tudo\s*bem|bom\s*dia|boa\s*(tarde|noite|manha)|opa|hey|e+a+i+|iae|oi[!.,\s]*boa\s*(tarde|noite|manha)|tudo\s*(bem|bom|certo)|como\s*vai|e\s*ai\s*gente)[!.,\s]*$/i,
  ],
];

export async function detectIntent(message: string): Promise<Intent> {
  const normalized = normalize(message);

  for (const [intent, pattern] of INTENT_PATTERNS) {
    if (pattern.test(normalized)) {
      return intent;
    }
  }

  return "other";
}

export function classifyLeadTemperature(intent: Intent, currentTemp: string, messageCount: number): string {
  const heatMap: Record<Intent, number> = {
    scheduling: 3,
    rescheduling: 2,
    price_inquiry: 2,
    question: 1,
    greeting: 0,
    objection: -1,
    cancellation: -2,
    other: 0,
  };

  const heat = heatMap[intent] || 0;
  const currentHeat = currentTemp === "hot" ? 3 : currentTemp === "warm" ? 2 : 1;
  const newHeat = currentHeat + heat;
  const engagementBonus = messageCount > 4 ? 1 : 0;
  const finalHeat = newHeat + engagementBonus;

  if (finalHeat >= 4) return "hot";
  if (finalHeat >= 2) return "warm";
  return "cold";
}
