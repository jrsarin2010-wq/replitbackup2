-- Task #15 / replit.md #26 — Proteção jurídica SaaS × dentista.
-- Idempotente: tudo usa IF NOT EXISTS para tolerar bancos onde o schema já
-- foi aplicado via db:push direto (ambiente Replit).

-- 1) Trilha imutável de mensagens da IA — colunas em dental_messages.
ALTER TABLE "dental_messages" ADD COLUMN IF NOT EXISTS "hash" varchar(64);
--> statement-breakpoint
ALTER TABLE "dental_messages" ADD COLUMN IF NOT EXISTS "prev_hash" varchar(64);
--> statement-breakpoint
ALTER TABLE "dental_messages" ADD COLUMN IF NOT EXISTS "ai_model" varchar(100);
--> statement-breakpoint
ALTER TABLE "dental_messages" ADD COLUMN IF NOT EXISTS "prompt_version" varchar(50);
--> statement-breakpoint
ALTER TABLE "dental_messages" ADD COLUMN IF NOT EXISTS "server_ts" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dental_messages_hash" ON "dental_messages" ("hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dental_messages_conv_sent" ON "dental_messages" ("conversation_id", "sent_at");
--> statement-breakpoint

-- 2) Termo de uso versionado.
CREATE TABLE IF NOT EXISTS "tos_versions" (
  "id" serial PRIMARY KEY NOT NULL,
  "version" varchar(20) NOT NULL,
  "title" varchar(255) NOT NULL,
  "content" text NOT NULL,
  "active" boolean DEFAULT false NOT NULL,
  "published_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tos_versions_version_unique" UNIQUE ("version")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tos_acceptances" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "tos_version_id" integer NOT NULL,
  "version_label" varchar(20) NOT NULL,
  "accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ip_address" varchar(64),
  "user_agent" text
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tos_acceptances" ADD CONSTRAINT "tos_acceptances_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tos_acceptances" ADD CONSTRAINT "tos_acceptances_tos_version_id_tos_versions_id_fk"
    FOREIGN KEY ("tos_version_id") REFERENCES "tos_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_tos_acceptance_tenant_version"
  ON "tos_acceptances" ("tenant_id", "tos_version_id");
--> statement-breakpoint

-- 3) Alerta diário de agendamentos não confirmados — colunas em dental_settings.
ALTER TABLE "dental_settings" ADD COLUMN IF NOT EXISTS "unconfirmed_alert_enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "dental_settings" ADD COLUMN IF NOT EXISTS "unconfirmed_alert_hour" integer DEFAULT 18 NOT NULL;
--> statement-breakpoint
ALTER TABLE "dental_settings" ADD COLUMN IF NOT EXISTS "tenant_tz_offset_hours" integer DEFAULT -3 NOT NULL;
--> statement-breakpoint

-- 4) Seed da versão inicial do TOS — idempotente.
-- Sem uma versão ativa, o gate seria fail-open e nada seria exigido na primeira
-- subida em produção. Inserimos a v1.0 marcada como active=true.
INSERT INTO "tos_versions" ("version", "title", "content", "active", "published_at")
VALUES (
  '1.0',
  'Termo de Uso da Plataforma OdontoFlow / DentalAI — v1.0',
  E'TERMO DE USO E LIMITAÇÃO DE RESPONSABILIDADE — OdontoFlow / DentalAI\n\nVersão 1.0 — vigente.\n\n1. Objeto. Esta plataforma fornece automação de atendimento via IA para consultórios odontológicos. O contratante (dentista, clínica ou responsável legal) é o controlador dos dados de seus pacientes nos termos da LGPD; a plataforma atua como operadora.\n\n2. Natureza da automação. As respostas geradas pela IA são sugestões automatizadas e podem conter erros, omissões ou interpretações incorretas. O contratante é o único responsável clínico e contratual perante seus pacientes pelo conteúdo enviado em seu nome através do canal de WhatsApp e demais canais integrados.\n\n3. Revisão diária obrigatória. O contratante compromete-se a revisar diariamente o painel da plataforma, em especial o card "Agendamentos não confirmados" e os alertas enviados via Telegram, agindo de forma tempestiva sobre confirmações, cancelamentos e remarcações.\n\n4. Trilha imutável de auditoria. Toda mensagem trocada pela IA é registrada em uma cadeia de hashes encadeados (SHA-256) com carimbo de tempo do servidor, modelo de IA e versão de prompt. O contratante autoriza a plataforma a preservar, exibir ao próprio contratante e utilizar essa trilha em sua defesa em eventuais disputas judiciais ou administrativas iniciadas pelo paciente final.\n\n5. Limitação de responsabilidade. A plataforma não responde por: (i) decisões clínicas tomadas com base nas mensagens da IA; (ii) atrasos, indisponibilidades ou falhas de provedores de terceiros (WhatsApp, OpenAI, Telegram, gateways de pagamento); (iii) danos indiretos, lucros cessantes ou perda de chance. Em qualquer hipótese, a responsabilidade total agregada da plataforma fica limitada ao valor pago pelo contratante nos 3 (três) meses anteriores ao evento.\n\n6. Conformidade. O contratante declara possuir base legal para tratar os dados pessoais dos pacientes que insere ou que sejam coletados pela IA, em conformidade com a LGPD e o Código de Ética Odontológica.\n\n7. Aceitação. O uso da plataforma após o aceite deste termo constitui anuência integral. Versões futuras podem exigir novo aceite, bloqueando o acesso até a confirmação.\n\nAo clicar em "Li e concordo" você declara ter lido, compreendido e aceitado integralmente este termo.',
  true,
  now()
)
ON CONFLICT ("version") DO NOTHING;

