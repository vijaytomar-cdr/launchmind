-- ============================================================================
-- Migration 120 — Creative production foundation (Phase 3.5B6A)
--
-- Turns a governed visual brief into a real, stored, versioned rendered image
-- WITHOUT widening any existing boundary.
--
-- THREE THINGS THIS SCHEMA REFUSES TO REPRESENT, structurally:
--
--   1. Rendering is not execution. creative_render_jobs has no publish, launch,
--      schedule, send or spend column and its status CHECK excludes those words,
--      so "the image is ready" can never be recorded as "the ad is running".
--
--   2. Approving text is not approving a picture. creative_approvals binds an
--      approval to ONE rendered output AND the content version it was made for.
--      Approving copy cannot satisfy that row, and neither can a later render.
--
--   3. A generated image is not an authorized product asset. Output rows land in
--      marketing_assets as source='GENERATED' and stay OBSERVED_EXTERNAL, so a
--      rendered picture can never be resolved back as owner-authorised product
--      imagery for the NEXT render. Model output feeding itself as evidence of
--      the product is exactly the loop this prevents.
--
-- Additive and idempotent. No column dropped, renamed or retyped.
-- ============================================================================

-- ── 1. Render jobs ─────────────────────────────────────────────────────────
-- The smallest honest record of "we asked a provider for a picture".
CREATE TABLE IF NOT EXISTS creative_render_jobs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id         UUID NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
  founder_id         UUID NOT NULL REFERENCES founders(id)   ON DELETE CASCADE,

  -- Lineage. Every rendered pixel resolves back to the copy it was made for.
  content_asset_id   UUID NOT NULL REFERENCES content_assets(id) ON DELETE CASCADE,
  content_version_number INTEGER NOT NULL CHECK (content_version_number > 0),
  content_campaign_id UUID REFERENCES content_campaigns(id) ON DELETE SET NULL,
  content_strategy_id UUID,
  content_brief_id    UUID,
  variant_label       TEXT,

  provider           TEXT NOT NULL CHECK (provider IN ('REPLICATE')),
  capability         TEXT NOT NULL CHECK (capability IN ('IMAGE_GENERATION','IMAGE_EDITING')),
  model_ref          TEXT NOT NULL,
  quality_tier       TEXT NOT NULL DEFAULT 'DRAFT'
                     CHECK (quality_tier IN ('DRAFT','PRODUCTION','PREMIUM')),
  creative_kind      TEXT NOT NULL
                     CHECK (creative_kind IN ('META_AD_VISUAL','SOCIAL_POST_VISUAL',
                                              'LANDING_PAGE_HERO','PRODUCT_VISUAL')),
  concept_label      TEXT,

  -- Brand and asset posture AT RENDER TIME. Frozen: a later brand change must
  -- not retroactively alter what an old image was made from.
  brand_kit_version  INTEGER NOT NULL DEFAULT 1,
  used_asset_ids     UUID[] NOT NULL DEFAULT '{}',

  -- RENDERING IS NOT EXECUTION. PUBLISHED / LAUNCHED / EXECUTED /
  -- SPEND_APPROVED are absent on purpose and rejected by this CHECK.
  status             TEXT NOT NULL DEFAULT 'QUEUED'
                     CHECK (status IN ('QUEUED','RENDERING','SUCCEEDED','FAILED','CANCELLED')),
  attempt            INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1 AND attempt <= 3),
  failure_category   TEXT CHECK (failure_category IN
                       ('PROVIDER_UNAVAILABLE','RATE_LIMITED','TIMEOUT','MALFORMED_RESPONSE',
                        'INVALID_CONTENT_TYPE','OUTPUT_EXPIRED','STORAGE_FAILED',
                        'BLOCKED_BY_GOVERNANCE','PROVIDER_REFUSED','ADAPTER_UNAVAILABLE')),
  -- Owner-safe sentence. Never a stack trace and never a provider payload.
  failure_detail     TEXT,

  -- Safe reference only. Not the prompt, not the response, not the seed.
  provider_request_ref TEXT,
  output_asset_id    UUID REFERENCES marketing_assets(id) ON DELETE SET NULL,

  -- Recorded from the provider, never invented. NULL means "not reported".
  latency_ms         INTEGER,
  cost_usd           NUMERIC(12,6),
  cost_source        TEXT CHECK (cost_source IN ('PROVIDER_REPORTED','NOT_REPORTED')),

  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creative_job_product_in_workspace') THEN
    ALTER TABLE creative_render_jobs
      ADD CONSTRAINT creative_job_product_in_workspace
      FOREIGN KEY (product_id, workspace_id) REFERENCES products(id, workspace_id) ON DELETE CASCADE;
  END IF;

  -- A failure must say which KIND it was. "It didn't work" is not a recovery path.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creative_job_failure_has_category') THEN
    ALTER TABLE creative_render_jobs
      ADD CONSTRAINT creative_job_failure_has_category
      CHECK (status <> 'FAILED' OR failure_category IS NOT NULL);
  END IF;

  -- A success must have produced something stored. Without this a job could
  -- report SUCCEEDED while the owner has no image — the exact shape of a
  -- fabricated result.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creative_job_success_has_output') THEN
    ALTER TABLE creative_render_jobs
      ADD CONSTRAINT creative_job_success_has_output
      CHECK (status <> 'SUCCEEDED' OR output_asset_id IS NOT NULL);
  END IF;

  -- Cost is either provider-reported with a number, or explicitly not reported.
  -- There is no third state in which LaunchMind estimates a price.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creative_job_cost_is_sourced') THEN
    ALTER TABLE creative_render_jobs
      ADD CONSTRAINT creative_job_cost_is_sourced
      CHECK (cost_usd IS NULL OR cost_source = 'PROVIDER_REPORTED');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS creative_render_jobs_artifact
  ON creative_render_jobs(content_asset_id, content_version_number, created_at DESC);
