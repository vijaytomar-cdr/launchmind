-- Migration 061: optimization_insights
-- AI-derived performance insights per product.
-- Feeds back into Marketing Memory and Recommendation Engine (ADR-056).
-- Additive only — no existing tables modified.

CREATE TABLE IF NOT EXISTS optimization_insights (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id      UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  insight_type    TEXT NOT NULL
                  CHECK (insight_type IN (
                    'channel_optimization', 'budget_reallocation', 'creative_refresh',
                    'audience_expansion', 'timing_optimization', 'funnel_fix'
                  )),
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  impact_estimate TEXT,
  action_taken    TEXT,
  source_metrics  JSONB,
  confidence      NUMERIC(4,3) DEFAULT 0.70 CHECK (confidence >= 0 AND confidence <= 1),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'applied', 'dismissed', 'expired')),
  expires_at      TIMESTAMPTZ,
  applied_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_id, insight_type, title, status)
);

ALTER TABLE optimization_insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "insights_owner" ON optimization_insights;
CREATE POLICY "insights_owner" ON optimization_insights USING (founder_id = auth.uid());
CREATE INDEX IF NOT EXISTS insights_product_status ON optimization_insights(product_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS insights_founder_pending ON optimization_insights(founder_id, status) WHERE status = 'pending';
