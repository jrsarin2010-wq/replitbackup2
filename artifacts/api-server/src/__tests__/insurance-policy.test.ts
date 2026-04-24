/**
 * Suíte de testes — insurance-policy.ts
 *
 * Cobre todas as regras de negócio do policy engine. Cada teste representa
 * um cenário real que já causou bug em produção ou pode causar no futuro.
 * Quando um bug aparecer: escreva o teste ANTES de corrigir o código.
 */

import { describe, it, expect } from "vitest";
import {
  resolveChargesConsultation,
  resolveConsultationFee,
  resolveConsultationLabel,
  shouldSendPix,
  resolvePixMode,
  shouldSendWelcomeMedia,
  resolveLeadAppointmentTag,
  resolvePatientAppointmentTag,
  shouldIncludePaymentSectionInPrompt,
  resolveInsuranceDays,
  resolveInsuranceHoursStart,
  resolveInsuranceHoursEnd,
  resolveInsurancePlans,
} from "../lib/insurance-policy";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures de profissionais e settings para os testes
// ─────────────────────────────────────────────────────────────────────────────

const profParticular = {
  id: 1,
  name: "Dr. Siverino",
  chargesConsultation: true,
  consultationFee: "200.00",
  pixEnabled: true,
  pixKey: "123.456.789-00",
  pixMode: "required",
  pixBank: "Nubank",
  pixKeyType: "cpf",
  acceptsInsurance: false,
  insurancePlans: null,
  insuranceDays: null,
  insuranceHoursStart: null,
  insuranceHoursEnd: null,
};

const profConvenio = {
  id: 2,
  name: "Dr. Robertino",
  chargesConsultation: false,
  consultationFee: null,
  pixEnabled: false,
  pixKey: null,
  pixMode: "optional",
  pixBank: null,
  pixKeyType: null,
  acceptsInsurance: true,
  insurancePlans: "Unimed, Bradesco Saúde",
  insuranceDays: "1,3,5",
  insuranceHoursStart: "08:00",
  insuranceHoursEnd: "12:00",
};

const profGratuito = {
  id: 3,
  name: "Dra. Ana",
  chargesConsultation: false,
  consultationFee: null,
  pixEnabled: false,
  pixKey: null,
  pixMode: "optional",
  pixBank: null,
  pixKeyType: null,
  acceptsInsurance: false,
  insurancePlans: null,
  insuranceDays: null,
  insuranceHoursStart: null,
  insuranceHoursEnd: null,
};

const profPixOpcional = {
  id: 4,
  name: "Dra. Clara",
  chargesConsultation: true,
  consultationFee: "150.00",
  pixEnabled: true,
  pixKey: "clara@clinica.com",
  pixMode: "optional",
  pixBank: "Inter",
  pixKeyType: "email",
  acceptsInsurance: false,
  insurancePlans: null,
  insuranceDays: null,
  insuranceHoursStart: null,
  insuranceHoursEnd: null,
};

const settingsComFee: { chargesConsultation: boolean; consultationFee: string; acceptsInsurance: boolean } = {
  chargesConsultation: true,
  consultationFee: "150.00",
  acceptsInsurance: true,
};

