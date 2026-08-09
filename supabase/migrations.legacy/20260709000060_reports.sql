-- Migration 060: reports
-- Stores generated analytical reports (weekly, monthly, executive, campaign, experiment).
-- AI narrative content cached in JSONB to avoid regenerating on every request.
-- Additive only — no existing tables modified.

CREATE TABLE IF NOT EXISTS reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id      UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id      UUID REFERENCES products(id) ON DELETE CASCADE,
  report_type     TEXT NOT NULL
                  CHECK (report_type IN ('weekly', 'monthly', 'executive', 'campaign', 'experiment')),
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  title           TEXT NOT NULL,
  summary         TEXT,
  content         JSONB NOT NULL DEFAULT '{}',
  metrics_snapshot JSONB,
  ai_tokens_consumed INTEGER DEFAULT 0,
  export_count    INTEGER DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'ready', 'exported')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(founder_id, product_id, report_type, period_start)
);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reports_owner" ON reports;
CREATE POLICY "reports_owner" ON reports USING (founder_id = auth.uid());
CREATE INDEX IF NOT EXISTS reports_founder_type ON reports(founder_id, report_type, period_start DESC);
CREATE INDEX IF NOT EXISTS reports_product ON reports(product_id, period_start DESC);
