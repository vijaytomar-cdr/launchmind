-- ============================================================================
-- 118 — Governed content artifact status, variants and version governance.
--       Phase 3.5B3.1. CLOSES P1-58.
--
-- WHY A SEPARATE STATUS COLUMN. `content_assets.status` belongs to the legacy
-- Studio lane and its vocabulary reaches into publishing. The governed lane
-- needs a state machine that CANNOT express execution, so it gets its own
-- column with a CHECK limited to five content-level states. Overloading the
-- existing column would have made "approved" mean two different things — the
-- exact defect migration 114 had to unwind for `approved_at`.
--
-- VARIANTS ARE ARTIFACTS, VERSIONS ARE HISTORY. A variant group id plus a label
-- on `content_assets` keeps alternatives as separate artifacts that each start
-- at version 1, while `content_versions` (047, append-only) stays the history of
-- one artifact. Conflating them is how an A/B test becomes an overwrite.
--
-- change_type REUSES the existing vocabulary from 047 ('ai_regen',
-- 'editor_save') rather than adding values, so no existing consumer changes.
--
-- ADDITIVE ONLY. Idempotent. Every column is nullable or defaulted; legacy rows
-- keep their meaning and the legacy lane is untouched.
-- @security A governed artifact has no column able to record publication,
--   launch, schedule or spend. Execution remains unrepresentable here.
-- @dependencies content_assets (026, 050, 114, 117), content_versions (047)
-- ============================================================================

BEGIN;

ALTER TABLE content_assets
  ADD COLUMN IF NOT EXISTS content_status TEXT,
  ADD COLUMN IF NOT EXISTS variant_group_id UUID,
  ADD COLUMN IF NOT EXISTS variant_label TEXT,
  ADD COLUMN IF NOT EXISTS content_brief_id UUID REFERENCES content_briefs(id) ON DELETE SET NULL;

DO $$
BEGIN
  -- Five content-level states. EXECUTED, LAUNCHED, PUBLISHED and
  -- SPEND_APPROVED are deliberately absent and cannot be written.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_assets_content_status_check') THEN
    ALTER TABLE content_assets ADD CONSTRAINT content_assets_content_status_check
      CHECK (content_status IS NULL OR content_status IN (
        'DRAFT', 'REWRITE_REQUIRED', 'OWNER_CONFIRMATION_REQUIRED',
        'ELIGIBLE_FOR_CONTENT_APPROVAL', 'CONTENT_APPROVED'));
  END IF;

  -- A variant label without a group is an alternative to nothing.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_assets_variant_pairing') THEN
    ALTER TABLE content_assets ADD CONSTRAINT content_assets_variant_pairing
      CHECK (variant_label IS NULL OR variant_group_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS content_assets_variant_group
  ON content_assets(variant_group_id) WHERE variant_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_assets_governed_scope
  ON content_assets(workspace_id, product_id, content_status)
  WHERE governance = 'GOVERNED_CONTENT_INTELLIGENCE';

-- ── Version-level governance record ─────────────────────────────────────────
-- Enough to reproduce WHAT THE OWNER SAW and why it was allowed. Deliberately
-- NOT the prompt or the model's reasoning: a version is a record of the
-- decision, not a transcript of the machine.
ALTER TABLE content_versions
  ADD COLUMN IF NOT EXISTS disposition TEXT,
  ADD COLUMN IF NOT EXISTS governance_summary JSONB,
  ADD COLUMN IF NOT EXISTS brand_kit_version INTEGER,
  ADD COLUMN IF NOT EXISTS evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS authorized_asset_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_versions_disposition_check') THEN
    ALTER TABLE content_versions ADD CONSTRAINT content_versions_disposition_check
      CHECK (disposition IS NULL OR disposition IN (
        'ELIGIBLE', 'REWRITE_REQUIRED', 'OWNER_CONFIRMATION_REQUIRED',
        'PROHIBITED', 'DEGRADED'));
  END IF;
END $$;

COMMENT ON COLUMN content_assets.content_status IS
  'Governed content lane state. Cannot express publication, launch, schedule or '
  'spend — those are 3.6 concerns and have no column here.';
COMMENT ON COLUMN content_versions.governance_summary IS
  'What was checked and what it concluded, in owner-safe terms. Never the '
  'prompt, never model reasoning, never an evidence handle.';
COMMENT ON COLUMN content_versions.brand_kit_version IS
  'The Brand Kit version this version was generated against. A later rebrand '
  'must not rewrite what a past artifact used.';

COMMIT;
