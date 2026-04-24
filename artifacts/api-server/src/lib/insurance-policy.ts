/**
 * insurance-policy.ts — Motor de regras de negócio para convênio/particular.
 *
 * FONTE ÚNICA DE VERDADE para todas as decisões derivadas da ficha do
 * profissional e das configurações da clínica:
 *
 *   - cobrar ou não consulta e qual valor
 *   - enviar ou não PIX (e qual modo: required / optional)
 *   - enviar ou não welcome media (vídeo/áudio)
 *   - label do agendamento (Lead / Particular)
 *   - exibir ou não seção de preços no prompt da IA
 *   - dias/horários de convênio por profissional
 *
 * REGRAS DE NEGÓCIO IMUTÁVEIS:
 *   1. Lead = sempre PARTICULAR. Convênio nunca é lead — vai para patients.
 *   2. chargesConsultation default=true no banco — mas só exibir fee se
 *      consultationFee estiver configurado (evitar R$150 genérico).
 *   3. Convênio nunca recebe PIX, welcome media, nem seção de preços.
 *   4. Por profissional tem prioridade sobre configuração da clínica.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos — espelham os campos reais do schema (dental_professionals + dental_settings)
// ─────────────────────────────────────────────────────────────────────────────

export interface ProfessionalPolicy {
  id?: number;
  name?: string;
  specialty?: string | null;
  specialties?: string | null;
  cro?: string | null;
  workingDays?: string | null;
  workingHoursStart?: string | null;
  workingHoursEnd?: string | null;
  lunchStart?: string | null;
  lunchEnd?: string | null;
  slotDurationMinutes?: number | null;
  defaultLeadDurationMinutes?: number | null;
  defaultPatientDurationMinutes?: number | null;
  // Consulta
  chargesConsultation?: boolean | null;
  consultationFee?: string | null;
  // Convênio
  acceptsInsurance?: boolean | null;
  insurancePlans?: string | null;
  insuranceDays?: string | null;
  insuranceHoursStart?: string | null;
  insuranceHoursEnd?: string | null;
  // PIX
  pixEnabled?: boolean | null;
  pixKey?: string | null;
  pixMode?: string | null;     // "required" | "optional"
  pixBank?: string | null;
  pixKeyType?: string | null;
  // Mídia de boas-vindas
  welcomeVideoUrl?: string | null;
  welcomeAudioUrl?: string | null;
}

export interface ClinicSettings {
  chargesConsultation?: boolean | null;
  consultationFee?: string | null;
  acceptsInsurance?: boolean | null;
  insurancePlans?: string | null;
  insuranceDays?: string | null;
  insuranceHoursStart?: string | null;
  insuranceHoursEnd?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Consulta / Fee
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve se cobra consulta.
 * Profissional tem prioridade — se tiver valor explícito (true/false), usa.
 * Caso null, cai para settings da clínica.
 * Default do banco é true, mas se consultationFee for null/vazio não exibe valor.
 */
export function resolveChargesConsultation(
  prof: ProfessionalPolicy | null,
  settings: ClinicSettings | null,
): boolean {
  if (prof?.chargesConsultation === true) return true;
  if (prof?.chargesConsultation === false) return false;
  // prof não tem valor explícito — usa settings
  if (settings?.chargesConsultation === true) return true;
  if (settings?.chargesConsultation === false) return false;
  // ambos null → default do banco é true, mas sem fee configurado não exibir
  return false;
}

/**
 * Resolve o valor da consulta.
 * Ordem de prioridade: fee do profissional → fee da clínica → null.
 * Nunca retorna fallback hardcoded. Caller deve verificar se chargesConsultation=true.
 */
export function resolveConsultationFee(
  prof: ProfessionalPolicy | null,
  settings: ClinicSettings | null,
): string | null {
  if (prof?.consultationFee && prof.consultationFee.trim()) return prof.consultationFee.trim();
  if (settings?.consultationFee && settings.consultationFee.trim()) return settings.consultationFee.trim();
  return null;
}

/**
 * Texto legível para o prompt da IA sobre consulta.
 * - Convênio: string vazia (seção de preços é omitida inteiramente)
 * - Cobra + fee: "R$XXX"
 * - Cobra sem fee: "A combinar com a clínica"
 * - Gratuita: "GRATUITA"
 */
export function resolveConsultationLabel(
  prof: ProfessionalPolicy | null,
  settings: ClinicSettings | null,
  isInsuranceContact: boolean,
): string {
  if (isInsuranceContact) return "";
  const charges = resolveChargesConsultation(prof, settings);
  if (!charges) return "GRATUITA";
  const fee = resolveConsultationFee(prof, settings);
  return fee ? `R$${fee}` : "A combinar com a clínica";
}

