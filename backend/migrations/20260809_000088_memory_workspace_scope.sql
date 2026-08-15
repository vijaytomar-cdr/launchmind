-- ============================================================================
-- 088 — Marketing Memory: founder scope → workspace scope
--
-- Phase 3.1B. Implements ADR-066 rule 42: workspace isolation must apply
-- independently to memories, versions, evidence, learning events and the
-- knowledge graph. These tables were created in migration 035-040 as
-- founder-scoped, before the workspace tenancy model landed in migration 080.
--
-- CLASSIFICATION (ADR-066 / Step 3.1B §1). Only class A and D tables are touched:
--   A workspace-owned      marketing_memories · learning_events ·
--                          knowledge_nodes · knowledge_edges · evidence
--   B global/anonymised    playbook_signals  — NO founder_id, NO workspace_id, by
--                          design (ADR-053 min-cohort anonymisation). Untouched.
--   C founder identity     founders · founder_context — identity, not tenant data.
--                          Untouched.
--   D derived child        marketing_memory_versions — inherits its parent memory's
--                          workspace. Given its own column so RLS can be enforced
--                          on the table directly rather than through a join.
--
-- ATTRIBUTION IS PRESERVED (Step 3.1B §2): founder_id is RETAINED on every table.
-- workspace_id answers "which tenant owns this"; founder_id answers "who did it".
-- Conflating them would destroy the ability to say who confirmed a belief.
--
-- BACKFILL IS DETERMINISTIC, NEVER A GUESS (Step 3.1B §3):
--   1. via product        product.workspace_id, when set                (exact)
--   2. via parent         versions inherit the parent memory            (exact)
--   3. via sole workspace founder owns EXACTLY ONE workspace            (unambiguous)
--   4. otherwise          left NULL and recorded in the audit table below
--
--   Rule 3 is not "pick the founder's default workspace" — that is explicitly
--   forbidden. It applies only where the founder has exactly one workspace, so
--   there is no choice to make and no information to lose. Founders with two or
--   more workspaces fall through to rule 4 and are never assigned by guesswork.
--
-- @security RLS is rewritten from `founder_id = auth.uid()` to workspace
--   membership via lm_is_workspace_member (migration 080). Reads require
--   membership; writes require owner/admin/editor via lm_can_write_workspace.
-- @idempotent Safe to run repeatedly.
-- ============================================================================

-- ── Audit of rows that could NOT be mapped ───────────────────────────────────
-- Preserved and classified rather than deleted or guessed at.
CREATE TABLE IF NOT EXISTS memory_workspace_backfill_audit (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table  TEXT        NOT NULL,
  source_id     UUID        NOT NULL,
  founder_id    UUID,
  reason        TEXT        NOT NULL
                CHECK (reason IN ('no_workspace_for_founder',
                                  'multiple_candidate_workspaces',
                                  'no_founder_reference')),
  candidate_ids UUID[]      NOT NULL DEFAULT '{}',
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_table, source_id)
);

COMMENT ON TABLE memory_workspace_backfill_audit IS
  'Rows migration 088 could not map to a workspace without guessing. Preserved for '
  'manual resolution; see docs/roadmap/phase-3.1-gap-analysis.md.';

-- ── 1. Add the column ────────────────────────────────────────────────────────
ALTER TABLE marketing_memories        ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE marketing_memory_versions ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE evidence                  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE learning_events           ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE knowledge_nodes           ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE knowledge_edges           ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;

-- ── 2. Backfill rule 1 — via product (exact) ─────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['marketing_memories','evidence','learning_events','knowledge_nodes']
  LOOP
    EXECUTE format($f$
      UPDATE %I x
         SET workspace_id = p.workspace_id
        FROM products p
       WHERE x.product_id = p.id
         AND p.workspace_id IS NOT NULL
         AND x.workspace_id IS NULL
    $f$, t);
  END LOOP;
END $$;

-- ── 3. Backfill rule 2 — versions inherit their parent memory (exact) ────────
UPDATE marketing_memory_versions v
   SET workspace_id = m.workspace_id
  FROM marketing_memories m
 WHERE v.memory_id = m.id
   AND m.workspace_id IS NOT NULL
   AND v.workspace_id IS NULL;

-- ── 4. Backfill rule 3 — founder owns exactly one workspace (unambiguous) ────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['marketing_memories','marketing_memory_versions','evidence',
                           'learning_events','knowledge_nodes','knowledge_edges']
  LOOP
    EXECUTE format($f$
      UPDATE %I x
         SET workspace_id = sole.id
        FROM (
          -- (array_agg(id))[1] rather than MIN(id): Postgres has no MIN() for
          -- uuid. HAVING COUNT(*) = 1 guarantees a single element, so the
          -- subscript is the only candidate, not an arbitrary pick.
          SELECT founder_id, (array_agg(id))[1] AS id
            FROM workspaces
           GROUP BY founder_id
          HAVING COUNT(*) = 1          -- exactly one candidate: no choice to make
        ) sole
       WHERE x.founder_id = sole.founder_id
         AND x.workspace_id IS NULL
    $f$, t);
  END LOOP;
