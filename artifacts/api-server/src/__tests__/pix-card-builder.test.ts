import { describe, it, expect } from "vitest";
import { buildPixCardText, buildPixInstructionsSection } from "../lib/prompt-helpers";

describe("buildPixCardText — cartao PIX para o paciente", () => {
  it("renderiza todos os campos quando tudo esta preenchido", () => {
    const card = buildPixCardText({
      name: "Dra. Ana Souza",
      pixKey: "123.456.789-00",
      pixBank: "Nubank",
      pixKeyType: "cpf",
      consultationFee: "200,00",
      chargesConsultation: true,
    });
    expect(card).toContain("DADOS PARA PAGAMENTO PIX");
    expect(card).toContain("*Recebedor:* Dra. Ana Souza");
    expect(card).toContain("*Banco:* Nubank");
    expect(card).toContain("*Tipo de chave:* CPF");
    expect(card).toContain("*Chave:* 123.456.789-00");
    expect(card).toContain("*Valor:* R$ 200,00");
    expect(card).toContain("enviar o comprovante");
  });

  it("omite a linha do banco quando vazio", () => {
    const card = buildPixCardText({
      name: "Dra. Ana",
      pixKey: "ana@clinic.com",
      pixBank: "",
      pixKeyType: "email",
      consultationFee: null,
      chargesConsultation: false,
    });
    expect(card).not.toContain("Banco:");
    expect(card).toContain("*Tipo de chave:* E-mail");
    expect(card).toContain("*Chave:* ana@clinic.com");
  });

  it("omite a linha do tipo de chave quando ausente ou invalido", () => {
    const cardA = buildPixCardText({
      name: "Dr. Joao",
      pixKey: "abc-123",
      pixBank: null,
      pixKeyType: null,
      consultationFee: null,
      chargesConsultation: false,
    });
    expect(cardA).not.toContain("Tipo de chave:");

    const cardB = buildPixCardText({
      name: "Dr. Joao",
      pixKey: "abc-123",
      pixBank: null,
      pixKeyType: "invalid_type",
      consultationFee: null,
      chargesConsultation: false,
    });
    expect(cardB).not.toContain("Tipo de chave:");
  });

  it("omite o valor quando chargesConsultation=false ou fee ausente", () => {
    const card = buildPixCardText({
      name: "Dra. X",
      pixKey: "11999998888",
      pixBank: "Itau",
      pixKeyType: "phone",
      consultationFee: "300,00",
      chargesConsultation: false,
    });
    expect(card).not.toContain("Valor:");

    const cardNoFee = buildPixCardText({
      name: "Dra. X",
      pixKey: "11999998888",
      pixBank: "Itau",
      pixKeyType: "phone",
      consultationFee: null,
      chargesConsultation: true,
    });
    expect(cardNoFee).not.toContain("Valor:");
  });

  it("renderiza todos os 5 tipos de chave com label legivel", () => {
    const labels: Record<string, string> = {
      cpf: "CPF",
      cnpj: "CNPJ",
      email: "E-mail",
      phone: "Telefone",
      random: "Chave aleatória",
    };
    for (const [type, label] of Object.entries(labels)) {
      const card = buildPixCardText({
        name: "Dra. Y",
        pixKey: "key-x",
        pixBank: null,
        pixKeyType: type,
        consultationFee: null,
        chargesConsultation: false,
      });
      expect(card).toContain(`*Tipo de chave:* ${label}`);
    }
  });
});

describe("buildPixInstructionsSection — integracao com o prompt da IA", () => {
  it("retorna string vazia quando nenhum profissional tem PIX habilitado", () => {
    const out = buildPixInstructionsSection([
      { id: 1, name: "Dra. A", pixEnabled: false, pixKey: "x" },
      { id: 2, name: "Dr. B", pixEnabled: true, pixKey: null },
    ]);
    expect(out).toBe("");
  });

  it("inclui o cartao formatado e instrucao de envio literal no modo opcional", () => {
    const out = buildPixInstructionsSection([
      {
        id: 1,
        name: "Dra. Ana",
        pixEnabled: true,
        pixKey: "123",
        pixMode: "optional",
        pixBank: "Nubank",
        pixKeyType: "cpf",
        consultationFee: "200,00",
        chargesConsultation: true,
      },
    ]);
    expect(out).toContain("PIX OPCIONAL");
    expect(out).toContain("envie EXATAMENTE o cartao abaixo");
    expect(out).toContain("DADOS PARA PAGAMENTO PIX");
    expect(out).toContain("*Banco:* Nubank");
    expect(out).toContain("*Tipo de chave:* CPF");
  });

  it("inclui instrucao de aguardar comprovante no modo obrigatorio", () => {
    const out = buildPixInstructionsSection([
      {
        id: 1,
        name: "Dr. B",
        pixEnabled: true,
        pixKey: "456",
        pixMode: "required",
        pixBank: null,
        pixKeyType: "random",
      },
    ]);
    expect(out).toContain("PIX OBRIGATORIO");
    expect(out).toContain("AGUARDE o comprovante");
    expect(out).toContain("*Tipo de chave:* Chave aleatória");
    expect(out).not.toContain("Banco:");
  });

  it("rotula multiplos profissionais com 'do(a)'", () => {
    const out = buildPixInstructionsSection([
      { id: 1, name: "Dra. Ana", pixEnabled: true, pixKey: "111", pixMode: "optional" },
      { id: 2, name: "Dr. Bruno", pixEnabled: true, pixKey: "222", pixMode: "required" },
    ]);
    expect(out).toContain("PIX OPCIONAL do(a) Dra. Ana");
    expect(out).toContain("PIX OBRIGATORIO do(a) Dr. Bruno");
    expect(out).toContain("*Recebedor:* Dra. Ana");
    expect(out).toContain("*Recebedor:* Dr. Bruno");
  });
});
