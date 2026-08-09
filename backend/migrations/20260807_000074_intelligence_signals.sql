-- Migration 074: intelligence_signals
-- Stores structured data signals synced from connected providers (App Store Connect, RevenueCat, GA4, Stripe, etc.)
-- Each sync run produces rows here; the Growth Brain coverage computation reads these to derive dimension percentages.

CREATE TABLE IF NOT EXISTS intelligence_signals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id      UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id      UUID REFERENCES products(id) ON DELETE SET NULL,
  provider        TEXT NOT NULL
                  CHECK (provider IN (
                    'app_store_connect','revenue_cat','ga4','stripe',
                    'search_console','google_ads','meta_ads','hubspot','mailchimp'
                  )),
  signal_type     TEXT NOT NULL
                  CHECK (signal_type IN (
                    'impressions','downloads','conversion','territory',
                    'trials','churn','retention','ltv',
                    'sessions','funnel','source_quality',
                    'mrr','plan_movement','revenue',
                    'queries','rankings','ctr',
                    'spend','cac','campaign_performance',
                    'creative_performance','audience',
                    'lead_quality','lifecycle',
                    'email_engagement'
                  )),
  signal_data     JSONB NOT NULL DEFAULT '{}',
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  period_start    DATE,
  period_end      DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE intelligence_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "intelligence_signals_owner"
  ON intelligence_signals
  USING (founder_id = auth.uid());

CREATE INDEX intelligence_signals_founder_provider
  ON intelligence_signals(founder_id, provider, synced_at DESC);

CREATE INDEX intelligence_signals_product
  ON intelligence_signals(product_id, signal_type)
  WHERE product_id IS NOT NULL;

-- Prevent authenticated users from manually inserting or modifying — only service_role (sync worker) writes
REVOKE INSERT, UPDATE, DELETE ON intelligence_signals FROM authenticated;
GRANT INSERT, UPDATE ON intelligence_signals TO service_role;
