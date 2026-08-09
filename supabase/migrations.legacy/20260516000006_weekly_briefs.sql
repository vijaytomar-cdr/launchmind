-- @file 20260516_000006_weekly_briefs.sql
-- @description Creates the weekly_briefs table with RLS.
--   One brief per product per week — UNIQUE(product_id, week_of) prevents duplicates.
--   ai_tokens_consumed: total tokens used to generate this brief (Sonnet, 20 tokens each).
--   generated_assets: JSONB of content produced for the week (copy, images, etc.)
--   Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS weekly_briefs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id         UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  founder_id         UUID NOT NULL REFERENCES founders(id),
  week_of            DATE NOT NULL,
  what_worked        TEXT,
  what_to_kill       TEXT,
  next_actions       JSONB,
  generated_assets   JSONB,
  ai_tokens_consumed INTEGER DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','sent','acknowledged')),
  sent_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_id, week_of)
);

ALTER TABLE weekly_briefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "briefs_owner" ON weekly_briefs;
CREATE POLICY "briefs_owner" ON weekly_briefs USING (founder_id = auth.uid());
