CREATE INDEX IF NOT EXISTS idx_appointments_tenant_starts ON appointments (tenant_id, starts_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_status ON appointments (tenant_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_created ON appointments (tenant_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dental_leads_tenant_status ON dental_leads (tenant_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dental_leads_tenant_created ON dental_leads (tenant_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dental_leads_tenant_phone ON dental_leads (tenant_id, phone);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dental_conversations_tenant ON dental_conversations (tenant_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dental_conversations_tenant_status ON dental_conversations (tenant_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dental_conversations_tenant_updated ON dental_conversations (tenant_id, updated_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dental_activity_tenant_created ON dental_activity (tenant_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dental_activity_tenant_type ON dental_activity (tenant_id, type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_patients_tenant ON patients (tenant_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_patients_tenant_phone ON patients (tenant_id, phone);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dental_messages_conversation ON dental_messages (conversation_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_appointment_followups_tenant_status ON appointment_follow_ups (tenant_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_appointment_followups_scheduled ON appointment_follow_ups (scheduled_at, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_call_logs_tenant ON call_logs (tenant_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_call_logs_tenant_created ON call_logs (tenant_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_call_logs_vapi_call_id ON call_logs (vapi_call_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_call_logs_phone ON call_logs (tenant_id, phone);
