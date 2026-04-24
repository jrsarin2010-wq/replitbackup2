import { pgTable, serial, integer, timestamp, varchar, text } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const dentalConversationQuotasTable = pgTable("dental_conversation_quotas", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }).unique(),
  monthlyConversationsUsed: integer("monthly_conversations_used").notNull().default(0),
  monthlyResetDate: timestamp("monthly_reset_date", { withTimezone: true }).notNull().defaultNow(),
  rechargeBalance: integer("recharge_balance").notNull().default(0),
  alert80SentAt: timestamp("alert_80_sent_at", { withTimezone: true }),
  alert100SentAt: timestamp("alert_100_sent_at", { withTimezone: true }),
  lastZeroedNotifSentAt: timestamp("last_zeroed_notif_sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const dentalConversationOrdersTable = pgTable("dental_conversation_orders", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  packageId: varchar("package_id", { length: 50 }).notNull(),
  conversations: integer("conversations").notNull(),
  priceInCents: integer("price_in_cents").notNull(),
  billingId: varchar("billing_id", { length: 255 }),
  paymentUrl: text("payment_url"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
});
