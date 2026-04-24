import { pgTable, serial, integer, timestamp, varchar, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenantsTable } from "./tenants";

export const planUpgradeOrdersTable = pgTable("plan_upgrade_orders", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  fromPlan: varchar("from_plan", { length: 50 }).notNull(),
  targetPlan: varchar("target_plan", { length: 50 }).notNull(),
  priceInCents: integer("price_in_cents").notNull(),
  creditInCents: integer("credit_in_cents").notNull().default(0),
  finalChargeInCents: integer("final_charge_in_cents").notNull(),
  billingId: varchar("billing_id", { length: 255 }),
  paymentUrl: text("payment_url"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
}, (t) => ({
  // Idempotency guard: at most one pending upgrade order per tenant.
  oneActivePerTenant: uniqueIndex("plan_upgrade_orders_one_pending_per_tenant")
    .on(t.tenantId)
    .where(sql`status = 'pending'`),
}));
