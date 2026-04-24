import { pgTable, serial, integer, varchar, boolean, text, timestamp, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const aiResponseAuditTable = pgTable(
  "ai_response_audit",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    conversationId: integer("conversation_id"),
    contactPhoneMasked: varchar("contact_phone_masked", { length: 32 }),
    mode: varchar("mode", { length: 32 }).notNull(),
    obeyed: boolean("obeyed").notNull(),
    violationTypes: text("violation_types"),
    retryUsed: boolean("retry_used").notNull().default(false),
    fallbackUsed: boolean("fallback_used").notNull().default(false),
    modelUsed: varchar("model_used", { length: 64 }),
    intent: varchar("intent", { length: 32 }),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    cachedTokens: integer("cached_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("ai_response_audit_tenant_idx").on(t.tenantId, t.createdAt),
    modeIdx: index("ai_response_audit_mode_idx").on(t.tenantId, t.mode, t.createdAt),
  }),
);

export type AiResponseAudit = typeof aiResponseAuditTable.$inferSelect;
export type InsertAiResponseAudit = typeof aiResponseAuditTable.$inferInsert;
