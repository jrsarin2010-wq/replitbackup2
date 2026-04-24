import http from "http";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import {
  tenantsTable,
  dentalSettingsTable,
  dentalProceduresTable,
  dentalLeadsTable,
  patientsTable,
  appointmentsTable,
  dentalConversationsTable,
  dentalMessagesTable,
  dentalActivityTable,
  appointmentFollowUpsTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { processFollowUps, processBirthdayGreetings, ensureBirthdayTable, processLeadRemarketingForTenant } from "../scheduler";
import { MockWhatsappProvider, setTestProvider } from "../lib/whatsapp-provider";
import { tenantExistsCache } from "../lib/cache";
import type { CapturedMessage } from "../lib/whatsapp-provider";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import app from "../app";

const TEST_TENANT_SLUG = `e2e_test_${Date.now()}`;
const TEST_PHONE_LEAD = "5511999990001";
const TEST_PHONE_PATIENT = "5511999990002";
const TEST_PHONE_LEAD2 = "5511999990003";
const TEST_PHONE_COLD_LEAD = "5511999990004";
const TEST_PHONE_NOSHOW = "5511999990099";
const TEST_PHONE_BIRTHDAY = "5511999990055";
const TEST_PHONE_REMARKETING = "5511999990066";

interface TestEvidence {
  input?: string;
  aiResponse?: string;
  dbState?: Record<string, unknown>;
  apiResponse?: { status: number; body: Record<string, unknown> };
  [key: string]: unknown;
}

interface TestResult {
  name: string;
  status: "PASS" | "FAIL" | "SKIP";
  details: string;
  duration: number;
  evidence: TestEvidence;
}

interface ApiResponse {
  status: number;
  data: Record<string, unknown>;
}

const results: TestResult[] = [];
let tenantId: number;
let authToken: string;
let testServer: http.Server;
let BASE_URL: string;
let currentEvidence: TestEvidence = {};
let mockProvider: MockWhatsappProvider;

function getNextWeekday(targetDay: number): Date {
  const today = new Date();
  const diff = ((targetDay - today.getDay()) + 7) % 7 || 7;
  const next = new Date(today);
  next.setDate(today.getDate() + diff);
  next.setHours(0, 0, 0, 0);
  return next;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function evidence(key: string, value: unknown): void {
  currentEvidence[key] = value;
}

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  currentEvidence = {};
  try {
    await fn();
    const dur = Date.now() - start;
    results.push({ name, status: "PASS", details: "OK", duration: dur, evidence: { ...currentEvidence } });
    console.log(`  ✅ PASS: ${name} (${dur}ms)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const dur = Date.now() - start;
    results.push({ name, status: "FAIL", details: msg, duration: dur, evidence: { ...currentEvidence } });
    console.log(`  ❌ FAIL: ${name} — ${msg} (${dur}ms)`);
  }
}

async function api(method: string, path: string, body?: Record<string, unknown>, headers?: Record<string, string>): Promise<ApiResponse> {
  const url = `${BASE_URL}/api${path}`;
  const hdrs: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${authToken}`,
    ...headers,
  };
  const resp = await fetch(url, {
    method,
    headers: hdrs,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let data: Record<string, unknown>;
  try { data = JSON.parse(text) as Record<string, unknown>; } catch { data = { raw: text }; }
  return { status: resp.status, data };
}

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
        id: `test_msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
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

async function setup(): Promise<void> {
  console.log("\n🔧 Setting up test server and data...\n");

  mockProvider = new MockWhatsappProvider();
  setTestProvider(mockProvider);

  testServer = await new Promise<http.Server>((resolve) => {
    const srv = app.listen(0, () => {
      const addr = srv.address() as { port: number };
      BASE_URL = `http://localhost:${addr.port}`;
      console.log(`  Test server listening on ${BASE_URL}`);
      resolve(srv);
    });
  });

  const scheduleConfig = JSON.stringify([
    { day: "0", enabled: false, start: "08:00", end: "18:00" },
    { day: "1", enabled: true, start: "08:00", end: "18:00", morningEnd: "12:00", afternoonStart: "14:00" },
    { day: "2", enabled: true, start: "08:00", end: "18:00", morningEnd: "12:00", afternoonStart: "14:00" },
    { day: "3", enabled: true, start: "08:00", end: "18:00", morningEnd: "12:00", afternoonStart: "14:00" },
    { day: "4", enabled: true, start: "08:00", end: "18:00", morningEnd: "12:00", afternoonStart: "14:00" },
    { day: "5", enabled: true, start: "08:00", end: "18:00", morningEnd: "12:00", afternoonStart: "14:00" },
    { day: "6", enabled: false, start: "08:00", end: "12:00" },
  ]);

  const [tenant] = await db
    .insert(tenantsTable)
    .values({
      name: "Clinica Teste E2E",
      slug: TEST_TENANT_SLUG,
      email: `e2e_${Date.now()}@test.com`,
      plan: "premium",
      subscriptionStatus: "active",
      evolutionInstanceName: `e2e-test-${Date.now()}`,
    })
    .returning();
  tenantId = tenant.id;
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) throw new Error("JWT_SECRET is not set");
  authToken = jwt.sign({ tenantId }, jwtSecret, { expiresIn: "1h" });

  await db.insert(dentalSettingsTable).values({
    tenantId,
    clinicName: "Clinica Sorriso Teste",
    clinicPhone: "11999998888",
    clinicAddress: "Rua Teste, 123",
    professionalName: "Dr. Carlos Teste",
    specialties: "Clinica Geral, Implantodontia",
    workingHoursStart: "08:00",
    workingHoursEnd: "18:00",
    lunchStart: "12:00",
    lunchEnd: "14:00",
    slotDurationMinutes: 30,
    defaultLeadDurationMinutes: 15,
    defaultPatientDurationMinutes: 30,
    scheduleConfig,
    aiName: "Ana",
    personalityType: "warm",
    followUpReminder: true,
    followUpPostAppointment: true,
    noShowEnabled: true,
    noShowPatientContactHoursAfter: 1,
    remarketingEnabled: true,
    remarketingIntervalHot: 2,
    remarketingIntervalWarm: 4,
    remarketingIntervalCold: 7,
    birthdayEnabled: true,
    birthdayHour: 9,
    chargesConsultation: true,
    consultationFee: "150.00",
  });

  await db.insert(dentalProceduresTable).values([
    { tenantId, name: "Clareamento Dental", durationMinutes: 60, price: "800.00", active: "true" },
    { tenantId, name: "Limpeza", durationMinutes: 30, price: "200.00", active: "true" },
    { tenantId, name: "Tratamento de Canal", durationMinutes: 90, price: "1500.00", active: "true" },
  ]);

  console.log(`  Tenant ID: ${tenantId}`);
  console.log(`  Instance: ${tenant.evolutionInstanceName}`);
}

async function cleanup(): Promise<void> {
  console.log("\n🧹 Cleaning up test data...\n");
  try {
    await db.execute(sql`DELETE FROM birthday_greetings_sent WHERE tenant_id = ${tenantId}`).catch(() => {});
    await db.delete(appointmentFollowUpsTable).where(eq(appointmentFollowUpsTable.tenantId, tenantId));
    await db.delete(dentalActivityTable).where(eq(dentalActivityTable.tenantId, tenantId));
    await db.delete(dentalMessagesTable).where(eq(dentalMessagesTable.tenantId, tenantId));
    await db.delete(dentalConversationsTable).where(eq(dentalConversationsTable.tenantId, tenantId));
    await db.delete(appointmentsTable).where(eq(appointmentsTable.tenantId, tenantId));
    await db.delete(dentalLeadsTable).where(eq(dentalLeadsTable.tenantId, tenantId));
    await db.delete(patientsTable).where(eq(patientsTable.tenantId, tenantId));
    await db.delete(dentalProceduresTable).where(eq(dentalProceduresTable.tenantId, tenantId));
    await db.delete(dentalSettingsTable).where(eq(dentalSettingsTable.tenantId, tenantId));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
    await tenantExistsCache.invalidate(tenantId);
    console.log("  Cleanup complete.");
  } catch (err) {
    console.error("  Cleanup error:", err);
  }
  setTestProvider(null);
  if (testServer) {
    await new Promise<void>((resolve) => testServer.close(() => resolve()));
  }
}