CREATE INDEX IF NOT EXISTS creative_render_jobs_scope
  ON creative_render_jobs(workspace_id, product_id, created_at DESC);

ALTER TABLE creative_render_jobs ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'creative_render_jobs' AND policyname = 'creative_jobs_member_read') THEN
    CREATE POLICY creative_jobs_member_read ON creative_render_jobs
      FOR SELECT USING (lm_is_workspace_member(workspace_id));
  END IF;
END $$;

-- ── 2. Generated output lives in marketing_assets ──────────────────────────
-- Reused rather than duplicated: one place answers "what images exist for this
-- product, where did each come from, and what may we do with it".
ALTER TABLE marketing_assets ADD COLUMN IF NOT EXISTS render_job_id UUID
  REFERENCES creative_render_jobs(id) ON DELETE SET NULL;
ALTER TABLE marketing_assets ADD COLUMN IF NOT EXISTS content_asset_id UUID
  REFERENCES content_assets(id) ON DELETE CASCADE;
ALTER TABLE marketing_assets ADD COLUMN IF NOT EXISTS content_version_number INTEGER;
ALTER TABLE marketing_assets ADD COLUMN IF NOT EXISTS brand_kit_version INTEGER;
ALTER TABLE marketing_assets ADD COLUMN IF NOT EXISTS mime_type TEXT;
ALTER TABLE marketing_assets ADD COLUMN IF NOT EXISTS width_px INTEGER;
ALTER TABLE marketing_assets ADD COLUMN IF NOT EXISTS height_px INTEGER;
ALTER TABLE marketing_assets ADD COLUMN IF NOT EXISTS byte_size INTEGER;
-- Owner-safe sentences describing how this image came to exist. No prompt,
-- no seed, no model hash — those are provider mechanics, not provenance.
ALTER TABLE marketing_assets ADD COLUMN IF NOT EXISTS generation_provenance JSONB;

DO $$
BEGIN
  -- A GENERATED asset must carry its render lineage. Without this a rendered
  -- image could exist with no way back to the copy it illustrates, which is the
  -- state 3.7 learning cannot recover from.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_asset_generated_has_lineage') THEN
    ALTER TABLE marketing_assets
      ADD CONSTRAINT marketing_asset_generated_has_lineage
      CHECK (source <> 'GENERATED'
             OR (content_asset_id IS NOT NULL AND content_version_number IS NOT NULL
                 AND storage_path IS NOT NULL));
  END IF;

  -- A generated image is OUTPUT, never an owner-authorised input. Leaving this
  -- open would let a model's own picture be resolved back as "the screenshot
  -- you approved" on the next render.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_asset_generated_never_authorized') THEN
    ALTER TABLE marketing_assets
      ADD CONSTRAINT marketing_asset_generated_never_authorized
      CHECK (NOT (source = 'GENERATED' AND authorization_state = 'AUTHORIZED_MARKETING'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS marketing_assets_generated
  ON marketing_assets(content_asset_id, content_version_number, created_at DESC)
  WHERE source = 'GENERATED' AND archived_at IS NULL;

-- ── 3. Creative approval ───────────────────────────────────────────────────
-- Append-only. Binds ONE rendered output to ONE content version, one actor and
-- one moment. Grants nothing beyond "this picture is fit to represent us".
CREATE TABLE IF NOT EXISTS creative_approvals (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id         UUID NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
  content_asset_id   UUID NOT NULL REFERENCES content_assets(id) ON DELETE CASCADE,
  content_version_number INTEGER NOT NULL CHECK (content_version_number > 0),
  render_job_id      UUID NOT NULL REFERENCES creative_render_jobs(id) ON DELETE CASCADE,
  generated_asset_id UUID NOT NULL REFERENCES marketing_assets(id) ON DELETE CASCADE,
  brand_kit_version  INTEGER NOT NULL,
  approved_by        UUID NOT NULL REFERENCES founders(id),
  approved_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  note               TEXT,
  UNIQUE (render_job_id)
);

CREATE INDEX IF NOT EXISTS creative_approvals_artifact
  ON creative_approvals(content_asset_id, content_version_number, approved_at DESC);

ALTER TABLE creative_approvals ENABLE ROW LEVEL SECURITY;
REVOKE UPDATE, DELETE ON creative_approvals FROM authenticated, anon;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'creative_approvals' AND policyname = 'creative_approvals_member_read') THEN
    CREATE POLICY creative_approvals_member_read ON creative_approvals
      FOR SELECT USING (lm_is_workspace_member(workspace_id));
  END IF;
END $$;

COMMENT ON TABLE creative_render_jobs IS
  'One request to a creative provider. Rendering is not execution: this table '
  'has no publish, launch, schedule, send or spend column, and its status CHECK '
  'rejects those states.';
COMMENT ON TABLE creative_approvals IS
  'Owner approval of ONE rendered image for ONE content version. Approving copy '
  'does not satisfy this, a later render does not inherit it, and neither '
  'authorizes publishing.';
COMMENT ON COLUMN creative_render_jobs.cost_usd IS
  'Provider-reported only. NULL with cost_source=NOT_REPORTED when the provider '
  'gave no usage metadata. LaunchMind never estimates a price.';
