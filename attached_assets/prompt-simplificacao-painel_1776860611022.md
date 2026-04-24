# Prompt — Simplificação do Painel + Automação Inteligente

## Contexto
O objetivo é remover do menu do dentista tudo que ele não precisa ver,
deixar o sistema funcionando de forma automática e segura, e mover
o que é necessário para o painel admin do dono do SaaS.

São 3 mudanças independentes que devem ser feitas juntas.

---

## MUDANÇA 1 — Autoaprendizado com filtro de confiança automático

### O que muda
O autoaprendizado continua funcionando, mas com aprovação automática
baseada em frequência. Só entra na base o que aparecer pelo menos
2 vezes em conversas diferentes. O dentista nunca vê isso.
Você como dono do SaaS pode revisar no admin quando quiser,
mas não precisa.

### Passo 1 — Adicionar campo `occurrences` na tabela de aprendizados
No schema da tabela de aprendizados (provavelmente `dental_ai_learnings`
ou similar), adicionar se ainda não existir:

```typescript
occurrences: integer("occurrences").notNull().default(1),
weekApprovalCount: integer("week_approval_count").notNull().default(0),
weekApprovalReset: timestamp("week_approval_reset", { withTimezone: true }),
```

Rodar `pnpm db:push` após adicionar.

### Passo 2 — Modificar `ai-learning.ts` — lógica de aprovação automática

Substituir a lógica de salvar aprendizados por:

```typescript
// Constantes
const APPROVAL_THRESHOLD = 2;     // mínimo de ocorrências para aprovar
const WEEKLY_APPROVAL_LIMIT = 5;  // máximo de aprovações por semana por tenant

async function saveOrIncrementLearning(
  tenantId: number,
  pattern: string,
  knowledge: string
): Promise<void> {
  return db.transaction(async (tx) => {

    // Verificar se padrão similar já existe como candidato
    const existing = await tx.query.aiLearningsTable.findFirst({
      where: and(
        eq(aiLearningsTable.tenantId, tenantId),
        eq(aiLearningsTable.pattern, pattern),
        eq(aiLearningsTable.status, "pending")
      ),
    });

    if (!existing) {
      // Primeira vez que aparece — salvar como candidato
      await tx.insert(aiLearningsTable).values({
        tenantId,
        pattern,
        knowledge,
        status: "pending",
        occurrences: 1,
        source: "auto",
        createdAt: new Date(),
      });
      logger.info({ tenantId, pattern }, "New learning candidate saved");
      return;
    }

    // Segunda+ vez — incrementar ocorrências
    const newOccurrences = (existing.occurrences ?? 1) + 1;

    if (newOccurrences >= APPROVAL_THRESHOLD) {
      // Verificar limite semanal
      const withinWeeklyLimit = await checkWeeklyLimit(tx, tenantId);
      if (!withinWeeklyLimit) {
        logger.info(
          { tenantId },
          "Weekly approval limit reached — keeping as pending"
        );
        await tx
          .update(aiLearningsTable)
          .set({ occurrences: newOccurrences, updatedAt: new Date() })
          .where(eq(aiLearningsTable.id, existing.id));
        return;
      }

      // Aprovar automaticamente
      await tx
        .update(aiLearningsTable)
        .set({
          status: "approved",
          occurrences: newOccurrences,
          approvedAt: new Date(),
          approvedBy: "auto",
          updatedAt: new Date(),
        })
        .where(eq(aiLearningsTable.id, existing.id));

      // Incrementar contador semanal
      await incrementWeeklyCount(tx, tenantId);

      logger.info(
        { tenantId, pattern, occurrences: newOccurrences },
        "Learning auto-approved after reaching threshold"
      );
    } else {
      // Ainda não atingiu threshold — só incrementar
      await tx
        .update(aiLearningsTable)
        .set({ occurrences: newOccurrences, updatedAt: new Date() })
        .where(eq(aiLearningsTable.id, existing.id));
    }
  });
}

// Verifica se o tenant ainda tem aprovações disponíveis esta semana
async function checkWeeklyLimit(tx: any, tenantId: number): Promise<boolean> {
  const startOfWeek = getStartOfWeek();
  const count = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(aiLearningsTable)
    .where(
      and(
        eq(aiLearningsTable.tenantId, tenantId),
        eq(aiLearningsTable.status, "approved"),
        eq(aiLearningsTable.approvedBy, "auto"),
        gte(aiLearningsTable.approvedAt, startOfWeek)
      )
    );
  return (count[0]?.count ?? 0) < WEEKLY_APPROVAL_LIMIT;
}

function getStartOfWeek(): Date {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}
```

### Passo 3 — Manter `getRelevantKnowledge()` e `getRelevantObjections()` sem alteração
Essas funções já leem apenas aprendizados com `status = "approved"`.
Não alterar nada nelas.

---

## MUDANÇA 2 — Controle de risco automático e conservador

### O que muda
Remover a tela de Controle de Risco do menu do dentista.
Tornar os limites anti-spam mais conservadores e fixos no código.
Mover as métricas para o painel admin.

### Passo 1 — Ajustar limites no `scheduler.ts`

