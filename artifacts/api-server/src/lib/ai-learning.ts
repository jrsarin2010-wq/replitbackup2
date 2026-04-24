import { db } from "@workspace/db";
import {
  aiContactMemoryTable,
  aiObjectionPatternsTable,
  aiKnowledgeBaseTable,
  aiStrategyAnalyticsTable,
  aiLearningConversationSeenTable,
} from "@workspace/db";
import { eq, and, desc, sql, gte, ilike } from "drizzle-orm";
import { logger } from "./logger";
import { maskPhone } from "./pii-mask";
import { getOpenAIClient } from "./openai-client";
import { getRedis } from "./redis";

// Auto-approval thresholds for the AI learning loop.
// A new candidate (FAQ or objection) becomes `approved` once it shows up at
// least APPROVAL_THRESHOLD times in distinct conversations, and only if the
// tenant still has room within WEEKLY_APPROVAL_LIMIT auto-approvals this week.
const APPROVAL_THRESHOLD = 2;
const WEEKLY_APPROVAL_LIMIT = 5;

function getStartOfWeek(): Date {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

// Drizzle tx and the root db share the same query API; accept either.
type DbExecutor = typeof db;

async function countWeeklyAutoApprovals(executor: DbExecutor, tenantId: number): Promise<number> {
  const startOfWeek = getStartOfWeek();
  const [kb] = await executor
    .select({ c: sql<number>`count(*)::int` })
    .from(aiKnowledgeBaseTable)
    .where(
      and(
        eq(aiKnowledgeBaseTable.tenantId, tenantId),
        eq(aiKnowledgeBaseTable.status, "approved"),
        eq(aiKnowledgeBaseTable.approvedBy, "auto"),
        gte(aiKnowledgeBaseTable.approvedAt, startOfWeek)
      )
    );
  const [obj] = await executor
    .select({ c: sql<number>`count(*)::int` })
    .from(aiObjectionPatternsTable)
    .where(
      and(
        eq(aiObjectionPatternsTable.tenantId, tenantId),
        eq(aiObjectionPatternsTable.status, "approved"),
        eq(aiObjectionPatternsTable.approvedBy, "auto"),
        gte(aiObjectionPatternsTable.approvedAt, startOfWeek)
      )
    );
  return (kb?.c ?? 0) + (obj?.c ?? 0);
}

// Records that we've already counted this conversation toward `candidateId`.
// Returns true if a new sighting was recorded (i.e. first time this conversation
// is seen for this candidate), false if the conversation was already counted.
async function recordConversationSighting(
  executor: DbExecutor,
  tenantId: number,
  candidateType: "knowledge" | "objection",
  candidateId: number,
  conversationId: number
): Promise<boolean> {
  const inserted = await executor
    .insert(aiLearningConversationSeenTable)
    .values({ tenantId, candidateType, candidateId, conversationId })
    .onConflictDoNothing()
    .returning({ id: aiLearningConversationSeenTable.id });
  return inserted.length > 0;
}

async function saveOrIncrementKnowledge(
  tenantId: number,
  conversationId: number,
  qa: { question: string; answer: string; category?: string }
): Promise<void> {
  const existing = await db.query.aiKnowledgeBaseTable.findFirst({
    where: and(
      eq(aiKnowledgeBaseTable.tenantId, tenantId),
      ilike(aiKnowledgeBaseTable.question, `%${qa.question.substring(0, 30)}%`)
    ),
  });

  if (!existing) {
    const [created] = await db
      .insert(aiKnowledgeBaseTable)
      .values({
        tenantId,
        question: qa.question,
        answer: qa.answer,
        category: qa.category || "geral",
        frequency: 1,
        occurrences: 1,
        status: "pending",
      })
      .returning({ id: aiKnowledgeBaseTable.id });
    if (created) {
      await recordConversationSighting(db, tenantId, "knowledge", created.id, conversationId);
    }
    logger.info(
      { tenantId, conversationId, candidateId: created?.id, pattern: qa.question.substring(0, 60) },
      "AI Learning: new knowledge candidate saved (occurrences=1)"
    );
    return;
  }

  const id = existing.id;
  const longerAnswer = qa.answer.length > existing.answer.length ? qa.answer : existing.answer;

  // Dedup by conversation: only first sighting per (candidate, conversation) counts.
  const isNewSighting = await recordConversationSighting(db, tenantId, "knowledge", id, conversationId);

  if (!isNewSighting) {
    // Same conversation already counted — refresh the answer if richer, but do not bump occurrences.
    if (longerAnswer !== existing.answer) {
      await db
        .update(aiKnowledgeBaseTable)
        .set({ answer: longerAnswer })
        .where(eq(aiKnowledgeBaseTable.id, id));
    }
    logger.info(
      { tenantId, conversationId, id },
      "AI Learning: knowledge sighting skipped (same conversation)"
    );
    return;
  }

  const wouldBeOccurrences = (existing.occurrences ?? 1) + 1;

  // Hot path: already approved or still below threshold — atomic increment, no lock.
  if (existing.status === "approved" || wouldBeOccurrences < APPROVAL_THRESHOLD) {
    await db
      .update(aiKnowledgeBaseTable)
      .set({
        frequency: sql`${aiKnowledgeBaseTable.frequency} + 1`,
        occurrences: sql`${aiKnowledgeBaseTable.occurrences} + 1`,
        answer: longerAnswer,
      })
      .where(eq(aiKnowledgeBaseTable.id, id));
    logger.info(
      { tenantId, conversationId, id, status: existing.status, occurrences: wouldBeOccurrences },
      "AI Learning: knowledge occurrences incremented"
    );
    return;
  }

  // Approval transition: serialize per tenant and re-check weekly cap atomically.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${tenantId})`);
    const used = await countWeeklyAutoApprovals(tx, tenantId);
    if (used < WEEKLY_APPROVAL_LIMIT) {
      const updated = await tx
        .update(aiKnowledgeBaseTable)
        .set({
          frequency: sql`${aiKnowledgeBaseTable.frequency} + 1`,
          occurrences: sql`${aiKnowledgeBaseTable.occurrences} + 1`,
          answer: longerAnswer,
          status: "approved",
          approvedAt: new Date(),
          approvedBy: "auto",
        })
        .where(and(eq(aiKnowledgeBaseTable.id, id), eq(aiKnowledgeBaseTable.status, "pending")))
        .returning({ id: aiKnowledgeBaseTable.id });
      if (updated.length > 0) {
        logger.info(
          { tenantId, conversationId, id, weeklyUsed: used + 1 },
          "AI Learning: knowledge auto-approved after reaching threshold"
        );
      } else {
        // Lost the race — another worker approved/changed it. Just bump counters.
        await tx
          .update(aiKnowledgeBaseTable)
          .set({
            frequency: sql`${aiKnowledgeBaseTable.frequency} + 1`,
            occurrences: sql`${aiKnowledgeBaseTable.occurrences} + 1`,
            answer: longerAnswer,
          })
          .where(eq(aiKnowledgeBaseTable.id, id));
        logger.info({ tenantId, conversationId, id }, "AI Learning: knowledge incremented (race lost approval)");
      }
    } else {
      await tx
        .update(aiKnowledgeBaseTable)
        .set({
          frequency: sql`${aiKnowledgeBaseTable.frequency} + 1`,
          occurrences: sql`${aiKnowledgeBaseTable.occurrences} + 1`,
          answer: longerAnswer,
        })
        .where(eq(aiKnowledgeBaseTable.id, id));
      logger.info(
        { tenantId, conversationId, id },
        "AI Learning: knowledge incremented (weekly cap reached, kept pending)"
      );
    }
  });
}

