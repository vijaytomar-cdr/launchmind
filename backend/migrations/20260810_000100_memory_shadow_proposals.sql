-- ============================================================================
-- 100 — Durable SHADOW proposal store
--
-- Phase 3.2A. Implements ADR-067 C18 (shadow proposal contract), C14 (candidate
-- idempotency), C19 (traceability), and the reproducibility requirement that a
-- proposal must be explicable after policies change.
--
-- WHY THIS IS NOT `learning_events`. A learning event is an authoritative record
-- that something HAPPENED. A shadow proposal records what WOULD have happened.
-- Writing proposals into learning_events would make the audit trail assert
-- transitions that never occurred, which is the one thing the traceability
-- invariant forbids.
--
-- WHY TWO TABLES. Retrieval rank and the per-pair comparison result are the
-- inputs that decide the outcome. Collapsing them into a JSONB blob on the
-- proposal would make precision unattributable — you could see that a proposal
-- was wrong but not which comparison made it wrong.
--
-- APPEND-ONLY except for the reserved adjudication columns, which are the one
-- thing a human is expected to write later.
-- ============================================================================

CREATE TABLE IF NOT EXISTS memory_shadow_proposals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id            UUID REFERENCES products(id) ON DELETE SET NULL,

  -- ── Candidate identity (C14) ───────────────────────────────────────────────
  -- Deterministic. A replay of the same evidence produces the same key and is
  -- rejected by this unique index rather than by application logic.
  idempotency_key       TEXT NOT NULL,

  claim_text            TEXT NOT NULL,
  normalized_claim      TEXT NOT NULL,
  memory_class          TEXT NOT NULL
                        CHECK (memory_class IN ('DIRECTIVE','FACT','LEARNING','DECISION')),

  -- ── Governed scope (C10), snapshotted ─────────────────────────────────────
  scope                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  scope_key             TEXT,
  scope_specificity     INTEGER NOT NULL DEFAULT 0,
  scope_completeness    TEXT NOT NULL
                        CHECK (scope_completeness IN ('explicit','partial','unknown')),

  -- ── Authority AS APPLIED (C4/I4) ──────────────────────────────────────────
  authority_tier        TEXT NOT NULL
                        CHECK (authority_tier IN (
                          'FOUNDER_ASSERTED','FOUNDER_CONFIRMED','EXPERIMENT_CONTROLLED',
                          'OBSERVED_FIRST_PARTY','VERIFIED_EXTERNAL','DERIVED_INFERENCE',
                          'ANONYMIZED_PLAYBOOK')),

  provenance            JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_ids          UUID[] NOT NULL DEFAULT '{}',
  -- Independence is what makes corroboration meaningful (C6); two readings from
  -- the same source are one observation, however many times they arrive.
  evidence_independence_keys TEXT[] NOT NULL DEFAULT '{}',

  -- ── Gate A (C5) ───────────────────────────────────────────────────────────
  eligibility_result       TEXT NOT NULL
                           CHECK (eligibility_result IN ('ELIGIBLE','INELIGIBLE','EVIDENCE_ONLY')),
  eligibility_reason_code  TEXT,
  eligibility_policy_version INTEGER NOT NULL,

  -- ── Retrieval diagnostics (C15) ───────────────────────────────────────────
  retrieval_mode        TEXT,
  retrieval_degraded    BOOLEAN NOT NULL DEFAULT false,
  related_memory_count  INTEGER NOT NULL DEFAULT 0,
  retrieval_diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- ── Gate B (C5) ───────────────────────────────────────────────────────────
  promotion_outcome     TEXT
                        CHECK (promotion_outcome IS NULL OR promotion_outcome IN (
                          'CREATE_NEW','REINFORCE','SUPERSEDE','CHALLENGE',
                          'CREATE_SCOPED_EXCEPTION','NO_OP','KEEP_AS_EVIDENCE_ONLY')),
  promotion_reason_code TEXT,
  target_memory_id      UUID REFERENCES marketing_memories(id) ON DELETE SET NULL,
  target_memory_version INTEGER,
  exception_to_memory_id UUID REFERENCES marketing_memories(id) ON DELETE SET NULL,

  -- ── The transition that WOULD have occurred ───────────────────────────────
  proposed_action        TEXT,
  proposed_entry_state   TEXT,
  lifecycle_before       TEXT,
  lifecycle_after        TEXT,
  confidence_before      NUMERIC(3,2),
  confidence_after       NUMERIC(3,2),
  requires_founder_review BOOLEAN NOT NULL DEFAULT false,

  -- ── Policy versions (C4, C9, ADR-067 reproducibility) ─────────────────────
  authority_policy_version  INTEGER NOT NULL,
  comparison_policy_version INTEGER,
  promotion_policy_version  INTEGER,
  confidence_policy_version INTEGER,
  scope_policy_version      INTEGER NOT NULL,
  importance_policy_version INTEGER,
  quality_policy_version    INTEGER,
  retrieval_policy_version  INTEGER,

  -- Derived scores are SNAPSHOTTED because they are otherwise unreproducible
  -- once a formula changes — which is the entire point of C9's versioning.
  importance_score      NUMERIC(4,3),
  quality_score         NUMERIC(4,3),

  -- ── Model accounting (C15) ────────────────────────────────────────────────
  deterministic_only    BOOLEAN NOT NULL DEFAULT true,
  model_call_count      INTEGER NOT NULL DEFAULT 0,
  model_request_ids     TEXT[] NOT NULL DEFAULT '{}',
  comparison_unavailable BOOLEAN NOT NULL DEFAULT false,

  ingestion_mode        TEXT NOT NULL DEFAULT 'shadow',
  trace_id              TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ── Reserved for later human adjudication (C18). Schema only. ─────────────
  adjudication_label          TEXT
                              CHECK (adjudication_label IS NULL OR adjudication_label IN
                                ('CORRECT','INCORRECT','PARTIALLY_CORRECT','UNSURE')),
  adjudication_error_category TEXT,
  adjudicated_by              TEXT,
  adjudicated_at              TIMESTAMPTZ,
  adjudication_note           TEXT
);