```typescript
// ANTES:
const DAILY_LIMIT = 100;
// sleepRandom(4000, 15000)
// isWithinSendWindow: 08h–20h

// DEPOIS — valores mais conservadores:
const DAILY_LIMIT = 80; // máximo 80 mensagens automáticas por tenant/dia

// Aumentar delay entre envios em massa:
// sleepRandom(8000, 20000) — 8 a 20 segundos

// Janela de envio mais restrita:
// isWithinSendWindow: 08h–19h (não 20h)

// Espaçamento mínimo de 48h por número:
// Se número recebeu mensagem automática nas últimas 48h → pular
// Usar dailySendTracker expandido para 48h
```

Localizar cada uma dessas constantes/funções no `scheduler.ts` e
ajustar os valores. Não criar configuração nova — valores fixos no código.

### Passo 2 — Remover do menu do dentista
No `app-layout.tsx`, remover o item:
```typescript
// REMOVER esta linha:
{ path: "/risk-control", label: "Controle de Risco", icon: ShieldAlert },
```

### Passo 3 — Adicionar métricas no painel admin
No `admin.tsx` ou na página de admin existente, adicionar uma seção
"Monitoramento de Envios" com uma tabela simples mostrando:
- Tenant
- Mensagens automáticas enviadas hoje
- Mensagens automáticas nos últimos 7 dias
- Status (normal / próximo do limite / no limite)

Usar os dados que já existem em `dentalActivityTable`.
Não criar nova tabela — só nova view no admin.

---

## MUDANÇA 3 — Remover Aprendizado IA do menu do dentista

### O que muda
O dentista nunca vê a aba de Aprendizado IA.
O sistema continua funcionando nos bastidores (Mudança 1).
Você pode revisar no admin quando quiser.

### Passo 1 — Remover do menu do dentista
No `app-layout.tsx`, remover o item:
```typescript
// REMOVER esta linha:
{ path: "/admin/aprendizado", label: "Aprendizado da IA", icon: Brain },
```

### Passo 2 — Desabilitar feature em todos os planos
No `plan-features.ts`, marcar como false em todos os planos:
```typescript
// Em TODOS os planos (trial, basic, professional, clinic):
aiLearning: false,
riskControl: false,
```

### Passo 3 — Manter rotas mas sem link no menu
No `App.tsx`, NÃO deletar as rotas `/risk-control` e `/admin/aprendizado`.
Só remover do menu. As páginas continuam existindo caso precise acessar
diretamente pela URL.

### Passo 4 — Adicionar curadoria de aprendizados no painel admin
No painel admin (`/admin/panel`), adicionar seção "Aprendizados da IA"
com tabela simples:

```
Aprendizados Aprovados Automaticamente — Últimos 30 dias
┌──────────────┬────────────────────────────────┬──────────┬──────────┐
│ Tenant       │ Conhecimento aprendido         │ Ocorr.   │ Ação     │
├──────────────┼────────────────────────────────┼──────────┼──────────┤
│ Sorrizin     │ "Clareamento dura 2 sessões"   │ 2x       │ [Remover]│
│ Clínica X    │ "Aceitamos cheque"             │ 3x       │ [Remover]│
└──────────────┴────────────────────────────────┴──────────┴──────────┘

Candidatos Pendentes (ainda não aprovados)
┌──────────────┬────────────────────────────────┬──────────┬──────────┐
│ Tenant       │ Conhecimento candidato         │ Ocorr.   │ Ação     │
├──────────────┼────────────────────────────────┼──────────┼──────────┤
│ Sorrizin     │ "Consulta pode ser parcelada"  │ 1x       │ [Remover]│
└──────────────┴────────────────────────────────┴──────────┴──────────┘
```

Botão "Remover" em cada linha — remove o aprendizado do banco.
Sem botão de aprovação manual — tudo é automático.

---

## Resumo — o que o dentista vê depois dessas mudanças

```
MENU ANTES:                    MENU DEPOIS:
─────────────────────          ─────────────────────
Dashboard                      Dashboard
Conversas                      Conversas
Leads                          Leads
Pacientes                      Pacientes
Agendamentos                   Agendamentos
Profissionais                  Profissionais
Configurações                  Configurações
Aprendizado da IA  ← REMOVE    Financeiro
Controle de Risco  ← REMOVE    Conta
Financeiro
Conta
```

## Resumo — o que você vê no admin depois

```
ADMIN ANTES:                   ADMIN DEPOIS:
─────────────────────          ─────────────────────
Tenants                        Tenants
Créditos                       Créditos
LGPD                           LGPD
                               Aprendizados da IA  ← NOVO
                               Monitoramento Envios ← NOVO
```

---

## Ordem de execução

1. Ajustar `scheduler.ts` — limites anti-spam (Mudança 2, Passo 1)
2. Adicionar campo `occurrences` no schema + `pnpm db:push` (Mudança 1, Passo 1)
3. Modificar `ai-learning.ts` — lógica de aprovação automática (Mudança 1, Passo 2)
4. Remover itens do menu em `app-layout.tsx` (Mudanças 2 e 3)
5. Atualizar `plan-features.ts` (Mudança 3, Passo 2)
6. Adicionar seções no painel admin (Mudanças 2 e 3, Passos 3/4)
7. Rodar testes: `pnpm --filter @workspace/api-server run test`
8. Confirmar que menu do dentista não mostra mais as abas removidas
