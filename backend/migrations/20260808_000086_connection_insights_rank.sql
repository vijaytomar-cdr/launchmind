-- Migration: 20260808_000086_connection_insights_rank
--
-- Every insight produced by one sync is written by a single INSERT, so they all
-- share created_at exactly. Ordering by created_at alone therefore made "the latest
-- insight" an arbitrary pick among them — the connected-source card, the
-- first-insight screen, and Growth Brain could each surface a different one from the
-- same sync.
--
-- Each provider's deriver returns its insights in a deliberate order (App Store
-- Connect leads with store conversion; Stripe leads with failed payments — revenue
-- already won and then lost is usually the cheapest thing to fix). That intent was
-- being discarded at persist time. This column keeps it.
--
-- Confidence is deliberately NOT used as the tiebreak: it scales with sample size,
-- so it measures how sure LaunchMind is, not how much the finding matters.
--
-- Additive and idempotent: safe to run twice.

ALTER TABLE connection_insights
  ADD COLUMN IF NOT EXISTS display_rank INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN connection_insights.display_rank IS
  'Position within the batch its deriver produced. 0 leads. Lower sorts first.';

-- Matches the read path: workspace + live, newest batch first, then the deriver''s
-- own ordering within that batch.
CREATE INDEX IF NOT EXISTS connection_insights_display_order
  ON connection_insights(workspace_id, created_at DESC, display_rank ASC)
  WHERE superseded_at IS NULL;
