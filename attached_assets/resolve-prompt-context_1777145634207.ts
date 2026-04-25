/**
 * resolve-prompt-context.ts
 *
 * Arquivo: artifacts/api-server/src/lib/resolve-prompt-context.ts
 *
 * PROPÓSITO:
 * O servidor resolve TUDO antes de montar qualquer texto de prompt.
 * O buildSplitPrompt() consome este contexto e gera apenas fatos simples,
 * sem condicionais, sem "se X então Y senão Z".
 *
 * REGRA DE OURO:
 * Nenhuma lógica de negócio dentro do prompt. Zero condicionais no texto
 * enviado à IA. Apenas fatos já resolvidos pelo servidor.
 */

import type { ConversationMode } from "./mode-resolver";
import { resolveChargesConsultation, resolveConsultationFee } from "./prompt-helpers";

// ─── Tipos de entrada ─────────────────────────────────────────────────────────

export interface ProfessionalData {
  id: number;
  name: string;
  specialty?: string | null;
  specialties?: string | null;
  cro?: string | null;
  workingDays?: string | null;
  workingHoursStart?: string | null;
  workingHoursEnd?: string | null;
  acceptsInsurance?: boolean | null;
  insurancePlans?: string | null;
  insuranceDays?: string | null;
  consultationFee?: string | null;
  chargesConsultation?: boolean | null;
  defaultLeadDurationMinutes?: number | null;
  defaultPatientDurationMinutes?: number | null;
  pixEnabled?: boolean | null;
  pixMode?: string | null;
  pixKey?: string | null;
  pixKeyType?: string | null;
  pixBank?: string | null;
  instagramUrl?: string | null;
}

export interface SettingsData {
  clinicName?: string | null;
  aiName?: string | null;
  acceptsInsurance?: boolean | null;
  insuranceDays?: string | null;
  insurancePlans?: string | null;
  consultationFee?: string | null;
  chargesConsultation?: boolean | null;
  pixEnabled?: boolean | null;
  pixMode?: string | null;
  pixKey?: string | null;
  pixBank?: string | null;
}

export interface ResolvePromptContextInput {
  conversationMode: ConversationMode;
  professionals: ProfessionalData[];          // todos os profissionais ativos
  routedProfessional: ProfessionalData | null; // profissional já roteado pelo servidor (ou null)
  settings: SettingsData;
  isInsuranceContact: boolean;                 // já decidido pelo mode-resolver
  isPrivateContact: boolean;
  isPatient: boolean;
  clinicAcceptsInsurance: boolean;
  allInsurancePlansList?: string | null;       // lista global de planos aceitos
}

// ─── Tipo de saída ────────────────────────────────────────────────────────────

export interface ResolvedPromptContext {
  // ── Modo ──────────────────────────────────────────────────────────────────
  /** Texto do modo já formatado para o prompt — sem condicionais */
  modoTexto: string;
  /** Instrução de abordagem já pronta (SPIN ou empatia ou familiar) */
  instrucaoAbordagem: string;

  // ── Profissional ──────────────────────────────────────────────────────────
  /** Profissional selecionado para esta conversa (ou null = multi-prof) */
  profissional: ProfessionalData | null;
  /** Linha de texto pronta para o prompt */
  profissionalLinha: string;

  // ── Consulta e pagamento ──────────────────────────────────────────────────
  /** true = cobra consulta; false = gratuita */
  cobrarConsulta: boolean;
  /** Valor formatado ex: "R$150" ou null se gratuita */
  valorConsulta: string | null;
  /** true = PIX obrigatório antes da consulta */
  exigirPix: boolean;
  /** true = PIX aceito mas opcional */
  pixOpcional: boolean;
  /** Chave PIX ou null */
  chavePix: string | null;
  /** Banco do PIX ou null */
  bancoPix: string | null;
  /** Tipo da chave (email, cpf, telefone, aleatoria) */
  tipoPix: string | null;
  /** Bloco de texto pronto para o prompt sobre pagamento */
  pagamentoTexto: string;

