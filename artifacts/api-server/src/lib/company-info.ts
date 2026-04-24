/**
 * Dados oficiais da empresa contratada (OdontoFlow).
 *
 * Centralizados aqui para que, quando os dados definitivos forem
 * fornecidos, baste atualizar este arquivo — o PDF do contrato, e-mails
 * e qualquer outro lugar que precise referenciar a contratada passam a
 * mostrar os valores reais automaticamente.
 *
 * Os campos abaixo são opcionais: enquanto o valor estiver `null`, o
 * PDF mostra um traço ("—") em vez do dado.
 */
export interface CompanyInfo {
  brandName: string;
  legalName: string | null;
  taxId: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  email: string | null;
  phone: string | null;
}

export const ODONTOFLOW_COMPANY: CompanyInfo = {
  brandName: "OdontoFlow",
  legalName: null,
  taxId: null,
  addressLine: null,
  city: null,
  state: null,
  postalCode: null,
  email: null,
  phone: null,
};

const DASH = "—";

export function formatCompanyAddress(c: CompanyInfo): string {
  const cityState = [c.city, c.state].filter(Boolean).join(" / ");
  const parts = [c.addressLine, cityState, c.postalCode ? `CEP ${c.postalCode}` : null]
    .filter((p): p is string => Boolean(p && p.trim()));
  return parts.length > 0 ? parts.join(" — ") : DASH;
}

export function formatCompanyLegalName(c: CompanyInfo): string {
  return c.legalName?.trim() || `${c.brandName} (dados a serem informados)`;
}

export function formatCompanyTaxId(c: CompanyInfo): string {
  return c.taxId?.trim() || DASH;
}
