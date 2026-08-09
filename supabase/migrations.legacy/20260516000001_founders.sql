-- @file 20260516_000001_founders.sql
-- @description Creates the founders table with RLS.
--   token_balance is nullable — NULL means "not yet activated" (Phase 5 enforces balance).
--   deleted_at soft-delete supports GDPR right-to-erasure without removing audit history.
--   Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS founders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT,
  plan          TEXT NOT NULL DEFAULT 'free'
                CHECK (plan IN ('free','solo','builder','studio')),
  mfa_enabled   BOOLEAN NOT NULL DEFAULT false,
  token_balance INTEGER DEFAULT NULL,
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE founders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "founders_self" ON founders;
CREATE POLICY "founders_self" ON founders USING (id = auth.uid());

-- Auto-update updated_at on every row update
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_founders_updated_at ON founders;
CREATE TRIGGER set_founders_updated_at
  BEFORE UPDATE ON founders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
