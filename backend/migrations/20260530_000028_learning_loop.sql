/**
 * @migration 20260530_000028_learning_loop
 * @description Creates content_learnings table for the weekly learning loop.
 *   Lessons extracted from regen reasons + performance data are applied to
 *   next week's generation prompt automatically.
 */

CREATE TABLE IF NOT EXISTS content_learnings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  founder_id      UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL,
  learning_type   TEXT NOT NULL CHECK (learning_type IN (
    'regen_reason',
    'approved_unchanged',
    'performance_winner',
    'performance_loser'
  )),
  insight         TEXT NOT NULL,
  applies_to      TEXT[],
  week_number     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE content_learnings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "learnings_owner" ON content_learnings
  USING (founder_id = auth.uid());
