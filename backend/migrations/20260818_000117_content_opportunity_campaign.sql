-- ============================================================================
-- 117 — Content Opportunity + Content Campaign. Phase 3.5B2, ADR-071 §7/§9.
--
-- TRACED BEFORE WRITING: content generation contains ZERO references to
-- growth_brain_recommendations. Intelligence stops at a recommendation; content
-- starts at an owner-authored brief. Nothing joins them, so LaunchMind has never
-- been able to answer "what should I market right now?" — it could only answer
-- "is this copy the owner asked for safe?". These two objects are that bridge.
--
-- OPPORTUNITY EXTENDS saved_opportunities (ADR-071 froze this). That table is
-- already the unified opportunity/recommendation backlog from migrations 046 and
-- 059. It carries title, description, why_now, confidence, effort, risk,
-- evidence, state, score, priority, source_signals and expires_at — most of the
-- contract. What it lacks is content-specific decision fields and, critically,
-- WORKSPACE SCOPE: it is founder-scoped only, which is below the standard every
-- surface since 3.3D has met. Added here the same additive way migration 114 did
-- it for content_assets.
--
-- CONTENT CAMPAIGN IS NOT AN AD CAMPAIGN. `campaigns` already exists and is
-- executable — it carries spend_cap, approved_at, launched_at and the §1.5/§1.6
-- gates. `content_campaigns` deliberately has NO budget, schedule, launch,
-- execution-approval, provider-credential or external-id column. Execution
-- authority is not "blocked" here; it is UNREPRESENTABLE, which is the only form
-- a future code path cannot forget.
--
-- ADDITIVE ONLY. Idempotent. No existing row changes meaning: every new column
-- is nullable or defaulted, and legacy rows keep working as before.
-- @security Opportunity is a DECISION about what to say. It is never truth,
--   never approval, never permission, and it cannot be published.
-- @dependencies saved_opportunities (046, 059), products(id, workspace_id),
--   growth_brain_recommendations, workspaces
-- ============================================================================

BEGIN;

-- ── 1. Workspace scope for opportunities ────────────────────────────────────
ALTER TABLE saved_opportunities
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;

