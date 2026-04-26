-- Ativa Task #25 (constrained generation) APENAS para o tenant
-- "Sorrizin Maxx" (tenant de teste, id=1) como rollout controlado.
--
-- Executado em: 2026-04-26
-- Branch: feat/activate-task25-test-tenant
--
-- Reverter:
--   UPDATE tenants SET use_constrained_generation = false WHERE name = 'Sorrizin Maxx';

UPDATE tenants
SET use_constrained_generation = true
WHERE name = 'Sorrizin Maxx';

-- Confirmação:
SELECT id, name, use_constrained_generation FROM tenants;
