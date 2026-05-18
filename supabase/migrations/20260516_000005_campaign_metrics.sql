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
