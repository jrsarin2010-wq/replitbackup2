CREATE TABLE IF NOT EXISTS consent_records (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id INTEGER NOT NULL,
  consent_type VARCHAR(100) NOT NULL,
  terms_version VARCHAR(20) NOT NULL DEFAULT '1.0',
  ip_address VARCHAR(100),
  user_agent TEXT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_consent_tenant ON consent_records (tenant_id);
CREATE INDEX IF NOT EXISTS idx_consent_entity ON consent_records (entity_type, entity_id);

CREATE TABLE IF NOT EXISTS data_audit_log (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  action VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id INTEGER,
  field VARCHAR(100),
  user_id INTEGER,
  ip_address VARCHAR(100),
  user_agent TEXT,
  metadata TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_tenant ON data_audit_log (tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON data_audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON data_audit_log (created_at);

ALTER TABLE patients ALTER COLUMN cpf TYPE VARCHAR(255);

CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'data_audit_log is immutable: % operations are not allowed', TG_OP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_immutable ON data_audit_log;
CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON data_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_log_modification();