END $$;

-- Versions may now resolve via a parent that was itself only just mapped.
UPDATE marketing_memory_versions v
   SET workspace_id = m.workspace_id
  FROM marketing_memories m
 WHERE v.memory_id = m.id
   AND m.workspace_id IS NOT NULL
   AND v.workspace_id IS NULL;

-- ── 5. Record whatever remains, with its reason ──────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['marketing_memories','marketing_memory_versions','evidence',
                           'learning_events','knowledge_nodes','knowledge_edges']
  LOOP
    EXECUTE format($f$
      INSERT INTO memory_workspace_backfill_audit (source_table, source_id, founder_id, reason, candidate_ids)
      SELECT %L, x.id, x.founder_id,
             CASE
               WHEN x.founder_id IS NULL THEN 'no_founder_reference'
               WHEN (SELECT COUNT(*) FROM workspaces w WHERE w.founder_id = x.founder_id) = 0
                 THEN 'no_workspace_for_founder'
               ELSE 'multiple_candidate_workspaces'
             END,
             COALESCE(ARRAY(SELECT w.id FROM workspaces w WHERE w.founder_id = x.founder_id), '{}')
        FROM %I x
       WHERE x.workspace_id IS NULL
      ON CONFLICT (source_table, source_id) DO NOTHING
    $f$, t, t);
  END LOOP;
END $$;

-- ── 6. Require workspace_id for FUTURE writes, once nothing is unmapped ──────
-- Promoted per-table and only when that table is fully mapped, so one
-- unresolvable legacy row cannot block tenancy enforcement everywhere else.
DO $$
DECLARE t TEXT; n BIGINT;
BEGIN
  FOREACH t IN ARRAY ARRAY['marketing_memories','marketing_memory_versions','evidence',
                           'learning_events','knowledge_nodes','knowledge_edges']
  LOOP
    EXECUTE format('SELECT COUNT(*) FROM %I WHERE workspace_id IS NULL', t) INTO n;
    IF n = 0 THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN workspace_id SET NOT NULL', t);
      RAISE NOTICE '088: %.workspace_id promoted to NOT NULL', t;
    ELSE
      RAISE WARNING '088: % has % unmapped row(s); workspace_id left nullable and audited', t, n;
    END IF;
  END LOOP;
END $$;

-- ── 7. Indexes ───────────────────────────────────────────────────────────────
-- Retrieval filters on workspace first from 3.1D onward; the founder-scoped
-- indexes are retained because founder_id remains the attribution key.
CREATE INDEX IF NOT EXISTS memories_workspace_type    ON marketing_memories(workspace_id, memory_type);
CREATE INDEX IF NOT EXISTS memories_workspace_status  ON marketing_memories(workspace_id, status);
CREATE INDEX IF NOT EXISTS memory_versions_workspace  ON marketing_memory_versions(workspace_id);
CREATE INDEX IF NOT EXISTS evidence_workspace         ON evidence(workspace_id);
CREATE INDEX IF NOT EXISTS learning_events_workspace  ON learning_events(workspace_id);
CREATE INDEX IF NOT EXISTS knowledge_nodes_workspace  ON knowledge_nodes(workspace_id);
CREATE INDEX IF NOT EXISTS knowledge_edges_workspace  ON knowledge_edges(workspace_id);

-- ── 8. RLS: workspace membership replaces founder ownership ──────────────────
-- Read = any accepted member. Write = owner/admin/editor. A viewer may read the
-- Growth Brain and may not rewrite its beliefs.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['marketing_memories','marketing_memory_versions','evidence',
                           'learning_events','knowledge_nodes','knowledge_edges']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    -- Drop the founder-scoped policies from migrations 035-040.
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'memories_owner',        t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'memory_versions_owner', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'evidence_owner',        t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'events_owner',          t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'nodes_owner',           t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'edges_owner',           t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_ws_read',  t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_ws_write', t);

    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (lm_is_workspace_member(workspace_id))',
      t || '_ws_read', t);

    -- INSERT/UPDATE/DELETE. Append-only tables are further restricted by
    -- migration 091; this policy governs who may write at all.
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (lm_can_write_workspace(workspace_id)) '
      'WITH CHECK (lm_can_write_workspace(workspace_id))',
      t || '_ws_write', t);
  END LOOP;
END $$;
