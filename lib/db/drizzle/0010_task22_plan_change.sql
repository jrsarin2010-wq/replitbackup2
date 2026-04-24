-- Task #22: clinic-driven plan upgrades (PIX) and scheduled downgrades.
-- Idempotent so it is safe to re-apply on environments where push-force
-- already created these objects.

CREATE TABLE IF NOT EXISTS "plan_upgrade_orders" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "from_plan" varchar(50) NOT NULL,
  "target_plan" varchar(50) NOT NULL,
  "price_in_cents" integer NOT NULL,
  "credit_in_cents" integer DEFAULT 0 NOT NULL,
  "final_charge_in_cents" integer NOT NULL,
  "billing_id" varchar(255),
  "payment_url" text,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "paid_at" timestamp with time zone
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'plan_upgrade_orders'
      AND constraint_name = 'plan_upgrade_orders_tenant_id_tenants_id_fk'
  ) THEN
    ALTER TABLE "plan_upgrade_orders"
      ADD CONSTRAINT "plan_upgrade_orders_tenant_id_tenants_id_fk"
      FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "plan_upgrade_orders_one_pending_per_tenant"
  ON "plan_upgrade_orders" USING btree ("tenant_id")
  WHERE status = 'pending';
--> statement-breakpoint

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "scheduled_plan" varchar(50);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "scheduled_plan_effective_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "scheduled_plan_requested_at" timestamp with time zone;
