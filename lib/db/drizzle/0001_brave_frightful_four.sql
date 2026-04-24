CREATE TABLE "dental_portfolio_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"professional_id" integer NOT NULL,
	"media_url" varchar(1000) NOT NULL,
	"keywords" text DEFAULT '' NOT NULL,
	"caption" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dental_leads" ADD COLUMN "payment_type" varchar(20);--> statement-breakpoint
ALTER TABLE "dental_portfolio_items" ADD CONSTRAINT "dental_portfolio_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dental_portfolio_items" ADD CONSTRAINT "dental_portfolio_items_professional_id_dental_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."dental_professionals"("id") ON DELETE cascade ON UPDATE no action;