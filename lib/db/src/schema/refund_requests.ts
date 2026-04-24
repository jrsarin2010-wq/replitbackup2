import { pgTable, serial, integer, text, timestamp, varchar, boolean } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const refundRequestsTable = pgTable("refund_requests", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }).notNull(),
  planAtRequest: varchar("plan_at_request", { length: 50 }).notNull(),
  referenceDate: timestamp("reference_date", { withTimezone: true }).notNull(),
  withinSevenDayWindow: boolean("within_seven_day_window").notNull(),
  daysSinceReference: integer("days_since_reference").notNull(),
  status: varchar("status", { length: 30 }).notNull().default("pending"),
  reasonText: text("reason_text"),
  amountBrl: integer("amount_brl"),
  externalProvider: varchar("external_provider", { length: 50 }),
  externalRefundId: varchar("external_refund_id", { length: 120 }),
  adminNotes: text("admin_notes"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type RefundRequest = typeof refundRequestsTable.$inferSelect;
export type InsertRefundRequest = typeof refundRequestsTable.$inferInsert;
