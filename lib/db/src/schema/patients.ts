import { pgTable, text, serial, timestamp, integer, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const patientsTable = pgTable("patients", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 50 }).notNull(),
  email: varchar("email", { length: 255 }),
  birthDate: varchar("birth_date", { length: 20 }),
  cpf: varchar("cpf", { length: 255 }),
  address: text("address"),
  notes: text("notes"),
  profilePicUrl: text("profile_pic_url"),
  firstVisit: timestamp("first_visit", { withTimezone: true }),
  lastVisit: timestamp("last_visit", { withTimezone: true }),
  totalSpent: varchar("total_spent", { length: 20 }).notNull().default("0"),
  patientType: varchar("patient_type", { length: 20 }).default("private"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPatientSchema = createInsertSchema(patientsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPatient = z.infer<typeof insertPatientSchema>;
export type Patient = typeof patientsTable.$inferSelect;
