-- Migration: Add extended profile columns to dental_professionals
-- Applied: 2026-04-07
-- Adds specialties (multi-value text), acceptsInsurance (boolean), consultationFee (varchar)
-- Migrates legacy single specialty -> specialties for existing rows

ALTER TABLE dental_professionals
  ADD COLUMN IF NOT EXISTS specialties TEXT,
  ADD COLUMN IF NOT EXISTS accepts_insurance BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS consultation_fee VARCHAR(20);

-- Migrate existing specialty values to the new specialties column
UPDATE dental_professionals
SET specialties = specialty
WHERE specialty IS NOT NULL
  AND specialty != ''
  AND (specialties IS NULL OR specialties = '');
