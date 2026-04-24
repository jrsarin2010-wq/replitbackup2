ALTER TABLE "dental_leads" ADD COLUMN IF NOT EXISTS "professional_id" integer REFERENCES "dental_professionals"("id") ON DELETE SET NULL;
