# OdontoFlow — Secretária IA para Dentistas

## Overview

OdontoFlow (formerly DentalAI Secretary) is a multi-tenant SaaS web application designed as an AI-powered virtual secretary for dental clinics. It integrates with WhatsApp to manage appointments, track leads and patients, handle audio messages, and provide analytics. The project aims to enhance clinic efficiency, improve patient engagement, and streamline administrative tasks with advanced AI capabilities.

**Freemium model:** Two plan tiers — `free` (basic scheduling chatbot only) and `premium` (full AI capabilities). Free plan users see an upgrade banner in the sidebar. The AI engine gates SPIN Selling, strategy logging, and advanced features based on the tenant's `plan` column in the DB.

## 🔧 Pendência arquitetural prioritária — IA com geração restrita por ID de slot

> **Plano completo em `.local/tasks/ia-geracao-restrita-slot-id.md`** (Task #25 quando o sistema de tarefas foi usado nesta conta). Pegar daí ao retomar.

**Problema:** O fluxo atual deixa a IA gerar texto livre com datas/horas/preços/nomes de profissionais. Um validador reativo (`response-validator.ts`, ~780 LOC, 10+ tipos de violação) tenta pegar erros depois e refazer. Resultado: "whack-a-mole" infinito — cada bug novo (Bradesco em quinta, multi-prof confusão, PIX omitido, valor inventado, profissional fora da especialidade) vira mais uma regra no validador, e o modelo sempre encontra um jeito novo de violar.

**Solução definitiva:** Geração restrita por enum.
- Servidor pré-computa `slots[]` (já filtrados por convênio/expediente/especialidade) e `professionals[]` elegíveis com IDs estáveis (`s1, s2, ..., p1, p2, ...`) válidos por turno.
- Modelo recebe schema JSON com `action` (enum: `OFFER_SLOTS`, `CONFIRM_SLOT`, `SEND_PIX`, `SEND_FEE`, `ASK_INFO`, `ESCALATE`, `JUST_REPLY`), `slot_ids` (enum dinâmico), `professional_id` (enum dinâmico), `reply_text` (livre, mas sem fatos críticos).
- Servidor renderiza o texto final do WhatsApp determinísticamente. Modelo só contribui empatia/conversa.
- Resultado: dia/hora/profissional/preço inválidos ficam IMPOSSÍVEIS pela arquitetura, não por validação.
- Validador encolhe pra <100 LOC (rede de segurança fina, só termos proibidos).
- Suíte "golden" com cenários recorrentes bloqueia regressão.
- Feature flag `useConstrainedGeneration` por tenant pra rollout gradual.

**Arquivos centrais a refatorar:** `ai-engine.ts`, `schedule-engine.ts`, `prompt-builder.ts`, `prompt-helpers.ts`, `response-validator.ts`, `appointment-extractor.ts`. Plano detalha 9 passos.

**Prioridade:** Alta. Cada hot-fix novo nesse fluxo é desperdício de esforço — a próxima sessão de trabalho pesado deve atacar isso ao invés de mais uma regra de validação.

### ✅ Opção A já implementada (trava determinística parcial — out 2026)

Como passo intermediário barato antes do refator completo, foi adicionada uma trava de validação no caminho de criação de agendamento:

- `schedule-engine.ts` agora exporta `AvailableSlot = { date, time, professionalId }` e `getAvailabilityInfo` retorna `availableSlots: AvailableSlot[]` populado nos 3 fluxos (paciente single-prof, lead single-prof, multi-prof).
- `ai-engine.ts` propaga `availabilityResult.availableSlots` para `createAppointmentFromData` e `tryCreateAppointmentFromReply`.
- `appointment-extractor.ts` `_persistAppointment` valida (date, time, professionalId resolvido) contra `availableSlots`. Se não bater → log estruturado `violation: "appointment_no_matching_slot"` + retorna sem criar no banco.
- Quando `availableSlots` é `undefined` (intents não-scheduling), a trava desativa silenciosamente (compat retroativa).

**O que isso mata:** agendamentos fantasma, dia de convênio errado (ex: Bradesco em quinta), horário fora do expediente, profissional sem agenda no dia.
**O que NÃO mata:** confusão de profissional cuja agenda existe no dia mas não foi escolhido pela conversa, PIX omitido, fee inventado — esses continuam dependendo do validador reativo até o refator completo.

## User Preferences

- Prefers detailed explanations before major changes
- Wants to be asked before large refactors or destructive changes
- Likes an iterative development approach
- Prefers clear and concise communication in Portuguese (pt-BR)
- **NÃO está migrando para o Railway no momento** — não mencionar Railway auto-deploy até o usuário avisar

## System Architecture

The project is built as a pnpm monorepo using TypeScript, Node.js 24, and Express 5 for the API. The frontend is developed with React, Vite, Tailwind CSS 4, shadcn/ui, Recharts, and wouter, designed to be fully responsive across mobile, tablet, and desktop.

**Key Architectural Decisions:**

-   **Multi-tenancy:** Each dental clinic operates as an isolated tenant, with all entity tables including a `tenant_id` foreign key.
-   **Database:** PostgreSQL with Drizzle ORM is used for data persistence.
-   **API Design:** RESTful API using Express, with OpenAPI for specification and Orval for client/Zod schema generation.
-   **WhatsApp Integration:** Evolution API, abstracted behind a `WhatsappProvider` interface. Each tenant can have their own Evolution API URL/key stored encrypted in the DB, or fall back to global env vars.
-   **AI Engine:** Modular architecture powered by OpenAI via Replit AI Integration:
    -   `ai-engine.ts` — Slim orchestrator. Uses unified JSON schema (`UNIFIED_SCHEDULING_SCHEMA`) for scheduling/rescheduling intents, combining reply + appointment extraction into a single OpenAI call.
    -   `schedule-engine.ts` — Time utilities, slot generation, ProfessionalSchedule, availability functions.
    -   `urgency-handler.ts` — Urgency keyword detection, blocked period alerts.
    -   `intent-detector.ts` — Intent classification via regex (zero AI cost).
    -   `lead-engine.ts` — SALES_STRATEGIES (21 techniques), strategy selection/logging, lead temperature, remarketing.
    -   `prompt-builder.ts` — System prompt construction with all dental context + payment config + dental specialty sections.
    -   `appointment-extractor.ts` — Two paths: `createAppointmentFromData` (uses pre-extracted inline data) for scheduling; `tryCreateAppointmentFromReply` (second AI call) as fallback for "other" intent only.
    -   `ai-learning.ts` — Dental knowledge base queries: `getRelevantKnowledge()` + `getRelevantObjections()` (strict keyword gating, no prompt bloat for unrelated messages).
    -   `escalation.ts` — Scheduling refusal detection, escalation patterns, Telegram alerts.
    -   `conversation-summarizer.ts` — Generates and persists AI summaries of long conversations.
    -   `prompt-builder.ts` — Also injects `buildDentalSpecialtySection()` only when lead message contains a dental keyword.
-   **Audio Processing:** OpenAI Whisper for transcription and Eleven Labs for TTS. Credits managed via `dental_audio_credits` table.
-   **Payment Gateway:** AbacatePay for PIX purchases (audio credits, professional slots).
-   **LGPD Compliance:** Consent management, AES-256-GCM encryption at rest, audit logging, right-to-be-forgotten.
-   **Production deployment target (planned):** Railway (compute, both services via existing Dockerfiles) + Neon (Postgres) + Redis Cloud or Upstash (TLS Redis) + S3-compatible object storage (R2/B2/AWS) using the existing `lib/storage/s3.ts` adapter. Env contract: `.env.railway.example` at repo root. Step-by-step migration + rollback plan: `artifacts/api-server/RUNBOOK.md` ("Production deployment" section). Replit remains the dev/preview environment.
-   **Anti-spam (WhatsApp):** `scheduler.ts` has three layers of protection:
    1. `sleepRandom(4000–15000ms)` — random delay between each bulk send
    2. `isWithinSendWindow()` — only sends automated messages between 08h–20h
    3. `dailySendTracker` — max 1 automated message per phone number per day (resets at midnight)
-   **Tenant AI Rate Limiting & Circuit Breaker** (`lib/tenant-rate-limiter.ts`):
    - **Rate limit:** 30 AI calls/min per tenant (atomic check+record via Redis sorted set Lua script, in-memory fallback). Exceeding sends a friendly pt-BR fallback message without calling OpenAI.
    - **Circuit breaker:** If a tenant generates >10 AI errors in 1 min, all AI calls for that tenant are paused for 60s. WARN logged on open, INFO on close.
    - Redis keys: `rl:ai:zset:{tenantId}` (rate limit), `cb:errors:{tenantId}` + `cb:open:{tenantId}` (circuit breaker).
    - In-memory maps auto-evict stale entries every 5 min to prevent unbounded growth.
    - Integrated in both `ai-engine.ts` (processIncomingMessage) as single authority and `webhook.ts` (pre-check).
-   **Redis (optional in dev, REQUIRED in production for polling dedup):** Configured via `REDIS_URL` env var (managed via `lib/redis.ts` singleton with `initRedis()`/`closeRedis()`). When available, Redis backs:
    - `TenantCache` (settings/procedures/professionals) — `GET/SETEX/DEL` with native TTL
    - Webhook dedup (`dedup:webhook:{id}`) — `SET NX EX 120s`
    - Polling dedup (`dedup:polling:{id}`) — `SETEX 1h` — **REQUIRED in prod**: without Redis, polling skips all cycles in production (fail-safe)
    - Daily send tracker (`daily:{date}` Redis Set) — `SADD/SISMEMBER`, TTL 25h
    - Credit alert rate-limit (`alert:credits:{tenantId}`) — `SETEX 24h`
    - AI learning cooldown (`learning:{conversationId}`) — `SETEX 5min`
    - `openaiClientCache` and `_learningTimers` remain in-memory by design (not serializable / per-instance timers)
    - Fallback: if `REDIS_URL` is unset or connection fails, all caches gracefully degrade to in-memory
-   **Deep Health Check** (`lib/health-checker.ts` + `lib/health-alerts.ts`):
    - `GET /api/health/deep` — real ping on DB (`SELECT 1`), Redis (`PING`), Evolution API (`GET /instance/fetchInstances`), OpenAI (gpt-4o-mini, max_tokens=1). Each with 5s timeout. Runs checks in parallel.
    - Returns `{ status, db, redis, evolutionApi, openai, checkedAt }` with per-service `{ status, latencyMs, error? }`. HTTP 503 if DB or evolutionApi fail (critical); Redis and OpenAI are degraded-only (no 503).
    - Endpoint protected by ADMIN_API_KEY Bearer token auth.
    - Scheduler runs deep check every 2 min alongside WhatsApp connection check.
    - `health-alerts.ts`: in-memory state machine tracks ok/error per service. On state transition → broadcasts pt-BR Telegram alert to all tenants with Telegram configured. Debounce: 10 min per service (applies to all transitions to prevent flapping spam). Sends recovery alert on error→ok. Critical services: db, evolutionApi (🚨 CRÍTICO). Degraded: redis, openai (⚠️).

## Stack

-   **Monorepo tool**: pnpm workspaces
-   **Node.js version**: 24
-   **Package manager**: pnpm
-   **TypeScript version**: 5.9
-   **API framework**: Express 5
-   **Database**: PostgreSQL + Drizzle ORM
-   **Frontend**: React 19 + Vite + Tailwind CSS 4 + shadcn/ui + wouter
-   **Validation**: Zod, drizzle-zod
-   **AI**: OpenAI via Replit AI Integration — modelo principal `gpt-5.4-mini` (com prompt_cache_key + reasoning_effort), fallback `gpt-4.1-mini` (apenas em timeout/429/503/529), Whisper para transcrição, `gpt-5.4-mini` com visão para análise de comprovante PIX
-   **TTS**: Eleven Labs
-   **Payment**: AbacatePay (PIX)
-   **WhatsApp**: Evolution API (Baileys)

## Artifacts

-   `artifacts/api-server` — Express 5 backend API server (port 8080, path: `/api`)
-   `artifacts/dental-ai` — React + Vite frontend (port 18821, path: `/`)

> **Port note:** After multiple task agent merges the dental-ai port may jump to 18822. Restart the `artifacts/dental-ai: web` workflow to fix.

## Key Commands

-   `pnpm run typecheck` — full typecheck across all packages
-   `pnpm run build` — typecheck + build all packages
-   `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
-   `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
-   `pnpm --filter @workspace/api-server run dev` — run API server locally
-   `pnpm --filter @workspace/dental-ai run dev` — run frontend locally
-   `bash scripts/setup-git.sh` — restore GitHub remote with token after container restart

## Environment Variables Required

-   `JWT_SECRET` — JWT signing secret
-   `DATA_ENCRYPTION_KEY` — 64-char hex string for AES-256-GCM encryption
-   `ADMIN_API_KEY` — Admin API key (use `x-admin-key` header)
-   `DATABASE_URL` — PostgreSQL connection string (Replit managed)
-   `AI_INTEGRATIONS_OPENAI_API_KEY` — OpenAI via Replit AI Integration
-   `AI_INTEGRATIONS_OPENAI_BASE_URL` — OpenAI base URL via Replit AI Integration

## Optional Operational Variables

-   `REDIS_URL` — shared Redis for cluster-wide caches/dedup. Strongly recommended before any horizontal scaling. Without it, all caches degrade to per-instance in-memory.
-   `APP_INSTANCE_COUNT` — number of API server instances behind the load balancer (default `1`). When set to `>1` AND Redis is unavailable, `tenantExistsCache` reduces its local fallback TTL from 300 s to 30 s to bound clinic-deletion staleness. See `artifacts/api-server/RUNBOOK.md`.

## Optional External Integrations (user must configure)

-   `EVOLUTION_API_URL` + `EVOLUTION_API_KEY` — WhatsApp via Evolution API (global fallback; tenants can override per-tenant in DB)
-   `ABACATEPAY_API_KEY` — Payment gateway for PIX
-   `ELEVEN_LABS_API_KEY` — Text-to-Speech
-   `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` — Escalation alerts

## Tenant Production Data

-   **Tenant "Sorrizin"** (id: 1):
    -   Email: `jrsarinho@gmail.com`
    -   Evolution API URL: `https://n8n-evolution-api.mq6ww5.easypanel.host/`
    -   Evolution instance: `dental-1`
    -   WhatsApp: connected (`whatsapp_connected: true`)
    -   API key stored encrypted in DB (`evolution_api_key` column)

## GitHub

-   Repository (principal): `https://github.com/jrsarin2010-wq/ReplitRailway`
-   Token armazenado como secret `GITHUB_RAILWAY_TOKEN` (Personal Access Token classic, escopo `repo`)
-   Para enviar: rode o workflow "📤 Enviar para GitHub" ou execute `bash scripts/push-to-github.sh`
-   After a container restart, run `bash scripts/setup-git.sh` to restore the remote with the token
-   After task agent merges that push directly, run `git pull --rebase origin main && git push origin main` to sync

## Completed Features (all merged and pushed to GitHub)

| Task | Descrição |
|------|-----------|
| #10 | Parcelamento e boleto nas configurações de pagamento |
| #11 | Card Instagram com thumbnail 300×300 via Sharp no WhatsApp |
| #12 | Vídeo e áudio de boas-vindas automático para novos leads |
| #13 | Nova landing page redesenhada para tráfego pago |
| #14 | Correção do campo de salvamento na página de Recuperação |
| #15 | Base de conhecimento odontológico para IA (21 Q&A + 12 objeções) |
| #16 | Upload de foto de perfil do dentista (presigned URL + GCS) |
| #17 | Preço do plano atualizado para R$197 por 3 meses |
| #18 | Aviso discreto sobre limitações da IA em todas as telas relevantes |
| #19 | Seção "Plug & Play" na landing page (após o Hero) |
| #20 | Cobrança via PIX no WhatsApp — chave PIX por profissional, IA informa paciente, análise de comprovante via gpt-5.4-mini com visão, status no dashboard (pendente/confirmado IA/confirmado manual) |
| #21 | Notificações de assinatura via Telegram e e-mail — alertas 7d/3d/vencimento, suspensão e reativação automáticas |
| #22 | Ligações por IA via Vapi.ai — motor de chamadas outbound (hot leads, confirmação de consulta, recuperação de pacientes), webhook de retorno com transcrição e resumo, configuração por tenant, página de histórico no dashboard, ligação manual, scheduler a cada 30 min |
| #23 | Triagem plano/particular antes do SPIN — IA pergunta se atende particular ou convênio antes de aplicar técnica de venda (evita ofertar SPIN para paciente de convênio). **Refinamento empatia-primeiro:** na 1ª resposta, a IA pode acolher o paciente em uma frase curta antes (ou junto) com a pergunta plano/particular; da 2ª resposta em diante, a pergunta volta a ser obrigatória. Em CONVENIO_AGENDAR, a IA usa apenas horários reais da agenda e novos gatilhos mentais ("oportunidade", "não perca", "aproveite", "encaixe especial") foram bloqueados. |
| #24 | Tutor IA cobre pagamento, técnico e primeiros passos — três escopos com dados oficiais (planos, créditos, profissionais extras, PIX, troubleshooting), preços interpolados de CREDIT_PACKAGES (sem alucinação) |
| #25 | Tutor IA refatorado para fontes versionadas (.md) + changelog — base de conhecimento em `tutor-knowledge/`, loader cacheado, "o que mudou?" responde com changelog real |
| #26 | Proteção jurídica SaaS × dentista — três camadas: (1) trilha imutável de mensagens da IA com hash encadeado SHA-256 + endpoint admin de auditoria + exportação PDF assinada (HMAC-SHA-256 com `DATA_ENCRYPTION_KEY`); (2) Termo de Uso versionado com modal bloqueante de aceite no primeiro login (registra timestamp/IP/user-agent); (3) job diário (cron horário, default 18h fuso do tenant) que lista agendamentos do dia seguinte sem confirmação, alerta via Telegram + card no dashboard, com botão "Marcar como tratado" gravado em `dental_activity` |
| — | Proteções anti-spam para envio em massa de WhatsApp (scheduler.ts) |

## Mantendo o Tutor IA atualizado

A base de conhecimento do Tutor IA mora em **arquivos versionados** e é carregada na inicialização — nunca mais hardcodada inline em `support-chat.ts`.

**Arquivos:**
- `artifacts/api-server/src/routes/dental/tutor-knowledge/*.md` — seções do prompt (carregadas em ordem alfabética; a última deve ser `12-comportamento.md` com as instruções de comportamento).
- `artifacts/api-server/src/routes/dental/tutor-knowledge/tutor-changelog.md` — log de novidades. As 10 entradas mais recentes (topo do arquivo) são injetadas como bloco "NOVIDADES RECENTES" no system prompt e usadas pela IA quando o dentista pergunta "o que mudou?", "tem novidade?".
- `artifacts/api-server/src/lib/tutor-knowledge.ts` — loader (lê + substitui placeholders + cacheia). O `KNOWLEDGE_DIR` é resolvido no import (fail-fast se diretório faltar), mas o conteúdo é **lazy-loaded na primeira chamada de `getSystemPromptBase()`** e cacheado em memória pelo restante da vida do processo. Para invalidar manualmente em dev/teste, use `clearTutorKnowledgeCache()`.

**Placeholders disponíveis** dentro dos `.md`:
- `{{CREDIT_PACKAGES}}` — substituído em runtime pela lista oficial de pacotes de áudio (de `lib/abacatepay.ts`). Use isso em vez de listar preços manualmente.

**Fluxo recomendado a cada nova feature visível ao dentista:**
1. Atualize o `.md` da seção apropriada (procedimentos, agenda, pagamento, etc.) se mudou um menu/configuração.
2. Adicione **uma nova entrada no topo** de `tutor-changelog.md` no formato `## YYYY-MM-DD — Título curto` com 1-3 linhas explicando ao dentista o que ficou diferente.
3. Rode `pnpm --filter @workspace/api-server run tutor:check` (valida estrutura e conta entradas) e `pnpm --filter @workspace/api-server test` (mantém Invariante #8 verde).
4. O build (`build.mjs`) copia automaticamente `tutor-knowledge/` para `dist/` em produção.

**Anti-regressão:** os testes em `prompt-invariants.test.ts` (Invariante #8) e `tutor-knowledge.test.ts` garantem que os três escopos (PRIMEIROS PASSOS, PAGAMENTO E ASSINATURA, DÚVIDAS TÉCNICAS GERAIS) continuem presentes, que `{{CREDIT_PACKAGES}}` seja interpolado corretamente, e que preços antigos hallucinados (R$ 99,90 / R$ 199,90) não reapareçam.

## Tutorial: Configurando ligações Vapi (passo a passo PT-BR)

Use este passo a passo sempre que o usuário pedir como configurar/comprar um número Vapi para receber ligações no DentalAI.

**1. Criar conta Vapi (US$10 grátis para começar)**
- Acesse https://vapi.ai → "Sign Up" → confirme e-mail.

**2. Comprar número americano**
- Painel Vapi → **Phone Numbers** → **Buy Number** → "United States" → escolher DDD (ex: 415 = San Francisco).
- Custo: ~US$2/mês + ~US$0,03/min. Clique **Buy** (cobrado no cartão).

**3. Pegar a chave de API**
- Vapi → **API Keys** → **Create Key** → copiar.
- DentalAI → **Configurações → Ligações IA** → colar em "Chave API Vapi" → Salvar.

**4. Carregar o número no DentalAI**
- Mesma tela, role até **"Receber Ligações (Inbound)"** → **Carregar** → selecionar o número.
- Escolher voz (ou deixar "Usar a mesma voz do WhatsApp" ligado).
- Ativar switch **"Atendimento de chamadas recebidas"** → Salvar.

**5. Conectar o webhook na Vapi (passo crítico)**
- Copiar a URL do **Webhook** que aparece no card inbound do DentalAI.
- Vapi → **Phone Numbers** → clicar no número → **Server URL** → colar → Save.

**6. Testar**
- DentalAI → **"Testar configuração inbound"** (valida que o ID do número está correto).
- Ligar do celular para o número americano → IA atende em PT-BR.
- Ligação aparece em **Ligações** com badge azul "Recebida".

**Dicas adicionais:**
- Paciente paga ligação internacional → divulgar via WhatsApp/Instagram com botão "clique para ligar" para evitar custo ao paciente.
- Toda ligação recebida cria lead automático (`source: "inbound_call"`) ou vincula a paciente existente pelo telefone (match por últimos 9 dígitos).
- Se quiser usar assistente próprio da Vapi, colar o ID em "ID do Assistente Vapi para inbound" — sobrescreve o template padrão do DentalAI.
- Variável de ambiente opcional `VAPI_WEBHOOK_SECRET` ativa validação de header `x-vapi-secret` no webhook.

## Known Issues / Notes

-   **TypeScript erros pré-existentes** em `appointment-extractor.ts` (welcomeVideoUrl), `prompt-builder.ts` (acceptsInstallments), e `routes/storage.ts` (RequestUploadUrlBody) — são de tasks mescladas que ainda aguardam schema regeneration. O servidor roda normalmente pois usa esbuild (sem checagem de tipos em produção).
-   **express-rate-limit warning** (`ERR_ERL_KEY_GEN_IPV6`) — não crítico, fixado com `keyGeneratorIpFallback: false`.
-   **Admin middleware** usa header `x-admin-key` (não `x-admin-api-key`).
-   **Tenant table columns** usam snake_case: `evolution_api_url`, `evolution_api_key`, `evolution_instance_name`, `whatsapp_connected`.
-   **Welcome video/audio** — configurável por profissional em Configurações → aba Profissionais (scroll para baixo); enviado automaticamente quando lead confirma primeira consulta.
-   **21 Técnicas de Venda da IA** — SPIN (4) + Future Pacing, Storytelling, Price Anchoring, Loss Aversion, Micro Commitment, Authority Positioning, Educational Trust, Social Proof, Scarcity, Urgency, Pain Agitation, Consultative, Benefit Focused, Gentle Follow-up, Reactivation, Comparison Cost, Reciprocity — auto-selecionadas por temperatura do lead + intenção.

## Pendências Conhecidas

-   **Task #10 — Detecção de token entre abas (parcialmente implementado):** O listener `window.storage` está ativo e detecta corretamente a mudança de `authToken` em outra aba, exibindo um toast antes de recarregar. Porém há um dilema técnico não resolvido: chamar `clearAuthToken()` no handler remove o token do `localStorage` compartilhado, deslogando também a aba que acabou de fazer login. A solução correta exige invalidar apenas a aba afetada sem tocar no localStorage — provavelmente via `sessionStorage` + rota de redirecionamento interno (sem `window.location.reload()`). Resolver quando houver contexto/tempo para validar o fluxo completo multi-aba.
