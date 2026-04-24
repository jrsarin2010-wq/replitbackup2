import { Router } from "express";
import { db } from "@workspace/db";
import { tenantsTable, refundRequestsTable } from "@workspace/db";
import { eq, and, desc, ne } from "drizzle-orm";
import { tenantMiddleware } from "../../middlewares/tenant";

const router = Router();

const REFUND_WINDOW_DAYS = 7;
const PLAN_PRICE_BRL: Record<string, number> = {
  basico: 197,
  trial: 197,
  free: 0,
  essencial: 297,
  pro: 447,
  premium: 297,
  enterprise: 447,
};

function computeReferenceDate(t: { subscribedAt: Date | null; createdAt: Date }) {
  return t.subscribedAt ?? t.createdAt;
}

function computeWindow(refDate: Date, now: Date) {
  const diffMs = now.getTime() - refDate.getTime();
  const days = Math.floor(diffMs / (24 * 3600 * 1000));
  return {
    daysSinceReference: days,
    withinSevenDayWindow: days >= 0 && days < REFUND_WINDOW_DAYS,
    daysRemaining: Math.max(0, REFUND_WINDOW_DAYS - days),
  };
}

router.get("/eligibility", tenantMiddleware, async (req, res) => {
  const tenant = await db.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, req.tenantId) });
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }

  const now = new Date();
  const refDate = computeReferenceDate(tenant);
  const win = computeWindow(refDate, now);

  const existing = await db.query.refundRequestsTable.findFirst({
    where: and(
      eq(refundRequestsTable.tenantId, req.tenantId),
      ne(refundRequestsTable.status, "denied"),
    ),
    orderBy: [desc(refundRequestsTable.requestedAt)],
  });

  res.json({
    eligible: win.withinSevenDayWindow && !existing,
    withinSevenDayWindow: win.withinSevenDayWindow,
    daysSinceReference: win.daysSinceReference,
    daysRemaining: win.daysRemaining,
    referenceDate: refDate.toISOString(),
    plan: tenant.plan,
    amountBrl: PLAN_PRICE_BRL[tenant.plan] ?? null,
    hasOpenRequest: !!existing,
    existingRequestStatus: existing?.status ?? null,
  });
});

router.post("/request", tenantMiddleware, async (req, res) => {
  const { reasonText } = (req.body ?? {}) as { reasonText?: string };

  const tenant = await db.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, req.tenantId) });
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }

  const existing = await db.query.refundRequestsTable.findFirst({
    where: and(
      eq(refundRequestsTable.tenantId, req.tenantId),
      ne(refundRequestsTable.status, "denied"),
    ),
    orderBy: [desc(refundRequestsTable.requestedAt)],
  });
  if (existing) {
    res.status(409).json({ error: "Já existe uma solicitação de reembolso em aberto", request: existing });
    return;
  }

  const now = new Date();
  const refDate = computeReferenceDate(tenant);
  const win = computeWindow(refDate, now);

  try {
    const [created] = await db.insert(refundRequestsTable).values({
      tenantId: req.tenantId,
      planAtRequest: tenant.plan,
      referenceDate: refDate,
      withinSevenDayWindow: win.withinSevenDayWindow,
      daysSinceReference: win.daysSinceReference,
      status: "pending",
      reasonText: reasonText?.slice(0, 2000) ?? null,
      amountBrl: PLAN_PRICE_BRL[tenant.plan] ?? null,
    }).returning();
    res.json(created);
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === "23505") {
      res.status(409).json({ error: "Já existe uma solicitação de reembolso em aberto" });
      return;
    }
    throw e;
  }
});

router.get("/mine", tenantMiddleware, async (req, res) => {
  const list = await db.query.refundRequestsTable.findMany({
    where: eq(refundRequestsTable.tenantId, req.tenantId),
    orderBy: [desc(refundRequestsTable.requestedAt)],
    limit: 20,
  });
  res.json(list);
});

export default router;
