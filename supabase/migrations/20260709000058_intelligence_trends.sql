-- Migration: 058 — intelligence_trends
-- Pre-computed anonymized trend snapshots from playbook_signals aggregation.
-- No PII. No founder_id. No product_id.
-- Computed by weekly BullMQ cron, upserted by category+market+trend_type+period_days.
-- Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS intelligence_trends (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category        TEXT NOT NULL,
  market          TEXT NOT NULL CHECK (market IN ('usa','india')),
  channel         TEXT,                -- NULL = cross-channel aggregate
  trend_type      TEXT NOT NULL CHECK (trend_type IN (
                    'install_growth','cpi_shift','channel_shift',
                    'seasonal','review_sentiment','conversion_rate'
                  )),
  direction       TEXT NOT NULL CHECK (direction IN ('up','down','flat','volatile')),
  magnitude       NUMERIC(8,4),        -- % change over period
  period_days     INTEGER NOT NULL DEFAULT 30,
  signal_count    INTEGER NOT NULL DEFAULT 0,  -- number of signals contributing
  summary         TEXT,                -- human-readable e.g. "CPI in Health apps rose 12% in USA"
  benchmark_data  JSONB,               -- { avg, median, p25, p75, min, max }
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(category, market, trend_type, period_days, channel)
);

-- No RLS needed — fully anonymised, no tenant data
-- Any authenticated user can read; only service_role writes
GRANT SELECT ON intelligence_trends TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON intelligence_trends FROM authenticated, anon;

CREATE INDEX IF NOT EXISTS trends_category_market ON intelligence_trends(category, market, computed_at DESC);
