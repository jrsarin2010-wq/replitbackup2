import { pgTable, text, serial, timestamp, integer, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const aiKnowledgeBaseTable = pgTable("ai_knowledge_base", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  editedAnswer: text("edited_answer"),
  category: varchar("category", { length: 100 }).notNull().default("geral"),
  frequency: integer("frequency").notNull().default(1),
  occurrences: integer("occurrences").notNull().default(1),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: varchar("approved_by", { length: 20 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiKnowledgeBaseSchema = createInsertSchema(aiKnowledgeBaseTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiKnowledgeBase = z.infer<typeof insertAiKnowledgeBaseSchema>;
export type AiKnowledgeBase = typeof aiKnowledgeBaseTable.$inferSelect;
