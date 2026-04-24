import { pgTable, text, serial, timestamp, integer, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { appointmentsTable } from "./appointments";

export const appointmentFollowUpsTable = pgTable("appointment_follow_ups", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  appointmentId: integer("appointment_id").notNull().references(() => appointmentsTable.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 50 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  message: text("message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAppointmentFollowUpSchema = createInsertSchema(appointmentFollowUpsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAppointmentFollowUp = z.infer<typeof insertAppointmentFollowUpSchema>;
export type AppointmentFollowUp = typeof appointmentFollowUpsTable.$inferSelect;
