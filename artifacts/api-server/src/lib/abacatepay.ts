import axios from "axios";
import { createHmac, timingSafeEqual } from "crypto";
import { logger } from "./logger";

const ABACATEPAY_BASE = "https://api.abacatepay.com/v1";

// Webhook secret deve estar em .env
const ABACATEPAY_WEBHOOK_SECRET = process.env.ABACATEPAY_WEBHOOK_SECRET || "";

if (!ABACATEPAY_WEBHOOK_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("ABACATEPAY_WEBHOOK_SECRET não configurado");
}

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

/**
 * Verifica assinatura HMAC-SHA256 do webhook AbacatePay.
 * Formato: signature = base64(HMAC-SHA256(payload, secret))
 * Usa timingSafeEqual para evitar timing attacks.
 */
export function verifyWebhookSignature(payload: string, signature: string): boolean {
  if (!ABACATEPAY_WEBHOOK_SECRET) return false;
  const expected = createHmac("sha256", ABACATEPAY_WEBHOOK_SECRET)
    .update(payload)
    .digest("base64");
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export interface WebhookPayload {
  event: string;
  billingId: string | undefined;
  status: string | undefined;
  paidAt: string | undefined;
  amount: number | undefined;
}

/**
 * Extrai campos relevantes do payload bruto do webhook AbacatePay.
 * Formato esperado: { event, data: { billingId, status, paidAt, amount } }
 */
export function parseWebhookPayload(payload: Record<string, unknown>): WebhookPayload {
  const data = (payload.data ?? {}) as Record<string, unknown>;
  return {
    event: typeof payload.event === "string" ? payload.event : "",
    billingId: typeof data.billingId === "string" ? data.billingId : undefined,
    status: typeof data.status === "string" ? data.status : undefined,
    paidAt: typeof data.paidAt === "string" ? data.paidAt : undefined,
    amount: typeof data.amount === "number" ? data.amount : undefined,
  };
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

// Mapeamento de planos gerenciados → valores em centavos e nomes para billing.
// Fonte de verdade de preços: plan-pricing.ts (PLAN_PRICES_CENTS).
const PLAN_PRICING = {
  basic:     { amount: 9700,  name: "Básico" },    // R$97
  essencial: { amount: 19700, name: "Essencial" }, // R$197
  pro:       { amount: 44700, name: "Pro" },        // R$447
} as const;

interface RecurringBillingParams {
  customerId: string;
  planId: "basic" | "essencial" | "pro";
}

export interface RecurringBillingResult {
  billingId: string;
  url?: string;
  status: string;
}

/**
 * Cria cobrança recorrente mensal via AbacatePay para assinatura de plano.
 * frequency: "MONTHLY" — difere das cobranças one-time de créditos/recargas.
 */
export async function createPixBillingRecurring(
  params: RecurringBillingParams,
): Promise<RecurringBillingResult | { error: string }> {
  const apiKey = process.env.ABACATEPAY_API_KEY;
  if (!apiKey) {
    return { error: "Pagamentos ainda não configurados. Entre em contato com o suporte." };
  }

  const plan = PLAN_PRICING[params.planId];
  const description = `OdontoFlow ${plan.name} - Assinatura mensal`;
  const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const res = await axios.post(
      `${ABACATEPAY_BASE}/billing/create`,
      {
        customerId: params.customerId,
        amount: plan.amount,
        description,
        frequency: "MONTHLY",
        dueDate,
        metadata: {
          planId: params.planId,
          type: "subscription",
        },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    const data = (res.data as { data: { id: string; url?: string; status: string } }).data;
    return { billingId: data.id, url: data.url, status: data.status };
  } catch (err: unknown) {
    const axiosErr = err as { response?: { data?: { error?: string; message?: string } }; message?: string };
    logger.error(
      { err, planId: params.planId, customerId: params.customerId },
      "AbacatePay recurring billing creation failed",
    );
    const errorMsg = axiosErr?.response?.data?.error || axiosErr?.response?.data?.message || axiosErr?.message || "Erro ao gerar cobrança recorrente";
    return { error: errorMsg };
  }
}
