import { pgTable, text, serial, timestamp, integer, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const consentRecordsTable = pgTable("consent_records", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  entityType: varchar("entity_type", { length: 20 }).notNull(),
  entityId: integer("entity_id").notNull(),
  consentType: varchar("consent_type", { length: 50 }).notNull(),
  termsVersion: varchar("terms_version", { length: 20 }).notNull().default("1.0"),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const insertConsentRecordSchema = createInsertSchema(consentRecordsTable).omit({ id: true, grantedAt: true });
export type InsertConsentRecord = z.infer<typeof insertConsentRecordSchema>;
export type ConsentRecord = typeof consentRecordsTable.$inferSelect;
