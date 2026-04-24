import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  aiContactMemoryTable,
  aiKnowledgeBaseTable,
  aiObjectionPatternsTable,
  aiStrategyAnalyticsTable,
} from "@workspace/db";
import { tenantMiddleware } from "../../middlewares/tenant";
import { getAiLearningStats } from "../../lib/ai-learning";

const router = Router();
router.use(tenantMiddleware);

const VALID_STATUSES = ["pending", "approved", "rejected"] as const;
type LearningStatus = typeof VALID_STATUSES[number];

function parseStatus(raw: unknown): LearningStatus | undefined {
  if (typeof raw !== "string") return undefined;
  return (VALID_STATUSES as readonly string[]).includes(raw)
    ? (raw as LearningStatus)
    : undefined;
}

// Returns: { ok: true, value } | { ok: false } | { ok: true, value: undefined } when absent
function validateStatus(raw: unknown): { ok: true; value?: LearningStatus } | { ok: false } {
  if (raw === undefined || raw === null || raw === "") return { ok: true };
  const parsed = parseStatus(raw);
  if (!parsed) return { ok: false };
  return { ok: true, value: parsed };
}

router.get("/stats", async (req, res) => {
  try {
    const stats = await getAiLearningStats(req.tenantId!);
    res.json(stats);
  } catch (error) {
    console.error("Error fetching AI learning stats:", error);
    res.status(500).json({ error: "Failed to fetch AI learning stats" });
  }
});

// ─── Memories ──────────────────────────────────────────────────────────────────

router.get("/memories", async (req, res) => {
  try {
    const sv = validateStatus(req.query.status);
    if (!sv.ok) return res.status(400).json({ error: "Invalid status" });
    const status = sv.value;
    const conds = [eq(aiContactMemoryTable.tenantId, req.tenantId!)];
    if (status) conds.push(eq(aiContactMemoryTable.status, status));
    const items = await db.query.aiContactMemoryTable.findMany({
      where: and(...conds),
      orderBy: [desc(aiContactMemoryTable.createdAt)],
      limit: 200,
    });
    res.json(items);
  } catch (error) {
    console.error("Error listing memories:", error);
    res.status(500).json({ error: "Failed to list memories" });
  }
});

router.patch("/memories/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const sv = validateStatus(req.body?.status);
    if (!sv.ok) return res.status(400).json({ error: "Invalid status" });
    const status = sv.value;
    const editedContent: string | null | undefined = req.body?.editedContent;
    const updates: Record<string, unknown> = { reviewedAt: new Date() };
    if (status) updates.status = status;
    if (editedContent !== undefined) {
      updates.editedContent = editedContent === "" ? null : editedContent;
    }
    const [updated] = await db
      .update(aiContactMemoryTable)
      .set(updates)
      .where(and(
        eq(aiContactMemoryTable.id, id),
        eq(aiContactMemoryTable.tenantId, req.tenantId!),
      ))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (error) {
    console.error("Error updating memory:", error);
    res.status(500).json({ error: "Failed to update memory" });
  }
});

router.delete("/memories/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const result = await db
      .delete(aiContactMemoryTable)
      .where(and(
        eq(aiContactMemoryTable.id, id),
        eq(aiContactMemoryTable.tenantId, req.tenantId!),
      ))
      .returning({ id: aiContactMemoryTable.id });
    if (!result.length) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (error) {
    console.error("Error deleting memory:", error);
    res.status(500).json({ error: "Failed to delete memory" });
  }
});

// ─── Objections ────────────────────────────────────────────────────────────────

router.get("/objections", async (req, res) => {
  try {
    const sv = validateStatus(req.query.status);
    if (!sv.ok) return res.status(400).json({ error: "Invalid status" });
    const status = sv.value;
    const conds = [eq(aiObjectionPatternsTable.tenantId, req.tenantId!)];
    if (status) conds.push(eq(aiObjectionPatternsTable.status, status));
    const items = await db.query.aiObjectionPatternsTable.findMany({
      where: and(...conds),
      orderBy: [desc(aiObjectionPatternsTable.totalCount)],
      limit: 200,
    });
    res.json(items);
  } catch (error) {
    console.error("Error listing objections:", error);
    res.status(500).json({ error: "Failed to list objections" });
  }
});

