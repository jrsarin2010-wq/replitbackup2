import { pgTable, serial, integer, text, varchar, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { dentalProfessionalsTable } from "./dental_professionals";

export const dentalPortfolioItemsTable = pgTable("dental_portfolio_items", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  professionalId: integer("professional_id").notNull().references(() => dentalProfessionalsTable.id, { onDelete: "cascade" }),
  mediaUrl: varchar("media_url", { length: 1000 }).notNull(),
  keywords: text("keywords").notNull().default(""),
  caption: text("caption"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDentalPortfolioItemSchema = createInsertSchema(dentalPortfolioItemsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDentalPortfolioItem = z.infer<typeof insertDentalPortfolioItemSchema>;
export type DentalPortfolioItem = typeof dentalPortfolioItemsTable.$inferSelect;
