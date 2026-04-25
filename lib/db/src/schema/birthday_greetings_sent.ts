import { pgTable, serial, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const birthdayGreetingsSentTable = pgTable(
  "birthday_greetings_sent",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull(),
    patientId: integer("patient_id").notNull(),
    year: integer("year").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqTenantPatientYear: uniqueIndex("birthday_greetings_sent_tenant_id_patient_id_year_key").on(
      t.tenantId,
      t.patientId,
      t.year,
    ),
  }),
);

export const insertBirthdayGreetingSentSchema = createInsertSchema(birthdayGreetingsSentTable).omit({
  id: true,
  sentAt: true,
});
export type InsertBirthdayGreetingSent = z.infer<typeof insertBirthdayGreetingSentSchema>;
export type BirthdayGreetingSent = typeof birthdayGreetingsSentTable.$inferSelect;
