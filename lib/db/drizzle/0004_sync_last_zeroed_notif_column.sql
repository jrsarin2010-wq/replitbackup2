-- Backfill: ensure dental_conversation_quotas.last_zeroed_notif_sent_at exists.
-- Drizzle's snapshot was out of sync; this is idempotent so it's safe to apply
-- against databases where the column was already created via earlier db:push runs.
ALTER TABLE "dental_conversation_quotas" ADD COLUMN IF NOT EXISTS "last_zeroed_notif_sent_at" timestamp with time zone;
