import { pgTable, serial, integer, jsonb, timestamp, unique } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const tutorChatSessionsTable = pgTable("tutor_chat_sessions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  messages: jsonb("messages").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.tenantId)]);

export type TutorChatSession = typeof tutorChatSessionsTable.$inferSelect;