async function saveOrIncrementObjection(
  tenantId: number,
  conversationId: number,
  obj: { category: string; objection: string; counterArgument: string | null },
  converted: boolean
): Promise<void> {
  const existing = await db.query.aiObjectionPatternsTable.findFirst({
    where: and(
      eq(aiObjectionPatternsTable.tenantId, tenantId),
      eq(aiObjectionPatternsTable.category, obj.category),
      ilike(aiObjectionPatternsTable.objection, `%${obj.objection.substring(0, 30)}%`)
    ),
  });

  if (!existing) {
    const [created] = await db
      .insert(aiObjectionPatternsTable)
      .values({
        tenantId,
        category: obj.category || "outro",
        objection: obj.objection,
        counterArgument: obj.counterArgument,
        successCount: converted ? 1 : 0,
        totalCount: 1,
        occurrences: 1,
        status: "pending",
      })
      .returning({ id: aiObjectionPatternsTable.id });
    if (created) {
      await recordConversationSighting(db, tenantId, "objection", created.id, conversationId);
    }
    logger.info(
      { tenantId, conversationId, candidateId: created?.id, pattern: obj.objection.substring(0, 60) },
      "AI Learning: new objection candidate saved (occurrences=1)"
    );
    return;
  }

  const id = existing.id;
  const nextCounter = obj.counterArgument && converted ? obj.counterArgument : existing.counterArgument;
  const successDelta = converted ? sql`${aiObjectionPatternsTable.successCount} + 1` : sql`${aiObjectionPatternsTable.successCount}`;

  // Dedup by conversation: only first sighting per (candidate, conversation) counts.
  const isNewSighting = await recordConversationSighting(db, tenantId, "objection", id, conversationId);

  if (!isNewSighting) {
    // Same conversation already counted — refresh counter-argument only, do not bump occurrences/totals.
    if (nextCounter && nextCounter !== existing.counterArgument) {
      await db
        .update(aiObjectionPatternsTable)
        .set({ counterArgument: nextCounter })
        .where(eq(aiObjectionPatternsTable.id, id));
    }
    logger.info(
      { tenantId, conversationId, id },
      "AI Learning: objection sighting skipped (same conversation)"
    );
    return;
  }

  const wouldBeOccurrences = (existing.occurrences ?? 1) + 1;

  // Hot path: already approved or still below threshold — atomic increment, no lock.
  if (existing.status === "approved" || wouldBeOccurrences < APPROVAL_THRESHOLD) {
    await db
      .update(aiObjectionPatternsTable)
      .set({
        totalCount: sql`${aiObjectionPatternsTable.totalCount} + 1`,
        successCount: successDelta,
        occurrences: sql`${aiObjectionPatternsTable.occurrences} + 1`,
        counterArgument: nextCounter,
      })
      .where(eq(aiObjectionPatternsTable.id, id));
    logger.info(
      { tenantId, conversationId, id, status: existing.status, occurrences: wouldBeOccurrences },
      "AI Learning: objection occurrences incremented"
    );
    return;
  }

  // Approval transition: serialize per tenant and re-check weekly cap atomically.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${tenantId})`);
    const used = await countWeeklyAutoApprovals(tx, tenantId);
    if (used < WEEKLY_APPROVAL_LIMIT) {
      const updated = await tx
        .update(aiObjectionPatternsTable)
        .set({
          totalCount: sql`${aiObjectionPatternsTable.totalCount} + 1`,
          successCount: successDelta,
          occurrences: sql`${aiObjectionPatternsTable.occurrences} + 1`,
          counterArgument: nextCounter,
          status: "approved",
          approvedAt: new Date(),
          approvedBy: "auto",
        })
        .where(and(eq(aiObjectionPatternsTable.id, id), eq(aiObjectionPatternsTable.status, "pending")))
        .returning({ id: aiObjectionPatternsTable.id });
      if (updated.length > 0) {
        logger.info(
          { tenantId, conversationId, id, weeklyUsed: used + 1 },
          "AI Learning: objection auto-approved after reaching threshold"
        );
      } else {
        await tx
          .update(aiObjectionPatternsTable)
          .set({
            totalCount: sql`${aiObjectionPatternsTable.totalCount} + 1`,
            successCount: successDelta,
            occurrences: sql`${aiObjectionPatternsTable.occurrences} + 1`,
            counterArgument: nextCounter,
          })
          .where(eq(aiObjectionPatternsTable.id, id));
        logger.info({ tenantId, conversationId, id }, "AI Learning: objection incremented (race lost approval)");
      }
    } else {
      await tx
        .update(aiObjectionPatternsTable)
        .set({
          totalCount: sql`${aiObjectionPatternsTable.totalCount} + 1`,
          successCount: successDelta,
          occurrences: sql`${aiObjectionPatternsTable.occurrences} + 1`,
          counterArgument: nextCounter,
        })
        .where(eq(aiObjectionPatternsTable.id, id));
      logger.info(
        { tenantId, conversationId, id },
        "AI Learning: objection incremented (weekly cap reached, kept pending)"
      );
    }
  });
}

