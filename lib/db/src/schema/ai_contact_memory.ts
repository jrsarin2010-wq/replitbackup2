import { pgTable, text, serial, timestamp, integer, varchar, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const aiContactMemoryTable = pgTable("ai_contact_memory", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  contactPhone: varchar("contact_phone", { length: 50 }).notNull(),
  memoryType: varchar("memory_type", { length: 50 }).notNull(),
  content: text("content").notNull(),
  editedContent: text("edited_content"),
  source: varchar("source", { length: 20 }).notNull().default("auto"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  conversationId: integer("conversation_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Garante unicidade do registro "agendou em X" por (tenant, contato, conteúdo).
  // Índice parcial: só vale para memory_type='agendamento'. Combinado com
  // INSERT ... ON CONFLICT DO NOTHING em persistConfirmSlotSignal, protege
  // contra duplicatas mesmo em ambiente multi-processo.
  uniqAgendamentoPerContact: uniqueIndex("uniq_ai_contact_memory_agendamento")
    .on(t.tenantId, t.contactPhone, sql`lower(${t.content})`)
    .where(sql`memory_type = 'agendamento'`),
}));

export const insertAiContactMemorySchema = createInsertSchema(aiContactMemoryTable).omit({ id: true, createdAt: true });
export type InsertAiContactMemory = z.infer<typeof insertAiContactMemorySchema>;
export type AiContactMemory = typeof aiContactMemoryTable.$inferSelect;
