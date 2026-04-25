/**
 * Task #1 — Engenharia de contexto da geração restrita.
 *
 * Constrói o bloco [FATOS] determinístico injetado no prompt restrito a partir
 * de fontes 100% server-side (sem tocar no histórico de mensagens):
 *   - dental_leads.paymentType / professionalId  → preferência de pagamento e
 *     profissional já mapeados pelo onboarding/captura.
 *   - ai_contact_memory                           → fatos extraídos das conversas
 *     anteriores (medos, preferências, histórico médico, etc.).
 *
 * Também expõe `persistConfirmSlotSignal()` que registra um fato de "agendou
 * com X em Y" sempre que CONFIRM_SLOT é despachado pelo motor restrito.
 *
 * Contrato:
 *   - Texto retornado é compacto (≤ ~6 bullets, ≤ ~80 chars cada) e sanitizado
 *     contra prompt injection — qualquer instrução textual em ai_contact_memory
 *     é neutralizada antes de virar parte do prompt.
 *   - Falhas NUNCA quebram a resposta da IA: tudo é try/catch com logger.warn.
 */

import { db } from "@workspace/db";
import { dentalLeadsTable, aiContactMemoryTable } from "@workspace/db";
import { and, eq, desc, ne } from "drizzle-orm";
import { logger } from "./logger";
import { maskPhone } from "./pii-mask";

const MAX_MEMORIES_IN_FACTS = 4;
const MAX_FACT_CHARS = 80;

/**
 * Sanitização defensiva idêntica em espírito à de ai-learning.ts:
 * neutraliza papéis (system:/assistant:), tentativas de jailbreak e trunca
 * para evitar inflar o prompt. ai_contact_memory.content é texto livre vindo
 * de uma extração LLM — tratar como conteúdo do paciente, não como instrução.
 */
function sanitizeFactContent(text: string): string {
  return text
    .replace(/\b(system|assistant|user|SYSTEM|ASSISTANT|USER)\s*:/gi, "")
    .replace(/ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/gi, "[filtrado]")
    .replace(/you\s+(are|must|should|will)\s+now/gi, "[filtrado]")
    .replace(/new\s+(instructions?|rules?|role|persona)/gi, "[filtrado]")
    .replace(/pretend\s+(to\s+be|you\s+are)/gi, "[filtrado]")
    .replace(/act\s+as\s+(a|an|if)/gi, "[filtrado]")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, MAX_FACT_CHARS);
}

function normalizePaymentType(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.toLowerCase().trim();
  if (v.includes("conv") || v.includes("plano")) return "convenio";
  if (v.includes("part")) return "particular";
  return v.substring(0, 20);
}

export interface FactsBlockResult {
  /** Texto do bloco [FATOS] já formatado, ou null quando não há fatos. */
  text: string | null;
  /** Quantos bullets foram efetivamente renderizados (para métricas). */
  factCount: number;
}

/**
 * Carrega fatos persistidos do contato e devolve o bloco [FATOS] pronto para
 * concatenação no prompt restrito. Ordem de prioridade:
 *   1. pagamento (decisão comercial mais relevante)
 *   2. profissional preferido (curto: usa pId interno)
 *   3. memórias livres (medo / preferência / histórico_medico / interesse)
 *
 * Lookup de profissional preferido é resolvido fora desta função (passado
 * via `profIdShortByDbId`) porque o engine já tem essa tabela em memória.
 */
export async function buildFactsBlock(
  tenantId: number,
  contactPhone: string,
  profIdShortByDbId: Map<number, string>,
): Promise<FactsBlockResult> {
  if (!tenantId || !contactPhone) return { text: null, factCount: 0 };

  try {
    const [lead, memories] = await Promise.all([
      db.query.dentalLeadsTable.findFirst({
        where: and(eq(dentalLeadsTable.tenantId, tenantId), eq(dentalLeadsTable.phone, contactPhone)),
      }),
      db.query.aiContactMemoryTable.findMany({
        where: and(
          eq(aiContactMemoryTable.tenantId, tenantId),
          eq(aiContactMemoryTable.contactPhone, contactPhone),
          ne(aiContactMemoryTable.status, "rejected"),
        ),
        orderBy: [desc(aiContactMemoryTable.createdAt)],
        limit: MAX_MEMORIES_IN_FACTS * 2,
      }),
    ]);

    const bullets: string[] = [];

    const pay = normalizePaymentType(lead?.paymentType);
    if (pay) bullets.push(`pagamento: ${pay}`);

    if (lead?.professionalId != null) {
      const pIdShort = profIdShortByDbId.get(lead.professionalId);
      if (pIdShort) bullets.push(`prof preferido: ${pIdShort}`);
    }

    // Dedup case-insensitive de conteúdo, preserva tipo p/ etiqueta.
    const seen = new Set<string>();
    let memCount = 0;
    for (const m of memories) {
      if (memCount >= MAX_MEMORIES_IN_FACTS) break;
      const cleaned = sanitizeFactContent(m.editedContent || m.content || "");
      if (!cleaned) continue;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const type = (m.memoryType || "fato").substring(0, 20);
      bullets.push(`${type}: ${cleaned}`);
      memCount += 1;
    }

    if (bullets.length === 0) return { text: null, factCount: 0 };

    const text = `[FATOS] (contexto persistente — NAO repita literalmente no reply)\n${bullets
      .map((b) => `- ${b}`)
      .join("\n")}`;

    return { text, factCount: bullets.length };
  } catch (err) {
    logger.warn(
      { err, tenantId, contactPhone: maskPhone(contactPhone) },
      "constrained-facts: failed to build facts block",
    );
    return { text: null, factCount: 0 };
  }
}

