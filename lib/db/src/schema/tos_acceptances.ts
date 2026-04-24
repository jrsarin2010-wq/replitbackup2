import { pgTable, serial, timestamp, integer, varchar, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { tosVersionsTable } from "./tos_versions";

export const tosAcceptancesTable = pgTable(
  "tos_acceptances",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    tosVersionId: integer("tos_version_id").notNull().references(() => tosVersionsTable.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 32 }).notNull().default("tos"),
    versionLabel: varchar("version_label", { length: 20 }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
  },
  (t) => ({
    uniqTenantKindVersion: uniqueIndex("uniq_tos_acceptance_tenant_kind_version").on(t.tenantId, t.kind, t.tosVersionId),
  }),
);

export const insertTosAcceptanceSchema = createInsertSchema(tosAcceptancesTable).omit({ id: true, acceptedAt: true });
export type InsertTosAcceptance = z.infer<typeof insertTosAcceptanceSchema>;
export type TosAcceptance = typeof tosAcceptancesTable.$inferSelect;
