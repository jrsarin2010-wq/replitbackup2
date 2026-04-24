import { pgTable, serial, timestamp, integer, varchar, text, date } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { dentalProfessionalsTable } from "./dental_professionals";

export const dentalWaitlistTable = pgTable("dental_waitlist", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  contactPhone: varchar("contact_phone", { length: 50 }).notNull(),
  contactName: varchar("contact_name", { length: 255 }),
  professionalId: integer("professional_id").references(() => dentalProfessionalsTable.id, { onDelete: "set null" }),
  patientId: integer("patient_id"),
  leadId: integer("lead_id"),
  preferredDate: date("preferred_date"),
  preferredTimeSlot: varchar("preferred_time_slot", { length: 30 }),
  preferredTimeOfDay: varchar("preferred_time_of_day", { length: 20 }).notNull().default("any"),
  notes: text("notes"),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  notificationCount: integer("notification_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DentalWaitlist = typeof dentalWaitlistTable.$inferSelect;
export type InsertDentalWaitlist = typeof dentalWaitlistTable.$inferInsert;
