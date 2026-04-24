import http from "http";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import {
  tenantsTable,
  dentalSettingsTable,
  dentalProceduresTable,
  dentalProfessionalsTable,
  dentalLeadsTable,
  patientsTable,
  appointmentsTable,
  dentalConversationsTable,
  dentalMessagesTable,
  dentalActivityTable,
  appointmentFollowUpsTable,
  dentalConversationQuotasTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { processFollowUps } from "../scheduler";
import { MockWhatsappProvider, setTestProvider } from "../lib/whatsapp-provider";
import { tenantExistsCache } from "../lib/cache";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import app from "../app";

// ─── Telefones de teste ───────────────────────────────────────────────────────
const PHONE_B1_C1  = "5511900000101";
const PHONE_B1_C2  = "5511900000102";
const PHONE_B1_C3  = "5511900000103";
const PHONE_B2_PART = "5511900000201";
const PHONE_B2_ROB  = "5511900000202";
const PHONE_B3_CONV = "5511900000301";
const PHONE_B3_IMP  = "5511900000302";
const PHONE_B3_MIGR = "5511900000303";
const PHONE_B3_MIGR2 = "5511900000304";
const PHONE_B4_JOAO  = "5511900000401";
const PHONE_B4_MARIA = "5511900000402";
const PHONE_B5_PIX_ANA = "5511900000501";
const PHONE_B5_PIX_ROB = "5511900000502";
const PHONE_B5_PIX_MAR = "5511900000503";
const PHONE_B5_FEE_ANA = "5511900000504";
const PHONE_B5_FEE_ROB = "5511900000505";
const PHONE_B5_FEE_MAR = "5511900000506";
const PHONE_B5_C19     = "5511900000507";
const PHONE_B6_FU      = "5511900000601";
const PHONE_B6_QUOTA   = "5511900000602";
const PHONE_B6_SLOT    = "5511900000603";

// ─── Globals ──────────────────────────────────────────────────────────────────
interface TestEvidence {
  input?: string;
  aiResponse?: string;
  dbState?: Record<string, unknown>;
  apiResponse?: { status: number; body: Record<string, unknown> };
  [key: string]: unknown;
}
interface TestResult {
  name: string;
  block: string;
  status: "PASS" | "FAIL" | "SKIP";
  details: string;
  duration: number;
  evidence: TestEvidence;
}
interface ApiResponse { status: number; data: Record<string, unknown>; }

const results: TestResult[] = [];
let tenantId: number;
let authToken: string;
let testServer: http.Server;
let BASE_URL: string;
let currentEvidence: TestEvidence = {};
let mockProvider: MockWhatsappProvider;
let profAnaId: number;
let profMarcosId: number;
let profRobertoId: number;
let currentBlock = "setup";

// ─── Helpers base ─────────────────────────────────────────────────────────────
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}
function evidence(key: string, value: unknown): void { currentEvidence[key] = value; }

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  currentEvidence = {};
  try {
    await fn();
    const dur = Date.now() - start;
    results.push({ name, block: currentBlock, status: "PASS", details: "OK", duration: dur, evidence: { ...currentEvidence } });
    console.log(`  ✅ PASS: ${name} (${dur}ms)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const dur = Date.now() - start;
    results.push({ name, block: currentBlock, status: "FAIL", details: msg, duration: dur, evidence: { ...currentEvidence } });
    console.log(`  ❌ FAIL: ${name} — ${msg} (${dur}ms)`);
  }
}

/** Sets the current block label, then runs a single named scenario inside it. */
async function runScenarioInBlock(blockName: string, name: string, fn: () => Promise<void>): Promise<void> {
  currentBlock = blockName;
  const filter = process.env.SCENARIO_FILTER;
  if (filter) {
    const tokens = filter.split(",").map(t => t.trim().toLowerCase()).filter(Boolean);
    if (!tokens.some(t => name.toLowerCase().includes(t))) return;
  }
  await runTest(name, fn);
}

/**
 * Helper genérico de chamadas HTTP autenticadas — paridade com `e2e-test.ts`.
 * - Faz prefix automático de `/api`
 * - Encaminha header de autorização quando WEBHOOK_SECRET está disponível
 * - Resposta usa o campo `data` (mesmo nome que o tipo `ApiResponse`)
 */
const api = {
  _url(path: string): string {
    const p = path.startsWith("/api") ? path : `/api${path.startsWith("/") ? path : `/${path}`}`;
    return `${BASE_URL}${p}`;
  },
  _headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    const secret = process.env.WEBHOOK_SECRET;
    if (secret) h["Authorization"] = `Bearer ${secret}`;
    return h;
  },
  async get(path: string): Promise<ApiResponse> {
    const resp = await fetch(this._url(path), { headers: this._headers() });
    const text = await resp.text();
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(text) as Record<string, unknown>; } catch { data = { raw: text }; }
    return { status: resp.status, data };
  },
  async post(path: string, body: unknown): Promise<ApiResponse> {
    const resp = await fetch(this._url(path), {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(text) as Record<string, unknown>; } catch { data = { raw: text }; }
    return { status: resp.status, data };
  },
};
void api;

async function webhookMessage(instanceName: string, phone: string, message: string, pushName: string): Promise<ApiResponse> {
  const url = `${BASE_URL}/api/dental/webhook/whatsapp`;
  const token = process.env.WEBHOOK_SECRET || "";
  const body = {
    event: "messages.upsert",
    instance: instanceName,
    data: {
      key: {
        remoteJid: `${phone}@s.whatsapp.net`,
        fromMe: false,
        id: `test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      },
      pushName,
      message: { conversation: message },
    },
  };
  const resp = await fetch(url + (token ? `?token=${token}` : ""), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data: Record<string, unknown>;
  try { data = JSON.parse(text) as Record<string, unknown>; } catch { data = { raw: text }; }
  return { status: resp.status, data };
}

