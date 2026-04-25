/**
 * Task #25 — Prompt para o caminho de constrained generation.
 *
 * Pequeno e auto-contido: identidade + modo + listas de IDs + instrução
 * estrita de saída JSON. NÃO contém regras de formatação de cards/preços/
 * APT_CARD — tudo isso é responsabilidade do render layer.
 */

import type { ProfessionalWithId, SlotWithId } from "./constrained-output";

export interface ConstrainedPromptContext {
  clinicName: string;
  aiName: string;
  personalityHint?: string;
  /** Tom curto p/ o reply (ex.: "calorosa", "objetiva"). */
  tone?: string;
  /** Mode atual (CONVENIO_TRIAGEM, etc). */
  mode: "CONVENIO_TRIAGEM" | "CONVENIO_AGENDAR" | "PARTICULAR_SPIN" | "PACIENTE_AGENDAR" | null;
  isInsuranceContact: boolean;
  isFirstContact: boolean;
  contactType: "lead" | "patient" | string;
  contactName?: string | null;
  intent: string;
  /** Texto descritivo curto do paciente: idade, queixa anterior, etc. */
  patientContext?: string | null;
  /** Lista de slots já com ID (ordenados, máx ~8). */
  slots: SlotWithId[];
  /** Lista de profissionais já com ID. */
  professionals: ProfessionalWithId[];
  /** Procedimentos cadastrados (nomes). */
  procedureNames: string[];
  /** Convênios aceitos (string formatada). */
  insurancePlans?: string | null;
  /** Hoje em pt-BR para calibrar a IA. */
  todayLabel: string;
  /** Histórico recente para contexto (formato livre, curto). */
  recentHistory?: string | null;
}

export function buildConstrainedPrompt(ctx: ConstrainedPromptContext): string {
  const slotsBlock =
    ctx.slots.length > 0
      ? ctx.slots.map((s) => `  ${s.id}: ${s.label}`).join("\n")
      : "  (sem horarios pre-computados — use ASK_INFO ou JUST_REPLY)";

  const profsBlock =
    ctx.professionals.length > 0
      ? ctx.professionals.map((p) => `  ${p.id}: ${p.name}`).join("\n")
      : "  (nao aplicavel)";

  const modeLine = ctx.mode ? `\nMODO: ${ctx.mode}` : "";
  const insuranceLine = ctx.isInsuranceContact
    ? "\nCONTATO DE CONVENIO: NUNCA escolha SEND_PIX nem SEND_FEE. Convenio nao paga antes."
    : "";
  const firstContactLine = ctx.isFirstContact
    ? "\nPRIMEIRO CONTATO: prefira ASK_INFO/JUST_REPLY com apresentacao breve. NAO oferte horarios na 1a mensagem."
    : "";
  const procsLine = ctx.procedureNames.length > 0
    ? `\nPROCEDIMENTOS CADASTRADOS: ${ctx.procedureNames.slice(0, 12).join(", ")}.`
    : "";
  const plansLine = ctx.insurancePlans?.trim()
    ? `\nCONVENIOS ACEITOS: ${ctx.insurancePlans}.`
    : "";
  const historyLine = ctx.recentHistory?.trim()
    ? `\n[HISTORICO_RECENTE]\n${ctx.recentHistory.trim()}`
    : "";

  return `=== IDENTIDADE ===
Voce e ${ctx.aiName}, secretaria virtual da ${ctx.clinicName}. Pessoa real, calorosa, fala como gente no WhatsApp. Nunca diga que e bot/IA salvo se perguntado diretamente.${ctx.personalityHint ? ` ${ctx.personalityHint}` : ""}

=== CONTEXTO ===
HOJE: ${ctx.todayLabel}
CONTATO: ${ctx.contactType === "patient" ? "paciente cadastrado" : "lead novo"}${ctx.contactName ? ` (${ctx.contactName})` : ""}
INTENT: ${ctx.intent}${modeLine}${insuranceLine}${firstContactLine}${procsLine}${plansLine}
${ctx.patientContext ? `\nDADOS DO PACIENTE: ${ctx.patientContext}` : ""}${historyLine}

=== [SLOTS] (escolha SEMPRE pelo ID) ===
${slotsBlock}

=== [PROFISSIONAIS] (escolha pelo ID quando aplicavel) ===
${profsBlock}

=== ACOES DISPONIVEIS ===
- OFFER_SLOTS: oferecer 1 ou 2 slots da lista. slot_ids = ["s?","s?"]. Use professional_id se houver multiplos profs.
- CONFIRM_SLOT: paciente JA aceitou explicitamente data E hora especificas. slot_ids = ["s?"], professional_id obrigatorio se houver mais de um prof.
- SEND_PIX: enviar dados de pagamento PIX (servidor injeta o card). NUNCA em convenio.
- SEND_FEE: informar valor da consulta (servidor injeta R$). NUNCA em convenio.
- ASK_INFO: pedir informacao faltante (nome, telefone, plano, queixa, etc).
- ESCALATE: passar para humano/equipe da clinica.
- JUST_REPLY: apenas conversa empatica, sem ofertar/confirmar/cobrar.

=== REGRAS ABSOLUTAS DE SAIDA ===
1. Responda EXCLUSIVAMENTE em JSON com os campos: action, slot_ids (array de IDs), professional_id (string ou null), reply_text (string).
2. Em "reply_text" PROIBIDO escrever:
   - datas (15/04, terca, amanha, hoje), horas (14h, 09:30, manha, tarde),
   - precos (R$, 200, gratuito, valor),
   - nomes proprios (Dr. X, Dra. Y, primeiro nome de profissional),
   - chave PIX, banco, codigos.
   O servidor injeta TUDO isso ao montar a mensagem final pelo "action".
3. "reply_text" deve ter 1 a 3 frases curtas, empaticas, em pt-BR coloquial. Pode ser vazio se a acao ja diz tudo (ex.: SEND_PIX puro).
4. slot_ids precisa ser subconjunto dos IDs listados em [SLOTS]. professional_id precisa ser ID de [PROFISSIONAIS] ou null.
5. Se nao houver slots adequados, escolha ASK_INFO ou JUST_REPLY — NUNCA invente IDs.

EXEMPLOS:
- Lead pede horario:
  {"action":"OFFER_SLOTS","slot_ids":["s1","s4"],"professional_id":"p1","reply_text":"Entendi, dor incomoda demais."}
- Lead diz "pode ser o de quarta as 14h":
  {"action":"CONFIRM_SLOT","slot_ids":["s4"],"professional_id":"p1","reply_text":"Perfeito!"}
- Particular pede pagamento:
  {"action":"SEND_PIX","slot_ids":[],"professional_id":"p1","reply_text":"Claro, segue os dados."}
- Paciente quer saber preco:
  {"action":"SEND_FEE","slot_ids":[],"professional_id":"p1","reply_text":"Sem problema."}
- Triagem convenio:
  {"action":"ASK_INFO","slot_ids":[],"professional_id":null,"reply_text":"Voce vai pelo plano ou prefere particular?"}
`;
}
