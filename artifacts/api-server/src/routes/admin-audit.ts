/**
 * Task #15 — Admin auditoria (uso interno OdontoFlow).
 *
 * Endpoints:
 *  GET /audit/conversations               — lista paginada de conversas
 *  GET /audit/conversations/:id           — mensagens + integridade da cadeia
 *  GET /audit/conversations/:id/pdf       — PDF assinado da conversa
 *  GET /audit/tos                         — auditoria de aceites de termo
 */

import { Router, Request, Response } from "express";
import PDFDocument from "pdfkit";
import { db } from "@workspace/db";
import {
  dentalConversationsTable,
  dentalMessagesTable,
  dentalLeadsTable,
  patientsTable,
  tenantsTable,
  dentalSettingsTable,
  tosAcceptancesTable,
  tosVersionsTable,
  aiResponseAuditTable,
} from "@workspace/db";
import { and, desc, eq, sql, asc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { verifyConversationIntegrity, signPayload } from "../lib/audit-chain";
import { maskPhone } from "../lib/pii-mask";

const router = Router();

// ─── List conversations (with optional tenant filter) ───────────────────────
router.get("/audit/conversations", async (req: Request, res: Response) => {
  const tenantIdParam = req.query.tenantId ? Number(req.query.tenantId) : undefined;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;

  const where = tenantIdParam ? eq(dentalConversationsTable.tenantId, tenantIdParam) : undefined;

  const rows = await db
    .select({
      id: dentalConversationsTable.id,
      tenantId: dentalConversationsTable.tenantId,
      contactName: dentalConversationsTable.contactName,
      contactPhone: dentalConversationsTable.contactPhone,
      lastMessageAt: dentalConversationsTable.lastMessageAt,
      status: dentalConversationsTable.status,
      messageCount: sql<number>`(SELECT COUNT(*) FROM dental_messages m WHERE m.conversation_id = ${dentalConversationsTable.id})`,
    })
    .from(dentalConversationsTable)
    .where(where ?? sql`true`)
    .orderBy(desc(dentalConversationsTable.lastMessageAt))
    .limit(limit)
    .offset(offset);

  res.json({
    conversations: rows.map((r) => ({
      ...r,
      contactPhone: maskPhone(r.contactPhone),
    })),
    pagination: { limit, offset, count: rows.length },
  });
});

// ─── View conversation chain integrity ──────────────────────────────────────
router.get("/audit/conversations/:id", async (req: Request, res: Response) => {
  const conversationId = Number(req.params.id);
  if (!Number.isFinite(conversationId)) {
    res.status(400).json({ error: "Invalid conversation id" });
    return;
  }

  const conv = await db.query.dentalConversationsTable.findFirst({
    where: eq(dentalConversationsTable.id, conversationId),
  });
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const messages = await db.query.dentalMessagesTable.findMany({
    where: eq(dentalMessagesTable.conversationId, conversationId),
    orderBy: [asc(dentalMessagesTable.id)],
  });

  const integrity = await verifyConversationIntegrity(conversationId);

  const tenant = await db.query.tenantsTable.findFirst({
    where: eq(tenantsTable.id, conv.tenantId),
  });
  const settings = await db.query.dentalSettingsTable.findFirst({
    where: eq(dentalSettingsTable.tenantId, conv.tenantId),
  });

  res.json({
    conversation: {
      id: conv.id,
      tenantId: conv.tenantId,
      tenantName: tenant?.name ?? null,
      clinicName: settings?.clinicName ?? null,
      contactName: conv.contactName,
      contactPhone: maskPhone(conv.contactPhone),
      status: conv.status,
      lastMessageAt: conv.lastMessageAt,
    },
    integrity,
    messages: messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      type: m.type,
      content: m.content,
      sentAt: m.sentAt,
      serverTs: m.serverTs,
      hash: m.hash,
      prevHash: m.prevHash,
      aiModel: m.aiModel,
      promptVersion: m.promptVersion,
      externalId: m.externalId,
    })),
  });
});

