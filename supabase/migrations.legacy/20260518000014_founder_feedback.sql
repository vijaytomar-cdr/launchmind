CREATE TABLE IF NOT EXISTS founder_feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id  UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id  UUID REFERENCES products(id) ON DELETE SET NULL,
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body        TEXT,
  context     TEXT NOT NULL DEFAULT 'general'
              CHECK (context IN ('general','after_brief','after_strategy','after_campaign')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE founder_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "feedback_owner" ON founder_feedback;
CREATE POLICY "feedback_owner" ON founder_feedback USING (founder_id = auth.uid());
CREATE INDEX IF NOT EXISTS founder_feedback_founder_idx ON founder_feedback(founder_id);
