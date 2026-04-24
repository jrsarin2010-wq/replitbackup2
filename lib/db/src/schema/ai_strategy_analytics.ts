import { pgTable, text, serial, timestamp, integer, varchar, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const aiStrategyAnalyticsTable = pgTable("ai_strategy_analytics", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  strategy: varchar("strategy", { length: 50 }).notNull(),
  leadTemperature: varchar("lead_temperature", { length: 20 }),
  procedureInterest: varchar("procedure_interest", { length: 255 }),
  converted: boolean("converted").notNull().default(false),
  conversationId: integer("conversation_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAiStrategyAnalyticsSchema = createInsertSchema(aiStrategyAnalyticsTable).omit({ id: true, createdAt: true });
export type InsertAiStrategyAnalytics = z.infer<typeof insertAiStrategyAnalyticsSchema>;
export type AiStrategyAnalytics = typeof aiStrategyAnalyticsTable.$inferSelect;
