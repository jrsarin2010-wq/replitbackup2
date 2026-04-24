ALTER TABLE dental_professionals
  ADD COLUMN IF NOT EXISTS charges_consultation BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS default_lead_duration_minutes INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS default_patient_duration_minutes INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS insurance_plans TEXT,
  ADD COLUMN IF NOT EXISTS insurance_days TEXT,
  ADD COLUMN IF NOT EXISTS insurance_hours_start VARCHAR(5),
  ADD COLUMN IF NOT EXISTS insurance_hours_end VARCHAR(5);
