import axios from "axios";
import { logger } from "./logger";
import { decryptIfNeeded } from "./encryption";

const VAPI_BASE = "https://api.vapi.ai";

export interface VapiCallOptions {
  phoneNumberId: string;
  phone: string;
  assistantId?: string;
  assistantOverrides?: {
    firstMessage?: string;
    model?: {
      provider: string;
      model: string;
      messages?: { role: string; content: string }[];
    };
    voice?: {
      provider: string;
      voiceId: string;
      language?: string;
    };
  };
  metadata?: Record<string, string>;
}

export interface VapiCallResponse {
  id: string;
  status: string;
  phoneNumberId: string;
  customer: { number: string };
  createdAt: string;
}

export function resolveVapiKey(tenantKey: string | null | undefined): string | null {
  const resolved = tenantKey || process.env.VAPI_API_KEY || null;
  return resolved ? (decryptIfNeeded(resolved) ?? resolved) : null;
}

export async function initiateOutboundCall(
  apiKey: string,
  options: VapiCallOptions
): Promise<VapiCallResponse> {
  const body: Record<string, unknown> = {
    phoneNumberId: options.phoneNumberId,
    customer: { number: options.phone },
  };

  if (options.assistantId) {
    body.assistantId = options.assistantId;
  }

  if (options.assistantOverrides) {
    body.assistantOverrides = options.assistantOverrides;
  }

  if (options.metadata) {
    body.metadata = options.metadata;
  }

  const response = await axios.post(`${VAPI_BASE}/call`, body, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    timeout: 15000,
  });

  return response.data as VapiCallResponse;
}

