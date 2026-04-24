import { pgTable, text, serial, timestamp, integer, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const dentalActivityTable = pgTable("dental_activity", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 100 }).notNull(),
  description: text("description").notNull(),
  entityType: varchar("entity_type", { length: 50 }),
  entityId: integer("entity_id"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDentalActivitySchema = createInsertSchema(dentalActivityTable).omit({ id: true, createdAt: true });
export type InsertDentalActivity = z.infer<typeof insertDentalActivitySchema>;
export type DentalActivity = typeof dentalActivityTable.$inferSelect;