/**
 * Dedup in-memory por chave (tenant|phone|date|time) com TTL curto.
 *
 * O check `existing.some(...)` no DB cobre a janela de horas/dias, mas duas
 * chamadas concorrentes (ex.: webhook duplicado, retry da Evolution API)
 * podem fazer read-then-insert ao mesmo tempo e duplicar a memória. Este
 * mutex local elimina esse caso comum (mesmo processo, mesma janela curta)
 * sem exigir mudança de schema/migration.
 *
 * O TTL é alto o suficiente p/ cobrir retries simultâneos (60s) e baixo o
 * suficiente p/ não acumular memória no processo (limpeza preguiçosa).
 */
const inflightConfirmSignals = new Map<string, number>();
const INFLIGHT_TTL_MS = 60_000;

function reserveInflight(key: string): boolean {
  const now = Date.now();
  // Limpeza preguiçosa: se a tabela passou de 200 entradas, varre uma vez.
  if (inflightConfirmSignals.size > 200) {
    for (const [k, exp] of inflightConfirmSignals) {
      if (exp <= now) inflightConfirmSignals.delete(k);
    }
  }
  const existing = inflightConfirmSignals.get(key);
  if (existing && existing > now) return false;
  inflightConfirmSignals.set(key, now + INFLIGHT_TTL_MS);
  return true;
}

/**
 * Persiste um sinal de "agendou com X em Y" no `ai_contact_memory` quando o
 * motor restrito despacha CONFIRM_SLOT. Fire-and-forget: NUNCA throw.
 *
 * Dedup em duas camadas:
 *   1. In-memory mutex (tenant|phone|date|time) com TTL de 60s — protege
 *      contra retries simultâneos no MESMO processo.
 *   2. find-then-insert no DB — protege contra reentradas em janelas longas
 *      (post-restart, distribuição cross-process).
 */
export async function persistConfirmSlotSignal(args: {
  tenantId: number;
  contactPhone: string;
  conversationId: number;
  professionalName: string | null;
  date: string;
  time: string;
}): Promise<void> {
  const { tenantId, contactPhone, conversationId, professionalName, date, time } = args;
  if (!tenantId || !contactPhone || !date) return;

  // Camada 1: in-memory dedup. Se outra task já está inserindo este sinal,
  // simplesmente retorna sem tocar no DB.
  const inflightKey = `${tenantId}|${contactPhone}|${date}|${time}`;
  if (!reserveInflight(inflightKey)) return;

  try {
    const [y, m, d] = date.split("-");
    const dateBR = `${d}/${m}/${y.slice(2)}`;
    const profPart = professionalName ? ` com ${professionalName.substring(0, 60)}` : "";
    const content = `agendou${profPart} em ${dateBR} ${time}`;

    const existing = await db.query.aiContactMemoryTable.findMany({
      where: and(
        eq(aiContactMemoryTable.tenantId, tenantId),
        eq(aiContactMemoryTable.contactPhone, contactPhone),
        eq(aiContactMemoryTable.memoryType, "agendamento"),
      ),
      orderBy: [desc(aiContactMemoryTable.createdAt)],
      limit: 5,
    });
    if (existing.some((e) => (e.content || "").toLowerCase() === content.toLowerCase())) {
      return;
    }

    await db.insert(aiContactMemoryTable).values({
      tenantId,
      contactPhone,
      memoryType: "agendamento",
      content,
      source: "auto",
      conversationId,
    });

    logger.info(
      { tenantId, contactPhone: maskPhone(contactPhone), conversationId },
      "constrained-facts: persisted CONFIRM_SLOT signal",
    );
  } catch (err) {
    logger.warn(
      { err, tenantId, contactPhone: maskPhone(contactPhone), conversationId },
      "constrained-facts: failed to persist CONFIRM_SLOT signal",
    );
  }
}
