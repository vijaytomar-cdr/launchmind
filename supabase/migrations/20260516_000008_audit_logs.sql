-- @file 20260516_000008_audit_logs.sql
-- @description Creates the audit_logs table — immutable append-only.
--   UPDATE and DELETE are revoked from all non-superuser roles.
--   Captures: token decryption, campaign approval, billing events, anomaly logins.
--   ip_address / user_agent: recorded from request context for anomaly detection.
--   Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id    UUID REFERENCES founders(id),
  action        TEXT NOT NULL,
  resource_type TEXT,
  resource_id   UUID,
  metadata      JSONB,
  ip_address    INET,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_owner_read" ON audit_logs;
CREATE POLICY "audit_owner_read" ON audit_logs FOR SELECT USING (founder_id = auth.uid());

REVOKE UPDATE, DELETE ON audit_logs FROM authenticated, anon;
