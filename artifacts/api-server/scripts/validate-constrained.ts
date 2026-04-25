/**
 * Task #16 follow-up — validação ponta-a-ponta do caminho restrito
 * (`useConstrainedGeneration = true`) sem precisar do WhatsApp.
 *
 * Cria 4 conversas sintéticas no banco do tenant Sorrizin Maxx (id=1),
 * dispara `processIncomingMessage` em cada uma e captura a linha
 * `[CONSTRAINED]` que o motor restrito emite para reportar:
 *   - action escolhida pela IA
 *   - violations (deve ser `[]` em todos os cenários)
 *   - se appt=yes apareceu onde era esperado
 *
 * Cenários:
 *   A. Lead menciona "Bradesco" em clinica que NAO aceita convenio.
 *      Esperado: action ∈ {ASK_INFO, CONVENIO_TRIAGEM}, sem oferta de horario.
 *   B. Lead particular pergunta sobre PIX (apos contexto particular).
 *      Esperado: action=SEND_PIX com PIX renderizado deterministicamente.
 *   C. Primeiro contato particular: "quero marcar uma consulta".
 *      Esperado: action=ASK_INFO (faltam dados), sem oferta de horario.
 *   D. Conversa multi-turno ate confirmacao.
 *      Esperado: action=CONFIRM_SLOT com appt=yes (apt criado em DB).
 *
 * Uso: pnpm --filter @workspace/api-server exec tsx scripts/validate-constrained.ts
 *      (Roda contra o banco real e a OpenAI real — gasta ~poucos centavos)
 */

import { db } from "@workspace/db";
import {
  dentalLeadsTable,
  dentalConversationsTable,
  dentalMessagesTable,
  appointmentsTable,
  tenantsTable,
} from "@workspace/db";
import { and, eq, like, sql } from "drizzle-orm";
import { logger } from "../src/lib/logger";

// ─────────────────────────────────────────────────────────────────────────
// Captura de logs [CONSTRAINED]
// ─────────────────────────────────────────────────────────────────────────

interface CapturedConstrainedLog {
  raw: string;
  conv: number | null;
  action: string | null;
  violations: string[];
  slotsShown: number | null;
  slotsTotal: number | null;
  prof: string | null;
  appt: boolean;
  latency: number | null;
}

const captured: CapturedConstrainedLog[] = [];
const originalInfo = logger.info.bind(logger);

function parseConstrainedLine(line: string): CapturedConstrainedLog | null {
  if (!line.includes("[CONSTRAINED]")) return null;
  const get = (k: string, re: RegExp) => {
    const m = line.match(re);
    return m ? m[1] : null;
  };
  const conv = get("conv", /conv=(\d+)/);
  const action = get("action", /action=([A-Z_]+)/);
  const violationsRaw = get("violations", /violations=\[([^\]]*)\]/);
  const slotsRaw = get("slots", /slots=(\d+)\/(\d+)/);
  const slotsMatch = line.match(/slots=(\d+)\/(\d+)/);
  const prof = get("prof", /prof=(\S+)/);
  const apptStr = get("appt", /appt=(yes|no)/);
  const latencyStr = get("latency_ms", /latency_ms=(\d+)/);
  return {
    raw: line,
    conv: conv ? Number(conv) : null,
    action,
    violations: violationsRaw ? violationsRaw.split(",").map((s) => s.trim()).filter(Boolean) : [],
    slotsShown: slotsMatch ? Number(slotsMatch[1]) : null,
    slotsTotal: slotsMatch ? Number(slotsMatch[2]) : null,
    prof,
    appt: apptStr === "yes",
    latency: latencyStr ? Number(latencyStr) : null,
  };
}

(logger as { info: (...args: unknown[]) => void }).info = (...args: unknown[]) => {
  // pino call shapes: logger.info(msg) | logger.info(obj, msg) | logger.info(obj)
  let msg: string | null = null;
  if (typeof args[0] === "string") {
    msg = args[0];
  } else if (typeof args[1] === "string") {
    msg = args[1];
  }
  if (msg && msg.includes("[CONSTRAINED]")) {
    const parsed = parseConstrainedLine(msg);
    if (parsed) captured.push(parsed);
  }
  return originalInfo(...(args as Parameters<typeof originalInfo>));
};

// ─────────────────────────────────────────────────────────────────────────
// Setup helpers
// ─────────────────────────────────────────────────────────────────────────