// ─── Signed PDF export of full conversation ─────────────────────────────────
router.get("/audit/conversations/:id/pdf", async (req: Request, res: Response) => {
  const conversationId = Number(req.params.id);
  if (!Number.isFinite(conversationId)) {
    res.status(400).json({ error: "Invalid conversation id" });
    return;
  }

  const conv = await db.query.dentalConversationsTable.findFirst({
    where: eq(dentalConversationsTable.id, conversationId),
  });
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const messages = await db.query.dentalMessagesTable.findMany({
    where: eq(dentalMessagesTable.conversationId, conversationId),
    orderBy: [asc(dentalMessagesTable.id)],
  });

  const integrity = await verifyConversationIntegrity(conversationId);

  const tenant = await db.query.tenantsTable.findFirst({
    where: eq(tenantsTable.id, conv.tenantId),
  });
  const settings = await db.query.dentalSettingsTable.findFirst({
    where: eq(dentalSettingsTable.tenantId, conv.tenantId),
  });

  // Lead/patient lookup
  let contactDescriptor = conv.contactName ?? "(sem nome)";
  if (conv.leadId) {
    const lead = await db.query.dentalLeadsTable.findFirst({ where: eq(dentalLeadsTable.id, conv.leadId) });
    if (lead) contactDescriptor = `Lead: ${lead.name}`;
  } else if (conv.patientId) {
    const pat = await db.query.patientsTable.findFirst({ where: eq(patientsTable.id, conv.patientId) });
    if (pat) contactDescriptor = `Paciente: ${pat.name}`;
  }

  // Build the canonical body string we'll sign
  const bodyLines: string[] = [];
  for (const m of messages) {
    bodyLines.push(
      `[${m.id}|${(m.serverTs ?? m.sentAt).toISOString()}|${m.direction}|${m.type}] ${(m.content ?? "").replace(/\s+/g, " ").slice(0, 4000)}`,
    );
  }
  const canonicalBody = bodyLines.join("\n");
  const finalHash = integrity.finalHash ?? "(cadeia ausente)";
  const signature = signPayload(`${conv.tenantId}|${conv.id}|${finalHash}|${canonicalBody}`);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="conversa-${conv.tenantId}-${conv.id}.pdf"`,
  );

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  doc.pipe(res);

  // Header
  doc.fontSize(16).font("Helvetica-Bold").text("OdontoFlow — Trilha de Auditoria", { align: "center" });
  doc.moveDown(0.3);
  doc.fontSize(10).font("Helvetica").text("Documento gerado automaticamente para fins probatórios", { align: "center" });
  doc.moveDown(1);

  // Tenant block
  doc.fontSize(11).font("Helvetica-Bold").text("Clínica");
  doc.font("Helvetica").fontSize(10);
  doc.text(`Nome: ${settings?.clinicName ?? tenant?.name ?? "(não informado)"}`);
  doc.text(`Tenant ID: ${conv.tenantId}`);
  doc.text(`E-mail: ${tenant?.email ?? "(não informado)"}`);
  doc.text(`CRO: ${tenant?.cro ?? "(não informado)"}`);
  doc.moveDown(0.7);

  doc.fontSize(11).font("Helvetica-Bold").text("Conversa");
  doc.font("Helvetica").fontSize(10);
  doc.text(`ID: #${conv.id}`);
  doc.text(`Contato: ${contactDescriptor}`);
  doc.text(`Telefone: ${maskPhone(conv.contactPhone)}`);
  doc.text(`Status: ${conv.status}`);
  doc.text(`Última mensagem: ${conv.lastMessageAt?.toISOString() ?? "—"}`);
  doc.moveDown(0.7);

  // Integrity block
  doc.fontSize(11).font("Helvetica-Bold").text("Integridade da Cadeia");
  doc.font("Helvetica").fontSize(10);
  doc.fillColor(integrity.intact ? "#0a7d2e" : "#b30000");
  doc.text(`Status: ${integrity.intact ? "ÍNTEGRA" : "ADULTERADA"}`);
  doc.fillColor("#000000");
  doc.text(`Total de mensagens: ${integrity.totalMessages}`);
  doc.text(`Mensagens legacy (sem hash): ${integrity.legacyMessages}`);
  if (!integrity.intact) {
    doc.text(`Quebra detectada na mensagem #${integrity.brokenAtMessageId}`);
    doc.text(`Motivo: ${integrity.brokenReason ?? "(não especificado)"}`);
  }
  doc.text(`Hash final: ${integrity.finalHash ?? "(nenhum)"}`, { width: 500 });
  doc.moveDown(1);

  // Transcript
  doc.fontSize(12).font("Helvetica-Bold").text("Transcrição completa");
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(9);
  for (const m of messages) {
    const ts = (m.serverTs ?? m.sentAt).toISOString();
    const who = m.direction === "outbound" ? "IA (clínica)" : "Paciente/Lead";
    doc.font("Helvetica-Bold").fontSize(9).text(`[#${m.id}] ${ts} — ${who} (${m.type})`);
    doc.font("Helvetica").fontSize(9).text(m.content ?? "(sem conteúdo)", { width: 500 });
    if (m.hash) {
      doc.fillColor("#666666").fontSize(7).text(`hash: ${m.hash}`, { width: 500 });
      doc.fillColor("#000000").fontSize(9);
    }
    doc.moveDown(0.4);
  }

  // Footer signature block
  doc.addPage();
  doc.fontSize(11).font("Helvetica-Bold").text("Assinatura digital do sistema");
  doc.font("Helvetica").fontSize(9);
  doc.moveDown(0.3);
  doc.text(
    "A assinatura abaixo é gerada via HMAC-SHA-256 sobre os campos canônicos do documento " +
      "(tenant ID, conversa, hash final da cadeia, conteúdo) usando a chave privada do servidor " +
      "OdontoFlow. Qualquer alteração posterior ao texto invalida a assinatura.",
    { width: 500 },
  );
  doc.moveDown(0.5);
  doc.font("Courier").fontSize(8).text(`HASH FINAL: ${finalHash}`, { width: 500 });
  doc.text(`SIGNATURE  : ${signature}`, { width: 500 });
  doc.text(`GERADO EM  : ${new Date().toISOString()}`, { width: 500 });
  doc.moveDown(0.5);
  doc.font("Helvetica").fontSize(8).fillColor("#666666");
  doc.text(
    "Para validar a integridade desta exportação, recompute o HMAC sobre os campos do " +
      "documento usando a chave do servidor e compare com a assinatura acima.",
    { width: 500 },
  );

  doc.end();
});