function sanitizeForPrompt(text: string): string {
  return text
    .replace(/\b(system|assistant|user|SYSTEM|ASSISTANT|USER)\s*:/gi, "")
    .replace(/ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/gi, "[filtered]")
    .replace(/you\s+(are|must|should|will)\s+now/gi, "[filtered]")
    .replace(/new\s+(instructions?|rules?|role|persona)/gi, "[filtered]")
    .replace(/pretend\s+(to\s+be|you\s+are)/gi, "[filtered]")
    .replace(/act\s+as\s+(a|an|if)/gi, "[filtered]")
    .trim()
    .substring(0, 500);
}

export async function extractAndSaveMemories(
  tenantId: number,
  contactPhone: string,
  conversationId: number,
  messages: Array<{ role: string; content: string }>
): Promise<void> {
  if (messages.length < 6) return;

  try {
    const client = await getOpenAIClient(tenantId);
    const conversationText = messages
      .slice(-10)
      .map((m) => `${m.role === "user" ? "Paciente" : "Secretaria"}: ${m.content}`)
      .join("\n");

    const response = await client.chat.completions.create({
      model: "gpt-5.4-nano",
      max_completion_tokens: 500,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `Analise a conversa e extraia FATOS RELEVANTES sobre o contato para lembrar em conversas futuras.
Extraia APENAS informacoes concretas mencionadas pelo paciente, como:
- Medos ou ansiedades (ex: medo de agulha, ansiedade dental)
- Preferencias (ex: prefere horarios de manha, quer atendimento rapido)
- Situacao familiar (ex: tem filhos, e casado)
- Interesses especificos (ex: quer clareamento, interessa em implante)
- Historico medico mencionado (ex: tem diabetes, toma anticoagulante)
- Informacoes pessoais relevantes (ex: trabalha de noite, viaja muito)

Responda APENAS com JSON valido (sem markdown):
{"memories": [{"type": "medo|preferencia|interesse|historico_medico|pessoal|familiar", "content": "descricao curta do fato"}]}
Se nao houver nada relevante para extrair, retorne {"memories": []}`,
        },
        { role: "user", content: conversationText },
      ],
    });

    const text = response.choices[0]?.message?.content || "{}";
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned) as { memories: Array<{ type: string; content: string }> };

    if (!parsed.memories?.length) return;

    const existing = await db.query.aiContactMemoryTable.findMany({
      where: and(
        eq(aiContactMemoryTable.tenantId, tenantId),
        eq(aiContactMemoryTable.contactPhone, contactPhone)
      ),
    });

    const existingContents = new Set(existing.map((m) => m.content.toLowerCase()));

    const newMemories = parsed.memories.filter(
      (m) => m.content && !existingContents.has(m.content.toLowerCase())
    );

    if (newMemories.length > 0) {
      await db.insert(aiContactMemoryTable).values(
        newMemories.map((m) => ({
          tenantId,
          contactPhone,
          memoryType: m.type || "pessoal",
          content: m.content,
          source: "auto" as const,
          conversationId,
        }))
      );
      logger.info({ tenantId, contactPhone: maskPhone(contactPhone), count: newMemories.length }, "AI Learning: memories extracted and saved");
    }
  } catch (err) {
    logger.error({ err, tenantId, contactPhone: maskPhone(contactPhone) }, "AI Learning: failed to extract memories");
  }
}