router.patch("/objections/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const sv = validateStatus(req.body?.status);
    if (!sv.ok) return res.status(400).json({ error: "Invalid status" });
    const status = sv.value;
    const editedCounter: string | null | undefined = req.body?.editedCounterArgument;
    const updates: Record<string, unknown> = { reviewedAt: new Date() };
    if (status) updates.status = status;
    if (editedCounter !== undefined) {
      updates.editedCounterArgument = editedCounter === "" ? null : editedCounter;
    }
    const [updated] = await db
      .update(aiObjectionPatternsTable)
      .set(updates)
      .where(and(
        eq(aiObjectionPatternsTable.id, id),
        eq(aiObjectionPatternsTable.tenantId, req.tenantId!),
      ))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (error) {
    console.error("Error updating objection:", error);
    res.status(500).json({ error: "Failed to update objection" });
  }
});

router.delete("/objections/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const result = await db
      .delete(aiObjectionPatternsTable)
      .where(and(
        eq(aiObjectionPatternsTable.id, id),
        eq(aiObjectionPatternsTable.tenantId, req.tenantId!),
      ))
      .returning({ id: aiObjectionPatternsTable.id });
    if (!result.length) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (error) {
    console.error("Error deleting objection:", error);
    res.status(500).json({ error: "Failed to delete objection" });
  }
});

// ─── Knowledge ─────────────────────────────────────────────────────────────────

router.get("/knowledge", async (req, res) => {
  try {
    const sv = validateStatus(req.query.status);
    if (!sv.ok) return res.status(400).json({ error: "Invalid status" });
    const status = sv.value;
    const conds = [eq(aiKnowledgeBaseTable.tenantId, req.tenantId!)];
    if (status) conds.push(eq(aiKnowledgeBaseTable.status, status));
    const items = await db.query.aiKnowledgeBaseTable.findMany({
      where: and(...conds),
      orderBy: [desc(aiKnowledgeBaseTable.frequency)],
      limit: 200,
    });
    res.json(items);
  } catch (error) {
    console.error("Error listing knowledge:", error);
    res.status(500).json({ error: "Failed to list knowledge" });
  }
});

router.patch("/knowledge/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const sv = validateStatus(req.body?.status);
    if (!sv.ok) return res.status(400).json({ error: "Invalid status" });
    const status = sv.value;
    const editedAnswer: string | null | undefined = req.body?.editedAnswer;
    const updates: Record<string, unknown> = { reviewedAt: new Date() };
    if (status) updates.status = status;
    if (editedAnswer !== undefined) {
      updates.editedAnswer = editedAnswer === "" ? null : editedAnswer;
    }
    const [updated] = await db
      .update(aiKnowledgeBaseTable)
      .set(updates)
      .where(and(
        eq(aiKnowledgeBaseTable.id, id),
        eq(aiKnowledgeBaseTable.tenantId, req.tenantId!),
      ))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (error) {
    console.error("Error updating knowledge:", error);
    res.status(500).json({ error: "Failed to update knowledge" });
  }
});

router.delete("/knowledge/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const result = await db
      .delete(aiKnowledgeBaseTable)
      .where(and(
        eq(aiKnowledgeBaseTable.id, id),
        eq(aiKnowledgeBaseTable.tenantId, req.tenantId!),
      ))
      .returning({ id: aiKnowledgeBaseTable.id });
    if (!result.length) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (error) {
    console.error("Error deleting knowledge:", error);
    res.status(500).json({ error: "Failed to delete knowledge" });
  }
});

// ─── Strategies (read-only ranking) ───────────────────────────────────────────

router.get("/strategies", async (req, res) => {
  try {
    const rows = await db.query.aiStrategyAnalyticsTable.findMany({
      where: eq(aiStrategyAnalyticsTable.tenantId, req.tenantId!),
    });
    const map = new Map<string, { strategy: string; total: number; converted: number }>();
    for (const r of rows) {
      const cur = map.get(r.strategy) ?? { strategy: r.strategy, total: 0, converted: 0 };
      cur.total++;
      if (r.converted) cur.converted++;
      map.set(r.strategy, cur);
    }
    const ranking = Array.from(map.values())
      .map((s) => ({
        strategy: s.strategy,
        total: s.total,
        converted: s.converted,
        rate: s.total > 0 ? Math.round((s.converted / s.total) * 100) : 0,
      }))
      .sort((a, b) => b.rate - a.rate);
    res.json({ ranking, sampleSize: rows.length });
  } catch (error) {
    console.error("Error fetching strategies:", error);
    res.status(500).json({ error: "Failed to fetch strategies" });
  }
});

export default router;