function getNextWorkday(daysAhead = 1): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  while ([0, 6].includes(d.getDay())) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

async function getInstanceName(): Promise<string> {
  const t = await db.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, tenantId) });
  return t!.evolutionInstanceName || `dental-${tenantId}`;
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

async function waitForAiProcessing(phone: string, minOutbound: number, maxWait = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const msgs = await getOutboundMessages(phone);
    if (msgs.length >= minOutbound) return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function test1_LeadFirstContactViaWebhook(): Promise<void> {
  console.log("\n📋 Test 1: Lead — Primeiro contato via webhook\n");
  const instanceName = await getInstanceName();

  await runTest("1.1 Webhook cria lead + conversation + AI response", async () => {
    const input = "Ola, quero saber sobre clareamento";
    const res = await webhookMessage(instanceName, TEST_PHONE_LEAD, input, "Maria Teste");
    assert(res.status === 200, `Webhook should return 200, got: ${res.status}`);
    evidence("input", input);
    evidence("apiResponse", { status: res.status, body: res.data });

    await waitForAiProcessing(TEST_PHONE_LEAD, 1);

    const lead = await db.query.dentalLeadsTable.findFirst({
      where: and(eq(dentalLeadsTable.tenantId, tenantId), eq(dentalLeadsTable.phone, TEST_PHONE_LEAD)),
    });
    assert(!!lead, "Lead should be created in DB");
    assert(lead!.status === "active", `Lead status should be active, got: ${lead!.status}`);
    assert(!!lead!.temperature, "Lead should have temperature assigned");
    evidence("dbState", { leadId: lead!.id, status: lead!.status, temperature: lead!.temperature });

    const conv = await db.query.dentalConversationsTable.findFirst({
      where: and(eq(dentalConversationsTable.tenantId, tenantId), eq(dentalConversationsTable.contactPhone, TEST_PHONE_LEAD)),
    });
    assert(!!conv, "Conversation should be created");
    assert(conv!.contactType === "lead" || conv!.contactType === "unknown", `Contact type should be lead or unknown for new contact, got: ${conv!.contactType}`);

    const msgs = await getOutboundMessages(TEST_PHONE_LEAD);
    assert(msgs.length >= 1, `AI should have sent at least 1 outbound message, got: ${msgs.length}`);
    evidence("aiResponse", msgs[0].content.substring(0, 400));
  });

  await runTest("1.2 AI se apresenta pelo nome configurado na resposta", async () => {
    const msgs = await getOutboundMessages(TEST_PHONE_LEAD);
    const reply = msgs[msgs.length - 1]?.content || "";
    assert(/ana/i.test(reply), `AI should mention configured name 'Ana'. Reply: ${reply.substring(0, 200)}`);
    assert(/cl[ií]nica|sorriso|consult[oó]rio|dr/i.test(reply), `AI should mention clinic or dentist. Reply: ${reply.substring(0, 200)}`);
    evidence("aiResponse", reply.substring(0, 400));
  });

  await runTest("1.3 Lead demonstra interesse em agendar — AI oferece slots com horários", async () => {
    const input = "Quero agendar o clareamento, tem horario disponivel?";
    const res = await webhookMessage(instanceName, TEST_PHONE_LEAD, input, "Maria Teste");
    assert(res.status === 200, `Webhook should return 200, got: ${res.status}`);
    evidence("input", input);

    await waitForAiProcessing(TEST_PHONE_LEAD, 2);
    const msgs = await getOutboundMessages(TEST_PHONE_LEAD);
    const reply = msgs[0]?.content || "";
    const timeMatches = reply.match(/\d{1,2}:\d{2}/g) || [];
    assert(timeMatches.length >= 1, `AI should offer at least 1 time slot. Reply: ${reply.substring(0, 300)}`);
    assert(!reply.includes("{hora}") && !reply.includes("{slot}"), `AI should not contain raw placeholders. Reply: ${reply.substring(0, 200)}`);
    evidence("aiResponse", reply.substring(0, 400));
    evidence("dbState", { slotsOffered: timeMatches.length, slots: timeMatches });
  });

  await runTest("1.4 Temperatura do lead atualizada após interesse de agendamento", async () => {
    await new Promise((r) => setTimeout(r, 1000));
    const lead = await db.query.dentalLeadsTable.findFirst({
      where: and(eq(dentalLeadsTable.tenantId, tenantId), eq(dentalLeadsTable.phone, TEST_PHONE_LEAD)),
    });
    assert(!!lead, "Lead should exist");
    assert(lead!.temperature === "warm" || lead!.temperature === "hot", `Lead should be warm or hot, got: ${lead!.temperature}`);
    evidence("dbState", { leadId: lead!.id, temperature: lead!.temperature, status: lead!.status });
  });
}

async function test2_LeadPriceObjectionViaWebhook(): Promise<void> {
  console.log("\n📋 Test 2: Lead — Objeção de preço via webhook\n");
  const instanceName = await getInstanceName();

  await runTest("2.1 Lead pergunta preço via webhook — AI responde com valor", async () => {
    const input = "Oi, quanto custa o clareamento?";
    const res = await webhookMessage(instanceName, TEST_PHONE_LEAD2, input, "Joao Teste");
    assert(res.status === 200, `Webhook 200, got: ${res.status}`);
    evidence("input", input);

    await waitForAiProcessing(TEST_PHONE_LEAD2, 1);
    const msgs = await getOutboundMessages(TEST_PHONE_LEAD2);
    const reply = msgs[0]?.content || "";
    assert(/800|R\$|reais|valor/i.test(reply), `AI should mention price 800. Reply: ${reply.substring(0, 300)}`);
    evidence("aiResponse", reply.substring(0, 400));
  });

  await runTest("2.2 Lead diz 'está caro' via webhook — AI não desiste", async () => {
    const input = "Achei muito caro, vou pensar";
    const res = await webhookMessage(instanceName, TEST_PHONE_LEAD2, input, "Joao Teste");
    assert(res.status === 200, `Webhook 200`);
    evidence("input", input);

    await waitForAiProcessing(TEST_PHONE_LEAD2, 2);
    const msgs = await getOutboundMessages(TEST_PHONE_LEAD2);
    const reply = msgs[0]?.content || "";
    assert(reply.length > 30, `AI should give substantial response, not give up. Length: ${reply.length}`);
    assert(
      /parcel|invest|resultado|sorriso|benef|qualidade|vale|diferenc|saude|custo|tratament|autoestima|ajud|preocup|informa|procediment/i.test(reply),
      `AI should use persuasion language. Reply: ${reply.substring(0, 300)}`
    );
    evidence("aiResponse", reply.substring(0, 400));
  });
}

async function test3_RemarketingLogic(): Promise<void> {
  console.log("\n📋 Test 3: Lead frio — Remarketing\n");

  await runTest("3.1 Lead inativo identificado com intervalos corretos da DB", async () => {
    const settings = await db.query.dentalSettingsTable.findFirst({
      where: eq(dentalSettingsTable.tenantId, tenantId),
    });
    assert(!!settings, "Settings should exist");
    assert(settings!.remarketingIntervalHot === 2, `Hot interval should be 2, got: ${settings!.remarketingIntervalHot}`);
    assert(settings!.remarketingIntervalWarm === 4, `Warm interval should be 4, got: ${settings!.remarketingIntervalWarm}`);
    assert(settings!.remarketingIntervalCold === 7, `Cold interval should be 7, got: ${settings!.remarketingIntervalCold}`);
    assert(settings!.remarketingIntervalHot < settings!.remarketingIntervalWarm, "Hot < Warm");
    assert(settings!.remarketingIntervalWarm < settings!.remarketingIntervalCold, "Warm < Cold");
    evidence("dbState", {
      hot: settings!.remarketingIntervalHot,
      warm: settings!.remarketingIntervalWarm,
      cold: settings!.remarketingIntervalCold,
    });

    const eightDaysAgo = new Date(Date.now() - 8 * 86400000);
    const [coldLead] = await db
      .insert(dentalLeadsTable)
      .values({
        tenantId, name: "Lead Frio Teste", phone: TEST_PHONE_COLD_LEAD,
        temperature: "cold", source: "whatsapp", status: "active", lastContactAt: eightDaysAgo,
      })
      .returning();
    const daysSinceContact = Math.floor((Date.now() - eightDaysAgo.getTime()) / 86400000);
    assert(daysSinceContact >= settings!.remarketingIntervalCold, `Days since (${daysSinceContact}) >= cold interval (${settings!.remarketingIntervalCold})`);
    evidence("coldLead", { id: coldLead.id, temperature: coldLead.temperature, daysSinceContact });
  });

  await runTest("3.2 GET /dental/leads filtrado por temperatura retorna lead frio", async () => {
    const res = await api("GET", "/dental/leads?temperature=cold");
    assert(res.status === 200, `Should return 200, got: ${res.status}`);
    const leads = res.data as unknown as Array<Record<string, unknown>>;
    assert(Array.isArray(leads), "Should return array");
    const coldLeads = leads.filter((l) => l.phone === TEST_PHONE_COLD_LEAD);
    assert(coldLeads.length === 1, `Should find the cold test lead, found: ${coldLeads.length}`);
    assert(coldLeads[0].temperature === "cold", `Should return cold, got: ${coldLeads[0].temperature}`);
    evidence("apiResponse", { status: res.status, body: { count: coldLeads.length, phone: coldLeads[0].phone as string } });
  });
}

async function test4_PatientSchedulingViaAPI(): Promise<void> {
  console.log("\n📋 Test 4: Paciente — Agendamento via API\n");

  await runTest("4.1 POST /appointments cria agendamento + follow-ups automáticos", async () => {
    const [patient] = await db
      .insert(patientsTable)
      .values({ tenantId, name: "Paciente API Teste", phone: TEST_PHONE_PATIENT })
      .returning();

    const nextDay = getNextWorkday();
    const dateStr = nextDay.toISOString().split("T")[0];
    const startsAt = `${dateStr}T10:00:00.000Z`;
    const endsAt = `${dateStr}T10:30:00.000Z`;

    const res = await api("POST", "/dental/appointments", {
      patientId: patient.id,
      procedureName: "Limpeza",
      startsAt,
      endsAt,
    });
    assert(res.status === 201, `Should return 201, got: ${res.status}. Data: ${JSON.stringify(res.data)}`);
    assert(!!res.data.id, "Should have id");
    assert(res.data.status === "scheduled", `Status should be 'scheduled', got: ${res.data.status}`);
    assert(res.data.patientId === patient.id, "Should link to patient");
    evidence("apiResponse", { status: res.status, body: { id: res.data.id, status: res.data.status as string } });

    const followUps = await db.query.appointmentFollowUpsTable.findMany({
      where: and(eq(appointmentFollowUpsTable.tenantId, tenantId), eq(appointmentFollowUpsTable.appointmentId, res.data.id as number)),
    });
    assert(followUps.length >= 2, `Should create >= 2 follow-ups, got: ${followUps.length}`);
    const hasReminder = followUps.some((f) => f.type === "reminder_24h");
    const hasPost = followUps.some((f) => f.type === "post_appointment");
    assert(hasReminder, "Should have reminder_24h follow-up");
    assert(hasPost, "Should have post_appointment follow-up");
    evidence("dbState", {
      appointmentId: res.data.id,
      followUps: followUps.map((f) => ({ type: f.type, status: f.status, scheduledAt: f.scheduledAt.toISOString() })),
    });
  });

  await runTest("4.2 Paciente envia mensagem via webhook — AI identifica como paciente", async () => {
    const instanceName = await getInstanceName();
    const input = "Oi, preciso marcar outra limpeza";
    const res = await webhookMessage(instanceName, TEST_PHONE_PATIENT, input, "Paciente API Teste");
    assert(res.status === 200, `Webhook 200`);
    evidence("input", input);

    await waitForAiProcessing(TEST_PHONE_PATIENT, 1);
    const conv = await db.query.dentalConversationsTable.findFirst({
      where: and(eq(dentalConversationsTable.tenantId, tenantId), eq(dentalConversationsTable.contactPhone, TEST_PHONE_PATIENT)),
    });
    assert(!!conv, "Conversation should exist");
    assert(conv!.contactType === "patient", `Should be patient, got: ${conv!.contactType}`);

    const msgs = await getOutboundMessages(TEST_PHONE_PATIENT);
    assert(msgs.length >= 1, "AI should respond");
    evidence("aiResponse", msgs[0].content.substring(0, 400));
    evidence("dbState", { contactType: conv!.contactType });
  });
}

async function test5_PatientCancellationViaAPI(): Promise<void> {
  console.log("\n📋 Test 5: Paciente — Cancelamento via API\n");

  await runTest("5.1 PATCH /appointments/:id cancela agendamento — DB verified", async () => {
    const patient = await db.query.patientsTable.findFirst({
      where: and(eq(patientsTable.tenantId, tenantId), eq(patientsTable.phone, TEST_PHONE_PATIENT)),
    });
    assert(!!patient, "Patient should exist");

    const appts = await api("GET", `/dental/appointments?patientId=${patient!.id}`);
    const scheduledAppts = (appts.data as unknown as Array<Record<string, unknown>>).filter((a) => a.status === "scheduled");
    assert(scheduledAppts.length > 0, "Should have scheduled appointments");

    const apptId = scheduledAppts[0].id as number;
    const res = await api("PATCH", `/dental/appointments/${apptId}`, { status: "cancelled" });
    assert(res.status === 200, `PATCH should return 200, got: ${res.status}`);
    assert(res.data.status === "cancelled", `Status should be cancelled, got: ${res.data.status}`);
    evidence("apiResponse", { status: res.status, body: { id: apptId, status: res.data.status as string } });

    const dbAppt = await db.query.appointmentsTable.findFirst({
      where: and(eq(appointmentsTable.id, apptId), eq(appointmentsTable.tenantId, tenantId)),
    });
    assert(dbAppt!.status === "cancelled", `DB status should be cancelled, got: ${dbAppt!.status}`);
    evidence("dbState", { appointmentId: apptId, dbStatus: dbAppt!.status });
  });

  await runTest("5.2 Paciente pede cancelamento via webhook — AI responde", async () => {
    const instanceName = await getInstanceName();
    const input = "Preciso cancelar minha consulta";
    const res = await webhookMessage(instanceName, TEST_PHONE_PATIENT, input, "Paciente API Teste");
    assert(res.status === 200, `Webhook 200`);
    evidence("input", input);

    await waitForAiProcessing(TEST_PHONE_PATIENT, 2);
    const msgs = await getOutboundMessages(TEST_PHONE_PATIENT);
    const reply = msgs[0]?.content || "";
    assert(/cancel|desmarc|reagend|remarc|outro|lament|sinto|entend/i.test(reply), `AI should address cancellation. Reply: ${reply.substring(0, 300)}`);
    evidence("aiResponse", reply.substring(0, 400));
  });
}

async function test6_PatientReschedulingViaAPI(): Promise<void> {
  console.log("\n📋 Test 6: Paciente — Remarcação via API\n");

  await runTest("6.1 POST novo agendamento após cancelar — DB shows both states", async () => {
    const patient = await db.query.patientsTable.findFirst({
      where: and(eq(patientsTable.tenantId, tenantId), eq(patientsTable.phone, TEST_PHONE_PATIENT)),
    });

    const nextDay = getNextWorkday(3);
    const dateStr = nextDay.toISOString().split("T")[0];
    const res = await api("POST", "/dental/appointments", {
      patientId: patient!.id,
      procedureName: "Limpeza Remarcada",
      startsAt: `${dateStr}T15:00:00.000Z`,
      endsAt: `${dateStr}T15:30:00.000Z`,
    });
    assert(res.status === 201, `Should return 201, got: ${res.status}`);
    assert(res.data.status === "scheduled", `New appointment should be scheduled, got: ${res.data.status}`);
    evidence("apiResponse", { status: res.status, body: { id: res.data.id, status: res.data.status as string } });

    const allAppts = await api("GET", `/dental/appointments?patientId=${patient!.id}`);
    const apptList = allAppts.data as unknown as Array<Record<string, unknown>>;
    const cancelled = apptList.filter((a) => a.status === "cancelled");
    const scheduled = apptList.filter((a) => a.status === "scheduled");
    assert(cancelled.length >= 1, `Should have >= 1 cancelled, got: ${cancelled.length}`);
    assert(scheduled.length >= 1, `Should have >= 1 scheduled, got: ${scheduled.length}`);
    evidence("dbState", {
      totalAppointments: apptList.length,
      cancelledCount: cancelled.length,
      scheduledCount: scheduled.length,
    });
  });
}

async function test7_FollowUpReminder24h(): Promise<void> {
  console.log("\n📋 Test 7: Follow-up — Lembrete 24h\n");

  await runTest("7.1 POST /appointments auto-cria reminder_24h com timing correto", async () => {
    const patient = await db.query.patientsTable.findFirst({
      where: and(eq(patientsTable.tenantId, tenantId), eq(patientsTable.phone, TEST_PHONE_PATIENT)),
    });

    const nextDay = getNextWorkday(5);
    const dateStr = nextDay.toISOString().split("T")[0];
    const res = await api("POST", "/dental/appointments", {
      patientId: patient!.id,
      procedureName: "Avaliacao Follow-up Test",
      startsAt: `${dateStr}T09:00:00.000Z`,
      endsAt: `${dateStr}T09:30:00.000Z`,
    });
    assert(res.status === 201, `Should create, got: ${res.status}`);

    const followUps = await db.query.appointmentFollowUpsTable.findMany({
      where: and(eq(appointmentFollowUpsTable.tenantId, tenantId), eq(appointmentFollowUpsTable.appointmentId, res.data.id as number)),
    });
    assert(followUps.length >= 2, `Should have >= 2 follow-ups, got: ${followUps.length}`);
    assert(followUps.every((f) => f.status === "pending"), "All should be pending");

    const reminder = followUps.find((f) => f.type === "reminder_24h");
    assert(!!reminder, "Should have reminder_24h");
    const apptTime = new Date(res.data.startsAt as string).getTime();
    const reminderTime = reminder!.scheduledAt.getTime();
    const hoursBefore = (apptTime - reminderTime) / 3600000;
    assert(hoursBefore >= 23 && hoursBefore <= 25, `Reminder should be ~24h before, got: ${hoursBefore.toFixed(1)}h`);
    evidence("dbState", {
      appointmentId: res.data.id,
      followUps: followUps.map((f) => ({ type: f.type, status: f.status })),
      reminderHoursBefore: hoursBefore.toFixed(1),
    });
  });

  await runTest("7.2 processFollowUps() sends reminder with correct content via MockProvider", async () => {
    const [tempPatient] = await db.insert(patientsTable).values({ tenantId, name: "Temp Reminder Patient", phone: "5511999990077" }).returning();

    const nearFuture = new Date(Date.now() + 12 * 3600000);
    const nearFutureEnd = new Date(nearFuture.getTime() + 30 * 60000);

    const [appt] = await db.insert(appointmentsTable).values({
      tenantId, patientId: tempPatient.id, procedureName: "Reminder Process Test",
      status: "scheduled", startsAt: nearFuture, endsAt: nearFutureEnd,
    }).returning();

    await db.insert(appointmentFollowUpsTable).values({
      tenantId, appointmentId: appt.id, type: "reminder_24h",
      scheduledAt: new Date(Date.now() - 60000), status: "pending",
    });

    const beforeCount = mockProvider.capturedMessages.length;
    await processFollowUps();

    const followUp = await db.query.appointmentFollowUpsTable.findFirst({
      where: and(
        eq(appointmentFollowUpsTable.tenantId, tenantId),
        eq(appointmentFollowUpsTable.appointmentId, appt.id),
        eq(appointmentFollowUpsTable.type, "reminder_24h"),
      ),
    });
    assert(!!followUp, "Follow-up should exist");
    assert(followUp!.status === "sent", `Should be sent via MockProvider, got: ${followUp!.status}`);

    const capturedMsgs = mockProvider.getCapturedFor("5511999990077");
    const newMsgs = capturedMsgs.filter((m) => m.timestamp.getTime() > Date.now() - 10000);
    assert(newMsgs.length >= 1, `MockProvider should capture at least 1 message for reminder, got: ${newMsgs.length}`);
    const reminderContent = newMsgs[0].message;
    assert(reminderContent.length > 10, `Reminder message should have content. Got: ${reminderContent}`);
    evidence("capturedMessage", { phone: newMsgs[0].phone, content: reminderContent.substring(0, 200), instanceName: newMsgs[0].instanceName });
    evidence("dbState", { followUpStatus: followUp!.status, appointmentId: appt.id });
  });
}

async function test8_FollowUpPostAppointment(): Promise<void> {
  console.log("\n📋 Test 8: Follow-up — Pós-consulta\n");

  await runTest("8.1 processFollowUps() sends post_appointment message via MockProvider", async () => {
    const [tempPatient] = await db.insert(patientsTable).values({ tenantId, name: "Temp Post Patient", phone: "5511999990078" }).returning();

    const pastDate = new Date(Date.now() - 3 * 3600000);
    const pastEnd = new Date(pastDate.getTime() + 30 * 60000);

    const [appt] = await db.insert(appointmentsTable).values({
      tenantId, patientId: tempPatient.id, procedureName: "Post Appointment Test",
      status: "completed", startsAt: pastDate, endsAt: pastEnd,
    }).returning();

    await db.insert(appointmentFollowUpsTable).values({
      tenantId, appointmentId: appt.id, type: "post_appointment",
      scheduledAt: new Date(Date.now() - 60000), status: "pending",
    });

    mockProvider.clearCaptured();
    await processFollowUps();

    const followUp = await db.query.appointmentFollowUpsTable.findFirst({
      where: and(
        eq(appointmentFollowUpsTable.tenantId, tenantId),
        eq(appointmentFollowUpsTable.appointmentId, appt.id),
        eq(appointmentFollowUpsTable.type, "post_appointment"),
      ),
    });
    assert(!!followUp, "Follow-up should exist");
    assert(followUp!.status === "sent", `Should be sent via MockProvider, got: ${followUp!.status}`);

    const capturedMsgs = mockProvider.getCapturedFor("5511999990078");
    assert(capturedMsgs.length >= 1, `MockProvider should capture post_appointment message, got: ${capturedMsgs.length}`);
    const postContent = capturedMsgs[0].message;
    assert(postContent.length > 10, `Post message should have content. Got: ${postContent}`);
    evidence("capturedMessage", { phone: capturedMsgs[0].phone, content: postContent.substring(0, 200) });
    evidence("dbState", { followUpStatus: followUp!.status });
  });
}

async function test9_NoShowRecovery(): Promise<void> {
  console.log("\n📋 Test 9: No-show — Recuperação via API\n");

  await runTest("9.1 PATCH /appointments/:id/status no_show cria follow-up", async () => {
    const [noShowPatient] = await db.insert(patientsTable).values({ tenantId, name: "Paciente NoShow", phone: TEST_PHONE_NOSHOW }).returning();

    const pastDate = new Date(Date.now() - 5 * 3600000);
    const pastEnd = new Date(pastDate.getTime() + 30 * 60000);

    const [appt] = await db.insert(appointmentsTable).values({
      tenantId, patientId: noShowPatient.id, procedureName: "Consulta NoShow Test",
      status: "scheduled", startsAt: pastDate, endsAt: pastEnd,
    }).returning();

    const statusRes = await api("PATCH", `/dental/appointments/${appt.id}/status`, { status: "no_show" });
    assert(statusRes.status === 200, `PATCH status should return 200, got: ${statusRes.status}`);
    assert(statusRes.data.status === "no_show", `Status should be no_show, got: ${statusRes.data.status}`);
    evidence("apiResponse", { status: statusRes.status, body: { id: appt.id, status: statusRes.data.status as string } });

    const followUp = await db.query.appointmentFollowUpsTable.findFirst({
      where: and(
        eq(appointmentFollowUpsTable.tenantId, tenantId),
        eq(appointmentFollowUpsTable.appointmentId, appt.id),
        eq(appointmentFollowUpsTable.type, "no_show_patient_contact"),
      ),
    });
    assert(!!followUp, "No-show follow-up should be auto-created by PATCH /status");
    assert(followUp!.status === "pending", `Should be pending, got: ${followUp!.status}`);
    evidence("dbState", { followUpId: followUp!.id, followUpStatus: followUp!.status, type: followUp!.type });
  });

  await runTest("9.2 No-show follow-up sends message via MockProvider", async () => {
    const noShowPatient = await db.query.patientsTable.findFirst({
      where: and(eq(patientsTable.tenantId, tenantId), eq(patientsTable.phone, TEST_PHONE_NOSHOW)),
    });
    const appt = await db.query.appointmentsTable.findFirst({
      where: and(eq(appointmentsTable.tenantId, tenantId), eq(appointmentsTable.patientId, noShowPatient!.id), eq(appointmentsTable.status, "no_show")),
    });
    const followUp = await db.query.appointmentFollowUpsTable.findFirst({
      where: and(
        eq(appointmentFollowUpsTable.tenantId, tenantId),
        eq(appointmentFollowUpsTable.appointmentId, appt!.id),
        eq(appointmentFollowUpsTable.type, "no_show_patient_contact"),
      ),
    });
    assert(!!followUp && followUp.status === "pending", `Follow-up should be pending, got: ${followUp?.status || "not found"}`);

    await db.update(appointmentFollowUpsTable).set({ scheduledAt: new Date(Date.now() - 60000) }).where(eq(appointmentFollowUpsTable.id, followUp!.id));
    mockProvider.clearCaptured();
    await processFollowUps();

    const updated = await db.query.appointmentFollowUpsTable.findFirst({
      where: eq(appointmentFollowUpsTable.id, followUp!.id),
    });
    assert(updated!.status === "sent", `Should be sent via MockProvider, got: ${updated!.status}`);

    const capturedMsgs = mockProvider.getCapturedFor(TEST_PHONE_NOSHOW);
    assert(capturedMsgs.length >= 1, `MockProvider should capture no-show message, got: ${capturedMsgs.length}`);
    const noShowContent = capturedMsgs[0].message;
    assert(noShowContent.includes("Paciente NoShow"), `No-show message should include patient name. Got: ${noShowContent.substring(0, 200)}`);
    assert(!noShowContent.includes("{nome}") && !noShowContent.includes("{data}"), `No-show message should not contain raw placeholders. Got: ${noShowContent.substring(0, 200)}`);
    evidence("capturedMessage", { phone: capturedMsgs[0].phone, content: noShowContent.substring(0, 200) });
    evidence("dbState", { followUpId: updated!.id, finalStatus: updated!.status });
  });

  await runTest("9.3 No-show follow-up pulado se paciente reagendou", async () => {
    const [skipPatient] = await db.insert(patientsTable).values({ tenantId, name: "Skip NoShow Patient", phone: "5511999990098" }).returning();

    const pastDate = new Date(Date.now() - 4 * 3600000);
    const pastEnd = new Date(pastDate.getTime() + 30 * 60000);

    const [noShowAppt] = await db.insert(appointmentsTable).values({
      tenantId, patientId: skipPatient.id, procedureName: "NoShow Skip Test",
      status: "no_show", startsAt: pastDate, endsAt: pastEnd,
    }).returning();

    const futureDate = new Date(Date.now() + 48 * 3600000);
    const futureEnd = new Date(futureDate.getTime() + 30 * 60000);
    await db.insert(appointmentsTable).values({
      tenantId, patientId: skipPatient.id, procedureName: "Reagendamento",
      status: "scheduled", startsAt: futureDate, endsAt: futureEnd,
    });

    await db.insert(appointmentFollowUpsTable).values({
      tenantId, appointmentId: noShowAppt.id, type: "no_show_patient_contact",
      scheduledAt: new Date(Date.now() - 60000), status: "pending",
    });

    await processFollowUps();

    const followUp = await db.query.appointmentFollowUpsTable.findFirst({
      where: and(
        eq(appointmentFollowUpsTable.tenantId, tenantId),
        eq(appointmentFollowUpsTable.appointmentId, noShowAppt.id),
        eq(appointmentFollowUpsTable.type, "no_show_patient_contact"),
      ),
    });
    assert(!!followUp, "Follow-up should exist");
    assert(followUp!.status === "skipped", `Should be skipped, got: ${followUp!.status}`);
    evidence("dbState", { followUpStatus: followUp!.status, reason: "patient rescheduled" });
  });
}

async function test10_AvailabilityConflictsViaAPI(): Promise<void> {
  console.log("\n📋 Test 10: Disponibilidade — Conflitos via API\n");

  await runTest("10.1 GET /availability exclui horários ocupados", async () => {
    const nextDay = getNextWorkday(7);
    const dateStr = nextDay.toISOString().split("T")[0];

    const patient = await db.query.patientsTable.findFirst({
      where: and(eq(patientsTable.tenantId, tenantId), eq(patientsTable.phone, TEST_PHONE_PATIENT)),
    });

    await db.insert(appointmentsTable).values([
      { tenantId, patientId: patient!.id, procedureName: "Ocupado1", status: "scheduled", startsAt: new Date(`${dateStr}T09:00:00.000Z`), endsAt: new Date(`${dateStr}T09:30:00.000Z`) },
      { tenantId, patientId: patient!.id, procedureName: "Ocupado2", status: "scheduled", startsAt: new Date(`${dateStr}T10:00:00.000Z`), endsAt: new Date(`${dateStr}T10:30:00.000Z`) },
    ]);

    const res = await api("GET", `/dental/appointments/availability?date=${dateStr}&durationMinutes=30`);
    assert(res.status === 200, `Should return 200, got: ${res.status}`);
    const slots = (res.data as Record<string, unknown>).availableSlots as string[];
    assert(Array.isArray(slots), "Should return availableSlots array");
    assert(!slots.some((s: string) => s.includes("T09:00")), "09:00 should NOT be available");
    assert(!slots.some((s: string) => s.includes("T10:00")), "10:00 should NOT be available");
    assert(slots.length > 0, "Should have available slots");
    evidence("apiResponse", { status: res.status, body: { date: dateStr, totalSlots: slots.length, sampleSlots: slots.slice(0, 5) } });
  });

  await runTest("10.2 POST /appointments rejects overlapping time slot (409)", async () => {
    const nextDay = getNextWorkday(7);
    const dateStr = nextDay.toISOString().split("T")[0];
    const patient = await db.query.patientsTable.findFirst({
      where: and(eq(patientsTable.tenantId, tenantId), eq(patientsTable.phone, TEST_PHONE_PATIENT)),
    });

    const res = await api("POST", "/dental/appointments", {
      patientId: patient!.id,
      procedureName: "Should Conflict",
      startsAt: `${dateStr}T09:00:00.000Z`,
      endsAt: `${dateStr}T09:30:00.000Z`,
    });
    assert(res.status === 409, `Should return 409, got: ${res.status}`);
    const errorMsg = res.data.error as string;
    assert(errorMsg.includes("conflict") || errorMsg.includes("Time slot"), `Error should mention conflict. Got: ${errorMsg}`);
    evidence("apiResponse", { status: res.status, body: res.data });
  });
}

async function test11_ScheduleConfigRespect(): Promise<void> {
  console.log("\n📋 Test 11: Horários — Configuração via API\n");

  await runTest("11.1 Schedule config: dias habilitados/desabilitados da DB", async () => {
    const settings = await db.query.dentalSettingsTable.findFirst({
      where: eq(dentalSettingsTable.tenantId, tenantId),
    });
    const sched = JSON.parse(settings!.scheduleConfig || "[]") as Array<{ day: string; enabled: boolean }>;
    const enabledDays = sched.filter((d) => d.enabled).map((d) => d.day);
    const disabledDays = sched.filter((d) => !d.enabled).map((d) => d.day);

    assert(enabledDays.includes("1"), "Monday enabled");
    assert(enabledDays.includes("5"), "Friday enabled");
    assert(disabledDays.includes("0"), "Sunday disabled");
    assert(disabledDays.includes("6"), "Saturday disabled");
    assert(enabledDays.length === 5, `5 enabled days, got: ${enabledDays.length}`);
    assert(disabledDays.length === 2, `2 disabled days, got: ${disabledDays.length}`);
    evidence("dbState", { enabledDays, disabledDays });
  });

  await runTest("11.2 Lunch config: 12:00-14:00 da DB", async () => {
    const settings = await db.query.dentalSettingsTable.findFirst({
      where: eq(dentalSettingsTable.tenantId, tenantId),
    });
    assert(settings!.lunchStart === "12:00", `Lunch start should be 12:00, got: ${settings!.lunchStart}`);
    assert(settings!.lunchEnd === "14:00", `Lunch end should be 14:00, got: ${settings!.lunchEnd}`);
    evidence("dbState", { lunchStart: settings!.lunchStart, lunchEnd: settings!.lunchEnd });
  });

  await runTest("11.3 GET /availability exclui lunch slots (12:00-14:00)", async () => {
    const nextDay = getNextWorkday(8);
    const dateStr = nextDay.toISOString().split("T")[0];

    const res = await api("GET", `/dental/appointments/availability?date=${dateStr}&durationMinutes=30`);
    assert(res.status === 200, `Should return 200, got: ${res.status}`);

    const slots = (res.data as Record<string, unknown>).availableSlots as string[];
    const lunchSlots = slots.filter((s: string) => {
      const h = parseInt(s.substring(11, 13));
      return h >= 12 && h < 14;
    });
    assert(lunchSlots.length === 0, `No slots during lunch, found: ${lunchSlots.length}`);

    const morningSlots = slots.filter((s: string) => parseInt(s.substring(11, 13)) < 12);
    const afternoonSlots = slots.filter((s: string) => parseInt(s.substring(11, 13)) >= 14);
    assert(morningSlots.length > 0, "Should have morning slots");
    assert(afternoonSlots.length > 0, "Should have afternoon slots");
    evidence("apiResponse", { status: res.status, body: { total: slots.length, lunch: lunchSlots.length, morning: morningSlots.length, afternoon: afternoonSlots.length } });
  });

  await runTest("11.4 POST /appointments fora do expediente retorna 400", async () => {
    const nextDay = getNextWorkday(8);
    const dateStr = nextDay.toISOString().split("T")[0];
    const patient = await db.query.patientsTable.findFirst({
      where: and(eq(patientsTable.tenantId, tenantId), eq(patientsTable.phone, TEST_PHONE_PATIENT)),
    });

    const res = await api("POST", "/dental/appointments", {
      patientId: patient!.id, procedureName: "After Hours",
      startsAt: `${dateStr}T20:00:00.000Z`,
      endsAt: `${dateStr}T20:30:00.000Z`,
    });
    assert(res.status === 400, `Should reject, got: ${res.status}`);
    const errorMsg = res.data.error as string;
    assert(errorMsg.includes("expediente"), `Error should mention 'expediente'. Got: ${errorMsg}`);
    evidence("apiResponse", { status: res.status, body: res.data });
  });
}

async function test12_CancelledFollowupSkipped(): Promise<void> {
  console.log("\n📋 Test 12: Follow-up de cancelado é pulado\n");

  await runTest("12.1 Scheduler skips follow-up for cancelled appointment", async () => {
    const [tempPatient] = await db.insert(patientsTable).values({ tenantId, name: "Cancelled Patient", phone: "5511999990079" }).returning();

    const futureDate = new Date(Date.now() + 6 * 3600000);
    const futureEnd = new Date(futureDate.getTime() + 30 * 60000);

    const [appt] = await db.insert(appointmentsTable).values({
      tenantId, patientId: tempPatient.id, procedureName: "Cancelada Teste",
      status: "cancelled", startsAt: futureDate, endsAt: futureEnd,
    }).returning();

    await db.insert(appointmentFollowUpsTable).values({
      tenantId, appointmentId: appt.id, type: "reminder_24h",
      scheduledAt: new Date(Date.now() - 60000), status: "pending",
    });

    await processFollowUps();

    const followUp = await db.query.appointmentFollowUpsTable.findFirst({
      where: and(
        eq(appointmentFollowUpsTable.tenantId, tenantId),
        eq(appointmentFollowUpsTable.appointmentId, appt.id),
        eq(appointmentFollowUpsTable.type, "reminder_24h"),
      ),
    });
    assert(!!followUp, "Follow-up should exist");
    assert(followUp!.status === "skipped", `Should be skipped, got: ${followUp!.status}`);
    evidence("dbState", { followUpStatus: followUp!.status, appointmentStatus: "cancelled" });
  });
}

async function test13_LeadConversionViaAPI(): Promise<void> {
  console.log("\n📋 Test 13: Lead — Conversão via API\n");

  await runTest("13.1 POST /leads/:id/convert cria paciente + atualiza lead", async () => {
    const lead = await db.query.dentalLeadsTable.findFirst({
      where: and(eq(dentalLeadsTable.tenantId, tenantId), eq(dentalLeadsTable.phone, TEST_PHONE_LEAD)),
    });
    assert(!!lead, "Lead from test 1 should exist");
    evidence("input", `Converting lead ${lead!.id} (${lead!.name})`);

    const res = await api("POST", `/dental/leads/${lead!.id}/convert`, {
      name: "Maria Teste Convertida",
      phone: TEST_PHONE_LEAD,
    });
    assert(res.status === 200, `Should return 200, got: ${res.status}`);
    const resData = res.data as Record<string, Record<string, unknown>>;
    assert(!!resData.patient, "Should return patient object");
    assert(resData.patient.phone === TEST_PHONE_LEAD, "Patient phone should match");
    assert(resData.lead.status === "converted", `Lead status should be converted, got: ${resData.lead.status}`);
    evidence("apiResponse", { status: res.status, body: { patientId: resData.patient.id, leadStatus: resData.lead.status as string } });

    const dbLead = await db.query.dentalLeadsTable.findFirst({
      where: eq(dentalLeadsTable.id, lead!.id),
    });
    assert(dbLead!.status === "converted", `DB lead status should be converted, got: ${dbLead!.status}`);
    assert(!!dbLead!.convertedToPatientId, "Should have convertedToPatientId");
    assert(!!dbLead!.convertedAt, "Should have convertedAt");

    const dbPatient = await db.query.patientsTable.findFirst({
      where: and(eq(patientsTable.tenantId, tenantId), eq(patientsTable.phone, TEST_PHONE_LEAD)),
    });
    assert(!!dbPatient, "Patient should exist in DB");
    evidence("dbState", {
      leadId: lead!.id, leadStatus: dbLead!.status,
      patientId: dbPatient!.id, convertedToPatientId: dbLead!.convertedToPatientId,
      convertedAt: dbLead!.convertedAt?.toISOString(),
    });
  });

  await runTest("13.2 POST /leads/:id/convert rejects double conversion", async () => {
    const lead = await db.query.dentalLeadsTable.findFirst({
      where: and(eq(dentalLeadsTable.tenantId, tenantId), eq(dentalLeadsTable.phone, TEST_PHONE_LEAD)),
    });

    const res = await api("POST", `/dental/leads/${lead!.id}/convert`, {
      name: "Maria", phone: TEST_PHONE_LEAD,
    });
    assert(res.status === 400, `Should reject, got: ${res.status}`);
    const errorMsg = res.data.error as string;
    assert(errorMsg.includes("already converted"), `Error should say 'already converted'. Got: ${errorMsg}`);
    evidence("apiResponse", { status: res.status, body: res.data });
  });
}

async function test15_RemarketingSchedulerFlow(): Promise<void> {
  console.log("\n📋 Test 15: Remarketing — Scheduler flow via MockProvider\n");

  await runTest("15.1 processLeadRemarketingForTenant() sends AI-generated message to cold lead", async () => {
    const [remarketingLead] = await db.insert(dentalLeadsTable).values({
      tenantId,
      name: "Lead Remarketing Teste",
      phone: TEST_PHONE_REMARKETING,
      source: "whatsapp",
      status: "active",
      temperature: "cold",
      lastContactAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    }).returning();
    assert(!!remarketingLead, "Remarketing lead should be created");

    mockProvider.clearCaptured();
    await processLeadRemarketingForTenant(tenantId, {
      remarketingMaxLeads: 10,
      remarketingIntervalHot: 1,
      remarketingIntervalWarm: 3,
      remarketingIntervalCold: 7,
    });

    const capturedMsgs = mockProvider.getCapturedFor(TEST_PHONE_REMARKETING);
    assert(capturedMsgs.length >= 1, `MockProvider should capture remarketing message, got: ${capturedMsgs.length}`);
    const msgContent = capturedMsgs[0].message;
    assert(msgContent.length > 10, `Remarketing message should have content. Got: ${msgContent.substring(0, 100)}`);
    assert(!msgContent.includes("{nome}") && !msgContent.includes("{clinica}"), `Remarketing message should not contain raw placeholders. Got: ${msgContent.substring(0, 200)}`);

    const activity = await db.query.dentalActivityTable.findFirst({
      where: and(
        eq(dentalActivityTable.tenantId, tenantId),
        eq(dentalActivityTable.type, "remarketing_sent"),
        eq(dentalActivityTable.entityId, remarketingLead.id),
      ),
    });
    assert(!!activity, "Remarketing activity should be logged");

    const outboundMsg = await db.query.dentalMessagesTable.findFirst({
      where: and(
        eq(dentalMessagesTable.tenantId, tenantId),
        eq(dentalMessagesTable.direction, "outbound"),
      ),
      orderBy: [desc(dentalMessagesTable.createdAt)],
    });
    assert(!!outboundMsg, "Outbound message should be stored in dental_messages");
    assert(outboundMsg!.content === msgContent, "Stored message content should match sent content");

    evidence("capturedMessage", { phone: capturedMsgs[0].phone, content: msgContent.substring(0, 300) });
    evidence("dbState", {
      activityType: activity!.type,
      leadId: remarketingLead.id,
      leadTemperature: remarketingLead.temperature,
      messageStored: !!outboundMsg,
    });
  });

  await runTest("15.2 Remarketing is skipped for recently contacted lead", async () => {
    mockProvider.clearCaptured();
    await processLeadRemarketingForTenant(tenantId, {
      remarketingMaxLeads: 10,
      remarketingIntervalHot: 1,
      remarketingIntervalWarm: 3,
      remarketingIntervalCold: 7,
    });

    const capturedMsgs = mockProvider.getCapturedFor(TEST_PHONE_REMARKETING);
    assert(capturedMsgs.length === 0, `Should skip remarketing for recently contacted lead, got: ${capturedMsgs.length}`);
    evidence("skipped", true);
  });
}

async function test16_AISlotAvoidance(): Promise<void> {
  console.log("\n📋 Test 16: AI — Slot avoidance via webhook\n");

  await runTest("16.1 AI does not propose already-booked slot times via webhook", async () => {
    const nextMonday = getNextWeekday(1);
    const bookedStart = new Date(nextMonday);
    bookedStart.setHours(10, 0, 0, 0);
    const bookedEnd = new Date(bookedStart);
    bookedEnd.setMinutes(bookedEnd.getMinutes() + 30);

    const existingPatient = await db.query.patientsTable.findFirst({
      where: and(eq(patientsTable.tenantId, tenantId), eq(patientsTable.phone, TEST_PHONE_PATIENT)),
    });
    assert(!!existingPatient, "Patient should exist from prior tests");

    await db.insert(appointmentsTable).values({
      tenantId,
      patientId: existingPatient!.id,
      procedureName: "Limpeza",
      startsAt: bookedStart,
      endsAt: bookedEnd,
      status: "scheduled",
    });

    const bookedTimeStr = `${String(bookedStart.getHours()).padStart(2, "0")}:${String(bookedStart.getMinutes()).padStart(2, "0")}`;

    const availRes = await api("GET", `/dental/appointments/availability?date=${nextMonday.toISOString().split("T")[0]}&durationMinutes=30`);
    assert(availRes.status === 200, `Availability endpoint should return 200`);
    const availSlots = availRes.data.availableSlots as string[];
    const bookedSlotPresent = availSlots.some((s: string) => s.includes(`T${bookedTimeStr}`));
    assert(!bookedSlotPresent, `Booked slot ${bookedTimeStr} should NOT appear in available slots`);

    const phoneForSlotTest = "5511999990067";
    const [slotTestLead] = await db.insert(dentalLeadsTable).values({
      tenantId,
      name: "Lead Slot Test",
      phone: phoneForSlotTest,
      source: "whatsapp",
      status: "active",
      temperature: "warm",
    }).returning();
    assert(!!slotTestLead, "Slot test lead should be created");

    const instName = await getInstanceName();
    const webhookRes = await webhookMessage(
      instName,
      phoneForSlotTest,
      `Quero agendar uma limpeza para ${nextMonday.toLocaleDateString("pt-BR")} as 10:00`,
      "Lead Slot Test",
    );
    assert(webhookRes.status === 200, `Webhook should return 200, got: ${webhookRes.status}`);

    await new Promise((r) => setTimeout(r, 3000));

    const conversation = await db.query.dentalConversationsTable.findFirst({
      where: and(eq(dentalConversationsTable.tenantId, tenantId), eq(dentalConversationsTable.contactPhone, phoneForSlotTest)),
      orderBy: [desc(dentalConversationsTable.updatedAt)],
    });
    assert(!!conversation, `Conversation should exist for ${phoneForSlotTest}`);
    const lastMsg = await db.query.dentalMessagesTable.findFirst({
      where: and(
        eq(dentalMessagesTable.tenantId, tenantId),
        eq(dentalMessagesTable.conversationId, conversation!.id),
        eq(dentalMessagesTable.direction, "outbound"),
      ),
      orderBy: [desc(dentalMessagesTable.createdAt)],
    });
    assert(!!lastMsg, "AI should respond to slot request");
    const aiResponse = (lastMsg!.content ?? "").toLowerCase();
    const suggestsExactBookedTime = aiResponse.includes("10:00") && aiResponse.includes("confirmad");
    assert(!suggestsExactBookedTime, `AI should not confirm already-booked 10:00 slot. Response: ${(lastMsg!.content ?? "").substring(0, 300)}`);

    evidence("input", `Quero agendar limpeza para ${nextMonday.toLocaleDateString("pt-BR")} as 10:00`);
    evidence("aiResponse", (lastMsg!.content ?? "").substring(0, 300));
    evidence("dbState", { bookedSlot: bookedTimeStr, availableSlots: availSlots.length, suggestsExactBookedTime });
  });
}

async function test14_BirthdaySchedulerFlow(): Promise<void> {
  console.log("\n📋 Test 14: Aniversário — Scheduler flow\n");

  await runTest("14.1 processBirthdayGreetings() sends message to birthday patient via MockProvider", async () => {
    const today = new Date();
    const birthDate = `${today.getFullYear() - 30}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    const [birthdayPatient] = await db.insert(patientsTable).values({
      tenantId, name: "Aniversariante Teste", phone: TEST_PHONE_BIRTHDAY, birthDate,
    }).returning();
    assert(!!birthdayPatient, "Birthday patient should be created");

    const currentHour = today.getHours();
    await db.update(dentalSettingsTable)
      .set({ birthdayHour: currentHour })
      .where(eq(dentalSettingsTable.tenantId, tenantId));

    await ensureBirthdayTable();

    mockProvider.clearCaptured();
    await processBirthdayGreetings();

    const capturedMsgs = mockProvider.getCapturedFor(TEST_PHONE_BIRTHDAY);
    assert(capturedMsgs.length >= 1, `MockProvider should capture birthday message, got: ${capturedMsgs.length}`);
    const birthdayContent = capturedMsgs[0].message;
    assert(birthdayContent.includes("Aniversariante Teste"), `Birthday message should include patient name. Got: ${birthdayContent.substring(0, 200)}`);
    assert(birthdayContent.toLowerCase().includes("aniversario"), `Birthday message should contain 'aniversario'. Got: ${birthdayContent.substring(0, 200)}`);
    assert(!birthdayContent.includes("{nome}") && !birthdayContent.includes("{clinica}"), `Birthday message should not contain raw placeholders. Got: ${birthdayContent.substring(0, 200)}`);
    evidence("capturedMessage", { phone: capturedMsgs[0].phone, content: birthdayContent.substring(0, 300) });

    const birthdaySentRows = await db.execute(sql`
      SELECT * FROM birthday_greetings_sent
      WHERE tenant_id = ${tenantId} AND patient_id = ${birthdayPatient.id} AND year = ${today.getFullYear()}
    `);
    assert(birthdaySentRows.rows.length === 1, `Should have exactly 1 birthday_greetings_sent row, got: ${birthdaySentRows.rows.length}`);

    const activity = await db.query.dentalActivityTable.findFirst({
      where: and(
        eq(dentalActivityTable.tenantId, tenantId),
        eq(dentalActivityTable.type, "birthday_greeting_sent"),
      ),
    });
    assert(!!activity, "Birthday activity should be logged");
    evidence("dbState", {
      activityType: activity!.type,
      activityDescription: activity!.description,
      patientName: birthdayPatient.name,
      birthDate,
      birthdayHourSet: currentHour,
    });
  });

  await runTest("14.2 Birthday greeting is idempotent (not sent twice same year)", async () => {
    mockProvider.clearCaptured();
    await processBirthdayGreetings();

    const capturedMsgs = mockProvider.getCapturedFor(TEST_PHONE_BIRTHDAY);
    assert(capturedMsgs.length === 0, `Should not send birthday greeting again in same year, got: ${capturedMsgs.length}`);
    evidence("idempotent", true);
  });
}

async function test17_ObjectStorageUploadURL(): Promise<void> {
  console.log("\n📋 Test 17: Object Storage — Upload URL Request\n");

  await runTest("17.1 POST /storage/uploads/request-url validates env vars are set", async () => {
    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    const privateDir = process.env.PRIVATE_OBJECT_DIR;
    const publicPaths = process.env.PUBLIC_OBJECT_SEARCH_PATHS;
    assert(!!bucketId, "DEFAULT_OBJECT_STORAGE_BUCKET_ID must be set (bucket not provisioned)");
    assert(!!privateDir, "PRIVATE_OBJECT_DIR must be set for upload flow to work");
    assert(!!publicPaths, "PUBLIC_OBJECT_SEARCH_PATHS must be set for serving to work");
    evidence("dbState", {
      DEFAULT_OBJECT_STORAGE_BUCKET_ID: bucketId ? "set" : "missing",
      PRIVATE_OBJECT_DIR: privateDir ? "set" : "missing",
      PUBLIC_OBJECT_SEARCH_PATHS: publicPaths ? "set" : "missing",
    });
  });

  await runTest("17.2 POST /storage/uploads/request-url returns 200 or 500 (not 401 auth error)", async () => {
    const res = await api("POST", "/storage/uploads/request-url", {
      name: "welcome.mp4",
      size: 1048576,
      contentType: "video/mp4",
    });
    evidence("apiResponse", { status: res.status, body: res.data });
    const isUploadOk = res.status === 200 && !!res.data.uploadURL;
    const isSidecarUnavailableInDev = res.status === 500 && typeof res.data.error === "string" && (res.data.error as string).includes("Failed to generate");
    assert(
      isUploadOk || isSidecarUnavailableInDev,
      `Expected 200 with uploadURL (production) or 500 from sidecar (dev). Got status ${res.status}: ${JSON.stringify(res.data)}`
    );
    if (isUploadOk) {
      assert(typeof res.data.uploadURL === "string" && (res.data.uploadURL as string).startsWith("https://"), "uploadURL should be a valid HTTPS URL");
      assert(typeof res.data.objectPath === "string" && (res.data.objectPath as string).startsWith("/objects/"), "objectPath should start with /objects/");
      evidence("uploadURL", (res.data.uploadURL as string).substring(0, 80) + "...");
      evidence("objectPath", res.data.objectPath);
    }
    evidence("environment", isSidecarUnavailableInDev ? "dev (sidecar signing unavailable)" : "production (sidecar signing available)");
  });

  await runTest("17.3 POST /storage/uploads/request-url rejects invalid body", async () => {
    const res = await api("POST", "/storage/uploads/request-url", { foo: "bar" });
    assert(res.status === 400, `Should return 400 for invalid body, got: ${res.status}`);
    evidence("apiResponse", { status: res.status, body: res.data });
  });
}

function printReport(): void {
  console.log("\n");
  console.log("═══════════════════════════════════════════════════");
  console.log("                 RELATÓRIO FINAL E2E              ");
  console.log("═══════════════════════════════════════════════════\n");

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;
  const total = results.length;

  for (const r of results) {
    const icon = r.status === "PASS" ? "✅" : r.status === "FAIL" ? "❌" : "⏭️";
    console.log(`  ${icon} ${r.name} (${r.duration}ms)`);
    if (r.status === "FAIL") {
      console.log(`     └─ ${r.details}`);
    }
    if (r.evidence && Object.keys(r.evidence).length > 0) {
      console.log(`     📎 ${JSON.stringify(r.evidence)}`);
    }
  }

  console.log("\n───────────────────────────────────────────────────");
  console.log(`  Total: ${total}  |  ✅ Pass: ${passed}  |  ❌ Fail: ${failed}  |  ⏭️ Skip: ${skipped}`);
  console.log(`  Taxa de sucesso: ${total > 0 ? Math.round((passed / total) * 100) : 0}%`);
  console.log("───────────────────────────────────────────────────\n");

  if (failed > 0) {
    console.log("  ⚠️ Testes com falha precisam de atenção!\n");
  } else {
    console.log("  🎉 Todos os testes passaram!\n");
  }

  const report = {
    timestamp: new Date().toISOString(),
    summary: { total, passed, failed, skipped, successRate: total > 0 ? Math.round((passed / total) * 100) : 0 },
    tests: results.map((r) => ({
      name: r.name,
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
    const reportPath = path.join(reportDir, "e2e-report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`  📄 Report saved to ${reportPath}\n`);
  } catch (err) {
    console.log(`  ⚠️ Could not save report: ${err instanceof Error ? err.message : "unknown"}\n`);
  }
}

async function main(): Promise<void> {
  console.log("╔═══════════════════════════════════════════════════╗");
  console.log("║   DentalAI Secretary — Testes E2E Completos     ║");
  console.log("╚═══════════════════════════════════════════════════╝");

  let hasFailures = false;
  try {
    await setup();

    await test1_LeadFirstContactViaWebhook();
    await test2_LeadPriceObjectionViaWebhook();
    await test3_RemarketingLogic();
    await test4_PatientSchedulingViaAPI();
    await test5_PatientCancellationViaAPI();
    await test6_PatientReschedulingViaAPI();
    await test7_FollowUpReminder24h();
    await test8_FollowUpPostAppointment();
    await test9_NoShowRecovery();
    await test10_AvailabilityConflictsViaAPI();
    await test11_ScheduleConfigRespect();
    await test12_CancelledFollowupSkipped();
    await test13_LeadConversionViaAPI();
    await test14_BirthdaySchedulerFlow();
    await test15_RemarketingSchedulerFlow();
    await test16_AISlotAvoidance();
    await test17_ObjectStorageUploadURL();

    printReport();
    hasFailures = results.some((r) => r.status === "FAIL");
  } catch (err) {
    console.error("\n💥 Fatal error during tests:", err);
    hasFailures = true;
  } finally {
    await cleanup();
    process.exit(hasFailures ? 1 : 0);
  }
}

main();
