-- ============================================================================
-- 108 — Growth Brain recommendations + owner decisions (Phase 3.3D)
--
-- WHY A NEW TABLE. Four existing structures were evaluated first:
--
--   saved_opportunities        PARTIAL — has no workspace_id (only founder_id +
--                              product_id), its state vocabulary is
--                              active|saved|dismissed|converted with no
--                              APPROVED/DEFERRED/READY_FOR_ACTION, and it has no
--                              slot for approval requirement, founder conflict,
--                              evidence strength or an immutable provenance
--                              snapshot. It also carries the legacy
--                              confidence 0.5 column (backlog P1-9); folding the
--                              grounded surface into it would pull that
--                              contract back in.
--   mission_approvals          NO — mission_id and step_id are NOT NULL. A
--                              Growth Brain recommendation has no mission.
--   campaign_approvals         NO — campaign_id is NOT NULL.
--   connection_permission_hist NO for storage, but it IS the right PATTERN:
--                              workspace-scoped, append-only, snapshot +
--                              previous_snapshot, actor_type, reason. Followed
--                              here.
--
-- Identity and decision live in ONE row on purpose. The owner decides about a
-- specific recommendation, so splitting identity from decision would create a
-- join whose only job is to be kept consistent.
--
-- ADDITIVE ONLY. No backfill, no reinterpretation of existing rows.
-- @security workspace_id is NOT NULL and RLS-enforced: a decision cannot exist
--   outside a workspace, so cross-business mutation has no representation.
-- ============================================================================

CREATE TABLE IF NOT EXISTS growth_brain_recommendations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Business scope. workspace_id NOT NULL is the isolation guarantee.
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id        UUID          REFERENCES products(id)   ON DELETE CASCADE,
  founder_id        UUID NOT NULL REFERENCES founders(id)   ON DELETE CASCADE,

  -- Idempotency, following the missions.idempotency_key pattern.
  -- Stable hash of (workspace, product, action type, what) so a page refresh or
  -- a retried POST resolves to the SAME row rather than a second decision.
  fingerprint       TEXT NOT NULL,

  -- ── IMMUTABLE SNAPSHOT, as grounded at recommendation time ────────────────
  -- Never regenerated. Current context may change; the audit trail must reflect
  -- the evidence that actually existed when LaunchMind said this.
  what              TEXT NOT NULL,
  why_now           TEXT NOT NULL,
  next_step         TEXT NOT NULL,
  expected_effect   TEXT,
  action_type       TEXT NOT NULL
                    CHECK (action_type IN (
                      'REVIEW_CONTEXT','RESEARCH','DRAFT_CONTENT',
                      'RUN_EXPERIMENT','LAUNCH_CAMPAIGN','CHANGE_SPEND')),
  -- Server-decided from action_type. The client never supplies this.
  requires_approval BOOLEAN NOT NULL,
  evidence_strength TEXT NOT NULL
                    CHECK (evidence_strength IN (
                      'strong evidence','some evidence',
                      'limited evidence','insufficient evidence')),
  -- Claim-level provenance exactly as shown to the owner (Phase 3.3C).
  supported_by      JSONB NOT NULL DEFAULT '[]'::jsonb,
  supporting        JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Non-null when the recommendation opposed founder-authority direction.
  founder_conflict  JSONB,
  contract_version  INTEGER NOT NULL DEFAULT 1,

  -- ── OWNER DECISION ────────────────────────────────────────────────────────
  decision_status   TEXT NOT NULL DEFAULT 'RECOMMENDED'
                    CHECK (decision_status IN (
                      'RECOMMENDED','APPROVED','DISMISSED','DEFERRED')),
  -- DELIBERATELY SEPARATE from decision_status, and deliberately without an
  -- 'EXECUTED' value: 3.3D authorises future action, it never performs one.
  -- A later milestone that genuinely executes must extend this constraint,
  -- which makes "we accidentally shipped execution" impossible to do quietly.
  execution_status  TEXT NOT NULL DEFAULT 'NOT_STARTED'
                    CHECK (execution_status IN ('NOT_STARTED','READY_FOR_ACTION')),

  -- Founder-conflict protection survives the decision. Approving a conflicting
  -- recommendation records the acknowledgement rather than erasing the flag.
  founder_review_required     BOOLEAN NOT NULL DEFAULT false,
  founder_review_acknowledged BOOLEAN NOT NULL DEFAULT false,

  decided_at        TIMESTAMPTZ,
  decided_by        UUID REFERENCES founders(id),
  decision_note     TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per recommendation per business. This is what makes a repeated GET,
-- a page refresh and a double-clicked Approve converge instead of multiplying.
CREATE UNIQUE INDEX IF NOT EXISTS growth_brain_recommendations_fingerprint
  ON growth_brain_recommendations(workspace_id, fingerprint);

CREATE INDEX IF NOT EXISTS growth_brain_recommendations_scope
  ON growth_brain_recommendations(workspace_id, product_id, decision_status);

ALTER TABLE growth_brain_recommendations ENABLE ROW LEVEL SECURITY;

-- Read/write only for members of the owning workspace. Uses the helper
-- installed by migration 080 rather than re-deriving membership here.
DROP POLICY IF EXISTS growth_brain_recommendations_member_read ON growth_brain_recommendations;
CREATE POLICY growth_brain_recommendations_member_read
  ON growth_brain_recommendations FOR SELECT
  USING (lm_is_workspace_member(workspace_id));

DROP POLICY IF EXISTS growth_brain_recommendations_member_write ON growth_brain_recommendations;
CREATE POLICY growth_brain_recommendations_member_write
  ON growth_brain_recommendations FOR UPDATE
  USING (lm_can_write_workspace(workspace_id));
