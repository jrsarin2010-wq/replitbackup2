import { pgTable, serial, varchar, text, timestamp, index } from "drizzle-orm/pg-core";

export const platformAlertsTable = pgTable(
  "platform_alerts",
  {
    id: serial("id").primaryKey(),
    service: varchar("service", { length: 50 }).notNull(),
    kind: varchar("kind", { length: 20 }).notNull(),
    severity: varchar("severity", { length: 20 }).notNull().default("warning"),
    message: text("message").notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  },
  (t) => ({
    createdIdx: index("platform_alerts_created_idx").on(t.createdAt),
    dismissedIdx: index("platform_alerts_dismissed_idx").on(t.dismissedAt),
  })
);

export type PlatformAlert = typeof platformAlertsTable.$inferSelect;
export type InsertPlatformAlert = typeof platformAlertsTable.$inferInsert;