const settingsSemFee: { chargesConsultation: boolean; consultationFee: null; acceptsInsurance: boolean } = {
  chargesConsultation: false,
  consultationFee: null,
  acceptsInsurance: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// resolveChargesConsultation
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveChargesConsultation", () => {
  it("prof com chargesConsultation=true cobra", () => {
    expect(resolveChargesConsultation(profParticular, settingsSemFee)).toBe(true);
  });

  it("prof com chargesConsultation=false NÃO cobra", () => {
    expect(resolveChargesConsultation(profGratuito, settingsComFee)).toBe(false);
  });

  it("prof null com settings=true cobra", () => {
    expect(resolveChargesConsultation(null, settingsComFee)).toBe(true);
  });

  it("prof null com settings=false NÃO cobra", () => {
    expect(resolveChargesConsultation(null, settingsSemFee)).toBe(false);
  });

  it("prof null e settings null → NÃO cobra (null-safe)", () => {
    expect(resolveChargesConsultation(null, null)).toBe(false);
  });

  it("prof sem valor explícito (null) cai para settings", () => {
    const profSemConfig = { ...profParticular, chargesConsultation: null };
    expect(resolveChargesConsultation(profSemConfig, settingsComFee)).toBe(true);
    expect(resolveChargesConsultation(profSemConfig, settingsSemFee)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveConsultationFee
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveConsultationFee", () => {
  it("retorna fee do profissional se configurado", () => {
    expect(resolveConsultationFee(profParticular, settingsComFee)).toBe("200.00");
  });

  it("cai para fee da clínica se prof não tem fee", () => {
    const profSemFee = { ...profParticular, consultationFee: null };
    expect(resolveConsultationFee(profSemFee, settingsComFee)).toBe("150.00");
  });

  it("retorna null se nenhum tem fee — NÃO retorna R$150 hardcoded", () => {
    expect(resolveConsultationFee(profGratuito, settingsSemFee)).toBeNull();
  });

  it("prof null usa fee da clínica", () => {
    expect(resolveConsultationFee(null, settingsComFee)).toBe("150.00");
  });

  it("prof null e settings null → null (sem fallback hardcoded)", () => {
    expect(resolveConsultationFee(null, null)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveConsultationLabel
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveConsultationLabel", () => {
  it("convênio → string vazia (nunca mostra preço)", () => {
    expect(resolveConsultationLabel(profParticular, settingsComFee, true)).toBe("");
  });

  it("particular com fee → R$200.00", () => {
    expect(resolveConsultationLabel(profParticular, settingsComFee, false)).toBe("R$200.00");
  });

  it("gratuito → GRATUITA", () => {
    expect(resolveConsultationLabel(profGratuito, settingsSemFee, false)).toBe("GRATUITA");
  });

  it("cobra mas sem fee → A combinar com a clínica (não inventa R$150)", () => {
    const profSemFee = { ...profParticular, consultationFee: null };
    const settingsSemFeeObj = { ...settingsComFee, consultationFee: null };
    expect(resolveConsultationLabel(profSemFee, settingsSemFeeObj as typeof settingsComFee, false)).toBe("A combinar com a clínica");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// shouldSendPix
// ─────────────────────────────────────────────────────────────────────────────

describe("shouldSendPix", () => {
  it("convênio NUNCA recebe PIX — mesmo com pixEnabled=true", () => {
    expect(shouldSendPix(true, profParticular)).toBe(false);
  });

  it("particular com pixEnabled + pixKey → recebe PIX", () => {
    expect(shouldSendPix(false, profParticular)).toBe(true);
  });

  it("particular sem pixEnabled → NÃO recebe PIX", () => {
    expect(shouldSendPix(false, profGratuito)).toBe(false);
  });

  it("particular com pixEnabled=true mas pixKey null → NÃO recebe PIX", () => {
    const profSemChave = { ...profParticular, pixKey: null };
    expect(shouldSendPix(false, profSemChave)).toBe(false);
  });

  it("convênio com pixEnabled=true e pixKey configurado → AINDA NÃO recebe PIX", () => {
    const profConvenioComPix = { ...profConvenio, pixEnabled: true, pixKey: "123" };
    expect(shouldSendPix(true, profConvenioComPix)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolvePixMode
// ─────────────────────────────────────────────────────────────────────────────

describe("resolvePixMode", () => {
  it("convênio → null (não tem modo PIX)", () => {
    expect(resolvePixMode(true, profParticular)).toBeNull();
  });

  it("particular com pixMode=required → required", () => {
    expect(resolvePixMode(false, profParticular)).toBe("required");
  });

  it("particular com pixMode=optional → optional", () => {
    expect(resolvePixMode(false, profPixOpcional)).toBe("optional");
  });

  it("particular sem PIX configurado → null", () => {
    expect(resolvePixMode(false, profGratuito)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// shouldSendWelcomeMedia
// ─────────────────────────────────────────────────────────────────────────────

describe("shouldSendWelcomeMedia", () => {
  it("convênio → NÃO envia welcome media", () => {
    expect(shouldSendWelcomeMedia(true)).toBe(false);
  });

  it("particular → envia welcome media", () => {
    expect(shouldSendWelcomeMedia(false)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveLeadAppointmentTag
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveLeadAppointmentTag", () => {
  it("paymentType=private → Particular", () => {
    expect(resolveLeadAppointmentTag("private")).toBe("Particular");
  });

  it("paymentType=null → Lead (ainda não triado)", () => {
    expect(resolveLeadAppointmentTag(null)).toBe("Lead");
  });

  it("paymentType=undefined → Lead", () => {
    expect(resolveLeadAppointmentTag(undefined)).toBe("Lead");
  });

  it("paymentType=insurance NUNCA ocorre em lead → trata como Lead", () => {
    // Convênio deve ter sido promovido a paciente. Se por algum motivo
    // chegou aqui com insurance, não mostra 'Convênio' — mostra 'Lead'.
    expect(resolveLeadAppointmentTag("insurance")).toBe("Lead");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolvePatientAppointmentTag
// ─────────────────────────────────────────────────────────────────────────────

describe("resolvePatientAppointmentTag", () => {
  it("patientType=insurance → Convênio", () => {
    expect(resolvePatientAppointmentTag("insurance")).toBe("Convênio");
  });

  it("patientType=private → null (sem tag — paciente comum)", () => {
    expect(resolvePatientAppointmentTag("private")).toBeNull();
  });

  it("patientType=null → null (cadastro antigo sem tipo)", () => {
    expect(resolvePatientAppointmentTag(null)).toBeNull();
  });

  it("patientType=undefined → null", () => {
    expect(resolvePatientAppointmentTag(undefined)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// shouldIncludePaymentSectionInPrompt
// ─────────────────────────────────────────────────────────────────────────────

describe("shouldIncludePaymentSectionInPrompt", () => {
  it("convênio → NÃO inclui seção de pagamento no prompt", () => {
    expect(shouldIncludePaymentSectionInPrompt(true)).toBe(false);
  });

  it("particular → inclui seção de pagamento no prompt", () => {
    expect(shouldIncludePaymentSectionInPrompt(false)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveInsuranceDays / Hours / Plans — prioridade profissional sobre settings
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveInsuranceDays", () => {
  it("usa dias do profissional se configurado", () => {
    expect(resolveInsuranceDays(profConvenio, settingsComFee)).toBe("1,3,5");
  });

  it("cai para settings se profissional não tem dias", () => {
    const profSemDias = { ...profConvenio, insuranceDays: null };
    const settingsComDias = { ...settingsComFee, insuranceDays: "2,4" };
    expect(resolveInsuranceDays(profSemDias, settingsComDias)).toBe("2,4");
  });

  it("retorna null se nenhum tem dias configurados", () => {
    expect(resolveInsuranceDays(profParticular, null)).toBeNull();
  });
});

describe("resolveInsuranceHoursStart", () => {
  it("usa horário do profissional", () => {
    expect(resolveInsuranceHoursStart(profConvenio, null)).toBe("08:00");
  });

  it("cai para settings se profissional não tem horário", () => {
    const profSemHora = { ...profConvenio, insuranceHoursStart: null };
    const settings = { ...settingsComFee, insuranceHoursStart: "09:00" };
    expect(resolveInsuranceHoursStart(profSemHora, settings)).toBe("09:00");
  });
});

describe("resolveInsuranceHoursEnd", () => {
  it("usa horário fim do profissional", () => {
    expect(resolveInsuranceHoursEnd(profConvenio, null)).toBe("12:00");
  });
});

describe("resolveInsurancePlans", () => {
  it("usa planos do profissional", () => {
    expect(resolveInsurancePlans(profConvenio, settingsComFee)).toBe("Unimed, Bradesco Saúde");
  });

  it("cai para settings se profissional não tem planos", () => {
    const profSemPlanos = { ...profConvenio, insurancePlans: null };
    const settings = { ...settingsComFee, insurancePlans: "Amil" };
    expect(resolveInsurancePlans(profSemPlanos, settings)).toBe("Amil");
  });

  it("retorna null se nenhum tem planos", () => {
    expect(resolveInsurancePlans(profParticular, null)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cenários de regressão — bugs que já aconteceram
// ─────────────────────────────────────────────────────────────────────────────

describe("Regressões — bugs já corrigidos", () => {
  it("BUG #1: convênio não pode receber PIX mesmo se prof tem pixEnabled=true e pixMode=required", () => {
    // Este bug causou envio de dados bancários para paciente de plano
    expect(shouldSendPix(true, profParticular)).toBe(false);
    expect(resolvePixMode(true, profParticular)).toBeNull();
  });

  it("BUG #2: clínica sem fee configurado não deve mostrar R$150 hardcoded", () => {
    // Este bug causou a IA anunciar R$150 sem nenhum fee configurado
    const semFee = resolveConsultationFee(null, null);
    expect(semFee).toBeNull();
    expect(semFee).not.toBe("150.00");
  });

  it("BUG #3: welcome media não pode ir para convênio", () => {
    // Conteúdo poderia ter instruções de pagamento particular
    expect(shouldSendWelcomeMedia(true)).toBe(false);
  });

  it("BUG #4: lead com paymentType=insurance nunca deve mostrar tag Convênio", () => {
    // Convênio deve ter sido promovido a paciente — não existe como lead
    expect(resolveLeadAppointmentTag("insurance")).toBe("Lead");
    expect(resolveLeadAppointmentTag("insurance")).not.toBe("Convênio");
  });

  it("BUG #5: seção de pagamento/PIX do prompt deve ser omitida para convênio", () => {
    // IA recebia instruções de PIX no prompt e as replicava para paciente de plano
    expect(shouldIncludePaymentSectionInPrompt(true)).toBe(false);
  });
});