export async function detectAndSaveObjections(
  tenantId: number,
  conversationId: number,
  messages: Array<{ role: string; content: string }>,
  converted: boolean
): Promise<void> {
  if (messages.length < 6) return;

  try {
    const client = await getOpenAIClient(tenantId);
    const conversationText = messages
      .slice(-12)
      .map((m) => `${m.role === "user" ? "Paciente" : "Secretaria"}: ${m.content}`)
      .join("\n");

    const response = await client.chat.completions.create({
      model: "gpt-5.4-nano",
      max_completion_tokens: 500,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `Analise a conversa e identifique OBJECOES levantadas pelo paciente/lead.
Objecoes sao resistencias ou motivos para NAO agendar/comprar, como:
- preco (achou caro, pediu desconto, comparou precos)
- medo (medo de dor, de agulha, ansiedade)
- tempo (nao tem tempo, agenda cheia, quer adiar)
- confianca (duvida do profissional, quer segunda opiniao)
- necessidade (acha que nao precisa, nao e urgente)
- financeiro (sem dinheiro agora, quer parcelar)

Para cada objecao, identifique tambem se a secretaria deu um CONTRA-ARGUMENTO eficaz.

Responda APENAS com JSON valido (sem markdown):
{"objections": [{"category": "preco|medo|tempo|confianca|necessidade|financeiro|outro", "objection": "descricao curta da objecao", "counterArgument": "contra-argumento usado pela secretaria ou null se nao houve"}]}
Se nao houver objecoes, retorne {"objections": []}`,
        },
        { role: "user", content: conversationText },
      ],
    });

    const text = response.choices[0]?.message?.content || "{}";
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned) as {
      objections: Array<{ category: string; objection: string; counterArgument: string | null }>;
    };

    if (!parsed.objections?.length) return;

    for (const obj of parsed.objections) {
      if (!obj.objection) continue;
      await saveOrIncrementObjection(tenantId, conversationId, obj, converted);
    }

    logger.info({ tenantId, conversationId, count: parsed.objections.length, converted }, "AI Learning: objections detected and saved");
  } catch (err) {
    logger.error({ err, tenantId, conversationId }, "AI Learning: failed to detect objections");
  }
}

export async function extractAndSaveKnowledge(
  tenantId: number,
  conversationId: number,
  messages: Array<{ role: string; content: string }>
): Promise<void> {
  if (messages.length < 6) return;

  try {
    const client = await getOpenAIClient(tenantId);
    const conversationText = messages
      .slice(-10)
      .map((m) => `${m.role === "user" ? "Paciente" : "Secretaria"}: ${m.content}`)
      .join("\n");

    const response = await client.chat.completions.create({
      model: "gpt-5.4-nano",
      max_completion_tokens: 500,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `Analise a conversa e extraia PERGUNTAS frequentes que o paciente fez e as RESPOSTAS dadas pela secretaria.
Foque em perguntas sobre:
- Procedimentos (como funciona, quanto tempo dura, doi?)
- Precos e pagamento (quanto custa, parcela, aceita convenio?)
- Pos-operatorio (cuidados, tempo de recuperacao)
- Horarios e disponibilidade
- Localizacao e como chegar

Extraia APENAS perguntas com respostas informativas uteis.

Responda APENAS com JSON valido (sem markdown):
{"knowledge": [{"question": "pergunta do paciente resumida", "answer": "resposta informativa resumida", "category": "procedimento|preco|pos_operatorio|horario|localizacao|geral"}]}
Se nao houver Q&A relevante, retorne {"knowledge": []}`,
        },
        { role: "user", content: conversationText },
      ],
    });

    const text = response.choices[0]?.message?.content || "{}";
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned) as {
      knowledge: Array<{ question: string; answer: string; category: string }>;
    };

    if (!parsed.knowledge?.length) return;

    for (const qa of parsed.knowledge) {
      if (!qa.question || !qa.answer) continue;
      await saveOrIncrementKnowledge(tenantId, conversationId, qa);
    }

    logger.info({ tenantId, conversationId, count: parsed.knowledge.length }, "AI Learning: knowledge extracted and saved");
  } catch (err) {
    logger.error({ err, tenantId, conversationId }, "AI Learning: failed to extract knowledge");
  }
}

export async function recordStrategyAnalytics(
  tenantId: number,
  strategy: string,
  leadTemperature: string | null,
  procedureInterest: string | null,
  converted: boolean,
  conversationId: number | null
): Promise<void> {
  try {
    await db.insert(aiStrategyAnalyticsTable).values({
      tenantId,
      strategy,
      leadTemperature,
      procedureInterest,
      converted,
      conversationId,
    });
  } catch (err) {
    logger.error({ err, tenantId }, "AI Learning: failed to record strategy analytics");
  }
}

