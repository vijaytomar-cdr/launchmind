-- Migration: 20260518_000017_api_keys.sql
-- Creates api_keys table for external API authentication.
-- The actual key is NEVER stored — only a SHA-256 hash.
-- key_prefix (first 8 chars) is stored for display purposes only.
-- Idempotent: safe to run twice.

BEGIN;

CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id   UUID        NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  key_hash     TEXT        NOT NULL UNIQUE,
  key_prefix   TEXT        NOT NULL,
  scopes       TEXT[]      NOT NULL DEFAULT ARRAY['read'],
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "api_keys_owner" ON api_keys;
CREATE POLICY "api_keys_owner" ON api_keys
  USING (founder_id = auth.uid());

CREATE INDEX IF NOT EXISTS api_keys_hash_idx ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS api_keys_founder_idx ON api_keys(founder_id);

COMMIT;