export async function getCallStatus(apiKey: string, callId: string): Promise<Record<string, unknown>> {
  const response = await axios.get(`${VAPI_BASE}/call/${callId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout: 10000,
  });
  return response.data as Record<string, unknown>;
}

export async function listPhoneNumbers(apiKey: string): Promise<{ id: string; number: string; name: string }[]> {
  const response = await axios.get(`${VAPI_BASE}/phone-number`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout: 10000,
  });
  const data = response.data as { id: string; number: string; name: string }[];
  return Array.isArray(data) ? data : [];
}

export async function listAssistants(apiKey: string): Promise<{ id: string; name: string }[]> {
  const response = await axios.get(`${VAPI_BASE}/assistant`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout: 10000,
  });
  const data = response.data as { id: string; name: string }[];
  return Array.isArray(data) ? data : [];
}

export function buildDentalAssistantOverrides(params: {
  clinicName: string;
  aiName: string;
  patientName?: string;
  trigger: string;
  appointmentDate?: string;
  procedure?: string;
  voiceId?: string | null;
}): VapiCallOptions["assistantOverrides"] {
  const { clinicName, aiName, patientName, trigger, appointmentDate, procedure, voiceId } = params;

  const greetingName = patientName ? `, ${patientName}` : "";

  const triggerMessages: Record<string, { firstMessage: string; systemPrompt: string }> = {
    hot_lead_followup: {
      firstMessage: `Olá${greetingName}! Aqui é ${aiName} da ${clinicName}. Vi que você entrou em contato com a gente pelo WhatsApp mas ainda não conseguimos agendar sua consulta. Posso te ajudar agora?`,
      systemPrompt: `Você é ${aiName}, secretária virtual da ${clinicName}. O paciente entrou em contato pelo WhatsApp mas não agendou. Seu objetivo é converter esse contato em um agendamento. Seja simpática, objetiva e profissional. Ao final da conversa, tente agendar ou redirecionar para o WhatsApp para confirmar o horário.`,
    },
    appointment_confirmation: {
      firstMessage: `Olá${greetingName}! Aqui é ${aiName} da ${clinicName}. Estou ligando para confirmar sua consulta${appointmentDate ? ` amanhã, ${appointmentDate}` : ""}${procedure ? ` para ${procedure}` : ""}. Você confirma presença?`,
      systemPrompt: `Você é ${aiName}, secretária virtual da ${clinicName}. Ligue para confirmar a consulta do paciente. Se confirmar, agradeça e informe sobre preparativos se necessário. Se não puder comparecer, ofereça remarcação.`,
    },
    patient_recovery: {
      firstMessage: `Olá${greetingName}! Aqui é ${aiName} da ${clinicName}. Notei que faz um tempo que você não nos visita e quero saber como você está. Posso ajudar a agendar um retorno?`,
      systemPrompt: `Você é ${aiName}, secretária virtual da ${clinicName}. O paciente está inativo há algum tempo. Seja calorosa e empática. Ofereça agendamento de retorno ou avaliação.`,
    },
  };

  const config = triggerMessages[trigger] || triggerMessages.hot_lead_followup;

  const overrides: NonNullable<VapiCallOptions["assistantOverrides"]> = {
    firstMessage: config.firstMessage,
    model: {
      provider: "openai",
      model: "gpt-5.4-nano",
      messages: [
        {
          role: "system",
          content: config.systemPrompt + "\n\nIMPORTANTE: Fale em português do Brasil, de forma natural e humana. Mantenha respostas curtas como em uma ligação real. Não mencione que é uma IA a não ser que perguntado diretamente.",
        },
      ],
    },
  };

  if (voiceId) {
    overrides.voice = { provider: "cartesia", voiceId, language: "pt" } as VapiCallOptions["assistantOverrides"]["voice"];
  }

  return overrides;
}

/**
 * Build the full assistant config Vapi expects in response to an
 * `assistant-request` webhook (inbound call). Includes Cartesia PT-BR voice.
 */
export function buildInboundAssistantConfig(params: {
  clinicName: string;
  aiName: string;
  voiceId: string;
  customGreeting?: string | null;
}): Record<string, unknown> {
  const { clinicName, aiName, voiceId, customGreeting } = params;
  const firstMessage =
    customGreeting?.trim() ||
    `Olá! Aqui é ${aiName} da ${clinicName}. Em que posso te ajudar hoje?`;

  return {
    name: `${clinicName} - Inbound`,
    firstMessage,
    firstMessageMode: "assistant-speaks-first",
    voice: { provider: "cartesia", voiceId, language: "pt" },
    transcriber: { provider: "deepgram", model: "nova-2", language: "pt-BR" },
    model: {
      provider: "openai",
      model: "gpt-5.4-nano",
      messages: [
        {
          role: "system",
          content:
            `Você é ${aiName}, secretária virtual da clínica ${clinicName}. ` +
            `O paciente está LIGANDO para a clínica agora. Atenda em português do Brasil, ` +
            `de forma calorosa, profissional e objetiva, como uma recepcionista real. ` +
            `Anote o motivo da ligação, identifique se é paciente novo ou já cadastrado, ` +
            `e ofereça agendamento, informações sobre horários, endereço, valores e procedimentos. ` +
            `Mantenha as respostas curtas como em uma ligação real. Não mencione que é uma IA a não ser ` +
            `que perguntado diretamente. Se a pessoa precisar de algo que você não pode resolver, ` +
            `informe que a clínica entrará em contato pelo WhatsApp em seguida.`,
        },
      ],
    },
    recordingEnabled: true,
    endCallMessage: "Obrigada pela ligação! Tenha um ótimo dia. Tchau, tchau!",
    silenceTimeoutSeconds: 25,
    maxDurationSeconds: 600,
  };
}

export interface VapiWebhookPayload {
  message: {
    type: string;
    call?: {
      id: string;
      type?: string;
      status?: string;
      phoneNumberId?: string;
      customer?: { number?: string };
      startedAt?: string;
      endedAt?: string;
      endedReason?: string;
      duration?: number;
      cost?: number;
      metadata?: Record<string, string>;
    };
    phoneNumber?: { id?: string; number?: string };
    customer?: { number?: string };
    transcript?: string;
    summary?: string;
    recordingUrl?: string;
    artifact?: {
      transcript?: string;
      summary?: string;
      recordingUrl?: string;
    };
  };
}

export function parseVapiWebhook(body: VapiWebhookPayload) {
  const { message } = body;
  const call = message?.call;
  const artifact = message?.artifact;

  const phoneNumberId = call?.phoneNumberId || message?.phoneNumber?.id;
  const phone = call?.customer?.number || message?.customer?.number;
  const callType = call?.type;
  const isInbound = callType === "inboundPhoneCall" || callType === "inbound";

  return {
    type: message?.type,
    callId: call?.id,
    callType,
    isInbound,
    phoneNumberId,
    status: call?.status,
    phone,
    startedAt: call?.startedAt ? new Date(call.startedAt) : undefined,
    endedAt: call?.endedAt ? new Date(call.endedAt) : undefined,
    endedReason: call?.endedReason,
    duration: call?.duration,
    cost: call?.cost?.toString(),
    transcript: artifact?.transcript || message?.transcript,
    summary: artifact?.summary || message?.summary,
    recordingUrl: artifact?.recordingUrl || message?.recordingUrl,
    metadata: call?.metadata,
  };
}

/**
 * Normalize a phone number to digits-only for lookup. Strips +, spaces,
 * parens and dashes.
 */
export function normalizeCallerPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return phone.replace(/\D/g, "");
}
