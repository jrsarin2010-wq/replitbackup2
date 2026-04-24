import { pgTable, text, serial, timestamp, integer, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const aiObjectionPatternsTable = pgTable("ai_objection_patterns", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  category: varchar("category", { length: 50 }).notNull(),
  objection: text("objection").notNull(),
  counterArgument: text("counter_argument"),
  editedCounterArgument: text("edited_counter_argument"),
  successCount: integer("success_count").notNull().default(0),
  totalCount: integer("total_count").notNull().default(1),
  occurrences: integer("occurrences").notNull().default(1),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: varchar("approved_by", { length: 20 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiObjectionPatternsSchema = createInsertSchema(aiObjectionPatternsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiObjectionPatterns = z.infer<typeof insertAiObjectionPatternsSchema>;
export type AiObjectionPatterns = typeof aiObjectionPatternsTable.$inferSelect;
