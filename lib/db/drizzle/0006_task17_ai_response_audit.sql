-- Task #17 — Auditoria de obediência da IA por modo de conversa
CREATE TABLE IF NOT EXISTS "ai_response_audit" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "conversation_id" integer,
  "contact_phone_masked" varchar(32),
  "mode" varchar(32) NOT NULL,
  "obeyed" boolean NOT NULL,
  "violation_types" text,
  "retry_used" boolean DEFAULT false NOT NULL,
  "fallback_used" boolean DEFAULT false NOT NULL,
  "model_used" varchar(64),
  "intent" varchar(32),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_response_audit"
    ADD CONSTRAINT "ai_response_audit_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_response_audit_tenant_idx" ON "ai_response_audit" ("tenant_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_response_audit_mode_idx" ON "ai_response_audit" ("tenant_id","mode","created_at");
