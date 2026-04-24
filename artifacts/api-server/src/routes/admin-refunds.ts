import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { refundRequestsTable, tenantsTable, dentalSettingsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

router.get("/refunds", async (req: Request, res: Response) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const list = await db.query.refundRequestsTable.findMany({
    where: status ? eq(refundRequestsTable.status, status) : undefined,
    orderBy: [desc(refundRequestsTable.requestedAt)],
    limit: 200,
  });

  const withTenants = await Promise.all(list.map(async (r) => {
    const tenant = await db.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, r.tenantId) });
    const settings = await db.query.dentalSettingsTable.findFirst({ where: eq(dentalSettingsTable.tenantId, r.tenantId) });
    return {
      ...r,
      tenantName: tenant?.name ?? null,
      tenantSlug: tenant?.slug ?? null,
      tenantEmail: tenant?.email ?? null,
      clinicName: settings?.clinicName ?? tenant?.name ?? null,
    };
  }));

  res.json(withTenants);
});

router.post("/refunds/:id/process", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { adminNotes, externalRefundId, externalProvider } = (req.body ?? {}) as {
    adminNotes?: string;
    externalRefundId?: string;
    externalProvider?: string;
  };

  const existing = await db.query.refundRequestsTable.findFirst({ where: eq(refundRequestsTable.id, id) });
  if (!existing) { res.status(404).json({ error: "Refund request not found" }); return; }
  if (existing.status !== "pending") {
    res.status(409).json({ error: `Solicitação já está com status '${existing.status}' e não pode ser alterada.` });
    return;
  }

  const [updated] = await db.update(refundRequestsTable).set({
    status: "processed",
    processedAt: new Date(),
    adminNotes: adminNotes ?? existing.adminNotes,
    externalRefundId: externalRefundId ?? existing.externalRefundId,
    externalProvider: externalProvider ?? existing.externalProvider,
  }).where(eq(refundRequestsTable.id, id)).returning();

  res.json(updated);
});

router.post("/refunds/:id/deny", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { adminNotes } = (req.body ?? {}) as { adminNotes?: string };

  const existing = await db.query.refundRequestsTable.findFirst({ where: eq(refundRequestsTable.id, id) });
  if (!existing) { res.status(404).json({ error: "Refund request not found" }); return; }
  if (existing.status !== "pending") {
    res.status(409).json({ error: `Solicitação já está com status '${existing.status}' e não pode ser alterada.` });
    return;
  }

  const [updated] = await db.update(refundRequestsTable).set({
    status: "denied",
    processedAt: new Date(),
    adminNotes: adminNotes ?? existing.adminNotes,
  }).where(eq(refundRequestsTable.id, id)).returning();

  res.json(updated);
});

export default router;
