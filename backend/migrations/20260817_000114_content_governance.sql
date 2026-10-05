-- ============================================================================
-- 114 — Content governance: workspace isolation, approval separation, strategy
--       and brief. Phase 3.5B, ADR-070. SHADOW ONLY.
--
-- CLOSES P1-25 and P1-26.
--
-- P1-25 — content_assets carried founder_id + product_id and NO workspace_id,
--   which is below the isolation standard every surface since 3.3D has met. A
--   founder with two workspaces had no structural separation between their
--   content.
--
-- P1-26 — content_assets.approved_at meant two things at once: "the owner
--   approved this copy" AND "this asset may be recorded as published". Those are
--   different decisions with different consequences, and one column cannot
--   express both without the weaker meaning silently granting the stronger.
--
-- THE APPROACH, and why it is not a rename:
--   `approved_at` is LEFT ALONE. Its legacy Studio semantics are frozen exactly
--   as they are, so no existing row changes meaning and no existing code breaks.
--   Governed content gets its OWN field, `content_approved_at`, which no publish
--   path reads. Renaming or reinterpreting the old column would have been a
--   reinterpretation of existing rows — the thing CLAUDE.md §1.2 forbids.
--
-- WHY content_versions AND asset_approvals GET NO workspace_id:
--   Both are reachable only through an immutable `asset_id` FK, and an asset
--   cannot change workspace (the composite FK below makes a mismatched pair
--   unrepresentable). A duplicated scope column would be a second source of
--   truth that could drift, so scope is inherited rather than copied.
--
-- ADDITIVE ONLY. Idempotent. content_assets holds 0 local rows.
-- @security The publishing trigger is the structural half of P1-26: a governed
--   artifact cannot be published even if a code path forgets to check.
-- @dependencies content_assets, products(id, workspace_id), workspaces
-- ============================================================================

BEGIN;

-- ── 1. P1-25 — workspace isolation ──────────────────────────────────────────
ALTER TABLE content_assets
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;

-- A product cannot belong to one workspace and its content to another. Uses the
-- same composite pattern migration 109 established for recommendations.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'content_assets_product_in_workspace'
  ) THEN
    ALTER TABLE content_assets
      ADD CONSTRAINT content_assets_product_in_workspace
      FOREIGN KEY (product_id, workspace_id)
      REFERENCES products(id, workspace_id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS content_assets_workspace_product
  ON content_assets(workspace_id, product_id);

-- ── 2. Governance lane ──────────────────────────────────────────────────────
-- Separates the ungoverned legacy Studio path from governed Content
-- Intelligence. Defaults to LEGACY_STUDIO so every existing and future
-- ungoverned write is labelled honestly rather than silently inheriting the
-- governed lane's guarantees.
ALTER TABLE content_assets
  ADD COLUMN IF NOT EXISTS governance TEXT NOT NULL DEFAULT 'LEGACY_STUDIO';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'content_assets_governance_check'
  ) THEN
    ALTER TABLE content_assets
      ADD CONSTRAINT content_assets_governance_check
      CHECK (governance IN ('LEGACY_STUDIO', 'GOVERNED_CONTENT_INTELLIGENCE'));
  END IF;
END $$;

-- ── 3. P1-26 — content approval, separate from everything ───────────────────
-- Binds to ONE version. Approving v2 must never carry over to v3.
ALTER TABLE content_assets
  ADD COLUMN IF NOT EXISTS content_approved_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS content_approved_version INTEGER,
  ADD COLUMN IF NOT EXISTS content_approved_by      UUID REFERENCES founders(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'content_approval_binds_a_version'
  ) THEN
    ALTER TABLE content_assets
      ADD CONSTRAINT content_approval_binds_a_version
      CHECK (content_approved_at IS NULL OR content_approved_version IS NOT NULL);
  END IF;
END $$;

COMMENT ON COLUMN content_assets.content_approved_at IS
  'ADR-070. The owner approved ONE immutable content version. Grants NO '
  'publish, campaign, send, spend or provider authority. Execution approval is '
  'deliberately unrepresentable in Phase 3.5.';
COMMENT ON COLUMN content_assets.approved_at IS
  'LEGACY Studio approval. Semantics frozen as-is for backwards compatibility. '
  'Governed Content Intelligence uses content_approved_at and never this column.';

-- ── 4. The legacy publish gate cannot reach governed content ────────────────
-- Structural, not a code check: a governed artifact has no publishing route at
-- all, so a forgotten guard in a handler cannot create one.
CREATE OR REPLACE FUNCTION lm_publishing_target_governance_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lane TEXT;
BEGIN
  SELECT governance INTO lane FROM content_assets WHERE id = NEW.asset_id;
  IF lane = 'GOVERNED_CONTENT_INTELLIGENCE' THEN
    RAISE EXCEPTION
      'publishing_targets: governed Content Intelligence artifacts have no publishing path in Phase 3.5'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS publishing_targets_governance_guard ON publishing_targets;