// ─── TOS acceptance audit ───────────────────────────────────────────────────
router.get("/audit/tos", async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      acceptanceId: tosAcceptancesTable.id,
      tenantId: tosAcceptancesTable.tenantId,
      tenantName: tenantsTable.name,
      tenantEmail: tenantsTable.email,
      kind: tosAcceptancesTable.kind,
      versionLabel: tosAcceptancesTable.versionLabel,
      acceptedAt: tosAcceptancesTable.acceptedAt,
      ipAddress: tosAcceptancesTable.ipAddress,
      userAgent: tosAcceptancesTable.userAgent,
      tosVersionId: tosAcceptancesTable.tosVersionId,
      tosTitle: tosVersionsTable.title,
    })
    .from(tosAcceptancesTable)
    .leftJoin(tenantsTable, eq(tenantsTable.id, tosAcceptancesTable.tenantId))
    .leftJoin(tosVersionsTable, eq(tosVersionsTable.id, tosAcceptancesTable.tosVersionId))
    .orderBy(desc(tosAcceptancesTable.acceptedAt))
    .limit(500);

  const versions = await db.query.tosVersionsTable.findMany({
    orderBy: [desc(tosVersionsTable.publishedAt)],
  });

  res.json({ acceptances: rows, versions });
});

logger.info("Admin audit routes registered");

