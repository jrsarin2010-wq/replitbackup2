import { pgTable, serial, integer, timestamp, varchar, text } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const dentalAudioCreditsTable = pgTable("dental_audio_credits", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }).unique(),
  balance: integer("balance").notNull().default(0),
  monthlyCharsUsed: integer("monthly_chars_used").notNull().default(0),
  monthlyResetDate: timestamp("monthly_reset_date", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const dentalCreditTransactionsTable = pgTable("dental_credit_transactions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  type: varchar("type", { length: 20 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const professionalSlotOrdersTable = pgTable("professional_slot_orders", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  priceInCents: integer("price_in_cents").notNull(),
  billingId: varchar("billing_id", { length: 255 }),
  paymentUrl: text("payment_url"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
});

export const dentalCreditOrdersTable = pgTable("dental_credit_orders", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  packageId: varchar("package_id", { length: 50 }).notNull(),
  chars: integer("chars").notNull(),
  priceInCents: integer("price_in_cents").notNull(),
  billingId: varchar("billing_id", { length: 255 }),
  paymentUrl: text("payment_url"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
});
