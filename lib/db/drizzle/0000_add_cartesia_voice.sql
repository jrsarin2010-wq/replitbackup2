CREATE TABLE "password_reset_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" serial NOT NULL,
	"token" varchar(100) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"email" varchar(255),
	"password_hash" text,
	"plan" varchar(50) DEFAULT 'trial' NOT NULL,
	"subscription_status" varchar(30) DEFAULT 'active' NOT NULL,
	"subscribed_at" timestamp with time zone,
	"subscription_expires_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"evolution_api_url" text,
	"evolution_api_key" text,
	"evolution_instance_name" text,
	"eleven_labs_api_key" text,
	"openai_api_key" text,
	"whatsapp_connected" text DEFAULT 'false' NOT NULL,
	"cro" varchar(20),
	"max_professionals" integer DEFAULT 1 NOT NULL,
	"trial_expiry_notification_sent" boolean DEFAULT false NOT NULL,
	"subscription_notif_7day_sent" boolean DEFAULT false NOT NULL,
	"subscription_notif_3day_sent" boolean DEFAULT false NOT NULL,
	"subscription_notif_due_day_sent" boolean DEFAULT false NOT NULL,
	"subscription_notif_suspended_sent" boolean DEFAULT false NOT NULL,
	"trial_notif_7day_sent" boolean DEFAULT false NOT NULL,
	"trial_notif_1day_sent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tenants_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"phone" varchar(50) NOT NULL,
	"email" varchar(255),
	"birth_date" varchar(20),
	"cpf" varchar(255),
	"address" text,
	"notes" text,
	"profile_pic_url" text,
	"first_visit" timestamp with time zone,
	"last_visit" timestamp with time zone,
	"total_spent" varchar(20) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dental_procedures" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"price" varchar(20) DEFAULT '0' NOT NULL,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"active" text DEFAULT 'true' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"patient_id" integer,
	"lead_id" integer,
	"procedure_id" integer,
	"professional_id" integer,
	"procedure_name" varchar(255),
	"status" varchar(50) DEFAULT 'scheduled' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"price" varchar(20),
	"notes" text,
	"pix_payment_status" varchar(20) DEFAULT 'none' NOT NULL,
	"reminder_sent" text DEFAULT 'false' NOT NULL,
	"confirmation_sent" text DEFAULT 'false' NOT NULL,
	"confirmed" text DEFAULT 'false' NOT NULL,
	"follow_up_sent" text DEFAULT 'false' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointment_follow_ups" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"appointment_id" integer NOT NULL,
	"type" varchar(50) NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dental_leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"phone" varchar(50) NOT NULL,
	"email" varchar(255),
	"temperature" varchar(20) DEFAULT 'cold' NOT NULL,
	"source" varchar(100),
	"interest" text,
	"notes" text,
	"profile_pic_url" text,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"professional_id" integer,
	"converted_to_patient_id" integer,
	"converted_at" timestamp with time zone,
	"last_contact_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dental_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"contact_phone" varchar(50) NOT NULL,
	"contact_name" varchar(255),
	"contact_profile_pic_url" text,
	"contact_type" varchar(20) DEFAULT 'unknown' NOT NULL,
	"patient_id" integer,
	"lead_id" integer,
	"status" varchar(50) DEFAULT 'open' NOT NULL,
	"sentiment" varchar(20) DEFAULT 'neutral',
	"sentiment_score" integer DEFAULT 0,
	"escalated_at" timestamp with time zone,
	"escalation_reason" varchar(50),
	"human_takeover_at" timestamp with time zone,
	"human_takeover_expires_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"last_message_preview" text,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"ai_summary" text,
	"ai_summary_message_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dental_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"conversation_id" integer NOT NULL,
	"direction" varchar(10) NOT NULL,
	"type" varchar(20) DEFAULT 'text' NOT NULL,
	"content" text,
	"audio_url" text,
	"audio_transcript" text,
	"external_id" varchar(255),
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dental_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"clinic_name" varchar(255),
	"clinic_phone" varchar(50),
	"clinic_address" text,
	"professional_name" varchar(255),
	"professional_cro" varchar(20),
	"professional_specialties" text,
	"specialties" text,
	"working_hours_start" varchar(5) DEFAULT '08:00' NOT NULL,
	"working_hours_end" varchar(5) DEFAULT '18:00' NOT NULL,
	"working_days" text DEFAULT '1,2,3,4,5' NOT NULL,
	"slot_duration_minutes" integer DEFAULT 30 NOT NULL,
	"default_lead_duration_minutes" integer DEFAULT 15 NOT NULL,
	"default_patient_duration_minutes" integer DEFAULT 30 NOT NULL,
	"charges_consultation" boolean DEFAULT true NOT NULL,
	"consultation_fee" varchar(20) DEFAULT '150.00' NOT NULL,
	"auto_confirm_appointments" boolean DEFAULT true NOT NULL,
	"confirm_days_before" integer DEFAULT 1 NOT NULL,
	"accepts_insurance" boolean DEFAULT false NOT NULL,
	"insurance_plans" text,
	"insurance_days" text,
	"insurance_hours_start" varchar(5),
	"insurance_hours_end" varchar(5),
	"lunch_start" varchar(5) DEFAULT '12:00' NOT NULL,
	"lunch_end" varchar(5) DEFAULT '13:00' NOT NULL,
	"schedule_config" text,
	"ai_name" varchar(100) DEFAULT 'Secretária IA' NOT NULL,
	"ai_personality" text,
	"personality_type" varchar(20),
	"ai_language" varchar(10) DEFAULT 'pt-BR' NOT NULL,
	"reminder_hours_before" integer DEFAULT 24 NOT NULL,
	"remarketing_enabled" boolean DEFAULT true NOT NULL,
	"remarketing_hours" varchar(20) DEFAULT '10,15' NOT NULL,
	"remarketing_days" varchar(20) DEFAULT '1,2,3,4,5,6' NOT NULL,
	"remarketing_max_leads" integer DEFAULT 10 NOT NULL,
	"remarketing_interval_hot" integer DEFAULT 2 NOT NULL,
	"remarketing_interval_warm" integer DEFAULT 4 NOT NULL,
	"remarketing_interval_cold" integer DEFAULT 7 NOT NULL,
	"follow_up_reminder" boolean DEFAULT true NOT NULL,
	"follow_up_confirmation" boolean DEFAULT true NOT NULL,
	"follow_up_post_appointment" boolean DEFAULT true NOT NULL,
	"post_appointment_hours_after" integer DEFAULT 1 NOT NULL,
	"follow_up_reminder_template" text,
	"follow_up_confirmation_template" text,
	"follow_up_post_appointment_template" text,
	"remarketing_instructions_hot" text,
	"remarketing_instructions_warm" text,
	"remarketing_instructions_cold" text,
	"human_takeover_minutes" integer DEFAULT 5 NOT NULL,
	"telegram_bot_token" text,
	"telegram_chat_id" varchar(100),
	"telegram_escalation_enabled" boolean DEFAULT false NOT NULL,
	"no_show_enabled" boolean DEFAULT false NOT NULL,
	"no_show_patient_contact_hours_after" integer DEFAULT 24 NOT NULL,
	"no_show_patient_message" text,
	"birthday_enabled" boolean DEFAULT false NOT NULL,
	"birthday_hour" integer DEFAULT 9 NOT NULL,
	"birthday_message" text,
	"audio_mode" varchar(30) DEFAULT 'off' NOT NULL,
	"tts_provider" varchar(30) DEFAULT 'cartesia' NOT NULL,
	"eleven_labs_voice_id" varchar(100),
	"cartesia_voice_id" varchar(100),
	"recovery_enabled" boolean DEFAULT false NOT NULL,
	"recovery_inactivity_days" integer DEFAULT 60 NOT NULL,
	"recovery_no_show_days" integer DEFAULT 14 NOT NULL,
	"recovery_ai_instructions" text,
	"recovery_hours" varchar(20) DEFAULT '10,15' NOT NULL,
	"recovery_days" varchar(20) DEFAULT '1,2,3,4,5,6' NOT NULL,
	"recovery_max_per_run" integer DEFAULT 10 NOT NULL,
	"accepts_installments" boolean,
	"max_installments" integer,
	"accepts_boleto" boolean,
	"payment_notes" text,
	"vapi_api_key" text,
	"vapi_phone_number_id" varchar(200),
	"vapi_assistant_id" varchar(200),
	"calls_enabled" boolean DEFAULT false NOT NULL,
	"call_window_start" varchar(5) DEFAULT '09:00' NOT NULL,
	"call_window_end" varchar(5) DEFAULT '19:00' NOT NULL,
	"call_trigger_hot_lead" boolean DEFAULT false NOT NULL,
	"call_trigger_confirmation" boolean DEFAULT false NOT NULL,
	"call_trigger_recovery" boolean DEFAULT false NOT NULL,
	"call_max_per_day" integer DEFAULT 5 NOT NULL,
	"call_interval_hours_after_whatsapp" integer DEFAULT 4 NOT NULL,
	"automations_paused" boolean DEFAULT false NOT NULL,
	"remarketing_paused" boolean DEFAULT false NOT NULL,
	"followup_paused" boolean DEFAULT false NOT NULL,
	"birthday_paused" boolean DEFAULT false NOT NULL,
	"recovery_paused" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dental_settings_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "dental_activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"type" varchar(100) NOT NULL,
	"description" text NOT NULL,
	"entity_type" varchar(50),
	"entity_id" integer,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audio_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"conversation_id" integer,
	"direction" varchar(10) NOT NULL,
	"audio_url" text,
	"audio_data" text,
	"mime_type" varchar(50),
	"duration_seconds" integer,
	"transcript" text,
	"transcription_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_treatments" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"description" varchar(500) NOT NULL,
	"procedures" text DEFAULT '[]' NOT NULL,
	"total_value" numeric(10, 2) DEFAULT '0' NOT NULL,
	"paid_value" numeric(10, 2) DEFAULT '0' NOT NULL,
	"payment_method" varchar(50),
	"status" varchar(30) DEFAULT 'in_progress' NOT NULL,
	"notes" text,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"description" varchar(500) NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"category" varchar(50) DEFAULT 'outros' NOT NULL,
	"date" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dental_audio_credits" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"monthly_chars_used" integer DEFAULT 0 NOT NULL,
	"monthly_reset_date" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dental_audio_credits_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "dental_credit_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"package_id" varchar(50) NOT NULL,
	"chars" integer NOT NULL,
	"price_in_cents" integer NOT NULL,
	"billing_id" varchar(255),
	"payment_url" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "dental_credit_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"type" varchar(20) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "professional_slot_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"price_in_cents" integer NOT NULL,
	"billing_id" varchar(255),
	"payment_url" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_contact_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"contact_phone" varchar(50) NOT NULL,
	"memory_type" varchar(50) NOT NULL,
	"content" text NOT NULL,
	"source" varchar(20) DEFAULT 'auto' NOT NULL,
	"conversation_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_objection_patterns" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"category" varchar(50) NOT NULL,
	"objection" text NOT NULL,
	"counter_argument" text,
	"success_count" integer DEFAULT 0 NOT NULL,
	"total_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_knowledge_base" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"category" varchar(100) DEFAULT 'geral' NOT NULL,
	"frequency" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_strategy_analytics" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"strategy" varchar(50) NOT NULL,
	"lead_temperature" varchar(20),
	"procedure_interest" varchar(255),
	"converted" boolean DEFAULT false NOT NULL,
	"conversation_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dental_professionals" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"specialty" varchar(255),
	"specialties" text,
	"cro" varchar(50),
	"working_days" text DEFAULT '1,2,3,4,5' NOT NULL,
	"working_hours_start" varchar(5) DEFAULT '08:00' NOT NULL,
	"working_hours_end" varchar(5) DEFAULT '18:00' NOT NULL,
	"lunch_start" varchar(5) DEFAULT '12:00' NOT NULL,
	"lunch_end" varchar(5) DEFAULT '13:00' NOT NULL,
	"slot_duration_minutes" integer DEFAULT 30 NOT NULL,
	"accepts_insurance" boolean DEFAULT false NOT NULL,
	"consultation_fee" varchar(20),
	"charges_consultation" boolean DEFAULT true NOT NULL,
	"default_lead_duration_minutes" integer DEFAULT 30 NOT NULL,
	"default_patient_duration_minutes" integer DEFAULT 30 NOT NULL,
	"insurance_plans" text,
	"insurance_days" text,
	"insurance_hours_start" varchar(5),
	"insurance_hours_end" varchar(5),
	"instagram_url" varchar(500),
	"profile_photo_url" varchar(500),
	"welcome_video_url" varchar(1000),
	"welcome_audio_url" varchar(1000),
	"pix_key" varchar(255),
	"pix_enabled" boolean DEFAULT false NOT NULL,
	"pix_mode" varchar(20) DEFAULT 'optional' NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dental_blocked_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"title" varchar(255) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"public_message" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutor_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"type" text NOT NULL,
	"content" text NOT NULL,
	"original_message" text NOT NULL,
	"status" text DEFAULT 'nova' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutor_chat_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tutor_chat_sessions_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"entity_type" varchar(20) NOT NULL,
	"entity_id" integer NOT NULL,
	"consent_type" varchar(50) NOT NULL,
	"terms_version" varchar(20) DEFAULT '1.0' NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "data_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"action" varchar(20) NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" integer,
	"field" varchar(100),
	"user_id" integer,
	"ip_address" varchar(45),
	"user_agent" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dental_waitlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"contact_phone" varchar(50) NOT NULL,
	"contact_name" varchar(255),
	"professional_id" integer,
	"patient_id" integer,
	"lead_id" integer,
	"preferred_date" date,
	"preferred_time_slot" varchar(30),
	"preferred_time_of_day" varchar(20) DEFAULT 'any' NOT NULL,
	"notes" text,
	"notified_at" timestamp with time zone,
	"notification_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"lead_id" integer,
	"patient_id" integer,
	"vapi_call_id" varchar(200),
	"phone" varchar(50) NOT NULL,
	"direction" varchar(20) DEFAULT 'outbound' NOT NULL,
	"status" varchar(50) DEFAULT 'initiated' NOT NULL,
	"trigger" varchar(50),
	"duration" integer,
	"transcript" text,
	"summary" text,
	"outcome" varchar(50),
	"answered_by_human" boolean,
	"ended_reason" varchar(100),
	"cost" varchar(20),
	"recording_url" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"whatsapp" varchar(50) NOT NULL,
	"origem" varchar(100) DEFAULT 'landing_free_plan' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dental_procedures" ADD CONSTRAINT "dental_procedures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_lead_id_dental_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."dental_leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_procedure_id_dental_procedures_id_fk" FOREIGN KEY ("procedure_id") REFERENCES "public"."dental_procedures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_professional_id_dental_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."dental_professionals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_follow_ups" ADD CONSTRAINT "appointment_follow_ups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_follow_ups" ADD CONSTRAINT "appointment_follow_ups_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dental_leads" ADD CONSTRAINT "dental_leads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dental_leads" ADD CONSTRAINT "dental_leads_professional_id_dental_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."dental_professionals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dental_conversations" ADD CONSTRAINT "dental_conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dental_messages" ADD CONSTRAINT "dental_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dental_messages" ADD CONSTRAINT "dental_messages_conversation_id_dental_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."dental_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dental_settings" ADD CONSTRAINT "dental_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dental_activity" ADD CONSTRAINT "dental_activity_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_messages" ADD CONSTRAINT "audio_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_messages" ADD CONSTRAINT "audio_messages_conversation_id_dental_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."dental_conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_treatments" ADD CONSTRAINT "patient_treatments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_treatments" ADD CONSTRAINT "patient_treatments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dental_audio_credits" ADD CONSTRAINT "dental_audio_credits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dental_credit_orders" ADD CONSTRAINT "dental_credit_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dental_credit_transactions" ADD CONSTRAINT "dental_credit_transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_slot_orders" ADD CONSTRAINT "professional_slot_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_contact_memory" ADD CONSTRAINT "ai_contact_memory_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_objection_patterns" ADD CONSTRAINT "ai_objection_patterns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_knowledge_base" ADD CONSTRAINT "ai_knowledge_base_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_strategy_analytics" ADD CONSTRAINT "ai_strategy_analytics_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dental_professionals" ADD CONSTRAINT "dental_professionals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dental_blocked_periods" ADD CONSTRAINT "dental_blocked_periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_feedback" ADD CONSTRAINT "tutor_feedback_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_chat_sessions" ADD CONSTRAINT "tutor_chat_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_audit_log" ADD CONSTRAINT "data_audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dental_waitlist" ADD CONSTRAINT "dental_waitlist_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dental_waitlist" ADD CONSTRAINT "dental_waitlist_professional_id_dental_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."dental_professionals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_lead_id_dental_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."dental_leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE set null ON UPDATE no action;