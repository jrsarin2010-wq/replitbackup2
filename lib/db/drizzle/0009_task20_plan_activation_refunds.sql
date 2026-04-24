-- Task #20 — Ativar plano (admin) + solicitação de reembolso com checagem de 7 dias.
-- Idempotente.

CREATE TABLE IF NOT EXISTS "refund_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "plan_at_request" varchar(50) NOT NULL,
  "reference_date" timestamp with time zone NOT NULL,
  "within_seven_day_window" boolean NOT NULL,
  "days_since_reference" integer NOT NULL,
  "status" varchar(30) NOT NULL DEFAULT 'pending',
  "reason_text" text,
  "amount_brl" integer,
  "external_provider" varchar(50),
  "external_refund_id" varchar(120),
  "admin_notes" text,
  "processed_at" timestamp with time zone,
  "requested_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_refund_requests_tenant_id" ON "refund_requests" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_refund_requests_status" ON "refund_requests" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_refund_requests_requested_at" ON "refund_requests" ("requested_at" DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_refund_requests_open_per_tenant"
  ON "refund_requests" ("tenant_id")
  WHERE status IN ('pending','processed');
