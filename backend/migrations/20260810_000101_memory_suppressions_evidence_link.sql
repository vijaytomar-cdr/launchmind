-- ============================================================================
-- 101 — Memory suppressions and the evidence dependency link
--
-- Phase 3.2A. Implements ADR-067 C20 (retraction / re-promotion suppression)
-- and the schema half of C21 (evidence invalidation must remain possible).
--
-- C20: suppression is a SEPARATE TABLE, not a lifecycle state. Adding a
-- `DEMOTED` state was explicitly rejected in Design A because suppression is a
-- statement about a CLAIM FAMILY, not about one row — the whole point is to stop
-- an equivalent claim being recreated as a brand-new memory, which a state on
-- the old row cannot express.
--
-- C21: the cascade itself is Design B. What must exist today is the ability to
-- ANSWER "which memories depend on this evidence?" — impossible against a bare
-- `evidence_ids UUID[]` with no foreign key.
-- ============================================================================

-- ── Suppressions (C20) ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memory_suppressions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- The claim FAMILY being suppressed, not a row id: a retracted belief must not
  -- come back wearing a new primary key.
  claim_fingerprint  TEXT NOT NULL,
  scope_key          TEXT,

  reason_class       TEXT NOT NULL CHECK (reason_class IN (
                       'FOUNDER_RETRACTION',    -- founder said no. Only a founder reverses it.
                       'FOUNDER_CORRECTION',    -- founder replaced the wording
                       'SYSTEM_INVALID_SOURCE', -- the source was bad, not the claim
                       'LEGAL_DELETION'         -- erased; never reopenable
                     )),
  reason_note        TEXT,

  -- Which evidence is barred. A candidate carrying a genuinely NEW independence
  -- key is not blocked by this list — that is how real new evidence still gets a
  -- hearing while a replay of the discredited evidence does not.
  suppressed_evidence_independence_keys TEXT[] NOT NULL DEFAULT '{}',

  origin_memory_id   UUID REFERENCES marketing_memories(id) ON DELETE SET NULL,
  created_by_actor   TEXT NOT NULL CHECK (created_by_actor IN ('founder','system','ai')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL = indefinite.
  expires_at         TIMESTAMPTZ,
  -- Set when a founder reverses the suppression; the row is kept, never deleted.
  reversed_at        TIMESTAMPTZ,
  reversed_by        TEXT,
  reversal_note      TEXT,
  trace_id           TEXT
);

-- One live suppression per claim family per scope. A second attempt updates the
-- existing one rather than stacking duplicates that would have to be reconciled.
CREATE UNIQUE INDEX IF NOT EXISTS memory_suppressions_live
  ON memory_suppressions (workspace_id, claim_fingerprint, COALESCE(scope_key, ''))
  WHERE reversed_at IS NULL;

CREATE INDEX IF NOT EXISTS memory_suppressions_lookup
  ON memory_suppressions (workspace_id, claim_fingerprint)
  WHERE reversed_at IS NULL;

ALTER TABLE memory_suppressions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_suppressions_ws_read ON memory_suppressions;
CREATE POLICY memory_suppressions_ws_read ON memory_suppressions
  FOR SELECT USING (lm_is_workspace_member(workspace_id));
REVOKE INSERT, UPDATE, DELETE ON memory_suppressions FROM authenticated, anon;
GRANT SELECT ON memory_suppressions TO authenticated;

COMMENT ON TABLE memory_suppressions IS
  'ADR-067 C20. Blocks re-promotion of a retracted or corrected claim family. '
  'NOT a lifecycle state (DEMOTED was rejected): suppression describes a claim, '
  'not a row, so a new row asserting the same claim is also blocked.';

-- ── Evidence dependency link (C21) ───────────────────────────────────────────
-- The canonical dependency edge. marketing_memories.evidence_ids is RETAINED
-- (additive-only rule) but this table is what makes invalidation answerable.
CREATE TABLE IF NOT EXISTS memory_evidence (
  memory_id     UUID NOT NULL REFERENCES marketing_memories(id) ON DELETE CASCADE,
  evidence_id   UUID NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- What this evidence did for the memory. `corroborating` is the one that
  -- counts toward the C6 corroboration rule.
  contribution  TEXT NOT NULL DEFAULT 'supporting'
                CHECK (contribution IN ('supporting','corroborating','contradicting')),
  -- Copied at attach time so corroboration can be counted without a join back
  -- to evidence, and so it survives evidence being invalidated later.
  independence_key TEXT,
  attached_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (memory_id, evidence_id)
);

CREATE INDEX IF NOT EXISTS memory_evidence_by_evidence
  ON memory_evidence (evidence_id);
CREATE INDEX IF NOT EXISTS memory_evidence_by_workspace
  ON memory_evidence (workspace_id, memory_id);

ALTER TABLE memory_evidence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_evidence_ws_read ON memory_evidence;
CREATE POLICY memory_evidence_ws_read ON memory_evidence
  FOR SELECT USING (lm_is_workspace_member(workspace_id));
REVOKE INSERT, UPDATE, DELETE ON memory_evidence FROM authenticated, anon;
GRANT SELECT ON memory_evidence TO authenticated;

-- ── Revalidation queue (C21 shape only) ──────────────────────────────────────
-- Reuses the outbox pattern proven by 093/098 rather than inventing a second
-- queueing mechanism. Design B fills it; nothing consumes it in 3.2A.
CREATE TABLE IF NOT EXISTS memory_revalidation_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  memory_id     UUID NOT NULL REFERENCES marketing_memories(id) ON DELETE CASCADE,
  reason        TEXT NOT NULL CHECK (reason IN
                  ('evidence_invalidated','evidence_deleted','evidence_reclassified','policy_change')),
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','processing','completed','cancelled','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by     TEXT,
  locked_at     TIMESTAMPTZ,
  last_error    TEXT,
  trace_id      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS memory_revalidation_one_open
  ON memory_revalidation_queue (memory_id, reason)
  WHERE status IN ('pending','processing');

ALTER TABLE memory_revalidation_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON memory_revalidation_queue FROM authenticated, anon;

COMMENT ON TABLE memory_revalidation_queue IS
  'ADR-067 C21. SHAPE ONLY in 3.2A — nothing enqueues or consumes yet. Present '
  'so evidence invalidation is implementable in Design B without a schema '
  'change that would have to migrate live memory.';
