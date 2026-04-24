-- Task #14 — Inbound calls via Vapi + per-tenant Cartesia call voice.
ALTER TABLE "dental_settings"
  ADD COLUMN IF NOT EXISTS "vapi_inbound_phone_number_id" varchar(200),
  ADD COLUMN IF NOT EXISTS "vapi_inbound_assistant_id" varchar(200),
  ADD COLUMN IF NOT EXISTS "inbound_calls_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "call_voice_id" varchar(100);