export async function getContactMemories(
  tenantId: number,
  contactPhone: string
): Promise<string> {
  const memories = await db.query.aiContactMemoryTable.findMany({
    where: and(
      eq(aiContactMemoryTable.tenantId, tenantId),
      eq(aiContactMemoryTable.contactPhone, contactPhone),
      eq(aiContactMemoryTable.status, "approved")
    ),
    orderBy: [desc(aiContactMemoryTable.createdAt)],
    limit: 15,
  });

  if (!memories.length) return "";

  const grouped: Record<string, string[]> = {};
  for (const m of memories) {
    const type = m.memoryType || "pessoal";
    if (!grouped[type]) grouped[type] = [];
    // Prefer the human-edited version when the clinic has reviewed and rewritten it.
    grouped[type].push(sanitizeForPrompt(m.editedContent ?? m.content));
  }

  const typeLabels: Record<string, string> = {
    medo: "Medos/Ansiedades",
    preferencia: "Preferencias",
    interesse: "Interesses",
    historico_medico: "Historico Medico",
    pessoal: "Informacoes Pessoais",
    familiar: "Situacao Familiar",
  };

  const lines = Object.entries(grouped).map(([type, items]) => {
    const label = typeLabels[type] || type;
    return `- ${label}: ${items.join("; ")}`;
  });

  return `\nMEMORIA DE LONGO PRAZO DO CONTATO (informacoes de conversas anteriores — use naturalmente):
${lines.join("\n")}`;
}

const DENTAL_OBJECTION_KEYWORDS: Record<string, string[]> = {
  lente_ceramica: ["ceramica", "porcelana", "faceta ceramica"],
  lente_resina: ["resina", "lente resina", "faceta resina"],
  harmonizacao_facial: ["harmonizacao", "botox", "preenchimento", "labio"],
  clareamento: ["clareamento", "clarear", "branquear"],
  implante: ["implante", "dente caiu", "dente perdido", "perdi o dente", "perdi um dente", "dente arrancado", "dente faltando"],
  alinhador: ["alinhador", "invisalign", "aparelho invisivel", "aparelho transparente"],
};

export async function getRelevantObjections(tenantId: number, currentMessage?: string): Promise<string> {
  const objections = await db.query.aiObjectionPatternsTable.findMany({
    where: and(
      eq(aiObjectionPatternsTable.tenantId, tenantId),
      eq(aiObjectionPatternsTable.status, "approved"),
    ),
    orderBy: [desc(aiObjectionPatternsTable.totalCount)],
    limit: 20,
  });

  if (!objections.length) return "";

  if (!currentMessage) return "";

  // Prefer the human-edited counter-argument when present (review-then-use flow).
  const withCounterArgs = objections
    .map((o) => ({ ...o, counterArgument: o.editedCounterArgument ?? o.counterArgument }))
    .filter((o) => o.counterArgument);
  const lower = currentMessage.toLowerCase();

  const matchedProcedureKeywords = new Set<string>();
  for (const [procedure, keywords] of Object.entries(DENTAL_OBJECTION_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      matchedProcedureKeywords.add(procedure);
    }
  }

  const hasObjectionSignal =
    lower.includes("caro") || lower.includes("cara") ||
    lower.includes("medo") || lower.includes("nao sei") ||
    lower.includes("nao tenho") || lower.includes("pensar") ||
    lower.includes("demora") || lower.includes("funciona") ||
    lower.includes("vale") || lower.includes("aparelho fixo");

  if (!matchedProcedureKeywords.size && !hasObjectionSignal) return "";

  let contextual: typeof withCounterArgs;
  if (matchedProcedureKeywords.size > 0) {
    contextual = withCounterArgs.filter((o) => {
      const objLower = o.objection.toLowerCase();
      for (const procedure of matchedProcedureKeywords) {
        const procKeywords = DENTAL_OBJECTION_KEYWORDS[procedure] ?? [];
        if (procKeywords.some((kw) => objLower.includes(kw))) return true;
      }
      return hasObjectionSignal && (
        lower.includes(o.objection.toLowerCase().substring(0, 10)) ||
        lower.includes(o.category.toLowerCase())
      );
    });
  } else {
    contextual = withCounterArgs.filter((o) =>
      lower.includes(o.objection.toLowerCase().substring(0, 10)) ||
      lower.includes(o.category.toLowerCase())
    );
  }

  if (!contextual.length) return "";

  const filtered = contextual;

  const lines = filtered
    .slice(0, 5)
    .map((o) => {
      const rate = o.totalCount > 0 ? Math.round((o.successCount / o.totalCount) * 100) : 0;
      return `- Objecao "${sanitizeForPrompt(o.objection)}" (${sanitizeForPrompt(o.category)}, freq: ${o.totalCount}x, resolucao: ${rate}%): Contra-argumento eficaz: "${sanitizeForPrompt(o.counterArgument ?? "")}"`;
    });

  if (!lines.length) return "";

  return `\nOBJECOES COMUNS E CONTRA-ARGUMENTOS APRENDIDOS:
${lines.join("\n")}
Use esses contra-argumentos quando o contato levantar objecoes similares.`;
}

const DENTAL_CATEGORY_KEYWORDS: Record<string, string[]> = {
  lente_resina: ["resina", "lente de resina", "lente resina", "faceta de resina", "faceta resina"],
  lente_ceramica: ["ceramica", "porcelana", "lente de ceramica", "lente ceramica", "faceta ceramica", "faceta de porcelana"],
  harmonizacao_facial: ["harmonizacao", "botox", "preenchimento", "toxina", "labio", "lip"],
  clareamento: ["clareamento", "clarear", "branquear", "branqueamento", "dente amarelo", "manchas nos dentes"],
  implante: ["implante", "dente caiu", "dente perdido", "dente faltando", "perdi o dente", "perdi um dente", "dente arrancado", "caiu um dente", "arrancaram meu dente"],
  alinhador: ["alinhador", "invisalign", "aparelho invisivel", "aparelho transparente", "dente torto", "alinhamento"],
};

