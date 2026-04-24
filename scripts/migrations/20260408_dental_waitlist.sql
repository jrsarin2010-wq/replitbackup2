-- Migration: Create dental_waitlist table
-- Applied: 2026-04-08
-- Description: Intelligent waitlist for dental clinics.
--   Stores patient/lead slot preferences (exact slot, date, or time-of-day).
--   When an appointment is cancelled, the system notifies the highest-priority
--   waitlist entry via WhatsApp in real time.

CREATE TABLE IF NOT EXISTS dental_waitlist (
  id                   SERIAL PRIMARY KEY,
  tenant_id            INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_phone        VARCHAR(50) NOT NULL,
  contact_name         VARCHAR(255),
  professional_id      INTEGER REFERENCES dental_professionals(id) ON DELETE SET NULL,
  patient_id           INTEGER,
  lead_id              INTEGER,
  preferred_date       DATE,
  preferred_time_slot  VARCHAR(30),
  preferred_time_of_day VARCHAR(20) NOT NULL DEFAULT 'any',
  notes                TEXT,
  notified_at          TIMESTAMPTZ,
  notification_count   INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dental_waitlist_tenant
  ON dental_waitlist(tenant_id);

CREATE INDEX IF NOT EXISTS idx_dental_waitlist_professional
  ON dental_waitlist(tenant_id, professional_id);