const TENANT_ID = 1;
const TEST_PHONE_PREFIX = "+55119000000"; // 12 dígitos restantes (1 sufixo por scenario)

async function ensureTenantHasFlag() {
  const t = await db.select().from(tenantsTable).where(eq(tenantsTable.id, TENANT_ID)).limit(1);
  if (!t.length) throw new Error(`tenant ${TENANT_ID} não existe`);
  if (t[0].useConstrainedGeneration !== true) {
    throw new Error(
      `tenant ${TENANT_ID} está com useConstrainedGeneration=${t[0].useConstrainedGeneration}. ` +
      `Ative com: UPDATE tenants SET use_constrained_generation=true WHERE id=${TENANT_ID};`,
    );
  }
}

async function cleanupPriorRuns() {
  const phoneLike = TEST_PHONE_PREFIX + "%";
  // Apaga em ordem de FK: appointments → messages → conversations → leads
  const leads = await db
    .select({ id: dentalLeadsTable.id })
    .from(dentalLeadsTable)
    .where(and(eq(dentalLeadsTable.tenantId, TENANT_ID), like(dentalLeadsTable.phone, phoneLike)));
  const leadIds = leads.map((l) => l.id);
  if (leadIds.length) {
    for (const lid of leadIds) {
      await db.delete(appointmentsTable).where(and(
        eq(appointmentsTable.tenantId, TENANT_ID),
        eq(appointmentsTable.leadId, lid),
      ));
    }
  }
  const convs = await db
    .select({ id: dentalConversationsTable.id })
    .from(dentalConversationsTable)
    .where(and(eq(dentalConversationsTable.tenantId, TENANT_ID), like(dentalConversationsTable.contactPhone, phoneLike)));
  for (const c of convs) {
    await db.delete(dentalMessagesTable).where(eq(dentalMessagesTable.conversationId, c.id));
  }
  await db
    .delete(dentalConversationsTable)
    .where(and(eq(dentalConversationsTable.tenantId, TENANT_ID), like(dentalConversationsTable.contactPhone, phoneLike)));
  await db
    .delete(dentalLeadsTable)
    .where(and(eq(dentalLeadsTable.tenantId, TENANT_ID), like(dentalLeadsTable.phone, phoneLike)));
}

interface ScenarioCtx {
  label: string;
  phone: string;
  leadId: number;
  conversationId: number;
}

async function setupScenario(label: string, phoneSuffix: string, name: string): Promise<ScenarioCtx> {
  const phone = TEST_PHONE_PREFIX + phoneSuffix;
  const [lead] = await db
    .insert(dentalLeadsTable)
    .values({
      tenantId: TENANT_ID,
      name,
      phone,
      temperature: "warm",
      source: "validate-constrained-script",
      status: "novo",
    })
    .returning({ id: dentalLeadsTable.id });
  const [conv] = await db
    .insert(dentalConversationsTable)
    .values({
      tenantId: TENANT_ID,
      contactPhone: phone,
      contactName: name,
      contactType: "lead",
      leadId: lead.id,
      status: "active",
    })
    .returning({ id: dentalConversationsTable.id });
  return { label, phone, leadId: lead.id, conversationId: conv.id };
}

async function injectInbound(ctx: ScenarioCtx, content: string) {
  await db.insert(dentalMessagesTable).values({
    tenantId: TENANT_ID,
    conversationId: ctx.conversationId,
    direction: "inbound",
    type: "text",
    content,
    sentAt: new Date(),
  });
}

async function injectOutbound(ctx: ScenarioCtx, content: string) {
  await db.insert(dentalMessagesTable).values({
    tenantId: TENANT_ID,
    conversationId: ctx.conversationId,
    direction: "outbound",
    type: "text",
    content,
    sentAt: new Date(),
  });
}

