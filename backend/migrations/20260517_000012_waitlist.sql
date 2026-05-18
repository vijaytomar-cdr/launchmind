-- Migration: 20260517_000012_waitlist
-- Week 8: Pre-launch waitlist for collecting founder signups.
-- Idempotent: safe to run twice.

CREATE TABLE IF NOT EXISTS waitlist (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL UNIQUE,
  name       TEXT,
  source     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No RLS — public writes allowed (INSERT only via service role in route).
-- No authenticated reads needed — ops team reads via service role.
CREATE INDEX IF NOT EXISTS waitlist_email ON waitlist(email);
CREATE INDEX IF NOT EXISTS waitlist_created_at ON waitlist(created_at DESC);
