/**
 * Backend test: PATCH /api/dental/leads/:leadId/payment-type
 *
 * Verifica:
 *   1. Atualiza paymentType do lead corretamente
 *   2. Escreve auditoria em data_audit_log com from/to/source corretos
 *   3. Escreve activity em dental_activity
 *   4. Retorna 404 quando o lead pertence a outro tenant (isolamento)
 *   5. Rejeita body inválido com 400
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { mockFindFirst, mockReturning, auditInserts, activityInserts } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockReturning: vi.fn(),
  auditInserts: [] as unknown[],
  activityInserts: [] as unknown[],
}));

vi.mock("@workspace/db", () => {
  const updateChain = {
    set: () => updateChain,
    where: () => updateChain,
    returning: () => mockReturning(),
  };
  const insertChain = (target: "audit" | "activity") => ({
    values: (v: unknown) => {
      if (target === "audit") auditInserts.push(v);
      else activityInserts.push(v);
      return Promise.resolve();
    },
  });
  return {
    db: {
      query: { dentalLeadsTable: { findFirst: () => mockFindFirst() } },
      update: () => updateChain,
      delete: () => ({ where: () => Promise.resolve() }),
      insert: (table: { __name?: string }) => {
        const name = table?.__name || "";
        if (name === "data_audit_log") return insertChain("audit");
        return insertChain("activity");
      },
    },
    dentalLeadsTable: { __name: "dental_leads" },
    dentalProfessionalsTable: { __name: "dental_professionals" },
    patientsTable: { __name: "patients" },
    dentalActivityTable: { __name: "dental_activity" },
    consentRecordsTable: { __name: "consent_records" },
    dataAuditLogTable: { __name: "data_audit_log" },
    leadsTable: { __name: "leads" },
    eq: () => ({}),
    and: () => ({}),
    desc: () => ({}),
  };
});

vi.mock("../middlewares/tenant.js", () => ({
  tenantMiddleware: (
    req: express.Request & { tenantId: number },
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    req.tenantId = 1;
    next();
  },
}));

vi.mock("../lib/ai-engine.js", () => ({
  markStrategyOutcome: vi.fn().mockResolvedValue(undefined),
}));

const { default: leadsRouter } = await import("../routes/dental/leads.js");
const { globalErrorHandler } = await import("../middlewares/error-handler.js");

const app = express();
app.use(express.json());
app.use("/", leadsRouter);
app.use(globalErrorHandler);

beforeEach(() => {
  vi.resetAllMocks();
  auditInserts.length = 0;
  activityInserts.length = 0;
});

describe("PATCH /:leadId/payment-type", () => {
  it("atualiza paymentType de null → insurance e grava auditoria + activity", async () => {
    mockFindFirst.mockResolvedValue({
      id: 42,
      tenantId: 1,
      name: "João",
      paymentType: null,
    });
    mockReturning.mockResolvedValue([{ id: 42, tenantId: 1, name: "João", paymentType: "insurance" }]);

    const res = await request(app)
      .patch("/42/payment-type")
      .send({ paymentType: "insurance" });

    expect(res.status).toBe(200);
    expect(res.body.paymentType).toBe("insurance");

    expect(auditInserts).toHaveLength(1);
    const audit = auditInserts[0] as { tenantId: number; action: string; entityType: string; entityId: number; field: string; metadata: string };
    expect(audit.tenantId).toBe(1);
    expect(audit.action).toBe("update");
    expect(audit.entityType).toBe("lead");
    expect(audit.entityId).toBe(42);
    expect(audit.field).toBe("payment_type");
    const meta = JSON.parse(audit.metadata);
    expect(meta).toEqual({ from: null, to: "insurance", source: "manual_dashboard_override" });

    expect(activityInserts).toHaveLength(1);
    const activity = activityInserts[0] as { tenantId: number; type: string; entityType: string; entityId: number };
    expect(activity.tenantId).toBe(1);
    expect(activity.type).toBe("lead_payment_type_changed");
    expect(activity.entityType).toBe("lead");
    expect(activity.entityId).toBe(42);
  });

  it("atualiza paymentType de insurance → private (transição)", async () => {
    mockFindFirst.mockResolvedValue({
      id: 7,
      tenantId: 1,
      name: "Maria",
      paymentType: "insurance",
    });
    mockReturning.mockResolvedValue([{ id: 7, tenantId: 1, name: "Maria", paymentType: "private" }]);

    const res = await request(app)
      .patch("/7/payment-type")
      .send({ paymentType: "private" });

    expect(res.status).toBe(200);
    const meta = JSON.parse((auditInserts[0] as { metadata: string }).metadata);
    expect(meta.from).toBe("insurance");
    expect(meta.to).toBe("private");
  });

  it("aceita paymentType: null para limpar o valor", async () => {
    mockFindFirst.mockResolvedValue({ id: 9, tenantId: 1, name: "Pedro", paymentType: "private" });
    mockReturning.mockResolvedValue([{ id: 9, tenantId: 1, name: "Pedro", paymentType: null }]);

    const res = await request(app)
      .patch("/9/payment-type")
      .send({ paymentType: null });

    expect(res.status).toBe(200);
    const meta = JSON.parse((auditInserts[0] as { metadata: string }).metadata);
    expect(meta.from).toBe("private");
    expect(meta.to).toBeNull();
  });

  it("retorna 404 quando o lead pertence a outro tenant (isolamento)", async () => {
    mockFindFirst.mockResolvedValue(undefined);

    const res = await request(app)
      .patch("/999/payment-type")
      .send({ paymentType: "insurance" });

    expect(res.status).toBe(404);
    expect(auditInserts).toHaveLength(0);
    expect(activityInserts).toHaveLength(0);
  });

  it("rejeita body inválido (paymentType desconhecido)", async () => {
    mockFindFirst.mockResolvedValue({ id: 1, tenantId: 1, name: "X", paymentType: null });

    const res = await request(app)
      .patch("/1/payment-type")
      .send({ paymentType: "cartao" });

    expect(res.status).toBe(400);
    expect(auditInserts).toHaveLength(0);
  });
});
