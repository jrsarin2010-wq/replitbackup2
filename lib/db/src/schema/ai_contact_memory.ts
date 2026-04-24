import { pgTable, text, serial, timestamp, integer, varchar } from "drizzle-orm/pg-core";
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
});

export const insertAiContactMemorySchema = createInsertSchema(aiContactMemoryTable).omit({ id: true, createdAt: true });
export type InsertAiContactMemory = z.infer<typeof insertAiContactMemorySchema>;
export type AiContactMemory = typeof aiContactMemoryTable.$inferSelect;