// ─── Task #17 — Auditoria de obediência da IA por modo de conversa ──────────
// GET /audit/ai-modes/summary?tenantId=&days=
//   → contagem por modo + taxa de obediência (últimos N dias)
// GET /audit/ai-modes?tenantId=&mode=&obeyed=&limit=&offset=
//   → lista paginada de eventos de auditoria
router.get("/audit/ai-modes/summary", async (req: Request, res: Response) => {
  const tenantId = req.query.tenantId ? Number(req.query.tenantId) : undefined;
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const conds = [sql`created_at >= ${since}`];
  if (tenantId) conds.push(sql`tenant_id = ${tenantId}`);
  const where = sql.join(conds, sql` AND `);

  const rows = await db.execute<{ mode: string; total: string; obeyed: string }>(sql`
    SELECT mode, COUNT(*)::text AS total, SUM(CASE WHEN obeyed THEN 1 ELSE 0 END)::text AS obeyed
    FROM ai_response_audit
    WHERE ${where}
    GROUP BY mode
    ORDER BY mode ASC
  `);

  const summary = (rows.rows || rows as unknown as Array<{ mode: string; total: string; obeyed: string }>).map((r) => {
    const total = Number(r.total);
    const obeyed = Number(r.obeyed);
    return {
      mode: r.mode,
      total,
      obeyed,
      disobeyed: total - obeyed,
      obeyRate: total > 0 ? obeyed / total : 0,
    };
  });
  res.json({ days, summary });
});