-- Candidate identity. This is the idempotency guarantee: a replay cannot create
-- a second proposal, enforced by the database rather than by a check-then-insert
-- race in the application.
CREATE UNIQUE INDEX IF NOT EXISTS memory_shadow_proposals_idempotency
  ON memory_shadow_proposals (workspace_id, idempotency_key);

CREATE INDEX IF NOT EXISTS memory_shadow_proposals_ws_created
  ON memory_shadow_proposals (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS memory_shadow_proposals_outcome
  ON memory_shadow_proposals (workspace_id, promotion_outcome);
CREATE INDEX IF NOT EXISTS memory_shadow_proposals_unadjudicated
  ON memory_shadow_proposals (workspace_id, created_at DESC)
  WHERE adjudication_label IS NULL;

-- ── Per-comparison detail ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memory_shadow_proposal_comparisons (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id       UUID NOT NULL REFERENCES memory_shadow_proposals(id) ON DELETE CASCADE,
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  memory_id         UUID NOT NULL REFERENCES marketing_memories(id) ON DELETE CASCADE,
  -- Version is snapshotted so a later reconstruction compares against the
  -- memory AS IT WAS, not as it is now.
  memory_version    INTEGER NOT NULL,
  memory_scope_key  TEXT,
  memory_class      TEXT,
  memory_authority_tier TEXT,
  memory_is_legacy  BOOLEAN NOT NULL DEFAULT false,

  lexical_rank      INTEGER,
  semantic_rank     INTEGER,
  fused_rank        INTEGER,
  final_rank        INTEGER,
  semantic_distance DOUBLE PRECISION,

  classification    TEXT
                    CHECK (classification IS NULL OR classification IN
                      ('DUPLICATE','REINFORCEMENT','CONTRADICTION','UNRELATED')),
  rationale_code    TEXT,
  ambiguity         NUMERIC(4,3),
  decided_by        TEXT CHECK (decided_by IS NULL OR decided_by IN
                      ('deterministic','model_assisted','skipped_budget','unavailable')),
  model_request_id  TEXT,

  scope_relation    TEXT CHECK (scope_relation IS NULL OR scope_relation IN
                      ('same','narrower','broader','different','unknown')),

  belief_policy_action    TEXT,
  requires_founder_review BOOLEAN NOT NULL DEFAULT false,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shadow_comparisons_proposal
  ON memory_shadow_proposal_comparisons (proposal_id);
CREATE INDEX IF NOT EXISTS shadow_comparisons_memory
  ON memory_shadow_proposal_comparisons (memory_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE memory_shadow_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_shadow_proposal_comparisons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shadow_proposals_ws_read ON memory_shadow_proposals;
CREATE POLICY shadow_proposals_ws_read ON memory_shadow_proposals
  FOR SELECT USING (lm_is_workspace_member(workspace_id));

DROP POLICY IF EXISTS shadow_comparisons_ws_read ON memory_shadow_proposal_comparisons;
CREATE POLICY shadow_comparisons_ws_read ON memory_shadow_proposal_comparisons
  FOR SELECT USING (lm_is_workspace_member(workspace_id));

-- Proposals are written by the engine running as service_role, never by a client.
REVOKE INSERT, UPDATE, DELETE ON memory_shadow_proposals FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON memory_shadow_proposal_comparisons FROM authenticated, anon;
GRANT SELECT ON memory_shadow_proposals TO authenticated;
GRANT SELECT ON memory_shadow_proposal_comparisons TO authenticated;

-- ── Append-only except adjudication ──────────────────────────────────────────
-- A proposal records a decision that was made at a point in time. Rewriting it
-- would destroy the only record of what the system believed then. Adjudication
-- columns are the sole exception, because labelling is the intended later step.
CREATE OR REPLACE FUNCTION lm_shadow_proposal_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'shadow proposals are append-only' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*) THEN
    IF NEW.id                    IS DISTINCT FROM OLD.id
    OR NEW.workspace_id          IS DISTINCT FROM OLD.workspace_id
    OR NEW.idempotency_key       IS DISTINCT FROM OLD.idempotency_key
    OR NEW.claim_text            IS DISTINCT FROM OLD.claim_text
    OR NEW.promotion_outcome     IS DISTINCT FROM OLD.promotion_outcome
    OR NEW.authority_tier        IS DISTINCT FROM OLD.authority_tier
    OR NEW.authority_policy_version IS DISTINCT FROM OLD.authority_policy_version
    OR NEW.scope                 IS DISTINCT FROM OLD.scope
    OR NEW.created_at            IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'shadow proposal decision fields are immutable; only adjudication may be written'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS memory_shadow_proposals_append_only ON memory_shadow_proposals;
CREATE TRIGGER memory_shadow_proposals_append_only
  BEFORE UPDATE OR DELETE ON memory_shadow_proposals
  FOR EACH ROW EXECUTE FUNCTION lm_shadow_proposal_append_only();

-- ── Observability (C22, and the §29 metric hooks) ────────────────────────────
CREATE OR REPLACE VIEW memory_shadow_metrics AS
SELECT
  workspace_id,
  COUNT(*)                                                            AS candidates_total,
  COUNT(*) FILTER (WHERE eligibility_result = 'ELIGIBLE')             AS gate_a_pass,
  COUNT(*) FILTER (WHERE eligibility_result = 'INELIGIBLE')           AS gate_a_reject,
  COUNT(*) FILTER (WHERE eligibility_result = 'EVIDENCE_ONLY')        AS gate_a_evidence_only,
  COUNT(*) FILTER (WHERE promotion_outcome = 'CREATE_NEW')            AS proposed_create_new,
  COUNT(*) FILTER (WHERE proposed_entry_state = 'draft')              AS proposed_draft,
  COUNT(*) FILTER (WHERE promotion_outcome = 'REINFORCE')             AS proposed_reinforce,
  COUNT(*) FILTER (WHERE promotion_outcome = 'NO_OP')                 AS proposed_no_op,
  COUNT(*) FILTER (WHERE promotion_outcome = 'CHALLENGE')             AS proposed_challenge,
  COUNT(*) FILTER (WHERE promotion_outcome = 'SUPERSEDE')             AS proposed_supersede,
  COUNT(*) FILTER (WHERE promotion_outcome = 'CREATE_SCOPED_EXCEPTION') AS proposed_scoped_exception,
  COUNT(*) FILTER (WHERE promotion_outcome = 'KEEP_AS_EVIDENCE_ONLY') AS proposed_evidence_only,
  COUNT(*) FILTER (WHERE requires_founder_review)                     AS requires_founder_review,
  COUNT(*) FILTER (WHERE NOT deterministic_only)                      AS model_deferred,
  COUNT(*) FILTER (WHERE comparison_unavailable)                      AS comparison_unavailable,
  COALESCE(SUM(model_call_count), 0)                                  AS model_calls_total,
  COALESCE(MAX(model_call_count), 0)                                  AS model_calls_max_per_candidate,
  COALESCE(AVG(related_memory_count), 0)::NUMERIC(6,2)                AS avg_related_retrieved
FROM memory_shadow_proposals
GROUP BY workspace_id;

GRANT SELECT ON memory_shadow_metrics TO service_role;

CREATE OR REPLACE VIEW memory_gate_a_rejections AS
SELECT workspace_id, eligibility_reason_code, COUNT(*) AS n
FROM memory_shadow_proposals
WHERE eligibility_result = 'INELIGIBLE'
GROUP BY workspace_id, eligibility_reason_code;

GRANT SELECT ON memory_gate_a_rejections TO service_role;
