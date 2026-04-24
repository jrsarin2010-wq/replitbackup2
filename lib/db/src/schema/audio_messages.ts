import { pgTable, text, serial, timestamp, integer, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { dentalConversationsTable } from "./dental_conversations";

export const audioMessagesTable = pgTable("audio_messages", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  conversationId: integer("conversation_id").references(() => dentalConversationsTable.id),
  direction: varchar("direction", { length: 10 }).notNull(),
  audioUrl: text("audio_url"),
  audioData: text("audio_data"),
  mimeType: varchar("mime_type", { length: 50 }),
  durationSeconds: integer("duration_seconds"),
  transcript: text("transcript"),
  transcriptionStatus: varchar("transcription_status", { length: 20 }).notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAudioMessageSchema = createInsertSchema(audioMessagesTable).omit({ id: true, createdAt: true });
export type InsertAudioMessage = z.infer<typeof insertAudioMessageSchema>;
export type AudioMessage = typeof audioMessagesTable.$inferSelect;
