import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { dentalPortfolioItemsTable, dentalProfessionalsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { tenantMiddleware } from "../../middlewares/tenant";

const router = Router();
router.use(tenantMiddleware);

const CreatePortfolioItemBody = z.object({
  professionalId: z.number().int().positive(),
  // Aceita URL absoluta (https://...) OU caminho relativo (/api/storage/objects/...)
  // — o frontend envia caminho relativo após upload via object storage.
  mediaUrl: z.string().min(1).max(1000).refine(
    (v) => v.startsWith("http://") || v.startsWith("https://") || v.startsWith("/"),
    { message: "mediaUrl must be a URL or absolute path" },
  ),
  keywords: z.string().max(500).default(""),
  caption: z.string().max(500).nullish(),
});

const UpdatePortfolioItemBody = z.object({
  keywords: z.string().max(500).optional(),
  caption: z.string().max(500).nullish(),
  active: z.boolean().optional(),
});

router.get("/", async (req, res) => {
  const tenantId = req.tenantId;
  const professionalId = req.query.professionalId ? Number(req.query.professionalId) : undefined;

  try {
    const conditions = [eq(dentalPortfolioItemsTable.tenantId, tenantId)];
    if (professionalId) {
      conditions.push(eq(dentalPortfolioItemsTable.professionalId, professionalId));
    }
    const items = await db
      .select()
      .from(dentalPortfolioItemsTable)
      .where(and(...conditions))
      .orderBy(dentalPortfolioItemsTable.createdAt);
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch portfolio items" });
  }
});

router.post("/", async (req, res) => {
  const tenantId = req.tenantId;
  const parsed = CreatePortfolioItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }

  const { professionalId, mediaUrl, keywords, caption } = parsed.data;

  const prof = await db
    .select({ id: dentalProfessionalsTable.id })
    .from(dentalProfessionalsTable)
    .where(and(eq(dentalProfessionalsTable.id, professionalId), eq(dentalProfessionalsTable.tenantId, tenantId)))
    .limit(1);

  if (!prof.length) {
    res.status(404).json({ error: "Professional not found" });
    return;
  }

  try {
    const [item] = await db
      .insert(dentalPortfolioItemsTable)
      .values({ tenantId, professionalId, mediaUrl, keywords, caption: caption ?? null })
      .returning();
    res.status(201).json({ item });
  } catch (err) {
    res.status(500).json({ error: "Failed to create portfolio item" });
  }
});

router.patch("/:id", async (req, res) => {
  const tenantId = req.tenantId;
  const id = Number(req.params.id);
  const parsed = UpdatePortfolioItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  try {
    const [item] = await db
      .update(dentalPortfolioItemsTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(dentalPortfolioItemsTable.id, id), eq(dentalPortfolioItemsTable.tenantId, tenantId)))
      .returning();
    if (!item) {
      res.status(404).json({ error: "Portfolio item not found" });
      return;
    }
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: "Failed to update portfolio item" });
  }
});

router.delete("/:id", async (req, res) => {
  const tenantId = req.tenantId;
  const id = Number(req.params.id);

  try {
    const [deleted] = await db
      .delete(dentalPortfolioItemsTable)
      .where(and(eq(dentalPortfolioItemsTable.id, id), eq(dentalPortfolioItemsTable.tenantId, tenantId)))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Portfolio item not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete portfolio item" });
  }
});

export default router;
