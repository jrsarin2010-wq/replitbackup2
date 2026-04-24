import { pgTable, text, serial, timestamp, integer, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { dentalProfessionalsTable } from "./dental_professionals";

export const dentalLeadsTable = pgTable("dental_leads", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 50 }).notNull(),
  email: varchar("email", { length: 255 }),
  temperature: varchar("temperature", { length: 20 }).notNull().default("cold"),
  source: varchar("source", { length: 100 }),
  interest: text("interest"),
  notes: text("notes"),
  profilePicUrl: text("profile_pic_url"),
  status: varchar("status", { length: 50 }).notNull().default("active"),
  professionalId: integer("professional_id").references(() => dentalProfessionalsTable.id, { onDelete: "set null" }),
  convertedToPatientId: integer("converted_to_patient_id"),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
  lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
  paymentType: varchar("payment_type", { length: 20 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDentalLeadSchema = createInsertSchema(dentalLeadsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDentalLead = z.infer<typeof insertDentalLeadSchema>;
export type DentalLead = typeof dentalLeadsTable.$inferSelect;
