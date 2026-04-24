import { pgTable, text, serial, timestamp, integer, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { patientsTable } from "./patients";
import { dentalProceduresTable } from "./dental_procedures";
import { dentalLeadsTable } from "./dental_leads";
import { dentalProfessionalsTable } from "./dental_professionals";

export const appointmentsTable = pgTable("appointments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  patientId: integer("patient_id").references(() => patientsTable.id, { onDelete: "cascade" }),
  leadId: integer("lead_id").references(() => dentalLeadsTable.id, { onDelete: "set null" }),
  procedureId: integer("procedure_id").references(() => dentalProceduresTable.id),
  professionalId: integer("professional_id").references(() => dentalProfessionalsTable.id, { onDelete: "set null" }),
  procedureName: varchar("procedure_name", { length: 255 }),
  status: varchar("status", { length: 50 }).notNull().default("scheduled"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  price: varchar("price", { length: 20 }),
  notes: text("notes"),
  pixPaymentStatus: varchar("pix_payment_status", { length: 20 }).notNull().default("none"),
  reminderSent: text("reminder_sent").notNull().default("false"),
  confirmationSent: text("confirmation_sent").notNull().default("false"),
  confirmed: text("confirmed").notNull().default("false"),
  followUpSent: text("follow_up_sent").notNull().default("false"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAppointmentSchema = createInsertSchema(appointmentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;
export type Appointment = typeof appointmentsTable.$inferSelect;
