-- @file 20260516_000004_campaigns.sql
-- @description Creates the campaigns table with RLS and performance index.
--   approved_at: MUST be non-null before any platform post — enforced in Fastify route handler.
--   spend_cap: JSONB per-platform budget, checked server-side before campaign creation.
--   ai_tokens_consumed: running total of tokens used to generate this campaign's assets.
--   Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS campaigns (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id           UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  founder_id           UUID NOT NULL REFERENCES founders(id),
  channel              TEXT NOT NULL
                       CHECK (channel IN ('meta','google','whatsapp','linkedin','email')),
  market               TEXT NOT NULL CHECK (market IN ('usa','india')),
  status               TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN
                         ('draft','pending_approval','approved','launched','paused','completed')),
  hook_type            TEXT,
  copy_text            TEXT,
  audience_config      JSONB,
  spend_cap            JSONB,
  external_campaign_id TEXT,
  ai_tokens_consumed   INTEGER DEFAULT 0,
  approved_at          TIMESTAMPTZ,
  launched_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaigns_owner" ON campaigns;
CREATE POLICY "campaigns_owner" ON campaigns USING (founder_id = auth.uid());

CREATE INDEX IF NOT EXISTS campaigns_product_status ON campaigns(product_id, status);

DROP TRIGGER IF EXISTS set_campaigns_updated_at ON campaigns;
CREATE TRIGGER set_campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
