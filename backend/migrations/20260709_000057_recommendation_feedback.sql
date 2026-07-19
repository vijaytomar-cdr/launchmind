-- Migration: 057 — recommendation_feedback
-- Tracks founder feedback on recommendations to improve future scoring.
-- Append-only: no UPDATE or DELETE on feedback rows.
-- Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS recommendation_feedback (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id     UUID NOT NULL REFERENCES saved_opportunities(id) ON DELETE CASCADE,
  founder_id            UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  feedback_type         TEXT NOT NULL CHECK (feedback_type IN (
                          'helpful','not_helpful','wrong','too_early','already_doing'
                        )),
  note                  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE recommendation_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "feedback_owner" ON recommendation_feedback;
CREATE POLICY "feedback_owner" ON recommendation_feedback USING (founder_id = auth.uid());
CREATE INDEX IF NOT EXISTS feedback_recommendation ON recommendation_feedback(recommendation_id, created_at DESC);
REVOKE UPDATE, DELETE ON recommendation_feedback FROM authenticated, anon;