export async function getRelevantKnowledge(tenantId: number, currentMessage?: string): Promise<string> {
  const faqs = await db.query.aiKnowledgeBaseTable.findMany({
    where: and(
      eq(aiKnowledgeBaseTable.tenantId, tenantId),
      eq(aiKnowledgeBaseTable.status, "approved"),
    ),
    orderBy: [desc(aiKnowledgeBaseTable.frequency)],
    limit: 30,
  });

  if (!faqs.length) return "";

  if (!currentMessage) return "";

  const lower = currentMessage.toLowerCase();

  const matchedCategories = new Set<string>();
  for (const [category, keywords] of Object.entries(DENTAL_CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      matchedCategories.add(category);
    }
  }

  if (!matchedCategories.size) return "";

  const contextual = faqs.filter((f) => matchedCategories.has(f.category));

  if (!contextual.length) return "";

  const lines = contextual.slice(0, 6).map((f) => `- P: ${sanitizeForPrompt(f.question)}\n  R: ${sanitizeForPrompt(f.editedAnswer ?? f.answer)}`);

  return `\nBASE DE CONHECIMENTO (perguntas frequentes aprendidas):
${lines.join("\n")}
Use essas respostas como referencia quando o contato fizer perguntas similares.`;
}

export async function getOptimizedStrategies(tenantId: number): Promise<string> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const analytics = await db.query.aiStrategyAnalyticsTable.findMany({
    where: and(
      eq(aiStrategyAnalyticsTable.tenantId, tenantId),
      gte(aiStrategyAnalyticsTable.createdAt, thirtyDaysAgo)
    ),
  });

  if (analytics.length < 5) return "";

  const strategyMap = new Map<string, { total: number; converted: number }>();
  const tempMap = new Map<string, Map<string, { total: number; converted: number }>>();

  for (const a of analytics) {
    const entry = strategyMap.get(a.strategy) || { total: 0, converted: 0 };
    entry.total++;
    if (a.converted) entry.converted++;
    strategyMap.set(a.strategy, entry);

    if (a.leadTemperature) {
      if (!tempMap.has(a.leadTemperature)) tempMap.set(a.leadTemperature, new Map());
      const tEntry = tempMap.get(a.leadTemperature)!.get(a.strategy) || { total: 0, converted: 0 };
      tEntry.total++;
      if (a.converted) tEntry.converted++;
      tempMap.get(a.leadTemperature)!.set(a.strategy, tEntry);
    }
  }

  const sorted = [...strategyMap.entries()]
    .map(([strategy, data]) => ({
      strategy,
      rate: data.total > 0 ? Math.round((data.converted / data.total) * 100) : 0,
      total: data.total,
    }))
    .sort((a, b) => b.rate - a.rate);

  const lines = sorted.slice(0, 5).map(
    (s) => `- ${s.strategy}: ${s.rate}% conversao (${s.total} usos)`
  );

  return `\nANALYTICS DE ESTRATEGIAS (ultimos 30 dias):
${lines.join("\n")}
Priorize as estrategias com maior taxa de conversao.`;
}

const _learningTimers = new Map<number, NodeJS.Timeout>();
// _learningTimers remains in-memory intentionally: debounce timers are per-instance by nature.
// If an instance restarts, pending timers are lost — this is acceptable because the DB query
// in _executeConversationLearning acts as the authoritative dedup gate.

const _localLearningProcessed = new Map<number, { timestamp: number; converted: boolean }>();

const LEARNING_DEBOUNCE_MS = 30_000;
const LEARNING_COOLDOWN_MS = 300_000;
const LEARNING_PROCESSED_TTL_SEC = Math.ceil(LEARNING_COOLDOWN_MS / 1000);

async function getLearningEntry(conversationId: number): Promise<{ timestamp: number; converted: boolean } | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const val = await redis.get(`learning:${conversationId}`);
      if (val) return JSON.parse(val) as { timestamp: number; converted: boolean };
      return null;
    } catch {
    }
  }
  return _localLearningProcessed.get(conversationId) ?? null;
}

async function setLearningEntry(conversationId: number, entry: { timestamp: number; converted: boolean }): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.setex(`learning:${conversationId}`, LEARNING_PROCESSED_TTL_SEC, JSON.stringify(entry));
      return;
    } catch {
    }
  }
  _localLearningProcessed.set(conversationId, entry);
  if (_localLearningProcessed.size > 500) {
    const cutoff = Date.now() - LEARNING_COOLDOWN_MS * 2;
    for (const [k, v] of _localLearningProcessed) {
      if (v.timestamp < cutoff) _localLearningProcessed.delete(k);
    }
  }
}

export async function scheduleLearning(
  tenantId: number,
  contactPhone: string,
  conversationId: number,
  converted: boolean
): Promise<void> {
  const existing = await getLearningEntry(conversationId);
  if (existing) {
    if (existing.converted && !converted) return;
    if (Date.now() - existing.timestamp < LEARNING_COOLDOWN_MS && existing.converted === converted) return;
  }

  const existingTimer = _learningTimers.get(conversationId);
  if (existingTimer) clearTimeout(existingTimer);

  if (converted) {
    _executeConversationLearning(tenantId, contactPhone, conversationId, true).catch((err) => {
      logger.error({ err, tenantId, conversationId }, "Immediate converted learning failed");
    });
    return;
  }

  const timer = setTimeout(() => {
    _learningTimers.delete(conversationId);
    _executeConversationLearning(tenantId, contactPhone, conversationId, false).catch((err) => {
      logger.error({ err, tenantId, conversationId }, "Debounced learning failed");
    });
  }, LEARNING_DEBOUNCE_MS);

  _learningTimers.set(conversationId, timer);
}