CREATE TRIGGER publishing_targets_governance_guard
  BEFORE INSERT ON publishing_targets
  FOR EACH ROW EXECUTE FUNCTION lm_publishing_target_governance_guard();

REVOKE ALL ON FUNCTION lm_publishing_target_governance_guard() FROM PUBLIC;

-- ── 5. Content strategy ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_strategies (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id     UUID NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
  founder_id     UUID NOT NULL REFERENCES founders(id)   ON DELETE CASCADE,
  -- Optional: the owner may start content without a recommendation.
  recommendation_id UUID REFERENCES growth_brain_recommendations(id) ON DELETE SET NULL,

  version        INTEGER NOT NULL DEFAULT 1,
  objective      TEXT NOT NULL,
  audience       TEXT NOT NULL,
  angle          TEXT NOT NULL,
  message_hierarchy JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- The load-bearing pair. proof_unavailable is NOT optional: a strategy that
  -- cannot name what it cannot prove will invent it downstream.
  proof_available   JSONB NOT NULL DEFAULT '[]'::jsonb,
  proof_unavailable JSONB NOT NULL DEFAULT '[]'::jsonb,
  cta_intent     TEXT,
  constraints    JSONB NOT NULL DEFAULT '[]'::jsonb,

  mode           TEXT NOT NULL DEFAULT 'SHADOW'
                 CHECK (mode IN ('OFF','SHADOW','ACTIVE')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_strategies_product_in_workspace') THEN
    ALTER TABLE content_strategies
      ADD CONSTRAINT content_strategies_product_in_workspace
      FOREIGN KEY (product_id, workspace_id) REFERENCES products(id, workspace_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS content_strategies_scope
  ON content_strategies(workspace_id, product_id, created_at DESC);

-- ── 6. Content brief — immutable once generated from ────────────────────────
CREATE TABLE IF NOT EXISTS content_briefs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id    UUID NOT NULL REFERENCES content_strategies(id) ON DELETE CASCADE,
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id     UUID NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
  founder_id     UUID NOT NULL REFERENCES founders(id)   ON DELETE CASCADE,

  content_channel TEXT NOT NULL
                  CHECK (content_channel IN ('google_ads_rsa','meta_ads','landing_page')),
  objective      TEXT NOT NULL,
  audience       TEXT NOT NULL,
  key_message    TEXT NOT NULL,
  tone           TEXT,
  cta_text       TEXT,
  cta_destination TEXT,
  offer          TEXT,
  constraints    JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Which fields the OWNER confirmed rather than the model inferring them.
  owner_confirmed JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Evidence available to this brief, as owner-safe descriptors. No handles.
  evidence_summary JSONB NOT NULL DEFAULT '[]'::jsonb,

  mode           TEXT NOT NULL DEFAULT 'SHADOW'
                 CHECK (mode IN ('OFF','SHADOW','ACTIVE')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_briefs_product_in_workspace') THEN
    ALTER TABLE content_briefs
      ADD CONSTRAINT content_briefs_product_in_workspace
      FOREIGN KEY (product_id, workspace_id) REFERENCES products(id, workspace_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS content_briefs_scope
  ON content_briefs(workspace_id, product_id, created_at DESC);

-- Link an artifact to what caused it. Nullable: legacy assets have neither.
ALTER TABLE content_assets
  ADD COLUMN IF NOT EXISTS strategy_id UUID REFERENCES content_strategies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS brief_ref_id UUID REFERENCES content_briefs(id)    ON DELETE SET NULL;

-- ── 7. RLS ──────────────────────────────────────────────────────────────────
-- Both are server-derived; a client has no reason to write either directly.
ALTER TABLE content_strategies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS content_strategies_member_read ON content_strategies;
CREATE POLICY content_strategies_member_read ON content_strategies
  FOR SELECT USING (lm_is_workspace_member(workspace_id));
REVOKE INSERT, UPDATE, DELETE ON content_strategies FROM authenticated, anon;
GRANT SELECT ON content_strategies TO authenticated;

ALTER TABLE content_briefs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS content_briefs_member_read ON content_briefs;
CREATE POLICY content_briefs_member_read ON content_briefs
  FOR SELECT USING (lm_is_workspace_member(workspace_id));
REVOKE INSERT, UPDATE, DELETE ON content_briefs FROM authenticated, anon;
GRANT SELECT ON content_briefs TO authenticated;

COMMIT;
