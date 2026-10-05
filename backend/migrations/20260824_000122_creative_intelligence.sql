-- 20260824_000122_creative_intelligence.sql
--
-- Creative Intelligence — Phase 3.5B6.5 §14–§19.
--
-- Additive and idempotent. Two tables, no change to any existing one.
--
-- WHAT IS DELIBERATELY ABSENT, because absence is the strongest control:
--
--   NO media column, NO storage path, NO bytes. An observation describes a
--   STRUCTURE. It never holds the creative it describes, so there is nothing
--   for a future code path to route into a renderer or into marketing_assets.
--   §16 is enforced by the schema having nowhere to put the asset.
--
--   NO composite score column. Quality dimensions are stored separately in a
--   JSONB body so no one can ORDER BY a number that averages away a weak one.
--
--   NO effectiveness / performance column. `public_engagement` is a count that
--   was visible on a page on a date. It is named for what it is.
--
-- Observations are WORKSPACE-SCOPED even though the creative is public: an
-- owner who asks LaunchMind to look at something should not thereby publish it
-- into another business's intelligence. Category patterns are derived per
-- workspace from that workspace's observations.

-- ── observations ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creative_observations (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id              UUID REFERENCES products(id) ON DELETE SET NULL,

  source_class            TEXT NOT NULL CHECK (source_class IN (
                            'PUBLIC_BRAND_PAGE','PUBLIC_APP_STORE_CREATIVE','PUBLIC_AD_LIBRARY',
                            'PUBLIC_VIDEO_METADATA','PUBLIC_LANDING_PAGE','ANALYST_OR_EDITORIAL',
                            'LAUNCHMIND_MARKET_RESEARCH')),
  source_ref              TEXT NOT NULL,
  publisher               TEXT,
  -- Distinct-publisher key. The independence rule counts THIS, not rows.
  independence_key        TEXT NOT NULL,

  channel                 TEXT NOT NULL,
  category                TEXT NOT NULL,
  format                  TEXT NOT NULL CHECK (format IN (
                            'SHORT_VIDEO','STATIC_IMAGE','CAROUSEL','LANDING_PAGE','STORE_LISTING')),
  observed_at             TIMESTAMPTZ NOT NULL,

  narrative_shape         TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (narrative_shape IN (
                            'PROBLEM_LED','BENEFIT_LED','DEMONSTRATION_LED','COMPARISON_LED',
                            'STORY_LED','SPOKESPERSON_LED','UNKNOWN')),
  hook_structure          TEXT,
  first_frame             TEXT,
  product_reveal_seconds  NUMERIC(6,2),
  caption_density         TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (caption_density IN (
                            'NONE','LOW','MEDIUM','HIGH','UNKNOWN')),
  visual_composition      TEXT,
  pacing                  TEXT,
  duration_seconds        NUMERIC(8,2),
  cta_style               TEXT,

  -- A count seen on a page on a date. NOT effectiveness. The CHECK below makes
  -- it structurally impossible to record one without recording its limits.
  public_engagement       JSONB,
  signal_limitations      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  notes                   TEXT,

  policy_version          INTEGER NOT NULL DEFAULT 1,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT creative_observations_engagement_needs_limits
    CHECK (public_engagement IS NULL OR array_length(signal_limitations, 1) >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS creative_observations_identity
  ON creative_observations (workspace_id, source_ref, observed_at, format);
CREATE INDEX IF NOT EXISTS creative_observations_category
  ON creative_observations (workspace_id, category, observed_at DESC);

ALTER TABLE creative_observations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'creative_observations' AND policyname = 'creative_obs_member_read') THEN
    CREATE POLICY creative_obs_member_read ON creative_observations
      FOR SELECT USING (lm_is_workspace_member(workspace_id));
  END IF;
END $$;

-- ── derived patterns ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creative_patterns (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id              UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pattern_key               TEXT NOT NULL,
  description               TEXT NOT NULL,
  dimension                 TEXT NOT NULL,
  category                  TEXT NOT NULL,
  channel                   TEXT,
  format                    TEXT,

  -- The independence rule, persisted so it can be audited after the fact.
  independent_source_count  INTEGER NOT NULL CHECK (independent_source_count >= 3),
  first_observed_at         TIMESTAMPTZ NOT NULL,
  last_observed_at          TIMESTAMPTZ NOT NULL,

  -- Dimensions side by side. No column here is a combined score.
  quality                   JSONB NOT NULL DEFAULT '{}'::jsonb,
  do_not_imitate            TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- Retraction, not deletion: a pattern that stops being true must stop
  -- influencing new work while remaining visible in the record of what
  -- influenced old work.
  retracted_at              TIMESTAMPTZ,
  retraction_reason         TEXT,

  policy_version            INTEGER NOT NULL DEFAULT 1,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS creative_patterns_key
  ON creative_patterns (workspace_id, pattern_key);
CREATE INDEX IF NOT EXISTS creative_patterns_category
  ON creative_patterns (workspace_id, category) WHERE retracted_at IS NULL;

ALTER TABLE creative_patterns ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'creative_patterns' AND policyname = 'creative_pat_member_read') THEN
    CREATE POLICY creative_pat_member_read ON creative_patterns
      FOR SELECT USING (lm_is_workspace_member(workspace_id));
  END IF;
END $$;

-- Neither table is writable by an end user. Observations are recorded by the
-- server after passing the ingestion boundary; patterns are derived. A founder
-- who could INSERT here could manufacture a "pattern" and then be advised by it.
REVOKE INSERT, UPDATE, DELETE ON creative_observations FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON creative_patterns FROM authenticated, anon;
