import { pgTable, serial, integer, varchar, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const aiLearningConversationSeenTable = pgTable(
  "ai_learning_conversation_seen",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    candidateType: varchar("candidate_type", { length: 20 }).notNull(),
    candidateId: integer("candidate_id").notNull(),
    conversationId: integer("conversation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("ai_learning_conv_seen_uniq").on(
      t.tenantId,
      t.candidateType,
      t.candidateId,
      t.conversationId,
    ),
  }),
);

export type AiLearningConversationSeen = typeof aiLearningConversationSeenTable.$inferSelect;
