-- Task #31: Align professional slot limits per plan.
-- New caps for the included professionals slot count (max_professionals):
--   free, essencial, trial → 1 (titular only)
--   pro                    → 2 (titular + 1 incluso)
-- Existing professional rows (dental_professionals) are NOT removed; only
-- the per-tenant max_professionals counter is normalized so future
-- purchases and limit checks enforce the new caps. Tenants whose active
-- professional count already exceeds the new cap remain functional
-- (grandfathered) but cannot add more until they free a slot.

UPDATE tenants
   SET max_professionals = LEAST(max_professionals, 1)
 WHERE plan IN ('free', 'essencial', 'trial')
   AND max_professionals > 1;

UPDATE tenants
   SET max_professionals = LEAST(max_professionals, 2)
 WHERE plan = 'pro'
   AND max_professionals > 2;
