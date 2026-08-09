/**
 * @migration 20260720_000064_product_claims
 * @description Structured beliefs extracted from discovery output.
 *   Each claim has provenance (FACT = from store data, INFERENCE = AI derived,
 *   FOUNDER_PROVIDED = entered by founder) and a review status.
 *   Supports confidence scoring, evidence sources, and correction tracking.
 * @security RLS: founder-scoped. No cross-founder access.
 */

CREATE TABLE IF NOT EXISTS product_claims (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID        NOT NULL REFERENCES onboarding_sessions(id) ON DELETE CASCADE,
  founder_id       UUID        NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id       UUID        REFERENCES products(id) ON DELETE CASCADE,

  -- Claim content
  claim_type       TEXT        NOT NULL
                   CHECK (claim_type IN ('FACT','INFERENCE','FOUNDER_PROVIDED')),
  category         TEXT        NOT NULL
                   CHECK (category IN ('icp','pain_point','competitor','market','feature','channel','pricing','other')),

  -- The claim itself
  title            TEXT        NOT NULL,
  body             TEXT        NOT NULL,
  confidence       NUMERIC(4,3) NOT NULL DEFAULT 0.5  -- 0.000–1.000
                   CHECK (confidence >= 0 AND confidence <= 1),

  -- Evidence (for FACT and INFERENCE)
  evidence_sources JSONB       NOT NULL DEFAULT '[]'::JSONB,
  -- e.g. [{ "type": "app_store_review", "count": 47, "excerpt": "..." }, ...]

  -- Review status
  status           TEXT        NOT NULL DEFAULT 'UNREVIEWED'
                   CHECK (status IN ('UNREVIEWED','CONFIRMED','CORRECTED','REJECTED')),

  -- Correction tracking (for CORRECTED status)
  original_value   TEXT,       -- the original claim body before correction
  corrected_value  TEXT,       -- what the founder changed it to
  founder_note     TEXT,       -- optional note from founder

  -- Display ordering
  display_order    INTEGER     NOT NULL DEFAULT 0,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE product_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "product_claims_owner"
  ON product_claims
  USING (founder_id = auth.uid());

CREATE INDEX IF NOT EXISTS product_claims_session
  ON product_claims (session_id);
CREATE INDEX IF NOT EXISTS product_claims_founder_status
  ON product_claims (founder_id, status);
