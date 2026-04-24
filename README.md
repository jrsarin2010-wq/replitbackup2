# OdontoFlow — Secretária IA para Clínicas Odontológicas

Plataforma SaaS multi-tenant com assistente de IA para WhatsApp, agendamento inteligente, CRM de leads com SPIN Selling, mensagens automáticas (lembrete, confirmação, pós-consulta), áudio via ElevenLabs e integração com AbacatePay.

## Arquitetura

Monorepo gerenciado com **pnpm workspaces**:

| Pacote | Descrição |
|--------|-----------|
| `artifacts/api-server` | API REST + lógica de IA (Express, Drizzle ORM) |
| `artifacts/dental-ai` | Painel web do operador (React + Vite + shadcn/ui) |
| `lib/db` | Schema Drizzle + cliente PostgreSQL compartilhado |
| `scripts` | Migrações e seeds |

## Pré-requisitos

- **Node.js** 20+
- **pnpm** 9+ (`npm install -g pnpm`)
- **PostgreSQL** 14+

## Instalação

```bash
# 1. Clone o repositório
git clone https://github.com/jrsarinho/dental-ai-secretary.git
cd dental-ai-secretary

# 2. Instale as dependências
pnpm install

# 3. Configure as variáveis de ambiente
cp .env.example .env
# Edite o .env com seus valores (veja a seção abaixo)

# 4. Aplique o schema no banco
pnpm db:push
# Ou, para forçar sem confirmação interativa:
# pnpm db:push:force
```

## Variáveis de Ambiente

Copie `.env.example` para `.env` e preencha:

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `DATABASE_URL` | Sim | PostgreSQL connection string |
| `JWT_SECRET` | Sim | Segredo para tokens JWT |
| `DATA_ENCRYPTION_KEY` | Sim | Chave AES-256 (64 hex chars — 32 bytes) para criptografia de dados sensíveis |
| `ADMIN_API_KEY` | Sim | Chave de autenticação do painel admin |
| `EVOLUTION_API_URL` | Sim | URL da instância Evolution API (WhatsApp) |
| `EVOLUTION_API_KEY` | Sim | Chave da Evolution API |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | Sim | Chave OpenAI validada no boot — no Replit é provida pela integração automática |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | Sim | URL base da API OpenAI (padrão: `https://api.openai.com/v1`) |
| `OPENAI_API_KEY` | Não | Alias de referência OpenAI padrão — o app usa as vars `AI_INTEGRATIONS_*` acima |
| `WEBHOOK_SECRET` | Sim | Segredo para validar webhooks |
| `WEBHOOK_BASE_URL` | Sim | URL pública base para receber webhooks (sem barra final) |
| `ABACATEPAY_API_KEY` | Não | Integração de pagamentos AbacatePay |
| `ELEVENLABS_API_KEY` | Não | TTS global via ElevenLabs |
| `SMTP_HOST` | Não | Servidor SMTP para notificações por e-mail |
| `SMTP_PORT` | Não | Porta SMTP (padrão: 587) |
| `SMTP_USER` | Não | Usuário SMTP |
| `SMTP_PASS` | Não | Senha SMTP |
| `SMTP_FROM` | Não | Endereço de remetente nos e-mails |
| `NODE_ENV` | Não | `development` ou `production` (padrão: `development`) |
| `LOG_LEVEL` | Não | `trace` / `debug` / `info` / `warn` / `error` (padrão: `info`) |
| `REPLIT_DEV_DOMAIN` | Não | Preenchido automaticamente pelo Replit; irrelevante fora dele |

## Rodando em Desenvolvimento

Cada serviço roda em um terminal separado:

```bash
# API Server (porta definida por $PORT, padrão 8080)
pnpm --filter @workspace/api-server run dev

# Painel web (porta definida por $PORT, padrão 5173)
pnpm --filter @workspace/dental-ai run dev
```

## Rodando com Docker (fora do Replit)

A maneira mais simples de rodar o projeto em qualquer ambiente:

```bash
# 1. Configure as variáveis de ambiente
cp .env.example .env
# Edite o .env com seus valores reais

# 2. Suba todos os serviços (PostgreSQL + API + Web)
docker compose up --build

# Serviços disponíveis:
#   API:      http://localhost:8080
#   Painel:   http://localhost:3000
#   Postgres: localhost:5432
```

Para rodar apenas o banco de dados (útil no desenvolvimento local):

```bash
docker compose up postgres -d
```

## Build para Produção

```bash
pnpm run build
```

O `api-server` gera um bundle em `artifacts/api-server/dist/index.mjs`.  
O `dental-ai` gera os estáticos em `artifacts/dental-ai/dist/`.

## Banco de Dados

O schema completo está em `lib/db/src/schema/`. Para sincronizar após alterações:

```bash
pnpm db:push         # interativo — confirma antes de aplicar
pnpm db:push:force   # sem confirmação (usado no post-merge automático)
```

## Estrutura de Diretórios

```
.
├── artifacts/
│   ├── api-server/          # API + IA (Express, Drizzle)
│   │   └── Dockerfile       # Build de produção da API
│   └── dental-ai/           # Painel web (React + Vite)
│       ├── Dockerfile        # Build de produção do frontend (Nginx)
│       └── nginx.conf        # Configuração do Nginx para SPA
├── lib/
│   └── db/                  # Schema Drizzle + cliente pg
├── scripts/                 # Migrações e seeds
├── .github/
│   └── workflows/
│       └── ci.yml           # CI: build + typecheck a cada push
├── docker-compose.yml       # Stack completa para rodar fora do Replit
├── .env.example             # Template de variáveis de ambiente
└── pnpm-workspace.yaml      # Configuração do monorepo
```

## Arquivos específicos do Replit

Os arquivos `.replit` e `artifacts/*/.replit-artifact/artifact.toml` são configurações do ambiente Replit (workflows, roteamento de portas). Podem ser ignorados em outros ambientes de desenvolvimento — não afetam a lógica da aplicação.

## Scripts Auxiliares

| Script | Descrição |
|--------|-----------|
| `scripts/setup-git.sh` | Reconfigura o remote `origin` com autenticação GitHub — use após reiniciar o container. **Atenção:** escreve o PAT em `.git/config` (texto claro); use apenas em ambientes de desenvolvimento confiáveis e nunca compartilhe o `.git/config`. |
| `scripts/post-merge.sh` | Executado automaticamente após merges de tasks (migrações + seeds) |
