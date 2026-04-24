import { pgTable, text, serial, timestamp, integer, varchar, boolean, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const dentalBlockedPeriodsTable = pgTable("dental_blocked_periods", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  publicMessage: text("public_message"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDentalBlockedPeriodSchema = createInsertSchema(dentalBlockedPeriodsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDentalBlockedPeriod = z.infer<typeof insertDentalBlockedPeriodSchema>;
export type DentalBlockedPeriod = typeof dentalBlockedPeriodsTable.$inferSelect;
