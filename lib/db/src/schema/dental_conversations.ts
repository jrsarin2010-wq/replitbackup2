import { pgTable, text, serial, timestamp, integer, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const dentalConversationsTable = pgTable("dental_conversations", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  contactPhone: varchar("contact_phone", { length: 50 }).notNull(),
  contactName: varchar("contact_name", { length: 255 }),
  contactProfilePicUrl: text("contact_profile_pic_url"),
  contactType: varchar("contact_type", { length: 20 }).notNull().default("unknown"),
  patientId: integer("patient_id"),
  leadId: integer("lead_id"),
  status: varchar("status", { length: 50 }).notNull().default("open"),
  sentiment: varchar("sentiment", { length: 20 }).default("neutral"),
  sentimentScore: integer("sentiment_score").default(0),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }),
  escalationReason: varchar("escalation_reason", { length: 50 }),
  humanTakeoverAt: timestamp("human_takeover_at", { withTimezone: true }),
  humanTakeoverExpiresAt: timestamp("human_takeover_expires_at", { withTimezone: true }),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  lastMessagePreview: text("last_message_preview"),
  unreadCount: integer("unread_count").notNull().default(0),
  aiSummary: text("ai_summary"),
  aiSummaryMessageCount: integer("ai_summary_message_count").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDentalConversationSchema = createInsertSchema(dentalConversationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDentalConversation = z.infer<typeof insertDentalConversationSchema>;
export type DentalConversation = typeof dentalConversationsTable.$inferSelect;
