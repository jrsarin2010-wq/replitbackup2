import { db } from "@workspace/db";
import { dentalConversationsTable, dentalMessagesTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { logger } from "./logger";
import type { OpenAI } from "@workspace/integrations-openai-ai-server";

const SUMMARY_MIN_MESSAGES = 10;
const SUMMARY_UPDATE_INTERVAL = 8;

export async function maybeUpdateConversationSummary(
  client: OpenAI,
  tenantId: number,
  conversationId: number,
  currentSummaryMessageCount: number,
): Promise<void> {
  try {
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(dentalMessagesTable)
      .where(eq(dentalMessagesTable.conversationId, conversationId));

    const totalMessages = Number(countResult[0]?.count || 0);

    const needsFirstSummary = totalMessages > SUMMARY_MIN_MESSAGES && currentSummaryMessageCount === 0;
    const needsUpdate = totalMessages > SUMMARY_MIN_MESSAGES
      && currentSummaryMessageCount > 0
      && (totalMessages - currentSummaryMessageCount) >= SUMMARY_UPDATE_INTERVAL;

    if (!needsFirstSummary && !needsUpdate) return;

    const messages = await db.query.dentalMessagesTable.findMany({
      where: eq(dentalMessagesTable.conversationId, conversationId),
      orderBy: [desc(dentalMessagesTable.sentAt)],
      limit: 24,
    });

    const chronological = messages.reverse();
    const conversation = chronological
      .map((m) => {
        const role = m.direction === "inbound" ? "Paciente" : "Secretaria";
        return `${role}: ${m.content || "[midia]"}`;
      })
      .join("\n");

    const response = await client.chat.completions.create({
      model: "gpt-5-nano",
      max_completion_tokens: 200,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `Resuma de forma concisa (max 5 linhas) esta conversa entre uma secretaria de clinica odontologica e um paciente/lead. Inclua:
- Quem e o contato e o que quer (procedimento, queixa ou necessidade)
- O que foi ofertado (horarios, precos, informacoes)
- Objecoes ou resistencias levantadas
- Estado atual da negociacao (ex: aguardando escolha de horario, sem interesse, agendado, etc.)
Seja objetivo. Nao repita informacoes. Use terceira pessoa. Responda em portugues.`,
        },
        {
          role: "user",
          content: `Conversa:\n${conversation}`,
        },
      ],
    });

    const summary = response.choices[0]?.message?.content?.trim();
    if (!summary) return;

    await db
      .update(dentalConversationsTable)
      .set({
        aiSummary: summary,
        aiSummaryMessageCount: totalMessages,
      })
      .where(eq(dentalConversationsTable.id, conversationId));

    logger.info(
      { tenantId, conversationId, totalMessages, summaryLength: summary.length },
      "Conversation summary updated",
    );
  } catch (err) {
    logger.error({ err, tenantId, conversationId }, "Failed to update conversation summary");
  }
}

export function buildSummaryContextBlock(summary: string | null | undefined): string {
  if (!summary) return "";
  return `\nRESUMO DO HISTORICO DA CONVERSA (contexto de mensagens anteriores):
${summary}
---`;
}
