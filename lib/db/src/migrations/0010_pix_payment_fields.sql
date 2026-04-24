ALTER TABLE "dental_professionals" ADD COLUMN IF NOT EXISTS "pix_key" varchar(255);
ALTER TABLE "dental_professionals" ADD COLUMN IF NOT EXISTS "pix_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "dental_professionals" ADD COLUMN IF NOT EXISTS "pix_mode" varchar(20) NOT NULL DEFAULT 'optional';
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "pix_payment_status" varchar(20) NOT NULL DEFAULT 'none';
