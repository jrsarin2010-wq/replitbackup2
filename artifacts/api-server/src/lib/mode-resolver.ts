/**
 * Task #17 — Roteador determinístico de modo de conversa.
 *
 * Decide, antes de chamar a IA, em qual dos 4 modos a conversa deve operar:
 *   - CONVENIO_TRIAGEM: clínica aceita convênio e contato ainda não respondeu plano/particular
 *   - CONVENIO_AGENDAR: contato declarou que usa plano/convênio
 *   - PARTICULAR_SPIN:  lead novo (não-paciente) que pagará particular — usa SPIN/escassez
 *   - PACIENTE_AGENDAR: paciente recorrente — tom familiar, sem SPIN
 *
 * Função pura, sem IO, totalmente testável. Substitui decisões probabilísticas
 * de prompt por regras de código auditáveis.
 */

import type { ContactType } from "./lead-engine";
import type { InsuranceModeResult } from "./lead-engine";

export type ConversationMode =
  | "CONVENIO_TRIAGEM"
  | "CONVENIO_AGENDAR"
  | "PARTICULAR_SPIN"
  | "PACIENTE_AGENDAR";

export interface ModeResolverInput {
  contactType: ContactType;
  clinicAcceptsInsurance: boolean;
  insuranceMode: InsuranceModeResult;
}

export interface ModeResolverResult {
  mode: ConversationMode;
  /** Curto, apenas para logs/dashboards. */
  reason: string;
}

export function resolveConversationMode(input: ModeResolverInput): ModeResolverResult {
  const { contactType, clinicAcceptsInsurance, insuranceMode } = input;

  // Override de conflito: se o lead acabou de declarar EXPLICITAMENTE particular
  // na mensagem atual e a evidência de convênio vem APENAS de fonte fraca
  // (histórico OU paymentType persistido em turno anterior, sem declaração
  // explícita de convênio na mensagem atual), respeitar a declaração atual.
  // Casos cobertos:
  //   - lead pergunta "atende convênios?" turno 1 → diz "sou particular" turno 2
  //     (history dispara isInsurance, current declara particular)
  //   - paymentType persistido como "insurance" por engano em turno anterior →
  //     paciente corrige dizendo "sou particular" agora
  // Sem este guard, o branch CONVENIO_AGENDAR abaixo trava o lead particular
  // no fluxo errado e perde a conversão.
  // Pacientes recorrentes (contactType=patient) seguem o caminho normal abaixo
  // pois a triagem deles tem semântica diferente (família + recorrência > SPIN).
  if (
    contactType !== "patient" &&
    insuranceMode.privateExplicitInCurrent &&
    !insuranceMode.insuranceExplicitInCurrent
  ) {
    return { mode: "PARTICULAR_SPIN", reason: "private_overrides_weak_insurance" };
  }

  // Convênio confirmado: isInsurance E triageComplete para evitar que uma
  // detecção parcial (suspeita via padrão sem confirmação explícita) pule
  // a triagem e entre direto no modo de agendamento convênio.
  if (insuranceMode.isInsurance && insuranceMode.triageComplete) {
    return { mode: "CONVENIO_AGENDAR", reason: "insurance_confirmed" };
  }

  // Pacientes recorrentes que não usam convênio: tom familiar, sem SPIN.
  if (contactType === "patient") {
    return { mode: "PACIENTE_AGENDAR", reason: "patient_recurring" };
  }

  // Clínica aceita convênio mas contato ainda não respondeu — triagem.
  if (clinicAcceptsInsurance && !insuranceMode.triageComplete) {
    return { mode: "CONVENIO_TRIAGEM", reason: "triage_pending" };
  }

  // Lead particular (declarado ou clínica só atende particular).
  return { mode: "PARTICULAR_SPIN", reason: "private_lead" };
}

export const ALL_MODES: ConversationMode[] = [
  "CONVENIO_TRIAGEM",
  "CONVENIO_AGENDAR",
  "PARTICULAR_SPIN",
  "PACIENTE_AGENDAR",
];