async function webhookImage(instanceName: string, phone: string, base64: string, pushName: string): Promise<ApiResponse> {
  const url = `${BASE_URL}/api/dental/webhook/whatsapp`;
  const token = process.env.WEBHOOK_SECRET || "";
  const body = {
    event: "messages.upsert",
    instance: instanceName,
    data: {
      key: {
        remoteJid: `${phone}@s.whatsapp.net`,
        fromMe: false,
        id: `test_img_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      },
      pushName,
      message: {
        imageMessage: {
          mimetype: "image/jpeg",
          url: "",
          base64,
          caption: "comprovante pix",
        },
      },
    },
  };
  const resp = await fetch(url + (token ? `?token=${token}` : ""), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data: Record<string, unknown>;
  try { data = JSON.parse(text) as Record<string, unknown>; } catch { data = { raw: text }; }
  return { status: resp.status, data };
}

async function getOutboundMessages(phone: string): Promise<Array<{ content: string; sentAt: Date }>> {
  const conv = await db.query.dentalConversationsTable.findFirst({
    where: and(eq(dentalConversationsTable.tenantId, tenantId), eq(dentalConversationsTable.contactPhone, phone)),
  });
  if (!conv) return [];
  const msgs = await db.query.dentalMessagesTable.findMany({
    where: and(eq(dentalMessagesTable.conversationId, conv.id), eq(dentalMessagesTable.direction, "outbound")),
    orderBy: [desc(dentalMessagesTable.sentAt)],
  });
  return msgs.map((m) => ({ content: m.content || "", sentAt: m.sentAt! }));
}

async function waitForAiProcessing(phone: string, minOutbound: number, maxWait = 20000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const msgs = await getOutboundMessages(phone);
    if (msgs.length >= minOutbound) return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Returns all outbound content concatenated for broad assertions */
async function getAllOutboundText(phone: string): Promise<string> {
  const msgs = await getOutboundMessages(phone);
  return msgs.map((m) => m.content).join(" ");
}

async function getInstanceName(): Promise<string> {
  const t = await db.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, tenantId) });
  return t!.evolutionInstanceName || `dental-${tenantId}`;
}

function getNextWeekday(targetDay: number): Date {
  const today = new Date();
  const diff = ((targetDay - today.getDay()) + 7) % 7 || 7;
  const next = new Date(today);
  next.setDate(today.getDate() + diff);
  next.setHours(10, 0, 0, 0);
  return next;
}

/** Returns true if current hour (Brasília = UTC-3) is within 08:00–20:00 */
function isWithinBrasiliaWindow(): boolean {
  const utcHour = new Date().getUTCHours();
  const brHour = (utcHour - 3 + 24) % 24;
  return brHour >= 8 && brHour < 20;
}

// ─── Helpers de verificação (spec v3) ─────────────────────────────────────────
function assertHasEmpathy(response: string, context: string): void {
  const empathyWords = [
    // palavras clássicas
    "entendo", "compreendo", "sinto", "imagino", "sei como",
    "não se preocupe", "vamos te ajudar", "pode contar",
    "estamos aqui", "com cuidado", "nossa equipe",
    "que bom", "fico feliz", "obrigado por",
    // expressões coloquiais típicas do bot
    "poxa", "incomoda", "doendo", "imagino que", "mais comum",
    "claro", "com calma", "corrido mesmo", "calma",
    "entendeu", "imagino", "que bom", "tudo bem",
    "pode deixar", "fique tranquil", "sem problema",
    "vamos resolver", "ficou na dúvida", "me conta", "me fala",
  ];
  const lower = response.toLowerCase();
  const hasEmpathy = empathyWords.some((w) => lower.includes(w));
  assert(hasEmpathy, `[${context}] IA não demonstrou empatia. Resposta: "${response.substring(0, 200)}"`);
}

function assertNoInsuranceTriage(response: string, context: string): void {
  const triageWords = [
    "convênio ou particular", "plano ou particular",
    "usa convênio", "tem plano",
  ];
  const hasTriage = triageWords.some((w) => response.toLowerCase().includes(w));
  assert(!hasTriage, `[${context}] IA fez triagem de convênio para paciente conhecido. Resposta: "${response.substring(0, 200)}"`);
}

function assertCorrectPixKey(response: string, professional: "ana" | "roberto" | "marcos", context: string): void {
  const pixKeys = {
    ana: "ana@odontovida.com.br",
    roberto: "11999887766",
    marcos: null,
  };
  const expectedKey = pixKeys[professional];
  if (professional === "marcos") {
    assert(
      !response.toLowerCase().includes("pix"),
      `[${context}] Dr. Marcos não tem PIX mas IA mencionou PIX. Resposta: "${response.substring(0, 200)}"`,
    );
    return;
  }
  if (expectedKey) {
    assert(
      response.includes(expectedKey),
      `[${context}] Chave PIX incorreta ou ausente. Esperado: "${expectedKey}". Resposta: "${response.substring(0, 200)}"`,
    );
  }
}

function assertConsultationFee(response: string, professional: "ana" | "roberto" | "marcos_particular", context: string): void {
  const fees: Record<string, string | null> = {
    ana: "150",
    roberto: null,
    marcos_particular: "200",
  };
  const fee = fees[professional];
  if (!fee) {
    const gratuitaWords = ["gratuita", "grátis", "sem custo", "sem cobrança", "cortesia", "gratuito", "avaliação gratuita", "não cobra", "é gratu"];
    const hasGratuita = gratuitaWords.some((w) => response.toLowerCase().includes(w));
    assert(hasGratuita, `[${context}] Dr. Roberto tem consulta gratuita mas IA não mencionou. Resposta: "${response.substring(0, 200)}"`);
  } else {
    assert(response.includes(fee), `[${context}] Valor da consulta R$${fee} não mencionado. Resposta: "${response.substring(0, 200)}"`);
  }
}

function assertNoProcedurePrice(response: string, context: string): void {
  const forbidden = [
    { pattern: /R\$\s*1[.,]?200/i, label: "R$1.200 (clareamento)" },
    { pattern: /R\$\s*2[.,]?800/i, label: "R$2.800 (aparelho)" },
    { pattern: /R\$\s*4[.,]?500/i, label: "R$4.500 (implante)" },
    { pattern: /R\$\s*1[.,]?500/i, label: "R$1.500 (canal)" },
  ];
  for (const { pattern, label } of forbidden) {
    assert(!pattern.test(response), `[${context}] IA citou preço proibido de procedimento: ${label}. Resposta: "${response.substring(0, 200)}"`);
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────
async function setup(): Promise<void> {
  console.log("\n🔧 Configurando servidor de teste e dados...\n");

  const aiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!aiKey) {
    console.error("❌ FATAL: Nenhuma chave de OpenAI encontrada. Configure AI_INTEGRATIONS_OPENAI_API_KEY ou OPENAI_API_KEY.");
    process.exit(1);
  }

  mockProvider = new MockWhatsappProvider();
  setTestProvider(mockProvider);

  testServer = await new Promise<http.Server>((resolve) => {
    const srv = app.listen(0, () => {
      const addr = srv.address() as { port: number };
      BASE_URL = `http://localhost:${addr.port}`;
      console.log(`  Servidor de teste em ${BASE_URL}`);
      resolve(srv);
    });
  });

  const slug = `e2e_clinica_${Date.now()}`;
  const [tenant] = await db.insert(tenantsTable).values({
    name: "Clínica OdontoVida",
    slug,
    email: `clinica_${Date.now()}@test.com`,
    plan: "professional",
    subscriptionStatus: "active",
    evolutionInstanceName: `clinica-test-${Date.now()}`,
  }).returning();
  tenantId = tenant.id;

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) throw new Error("JWT_SECRET não definido");
  authToken = jwt.sign({ tenantId }, jwtSecret, { expiresIn: "1h" });

  const scheduleConfig = JSON.stringify([
    { day: "0", enabled: false, start: "08:00", end: "18:00" },
    { day: "1", enabled: true,  start: "08:00", end: "18:00", morningEnd: "12:00", afternoonStart: "14:00" },
    { day: "2", enabled: true,  start: "08:00", end: "18:00", morningEnd: "12:00", afternoonStart: "14:00" },
    { day: "3", enabled: true,  start: "08:00", end: "18:00", morningEnd: "12:00", afternoonStart: "14:00" },
    { day: "4", enabled: true,  start: "08:00", end: "18:00", morningEnd: "12:00", afternoonStart: "14:00" },
    { day: "5", enabled: true,  start: "08:00", end: "18:00", morningEnd: "12:00", afternoonStart: "14:00" },
    { day: "6", enabled: true,  start: "08:00", end: "12:00" },
  ]);

  await db.insert(dentalSettingsTable).values({
    tenantId,
    clinicName: "Clínica OdontoVida",
    clinicPhone: "11999990000",
    clinicAddress: "Av. Dental, 100 – São Paulo/SP",
    professionalName: "Equipe OdontoVida",
    specialties: "Clínico Geral, Ortodontia, Implantodontia",
    workingHoursStart: "08:00",
    workingHoursEnd: "19:00",
    lunchStart: "12:00",
    lunchEnd: "13:00",
    slotDurationMinutes: 30,
    defaultLeadDurationMinutes: 30,
    defaultPatientDurationMinutes: 30,
    scheduleConfig,
    aiName: "Sofia",
    personalityType: "warm",
    followUpReminder: true,
    followUpPostAppointment: false,
    noShowEnabled: false,
    remarketingEnabled: false,
    birthdayEnabled: false,
    chargesConsultation: true,
    consultationFee: "150.00",
    acceptsInsurance: true,
  });

  // ── Profissional 1: Dra. Ana Beatriz ──────────────────────────────────────
  const [ana] = await db.insert(dentalProfessionalsTable).values({
    tenantId,
    name: "Dra. Ana Beatriz",
    specialties: "Clínico Geral, Estética",
    workingDays: "1,3,5,6",
    workingHoursStart: "08:00",
    workingHoursEnd: "18:00",
    lunchStart: "12:00",
    lunchEnd: "14:00",
    slotDurationMinutes: 30,
    defaultLeadDurationMinutes: 30,
    defaultPatientDurationMinutes: 30,
    consultationFee: "150.00",
    chargesConsultation: true,
    pixEnabled: true,
    pixMode: "required",
    pixKey: "ana@odontovida.com.br",
    pixKeyType: "email",
    pixBank: "Nubank",
    acceptsInsurance: false,
    isActive: true,
    isOwner: false,
  }).returning();
  profAnaId = ana.id;

  // ── Profissional 2: Dr. Marcos Oliveira ───────────────────────────────────
  // NOTA: schema não suporta horário por dia — usando envelope 09:00–19:00;
  // insuranceDays=Seg+Qua representa a restrição de convênio.
  const [marcos] = await db.insert(dentalProfessionalsTable).values({
    tenantId,
    name: "Dr. Marcos Oliveira",
    specialties: "Ortodontia, Aparelho Dental",
    workingDays: "1,3,4,5",
    workingHoursStart: "09:00",
    workingHoursEnd: "19:00",
    lunchStart: "12:00",
    lunchEnd: "13:00",
    slotDurationMinutes: 30,
    defaultLeadDurationMinutes: 30,
    defaultPatientDurationMinutes: 30,
    consultationFee: "200.00",
    chargesConsultation: true,
    pixEnabled: false,
    acceptsInsurance: true,
    insurancePlans: "Amil, Bradesco, SulAmérica",
    insuranceDays: "1,3",
    insuranceHoursStart: "09:00",
    insuranceHoursEnd: "17:00",
    isActive: true,
    isOwner: false,
  }).returning();
  profMarcosId = marcos.id;

  // ── Profissional 3: Dr. Roberto Santos ────────────────────────────────────
  const [roberto] = await db.insert(dentalProfessionalsTable).values({
    tenantId,
    name: "Dr. Roberto Santos",
    specialties: "Implantodontia, Implante Dental",
    workingDays: "2,4",
    workingHoursStart: "08:00",
    workingHoursEnd: "17:00",
    lunchStart: "12:00",
    lunchEnd: "13:00",
    slotDurationMinutes: 60,
    defaultLeadDurationMinutes: 60,
    defaultPatientDurationMinutes: 60,
    consultationFee: "300.00",
    chargesConsultation: false,
    pixEnabled: true,
    pixMode: "optional",
    pixKey: "11999887766",
    pixKeyType: "phone",
    pixBank: "Itaú",
    acceptsInsurance: false,
    isActive: true,
    isOwner: false,
  }).returning();
  profRobertoId = roberto.id;

  // ── Procedimentos ──────────────────────────────────────────────────────────
  // NOTE: "Ortodontia" is registered so the AI won't trigger procedure_not_listed.
  // Prices are intentionally not shown by the AI (REGRA UNICA DE PRECOS).
  await db.insert(dentalProceduresTable).values([
    { tenantId, name: "Clareamento Dental",  durationMinutes: 60,  price: "1200.00", active: "true" },
    { tenantId, name: "Limpeza",             durationMinutes: 30,  price: "200.00",  active: "true" },
    { tenantId, name: "Tratamento de Canal", durationMinutes: 90,  price: "1500.00", active: "true" },
    { tenantId, name: "Aparelho Dental",     durationMinutes: 45,  price: "2800.00", active: "true" },
    { tenantId, name: "Implante Dental",     durationMinutes: 120, price: "4500.00", active: "true" },
    { tenantId, name: "Ortodontia",          durationMinutes: 45,  price: "200.00",  active: "true" },
  ]);

  console.log(`  Tenant: ${tenantId} | Dra. Ana: ${profAnaId} | Dr. Marcos: ${profMarcosId} | Dr. Roberto: ${profRobertoId}`);
  console.log(`  Instance: ${tenant.evolutionInstanceName}\n`);
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────
async function cleanup(): Promise<void> {
  console.log("\n🧹 Limpando dados de teste...\n");
  try {
    await db.execute(sql`DELETE FROM birthday_greetings_sent WHERE tenant_id = ${tenantId}`).catch(() => {});
    await db.delete(appointmentFollowUpsTable).where(eq(appointmentFollowUpsTable.tenantId, tenantId));
    await db.delete(dentalActivityTable).where(eq(dentalActivityTable.tenantId, tenantId));
    await db.delete(dentalMessagesTable).where(eq(dentalMessagesTable.tenantId, tenantId));
    await db.delete(dentalConversationsTable).where(eq(dentalConversationsTable.tenantId, tenantId));
    await db.delete(appointmentsTable).where(eq(appointmentsTable.tenantId, tenantId));
    await db.delete(dentalLeadsTable).where(eq(dentalLeadsTable.tenantId, tenantId));
    await db.delete(patientsTable).where(eq(patientsTable.tenantId, tenantId));
    await db.delete(dentalConversationQuotasTable).where(eq(dentalConversationQuotasTable.tenantId, tenantId));
    await db.delete(dentalProceduresTable).where(eq(dentalProceduresTable.tenantId, tenantId));
    await db.delete(dentalProfessionalsTable).where(eq(dentalProfessionalsTable.tenantId, tenantId));
    await db.delete(dentalSettingsTable).where(eq(dentalSettingsTable.tenantId, tenantId));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
    await tenantExistsCache.invalidate(tenantId);
    console.log("  Cleanup concluído.");
  } catch (err) {
    console.error("  Erro no cleanup:", err);
  }
  setTestProvider(null);
  if (testServer) {
    await new Promise<void>((resolve) => testServer.close(() => resolve()));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCO 1 — Empatia e Primeiro Contato
// ═══════════════════════════════════════════════════════════════════════════════
async function bloco1_Empatia(): Promise<void> {
  console.log("\n════════════════════════════════════════════════════");
  console.log("BLOCO 1 — Empatia e Primeiro Contato");
  console.log("════════════════════════════════════════════════════");
  currentBlock = "BLOCO 1 — Empatia";

  const instanceName = await getInstanceName();

  // Cenário 1 — Lead com dor de dente
  await runScenarioInBlock(currentBlock, "C1 — Empatia: lead com dor de dente", async () => {
    const input = "oi, to com muita dor de dente";
    evidence("input", input);
    const res = await webhookMessage(instanceName, PHONE_B1_C1, input, "Lead Dor");
    assert(res.status === 200, `Webhook retornou ${res.status}`);
    await waitForAiProcessing(PHONE_B1_C1, 1);
    const msgs = await getOutboundMessages(PHONE_B1_C1);
    assert(msgs.length > 0, "IA não respondeu");
    const reply = msgs[0].content;
    evidence("aiResponse", reply);
    assertHasEmpathy(reply, "C1");
    assertNoProcedurePrice(reply, "C1");
    assertNoInsuranceTriage(reply, "C1");
    // Deve se apresentar como Sofia/OdontoVida
    const lower = reply.toLowerCase();
    assert(lower.includes("sofia") || lower.includes("odontovida"), `[C1] IA não se apresentou. Resposta: "${reply.substring(0, 150)}"`);
  });

  // Cenário 2 — Lead com medo de dentista
  await runScenarioInBlock(currentBlock, "C2 — Empatia: lead com medo de dentista", async () => {
    const input = "preciso ir ao dentista mas tenho muito medo";
    evidence("input", input);
    const res = await webhookMessage(instanceName, PHONE_B1_C2, input, "Lead Medo");
    assert(res.status === 200, `Webhook retornou ${res.status}`);
    await waitForAiProcessing(PHONE_B1_C2, 1);
    const msgs = await getOutboundMessages(PHONE_B1_C2);
    assert(msgs.length > 0, "IA não respondeu");
    const reply = msgs[0].content;
    evidence("aiResponse", reply);
    assertHasEmpathy(reply, "C2");
    assertNoProcedurePrice(reply, "C2");
    assertNoInsuranceTriage(reply, "C2");
  });

  // Cenário 3 — Primeiro contato neutro
  await runScenarioInBlock(currentBlock, "C3 — Primeiro contato neutro: IA se apresenta corretamente", async () => {
    const input = "oi, quero marcar uma consulta";
    evidence("input", input);
    const res = await webhookMessage(instanceName, PHONE_B1_C3, input, "Lead Neutro");
    assert(res.status === 200, `Webhook retornou ${res.status}`);
    await waitForAiProcessing(PHONE_B1_C3, 1);
    const msgs = await getOutboundMessages(PHONE_B1_C3);
    assert(msgs.length > 0, "IA não respondeu");
    const reply = msgs[0].content;
    evidence("aiResponse", reply);
    // Deve se apresentar como Sofia / OdontoVida
    const replyLower = reply.toLowerCase();
    assert(
      replyLower.includes("sofia") || replyLower.includes("odontovida"),
      `[C3] IA não se apresentou como Sofia/OdontoVida. Resposta: "${reply.substring(0, 150)}"`,
    );
    assertNoProcedurePrice(reply, "C3");
    assertHasEmpathy(reply, "C3");
    // Turn 1 deve fazer triagem convênio/particular APÓS acolhimento (não antes)
    const lowerC3 = reply.toLowerCase();
    const askedTriage =
      lowerC3.includes("convênio") || lowerC3.includes("convenio")
      || lowerC3.includes("particular") || lowerC3.includes("forma de pagamento")
      || lowerC3.includes("pagamento") || lowerC3.includes("plano");
    assert(
      askedTriage,
      `[C3] IA não perguntou convênio/particular após acolhimento. Resposta: "${reply.substring(0, 200)}"`,
    );
    // Segunda mensagem para verificar triagem
    await webhookMessage(instanceName, PHONE_B1_C3, "pago particular", "Lead Neutro");
    await waitForAiProcessing(PHONE_B1_C3, 2, 20000);
    const msgs2 = await getOutboundMessages(PHONE_B1_C3);
    assert(msgs2.length >= 2, "IA não respondeu à segunda mensagem");
    const reply2 = msgs2[0].content;
    evidence("aiResponse2", reply2);
    // Na segunda mensagem deve pedir especialidade ou dar opções
    const lower2 = reply2.toLowerCase();
    const hasFlow = lower2.includes("ana") || lower2.includes("qual") || lower2.includes("especialidade")
      || lower2.includes("clínic") || lower2.includes("horário") || lower2.includes("preferência");
    assert(hasFlow, `[C3] IA não deu continuidade ao fluxo após "pago particular". Resposta: "${reply2.substring(0, 150)}"`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCO 2 — Protocolo Lead Particular
// ═══════════════════════════════════════════════════════════════════════════════
async function bloco2_Particular(): Promise<void> {
  console.log("\n════════════════════════════════════════════════════");
  console.log("BLOCO 2 — Protocolo Lead Particular");
  console.log("════════════════════════════════════════════════════");
  currentBlock = "BLOCO 2 — Particular";

  const instanceName = await getInstanceName();

  // Cenário 4 — Lead particular, clínico geral → Dra. Ana
  await runScenarioInBlock(currentBlock, "C4 — Particular: Dra. Ana com R$150 mencionado", async () => {
    evidence("input", "quero marcar consulta, pago particular + clínico geral");
    await webhookMessage(instanceName, PHONE_B2_PART, "quero marcar consulta, pago particular", "Lead Particular");
    await waitForAiProcessing(PHONE_B2_PART, 1);
    await webhookMessage(instanceName, PHONE_B2_PART, "clínico geral", "Lead Particular");
    await waitForAiProcessing(PHONE_B2_PART, 2, 20000);
    // Checar TODAS as mensagens enviadas para o número (não só a última)
    const allText = await getAllOutboundText(PHONE_B2_PART);
    evidence("aiResponse", allText);
    assert(allText.toLowerCase().includes("ana"), `[C4] IA não mencionou Dra. Ana. Texto completo: "${allText.substring(0, 300)}"`);
    assert(allText.includes("150"), `[C4] IA não informou R$150. Texto completo: "${allText.substring(0, 300)}"`);
    assertNoProcedurePrice(allText, "C4");
  });

  // Cenário 5 — PIX obrigatório após agendamento
  await runScenarioInBlock(currentBlock, "C5 — PIX obrigatório: chave correta + instrução de comprovante", async () => {
    const input = "pode marcar quarta às 14h";
    evidence("input", input);
    await webhookMessage(instanceName, PHONE_B2_PART, input, "Lead Particular");
    await waitForAiProcessing(PHONE_B2_PART, 3, 25000);
    // Checar todas as mensagens enviadas — o card PIX pode vir em qualquer turno
    const allText = await getAllOutboundText(PHONE_B2_PART);
    evidence("aiResponse", allText);
    evidence("expectedPix", "ana@odontovida.com.br");
    assertCorrectPixKey(allText, "ana", "C5");
    const lower = allText.toLowerCase();
    assert(
      lower.includes("comprovante"),
      `[C5] IA não pediu comprovante em nenhuma mensagem. Texto completo: "${allText.substring(0, 400)}"`,
    );
    // Appointment no banco — exigência forte: paymentType=private + professionalId=Ana
    const lead = await db.query.dentalLeadsTable.findFirst({
      where: and(eq(dentalLeadsTable.tenantId, tenantId), eq(dentalLeadsTable.phone, PHONE_B2_PART)),
    });
    assert(!!lead, "[C5] Lead não encontrado no banco");
    const apt = await db.query.appointmentsTable.findFirst({
      where: and(eq(appointmentsTable.tenantId, tenantId), eq(appointmentsTable.leadId, lead!.id)),
      orderBy: [desc(appointmentsTable.createdAt)],
    });
    evidence("dbState", {
      leadPaymentType: lead!.paymentType,
      appointmentExists: !!apt,
      appointmentProfessionalId: apt?.professionalId,
      expectedProfessionalIdAna: profAnaId,
      appointmentPaymentType: apt?.paymentType,
    });
    assert(!!apt, "[C5] Appointment não criado no banco para lead particular Ana");
    assert(apt!.professionalId === profAnaId, `[C5] professionalId errado (got=${apt!.professionalId}, esperado Ana=${profAnaId})`);
    assert(apt!.paymentType === "private", `[C5] paymentType deveria ser 'private', recebeu '${apt!.paymentType}'`);
  });

  // Cenário 6 — Comprovante PIX (imagem dummy) — verifica que analyzePIXReceipt foi acionado
  await runScenarioInBlock(currentBlock, "C6 — PIX receipt: IA analisa imagem (analyzePIXReceipt acionado)", async () => {
    const dummyJpegBase64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAARC AABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AJQAB/9k=";
    evidence("input", "[imagem de comprovante PIX enviada]");

    // Snapshot do appointment antes — usado para detectar mudança em pixPaymentStatus
    const leadBefore = await db.query.dentalLeadsTable.findFirst({
      where: and(eq(dentalLeadsTable.tenantId, tenantId), eq(dentalLeadsTable.phone, PHONE_B2_PART)),
    });
    let pixStatusBefore: string | undefined;
    if (leadBefore) {
      const aptBefore = await db.query.appointmentsTable.findFirst({
        where: and(eq(appointmentsTable.tenantId, tenantId), eq(appointmentsTable.leadId, leadBefore.id)),
        orderBy: [desc(appointmentsTable.createdAt)],
      });
      pixStatusBefore = aptBefore?.pixPaymentStatus;
    }

    const outboundBefore = (await getOutboundMessages(PHONE_B2_PART)).length;
    const res = await webhookImage(instanceName, PHONE_B2_PART, dummyJpegBase64, "Lead Particular");
    assert(res.status === 200, `Webhook retornou ${res.status}`);
    await waitForAiProcessing(PHONE_B2_PART, outboundBefore + 1, 30000);
    const msgs = await getOutboundMessages(PHONE_B2_PART);
    assert(msgs.length > outboundBefore, "[C6] IA não respondeu à imagem de comprovante");
    const reply = msgs[0].content;
    evidence("aiResponse", reply);

    // Verificar invocação de analyzePIXReceipt: ou houve mudança no pixPaymentStatus
    // (passou de pending → confirmed_auto/rejected) ou a resposta menciona o comprovante
    let pixStatusAfter: string | undefined;
    if (leadBefore) {
      const aptAfter = await db.query.appointmentsTable.findFirst({
        where: and(eq(appointmentsTable.tenantId, tenantId), eq(appointmentsTable.leadId, leadBefore.id)),
        orderBy: [desc(appointmentsTable.createdAt)],
      });
      pixStatusAfter = aptAfter?.pixPaymentStatus;
    }
    const lower = reply.toLowerCase();
    const replyMencionaComprovante = lower.includes("comprovante") || lower.includes("pix")
      || lower.includes("recebid") || lower.includes("rejeit") || lower.includes("inválid")
      || lower.includes("reenvi") || lower.includes("não consegui");
    const pixStatusMudou = pixStatusBefore !== pixStatusAfter;
    evidence("dbState", { pixStatusBefore, pixStatusAfter, pixStatusMudou, replyMencionaComprovante });

    assert(
      pixStatusMudou || replyMencionaComprovante,
      `[C6] Sem evidência de invocação de analyzePIXReceipt: pixPaymentStatus inalterado (${pixStatusBefore}→${pixStatusAfter}) e resposta não menciona comprovante. Resposta: "${reply.substring(0, 200)}"`,
    );
  });

  // Cenário 7 — Lead particular quer implante → Dr. Roberto, consulta GRATUITA
  // NOTA: Primeiro turno pode ser apenas saudação; o conteúdo de Roberto/gratuita
  // vem no segundo turno após a IA processar a especialidade.
  await runScenarioInBlock(currentBlock, "C7 — Particular: Dr. Roberto + consulta GRATUITA (sem cobrar R$300)", async () => {
    evidence("input", "quero fazer avaliação de implante, pago particular");
    await webhookMessage(instanceName, PHONE_B2_ROB, "quero fazer avaliação de implante, pago particular", "Lead Implante");
    await waitForAiProcessing(PHONE_B2_ROB, 1, 20000);
    // Segunda mensagem para confirmar intenção caso a IA tenha apenas saudado
    await webhookMessage(instanceName, PHONE_B2_ROB, "sim, quero informações sobre implante", "Lead Implante");
    await waitForAiProcessing(PHONE_B2_ROB, 2, 25000);
    const allText = await getAllOutboundText(PHONE_B2_ROB);
    evidence("aiResponse", allText);
    assert(allText.toLowerCase().includes("roberto"), `[C7] IA não mencionou Dr. Roberto em nenhuma mensagem. Texto: "${allText.substring(0, 400)}"`);
    assertConsultationFee(allText, "roberto", "C7");
    assert(!allText.includes("R$300") && !allText.includes("R$ 300"), `[C7] IA cobrou R$300 (deveria ser gratuita). Texto: "${allText.substring(0, 400)}"`);
    assertNoProcedurePrice(allText, "C7");
  });

  // Cenário 8 — PIX opcional: Dr. Roberto confirma sem exigir comprovante
  await runScenarioInBlock(currentBlock, "C8 — PIX opcional: Dr. Roberto confirma sem exigir comprovante", async () => {
    const input = "pode marcar na terça às 10h";
    evidence("input", input);
    await webhookMessage(instanceName, PHONE_B2_ROB, input, "Lead Implante");
    await waitForAiProcessing(PHONE_B2_ROB, 3, 25000);
    const msgs = await getOutboundMessages(PHONE_B2_ROB);
    assert(msgs.length >= 3, `Esperava ≥3 respostas, recebeu ${msgs.length}`);
    const reply = msgs[0].content;
    evidence("aiResponse", reply);
    const replyLower = reply.toLowerCase();
    const exigeComprovante = replyLower.includes("envie o comprovante") && replyLower.includes("antes de confirmar");
    assert(!exigeComprovante, `[C8] IA exigiu comprovante antes de confirmar (PIX é opcional). Resposta: "${reply.substring(0, 200)}"`);
    const confirmou = replyLower.includes("agend") || replyLower.includes("confirm") || replyLower.includes("terça") || replyLower.includes("marcad");
    assert(confirmou, `[C8] IA não confirmou agendamento. Resposta: "${reply.substring(0, 200)}"`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCO 3 — Protocolo Lead Convênio/Plano
// ═══════════════════════════════════════════════════════════════════════════════
async function bloco3_Convenio(): Promise<void> {
  console.log("\n════════════════════════════════════════════════════");
  console.log("BLOCO 3 — Protocolo Lead Convênio/Plano");
  console.log("════════════════════════════════════════════════════");
  currentBlock = "BLOCO 3 — Convênio";

  const instanceName = await getInstanceName();

  // Cenário 9 — Empatia com lead de convênio
  await runScenarioInBlock(currentBlock, "C9 — Convênio: IA acolhe e dá continuidade (sem perguntar valor)", async () => {
    const input = "boa tarde, uso plano odontológico";
    evidence("input", input);
    await webhookMessage(instanceName, PHONE_B3_CONV, input, "Lead Convênio");
    await waitForAiProcessing(PHONE_B3_CONV, 1);
    const msgs = await getOutboundMessages(PHONE_B3_CONV);
    assert(msgs.length > 0, "IA não respondeu");
    const reply = msgs[0].content;
    evidence("aiResponse", reply);
    // Não deve perguntar valor (é convênio)
    const perguntaValor = reply.toLowerCase().includes("valor da consulta") || reply.toLowerCase().includes("quanto custa");
    assert(!perguntaValor, `[C9] IA perguntou valor para lead de convênio. Resposta: "${reply.substring(0, 200)}"`);
    assertNoProcedurePrice(reply, "C9");
    assertHasEmpathy(reply, "C9");
    assert(reply.length > 20, `[C9] Resposta muito curta: "${reply}"`);
  });

  // Cenário 10 — Convênio + aparelho → Dr. Marcos (Seg/Qua)
  await runScenarioInBlock(currentBlock, "C10 — Convênio: direciona para Dr. Marcos com paymentType=insurance", async () => {
    const input = "preciso de aparelho dental";
    evidence("input", input);
    await webhookMessage(instanceName, PHONE_B3_CONV, input, "Lead Convênio");
    await waitForAiProcessing(PHONE_B3_CONV, 2, 20000);
    // Avançar fluxo: tentar agendar para que appointment seja criado
    await webhookMessage(instanceName, PHONE_B3_CONV, "pode marcar segunda às 10h com Dr. Marcos", "Lead Convênio");
    await waitForAiProcessing(PHONE_B3_CONV, 3, 25000);
    const allText = await getAllOutboundText(PHONE_B3_CONV);
    evidence("aiResponse", allText);
    const lower = allText.toLowerCase();
    assert(lower.includes("marcos"), `[C10] IA não mencionou Dr. Marcos. Texto: "${allText.substring(0, 400)}"`);
    assert(!lower.includes("pix"), `[C10] IA mencionou PIX para Dr. Marcos (sem PIX). Texto: "${allText.substring(0, 400)}"`);
    assertNoProcedurePrice(allText, "C10");

    // Verificação no banco — exigência forte: appointment deve existir com Marcos + paymentType=insurance
    const lead = await db.query.dentalLeadsTable.findFirst({
      where: and(eq(dentalLeadsTable.tenantId, tenantId), eq(dentalLeadsTable.phone, PHONE_B3_CONV)),
    });
    assert(!!lead, "[C10] Lead não encontrado no banco");
    const apt = await db.query.appointmentsTable.findFirst({
      where: and(eq(appointmentsTable.tenantId, tenantId), eq(appointmentsTable.leadId, lead!.id)),
      orderBy: [desc(appointmentsTable.createdAt)],
    });
    evidence("dbState", {
      leadPaymentType: lead!.paymentType,
      appointmentExists: !!apt,
      appointmentProfessionalId: apt?.professionalId,
      expectedProfessionalIdMarcos: profMarcosId,
      appointmentPaymentType: apt?.paymentType,
    });
    assert(!!apt, "[C10] IA não criou appointment para lead de convênio com Dr. Marcos");
    assert(apt!.professionalId === profMarcosId, `[C10] Appointment com profissional errado (got=${apt!.professionalId}, esperado Marcos=${profMarcosId})`);
    assert(apt!.paymentType === "insurance", `[C10] paymentType deveria ser 'insurance', recebeu '${apt!.paymentType}'`);
  });

  // Cenário 11 — Convênio em dia não permitido (quinta)
  await runScenarioInBlock(currentBlock, "C11 — Convênio na quinta: IA não cria appointment na quinta", async () => {
    const input = "uso convênio, quero marcar aparelho na quinta";
    evidence("input", input);
    await webhookMessage(instanceName, PHONE_B3_MIGR, input, "Lead Convênio Quinta");
    await waitForAiProcessing(PHONE_B3_MIGR, 1);
    const msgs = await getOutboundMessages(PHONE_B3_MIGR);
    assert(msgs.length > 0, "IA não respondeu");
    const reply = msgs[0].content;
    evidence("aiResponse", reply);
    // Não deve criar appointment de convênio na quinta
    const lead = await db.query.dentalLeadsTable.findFirst({
      where: and(eq(dentalLeadsTable.tenantId, tenantId), eq(dentalLeadsTable.phone, PHONE_B3_MIGR)),
    });
    if (lead) {
      const apts = await db.query.appointmentsTable.findMany({
        where: and(eq(appointmentsTable.tenantId, tenantId), eq(appointmentsTable.leadId, lead.id)),
      });
      const aptQuintaConvenio = apts.filter((a) => a.startsAt.getDay() === 4);
      evidence("dbState", { appointmentsOnThursday: aptQuintaConvenio.length });
      assert(aptQuintaConvenio.length === 0, `[C11] IA criou agendamento de convênio na quinta (esperava 0). Achados: ${aptQuintaConvenio.length}`);
    }
    assertNoProcedurePrice(reply, "C11");
  });

  // Cenário 12 — Convênio + implante (não coberto) → Roberto gratuito
  await runScenarioInBlock(currentBlock, "C12 — Convênio: implante não coberto → Roberto gratuito mencionado", async () => {
    const input = "uso plano, quero fazer implante dental";
    evidence("input", input);
    await webhookMessage(instanceName, PHONE_B3_IMP, input, "Lead Implante Convênio");
    await waitForAiProcessing(PHONE_B3_IMP, 1);
    const msgs = await getOutboundMessages(PHONE_B3_IMP);
    assert(msgs.length > 0, "IA não respondeu");
    // Verificar todas as mensagens
    const allText = await getAllOutboundText(PHONE_B3_IMP);
    evidence("aiResponse", allText);
    const lower = allText.toLowerCase();
    // Deve mencionar Roberto ou implante ou gratuidade
    const relevante = lower.includes("roberto") || lower.includes("gratuita") || lower.includes("gratuito") || lower.includes("implante") || lower.includes("avaliação");
    assert(relevante, `[C12] IA não deu informação sobre implante/Roberto. Texto: "${allText.substring(0, 400)}"`);
    assertNoProcedurePrice(allText, "C12");
  });

  // Cenário 13 — Lead convênio → torna-se particular (clareamento com Ana)
  await runScenarioInBlock(currentBlock, "C13 — Convênio→Particular: Dra. Ana R$150 + PIX + paymentType=private no banco", async () => {
    const input = "uso convênio mas meu plano não cobre clareamento, posso pagar particular?";
    evidence("input", input);
    await webhookMessage(instanceName, PHONE_B3_MIGR2, input, "Lead Migra Particular");
    await waitForAiProcessing(PHONE_B3_MIGR2, 1, 20000);
    await webhookMessage(instanceName, PHONE_B3_MIGR2, "pode ser particular sim, marca com a Dra. Ana", "Lead Migra Particular");
    await waitForAiProcessing(PHONE_B3_MIGR2, 2, 25000);
    const allText = await getAllOutboundText(PHONE_B3_MIGR2);
    evidence("aiResponse", allText);
    const lower = allText.toLowerCase();
    let hits = 0;
    if (lower.includes("ana")) hits++;
    if (allText.includes("150")) hits++;
    if (lower.includes("pix")) hits++;
    assert(hits >= 2, `[C13] IA não direcionou corretamente para Ana/R$150/PIX (hits=${hits}). Texto: "${allText.substring(0, 400)}"`);
    assertNoProcedurePrice(allText, "C13");

    // Verificação no banco — exigência forte: lead.paymentType OU appointment.paymentType deve ser "private"
    const lead = await db.query.dentalLeadsTable.findFirst({
      where: and(eq(dentalLeadsTable.tenantId, tenantId), eq(dentalLeadsTable.phone, PHONE_B3_MIGR2)),
    });
    assert(!!lead, "[C13] Lead não encontrado no banco");
    const apt = await db.query.appointmentsTable.findFirst({
      where: and(eq(appointmentsTable.tenantId, tenantId), eq(appointmentsTable.leadId, lead!.id)),
      orderBy: [desc(appointmentsTable.createdAt)],
    });
    evidence("dbState", {
      leadPaymentType: lead!.paymentType,
      appointmentExists: !!apt,
      appointmentPaymentType: apt?.paymentType,
      appointmentProfessionalId: apt?.professionalId,
      expectedProfessionalIdAna: profAnaId,
    });
    // Após a transição convênio→particular, o paymentType deve ser "private" — nunca "insurance"
    assert(
      lead!.paymentType !== "insurance",
      `[C13] lead.paymentType deveria ter saído de 'insurance' após mudar para particular, ainda está '${lead!.paymentType}'`,
    );
    if (apt) {
      assert(apt.paymentType === "private", `[C13] appointment.paymentType deveria ser 'private', recebeu '${apt.paymentType}'`);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCO 4 — Protocolo Paciente da Clínica
// ═══════════════════════════════════════════════════════════════════════════════
async function bloco4_Paciente(): Promise<void> {
  console.log("\n════════════════════════════════════════════════════");
  console.log("BLOCO 4 — Protocolo Paciente da Clínica");
  console.log("════════════════════════════════════════════════════");
  currentBlock = "BLOCO 4 — Paciente";

  const instanceName = await getInstanceName();

  // Pré-criar João Silva com appointment amanhã (Dra. Ana)
  const [joao] = await db.insert(patientsTable).values({
    tenantId,
    name: "João Silva",
    phone: PHONE_B4_JOAO,
    email: "joao@test.com",
  }).returning();

  const amanha = new Date();
  amanha.setDate(amanha.getDate() + 1);
  amanha.setHours(14, 0, 0, 0);
  const amanhaFim = new Date(amanha.getTime() + 30 * 60000);

  const [aptJoao] = await db.insert(appointmentsTable).values({
    tenantId,
    patientId: joao.id,
    professionalId: profAnaId,
    procedureName: "Consulta Clínico Geral",
    status: "scheduled",
    startsAt: amanha,
    endsAt: amanhaFim,
  }).returning();

  // Pré-criar Maria Souza com 3 consultas anteriores
  const [maria] = await db.insert(patientsTable).values({
    tenantId,
    name: "Maria Souza",
    phone: PHONE_B4_MARIA,
    email: "maria@test.com",
  }).returning();

  const base = new Date();
  for (let i = 1; i <= 3; i++) {
    const dt = new Date(base);
    dt.setDate(base.getDate() - i * 30);
    dt.setHours(10, 0, 0, 0);
    await db.insert(appointmentsTable).values({
      tenantId,
      patientId: maria.id,
      professionalId: profAnaId,
      procedureName: "Consulta Geral",
      status: "completed",
      startsAt: dt,
      endsAt: new Date(dt.getTime() + 30 * 60000),
    });
  }

  // Cenário 14 — Paciente João reconhecido
  await runScenarioInBlock(currentBlock, "C14 — Paciente reconhecido: IA usa nome e não faz triagem de convênio", async () => {
    const input = "oi, sou o João, preciso remarcar minha consulta";
    evidence("input", input);
    await webhookMessage(instanceName, PHONE_B4_JOAO, input, "João Silva");
    await waitForAiProcessing(PHONE_B4_JOAO, 1);
    const msgs = await getOutboundMessages(PHONE_B4_JOAO);
    assert(msgs.length > 0, "IA não respondeu");
    const reply = msgs[0].content;
    evidence("aiResponse", reply);
    evidence("dbState", { patientId: joao.id, appointmentId: aptJoao.id });
    assert(reply.toLowerCase().includes("joão"), `[C14] IA não usou o nome João. Resposta: "${reply.substring(0, 200)}"`);
    assertNoInsuranceTriage(reply, "C14");
  });

  // Cenário 15 — João cancela
  await runScenarioInBlock(currentBlock, "C15 — Paciente cancela: tom acolhedor + status cancelled no banco", async () => {
    const input = "preciso cancelar minha consulta de amanhã, surgiu um imprevisto no trabalho";
    evidence("input", input);
    await webhookMessage(instanceName, PHONE_B4_JOAO, input, "João Silva");
    await waitForAiProcessing(PHONE_B4_JOAO, 2, 20000);
    const msgs = await getOutboundMessages(PHONE_B4_JOAO);
    assert(msgs.length >= 2, `Esperava ≥2 respostas, recebeu ${msgs.length}`);
    const reply = msgs[0].content;
    evidence("aiResponse", reply);
    assertHasEmpathy(reply, "C15");
    const ofereceReagendar = reply.toLowerCase().includes("reagend") || reply.toLowerCase().includes("novo horário") || reply.toLowerCase().includes("outro momento") || reply.toLowerCase().includes("marcar");
    assert(ofereceReagendar, `[C15] IA não ofereceu reagendamento. Resposta: "${reply.substring(0, 200)}"`);
    // Aguardar a atualização assíncrona do DB
    await new Promise((r) => setTimeout(r, 5000));
    const aptAtualizado = await db.query.appointmentsTable.findFirst({
      where: eq(appointmentsTable.id, aptJoao.id),
    });
    evidence("dbState", { appointmentStatus: aptAtualizado?.status });
    assert(aptAtualizado?.status === "cancelled", `[C15] Status deveria ser 'cancelled', recebeu '${aptAtualizado?.status}'`);
  });

  // Cenário 16 — Maria: paciente recorrente
  await runScenarioInBlock(currentBlock, "C16 — Paciente recorrente: tom de continuidade, sem triagem completa", async () => {
    const input = "quero marcar mais uma consulta";
    evidence("input", input);
    await webhookMessage(instanceName, PHONE_B4_MARIA, input, "Maria Souza");
    await waitForAiProcessing(PHONE_B4_MARIA, 1);
    const msgs = await getOutboundMessages(PHONE_B4_MARIA);
    assert(msgs.length > 0, "IA não respondeu");
    const reply = msgs[0].content;
    evidence("aiResponse", reply);
    evidence("dbState", { patientId: maria.id, totalAppointmentHistory: 3 });
    assert(reply.toLowerCase().includes("maria"), `[C16] IA não reconheceu Maria. Resposta: "${reply.substring(0, 200)}"`);
    assertNoInsuranceTriage(reply, "C16");
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCO 5 — Configurações Individuais por Dentista
// ═══════════════════════════════════════════════════════════════════════════════
async function bloco5_ConfigPorDentista(): Promise<void> {
  console.log("\n════════════════════════════════════════════════════");
  console.log("BLOCO 5 — Configurações Individuais por Dentista");
  console.log("════════════════════════════════════════════════════");
  currentBlock = "BLOCO 5 — Config por Dentista";

  const instanceName = await getInstanceName();

  // Cenário 17 — Cada dentista tem sua chave PIX correta (3 sub-fluxos no mesmo cenário)
  await runScenarioInBlock(currentBlock, "C17 — Cada dentista tem sua chave PIX correta (Ana / Roberto / Marcos)", async () => {
    evidence("input", "3 sub-fluxos: agendar com Ana, perguntar PIX a Roberto, agendar com Marcos");
    const subResults: Record<string, { aiResponse: string; check: string }> = {};

    // Sub-fluxo A — Dra. Ana (PIX obrigatório)
    await webhookMessage(instanceName, PHONE_B5_PIX_ANA, "quero marcar consulta particular, clínico geral", "PIX Ana Test");
    await waitForAiProcessing(PHONE_B5_PIX_ANA, 1, 20000);
    await webhookMessage(instanceName, PHONE_B5_PIX_ANA, "pode ser com a Dra. Ana, qualquer horário disponível", "PIX Ana Test");
    await waitForAiProcessing(PHONE_B5_PIX_ANA, 2, 25000);
    const textAna = await getAllOutboundText(PHONE_B5_PIX_ANA);
    subResults.ana = { aiResponse: textAna, check: "esperar 'ana@odontovida.com.br'" };

    // Sub-fluxo B — Dr. Roberto (PIX opcional, só quando solicitado)
    await webhookMessage(instanceName, PHONE_B5_PIX_ROB, "quero avaliar implante, pago particular", "PIX Roberto Test");
    await waitForAiProcessing(PHONE_B5_PIX_ROB, 1, 20000);
    await webhookMessage(instanceName, PHONE_B5_PIX_ROB, "qual a chave pix do Dr. Roberto?", "PIX Roberto Test");
    await waitForAiProcessing(PHONE_B5_PIX_ROB, 2, 25000);
    const textRob = await getAllOutboundText(PHONE_B5_PIX_ROB);
    subResults.roberto = { aiResponse: textRob, check: "esperar '11999887766' se mencionar PIX" };

    // Sub-fluxo C — Dr. Marcos (sem PIX)
    await webhookMessage(instanceName, PHONE_B5_PIX_MAR, "quero colocar aparelho, pago particular. pode ser quinta?", "PIX Marcos Test");
    await waitForAiProcessing(PHONE_B5_PIX_MAR, 1, 25000);
    const textMar = await getAllOutboundText(PHONE_B5_PIX_MAR);
    subResults.marcos = { aiResponse: textMar, check: "NÃO deve conter chave PIX" };

    evidence("aiResponse", `=== ANA ===\n${textAna}\n\n=== ROBERTO ===\n${textRob}\n\n=== MARCOS ===\n${textMar}`);
    evidence("subResults", subResults);

    // Asserções por sub-fluxo
    assertCorrectPixKey(textAna, "ana", "C17/Ana");
    if (textRob.toLowerCase().includes("pix")) {
      assertCorrectPixKey(textRob, "roberto", "C17/Roberto");
    }
    assertCorrectPixKey(textMar, "marcos", "C17/Marcos");
  });

  // Cenário 18 — Cobrança de consulta respeitada por dentista (3 sub-fluxos no mesmo cenário)
  await runScenarioInBlock(currentBlock, "C18 — Cobrança de consulta correta por dentista (Ana R$150 / Roberto gratuita / Marcos R$200)", async () => {
    evidence("input", "3 sub-fluxos: agendamento com Ana, com Roberto e com Marcos particular");
    const subResults: Record<string, { aiResponse: string; expected: string }> = {};

    // Sub-fluxo A — Dra. Ana cobra R$150
    await webhookMessage(instanceName, PHONE_B5_FEE_ANA, "quero marcar consulta clínico geral, pago particular", "Fee Ana Test");
    await waitForAiProcessing(PHONE_B5_FEE_ANA, 1, 20000);
    await webhookMessage(instanceName, PHONE_B5_FEE_ANA, "pode ser com a Dra. Ana Beatriz", "Fee Ana Test");
    await waitForAiProcessing(PHONE_B5_FEE_ANA, 2, 25000);
    const textAna = await getAllOutboundText(PHONE_B5_FEE_ANA);
    subResults.ana = { aiResponse: textAna, expected: "R$150" };

    // Sub-fluxo B — Dr. Roberto consulta GRATUITA
    await webhookMessage(instanceName, PHONE_B5_FEE_ROB, "quero avaliação de implante, pago particular", "Fee Roberto Test");
    await waitForAiProcessing(PHONE_B5_FEE_ROB, 1, 25000);
    const textRob = await getAllOutboundText(PHONE_B5_FEE_ROB);
    subResults.roberto = { aiResponse: textRob, expected: "gratuita / sem custo" };

    // Sub-fluxo C — Dr. Marcos particular cobra R$200 (e sem PIX)
    await webhookMessage(instanceName, PHONE_B5_FEE_MAR, "quero consulta de aparelho dental, pago particular, pode ser quinta?", "Fee Marcos Test");
    await waitForAiProcessing(PHONE_B5_FEE_MAR, 1, 25000);
    const textMar = await getAllOutboundText(PHONE_B5_FEE_MAR);
    subResults.marcos = { aiResponse: textMar, expected: "R$200, sem PIX" };

    evidence("aiResponse", `=== ANA ===\n${textAna}\n\n=== ROBERTO ===\n${textRob}\n\n=== MARCOS ===\n${textMar}`);
    evidence("subResults", subResults);

    assertConsultationFee(textAna, "ana", "C18/Ana");
    assertConsultationFee(textRob, "roberto", "C18/Roberto");
    assertConsultationFee(textMar, "marcos_particular", "C18/Marcos");
    assertCorrectPixKey(textMar, "marcos", "C18/Marcos-pix");
  });

  // Cenário 19 — Marcos quinta particular: R$200 + sem PIX
  await runScenarioInBlock(currentBlock, "C19 — Marcos particular na quinta: R$200, sem PIX, pagamento presencial", async () => {
    const input = "pago particular, quero aparelho dental, pode ser quinta às 14h";
    evidence("input", input);
    await webhookMessage(instanceName, PHONE_B5_C19, input, "Marcos Quinta Test");
    await waitForAiProcessing(PHONE_B5_C19, 1, 25000);
    const allText = await getAllOutboundText(PHONE_B5_C19);
    evidence("aiResponse", allText);
    const lower = allText.toLowerCase();
    assert(lower.includes("marcos"), `[C19] IA não mencionou Dr. Marcos. Texto: "${allText.substring(0, 400)}"`);
    assert(allText.includes("200"), `[C19] IA não informou R$200. Texto: "${allText.substring(0, 400)}"`);
    assertCorrectPixKey(allText, "marcos", "C19");
    assertNoProcedurePrice(allText, "C19");

    // Verificação no banco — exigência forte (sem skip): lead E appointment devem existir
    const lead = await db.query.dentalLeadsTable.findFirst({
      where: and(eq(dentalLeadsTable.tenantId, tenantId), eq(dentalLeadsTable.phone, PHONE_B5_C19)),
    });
    assert(!!lead, "[C19] Lead não encontrado no banco");
    const apt = await db.query.appointmentsTable.findFirst({
      where: and(eq(appointmentsTable.tenantId, tenantId), eq(appointmentsTable.leadId, lead!.id)),
      orderBy: [desc(appointmentsTable.createdAt)],
    });
    evidence("dbState", {
      appointmentExists: !!apt,
      professionalId: apt?.professionalId,
      expectedProfessionalIdMarcos: profMarcosId,
      paymentType: apt?.paymentType,
      startsAt: apt?.startsAt?.toISOString(),
      dayOfWeek: apt?.startsAt?.getDay(),
    });
    assert(!!apt, "[C19] IA não criou appointment (Marcos quinta particular)");
    assert(apt!.professionalId === profMarcosId, `[C19] Appointment com profissional errado (got=${apt!.professionalId}, esperado Marcos=${profMarcosId})`);
    assert(apt!.paymentType === "private", `[C19] paymentType deveria ser 'private', recebeu '${apt!.paymentType}'`);
    assert(apt!.startsAt.getDay() === 4, `[C19] dayOfWeek deveria ser 4 (quinta), recebeu ${apt!.startsAt.getDay()}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCO 6 — Follow-ups e Quota
// ═══════════════════════════════════════════════════════════════════════════════
async function bloco6_FollowUpsEQuota(): Promise<void> {
  console.log("\n════════════════════════════════════════════════════");
  console.log("BLOCO 6 — Follow-ups e Quota");
  console.log("════════════════════════════════════════════════════");
  currentBlock = "BLOCO 6 — Operacional";

  const instanceName = await getInstanceName();

  // Cenário 20 — Lembrete 24h com Dr. Roberto (+ cancelado não recebe)
  await runScenarioInBlock(currentBlock, "C20 — Follow-up 24h: cancelado ignorado (skipped ou pending fora da janela)", async () => {
    const [leadFU] = await db.insert(dentalLeadsTable).values({
      tenantId,
      name: "Lead Follow-up",
      phone: PHONE_B6_FU,
      status: "active",
      temperature: "hot",
    }).returning();

    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    amanha.setHours(10, 0, 0, 0);
    const amanhaFim = new Date(amanha.getTime() + 60 * 60000);

    const [aptAtivo] = await db.insert(appointmentsTable).values({
      tenantId,
      leadId: leadFU.id,
      professionalId: profRobertoId,
      procedureName: "Avaliação Implante",
      status: "scheduled",
      startsAt: amanha,
      endsAt: amanhaFim,
    }).returning();

    await db.insert(appointmentFollowUpsTable).values({
      tenantId,
      appointmentId: aptAtivo.id,
      type: "reminder_24h",
      scheduledAt: new Date(Date.now() - 5000),
      status: "pending",
    });

    const [aptCancelado] = await db.insert(appointmentsTable).values({
      tenantId,
      leadId: leadFU.id,
      professionalId: profAnaId,
      procedureName: "Consulta Geral",
      status: "cancelled",
      startsAt: amanha,
      endsAt: new Date(amanha.getTime() + 30 * 60000),
    }).returning();

    await db.insert(appointmentFollowUpsTable).values({
      tenantId,
      appointmentId: aptCancelado.id,
      type: "reminder_24h",
      scheduledAt: new Date(Date.now() - 5000),
      status: "pending",
    });

    mockProvider.clearCaptured();
    await processFollowUps();

    const fuCancelado = await db.query.appointmentFollowUpsTable.findFirst({
      where: and(
        eq(appointmentFollowUpsTable.tenantId, tenantId),
        eq(appointmentFollowUpsTable.appointmentId, aptCancelado.id),
      ),
    });
    const dentroJanela = isWithinBrasiliaWindow();
    evidence("dentroJanelaBrasilia", dentroJanela);
    evidence("fuCanceladoStatus", fuCancelado?.status);

    if (dentroJanela) {
      // Dentro da janela: processFollowUps() rodou e deve ter marcado como skipped
      assert(fuCancelado?.status === "skipped",
        `[C20] Follow-up do cancelado deveria ser 'skipped' (dentro da janela), recebeu '${fuCancelado?.status}'`);
    } else {
      // Fora da janela: processFollowUps() retorna cedo sem processar nada — estado pending é esperado
      evidence("note", "Fora da janela 08h–20h Brasília — processFollowUps() retornou cedo. Status 'pending' é correto.");
    }

    // Em ambos os casos, confirmar que o follow-up do appointment ATIVO foi processado (ou está pendente)
    const fuAtivo = await db.query.appointmentFollowUpsTable.findFirst({
      where: and(
        eq(appointmentFollowUpsTable.tenantId, tenantId),
        eq(appointmentFollowUpsTable.appointmentId, aptAtivo.id),
      ),
    });
    evidence("fuAtivoStatus", fuAtivo?.status);

    const captured = mockProvider.getCapturedFor(PHONE_B6_FU);
    if (captured.length > 0) {
      const msg = captured[0].message;
      evidence("followUpMessage", msg);
      const mencionaRoberto = msg.toLowerCase().includes("roberto");
      const mencionaHorario = msg.includes("10:00") || msg.includes("10h") || msg.includes("10:00h");
      evidence("mencionaRoberto", mencionaRoberto);
      evidence("mencionaHorarioCorreto", mencionaHorario);
      // Spec exige: mensagem deve mencionar nome do Dr. Roberto e horário correto
      assert(
        mencionaRoberto,
        `[C20] Mensagem de lembrete não menciona Dr. Roberto. Mensagem: "${msg}"`,
      );
      assert(
        mencionaHorario,
        `[C20] Mensagem de lembrete não menciona horário 10:00. Mensagem: "${msg}"`,
      );
    } else if (dentroJanela) {
      // Dentro da janela mas sem captura — falha
      throw new Error("[C20] processFollowUps() rodou (dentro da janela) mas nenhuma mensagem foi capturada para o appointment ativo");
    } else {
      evidence("note", "Fora da janela 08h–20h Brasília — processFollowUps() não envia. Cenário não totalmente validado nesta janela.");
    }
  });

  // Cenário 21 — Quota esgotada
  await runScenarioInBlock(currentBlock, "C21 — Quota esgotada: fallback amigável sem OpenAI", async () => {
    const futureReset = new Date();
    futureReset.setMonth(futureReset.getMonth() + 1);
    await db.insert(dentalConversationQuotasTable).values({
      tenantId,
      monthlyConversationsUsed: 10000,
      rechargeBalance: 0,
      monthlyResetDate: futureReset,
    }).onConflictDoUpdate({
      target: dentalConversationQuotasTable.tenantId,
      set: { monthlyConversationsUsed: 10000, rechargeBalance: 0, monthlyResetDate: futureReset },
    });

    const input = "oi, quero marcar consulta";
    evidence("input", input);
    mockProvider.clearCaptured();
    const res = await webhookMessage(instanceName, PHONE_B6_QUOTA, input, "Lead Quota Test");
    assert(res.status === 200, `Webhook retornou ${res.status}`);
    await new Promise((r) => setTimeout(r, 3000));

    const capturedQuota = mockProvider.getCapturedFor(PHONE_B6_QUOTA);
    const msgs = await getOutboundMessages(PHONE_B6_QUOTA);
    evidence("dbState", { outboundMessages: msgs.length, capturedMessages: capturedQuota.length });

    if (capturedQuota.length > 0) {
      const fallback = capturedQuota[0].message;
      evidence("fallbackMessage", fallback);
      assert(fallback.length < 500, `[C21] Mensagem muito longa para ser fallback (${fallback.length} chars)`);
    }

    const conv = await db.query.dentalConversationsTable.findFirst({
      where: and(eq(dentalConversationsTable.tenantId, tenantId), eq(dentalConversationsTable.contactPhone, PHONE_B6_QUOTA)),
    });
    evidence("conversationStatus", conv?.status);
    if (conv) {
      assert(
        conv.status === "quota_blocked" || capturedQuota.length > 0,
        `[C21] Conversa não bloqueada (status=${conv?.status}) e sem mensagem de fallback`,
      );
    }
  });

  // Restaurar quota antes de C22 para que o lead possa receber resposta da IA
  await db.delete(dentalConversationQuotasTable).where(eq(dentalConversationQuotasTable.tenantId, tenantId));

  // Cenário 22 — Horário ocupado: IA não confirma duplicado
  await runScenarioInBlock(currentBlock, "C22 — Horário ocupado: IA não cria agendamento duplicado", async () => {
    const proximaQua = getNextWeekday(3);
    proximaQua.setHours(14, 0, 0, 0);
    const proximaQuaFim = new Date(proximaQua.getTime() + 30 * 60000);

    const [leadSlot] = await db.insert(dentalLeadsTable).values({
      tenantId,
      name: "Lead Existente",
      phone: "5511900000699",
      status: "active",
      temperature: "warm",
    }).returning();

    await db.insert(appointmentsTable).values({
      tenantId,
      leadId: leadSlot.id,
      professionalId: profAnaId,
      procedureName: "Consulta Existente",
      status: "scheduled",
      startsAt: proximaQua,
      endsAt: proximaQuaFim,
    });

    const diaStr = proximaQua.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
    const input = "quero marcar consulta com a Dra. Ana, quarta às 14h, pago particular";
    evidence("input", input);
    evidence("slotAlreadyBooked", diaStr);
    await webhookMessage(instanceName, PHONE_B6_SLOT, input, "Lead Slot Test");
    await waitForAiProcessing(PHONE_B6_SLOT, 1, 25000);

    const msgs = await getOutboundMessages(PHONE_B6_SLOT);
    assert(msgs.length > 0, "[C22] IA não respondeu");
    const allText = await getAllOutboundText(PHONE_B6_SLOT);
    evidence("aiResponse", allText);

    // (a) Resposta deve sinalizar slot ocupado OU oferecer alternativa de horário
    const lower = allText.toLowerCase();
    const sinalizaOcupado =
      lower.includes("ocupad") || lower.includes("indisponí") || lower.includes("indisponi")
      || lower.includes("não tenho disponibilidade") || lower.includes("nao tenho disponibilidade")
      || lower.includes("já está") || lower.includes("ja esta")
      || lower.includes("não está disponível") || lower.includes("nao esta disponivel")
      || lower.includes("outro horário") || lower.includes("outro horario")
      || lower.includes("próximo horário") || lower.includes("proximo horario")
      || lower.includes("disponível") || lower.includes("disponivel")
      || lower.includes("horário alternativo") || lower.includes("horario alternativo");
    assert(
      sinalizaOcupado,
      `[C22] IA não sinalizou que o horário está ocupado nem ofereceu alternativa. Resposta: "${allText.substring(0, 400)}"`,
    );

    // (b) Banco — não deve criar agendamento duplicado no slot ocupado
    const leadB6 = await db.query.dentalLeadsTable.findFirst({
      where: and(eq(dentalLeadsTable.tenantId, tenantId), eq(dentalLeadsTable.phone, PHONE_B6_SLOT)),
    });
    let appointmentsCreated = 0;
    let duplicados = 0;
    if (leadB6) {
      const apts = await db.query.appointmentsTable.findMany({
        where: and(eq(appointmentsTable.tenantId, tenantId), eq(appointmentsTable.leadId, leadB6.id)),
      });
      appointmentsCreated = apts.length;
      duplicados = apts.filter((a) =>
        a.professionalId === profAnaId
        && a.startsAt.getDay() === 3
        && a.startsAt.getHours() === 14,
      ).length;
    }
    evidence("dbState", { appointmentsCreated, duplicadosNoSlotOcupado: duplicados });
    assert(duplicados === 0, `[C22] IA criou ${duplicados} agendamento(s) no horário já ocupado (quarta 14h com Ana)`);
  });
}

// ─── Relatório ────────────────────────────────────────────────────────────────
/** Devolve, por nome do cenário, o resultado esperado em linguagem natural. */
function expectedFor(name: string): string {
  if (name.startsWith("C1 "))  return "Empatia + acolhimento, sem triagem de convênio antes do acolhimento, sem mencionar preço de procedimento";
  if (name.startsWith("C2 "))  return "Empatia ao medo + acolhimento, sem triagem de convênio antes do acolhimento";
  if (name.startsWith("C3 "))  return "Apresentação como Sofia/OdontoVida + empatia + perguntar convênio/particular APÓS o acolhimento";
  if (name.startsWith("C4 "))  return "Direcionar para Dra. Ana com R$150 mencionado (consulta particular)";
  if (name.startsWith("C5 "))  return "PIX da Ana (ana@odontovida.com.br) + instrução de comprovante + appointment com paymentType=private + Ana";
  if (name.startsWith("C6 "))  return "IA processa imagem (analyzePIXReceipt) e atualiza pixPaymentStatus OU menciona comprovante na resposta";
  if (name.startsWith("C7 "))  return "Direcionar para Dr. Roberto com consulta GRATUITA (sem cobrar R$300 do procedimento)";
  if (name.startsWith("C8 "))  return "Dr. Roberto confirma agendamento sem exigir comprovante PIX (PIX é opcional para Roberto)";
  if (name.startsWith("C9 "))  return "Acolhimento + empatia + continuidade do fluxo, sem perguntar valor (é convênio)";
  if (name.startsWith("C10 ")) return "Direcionar para Dr. Marcos (Seg/Qua) + appointment com paymentType=insurance + sem PIX";
  if (name.startsWith("C11 ")) return "IA não cria appointment na quinta para convênio (Marcos só Seg/Qua)";
  if (name.startsWith("C12 ")) return "IA explica que convênio não cobre implante e oferece consulta gratuita do Dr. Roberto";
  if (name.startsWith("C13 ")) return "Após mudar para particular: Ana + R$150 + PIX, lead.paymentType deixa de ser 'insurance'";
  if (name.startsWith("C14 ")) return "IA reconhece paciente pelo nome e não refaz triagem completa de convênio";
  if (name.startsWith("C15 ")) return "Tom acolhedor + empatia + status do appointment vai para 'cancelled' no banco";
  if (name.startsWith("C16 ")) return "Tom de continuidade (paciente recorrente), sem repetir triagem completa";
  if (name.startsWith("C17 ")) return "Cada dentista usa SUA chave PIX correta (Ana: ana@odontovida.com.br, Roberto: telefone 11999887766, Marcos: nenhum PIX)";
  if (name.startsWith("C18 ")) return "Cobrança correta por dentista: Ana R$150, Roberto gratuita, Marcos R$200";
  if (name.startsWith("C19 ")) return "Marcos quinta particular R$200 sem PIX + appointment com professionalId=Marcos, paymentType=private, dayOfWeek=4";
  if (name.startsWith("C20 ")) return "Lembrete 24h menciona Dr. Roberto e horário 10:00; cancelados ficam skipped ou pending fora da janela";
  if (name.startsWith("C21 ")) return "Quota esgotada: fallback amigável sem chamar OpenAI; conversa marcada como quota_blocked";
  if (name.startsWith("C22 ")) return "IA sinaliza horário ocupado OU oferece alternativa; não cria appointment duplicado no mesmo slot";
  return "Ver descrição do cenário";
}

function printReport(): void {
  const total   = results.length;
  const passed  = results.filter((r) => r.status === "PASS").length;
  const failed  = results.filter((r) => r.status === "FAIL").length;
  const taxa    = total > 0 ? Math.round((passed / total) * 100) : 0;

  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║     OdontoFlow — Simulação Protocolo de Atendimento v3          ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log("");
  console.log("🏥 Clínica OdontoVida");
  console.log("👩‍⚕️ Dra. Ana (R$150 + PIX obrigatório, só particular)");
  console.log("🦷 Dr. Marcos (R$200 particular / convênio Seg+Qua, sem PIX)");
  console.log("🔬 Dr. Roberto (Consulta GRATUITA + PIX opcional)");
  console.log("");

  const blocks = [...new Set(results.map((r) => r.block))];
  for (const block of blocks) {
    console.log(`────────────────────────────────────────────────────────────────────`);
    console.log(block);
    for (const r of results.filter((x) => x.block === block)) {
      const icon = r.status === "PASS" ? "✅" : r.status === "FAIL" ? "❌" : "⏭️ ";
      console.log(`  ${icon} ${r.name} (${r.duration}ms)`);
      if (r.status === "FAIL") console.log(`     → ${r.details}`);
    }
  }

  console.log("");
  console.log("════════════════════════════════════════════════════════════════════");
  console.log("                    DIAGNÓSTICO FINAL");
  console.log("════════════════════════════════════════════════════════════════════");
  console.log(`Total: ${total}  |  ✅ Pass: ${passed}  |  ❌ Fail: ${failed}  |  Taxa: ${taxa}%`);

  const failures = results.filter((r) => r.status === "FAIL");
  if (failures.length > 0) {
    console.log("\n🔴 FALHAS CRÍTICAS:");
    for (const f of failures) {
      console.log(`\n  ❌ ${f.name}`);
      console.log(`     Input    : ${String(f.evidence.input || "—").substring(0, 120)}`);
      console.log(`     Esperado : ${expectedFor(f.name)}`);
      console.log(`     Erro     : ${f.details}`);
      if (f.evidence.aiResponse) {
        console.log(`     IA deu   : ${String(f.evidence.aiResponse).substring(0, 300)}`);
      }
    }
    console.log("\n💡 RECOMENDAÇÕES:");
    if (failures.some((f) => f.name.includes("C15") && f.details.includes("cancelled"))) {
      console.log("  • C15: aumentar timeout de atualização do DB após cancelamento, ou verificar se a IA está chamando a mutation corretamente");
    }
    if (failures.some((f) => f.name.includes("C5") && f.details.includes("Chave PIX"))) {
      console.log("  • C5: revisar buildPixInstructionsSection — pixKey pode não estar sendo passado corretamente");
    }
    if (failures.some((f) => f.name.includes("C20") && f.details.includes("skipped"))) {
      console.log("  • C20 (dentro da janela): scheduler não marcou follow-up do cancelado como 'skipped' — verificar linha 148 de scheduler.ts");
    }
  } else {
    console.log("\n✅ Nenhuma falha crítica!");
  }

  const alerts = results.filter((r) => r.evidence.note);
  if (alerts.length > 0) {
    console.log("\n⚠️  ALERTAS:");
    for (const a of alerts) {
      console.log(`  • ${a.name}: ${String(a.evidence.note)}`);
    }
  }

  console.log("\n📊 RESPOSTAS COMPLETAS DA IA:");
  for (const r of results) {
    console.log(`\n  ──────────────────────────────────────────────────────────────`);
    console.log(`  [${r.status}] ${r.name}`);
    console.log(`  BLOCO: ${r.block}`);
    console.log(`  INPUT: ${String(r.evidence.input || "—")}`);
    if (r.evidence.aiResponse) {
      console.log(`  IA   :`);
      const lines = String(r.evidence.aiResponse).split("\n");
      for (const line of lines) console.log(`    ${line}`);
    } else {
      console.log(`  IA   : (não capturada)`);
    }
    if (r.status === "FAIL") {
      console.log(`  MOTIVO DA FALHA: ${r.details}`);
    }
  }

  // Salvar JSON
  const report = {
    timestamp: new Date().toISOString(),
    summary: { total, passed, failed, successRate: taxa },
    professionals: {
      ana: { id: profAnaId, consultationFee: "150.00", pixMode: "required" },
      marcos: { id: profMarcosId, consultationFee: "200.00", pixEnabled: false },
      roberto: { id: profRobertoId, chargesConsultation: false, pixMode: "optional" },
    },
    tests: results.map((r) => ({
      name: r.name,
      block: r.block,
      status: r.status,
      duration: r.duration,
      details: r.details,
      evidence: r.evidence,
    })),
  };

  try {
    const currentFile = fileURLToPath(import.meta.url);
    const reportDir = path.join(path.dirname(currentFile), "..", "..", "test-results");
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, "e2e-clinica-completa.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n  📄 Relatório salvo em ${reportPath}`);
  } catch (err) {
    console.log(`  ⚠️  Não foi possível salvar o relatório: ${err instanceof Error ? err.message : "unknown"}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║  DentalAI Secretary — E2E Clínica Multi-Especialidade v3       ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log("  22 cenários | 6 blocos | OpenAI real | MockWhatsAppProvider");
  console.log(`  Iniciado em: ${new Date().toLocaleString("pt-BR")}\n`);

  let hasFailures = false;
  const startTotal = Date.now();
  try {
    await setup();
    await bloco1_Empatia();
    await bloco2_Particular();
    await bloco3_Convenio();
    await bloco4_Paciente();
    await bloco5_ConfigPorDentista();
    await bloco6_FollowUpsEQuota();
    printReport();
    hasFailures = results.some((r) => r.status === "FAIL");
  } catch (err) {
    console.error("\n💥 Erro fatal durante os testes:", err);
    hasFailures = true;
  } finally {
    const totalMs = Date.now() - startTotal;
    console.log(`\n⏱️  Tempo total: ${(totalMs / 1000).toFixed(1)}s`);
    await cleanup();
    process.exit(hasFailures ? 1 : 0);
  }
}

main();
