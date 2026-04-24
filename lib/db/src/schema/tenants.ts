import { pgTable, text, serial, timestamp, varchar, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tenantsTable = pgTable("tenants", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  email: varchar("email", { length: 255 }).unique(),
  passwordHash: text("password_hash"),
  plan: varchar("plan", { length: 50 }).notNull().default("trial"),
  subscriptionStatus: varchar("subscription_status", { length: 30 }).notNull().default("active"),
  subscribedAt: timestamp("subscribed_at", { withTimezone: true }),
  subscriptionExpiresAt: timestamp("subscription_expires_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  whatsappProvider: varchar("whatsapp_provider", { length: 20 }).notNull().default("evolution"),
  evolutionApiUrl: text("evolution_api_url"),
  evolutionApiKey: text("evolution_api_key"),
  evolutionInstanceName: text("evolution_instance_name"),
  uazapiHost: text("uazapi_host"),
  uazapiAdminToken: text("uazapi_admin_token"),
  uazapiInstanceToken: text("uazapi_instance_token"),
  uazapiInstanceId: text("uazapi_instance_id"),
  elevenLabsApiKey: text("eleven_labs_api_key"),
  openaiApiKey: text("openai_api_key"),
  whatsappConnected: text("whatsapp_connected").notNull().default("false"),
  cro: varchar("cro", { length: 20 }),
  maxProfessionals: integer("max_professionals").notNull().default(1),
  trialExpiryNotificationSent: boolean("trial_expiry_notification_sent").notNull().default(false),
  subscriptionNotif7DaySent: boolean("subscription_notif_7day_sent").notNull().default(false),
  subscriptionNotif3DaySent: boolean("subscription_notif_3day_sent").notNull().default(false),
  subscriptionNotifDueDaySent: boolean("subscription_notif_due_day_sent").notNull().default(false),
  subscriptionNotifSuspendedSent: boolean("subscription_notif_suspended_sent").notNull().default(false),
  trialNotif7DaySent: boolean("trial_notif_7day_sent").notNull().default(false),
  trialNotif1DaySent: boolean("trial_notif_1day_sent").notNull().default(false),
  scheduledPlan: varchar("scheduled_plan", { length: 50 }),
  scheduledPlanEffectiveAt: timestamp("scheduled_plan_effective_at", { withTimezone: true }),
  scheduledPlanRequestedAt: timestamp("scheduled_plan_requested_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const passwordResetTokensTable = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  tenantId: serial("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }).notNull(),
  token: varchar("token", { length: 100 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  used: boolean("used").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTenantSchema = createInsertSchema(tenantsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenantsTable.$inferSelect;
