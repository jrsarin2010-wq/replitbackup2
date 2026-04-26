# Task #25 — Rollout de Constrained Generation

## Status atual

| Tenant        | use_constrained_generation | Desde       |
|---------------|---------------------------|-------------|
| Sorrizin Maxx | **ATIVO** (`true`)        | 2026-04-26  |
| Outros        | inativo (`false` default) | —           |

## O que é

Task #25 substitui o pipeline legado de geração de resposta por um caminho
restrito (constrained generation) com JSON Schema, slot_ids/professional_id
enumerados e render layer determinístico. A troca é controlada pela flag
`use_constrained_generation` na tabela `tenants`.

Arquivos do caminho novo (não modificar sem PR revisado):
- `constrained-engine.ts`
- `constrained-facts.ts`
- `constrained-output.ts`
- `constrained-prompt.ts`
- `structured-renderer.ts`

## Como observar em produção

Buscar nos logs por tenant/conversationId:

```
[TASK25] Using CONSTRAINED generation path   → path: constrained_v25
[TASK25] Using LEGACY generation path        → path: legacy
```

Ambos incluem `tenantId` e `conversationId` como campos estruturados para
filtragem.

## Como reverter (rollback)

Em caso de problema, executar diretamente no banco — efeito imediato na
próxima requisição, sem necessidade de deploy:

```sql
UPDATE tenants
SET use_constrained_generation = false
WHERE name = 'Sorrizin Maxx';

-- Confirmar:
SELECT id, name, use_constrained_generation FROM tenants;
```

Script de referência: `scripts/migrations/activate_task25_replit_max.sql`

## Como ativar para outros tenants

```sql
UPDATE tenants
SET use_constrained_generation = true
WHERE name = '<nome do tenant>';
```