-- A product cannot belong to one workspace and its opportunity to another.
-- Nullable product_id is preserved (legacy rows have none), so the composite FK
-- is added only where both are present — Postgres treats a NULL side as
-- satisfied, which is the behaviour we want here.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_opportunities_product_in_workspace') THEN
    ALTER TABLE saved_opportunities
      ADD CONSTRAINT saved_opportunities_product_in_workspace
      FOREIGN KEY (product_id, workspace_id) REFERENCES products(id, workspace_id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── 2. Content-opportunity decision fields ──────────────────────────────────
ALTER TABLE saved_opportunities
  -- Provenance, never authority. OWNER_DIRECTED does not mean supported.
  ADD COLUMN IF NOT EXISTS origin TEXT,
  ADD COLUMN IF NOT EXISTS content_opportunity_type TEXT,
  ADD COLUMN IF NOT EXISTS objective TEXT,
  ADD COLUMN IF NOT EXISTS audience_hypothesis TEXT,
  ADD COLUMN IF NOT EXISTS message_angle TEXT,
  ADD COLUMN IF NOT EXISTS recommended_channels JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- References to evidence the SERVER issued, never handles a model invented.
  ADD COLUMN IF NOT EXISTS evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS recommendation_id UUID REFERENCES growth_brain_recommendations(id) ON DELETE SET NULL,
  -- EVERGREEN vs INTELLIGENCE_TRIGGERED. A product fact is not a market event.
  ADD COLUMN IF NOT EXISTS why_now_kind TEXT,
  ADD COLUMN IF NOT EXISTS viral_hypothesis JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_opp_origin_check') THEN
    ALTER TABLE saved_opportunities ADD CONSTRAINT saved_opp_origin_check
      CHECK (origin IS NULL OR origin IN ('AI_CMO_RECOMMENDED','OWNER_DIRECTED'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_opp_why_now_kind_check') THEN
    ALTER TABLE saved_opportunities ADD CONSTRAINT saved_opp_why_now_kind_check
      CHECK (why_now_kind IS NULL OR why_now_kind IN ('EVERGREEN','INTELLIGENCE_TRIGGERED'));
  END IF;

  -- An AI-recommended content opportunity must name the recommendation it came
  -- from. Only the owner-directed path may have none, because only the owner can
  -- originate without intelligence.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_opp_ai_origin_has_recommendation') THEN
    ALTER TABLE saved_opportunities ADD CONSTRAINT saved_opp_ai_origin_has_recommendation
      CHECK (origin IS DISTINCT FROM 'AI_CMO_RECOMMENDED'
             OR recommendation_id IS NOT NULL);
  END IF;

  -- "Why now" that claims a market trigger must cite intelligence. Without this
  -- a generic product fact can be dressed as a current event.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_opp_trigger_cites_evidence') THEN
    ALTER TABLE saved_opportunities ADD CONSTRAINT saved_opp_trigger_cites_evidence
      CHECK (why_now_kind IS DISTINCT FROM 'INTELLIGENCE_TRIGGERED'
             OR jsonb_array_length(evidence_refs) > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS saved_opp_content_scope
  ON saved_opportunities(workspace_id, product_id, state, priority DESC)
  WHERE content_opportunity_type IS NOT NULL;

COMMENT ON COLUMN saved_opportunities.origin IS
  'AI_CMO_RECOMMENDED or OWNER_DIRECTED. PROVENANCE ONLY. Owner-directed never '
  'means supported, approved or executable; AI-recommended never means '
  'autonomous, funded or publishable.';
COMMENT ON COLUMN saved_opportunities.evidence_refs IS
  'Server-issued evidence handle refs this opportunity cited. Re-resolved at '
  'strategy and again at generation — a reference here is not a standing claim.';

-- ── 3. Content Campaign — a narrative, never an ad buy ──────────────────────
CREATE TABLE IF NOT EXISTS content_campaigns (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id     UUID NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
  founder_id     UUID NOT NULL REFERENCES founders(id)   ON DELETE CASCADE,

  -- Immutable lineage. The opportunity explains WHY this campaign exists.
  opportunity_id UUID NOT NULL REFERENCES saved_opportunities(id) ON DELETE CASCADE,

  name           TEXT NOT NULL,
  thesis         TEXT NOT NULL,
  audience       TEXT NOT NULL,
  core_problem   TEXT,
  message_angle  TEXT NOT NULL,
  product_role   TEXT,
  primary_benefit TEXT,
  objections     JSONB NOT NULL DEFAULT '[]'::jsonb,
  cta_intent     TEXT,
  -- The load-bearing pair, carried from ADR-070 §4: a campaign that cannot name
  -- what it CANNOT prove will invent it downstream.
  proof_available   JSONB NOT NULL DEFAULT '[]'::jsonb,
  proof_unavailable JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommended_channels JSONB NOT NULL DEFAULT '[]'::jsonb,
  content_package  JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Brand context version used, so a later rebrand does not rewrite history.
  brand_kit_version INTEGER,

  status         TEXT NOT NULL DEFAULT 'DRAFT'
                 CHECK (status IN ('DRAFT','READY_FOR_REVIEW','ARCHIVED')),
  mode           TEXT NOT NULL DEFAULT 'SHADOW'
                 CHECK (mode IN ('OFF','SHADOW','ACTIVE')),

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at    TIMESTAMPTZ
);

-- DELIBERATELY ABSENT from this table, and the absence is the control:
--   spend_cap · budget · scheduled_at · launched_at · execution_approved_at
--   provider credentials · external_campaign_id · approved_at
-- A content campaign has no column in which execution authority could be
-- recorded, so no code path can grant it by writing one.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_campaigns_product_in_workspace') THEN
    ALTER TABLE content_campaigns
      ADD CONSTRAINT content_campaigns_product_in_workspace
      FOREIGN KEY (product_id, workspace_id) REFERENCES products(id, workspace_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS content_campaigns_scope
  ON content_campaigns(workspace_id, product_id, created_at DESC)
  WHERE archived_at IS NULL;

-- Link strategy and artifacts to the narrative they belong to.
ALTER TABLE content_strategies
  ADD COLUMN IF NOT EXISTS content_campaign_id UUID REFERENCES content_campaigns(id) ON DELETE SET NULL;
ALTER TABLE content_briefs
  ADD COLUMN IF NOT EXISTS content_campaign_id UUID REFERENCES content_campaigns(id) ON DELETE SET NULL;
ALTER TABLE content_assets
  ADD COLUMN IF NOT EXISTS content_campaign_id UUID REFERENCES content_campaigns(id) ON DELETE SET NULL;

COMMENT ON TABLE content_campaigns IS
  'A coordinated marketing NARRATIVE. Not the executable `campaigns` table. '
  'Carries no budget, schedule, launch or execution-approval column, so it '
  'cannot authorise spend or publishing even by accident.';

-- ── 4. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE content_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS content_campaigns_member_read ON content_campaigns;
CREATE POLICY content_campaigns_member_read ON content_campaigns
  FOR SELECT USING (lm_is_workspace_member(workspace_id));
REVOKE INSERT, UPDATE, DELETE ON content_campaigns FROM authenticated, anon;
GRANT SELECT ON content_campaigns TO authenticated;

COMMIT;
