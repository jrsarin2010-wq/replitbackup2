/**
 * conversation-policy.ts — Regras de ritmo da conversa com leads particulares.
 *
 * FONTE ÚNICA DE VERDADE para decisões de:
 *   - Qual fase SPIN está ativa (por temperatura do lead)
 *   - Se pode ou não oferecer horário agora
 *   - Quantas mensagens mínimas antes de empurrar agendamento
 *
 * PRINCÍPIO: Conexão antes de conversão.
 * A IA deve OUVIR, ENTENDER e CRIAR VÍNCULO antes de apresentar horários.
 * Oferecer horário cedo demais soa robótico e derruba a taxa de conversão.
 *
 * FLUXO ESPERADO:
 *   1. Lead frio   → S (Situação): perguntas abertas, só ouvir.
 *   2. Lead morno  → P/I (Problema/Implicação): aprofundar o problema,
 *                    mostrar consequência — NÃO oferecer horário ainda.
 *   3. Lead quente → N (Necessidade): apresentar solução + horário.
 *
 * GATE DE HORÁRIO: nunca oferecer na mesma mensagem que a primeira pergunta
 * de situação. Mínimo 1 troca após entender o problema.
 */

export type LeadTemperature = "cold" | "warm" | "hot";

export interface SpinPhaseResult {
  phase: "S" | "PI" | "N";
  label: string;
  /** Instrução completa para o prompt da IA */
  instruction: string;
  /** Se é permitido oferecer horário nesta fase */
  canOfferSchedule: boolean;
}

/**
 * Resolve a fase SPIN e a instrução correspondente para o prompt.
 *
 * REGRA CENTRAL:
 *  - cold → fase S: ouvir, NÃO vender, NÃO oferecer horário
 *  - warm → fase P/I: aprofundar problema, NÃO oferecer horário ainda
 *                      (a IA precisa ouvir o problema ANTES de converter)
 *  - hot  → fase N: apresentar solução e conduzir ao agendamento
 */
export function resolveSpinPhase(temperature: LeadTemperature): SpinPhaseResult {
  switch (temperature) {
    case "cold":
      return {
        phase: "S",
        label: "SITUACAO",
        instruction: [
          "S — SITUACAO: Faca perguntas abertas para entender o contexto.",
          "NAO venda, NAO oferte horarios, NAO mencione preco.",
          "Objetivo: fazer o lead se sentir ouvido e estabelecer vinculo.",
          "Exemplos: 'Ha quanto tempo esta com esse problema?', 'Ja tentou algum tratamento antes?'",
        ].join(" "),
        canOfferSchedule: false,
      };

    case "warm":
      return {
        phase: "PI",
        label: "PROBLEMA/IMPLICACAO",
        instruction: [
          "P/I — PROBLEMA/IMPLICACAO: Aprofunde o problema que o lead descreveu.",
          "OBRIGATORIO: faca ao menos UMA pergunta sobre o impacto do problema antes de oferecer horario.",
          "NAO oferte horario na mesma mensagem que explorar o problema.",
          "Somente avance para horario quando o lead verbalizar claramente o desejo de resolver.",
          "Exemplos de perguntas P: 'Isso te atrapalha no dia a dia?', 'Tem dificuldade para comer ou sorrir?'",
          "Exemplos de implicacao: 'Se deixar muito tempo, pode complicar e sair mais caro depois.'",
          "Gate: NAO oferecer horario enquanto o lead nao tiver respondido ao menos 1 pergunta sobre o problema.",
        ].join(" "),
        canOfferSchedule: false,
      };

    case "hot":
      return {
        phase: "N",
        label: "NECESSIDADE DE SOLUCAO",
        instruction: [
          "N — NECESSIDADE DE SOLUCAO: O lead esta pronto. Apresente a solucao, use escassez natural e conduza ao agendamento.",
          "Mencione o valor da consulta naturalmente junto com o horario.",
          "Crie urgencia honesta: 'A agenda ta disputada, melhor garantir logo.'",
        ].join(" "),
        canOfferSchedule: true,
      };
  }
}

/**
 * Decide se a IA pode oferecer horário neste momento da conversa.
 *
 * Múltiplas condições precisam ser satisfeitas:
 *  1. lead não está em "connection phase" (ainda se apresentando)
 *  2. lead não declarou insurance ainda (aguarda triagem)
 *  3. a fase SPIN permite oferecer (só "hot" permite por padrão)
 *  4. o número mínimo de trocas foi atingido
 */
export function shouldOfferSchedule(params: {
  temperature: LeadTemperature;
  inConnectionPhase: boolean;
  contactDeclaredInsurance: boolean;
  canOfferSchedule: boolean;
  messagesExchanged?: number;
}): boolean {
  const {
    temperature,
    inConnectionPhase,
    contactDeclaredInsurance,
    canOfferSchedule,
    messagesExchanged = 0,
  } = params;

  // Bloqueio absoluto: triagem ainda não concluída
  if (inConnectionPhase && !contactDeclaredInsurance) return false;

  // Bloqueio: calendário não disponível
  if (!canOfferSchedule) return false;

  // Bloqueio: fase SPIN não permite ainda
  const { canOfferSchedule: spinAllows } = resolveSpinPhase(temperature);
  if (!spinAllows) return false;

  // Gate extra: usa o mínimo de trocas definido por temperatura
  // Garante pelo menos 1 ida-e-volta de conversa antes de converter
  const minExchanges = minExchangesBeforeScheduleOffer(temperature);
  if (messagesExchanged < minExchanges) return false;

  return true;
}

/**
 * Número mínimo de mensagens trocadas antes de a IA poder oferecer horário.
 * Representa "ida-e-volta" (lead enviou + IA respondeu = 1 troca).
 *
 * cold  → 2 trocas (ouvir bem a situação)
 * warm  → 2 trocas (já tem contexto, mas explorou problema)
 * hot   → 1 troca  (lead sinalizou intenção clara, não atrasar)
 */
export function minExchangesBeforeScheduleOffer(temperature: LeadTemperature): number {
  switch (temperature) {
    case "cold": return 2;
    case "warm": return 2;
    case "hot":  return 1;
  }
}

/**
 * Retorna a instrução de ritmo a ser adicionada ao prompt.
 * Combina fase SPIN com gate de mensagens de forma legível para o LLM.
 */
export function buildSpinPacingInstruction(
  temperature: LeadTemperature,
  messagesExchanged: number,
): string {
  const phase = resolveSpinPhase(temperature);
  const minExchanges = minExchangesBeforeScheduleOffer(temperature);
  const trocasRestantes = Math.max(0, minExchanges - messagesExchanged);

  if (phase.canOfferSchedule && trocasRestantes === 0) {
    return phase.instruction;
  }

  if (trocasRestantes > 0) {
    return [
      phase.instruction,
      `RITMO: Ainda faltam ${trocasRestantes} troca(s) de mensagem antes de oferecer horario.`,
      `Foque em ouvir e criar conexao.`,
    ].join(" ");
  }

  return phase.instruction;
}