async function _executeConversationLearning(
  tenantId: number,
  contactPhone: string,
  conversationId: number,
  converted: boolean
): Promise<void> {
  await setLearningEntry(conversationId, { timestamp: Date.now(), converted });

  const { dentalMessagesTable } = await import("@workspace/db");

  const recentMessages = await db.query.dentalMessagesTable.findMany({
    where: eq(dentalMessagesTable.conversationId, conversationId),
    orderBy: [desc(dentalMessagesTable.sentAt)],
    limit: 12,
  });

  const messages = recentMessages
    .reverse()
    .map((m) => ({
      role: m.direction === "inbound" ? "user" : "assistant",
      content: m.content || "",
    }))
    .filter((m) => m.content);

  if (messages.length < 6) return;

  try {
    const client = await getOpenAIClient(tenantId);
    const conversationText = messages
      .slice(-12)
      .map((m) => `${m.role === "user" ? "Paciente" : "Secretaria"}: ${m.content}`)
      .join("\n");

    const response = await client.chat.completions.create({
      model: "gpt-5.4-nano",
      max_completion_tokens: 1500,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `Analise a conversa abaixo e execute SIMULTANEAMENTE tres tarefas. Retorne APENAS JSON valido (sem markdown) com esta estrutura exata:
{
  "memories": [{"type": "medo|preferencia|interesse|historico_medico|pessoal|familiar", "content": "descricao curta do fato"}],
  "objections": [{"category": "preco|medo|tempo|confianca|necessidade|financeiro|outro", "objection": "descricao curta da objecao", "counterArgument": "contra-argumento usado pela secretaria ou null se nao houve"}],
  "knowledge": [{"question": "pergunta do paciente resumida", "answer": "resposta informativa resumida", "category": "procedimento|preco|pos_operatorio|horario|localizacao|geral"}]
}

TAREFA 1 - MEMORIAS: Extraia FATOS RELEVANTES sobre o contato (medos, preferencias, situacao familiar, interesses, historico medico, informacoes pessoais). Apenas informacoes concretas mencionadas pelo paciente.

TAREFA 2 - OBJECOES: Identifique OBJECOES levantadas pelo paciente (preco, medo, tempo, confianca, necessidade, financeiro). Para cada objecao, identifique se a secretaria deu um contra-argumento eficaz.

TAREFA 3 - CONHECIMENTO: Extraia PERGUNTAS frequentes do paciente e as respostas dadas pela secretaria. Foque em procedimentos, precos, pos-operatorio, horarios, localizacao. Apenas perguntas com respostas informativas uteis.

Se nao houver dados para uma categoria, retorne array vazio para ela.`,
        },
        { role: "user", content: conversationText },
      ],
    });

    const text = response.choices[0]?.message?.content || "{}";
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let parsed: {
      memories: Array<{ type: string; content: string }>;
      objections: Array<{ category: string; objection: string; counterArgument: string | null }>;
      knowledge: Array<{ question: string; answer: string; category: string }>;
    };

    try {
      parsed = JSON.parse(cleaned);
    } catch {
      logger.error({ tenantId, conversationId, text }, "AI Learning: failed to parse unified response");
      return;
    }

    const persistTasks: Promise<void>[] = [];

    if (parsed.memories?.length) {
      persistTasks.push(
        (async () => {
          const existing = await db.query.aiContactMemoryTable.findMany({
            where: and(
              eq(aiContactMemoryTable.tenantId, tenantId),
              eq(aiContactMemoryTable.contactPhone, contactPhone)
            ),
          });
          const existingContents = new Set(existing.map((m) => m.content.toLowerCase()));
          const newMemories = parsed.memories.filter(
            (m) => m.content && !existingContents.has(m.content.toLowerCase())
          );
          if (newMemories.length > 0) {
            await db.insert(aiContactMemoryTable).values(
              newMemories.map((m) => ({
                tenantId,
                contactPhone,
                memoryType: m.type || "pessoal",
                content: m.content,
                source: "auto" as const,
                conversationId,
              }))
            );
            logger.info({ tenantId, contactPhone: maskPhone(contactPhone), count: newMemories.length }, "AI Learning: memories extracted and saved");
          }
        })()
      );
    }

    if (parsed.objections?.length) {
      persistTasks.push(
        (async () => {
          for (const obj of parsed.objections) {
            if (!obj.objection) continue;
            await saveOrIncrementObjection(tenantId, conversationId, obj, converted);
          }
          logger.info({ tenantId, conversationId, count: parsed.objections.length, converted }, "AI Learning: objections detected and saved");
        })()
      );
    }

    if (parsed.knowledge?.length) {
      persistTasks.push(
        (async () => {
          for (const qa of parsed.knowledge) {
            if (!qa.question || !qa.answer) continue;
            await saveOrIncrementKnowledge(tenantId, conversationId, qa);
          }
          logger.info({ tenantId, conversationId, count: parsed.knowledge.length }, "AI Learning: knowledge extracted and saved");
        })()
      );
    }

    await Promise.allSettled(persistTasks);
  } catch (err) {
    logger.error({ err, tenantId, conversationId }, "AI Learning: unified learning failed");
  }

  logger.info({ tenantId, conversationId, converted, messageCount: messages.length }, "AI Learning: conversation learning completed");
}