router.get("/audit/ai-modes", async (req: Request, res: Response) => {
  const tenantId = req.query.tenantId ? Number(req.query.tenantId) : undefined;
  const mode = req.query.mode ? String(req.query.mode) : undefined;
  const obeyedParam = req.query.obeyed;
  const retryParam = req.query.retryUsed;
  const fallbackParam = req.query.fallbackUsed;
  const days = req.query.days ? Math.min(Math.max(Number(req.query.days), 1), 90) : null;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;

  const conds = [] as Parameters<typeof and>[0][];
  if (tenantId) conds.push(eq(aiResponseAuditTable.tenantId, tenantId));
  if (mode) conds.push(eq(aiResponseAuditTable.mode, mode));
  if (obeyedParam === "true") conds.push(eq(aiResponseAuditTable.obeyed, true));
  if (obeyedParam === "false") conds.push(eq(aiResponseAuditTable.obeyed, false));
  if (retryParam === "true") conds.push(eq(aiResponseAuditTable.retryUsed, true));
  if (retryParam === "false") conds.push(eq(aiResponseAuditTable.retryUsed, false));
  if (fallbackParam === "true") conds.push(eq(aiResponseAuditTable.fallbackUsed, true));
  if (fallbackParam === "false") conds.push(eq(aiResponseAuditTable.fallbackUsed, false));
  if (days != null) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    conds.push(sql`${aiResponseAuditTable.createdAt} >= ${since}`);
  }

  const rows = await db
    .select()
    .from(aiResponseAuditTable)
    .where(conds.length > 0 ? and(...conds) : sql`true`)
    .orderBy(desc(aiResponseAuditTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json({ rows, pagination: { limit, offset, count: rows.length } });
});

// ─── AI cost panel — daily token usage and cost per model ──────────────────
// GET /audit/ai-cost?days=30&tenantId=
//   → daily aggregates (per model) of prompt/completion/cached tokens + USD cost
//
// Pricing (USD per 1M tokens) — adjust here when OpenAI changes prices:
const MODEL_PRICING_USD_PER_1M: Record<string, { prompt: number; completion: number; cached: number }> = {
  "gpt-5.4": { prompt: 2.50, completion: 15.00, cached: 0.25 },
  "gpt-5.1": { prompt: 2.00, completion: 8.00, cached: 1.00 },
  "gpt-5-mini": { prompt: 0.75, completion: 4.50, cached: 0.075 },
  "gpt-5-nano": { prompt: 0.20, completion: 1.25, cached: 0.02 },
};
const DEFAULT_PRICING = { prompt: 2.00, completion: 8.00, cached: 1.00 };
const USD_TO_BRL = Number(process.env.USD_TO_BRL || "5.50");

router.get("/audit/ai-cost", async (req: Request, res: Response) => {
  const tenantId = req.query.tenantId ? Number(req.query.tenantId) : undefined;
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const conds = [sql`created_at >= ${since}`];
  if (tenantId) conds.push(sql`tenant_id = ${tenantId}`);
  const where = sql.join(conds, sql` AND `);

  const result = await db.execute<{
    day: string;
    model: string;
    calls: string;
    prompt_tokens: string;
    completion_tokens: string;
    cached_tokens: string;
  }>(sql`
    SELECT
      to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
      COALESCE(model_used, 'unknown') AS model,
      COUNT(*)::text AS calls,
      COALESCE(SUM(prompt_tokens), 0)::text AS prompt_tokens,
      COALESCE(SUM(completion_tokens), 0)::text AS completion_tokens,
      COALESCE(SUM(cached_tokens), 0)::text AS cached_tokens
    FROM ai_response_audit
    WHERE ${where}
    GROUP BY day, model_used
    ORDER BY day ASC, model_used ASC
  `);

  const rawRows = (result.rows || (result as unknown as Array<{
    day: string; model: string; calls: string;
    prompt_tokens: string; completion_tokens: string; cached_tokens: string;
  }>));

  const daily = rawRows.map((r) => {
    const pricing = MODEL_PRICING_USD_PER_1M[r.model] ?? DEFAULT_PRICING;
    const promptTokens = Number(r.prompt_tokens);
    const completionTokens = Number(r.completion_tokens);
    const cachedTokens = Number(r.cached_tokens);
    // Cached portion is billed at the cached rate; non-cached portion at full prompt rate.
    const billablePromptTokens = Math.max(0, promptTokens - cachedTokens);
    const costUsd =
      (billablePromptTokens * pricing.prompt +
        cachedTokens * pricing.cached +
        completionTokens * pricing.completion) /
      1_000_000;
    return {
      day: r.day,
      model: r.model,
      calls: Number(r.calls),
      promptTokens,
      completionTokens,
      cachedTokens,
      costUsd,
      costBrl: costUsd * USD_TO_BRL,
    };
  });

  // Totals per model + grand total
  const byModel = new Map<string, { calls: number; promptTokens: number; completionTokens: number; cachedTokens: number; costUsd: number; costBrl: number }>();
  let totalCostUsd = 0;
  let totalCalls = 0;
  for (const row of daily) {
    const acc = byModel.get(row.model) ?? { calls: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0, costBrl: 0 };
    acc.calls += row.calls;
    acc.promptTokens += row.promptTokens;
    acc.completionTokens += row.completionTokens;
    acc.cachedTokens += row.cachedTokens;
    acc.costUsd += row.costUsd;
    acc.costBrl += row.costBrl;
    byModel.set(row.model, acc);
    totalCostUsd += row.costUsd;
    totalCalls += row.calls;
  }
  const totals = Array.from(byModel.entries()).map(([model, v]) => ({ model, ...v }));

  res.json({
    days,
    usdToBrl: USD_TO_BRL,
    pricing: MODEL_PRICING_USD_PER_1M,
    daily,
    totals,
    grandTotal: { calls: totalCalls, costUsd: totalCostUsd, costBrl: totalCostUsd * USD_TO_BRL },
  });
});

export default router;
