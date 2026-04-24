import { pgTable, text, serial, timestamp, integer, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const dentalProceduresTable = pgTable("dental_procedures", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  price: varchar("price", { length: 20 }).notNull().default("0"),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  active: text("active").notNull().default("true"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDentalProcedureSchema = createInsertSchema(dentalProceduresTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDentalProcedure = z.infer<typeof insertDentalProcedureSchema>;
export type DentalProcedure = typeof dentalProceduresTable.$inferSelect;