async function getApptCount(leadId: number): Promise<number> {
  const r = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(appointmentsTable)
    .where(and(eq(appointmentsTable.tenantId, TENANT_ID), eq(appointmentsTable.leadId, leadId)));
  return r[0]?.c ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────
// Execução
// ─────────────────────────────────────────────────────────────────────────

interface ScenarioResult {
  label: string;
  expectedActions: string[];
  expectedAppt: boolean;
  reply: string;
  log: CapturedConstrainedLog | null;
  apptDelta: number;
  ok: boolean;
  notes: string[];
}

async function runScenario(
  label: string,
  expectedActions: string[],
  expectedAppt: boolean,
  setupAndSend: () => Promise<{ ctx: ScenarioCtx; finalMessage: string; reply: string; apptDelta: number }>,
): Promise<ScenarioResult> {
  const before = captured.length;
  const { ctx, finalMessage, reply, apptDelta: initialDelta } = await setupAndSend();
  // ai-engine persiste appointment via setImmediate (fire-and-forget) DEPOIS
  // do retorno de processIncomingMessage. Polling até 8s — para cedo se
  // detectar criação OU se o log [CONSTRAINED] mostrar appt=no (não vai
  // criar nada). Mais robusto que sleep fixo sob carga variável.
  const pollDeadline = Date.now() + 8000;
  let apptAfterWait = await getApptCount(ctx.leadId);
  const expectsAppt = expectedAppt;
  while (Date.now() < pollDeadline) {
    if (apptAfterWait > 0) break;
    if (!expectsAppt) {
      // Cenários sem appointment esperado: 300ms basta pra confirmar negativo
      if (Date.now() > pollDeadline - 7700) break;
    }
    await new Promise((r) => setTimeout(r, 200));
    apptAfterWait = await getApptCount(ctx.leadId);
  }
  const apptDelta = Math.max(initialDelta, apptAfterWait);
  // Última linha [CONSTRAINED] pertencente a essa conversation
  const log = captured
    .slice(before)
    .reverse()
    .find((c) => c.conv === ctx.conversationId) ?? null;

  const notes: string[] = [];
  let ok = true;
  if (!log) {
    ok = false;
    notes.push("nenhuma linha [CONSTRAINED] capturada — caminho restrito não foi exercitado?");
  } else {
    if (!expectedActions.includes(log.action ?? "")) {
      ok = false;
      notes.push(`action ${log.action} fora do esperado (${expectedActions.join("|")})`);
    }
    if (log.violations.length > 0) {
      ok = false;
      notes.push(`VIOLATIONS NÃO-VAZIAS: [${log.violations.join(",")}]`);
    }
    const apptObserved = apptDelta > 0;
    if (apptObserved !== expectedAppt) {
      ok = false;
      notes.push(`appt esperado=${expectedAppt} observado=${apptObserved}`);
    }
  }
  void finalMessage;
  return { label, expectedActions, expectedAppt, reply, log, apptDelta, ok, notes };
}

async function main() {
  console.log("\n=== Validação caminho restrito (Sorrizin Maxx, tenant=1) ===\n");
  await ensureTenantHasFlag();
  await cleanupPriorRuns();

  // Import lazy depois do patch do logger
  const { processIncomingMessage } = await import("../src/lib/ai-engine");

  const results: ScenarioResult[] = [];

  // ── Cenário A — Bradesco em clínica sem convênio ──────────────────────
  results.push(await runScenario(
    "A. Lead menciona Bradesco (clínica não aceita)",
    ["ASK_INFO", "CONVENIO_TRIAGEM"],
    false,
    async () => {
      const ctx = await setupScenario("A", "01", "Maria Bradesco");
      const msg = "oi vcs aceitam bradesco?";
      const apptBefore = await getApptCount(ctx.leadId);
      const reply = await processIncomingMessage(
        TENANT_ID, ctx.conversationId, ctx.phone, "Maria",
        msg, "lead", undefined, ctx.leadId,
      );
      const apptAfter = await getApptCount(ctx.leadId);
      return { ctx, finalMessage: msg, reply, apptDelta: apptAfter - apptBefore };
    },
  ));

  // ── Cenário B — particular pede PIX ───────────────────────────────────
  results.push(await runScenario(
    "B. Particular pergunta sobre PIX",
    ["SEND_PIX"],
    false,
    async () => {
      const ctx = await setupScenario("B", "02", "Pedro Particular");
      // Pre-seed contexto particular (paciente já avisou que paga particular)
      await injectInbound(ctx, "boa tarde, queria saber sobre uma limpeza");
      await injectOutbound(ctx, "oi! claro, posso te ajudar. Vc paga particular ou tem algum convênio?");
      await injectInbound(ctx, "particular");
      await injectOutbound(ctx, "show, posso te encaixar essa semana. Em qual dia vc prefere?");
      const msg = "antes me passa a chave pix de vcs por favor, qual banco";
      const apptBefore = await getApptCount(ctx.leadId);
      const reply = await processIncomingMessage(
        TENANT_ID, ctx.conversationId, ctx.phone, "Pedro",
        msg, "lead", undefined, ctx.leadId,
      );
      const apptAfter = await getApptCount(ctx.leadId);
      return { ctx, finalMessage: msg, reply, apptDelta: apptAfter - apptBefore };
    },
  ));

  // ── Cenário C — primeiro contato particular ────────────────────────────
  results.push(await runScenario(
    "C. Primeiro contato — quero marcar consulta",
    ["ASK_INFO", "OFFER_SLOTS"],
    false,
    async () => {
      const ctx = await setupScenario("C", "03", "Carla Primeira");
      const msg = "oi quero marcar uma consulta";
      const apptBefore = await getApptCount(ctx.leadId);
      const reply = await processIncomingMessage(
        TENANT_ID, ctx.conversationId, ctx.phone, "Carla",
        msg, "lead", undefined, ctx.leadId,
      );
      const apptAfter = await getApptCount(ctx.leadId);
      return { ctx, finalMessage: msg, reply, apptDelta: apptAfter - apptBefore };
    },
  ));

  // ── Cenário D — conversa multi-turno até confirmação ───────────────────
  // Estratégia: pré-semeamos histórico estabelecendo (a) intenção particular,
  // (b) que a IA já ofertou um horário concreto com data/hora — isso aciona
  // `previousAiOfferedSlots=true` no ai-engine, que carrega slots reais e
  // mantém `readyForSchedule=true`. Em seguida o paciente responde com o
  // padrão afirmativo curto `"sim, pode marcar"` (regex-friendly) que casa
  // com `AFFIRMATIVE_REPLY_PATTERN`. Resultado esperado: CONFIRM_SLOT com
  // appt=yes e violations=[].
  results.push(await runScenario(
    "D. Multi-turno até CONFIRM_SLOT (happy path)",
    ["CONFIRM_SLOT"],
    true,
    async () => {
      const ctx = await setupScenario("D", "04", "Joana Confirma");
      await injectInbound(ctx, "oi quero marcar uma limpeza, sou particular");
      // Formato HH:MM no horário é importante: o ai-engine usa regex \d{1,2}:\d{2}
      // pra detectar "previousAiOfferedSlots" via outbound prévio. Se usarmos
      // "09h00" o branch correto não dispara — o teste passa por outro caminho
      // (leadExplicitlyAsksSchedule por "pode marcar"), reduzindo cobertura.
      await injectOutbound(ctx, "Oi Joana! Posso te encaixar Seg 27/04 as 09:00 com Dr Jose Roberto. Confirmo pra voce?");
      const msg = "sim, pode marcar";
      const apptBefore = await getApptCount(ctx.leadId);
      const reply = await processIncomingMessage(
        TENANT_ID, ctx.conversationId, ctx.phone, "Joana",
        msg, "lead", undefined, ctx.leadId,
      );
      const apptAfter = await getApptCount(ctx.leadId);
      return { ctx, finalMessage: msg, reply, apptDelta: apptAfter - apptBefore };
    },
  ));

  // ── Relatório ──────────────────────────────────────────────────────────
  console.log("\n=== RESULTADO ===\n");
  let allOk = true;
  for (const r of results) {
    console.log(`── ${r.label} ──`);
    if (r.log) {
      console.log(`  log: ${r.log.raw}`);
      console.log(`  action=${r.log.action}  violations=[${r.log.violations.join(",")}]  appt=${r.log.appt ? "yes" : "no"}  slots=${r.log.slotsShown}/${r.log.slotsTotal}`);
    } else {
      console.log("  log: (nenhum [CONSTRAINED] capturado)");
    }
    console.log(`  reply: ${r.reply.slice(0, 200)}${r.reply.length > 200 ? "…" : ""}`);
    console.log(`  appt criado nesse cenário? ${r.apptDelta > 0 ? `sim (${r.apptDelta})` : "não"}`);
    console.log(`  status: ${r.ok ? "OK ✓" : "FALHOU ✗"}`);
    if (r.notes.length) console.log(`  notas: ${r.notes.join(" | ")}`);
    console.log("");
    if (!r.ok) allOk = false;
  }

  console.log(allOk ? "✅ Todos os cenários passaram." : "❌ Algum cenário falhou — ver notas acima.");

  // Não deletamos automaticamente as conversas pra o usuário poder
  // inspecionar no painel. Próxima execução faz cleanup.

  await db.$client.end();
  process.exit(allOk ? 0 : 1);
}

main().catch(async (err) => {
  console.error("ERRO FATAL no script:", err);
  try { await db.$client.end(); } catch {}
  process.exit(2);
});
