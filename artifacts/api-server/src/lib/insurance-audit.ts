/**
 * Task #12 — Auditoria periódica de termos de venda em conversas reais de
 * convênio.
 *
 * O prompt já bloqueia SPIN/escassez/urgência para leads marcados como
 * `paymentType="insurance"`. Este módulo é a rede de segurança final: varre
 * as RESPOSTAS reais que a IA enviou (dental_messages outbound) para esses
 * leads e sinaliza qualquer ocorrência dos termos proibidos. Usado tanto
 * por um endpoint admin (relatório sob demanda) quanto por um job diário
 * que dispara alerta para o dono da clínica via Telegram quando a taxa
 * de violações ultrapassa um limiar configurável.
 */

import { db } from "@workspace/db";
import {
  dentalMessagesTable,
  dentalSettingsTable,
  tenantsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import { maskPhone } from "./pii-mask";
import { escapeHtml } from "./telegram";

/**
 * Termos de venda PROIBIDOS em conversas com pacientes de convênio.
 *
 * Cobre: SPIN/escassez/urgência/ancoragem e as frases-marca explicitamente
 * citadas na blindagem do prompt (Task #11). A lista é mantida pequena e
 * orientada a frases inteiras para minimizar falsos positivos — verbos
 * isolados como "garantir" não entram (são genéricos).
 */
export const FORBIDDEN_INSURANCE_TERMS: readonly string[] = [
  "consegui um encaixe",
  "agenda disputada",
  "agenda ta disputada",
  "agenda está disputada",
  "são os últimos",
  "sao os ultimos",
  "esses foram os últimos",
  "esses foram os ultimos",
  "esses foram os que sobraram",
  "ultimo horario",
  "último horário",
  "última vaga",
  "ultima vaga",
  "últimas vagas",
  "ultimas vagas",
  "restam apenas",
  "vagas limitadas",
  "melhor garantir agora",
  "melhor garantir logo",
  "garante agora",
  "fila de espera",
  "reserva temporária",
  "reserva temporaria",
  "urgência",
  "urgencia",
  "escassez",
  "vai escapar",
  "perde a vaga",
  "vai perder a vaga",
  "outra pessoa pega",
  "outra pessoa vai pegar",
  "ancoragem",
  "spin selling",
  // Task #23 — gatilhos mentais comuns proibidos em CONVENIO_AGENDAR
  "oportunidade",
  "não perca",
  "nao perca",
  "aproveite",
  "corre que vai",
  "garanta já",
  "garanta ja",
  "encaixe especial",
];

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Dedup por forma normalizada — "urgência" e "urgencia" colapsam para o
// primeiro raw cadastrado. Evita reportar dois termos diferentes para o
// mesmo trecho de texto.
const NORMALIZED_TERMS: ReadonlyArray<{ raw: string; norm: string }> = (() => {
  const seen = new Set<string>();
  const out: Array<{ raw: string; norm: string }> = [];
  for (const t of FORBIDDEN_INSURANCE_TERMS) {
    const norm = normalize(t);
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push({ raw: t, norm });
  }
  return out;
})();

/**
 * Devolve a lista de termos proibidos encontrados no texto.
 * A comparação é feita em forma normalizada (sem acentos/case) para
 * capturar variações ortográficas comuns ("urgencia" e "urgência").
 * Termos duplicados são deduplicados na saída (preservando o termo cru
 * canônico cadastrado em `FORBIDDEN_INSURANCE_TERMS`).
 */
export function findForbiddenTerms(text: string | null | undefined): string[] {
  if (!text) return [];
  const norm = normalize(text);
  const found = new Set<string>();
  for (const { raw, norm: termNorm } of NORMALIZED_TERMS) {
    if (norm.includes(termNorm)) found.add(raw);
  }
  return Array.from(found);
}

export interface InsuranceMessageViolation {
  messageId: number;
  conversationId: number;
  leadId: number | null;
  contactPhoneMasked: string;
  terms: string[];
  contentPreview: string;
  sentAt: Date;
}

export interface InsuranceTenantAuditResult {
  tenantId: number;
  totalMessages: number;
  violationCount: number;
  violationRate: number;
  violations: InsuranceMessageViolation[];
}

export interface AuditOptions {
  tenantId?: number;
  /** Janela de tempo em dias (default: 7). */
  sinceDays?: number;
  /** Limite máximo de mensagens a varrer por tenant (default: 5000). */
  perTenantLimit?: number;
}

/**
 * Varre as mensagens OUTBOUND geradas pela IA (marcadas com
 * `external_id LIKE 'ai:%'`) enviadas a leads com `payment_type =
 * 'insurance'` e devolve as violações encontradas.
 *
 * Mensagens enviadas manualmente do painel pelo dono da clínica NÃO entram
 * na auditoria — elas não recebem o marcador `ai:` no insert. O limite é
 * aplicado por tenant via `ROW_NUMBER() OVER (PARTITION BY tenant_id)`,
 * de modo que tenants menos ativos sempre tenham sua janela completa.
 */
export async function auditInsuranceMessages(
  opts: AuditOptions = {},
): Promise<InsuranceTenantAuditResult[]> {
  const sinceDays = opts.sinceDays ?? 7;
  const perTenantLimit = opts.perTenantLimit ?? 5000;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const tenantClause =
    typeof opts.tenantId === "number"
      ? sql`AND m.tenant_id = ${opts.tenantId}`
      : sql``;

  const result = await db.execute<{
    tenant_id: number;
    message_id: number;
    conversation_id: number;
    lead_id: number | null;
    contact_phone: string;
    content: string | null;
    sent_at: Date;
  }>(sql`
    SELECT * FROM (
      SELECT
        m.tenant_id,
        m.id            AS message_id,
        m.conversation_id,
        c.lead_id,
        c.contact_phone,
        m.content,
        m.sent_at,
        ROW_NUMBER() OVER (
          PARTITION BY m.tenant_id ORDER BY m.sent_at DESC
        ) AS rn
      FROM dental_messages m
      INNER JOIN dental_conversations c ON c.id = m.conversation_id
      INNER JOIN dental_leads l         ON l.id = c.lead_id
      WHERE m.direction = 'outbound'
        AND m.external_id LIKE 'ai:%'
        AND l.payment_type = 'insurance'
        AND m.sent_at >= ${since.toISOString()}
        ${tenantClause}
    ) ranked
    WHERE rn <= ${perTenantLimit}
  `);

  const perTenant = new Map<number, InsuranceTenantAuditResult>();
  for (const raw of result.rows) {
    const row = {
      tenantId: Number(raw.tenant_id),
      messageId: Number(raw.message_id),
      conversationId: Number(raw.conversation_id),
      leadId: raw.lead_id != null ? Number(raw.lead_id) : null,
      contactPhone: raw.contact_phone,
      content: raw.content,
      sentAt:
        raw.sent_at instanceof Date ? raw.sent_at : new Date(raw.sent_at as unknown as string),
    };
    let bucket = perTenant.get(row.tenantId);
    if (!bucket) {
      bucket = {
        tenantId: row.tenantId,
        totalMessages: 0,
        violationCount: 0,
        violationRate: 0,
        violations: [],
      };
      perTenant.set(row.tenantId, bucket);
    }
    bucket.totalMessages += 1;
    const terms = findForbiddenTerms(row.content);
    if (terms.length > 0) {
      bucket.violationCount += 1;
      bucket.violations.push({
        messageId: row.messageId,
        conversationId: row.conversationId,
        leadId: row.leadId ?? null,
        contactPhoneMasked: maskPhone(row.contactPhone),
        terms,
        contentPreview: (row.content ?? "").slice(0, 240),
        sentAt: row.sentAt,
      });
    }
  }
  for (const bucket of perTenant.values()) {
    bucket.violationRate =
      bucket.totalMessages === 0
        ? 0
        : bucket.violationCount / bucket.totalMessages;
  }
  return Array.from(perTenant.values()).sort(
    (a, b) => b.violationRate - a.violationRate,
  );
}

function defaultThreshold(): number {
  const raw = process.env.INSURANCE_AUDIT_THRESHOLD;
  if (!raw) return 0.05;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.05;
}

function defaultMinMessages(): number {
  const raw = process.env.INSURANCE_AUDIT_MIN_MESSAGES;
  if (!raw) return 5;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 5;
}

function buildAlertMessage(
  result: InsuranceTenantAuditResult,
  clinicName: string | null,
  thresholdPct: number,
  windowDays: number,
): string {
  // Todo conteúdo dinâmico passa por escapeHtml — clinicName, terms e
  // contentPreview podem conter <, >, & ou aspas que quebrariam o parse
  // HTML do Telegram e fariam a mensagem ser rejeitada silenciosamente.
  const head = clinicName ? `🏥 <b>${escapeHtml(clinicName)}</b>\n\n` : "";
  const ratePct = (result.violationRate * 100).toFixed(1);
  const sample = result.violations
    .slice(0, 3)
    .map((v, i) => {
      const termList = escapeHtml(v.terms.join(", "));
      const preview = escapeHtml(v.contentPreview.replace(/\n+/g, " "));
      const phone = escapeHtml(v.contactPhoneMasked);
      return `${i + 1}. (${phone}) [${termList}]\n   "${preview}"`;
    })
    .join("\n\n");
  return (
    `⚠️ <b>Auditoria de convênio — termos de venda detectados</b>\n\n` +
    head +
    `Janela: últimos ${windowDays} dia(s)\n` +
    `Mensagens analisadas: ${result.totalMessages}\n` +
    `Violações: ${result.violationCount} (${ratePct}%)\n` +
    `Limite configurado: ${thresholdPct.toFixed(1)}%\n\n` +
    `A IA enviou termos proibidos (escassez/urgência/SPIN) para pacientes ` +
    `marcados como CONVÊNIO. Revise as conversas no painel.\n\n` +
    `<b>Exemplos:</b>\n${sample || "(sem amostras)"}`
  );
}

export interface AuditJobOptions {
  /** Threshold (0..1) acima do qual o alerta é disparado. */
  threshold?: number;
  /** Mínimo de mensagens analisadas antes de disparar alerta. */
  minMessages?: number;
  /** Janela em dias para o relatório do job (default: 1). */
  sinceDays?: number;
  /** Permite restringir a um único tenant (testes/CLI). */
  tenantId?: number;
}

export interface AuditJobResult {
  tenantId: number;
  totalMessages: number;
  violationCount: number;
  violationRate: number;
  alerted: boolean;
  alertSkippedReason?: string;
}

/**
 * Job diário: roda a auditoria por tenant na janela configurada e dispara
 * alerta via Telegram para a clínica quando a taxa supera o limiar.
 * Sem efeito se a clínica não tem Telegram configurado (apenas log).
 */
export async function runInsuranceAuditJob(
  opts: AuditJobOptions = {},
): Promise<AuditJobResult[]> {
  const threshold = opts.threshold ?? defaultThreshold();
  const minMessages = opts.minMessages ?? defaultMinMessages();
  const sinceDays = opts.sinceDays ?? 1;

  const results = await auditInsuranceMessages({
    tenantId: opts.tenantId,
    sinceDays,
  });

  const out: AuditJobResult[] = [];
  for (const result of results) {
    const base: AuditJobResult = {
      tenantId: result.tenantId,
      totalMessages: result.totalMessages,
      violationCount: result.violationCount,
      violationRate: result.violationRate,
      alerted: false,
    };

    if (result.totalMessages < minMessages) {
      base.alertSkippedReason = `below_min_messages(${minMessages})`;
      out.push(base);
      continue;
    }
    if (result.violationRate < threshold) {
      base.alertSkippedReason = "below_threshold";
      out.push(base);
      continue;
    }

    try {
      const settings = await db.query.dentalSettingsTable.findFirst({
        where: eq(dentalSettingsTable.tenantId, result.tenantId),
      });
      if (
        !settings?.telegramBotToken ||
        !settings?.telegramChatId ||
        !settings?.telegramEscalationEnabled
      ) {
        base.alertSkippedReason = "telegram_not_configured";
        logger.warn(
          {
            tenantId: result.tenantId,
            violationRate: result.violationRate,
            violationCount: result.violationCount,
          },
          "Insurance audit threshold exceeded but Telegram not configured",
        );
        out.push(base);
        continue;
      }

      const tenant = await db.query.tenantsTable.findFirst({
        where: eq(tenantsTable.id, result.tenantId),
      });
      const clinicName = settings.clinicName || tenant?.name || null;

      const message = buildAlertMessage(
        result,
        clinicName,
        threshold * 100,
        sinceDays,
      );

      const { sendTelegramMessage } = await import("./telegram");
      const sendResult = await sendTelegramMessage(
        settings.telegramBotToken,
        settings.telegramChatId,
        message,
      );
      if (sendResult.ok) {
        base.alerted = true;
        logger.info(
          {
            tenantId: result.tenantId,
            violationRate: result.violationRate,
            violationCount: result.violationCount,
          },
          "Insurance audit alert sent",
        );
      } else {
        base.alertSkippedReason = `telegram_error:${sendResult.error ?? "unknown"}`;
        logger.warn(
          { tenantId: result.tenantId, error: sendResult.error },
          "Insurance audit alert failed to send",
        );
      }
    } catch (err) {
      base.alertSkippedReason = `error:${err instanceof Error ? err.message : "unknown"}`;
      logger.error(
        { err, tenantId: result.tenantId },
        "Insurance audit job failed for tenant",
      );
    }
    out.push(base);
  }
  return out;
}

// ─── Helper para o relatório admin (formato amigável) ─────────────────────────

export interface AuditReportRow {
  tenantId: number;
  clinicName: string | null;
  totalMessages: number;
  violationCount: number;
  violationRate: number;
  topTerms: Array<{ term: string; count: number }>;
}

export async function buildAuditReport(
  opts: AuditOptions = {},
): Promise<{
  windowDays: number;
  generatedAt: string;
  rows: AuditReportRow[];
  details: InsuranceTenantAuditResult[];
}> {
  const sinceDays = opts.sinceDays ?? 7;
  const details = await auditInsuranceMessages({ ...opts, sinceDays });
  if (details.length === 0) {
    return { windowDays: sinceDays, generatedAt: new Date().toISOString(), rows: [], details };
  }

  const tenantIds = details.map((d) => d.tenantId);
  const settingsRows = await db
    .select({ tenantId: dentalSettingsTable.tenantId, clinicName: dentalSettingsTable.clinicName })
    .from(dentalSettingsTable)
    .where(sql`${dentalSettingsTable.tenantId} = ANY(${tenantIds})`);
  const tenantRows = await db
    .select({ id: tenantsTable.id, name: tenantsTable.name })
    .from(tenantsTable)
    .where(sql`${tenantsTable.id} = ANY(${tenantIds})`);
  const nameByTenant = new Map<number, string | null>();
  for (const t of tenantRows) nameByTenant.set(t.id, t.name);
  for (const s of settingsRows) {
    if (s.clinicName) nameByTenant.set(s.tenantId, s.clinicName);
  }

  const rows: AuditReportRow[] = details.map((d) => {
    const counts = new Map<string, number>();
    for (const v of d.violations) {
      for (const term of v.terms) {
        counts.set(term, (counts.get(term) ?? 0) + 1);
      }
    }
    const topTerms = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([term, count]) => ({ term, count }));
    return {
      tenantId: d.tenantId,
      clinicName: nameByTenant.get(d.tenantId) ?? null,
      totalMessages: d.totalMessages,
      violationCount: d.violationCount,
      violationRate: d.violationRate,
      topTerms,
    };
  });

  return {
    windowDays: sinceDays,
    generatedAt: new Date().toISOString(),
    rows,
    details,
  };
}
