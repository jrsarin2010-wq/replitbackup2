import { pgTable, text, serial, timestamp, integer, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { dentalConversationsTable } from "./dental_conversations";

export const dentalMessagesTable = pgTable("dental_messages", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  conversationId: integer("conversation_id").notNull().references(() => dentalConversationsTable.id, { onDelete: "cascade" }),
  direction: varchar("direction", { length: 10 }).notNull(),
  type: varchar("type", { length: 20 }).notNull().default("text"),
  content: text("content"),
  audioUrl: text("audio_url"),
  audioTranscript: text("audio_transcript"),
  externalId: varchar("external_id", { length: 255 }),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Task #15 — immutable audit chain
  hash: varchar("hash", { length: 64 }),
  prevHash: varchar("prev_hash", { length: 64 }),
  aiModel: varchar("ai_model", { length: 100 }),
  promptVersion: varchar("prompt_version", { length: 50 }),
  serverTs: timestamp("server_ts", { withTimezone: true }),
});

export const insertDentalMessageSchema = createInsertSchema(dentalMessagesTable).omit({ id: true, createdAt: true });
export type InsertDentalMessage = z.infer<typeof insertDentalMessageSchema>;
export type DentalMessage = typeof dentalMessagesTable.$inferSelect;
