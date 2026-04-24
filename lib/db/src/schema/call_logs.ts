import { pgTable, serial, integer, varchar, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { dentalLeadsTable } from "./dental_leads";
import { patientsTable } from "./patients";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const callLogsTable = pgTable("call_logs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  leadId: integer("lead_id").references(() => dentalLeadsTable.id, { onDelete: "set null" }),
  patientId: integer("patient_id").references(() => patientsTable.id, { onDelete: "set null" }),
  vapiCallId: varchar("vapi_call_id", { length: 200 }),
  phone: varchar("phone", { length: 50 }).notNull(),
  direction: varchar("direction", { length: 20 }).notNull().default("outbound"),
  status: varchar("status", { length: 50 }).notNull().default("initiated"),
  trigger: varchar("trigger", { length: 50 }),
  duration: integer("duration"),
  transcript: text("transcript"),
  summary: text("summary"),
  outcome: varchar("outcome", { length: 50 }),
  answeredByHuman: boolean("answered_by_human"),
  endedReason: varchar("ended_reason", { length: 100 }),
  cost: varchar("cost", { length: 20 }),
  recordingUrl: text("recording_url"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCallLogSchema = createInsertSchema(callLogsTable).omit({ id: true, createdAt: true });
export type InsertCallLog = z.infer<typeof insertCallLogSchema>;
export type CallLog = typeof callLogsTable.$inferSelect;
