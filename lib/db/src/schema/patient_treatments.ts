import { pgTable, text, serial, timestamp, integer, varchar, boolean, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { patientsTable } from "./patients";

export const patientTreatmentsTable = pgTable("patient_treatments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
  description: varchar("description", { length: 500 }).notNull(),
  procedures: text("procedures").notNull().default("[]"),
  totalValue: decimal("total_value", { precision: 10, scale: 2 }).notNull().default("0"),
  paidValue: decimal("paid_value", { precision: 10, scale: 2 }).notNull().default("0"),
  paymentMethod: varchar("payment_method", { length: 50 }),
  status: varchar("status", { length: 30 }).notNull().default("in_progress"),
  notes: text("notes"),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPatientTreatmentSchema = createInsertSchema(patientTreatmentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPatientTreatment = z.infer<typeof insertPatientTreatmentSchema>;
export type PatientTreatment = typeof patientTreatmentsTable.$inferSelect;