export async function runPostConversationLearning(
  tenantId: number,
  contactPhone: string,
  conversationId: number,
  converted: boolean
): Promise<void> {
  void scheduleLearning(tenantId, contactPhone, conversationId, converted);
}

export async function getAiLearningStats(tenantId: number) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [memoriesCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(aiContactMemoryTable)
    .where(eq(aiContactMemoryTable.tenantId, tenantId));

  const [objectionsCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(aiObjectionPatternsTable)
    .where(eq(aiObjectionPatternsTable.tenantId, tenantId));

  const [knowledgeCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(aiKnowledgeBaseTable)
    .where(eq(aiKnowledgeBaseTable.tenantId, tenantId));

  const [analyticsCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(aiStrategyAnalyticsTable)
    .where(eq(aiStrategyAnalyticsTable.tenantId, tenantId));

  const topStrategies = await db.query.aiStrategyAnalyticsTable.findMany({
    where: and(
      eq(aiStrategyAnalyticsTable.tenantId, tenantId),
      gte(aiStrategyAnalyticsTable.createdAt, thirtyDaysAgo)
    ),
  });

  const strategyMap = new Map<string, { total: number; converted: number }>();
  for (const a of topStrategies) {
    const entry = strategyMap.get(a.strategy) || { total: 0, converted: 0 };
    entry.total++;
    if (a.converted) entry.converted++;
    strategyMap.set(a.strategy, entry);
  }

  const strategies = [...strategyMap.entries()]
    .map(([strategy, data]) => ({
      strategy,
      conversionRate: data.total > 0 ? Math.round((data.converted / data.total) * 100) : 0,
      totalUses: data.total,
    }))
    .sort((a, b) => b.conversionRate - a.conversionRate)
    .slice(0, 5);

  const topObjections = await db.query.aiObjectionPatternsTable.findMany({
    where: eq(aiObjectionPatternsTable.tenantId, tenantId),
    orderBy: [desc(aiObjectionPatternsTable.totalCount)],
    limit: 5,
  });

  const topFaqs = await db.query.aiKnowledgeBaseTable.findMany({
    where: eq(aiKnowledgeBaseTable.tenantId, tenantId),
    orderBy: [desc(aiKnowledgeBaseTable.frequency)],
    limit: 5,
  });

  const totalDataPoints =
    Number(memoriesCount.count) +
    Number(objectionsCount.count) +
    Number(knowledgeCount.count) +
    Number(analyticsCount.count);

  const uniqueContactsWithMemory = await db
    .select({ count: sql<number>`count(distinct contact_phone)` })
    .from(aiContactMemoryTable)
    .where(eq(aiContactMemoryTable.tenantId, tenantId));
  const uniqueContacts = Number(uniqueContactsWithMemory[0]?.count || 0);

  const effectiveObjections = topObjections.filter(
    (o) => o.counterArgument && o.totalCount >= 2
  ).length;

  const convertedStrategies = strategies.filter(
    (s) => s.conversionRate > 0 && s.totalUses >= 3
  ).length;

  const qualifiedFaqs = topFaqs.filter((f) => f.frequency >= 2).length;

  const qualityScore =
    Math.min(uniqueContacts, 50) * 2 +
    Math.min(effectiveObjections, 10) * 5 +
    Math.min(convertedStrategies, 5) * 10 +
    Math.min(qualifiedFaqs, 15) * 3 +
    Math.min(Math.floor(totalDataPoints / 10), 50);

  let maturityLevel = "Iniciante";
  let maturityPercent = 0;

  if (qualityScore >= 250) {
    maturityLevel = "Avancada";
    maturityPercent = Math.min(100, 80 + Math.floor((qualityScore - 250) / 25));
  } else if (qualityScore >= 150) {
    maturityLevel = "Competente";
    maturityPercent = 60 + Math.floor((qualityScore - 150) * 20 / 100);
  } else if (qualityScore >= 80) {
    maturityLevel = "Intermediaria";
    maturityPercent = 35 + Math.floor((qualityScore - 80) * 25 / 70);
  } else if (qualityScore >= 30) {
    maturityLevel = "Aprendendo";
    maturityPercent = 10 + Math.floor((qualityScore - 30) * 25 / 50);
  } else if (qualityScore >= 5) {
    maturityLevel = "Iniciante";
    maturityPercent = 2 + Math.floor((qualityScore - 5) * 8 / 25);
  }

  return {
    memories: Number(memoriesCount.count),
    objections: Number(objectionsCount.count),
    knowledge: Number(knowledgeCount.count),
    analyticsEntries: Number(analyticsCount.count),
    topStrategies: strategies,
    topObjections: topObjections.map((o) => ({
      category: o.category,
      objection: o.objection,
      counterArgument: o.counterArgument,
      successRate: o.totalCount > 0 ? Math.round((o.successCount / o.totalCount) * 100) : 0,
      frequency: o.totalCount,
    })),
    topFaqs: topFaqs.map((f) => ({
      question: f.question,
      answer: f.answer,
      category: f.category,
      frequency: f.frequency,
    })),
    maturity: {
      level: maturityLevel,
      percent: maturityPercent,
      totalDataPoints,
    },
  };
}
