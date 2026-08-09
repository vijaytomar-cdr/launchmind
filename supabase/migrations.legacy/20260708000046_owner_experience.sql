-- Migration: 046 — Owner Experience tables
-- saved_opportunities: lightweight growth backlog (save/dismiss/convert)
-- notifications: actionable owner notifications (approval needed, mission done, etc.)
-- Both tables are lightweight UI-state companions to existing core tables.

-- ── saved_opportunities ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS saved_opportunities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id  UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id  UUID          REFERENCES products(id)  ON DELETE CASCADE,

  type        TEXT NOT NULL,   -- 'aso' | 'competitor' | 'review_risk' | 'budget_shift' | 'india_launch' | 'referral' | 'general'
  title       TEXT NOT NULL,
  description TEXT,

  expected_impact TEXT,        -- Human-readable impact estimate ("~+15% installs")
  confidence  NUMERIC(4,2),    -- 0.00–1.00
  effort      TEXT NOT NULL DEFAULT 'medium'
              CHECK (effort   IN ('low','medium','high')),
  risk        TEXT NOT NULL DEFAULT 'low'
              CHECK (risk     IN ('low','medium','high')),
  why_now     TEXT,
  source      TEXT,            -- 'growth_brain' | 'review_analysis' | 'competitor_scrape' | 'manual'
  evidence    JSONB,           -- Array of evidence strings

  state       TEXT NOT NULL DEFAULT 'active'
              CHECK (state IN ('active','saved','dismissed','converted')),

  -- When converted to a mission, link it
  mission_id  UUID          REFERENCES missions(id),

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE saved_opportunities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "opportunities_owner" ON saved_opportunities;
CREATE POLICY "opportunities_owner" ON saved_opportunities USING (founder_id = auth.uid());
CREATE INDEX IF NOT EXISTS saved_opportunities_founder_state ON saved_opportunities(founder_id, state, created_at DESC);
CREATE INDEX IF NOT EXISTS saved_opportunities_product ON saved_opportunities(product_id, state);

-- ── notifications ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id   UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,

  type         TEXT NOT NULL
               CHECK (type IN (
                 'approval_needed','mission_completed','growth_brain_updated',
                 'campaign_issue','integration_issue','billing_issue',
                 'security_issue','weekly_summary_ready','experiment_result'
               )),
  title        TEXT NOT NULL,
  message      TEXT,
  action_url   TEXT,
  action_label TEXT,

  -- Optional link to source object
  resource_type TEXT,
  resource_id   UUID,

  is_read      BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notifications_owner" ON notifications;
CREATE POLICY "notifications_owner" ON notifications USING (founder_id = auth.uid());
CREATE INDEX IF NOT EXISTS notifications_founder_unread ON notifications(founder_id, is_read, created_at DESC);
