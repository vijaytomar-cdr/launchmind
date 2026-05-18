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
-- @file 20260516_000002_products.sql
-- @description Creates the products table with pgvector support and RLS.
--   icp_embedding: 1536-dim vector for semantic similarity search via pgvector.
--   confirmed_icp / competitor_set / scraped_meta: JSONB for flexible schema evolution.
--   Idempotent: safe to run multiple times.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS products (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id          UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  store_url           TEXT NOT NULL,
  platform            TEXT NOT NULL CHECK (platform IN ('app_store','play_store')),
  category            TEXT,
  markets             TEXT[] DEFAULT ARRAY['usa'],
  price_tier          TEXT,
  confirmed_icp       JSONB,
  competitor_set      JSONB,
  scraped_meta        JSONB,
  brand_voice_profile JSONB,
  last_scraped_at     TIMESTAMPTZ,
  icp_embedding       VECTOR(1536),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_owner" ON products;
CREATE POLICY "products_owner" ON products USING (founder_id = auth.uid());

DROP TRIGGER IF EXISTS set_products_updated_at ON products;
CREATE TRIGGER set_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
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
-- @file 20260516_000005_campaign_metrics.sql
-- @description Creates the campaign_metrics table with RLS.
--   One row per campaign per week — UNIQUE(campaign_id, week_start) prevents duplicates.
--   raw_platform_data: full API response from Meta/Google preserved for reprocessing.
--   cpi / ctr / roas: pre-computed from raw data for fast dashboard queries.
--   Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS campaign_metrics (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id          UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  founder_id           UUID NOT NULL REFERENCES founders(id),
  week_start           DATE NOT NULL,
  impressions          INTEGER DEFAULT 0,
  clicks               INTEGER DEFAULT 0,
  installs             INTEGER DEFAULT 0,
  cpi                  NUMERIC(10,4),
  ctr                  NUMERIC(6,4),
  roas                 NUMERIC(10,4),
  top_performing_asset TEXT,
  raw_platform_data    JSONB,
  collected_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, week_start)
);

ALTER TABLE campaign_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "metrics_owner" ON campaign_metrics;
CREATE POLICY "metrics_owner" ON campaign_metrics USING (founder_id = auth.uid());
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
-- @file 20260516_000007_playbook_signals.sql
-- @description Creates the playbook_signals table — anonymised, no PII.
--   No founder_id / product_id — this is aggregate signal data used to train recommendations.
--   authenticated role: SELECT only. service_role: INSERT only (via backend worker).
--   signal_embedding: 1536-dim vector for semantic similarity matching during strategy gen.
--   Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS playbook_signals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category          TEXT NOT NULL,
  market            TEXT NOT NULL CHECK (market IN ('usa','india')),
  channel           TEXT NOT NULL,
  hook_type         TEXT,
  price_tier        TEXT,
  install_delta_pct NUMERIC(8,2),
  conversion_rate   NUMERIC(6,4),
  retention_d7      NUMERIC(6,4),
  week_number       INTEGER,
  signal_embedding  VECTOR(1536),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON playbook_signals TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON playbook_signals FROM authenticated;
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
-- @file 20260516_000009_embedding_store.sql
-- @description Creates the embedding_store table with RLS.
--   Stores ICP embeddings, campaign history vectors, and learning log entries.
--   embedding: 1536-dim vector, queried via pgvector cosine distance (<=>).
--   type CHECK ensures only known embedding types are stored.
--   Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS embedding_store (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id  UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id  UUID REFERENCES products(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('icp','campaign_history','learning_log')),
  content     TEXT NOT NULL,
  embedding   VECTOR(1536),
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE embedding_store ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "embeddings_owner" ON embedding_store;
CREATE POLICY "embeddings_owner" ON embedding_store USING (founder_id = auth.uid());

CREATE INDEX IF NOT EXISTS embedding_store_type_idx ON embedding_store(founder_id, type);
-- Migration: add unique constraint on campaigns(product_id, channel, market)
-- Required for the upsert in strategyService.generateStrategy() to work correctly.
-- Additive only — no columns dropped or renamed.
-- Idempotent: wrapped in DO block.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_indexes
    WHERE  tablename = 'campaigns'
    AND    indexname = 'campaigns_product_channel_market_unique'
  ) THEN
    CREATE UNIQUE INDEX campaigns_product_channel_market_unique
      ON campaigns (product_id, channel, market);
  END IF;
END
$$;
-- Migration: 20260517_000011_utm_links
-- Week 7: UTM tracking links for campaign attribution.
-- Idempotent: safe to run twice.

CREATE TABLE IF NOT EXISTS utm_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  founder_id   UUID NOT NULL REFERENCES founders(id),
  base_url     TEXT NOT NULL,
  utm_source   TEXT NOT NULL,
  utm_medium   TEXT NOT NULL,
  utm_campaign TEXT NOT NULL,
  utm_content  TEXT,
  utm_term     TEXT,
  short_code   TEXT NOT NULL UNIQUE,
  click_count  INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE utm_links ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'utm_links' AND policyname = 'utm_links_owner'
  ) THEN
    CREATE POLICY "utm_links_owner" ON utm_links USING (founder_id = auth.uid());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS utm_links_campaign_id ON utm_links(campaign_id);
CREATE INDEX IF NOT EXISTS utm_links_short_code ON utm_links(short_code);
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