// ─────────────────────────────────────────────────────────────────────────────
// PIX
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convênio NUNCA recebe PIX.
 * Particular recebe se pixEnabled=true e pixKey configurado.
 */
export function shouldSendPix(
  isInsuranceContact: boolean,
  prof: ProfessionalPolicy,
): boolean {
  if (isInsuranceContact) return false;
  return !!(prof.pixEnabled && prof.pixKey);
}

/**
 * Modo PIX do profissional: "required" (obrigatório antes da consulta)
 * ou "optional" (informa apenas se perguntado).
 * Convênio retorna null (não se aplica).
 */
export function resolvePixMode(
  isInsuranceContact: boolean,
  prof: ProfessionalPolicy,
): "required" | "optional" | null {
  if (!shouldSendPix(isInsuranceContact, prof)) return null;
  return prof.pixMode === "required" ? "required" : "optional";
}

// ─────────────────────────────────────────────────────────────────────────────
// Welcome media
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Welcome video/áudio são para leads particulares em conversão.
 * Convênio NUNCA recebe — o conteúdo pode ter instruções de pagamento
 * particular que seriam confusas para paciente de plano.
 */
export function shouldSendWelcomeMedia(isInsuranceContact: boolean): boolean {
  return !isInsuranceContact;
}

/**
 * Retorna a URL de welcome media do profissional (vídeo ou áudio), se houver.
 * Convênio retorna null independente de estar configurado.
 */
export function resolveWelcomeMediaUrl(
  isInsuranceContact: boolean,
  prof: ProfessionalPolicy,
): { type: "video" | "audio"; url: string } | null {
  if (!shouldSendWelcomeMedia(isInsuranceContact)) return null;
  if (prof.welcomeVideoUrl) return { type: "video", url: prof.welcomeVideoUrl };
  if (prof.welcomeAudioUrl) return { type: "audio", url: prof.welcomeAudioUrl };
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Label de agendamento
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tag do card de agendamento para leads.
 * REGRA: lead = sempre PARTICULAR. Convênio auto-promovido a paciente na triagem.
 */
export function resolveLeadAppointmentTag(
  paymentType: string | null | undefined,
): "Particular" | "Lead" {
  return paymentType === "private" ? "Particular" : "Lead";
}

/**
 * Tag do card de agendamento para pacientes (tabela patients).
 * patientType="insurance" → "Convênio"
 * patientType="private" ou null/undefined → sem tag (paciente comum)
 */
export function resolvePatientAppointmentTag(
  patientType: string | null | undefined,
): "Convênio" | null {
  return patientType === "insurance" ? "Convênio" : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt gate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convênio: omite seção PREÇOS E PAGAMENTO do prompt inteiramente.
 * Isso impede a IA de vazar fee/PIX mesmo se o profissional tem configurado.
 */
export function shouldIncludePaymentSectionInPrompt(
  isInsuranceContact: boolean,
): boolean {
  return !isInsuranceContact;
}

// ─────────────────────────────────────────────────────────────────────────────
// Convênio — resolução de dias/horários por profissional
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve os dias de atendimento de convênio para um profissional.
 * Se o profissional tem dias de convênio próprios, usa — senão settings da clínica.
 */
export function resolveInsuranceDays(
  prof: ProfessionalPolicy,
  settings: ClinicSettings | null,
): string | null {
  if (prof.insuranceDays && prof.insuranceDays.trim()) return prof.insuranceDays.trim();
  return settings?.insuranceDays?.trim() || null;
}

/**
 * Resolve horário de início do atendimento de convênio.
 * Profissional tem prioridade sobre settings.
 */
export function resolveInsuranceHoursStart(
  prof: ProfessionalPolicy,
  settings: ClinicSettings | null,
): string | null {
  if (prof.insuranceHoursStart && prof.insuranceHoursStart.trim()) return prof.insuranceHoursStart.trim();
  return settings?.insuranceHoursStart?.trim() || null;
}

/**
 * Resolve horário de fim do atendimento de convênio.
 * Profissional tem prioridade sobre settings.
 */
export function resolveInsuranceHoursEnd(
  prof: ProfessionalPolicy,
  settings: ClinicSettings | null,
): string | null {
  if (prof.insuranceHoursEnd && prof.insuranceHoursEnd.trim()) return prof.insuranceHoursEnd.trim();
  return settings?.insuranceHoursEnd?.trim() || null;
}

/**
 * Resolve os planos de convênio aceitos por um profissional.
 * Profissional tem prioridade — se tiver configurado, usa os dele.
 * Se não, usa os da clínica (settings).
 */
export function resolveInsurancePlans(
  prof: ProfessionalPolicy,
  settings: ClinicSettings | null,
): string | null {
  if (prof.insurancePlans && prof.insurancePlans.trim()) return prof.insurancePlans.trim();
  return settings?.insurancePlans?.trim() || null;
}
