-- ============================================================================
-- 096 — Memory lifecycle, belief integrity, and complete version snapshots
--
-- Phase 3.1F. Implements ADR-066 rules 2, 3, 4, 28-32 and the lifecycle states
-- defined in the ADR body.
--
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ PART 1 FIXES A REAL DEFECT (Gate 0.5).                                   │
-- │                                                                          │
-- │ `marketing_memory_versions` snapshots content, source and confidence —   │
-- │ but NOT title, memory_type, status or evidence_ids, and no content hash. │
-- │                                                                          │
-- │ Title is the PRIMARY rendered field: weight A in the full-text vector    │
-- │ and the first line of the embedding rendering. So a historical version   │
-- │ could not reproduce what a model was actually shown, and                 │
-- │ reconstruction had no honest choice but to report `changed`.             │
-- │                                                                          │
-- │ The columns are added nullable. There are ZERO existing rows, so nothing │
-- │ is backfilled and nothing is lost; rows written from here carry the      │
-- │ complete snapshot.                                                       │
-- └──────────────────────────────────────────────────────────────────────────┘
--
-- LIFECYCLE (Part 2). The ADR defines five states. The existing column allows
-- draft/active/archived. Rather than retype it (build rule §1.2), the CHECK is
-- widened and `archived` is retained as an accepted legacy synonym for
-- SUPERSEDED — mapping it by UPDATE would rewrite history to make a schema
-- tidier, which is the one thing this milestone exists to prevent.
--
-- WHY NO SEPARATE `beliefs` TABLE (Step 3.1F §15). A belief is "LaunchMind's
-- current interpretation of accumulated evidence" — which is exactly what a
-- marketing_memory with a lifecycle state, a confidence, evidence links and an
-- append-only version chain already is. A parallel table would duplicate
-- identity, versioning, tenancy and RLS, and immediately raise "which one is
-- authoritative?" — the question invariant 1 exists to make unaskable. Memory
-- IS the belief; its versions ARE the belief versions.
--
-- @security No RLS relaxation. Challenges and comparison candidates are
--   workspace-scoped and readable by members; only service_role writes them.
-- @idempotent Safe to run repeatedly.
-- ============================================================================

-- ── PART 1 — complete the version snapshot ──────────────────────────────────
ALTER TABLE marketing_memory_versions
  ADD COLUMN IF NOT EXISTS title             TEXT,
  ADD COLUMN IF NOT EXISTS memory_type       TEXT,
  ADD COLUMN IF NOT EXISTS status            TEXT,
  ADD COLUMN IF NOT EXISTS evidence_ids      UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS content_hash      TEXT,
  ADD COLUMN IF NOT EXISTS rendering_version INTEGER,
  -- Why this version ended. NULL while it was current.
  ADD COLUMN IF NOT EXISTS change_reason     TEXT,
  ADD COLUMN IF NOT EXISTS valid_from        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS valid_until       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS learning_event_id UUID;

CREATE INDEX IF NOT EXISTS memory_versions_lookup
  ON marketing_memory_versions (memory_id, version);

COMMENT ON COLUMN marketing_memory_versions.title IS
  'Gate 0.5 (3.1F). Without the title a historical version cannot reproduce what '
  'the model was shown — title is weight A in search_tsv and the first line of '
  'the embedding rendering.';

-- ── PART 2 — lifecycle states ───────────────────────────────────────────────
DO $$
DECLARE cname TEXT;
BEGIN
  SELECT c.conname INTO cname
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'marketing_memories' AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%status%' LIMIT 1;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE marketing_memories DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE marketing_memories
  ADD CONSTRAINT marketing_memories_status_governed CHECK (status IN (
    'draft',
    'active',
    'challenged',    -- contradictory evidence exists; no decision finalised
    'superseded',    -- replaced by an accepted newer belief
    'stale',         -- possibly outdated by time, not by contradiction
    'retracted',     -- explicitly invalidated
    'archived'       -- legacy synonym for superseded; retained, never rewritten
  ));

