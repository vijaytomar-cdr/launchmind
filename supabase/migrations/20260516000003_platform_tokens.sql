-- @file 20260516_000003_platform_tokens.sql
-- @description Creates the platform_tokens table with RLS.
--   encrypted_token: AES-256 ciphertext from AWS KMS — NEVER return to frontend.
--   kms_key_id: ARN of the KMS key used, stored for key rotation support.
--   revoked_at: set when a founder disconnects a platform — token NOT deleted (audit trail).
--   Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS platform_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id      UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL
                  CHECK (platform IN ('meta','google','whatsapp','linkedin','email')),
  encrypted_token TEXT NOT NULL,
  kms_key_id      TEXT NOT NULL,
  scopes          TEXT[] NOT NULL,
  expires_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(founder_id, platform)
);

ALTER TABLE platform_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tokens_owner" ON platform_tokens;
CREATE POLICY "tokens_owner" ON platform_tokens USING (founder_id = auth.uid());
