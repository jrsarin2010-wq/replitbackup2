import { db } from "@workspace/db";
import {
  tenantsTable,
  patientsTable,
  dentalProceduresTable,
  appointmentsTable,
  dentalLeadsTable,
  dentalConversationsTable,
  dentalMessagesTable,
  dentalSettingsTable,
  dentalActivityTable,
  appointmentFollowUpsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

async function seed() {
  console.log("Seeding database...");

  const existingTenants = await db.query.tenantsTable.findMany();
  if (existingTenants.length > 0) {
    console.log(`Found ${existingTenants.length} existing tenants. Skipping seed.`);
    console.log("Tenants:", existingTenants.map((t) => `${t.id}: ${t.name} (${t.slug})`).join(", "));
    process.exit(0);
  }

  const [tenant] = await db.insert(tenantsTable).values({
    name: "Clínica Sorriso Perfeito",
    slug: "sorriso-perfeito",
    plan: "pro",
  }).returning();

  console.log(`Created tenant: ${tenant.name} (ID: ${tenant.id})`);

  await db.insert(dentalSettingsTable).values({
    tenantId: tenant.id,
    clinicName: "Clínica Sorriso Perfeito",
    clinicPhone: "+55 11 99999-0001",
    clinicAddress: "Av. Paulista, 1000 - São Paulo, SP",
    workingHoursStart: "08:00",
    workingHoursEnd: "18:00",
    workingDays: "1,2,3,4,5",
    slotDurationMinutes: 60,
    aiPersonality: "Sou o assistente virtual da Clínica Sorriso Perfeito. Sou amigável, atencioso e sempre pronto para ajudar com agendamentos e dúvidas.",
    aiLanguage: "pt-BR",
    reminderHoursBefore: 24,
  });

  const procedures = await db.insert(dentalProceduresTable).values([
    { tenantId: tenant.id, name: "Limpeza Dental", description: "Profilaxia e remoção de tártaro", price: "180", durationMinutes: 60 },
    { tenantId: tenant.id, name: "Consulta Avaliação", description: "Avaliação odontológica completa", price: "150", durationMinutes: 30 },
    { tenantId: tenant.id, name: "Clareamento Dental", description: "Clareamento a laser", price: "800", durationMinutes: 90 },
    { tenantId: tenant.id, name: "Extração", description: "Extração de dente", price: "300", durationMinutes: 60 },
    { tenantId: tenant.id, name: "Restauração", description: "Restauração em resina composta", price: "250", durationMinutes: 60 },
    { tenantId: tenant.id, name: "Raio-X Panorâmico", description: "Radiografia panorâmica", price: "120", durationMinutes: 15 },
    { tenantId: tenant.id, name: "Canal (Endodontia)", description: "Tratamento de canal", price: "1200", durationMinutes: 120 },
    { tenantId: tenant.id, name: "Ortodontia Avaliação", description: "Avaliação para aparelho", price: "200", durationMinutes: 45 },
  ]).returning();

  const patients = await db.insert(patientsTable).values([
    { tenantId: tenant.id, name: "Ana Costa Silva", phone: "+5511987650001", email: "ana.costa@email.com", birthDate: "1985-03-15", cpf: "111.222.333-44", totalSpent: "1850" },
    { tenantId: tenant.id, name: "Carlos Mendes", phone: "+5511987650002", email: "carlos.mendes@email.com", birthDate: "1972-08-22", cpf: "222.333.444-55", totalSpent: "2400" },
    { tenantId: tenant.id, name: "Beatriz Lima", phone: "+5511987650003", email: "beatriz.lima@email.com", birthDate: "1990-11-05", totalSpent: "680" },
    { tenantId: tenant.id, name: "Roberto Alves", phone: "+5511987650004", email: "roberto.alves@email.com", birthDate: "1968-05-30", cpf: "333.444.555-66", totalSpent: "3200" },
    { tenantId: tenant.id, name: "Fernanda Souza", phone: "+5511987650005", email: "fernanda.s@email.com", birthDate: "1995-02-18", totalSpent: "450" },
    { tenantId: tenant.id, name: "Marcos Paulo", phone: "+5511987650006", email: "marcos.p@email.com", birthDate: "1980-09-12", cpf: "444.555.666-77", totalSpent: "950" },
    { tenantId: tenant.id, name: "Luciana Torres", phone: "+5511987650007", email: "lu.torres@email.com", birthDate: "1988-06-25", totalSpent: "1200" },
    { tenantId: tenant.id, name: "Pedro Rodrigues", phone: "+5511987650008", birthDate: "1975-12-08", totalSpent: "0" },
  ]).returning();

  const now = new Date();
  const todayBase = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);

  const appts = await db.insert(appointmentsTable).values([
    { tenantId: tenant.id, patientId: patients[0].id, procedureId: procedures[0].id, procedureName: "Limpeza Dental", status: "scheduled", startsAt: new Date(todayBase.getTime()), endsAt: new Date(todayBase.getTime() + 3600000), price: "180" },
    { tenantId: tenant.id, patientId: patients[1].id, procedureId: procedures[2].id, procedureName: "Clareamento Dental", status: "scheduled", startsAt: new Date(todayBase.getTime() + 3600000), endsAt: new Date(todayBase.getTime() + 3600000 * 2.5), price: "800" },
    { tenantId: tenant.id, patientId: patients[2].id, procedureId: procedures[1].id, procedureName: "Consulta Avaliação", status: "completed", startsAt: new Date(todayBase.getTime() - 86400000), endsAt: new Date(todayBase.getTime() - 86400000 + 1800000), price: "150" },
    { tenantId: tenant.id, patientId: patients[3].id, procedureId: procedures[6].id, procedureName: "Canal (Endodontia)", status: "completed", startsAt: new Date(todayBase.getTime() - 86400000 * 2), endsAt: new Date(todayBase.getTime() - 86400000 * 2 + 7200000), price: "1200" },
    { tenantId: tenant.id, patientId: patients[4].id, procedureId: procedures[0].id, procedureName: "Limpeza Dental", status: "completed", startsAt: new Date(todayBase.getTime() - 86400000 * 3), endsAt: new Date(todayBase.getTime() - 86400000 * 3 + 3600000), price: "180" },
    { tenantId: tenant.id, patientId: patients[5].id, procedureId: procedures[4].id, procedureName: "Restauração", status: "scheduled", startsAt: new Date(todayBase.getTime() + 86400000), endsAt: new Date(todayBase.getTime() + 86400000 + 3600000), price: "250" },
    { tenantId: tenant.id, patientId: patients[6].id, procedureId: procedures[3].id, procedureName: "Extração", status: "scheduled", startsAt: new Date(todayBase.getTime() + 86400000 * 2), endsAt: new Date(todayBase.getTime() + 86400000 * 2 + 3600000), price: "300" },
    { tenantId: tenant.id, patientId: patients[0].id, procedureId: procedures[7].id, procedureName: "Ortodontia Avaliação", status: "cancelled", startsAt: new Date(todayBase.getTime() - 86400000 * 5), endsAt: new Date(todayBase.getTime() - 86400000 * 5 + 2700000), price: "200" },
    { tenantId: tenant.id, patientId: patients[1].id, procedureId: procedures[0].id, procedureName: "Limpeza Dental", status: "completed", startsAt: new Date(todayBase.getTime() - 86400000 * 7), endsAt: new Date(todayBase.getTime() - 86400000 * 7 + 3600000), price: "180" },
    { tenantId: tenant.id, patientId: patients[3].id, procedureId: procedures[4].id, procedureName: "Restauração", status: "completed", startsAt: new Date(todayBase.getTime() - 86400000 * 10), endsAt: new Date(todayBase.getTime() - 86400000 * 10 + 3600000), price: "250" },
  ]).returning();

  for (const appt of appts.filter((a) => a.status === "scheduled")) {
    await db.insert(appointmentFollowUpsTable).values([
      { tenantId: tenant.id, appointmentId: appt.id, type: "reminder_24h", status: "pending", scheduledAt: new Date(appt.startsAt.getTime() - 86400000) },
      { tenantId: tenant.id, appointmentId: appt.id, type: "post_appointment", status: "pending", scheduledAt: new Date(appt.endsAt.getTime() + 3600000) },
    ]);
  }

  const leads = await db.insert(dentalLeadsTable).values([
    { tenantId: tenant.id, name: "João Pereira", phone: "+5511987660001", email: "joao.p@email.com", temperature: "hot", source: "instagram", interest: "Clareamento dental e limpeza" },
    { tenantId: tenant.id, name: "Maria Santos", phone: "+5511987660002", email: "maria.s@email.com", temperature: "warm", source: "whatsapp", interest: "Consulta de avaliação" },
    { tenantId: tenant.id, name: "Paulo Andrade", phone: "+5511987660003", temperature: "cold", source: "google", interest: "Tratamento de canal" },
    { tenantId: tenant.id, name: "Carla Ribeiro", phone: "+5511987660004", email: "carla.r@email.com", temperature: "hot", source: "indicação", interest: "Aparelho ortodôntico" },
    { tenantId: tenant.id, name: "Diego Ferreira", phone: "+5511987660005", temperature: "warm", source: "facebook", interest: "Clareamento" },
    { tenantId: tenant.id, name: "Ingrid Melo", phone: "+5511987660006", email: "ingrid.m@email.com", temperature: "cold", source: "google" },
  ]).returning();

  const convs = await db.insert(dentalConversationsTable).values([
    { tenantId: tenant.id, contactPhone: patients[0].phone, contactName: patients[0].name, contactType: "patient", patientId: patients[0].id, status: "open", lastMessageAt: new Date(now.getTime() - 3600000), lastMessagePreview: "Obrigada pela confirmação!" },
    { tenantId: tenant.id, contactPhone: leads[0].phone, contactName: leads[0].name, contactType: "lead", leadId: leads[0].id, status: "open", lastMessageAt: new Date(now.getTime() - 7200000), lastMessagePreview: "Qual o valor do clareamento?" },
    { tenantId: tenant.id, contactPhone: leads[1].phone, contactName: leads[1].name, contactType: "lead", leadId: leads[1].id, status: "open", lastMessageAt: new Date(now.getTime() - 86400000), lastMessagePreview: "Quero agendar uma consulta" },
    { tenantId: tenant.id, contactPhone: patients[1].phone, contactName: patients[1].name, contactType: "patient", patientId: patients[1].id, status: "closed", lastMessageAt: new Date(now.getTime() - 86400000 * 3), lastMessagePreview: "Até logo!" },
  ]).returning();

  await db.insert(dentalMessagesTable).values([
    { tenantId: tenant.id, conversationId: convs[0].id, direction: "inbound", type: "text", content: "Oi! Quero confirmar meu horário de amanhã", sentAt: new Date(now.getTime() - 7200000) },
    { tenantId: tenant.id, conversationId: convs[0].id, direction: "outbound", type: "text", content: "Olá Ana! Seu horário de amanhã às 9h para limpeza dental está confirmado. Até logo!", sentAt: new Date(now.getTime() - 3600000) },
    { tenantId: tenant.id, conversationId: convs[1].id, direction: "inbound", type: "text", content: "Qual o valor do clareamento dental?", sentAt: new Date(now.getTime() - 9000000) },
    { tenantId: tenant.id, conversationId: convs[1].id, direction: "outbound", type: "text", content: "Olá João! O clareamento dental a laser custa R$800. Posso agendar uma avaliação gratuita para você?", sentAt: new Date(now.getTime() - 7200000) },
    { tenantId: tenant.id, conversationId: convs[2].id, direction: "inbound", type: "text", content: "Boa tarde! Quero agendar uma consulta de avaliação", sentAt: new Date(now.getTime() - 86400000) },
    { tenantId: tenant.id, conversationId: convs[2].id, direction: "outbound", type: "text", content: "Boa tarde Maria! Temos horários disponíveis amanhã às 10h ou 14h. Qual prefere?", sentAt: new Date(now.getTime() - 86400000 + 300000) },
  ]);

  await db.insert(dentalActivityTable).values([
    { tenantId: tenant.id, type: "appointment_created", description: "Agendamento criado para Ana Costa Silva", entityType: "appointment", entityId: appts[0].id },
    { tenantId: tenant.id, type: "appointment_completed", description: "Consulta de Beatriz Lima concluída", entityType: "appointment", entityId: appts[2].id },
    { tenantId: tenant.id, type: "lead_created", description: "Novo lead: João Pereira (hot)", entityType: "lead", entityId: leads[0].id },
    { tenantId: tenant.id, type: "ai_reply", description: "Resposta automática enviada para +5511987660001", entityType: "conversation", entityId: convs[1].id },
    { tenantId: tenant.id, type: "appointment_created", description: "Agendamento criado para Carlos Mendes", entityType: "appointment", entityId: appts[1].id },
  ]);

  console.log("Seed complete!");
  console.log(`- 1 tenant created (ID: ${tenant.id})`);
  console.log(`- ${procedures.length} procedures`);
  console.log(`- ${patients.length} patients`);
  console.log(`- ${appts.length} appointments`);
  console.log(`- ${leads.length} leads`);
  console.log(`- ${convs.length} conversations`);
  console.log(`Tenant ID: ${tenant.id} — use this as X-Tenant-ID header`);

  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