ALTER TABLE marketing_memories
  ADD COLUMN IF NOT EXISTS superseded_by       UUID REFERENCES marketing_memories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retracted_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retraction_reason   TEXT,
  ADD COLUMN IF NOT EXISTS last_reinforced_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reinforcement_count INTEGER NOT NULL DEFAULT 0,
  -- Which decay policy applies. Derived from memory_type + source at write time.
  ADD COLUMN IF NOT EXISTS decay_class         TEXT
      CHECK (decay_class IS NULL OR decay_class IN
        ('NON_DECAYING','SLOW_DECAY','PERFORMANCE_DECAY','SOURCE_FRESHNESS_DRIVEN')),
  ADD COLUMN IF NOT EXISTS confidence_policy_version INTEGER,
  -- ADR-066 rule 4: business fact vs founder assertion vs model belief.
  ADD COLUMN IF NOT EXISTS assertion_class     TEXT
      CHECK (assertion_class IS NULL OR assertion_class IN
        ('business_fact','founder_assertion','model_belief')),
  -- Set when a change needs owner resolution rather than automatic application.
  ADD COLUMN IF NOT EXISTS review_required     BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS memories_lifecycle
  ON marketing_memories (workspace_id, status, confidence DESC);
CREATE INDEX IF NOT EXISTS memories_review_required
  ON marketing_memories (workspace_id) WHERE review_required;

-- Backfill assertion_class and decay_class deterministically from what is
-- already known. Nothing is invented: the mapping is the same one the service
-- applies to new rows.
UPDATE marketing_memories SET assertion_class =
  CASE WHEN source = 'founder_feedback' THEN 'founder_assertion'
       WHEN source IN ('campaign_performance','analytics','experiment','review') THEN 'business_fact'
       ELSE 'model_belief' END
 WHERE assertion_class IS NULL;

UPDATE marketing_memories SET decay_class =
  CASE WHEN source = 'founder_feedback' THEN 'NON_DECAYING'
       WHEN memory_type IN ('campaign','creative','experiment') THEN 'PERFORMANCE_DECAY'
       WHEN memory_type IN ('market','competitor','seasonality') THEN 'SOURCE_FRESHNESS_DRIVEN'
       ELSE 'SLOW_DECAY' END
 WHERE decay_class IS NULL;

