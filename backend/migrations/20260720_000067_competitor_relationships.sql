/**
 * @migration 20260720_000067_competitor_relationships
 * @description Founder's curated competitor set from Phase 1 step 11.
 *   Extends the raw competitor data from discovery_jobs with explicit
 *   founder decisions: confirmed, rejected, or manually added.
 * @security RLS: founder-scoped.
 */

CREATE TABLE IF NOT EXISTS competitor_relationships (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID        NOT NULL REFERENCES onboarding_sessions(id) ON DELETE CASCADE,
  founder_id       UUID        NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id       UUID        REFERENCES products(id) ON DELETE CASCADE,

  -- Competitor identity
  name             TEXT        NOT NULL,
  store_url        TEXT,
  website_url      TEXT,
  platform         TEXT        CHECK (platform IN ('app_store','play_store','web_only','both')),

  -- Classification
  relationship     TEXT        NOT NULL DEFAULT 'CONFIRMED'
                   CHECK (relationship IN ('CONFIRMED','REJECTED','MANUALLY_ADDED')),

  -- Competitive intel (from scraper or founder input)
  category         TEXT,
  estimated_rating NUMERIC(3,2),
  review_count     INTEGER,
  price_tier       TEXT,
  key_differentiator TEXT,     -- how our product is different from this competitor

  -- Source
  discovered_by    TEXT        DEFAULT 'AI'
                   CHECK (discovered_by IN ('AI','FOUNDER')),

  display_order    INTEGER     NOT NULL DEFAULT 0,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE competitor_relationships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "competitor_relationships_owner"
  ON competitor_relationships
  USING (founder_id = auth.uid());

CREATE INDEX IF NOT EXISTS competitor_relationships_session
  ON competitor_relationships (session_id);
