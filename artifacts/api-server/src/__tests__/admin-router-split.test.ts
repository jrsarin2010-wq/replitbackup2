import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ADMIN_SRC = fs.readFileSync(
  path.resolve(__dirname, "../routes/admin.ts"),
  "utf-8",
);

const ANALYTICS_SRC = fs.readFileSync(
  path.resolve(__dirname, "../routes/admin-analytics.ts"),
  "utf-8",
);

const TENANTS_SRC = fs.readFileSync(
  path.resolve(__dirname, "../routes/admin-tenants.ts"),
  "utf-8",
);

const LGPD_SRC = fs.readFileSync(
  path.resolve(__dirname, "../routes/admin-lgpd.ts"),
  "utf-8",
);

const OPS_SRC = fs.readFileSync(
  path.resolve(__dirname, "../routes/admin-ops.ts"),
  "utf-8",
);

describe("Task #10 — admin router split: integridade do agregador", () => {
  describe("admin.ts é um agregador puro (sem handlers inline)", () => {
    it("não declara route handlers inline (router.get/post/patch)", () => {
      expect(ADMIN_SRC).not.toMatch(/router\.(get|post|patch|put|delete)\s*\(/);
    });

    it("importa adminMiddleware", () => {
      expect(ADMIN_SRC).toContain("adminMiddleware");
    });

    it("importa analyticsRouter de ./admin-analytics", () => {
      expect(ADMIN_SRC).toContain("admin-analytics");
    });

    it("importa tenantsRouter de ./admin-tenants", () => {
      expect(ADMIN_SRC).toContain("admin-tenants");
    });

    it("importa lgpdRouter de ./admin-lgpd", () => {
      expect(ADMIN_SRC).toContain("admin-lgpd");
    });

    it("importa opsRouter de ./admin-ops", () => {
      expect(ADMIN_SRC).toContain("admin-ops");
    });

    it("aplica adminMiddleware antes dos subrouters", () => {
      const middlewareLine = ADMIN_SRC.indexOf("router.use(adminMiddleware)");
      const firstSubrouter = Math.min(
        ADMIN_SRC.indexOf("router.use(analyticsRouter)"),
        ADMIN_SRC.indexOf("router.use(tenantsRouter)"),
        ADMIN_SRC.indexOf("router.use(lgpdRouter)"),
        ADMIN_SRC.indexOf("router.use(opsRouter)"),
      );
      expect(middlewareLine).toBeGreaterThan(-1);
      expect(firstSubrouter).toBeGreaterThan(-1);
      expect(middlewareLine).toBeLessThan(firstSubrouter);
    });
  });

  describe("admin-analytics.ts contém os endpoints de analytics", () => {
    it("declara route GET /dashboard", () => {
      expect(ANALYTICS_SRC).toContain('router.get("/dashboard"');
    });

    it("declara route GET /revenue", () => {
      expect(ANALYTICS_SRC).toContain('router.get("/revenue"');
    });

    it("declara route GET /growth", () => {
      expect(ANALYTICS_SRC).toContain('router.get("/growth"');
    });

    it("declara route GET /churn", () => {
      expect(ANALYTICS_SRC).toContain('router.get("/churn"');
    });

    it("declara route GET /insights", () => {
      expect(ANALYTICS_SRC).toContain('router.get("/insights"');
    });
  });

  describe("admin-tenants.ts contém os endpoints de tenants", () => {
    it("declara route GET /tenants", () => {
      expect(TENANTS_SRC).toContain('router.get("/tenants"');
    });

    it("declara route GET /tenants/:tenantId", () => {
      expect(TENANTS_SRC).toContain('router.get("/tenants/:tenantId"');
    });

    it("declara route PATCH /tenants/:tenantId", () => {
      expect(TENANTS_SRC).toContain('router.patch("/tenants/:tenantId"');
    });

    it("declara route POST /tenants/:tenantId/credits", () => {
      expect(TENANTS_SRC).toContain('router.post("/tenants/:tenantId/credits"');
    });

    it("não contém lógica de LGPD", () => {
      expect(TENANTS_SRC).not.toContain("anonymize");
    });
  });

  describe("admin-lgpd.ts contém os endpoints de LGPD", () => {
    it("declara route GET /lgpd/:tenantId/consent", () => {
      expect(LGPD_SRC).toContain('router.get("/lgpd/:tenantId/consent"');
    });

    it("declara route GET /lgpd/:tenantId/audit-log", () => {
      expect(LGPD_SRC).toContain('router.get("/lgpd/:tenantId/audit-log"');
    });

    it("declara route POST /lgpd/:tenantId/anonymize/:entityType/:entityId", () => {
      expect(LGPD_SRC).toContain('router.post("/lgpd/:tenantId/anonymize/:entityType/:entityId"');
    });
  });

  describe("admin-ops.ts contém os endpoints operacionais", () => {
    it("declara route POST /trigger-followups", () => {
      expect(OPS_SRC).toContain('router.post("/trigger-followups"');
    });

    it("declara route POST /trigger-remarketing", () => {
      expect(OPS_SRC).toContain('router.post("/trigger-remarketing"');
    });

    it("declara route POST /tenants/:id/reset-test-data", () => {
      expect(OPS_SRC).toContain('router.post("/tenants/:id/reset-test-data"');
    });

    it("declara route GET /feedback", () => {
      expect(OPS_SRC).toContain('router.get("/feedback"');
    });

    it("declara route PATCH /feedback/:id/status", () => {
      expect(OPS_SRC).toContain('router.patch("/feedback/:id/status"');
    });
  });
});

describe("Task #10 — prompt-helpers.ts: extração de helpers", () => {
  const HELPERS_SRC = fs.readFileSync(
    path.resolve(__dirname, "../lib/prompt-helpers.ts"),
    "utf-8",
  );

  const PROMPT_SRC = fs.readFileSync(
    path.resolve(__dirname, "../lib/prompt-builder.ts"),
    "utf-8",
  );

  it("prompt-helpers.ts exporta computeEarlyInsuranceModeSection", () => {
    expect(HELPERS_SRC).toContain("export function computeEarlyInsuranceModeSection");
  });

  it("prompt-helpers.ts exporta resolveAcceptsInsurance", () => {
    expect(HELPERS_SRC).toContain("export function resolveAcceptsInsurance");
  });

  it("prompt-helpers.ts exporta buildPortfolioSection", () => {
    expect(HELPERS_SRC).toContain("export async function buildPortfolioSection");
  });

  it("prompt-builder.ts re-exporta computeEarlyInsuranceModeSection de ./prompt-helpers", () => {
    expect(PROMPT_SRC).toContain('export { computeEarlyInsuranceModeSection');
    expect(PROMPT_SRC).toContain('from "./prompt-helpers"');
  });

  it("prompt-builder.ts re-exporta resolveAcceptsInsurance de ./prompt-helpers", () => {
    expect(PROMPT_SRC).toContain('resolveAcceptsInsurance');
    expect(PROMPT_SRC).toContain('from "./prompt-helpers"');
  });

  it("prompt-builder.ts NÃO define buildPortfolioSection localmente (evitar duplicata)", () => {
    expect(PROMPT_SRC).not.toContain("async function buildPortfolioSection");
  });
});

describe("Task #11 — migrações versionadas Drizzle: boot sem DDL", () => {
  const INDEX_SRC = fs.readFileSync(
    path.resolve(__dirname, "../index.ts"),
    "utf-8",
  );

  const MIGRATION_0002_SRC = fs.readFileSync(
    path.resolve(__dirname, "../../../../lib/db/drizzle/0002_performance_indexes.sql"),
    "utf-8",
  );

  const JOURNAL = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, "../../../../lib/db/drizzle/meta/_journal.json"),
      "utf-8",
    ),
  ) as { entries: Array<{ tag: string }> };

  const MIGRATE_DATA_SRC = fs.readFileSync(
    path.resolve(__dirname, "../../../../scripts/src/migrate-data.ts"),
    "utf-8",
  );

  it("index.ts NÃO chama runAllMigrations no boot", () => {
    expect(INDEX_SRC).not.toContain("runAllMigrations");
  });

  it("index.ts NÃO importa de ./migrations", () => {
    expect(INDEX_SRC).not.toContain('from "./migrations"');
  });

  it("index.ts NÃO contém DDL (ALTER TABLE / CREATE TABLE) inline", () => {
    expect(INDEX_SRC).not.toContain("ALTER TABLE");
    expect(INDEX_SRC).not.toContain("CREATE TABLE");
  });

  it("0002_performance_indexes.sql contém 16+ CREATE INDEX", () => {
    const matches = MIGRATION_0002_SRC.match(/CREATE INDEX/g);
    expect(matches?.length).toBeGreaterThanOrEqual(16);
  });

  it("0002_performance_indexes.sql contém índices de appointments, leads, conversations, patients", () => {
    expect(MIGRATION_0002_SRC).toContain("idx_appointments_tenant_starts");
    expect(MIGRATION_0002_SRC).toContain("idx_dental_leads_tenant_status");
    expect(MIGRATION_0002_SRC).toContain("idx_dental_conversations_tenant");
    expect(MIGRATION_0002_SRC).toContain("idx_patients_tenant");
  });

  it("_journal.json contém entradas para 0000, 0001 e 0002", () => {
    const tags = JOURNAL.entries.map((e) => e.tag);
    expect(tags.some((t) => t.startsWith("0000_"))).toBe(true);
    expect(tags.some((t) => t.startsWith("0001_"))).toBe(true);
    expect(tags.some((t) => t.startsWith("0002_"))).toBe(true);
    expect(JOURNAL.entries.length).toBeGreaterThanOrEqual(3);
  });

  it("scripts/src/migrate-data.ts exporta lógica de migrateProfessionals", () => {
    expect(MIGRATE_DATA_SRC).toContain("migrateProfessionals");
  });

  it("scripts/src/migrate-data.ts exporta lógica de seedDentalKnowledgeBase", () => {
    expect(MIGRATE_DATA_SRC).toContain("seedDentalKnowledgeBase");
  });

  it("scripts/src/migrate-data.ts exporta lógica de ensureOwnerProfessional", () => {
    expect(MIGRATE_DATA_SRC).toContain("ensureOwnerProfessional");
  });
});
