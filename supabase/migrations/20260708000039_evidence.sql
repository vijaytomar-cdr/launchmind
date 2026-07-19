-- Migration: 20260708_000039_evidence
-- Evidence records link memories and knowledge nodes back to the source data
-- that supports them (playbook signals, campaign metrics, reviews, etc.).
-- Idempotent: safe to run twice.

CREATE TABLE IF NOT EXISTS evidence (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id       UUID        NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id       UUID                    REFERENCES products(id) ON DELETE CASCADE,
  evidence_type    TEXT        NOT NULL
                   CHECK (evidence_type IN (
                     'playbook_signal','campaign_metric','review',
                     'user_feedback','ab_test','analytics','external'
                   )),
  source_id        TEXT,
  source_table     TEXT,
  data             JSONB       NOT NULL DEFAULT '{}',
  confidence_boost NUMERIC(3,2) NOT NULL DEFAULT 0.00
                   CHECK (confidence_boost >= -1.00 AND confidence_boost <= 1.00),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'evidence' AND policyname = 'evidence_owner'
  ) THEN
    DROP POLICY IF EXISTS "evidence_owner" ON evidence;
CREATE POLICY "evidence_owner" ON evidence
      USING (founder_id = auth.uid());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS evidence_product
  ON evidence(product_id, evidence_type);

CREATE INDEX IF NOT EXISTS evidence_source
  ON evidence(source_table, source_id);