-- ── PART 3 — challenges (founder authority, §5) ─────────────────────────────
-- A challenge is the mechanism by which contradictory evidence is RECORDED
-- without silently overriding anything. It is how LaunchMind can change its mind
-- without rewriting the owner's stated direction.
CREATE TABLE IF NOT EXISTS memory_challenges (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- The memory whose truth is in question.
  memory_id         UUID NOT NULL REFERENCES marketing_memories(id) ON DELETE CASCADE,
  memory_version    INTEGER NOT NULL,

  -- What contradicts it. Either another memory, or raw evidence.
  challenger_memory_id UUID REFERENCES marketing_memories(id) ON DELETE SET NULL,
  challenger_evidence_ids UUID[] NOT NULL DEFAULT '{}',

  classification    TEXT NOT NULL
                    CHECK (classification IN ('DUPLICATE','REINFORCEMENT','CONTRADICTION','UNRELATED')),
  -- How the classification was reached. `model_assisted` proposals are still
  -- decided by the policy engine (§9).
  decided_by        TEXT NOT NULL
                    CHECK (decided_by IN ('deterministic','model_assisted','founder')),
  rationale         TEXT,

  status            TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','resolved_kept','resolved_superseded','resolved_retracted','dismissed')),
  -- True when the challenged memory is founder-confirmed: LaunchMind may not
  -- resolve it automatically (§17).
  requires_founder_review BOOLEAN NOT NULL DEFAULT false,

  resolved_at       TIMESTAMPTZ,
  resolved_by       TEXT,
  resolution_note   TEXT,

  trace_id          TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memory_challenges_open
  ON memory_challenges (workspace_id, status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS memory_challenges_memory
  ON memory_challenges (memory_id);

-- One OPEN challenge per (memory, challenger) pair — repeated detection of the
-- same conflict must not create a queue of identical review items.
CREATE UNIQUE INDEX IF NOT EXISTS memory_challenges_one_open
  ON memory_challenges (memory_id, COALESCE(challenger_memory_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'open';

-- ── PART 4 — versioned confidence policy (§10) ──────────────────────────────
-- The formula lives in TypeScript; this table records WHICH version produced a
-- given confidence, so a score can be explained years later even after the
-- policy has changed. Storing the version is what makes confidence auditable
-- rather than merely numeric.
CREATE TABLE IF NOT EXISTS confidence_policies (
  version      INTEGER PRIMARY KEY,
  description  TEXT NOT NULL,
  inputs       TEXT[] NOT NULL,
  floor        NUMERIC(3,2) NOT NULL CHECK (floor >= 0 AND floor <= 1),
  active       BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO confidence_policies (version, description, inputs, floor, active) VALUES
  (1,
   'Deterministic v1. Confidence is the STRENGTH OF SUPPORT for a LaunchMind belief, '
   'not the probability that the statement is objectively true.',
   ARRAY['source_precedence','independent_evidence_count','recency','contradiction_count',
         'reinforcement_count','founder_confirmation','decay_class'],
   0.25, true)
ON CONFLICT (version) DO NOTHING;

-- ── PART 5 — evidence independence (§14) ────────────────────────────────────
-- Counting the same GA4 import twice as two confirmations would inflate
-- confidence without new information. A stable fingerprint over
-- (source_table, source_id) makes the duplicate detectable.
-- A GENERATED column, not a backfilled one.
--
-- The obvious implementation — add the column, then UPDATE every row — is
-- REFUSED by the append-only trigger from migration 091 ("evidence rows cannot
-- be updated"). That refusal is correct, and working around it with the erasure
-- flag would use a legal-erasure escape hatch for a schema change.
--
-- Generating the value removes the need to write at all: it exists for every
-- existing row the moment the column is added, and it cannot drift from the
-- source fields it summarises.
ALTER TABLE evidence
  ADD COLUMN IF NOT EXISTS independence_key TEXT
  GENERATED ALWAYS AS (COALESCE(source_table, 'unknown') || ':' || COALESCE(source_id, id::text)) STORED;

CREATE INDEX IF NOT EXISTS evidence_independence
  ON evidence (workspace_id, independence_key);

COMMENT ON COLUMN evidence.independence_key IS
  'ADR-066 rule 30. Two evidence rows sharing this key are the SAME observation '
  'imported twice, not two independent confirmations.';

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE memory_challenges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_challenges_ws_read ON memory_challenges;
CREATE POLICY memory_challenges_ws_read ON memory_challenges
  FOR SELECT USING (lm_is_workspace_member(workspace_id));
REVOKE INSERT, UPDATE, DELETE ON memory_challenges FROM authenticated, anon;
GRANT SELECT ON memory_challenges TO authenticated;

ALTER TABLE confidence_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS confidence_policies_read ON confidence_policies;
CREATE POLICY confidence_policies_read ON confidence_policies FOR SELECT USING (true);
GRANT SELECT ON confidence_policies TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON confidence_policies FROM authenticated, anon;

-- ── PART 6 — product archive vs legal erasure (§20) ─────────────────────────
/**
 * Ordinary product removal: ARCHIVE, never DELETE.
 *
 * Resolves the 3.1C finding that deleting a product cascades into append-only
 * evidence and is refused by the immutability trigger. That refusal is correct —
 * ordinary product lifecycle must not destroy learning. The answer is not to
 * weaken the trigger but to stop calling DELETE for something that is not an
 * erasure.
 *
 * Historical memory is retained and remains reachable by historical explanation;
 * only everyday retrieval stops surfacing it.
 */
CREATE OR REPLACE FUNCTION lm_archive_product(p_product_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS TABLE (memories_marked BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n BIGINT;
BEGIN
  UPDATE products
     SET archived_at = now(),
         archive_reason = COALESCE(p_reason, 'product archived')
   WHERE id = p_product_id;

  -- Memory is NOT deleted and NOT retracted: nothing was found to be untrue.
  -- It becomes stale, which excludes it from everyday retrieval while leaving
  -- it fully available to historical explanation.
  UPDATE marketing_memories
     SET status = 'stale'
   WHERE product_id = p_product_id AND status = 'active';
  GET DIAGNOSTICS n = ROW_COUNT;

  RETURN QUERY SELECT n;
END $$;

REVOKE ALL ON FUNCTION lm_archive_product(UUID, TEXT) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION lm_archive_product(UUID, TEXT) TO service_role;

COMMENT ON FUNCTION lm_archive_product(UUID, TEXT) IS
  'Ordinary product lifecycle. Preserves learning. Legal erasure is a different '
  'operation entirely — see lm_erase_founder_history (migration 091).';