  // ── Agenda ────────────────────────────────────────────────────────────────
  /** Dias formatados para este modo (convênio = insuranceDays, particular = workingDays) */
  diasDisponiveis: string;
  /** Horário de início */
  horarioInicio: string;
  /** Horário de fim */
  horarioFim: string;
  /** Linha de agenda pronta para o prompt */
  agendaTexto: string;

  // ── Convênio ─────────────────────────────────────────────────────────────
  /** Flag definitiva — true somente se este profissional aceita E modo é convênio */
  ehConvenio: boolean;
  /** Planos aceitos por este profissional (ou null) */
  planosAceitos: string | null;
  /** Bloco convênio pronto para o prompt */
  convenioTexto: string;

  // ── Duração ───────────────────────────────────────────────────────────────
  duracaoLead: number;
  duracaoPaciente: number;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const DAY_NAMES: Record<string, string> = {
  "0": "Domingo",
  "1": "Segunda-feira",
  "2": "Terça-feira",
  "3": "Quarta-feira",
  "4": "Quinta-feira",
  "5": "Sexta-feira",
  "6": "Sábado",
};

function formatDays(daysStr: string | null | undefined): string {
  if (!daysStr) return "";
  return daysStr
    .split(",")
    .map((d) => DAY_NAMES[d.trim()] || d.trim())
    .join(", ");
}

// ─── Função principal ─────────────────────────────────────────────────────────

export function resolvePromptContext(input: ResolvePromptContextInput): ResolvedPromptContext {
  const {
    conversationMode,
    professionals,
    routedProfessional,
    settings,
    isInsuranceContact,
    isPatient,
    clinicAcceptsInsurance,
    allInsurancePlansList,
  } = input;

  // ── 1. Profissional da conversa ────────────────────────────────────────────
  // Prioridade: roteado pelo servidor > único ativo > null (multi-prof)
  const prof: ProfessionalData | null =
    routedProfessional ??
    (professionals.length === 1 ? professionals[0] : null);

  // ── 2. Modo e instrução de abordagem ──────────────────────────────────────
  let modoTexto: string;
  let instrucaoAbordagem: string;

  switch (conversationMode) {
    case "PARTICULAR_SPIN":
      modoTexto = "LEAD PARTICULAR — contato pagará consulta de forma particular.";
      instrucaoAbordagem = [
        "ABORDAGEM PARA LEAD PARTICULAR:",
        "- Aplique SPIN Selling: faça perguntas sobre a situação e dor do lead antes de oferecer horários.",
        "- Construa conexão antes de qualquer oferta direta.",
        "- Use técnicas de escassez e urgência com naturalidade.",
        "- Nunca vá direto para horários sem entender a necessidade do lead.",
        "- Nunca pergunte convênio, plano, CPF, RG ou carteirinha.",
      ].join("\n");
      break;

    case "CONVENIO_AGENDAR":
      modoTexto = "CONTATO DE CONVÊNIO/PLANO — contato usa plano odontológico.";
      instrucaoAbordagem = [
        "ABORDAGEM PARA CONVÊNIO:",
        "- Comece com empatia e acolhimento, sem técnicas de venda.",
        "- Não use SPIN Selling, escassez ou urgência.",
        "- Não mencione valores de consulta (cobertura pelo plano).",
        "- Não envie chave PIX (convênio não paga consulta antecipada).",
        "- Verifique se o plano do contato está na lista de planos aceitos.",
        "- Se o plano não for aceito, informe com empatia e ofereça particular.",
        "- Nunca pergunte CPF, RG ou carteirinha para verificar elegibilidade.",
      ].join("\n");
      break;

    case "CONVENIO_TRIAGEM":
      modoTexto = "TRIAGEM PENDENTE — clínica aceita convênio, aguardando declaração do contato.";
      instrucaoAbordagem = [
        "ABORDAGEM PARA TRIAGEM:",
        "- Pergunte se o contato vai usar convênio/plano ou pagar particular.",
        `- Liste os planos aceitos: ${allInsurancePlansList || "consultar clínica"}.`,
        "- Aguarde a resposta antes de avançar.",
        "- Nunca pergunte CPF, RG ou carteirinha.",
      ].join("\n");
      break;

    case "PACIENTE_AGENDAR":
      modoTexto = "PACIENTE RECORRENTE DA CLÍNICA — já é paciente conhecido.";
      instrucaoAbordagem = [
        "ABORDAGEM PARA PACIENTE RECORRENTE:",
        "- Use tom familiar e próximo — ele já conhece a clínica.",
        "- Não faça triagem de convênio/particular (já é cadastrado).",
        "- Não aplique SPIN Selling.",
        "- Não pergunte CPF, RG ou carteirinha.",
        "- Vá direto para o agendamento ou remarcação.",
      ].join("\n");
      break;
  }

  // ── 3. Cobrar consulta e valor ─────────────────────────────────────────────
  // Convênio nunca paga consulta — regra absoluta
  const cobrarConsulta = isInsuranceContact
    ? false
    : resolveChargesConsultation(prof, settings);

  const feeRaw = cobrarConsulta
    ? resolveConsultationFee(prof, settings)
    : null;

  const valorConsulta = feeRaw ? `R$${feeRaw}` : null;

  // ── 4. PIX ────────────────────────────────────────────────────────────────
  // Convênio nunca recebe PIX — regra absoluta
  const pixEnabledForProf = !isInsuranceContact && (prof?.pixEnabled === true);
  const pixMode = prof?.pixMode ?? "optional";
  const exigirPix = pixEnabledForProf && pixMode === "required" && cobrarConsulta;
  const pixOpcional = pixEnabledForProf && pixMode === "optional" && cobrarConsulta;
  const chavePix = pixEnabledForProf ? (prof?.pixKey ?? null) : null;
  const bancoPix = pixEnabledForProf ? (prof?.pixBank ?? null) : null;
  const tipoPix = pixEnabledForProf ? (prof?.pixKeyType ?? null) : null;

  // Bloco de pagamento — texto limpo e direto
  let pagamentoTexto = "";
  if (isInsuranceContact) {
    pagamentoTexto = "PAGAMENTO: Atendimento por convênio — sem cobrança de consulta, sem PIX.";
  } else if (!cobrarConsulta) {
    pagamentoTexto = "PAGAMENTO: Consulta de avaliação GRATUITA — sem cobrança, sem PIX.";
  } else if (exigirPix && chavePix) {
    const tipoLabel = tipoPix === "email" ? "e-mail" : tipoPix === "phone" ? "telefone" : tipoPix === "cpf" ? "CPF" : "chave";
    pagamentoTexto = [
      `PAGAMENTO: Consulta ${valorConsulta} — pagamento via PIX OBRIGATÓRIO antes da consulta.`,
      `Chave PIX (${tipoLabel}): ${chavePix}${bancoPix ? ` — ${bancoPix}` : ""}.`,
      "Ao confirmar o agendamento, envie a chave PIX acima e peça o comprovante.",
      "NUNCA confirme o agendamento como definitivo sem receber o comprovante.",
    ].join("\n");
  } else if (pixOpcional && chavePix) {
    const tipoLabel = tipoPix === "email" ? "e-mail" : tipoPix === "phone" ? "telefone" : tipoPix === "cpf" ? "CPF" : "chave";
    pagamentoTexto = [
      `PAGAMENTO: Consulta ${valorConsulta} — pagamento presencial ou via PIX (opcional).`,
      `Chave PIX disponível (${tipoLabel}): ${chavePix}${bancoPix ? ` — ${bancoPix}` : ""}.`,
      "Confirme o agendamento imediatamente — PIX não é obrigatório.",
    ].join("\n");
  } else {
    pagamentoTexto = `PAGAMENTO: Consulta ${valorConsulta ?? "a combinar"} — pagamento presencial.`;
  }

  // ── 5. Agenda ─────────────────────────────────────────────────────────────
  // Para convênio: usar insuranceDays do profissional.
  // Para particular/paciente: usar workingDays do profissional.
  // Nunca misturar os dois no mesmo bloco.
  let diasFonte: string | null | undefined;

  if (isInsuranceContact && prof?.acceptsInsurance && prof?.insuranceDays) {
    diasFonte = prof.insuranceDays;
  } else if (prof?.workingDays) {
    diasFonte = prof.workingDays;
  } else if (settings?.insuranceDays && isInsuranceContact) {
    diasFonte = settings.insuranceDays;
  }

  const diasDisponiveis = formatDays(diasFonte) || "Consultar clínica";
  const horarioInicio = prof?.workingHoursStart ?? "08:00";
  const horarioFim = prof?.workingHoursEnd ?? "18:00";

  let agendaTexto: string;
  if (isInsuranceContact) {
    agendaTexto = [
      `AGENDA CONVÊNIO: Atendimento por plano SOMENTE em: ${diasDisponiveis}.`,
      `Horário: ${horarioInicio} às ${horarioFim}.`,
      `PROIBIDO oferecer ou confirmar horário em qualquer outro dia para convênio.`,
    ].join("\n");
  } else {
    agendaTexto = [
      `AGENDA: Dias de atendimento: ${diasDisponiveis}.`,
      `Horário: ${horarioInicio} às ${horarioFim}.`,
    ].join("\n");
  }

  // ── 6. Convênio ───────────────────────────────────────────────────────────
  // ehConvenio só é true quando: modo é convênio E este profissional aceita
  const ehConvenio = isInsuranceContact && (prof?.acceptsInsurance === true || professionals.some((p) => p.acceptsInsurance === true));
  const planosAceitos = prof?.insurancePlans ?? allInsurancePlansList ?? null;

  let convenioTexto = "";
  if (!clinicAcceptsInsurance) {
    convenioTexto = "CONVÊNIO: Esta clínica NÃO atende por convênio. Atendimento 100% particular.";
  } else if (isInsuranceContact && !ehConvenio) {
    convenioTexto = [
      "CONVÊNIO: Este profissional NÃO atende por convênio.",
      planosAceitos ? `Profissionais que aceitam convênio atendem: ${planosAceitos}.` : "",
      "Informe o contato e ofereça atendimento particular.",
    ].filter(Boolean).join("\n");
  } else if (isInsuranceContact && ehConvenio) {
    convenioTexto = [
      planosAceitos
        ? `CONVÊNIO: Planos aceitos: ${planosAceitos}.`
        : "CONVÊNIO: Aceita convênio odontológico.",
      `REGRA CRÍTICA: Se o plano informado NÃO estiver na lista acima, informe IMEDIATAMENTE que não é aceito.`,
      `NUNCA confirme um plano que não esteja explicitamente na lista.`,
    ].join("\n");
  } else if (!isInsuranceContact) {
    // Modo particular — não menciona convênio
    convenioTexto = "";
  }

  // ── 7. Linha do profissional ──────────────────────────────────────────────
  let profissionalLinha = "";
  if (prof) {
    const parts: string[] = [`Profissional: ${prof.name}`];
    if (prof.specialty) parts.push(`Especialidade: ${prof.specialty}`);
    if (prof.cro) parts.push(`CRO: ${prof.cro}`);
    profissionalLinha = parts.join(" | ");
  }

  // ── 8. Duração ────────────────────────────────────────────────────────────
  const duracaoLead = prof?.defaultLeadDurationMinutes ?? 30;
  const duracaoPaciente = prof?.defaultPatientDurationMinutes ?? 30;

  return {
    modoTexto,
    instrucaoAbordagem,
    profissional: prof,
    profissionalLinha,
    cobrarConsulta,
    valorConsulta,
    exigirPix,
    pixOpcional,
    chavePix,
    bancoPix,
    tipoPix,
    pagamentoTexto,
    diasDisponiveis,
    horarioInicio,
    horarioFim,
    agendaTexto,
    ehConvenio,
    planosAceitos,
    convenioTexto,
    duracaoLead,
    duracaoPaciente,
  };
}
