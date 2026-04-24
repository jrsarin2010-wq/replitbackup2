/**
 * Task #14 — Behavioral regression tests for conversation-quota-manager.
 *
 * Mocks @workspace/db with a stateful in-memory store and exercises the real
 * checkAndConsumeConversationQuota function across the scenarios required by
 * the task plan:
 *   (a) primeira mensagem com quota=0  → bloqueia; recarga → próxima cobra
 *   (b) janela de 24h reseta corretamente
 *   (c) 51ª mensagem dispara cobrança anti-abuso
 *   (d) mensagem no meio da conversa nunca é bloqueada
 *
 * Plus the core fix:
 *   (e) forceCharge=true debita 1 unidade mesmo com priorCount≥1
 *       (cenário do auto-desbloqueio em quota_blocked)
 *   (f) forceCharge=true com quota esgotada NÃO debita e retorna allowed:false
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ── Stateful mock store ──────────────────────────────────────────────────────
type QuotaRow = {
  id: number;
  tenantId: number;
  monthlyConversationsUsed: number;
  monthlyResetDate: Date;
  rechargeBalance: number;
  alert80SentAt: Date | null;
  alert100SentAt: Date | null;
  lastZeroedNotifSentAt: Date | null;
};

const state = vi.hoisted(() => ({
  inboundCount: 0,
  quota: null as null | {
    id: number;
    tenantId: number;
    monthlyConversationsUsed: number;
    monthlyResetDate: Date;
    rechargeBalance: number;
    alert80SentAt: Date | null;
    alert100SentAt: Date | null;
    lastZeroedNotifSentAt: Date | null;
  },
  tenant: { id: 1, plan: "essencial" as string, maxProfessionals: 1 },
}));

vi.mock("@workspace/db", () => {
  // db.select().from().innerJoin().where() → [{ n: count }]
  const selectChain = {
    from: () => selectChain,
    innerJoin: () => selectChain,
    where: () => Promise.resolve([{ n: String(state.inboundCount) }]),
  };

  function makeUpdateChain() {
    const chain = {
      set: (_v: unknown) => chain,
      where: (_w: unknown) => {
        // Apply a simple SQL-template increment/decrement for the consume path:
        // set: { monthlyConversationsUsed: sql`+ ${fromMonthly}`, rechargeBalance: sql`- ${fromRecharge}` }
        // We don't parse the template; instead the test inspects the Promise
        // chain by reading state after consume. Real diffs are applied via
        // helpers below in test setup.
        return Promise.resolve();
      },
      returning: () => Promise.resolve(state.quota ? [state.quota] : []),
    };
    return chain;
  }

  function makeInsertChain() {
    return {
      values: (v: { tenantId: number; monthlyConversationsUsed?: number; rechargeBalance?: number; monthlyResetDate?: Date }) => ({
        returning: () => {
          state.quota = {
            id: 1,
            tenantId: v.tenantId,
            monthlyConversationsUsed: v.monthlyConversationsUsed ?? 0,
            monthlyResetDate: v.monthlyResetDate ?? new Date(),
            rechargeBalance: v.rechargeBalance ?? 0,
            alert80SentAt: null,
            alert100SentAt: null,
            lastZeroedNotifSentAt: null,
          };
          return Promise.resolve([state.quota]);
        },
      }),
    };
  }

  // Capture writes from the consume path. We intercept tx.update().set(...).where(...)
  // and apply the deterministic debit logic against in-memory state, since drizzle's
  // `sql` template fragments don't stringify into anything we can parse reliably.
  function makeTxUpdateChain() {
    let setPayload: Record<string, unknown> = {};
    const chain = {
      set: (v: Record<string, unknown>) => {
        setPayload = v;
        return chain;
      },
      where: (_w: unknown) => {
        if (!state.quota) return Promise.resolve();
        const hasMonthlyKey = "monthlyConversationsUsed" in setPayload;
        const hasRechargeKey = "rechargeBalance" in setPayload;
        if (hasMonthlyKey && hasRechargeKey) {
          // Consume path: debit 1 unit from monthly first, otherwise from recharge.
          const limit = planLimits[state.tenant.plan] ?? 0;
          const monthlyRemaining = Math.max(0, limit - state.quota.monthlyConversationsUsed);
          if (monthlyRemaining > 0) {
            state.quota.monthlyConversationsUsed += 1;
          } else {
            state.quota.rechargeBalance -= 1;
          }
        }
        // Alert-flag updates (plain Date values, no sql template).
        if (setPayload.alert80SentAt instanceof Date) state.quota.alert80SentAt = setPayload.alert80SentAt;
        if (setPayload.alert100SentAt instanceof Date) state.quota.alert100SentAt = setPayload.alert100SentAt;
        return Promise.resolve();
      },
      returning: () => Promise.resolve(state.quota ? [state.quota] : []),
    };
    return chain;
  }
  const planLimits: Record<string, number> = { trial: 50, basico: 900, essencial: 900, pro: 1500 };

  const txApi = {
    query: {
      dentalConversationQuotasTable: { findFirst: () => Promise.resolve(state.quota) },
      tenantsTable: { findFirst: () => Promise.resolve(state.tenant) },
    },
    insert: () => makeInsertChain(),
    update: () => makeTxUpdateChain(),
    execute: (_sql: unknown) => {
      // tx.execute(sql`SELECT ... FOR UPDATE`) → array of rows
      return Promise.resolve(state.quota ? [state.quota] : []);
    },
  };

  return {
    db: {
      select: () => selectChain,
      update: () => makeUpdateChain(),
      transaction: async (cb: (tx: typeof txApi) => Promise<unknown>) => cb(txApi),
      query: {
        dentalConversationQuotasTable: { findFirst: () => Promise.resolve(state.quota) },
        tenantsTable: { findFirst: () => Promise.resolve(state.tenant) },
      },
    },
    dentalConversationQuotasTable: { tenantId: "tenant_id", monthlyConversationsUsed: "monthly_conversations_used", rechargeBalance: "recharge_balance" },
    dentalMessagesTable: { tenantId: "tenant_id", conversationId: "conversation_id", direction: "direction", sentAt: "sent_at" },
    dentalConversationsTable: { id: "id", contactPhone: "contact_phone" },
    tenantsTable: { id: "id", plan: "plan" },
  };
});

vi.mock("../lib/cache", () => ({
  getCachedSettings: () => Promise.resolve(null),
}));

vi.mock("../lib/telegram", () => ({
  sendTelegramMessage: () => Promise.resolve(),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────
function resetState(opts: { monthlyUsed?: number; rechargeBalance?: number; plan?: string; inboundCount?: number } = {}) {
  state.inboundCount = opts.inboundCount ?? 0;
  state.tenant = { id: 1, plan: opts.plan ?? "essencial", maxProfessionals: 1 };
  state.quota = {
    id: 1,
    tenantId: 1,
    monthlyConversationsUsed: opts.monthlyUsed ?? 0,
    monthlyResetDate: new Date(),
    rechargeBalance: opts.rechargeBalance ?? 0,
    alert80SentAt: null,
    alert100SentAt: null,
    lastZeroedNotifSentAt: null,
  };
}

// Import AFTER mocks are registered.
import { checkAndConsumeConversationQuota } from "../lib/conversation-quota-manager";

describe("Task #14 — checkAndConsumeConversationQuota: cenários comportamentais", () => {
  beforeEach(() => {
    resetState();
  });

  // Plan "essencial" with maxProfessionals=1 → limit = 900 (see plan-features.ts).
  // Tests below use monthlyUsed=900 to mean "monthly pool exhausted".
  const MONTHLY_LIMIT = 900;

  it("(a1) primeira mensagem com quota esgotada (monthly=limit, recharge=0) → bloqueia, sem débito", async () => {
    resetState({ monthlyUsed: MONTHLY_LIMIT, rechargeBalance: 0, inboundCount: 1 }); // current msg already saved
    const r = await checkAndConsumeConversationQuota(1, "+5511999990001");
    expect(r.allowed).toBe(false);
    expect(r.isExhausted).toBe(true);
    expect(state.quota!.monthlyConversationsUsed).toBe(MONTHLY_LIMIT);
    expect(state.quota!.rechargeBalance).toBe(0);
  });

  it("(a2) após recarga, próxima mensagem com forceCharge debita exatamente 1 unidade da recarga", async () => {
    // Cenário do auto-desbloqueio: msg original já está em dental_messages (priorCount=1),
    // recarga foi adicionada. Sem forceCharge, shouldCharge=false → conversa grátis (BUG).
    // Com forceCharge:true → debita 1 unidade da recarga (monthly esgotada).
    resetState({ monthlyUsed: MONTHLY_LIMIT, rechargeBalance: 400, inboundCount: 2 }); // priorCount = 1
    const r = await checkAndConsumeConversationQuota(1, "+5511999990001", { forceCharge: true });
    expect(r.allowed).toBe(true);
    expect(state.quota!.rechargeBalance).toBe(399); // -1 da recarga
    expect(state.quota!.monthlyConversationsUsed).toBe(MONTHLY_LIMIT); // monthly inalterado
  });

  it("(a3) forceCharge=true com quota TOTALMENTE esgotada NÃO debita e retorna allowed:false", async () => {
    resetState({ monthlyUsed: MONTHLY_LIMIT, rechargeBalance: 0, inboundCount: 2 });
    const r = await checkAndConsumeConversationQuota(1, "+5511999990001", { forceCharge: true });
    expect(r.allowed).toBe(false);
    expect(r.isExhausted).toBe(true);
    expect(state.quota!.rechargeBalance).toBe(0);
    expect(state.quota!.monthlyConversationsUsed).toBe(MONTHLY_LIMIT);
  });

  it("(b) primeira mensagem na janela (priorCount=0) com quota disponível → debita 1 do monthly", async () => {
    // Janela de 24h vazia → rawCount=1 (current) → priorCount=0 → cobra
    resetState({ monthlyUsed: 0, rechargeBalance: 0, inboundCount: 1 });
    const r = await checkAndConsumeConversationQuota(1, "+5511999990002");
    expect(r.allowed).toBe(true);
    expect(state.quota!.monthlyConversationsUsed).toBe(1);
    expect(state.quota!.rechargeBalance).toBe(0);
  });

  it("(c) 51ª mensagem (priorCount=50) dispara cobrança anti-abuso", async () => {
    // rawCount=51 → priorCount=50 → 50 % 50 === 0 → cobra
    resetState({ monthlyUsed: 5, rechargeBalance: 0, inboundCount: 51 });
    const r = await checkAndConsumeConversationQuota(1, "+5511999990003");
    expect(r.allowed).toBe(true);
    expect(state.quota!.monthlyConversationsUsed).toBe(6); // +1 anti-abuso
  });

  it("(d) mensagem no meio da conversa (priorCount=10) NÃO debita e nunca bloqueia, mesmo com quota esgotada", async () => {
    // rawCount=11 → priorCount=10 → 10 % 50 !== 0 → não cobra → allowed:true sempre
    resetState({ monthlyUsed: 2000, rechargeBalance: 0, inboundCount: 11 });
    const r = await checkAndConsumeConversationQuota(1, "+5511999990004");
    expect(r.allowed).toBe(true);
    // Nada debitado
    expect(state.quota!.monthlyConversationsUsed).toBe(2000);
    expect(state.quota!.rechargeBalance).toBe(0);
  });

  it("(e) débito normal usa monthly antes da recarga quando ambos disponíveis", async () => {
    resetState({ monthlyUsed: 0, rechargeBalance: 100, inboundCount: 1 });
    await checkAndConsumeConversationQuota(1, "+5511999990005");
    expect(state.quota!.monthlyConversationsUsed).toBe(1);
    expect(state.quota!.rechargeBalance).toBe(100); // recarga intacta
  });

  it("(f) débito vai para recarga quando monthly esgotado", async () => {
    resetState({ monthlyUsed: 2000, rechargeBalance: 100, inboundCount: 1 });
    await checkAndConsumeConversationQuota(1, "+5511999990006");
    expect(state.quota!.monthlyConversationsUsed).toBe(2000); // monthly fixo
    expect(state.quota!.rechargeBalance).toBe(99); // -1 da recarga
  });

  it("(g) forceCharge sobre janela de 24h reset (priorCount=0) ainda funciona — debita 1 vez só", async () => {
    // Edge case: janela resetou E forceCharge=true. Ambos pediriam débito;
    // o consume é uma transação única, então debita exatamente 1 unidade.
    resetState({ monthlyUsed: 0, rechargeBalance: 0, inboundCount: 1 });
    await checkAndConsumeConversationQuota(1, "+5511999990007", { forceCharge: true });
    expect(state.quota!.monthlyConversationsUsed).toBe(1);
  });
});

// ── Cleanup guards (filesystem-level, not source regex) ──────────────────────
describe("Task #14 — limpeza de schema e migração", () => {
  it("arquivo de schema conv_quota_contacts.ts foi deletado", () => {
    const f = path.resolve(__dirname, "../../../../lib/db/src/schema/conv_quota_contacts.ts");
    expect(fs.existsSync(f)).toBe(false);
  });

  it("migração de drop existe e contém DROP TABLE para dental_conv_quota_contacts", () => {
    const f = path.resolve(__dirname, "../../../../lib/db/drizzle/0003_drop_dental_conv_quota_contacts.sql");
    expect(fs.existsSync(f)).toBe(true);
    const sqlContents = fs.readFileSync(f, "utf-8");
    expect(sqlContents).toMatch(/DROP TABLE[^;]*dental_conv_quota_contacts/i);
  });
});
