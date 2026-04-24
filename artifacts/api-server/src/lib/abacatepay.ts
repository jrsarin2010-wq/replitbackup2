import axios from "axios";
import { logger } from "./logger";

const ABACATEPAY_BASE = "https://api.abacatepay.com/v1";

export interface CreditPackage {
  id: string;
  name: string;
  chars: number;
  priceInCents: number;
  priceLabel: string;
  description: string;
  highlight?: boolean;
}

export const CREDIT_PACKAGES: CreditPackage[] = [
  {
    id: "starter",
    name: "Básico",
    chars: 54_000,
    priceInCents: 2500,
    priceLabel: "R$\u00a025,00",
    description: "+60 minutos de áudio",
  },
  {
    id: "standard",
    name: "Padrão",
    chars: 108_000,
    priceInCents: 4000,
    priceLabel: "R$\u00a040,00",
    description: "+2 horas de áudio",
    highlight: true,
  },
  {
    id: "pro",
    name: "Pro",
    chars: 270_000,
    priceInCents: 9000,
    priceLabel: "R$\u00a090,00",
    description: "+5 horas de áudio",
  },
];

export function getPackageById(id: string): CreditPackage | undefined {
  return CREDIT_PACKAGES.find((p) => p.id === id);
}

export async function verifyBillingPaid(billingId: string): Promise<boolean> {
  const apiKey = process.env.ABACATEPAY_API_KEY;
  if (!apiKey) return false;

  try {
    const res = await axios.get(`${ABACATEPAY_BASE}/billing/list`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const billings = (res.data as { data?: Array<{ id: string; status: string }> })?.data || [];
    const billing = billings.find((b) => b.id === billingId);
    return billing?.status === "PAID";
  } catch (err) {
    logger.error({ err, billingId }, "Failed to verify billing status with AbacatePay");
    return false;
  }
}

interface CreateBillingParams {
  packageId: string;
  chars: number;
  priceInCents: number;
  productName: string;
  tenantId: number;
  tenantName: string;
  tenantEmail: string;
  tenantPhone?: string;
  tenantTaxId: string;
  returnUrl: string;
  webhookUrl: string;
}

interface AbacatePayBilling {
  id: string;
  url: string;
  status: string;
}

async function getOrCreateCustomer(apiKey: string, params: { name: string; email: string; phone: string; taxId: string }): Promise<string> {
  try {
    const res = await axios.post(
      `${ABACATEPAY_BASE}/customer/create`,
      {
        name: params.name,
        email: params.email,
        cellphone: params.phone.replace(/\D/g, "") || "11999999999",
        taxId: params.taxId.replace(/\D/g, ""),
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    const data = res.data as { success: boolean; data: { id: string } };
    if (!data.success || !data.data?.id) {
      throw new Error("Falha ao criar cliente no AbacatePay");
    }
    return data.data.id;
  } catch (err: unknown) {
    const axiosErr = err as { response?: { status?: number; data?: { data?: { id: string }; error?: string } } };
    if (axiosErr?.response?.status === 409 && axiosErr.response.data?.data?.id) {
      return axiosErr.response.data.data.id;
    }
    const listRes = await axios.get(`${ABACATEPAY_BASE}/customer/list`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const customers = (listRes.data as { data: Array<{ id: string; metadata: { taxId: string } }> }).data || [];
    const existing = customers.find((c) => c.metadata?.taxId === params.taxId.replace(/\D/g, ""));
    if (existing) return existing.id;
    throw err;
  }
}

interface CreateGenericBillingParams {
  productId: string;
  productName: string;
  priceInCents: number;
  tenantId: number;
  tenantName: string;
  tenantEmail: string;
  tenantPhone?: string;
  tenantTaxId: string;
  returnUrl: string;
  webhookUrl: string;
  metadata: Record<string, string>;
}

export async function createPixBillingGeneric(params: CreateGenericBillingParams): Promise<AbacatePayBilling | { error: string }> {
  const apiKey = process.env.ABACATEPAY_API_KEY;
  if (!apiKey) {
    return { error: "Pagamentos ainda não configurados. Entre em contato com o suporte." };
  }

  const cleanTaxId = params.tenantTaxId.replace(/\D/g, "");
  if (!cleanTaxId || (cleanTaxId.length !== 11 && cleanTaxId.length !== 14)) {
    return { error: "CPF (11 dígitos) ou CNPJ (14 dígitos) inválido." };
  }

  try {
    const customerId = await getOrCreateCustomer(apiKey, {
      name: params.tenantName,
      email: params.tenantEmail,
      phone: params.tenantPhone || "",
      taxId: params.tenantTaxId,
    });

    const res = await axios.post(
      `${ABACATEPAY_BASE}/billing/create`,
      {
        frequency: "ONE_TIME",
        methods: ["PIX"],
        products: [
          {
            externalId: `${params.productId}-${params.tenantId}`,
            name: params.productName,
            quantity: 1,
            price: params.priceInCents,
          },
        ],
        returnUrl: params.returnUrl,
        completionUrl: params.returnUrl,
        metadata: params.metadata,
        customerId,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    const data = (res.data as { data: AbacatePayBilling }).data;
    return { id: data.id, url: data.url, status: data.status };
  } catch (err: unknown) {
    const axiosErr = err as { response?: { status?: number; data?: { error?: string; message?: string } }; message?: string };
    logger.error({
      status: axiosErr?.response?.status,
      errorData: axiosErr?.response?.data?.error,
      message: axiosErr?.message,
    }, "AbacatePay generic billing creation failed");
    const errorMsg = axiosErr?.response?.data?.error || axiosErr?.response?.data?.message || axiosErr?.message || "Erro ao gerar cobrança";
    return { error: errorMsg };
  }
}

export async function createPixBilling(params: CreateBillingParams): Promise<AbacatePayBilling | { error: string }> {
  const apiKey = process.env.ABACATEPAY_API_KEY;
  if (!apiKey) {
    return { error: "Pagamentos ainda não configurados. Entre em contato com o suporte." };
  }

  const cleanTaxId = params.tenantTaxId.replace(/\D/g, "");
  if (!cleanTaxId || (cleanTaxId.length !== 11 && cleanTaxId.length !== 14)) {
    return { error: "CPF (11 dígitos) ou CNPJ (14 dígitos) inválido." };
  }

  try {
    const customerId = await getOrCreateCustomer(apiKey, {
      name: params.tenantName,
      email: params.tenantEmail,
      phone: params.tenantPhone || "",
      taxId: params.tenantTaxId,
    });

    const res = await axios.post(
      `${ABACATEPAY_BASE}/billing/create`,
      {
        frequency: "ONE_TIME",
        methods: ["PIX"],
        products: [
          {
            externalId: `${params.packageId}-${params.tenantId}`,
            name: params.productName,
            quantity: 1,
            price: params.priceInCents,
          },
        ],
        returnUrl: params.returnUrl,
        completionUrl: params.returnUrl,
        metadata: {
          tenantId: String(params.tenantId),
          packageId: params.packageId,
          chars: String(params.chars),
        },
        customerId,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    const data = (res.data as { data: AbacatePayBilling }).data;
    return { id: data.id, url: data.url, status: data.status };
  } catch (err: unknown) {
    const axiosErr = err as { response?: { status?: number; data?: { error?: string; message?: string } }; message?: string };
    logger.error({
      status: axiosErr?.response?.status,
      errorData: axiosErr?.response?.data?.error,
      message: axiosErr?.message,
    }, "AbacatePay billing creation failed");
    const errorMsg = axiosErr?.response?.data?.error || axiosErr?.response?.data?.message || axiosErr?.message || "Erro ao gerar cobrança";
    return { error: errorMsg };
  }
}
