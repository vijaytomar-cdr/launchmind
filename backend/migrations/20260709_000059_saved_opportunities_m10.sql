-- Migration: 059 — saved_opportunities M10 extension
-- Adds Recommendation Engine fields to saved_opportunities (migration 046).
-- Additive only — no columns renamed or dropped.
-- Idempotent: safe to run multiple times.

ALTER TABLE saved_opportunities
  ADD COLUMN IF NOT EXISTS recommendation_type TEXT CHECK (recommendation_type IN (
    'opportunity','warning','optimization','budget','expansion',
    'competitive_response','content_recommendation','campaign_recommendation'
  )),
  ADD COLUMN IF NOT EXISTS score           NUMERIC(6,4),    -- composite 0–1
  ADD COLUMN IF NOT EXISTS priority        INTEGER DEFAULT 50,
  ADD COLUMN IF NOT EXISTS source_signals  JSONB,           -- [{ type, id, label }]
  ADD COLUMN IF NOT EXISTS expires_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS related_mission_id UUID REFERENCES missions(id),
  ADD COLUMN IF NOT EXISTS feedback_summary   JSONB;        -- { helpful:N, notHelpful:N, lastFeedback }

-- Extend the engine-generated field
CREATE INDEX IF NOT EXISTS saved_opp_score ON saved_opportunities(founder_id, score DESC, state)
  WHERE state = 'active';
CREATE INDEX IF NOT EXISTS saved_opp_expires ON saved_opportunities(founder_id, expires_at)
  WHERE expires_at IS NOT NULL AND state = 'active';
