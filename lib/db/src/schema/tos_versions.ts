import { pgTable, text, serial, timestamp, varchar, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tosVersionsTable = pgTable(
  "tos_versions",
  {
    id: serial("id").primaryKey(),
    kind: varchar("kind", { length: 32 }).notNull().default("tos"),
    version: varchar("version", { length: 20 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    content: text("content").notNull(),
    active: boolean("active").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqKindVersion: uniqueIndex("uniq_tos_versions_kind_version").on(t.kind, t.version),
  }),
);

export const insertTosVersionSchema = createInsertSchema(tosVersionsTable).omit({ id: true, createdAt: true });
export type InsertTosVersion = z.infer<typeof insertTosVersionSchema>;
export type TosVersion = typeof tosVersionsTable.$inferSelect;
