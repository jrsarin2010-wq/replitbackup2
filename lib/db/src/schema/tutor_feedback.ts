import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const tutorFeedbackTable = pgTable("tutor_feedback", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  content: text("content").notNull(),
  originalMessage: text("original_message").notNull(),
  status: text("status").notNull().default("nova"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TutorFeedback = typeof tutorFeedbackTable.$inferSelect;
