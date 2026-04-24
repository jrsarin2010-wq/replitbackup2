import { pgTable, text, serial, timestamp, integer, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const dataAuditLogTable = pgTable("data_audit_log", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  action: varchar("action", { length: 20 }).notNull(),
  entityType: varchar("entity_type", { length: 50 }).notNull(),
  entityId: integer("entity_id"),
  field: varchar("field", { length: 100 }),
  userId: integer("user_id"),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDataAuditLogSchema = createInsertSchema(dataAuditLogTable).omit({ id: true, createdAt: true });
export type InsertDataAuditLog = z.infer<typeof insertDataAuditLogSchema>;
export type DataAuditLog = typeof dataAuditLogTable.$inferSelect;
