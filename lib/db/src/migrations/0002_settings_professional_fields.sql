-- Migration: Add professional CRO and specialties to dental_settings
-- Applied: 2026-04-07
-- Adds professional_cro (varchar 20) and professional_specialties (text) to dental_settings

ALTER TABLE dental_settings
  ADD COLUMN IF NOT EXISTS professional_cro VARCHAR(20),
  ADD COLUMN IF NOT EXISTS professional_specialties TEXT;
