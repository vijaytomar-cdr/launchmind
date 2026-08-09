-- Migration: 20260808_000087_intelligence_signals_workspace_dedup
--
-- DATA-INTEGRITY FIX (Step 8 finding L4).
--
-- Migration 080 made intelligence_signals workspace-scoped, but its uniqueness rule
-- (migration 078) stayed keyed on founder_id:
--
--   UNIQUE (founder_id, provider, signal_type, period_start, period_end)
--
-- The tenancy boundary is the WORKSPACE, and one founder may own several. When the
-- same founder connects the same provider in two workspaces, both import genuinely
-- different data for the same (provider, signal_type, period). Under the old index
-- those rows collide, and because the service upserts with ignoreDuplicates the
-- SECOND workspace's signal was silently discarded — no error, no log, just missing
-- intelligence in one tenant.
--
-- Migration 080 made exactly this correction for workspace_connections
-- (UNIQUE(founder_id, provider) → UNIQUE(workspace_id, provider)) and this table was
-- missed. This finishes that change.
--
-- SAFETY
--   The new index is created FIRST and verified before the old one is dropped, so at
--   no point is the table without replay protection.
--
--   Dropping an index is not a data-destructive operation: no column, table, or row
--   is touched, and the old index is fully reconstructible from this file. It is
--   dropped rather than left in place because leaving it would keep enforcing the
--   very collision this migration exists to remove.
--
--   The new index is deliberately NOT PARTIAL, unlike 078. This is a second, separate
--   defect found while fixing the first: PostgreSQL cannot infer a PARTIAL index as
--   the arbiter for `ON CONFLICT (cols)` unless the statement repeats the index
--   predicate, and PostgREST's on_conflict parameter cannot express one. So the
--   service's upsert against 078's partial index raised
--     42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification
--   meaning EVERY sync that imported signals would have failed at the persistence
--   step. No test caught it because MemoryDb does not enforce indexes, and no live
--   sync has ever run.
--
--   A plain unique index has identical de-duplication semantics here. Postgres treats
--   NULLs as distinct by default, so period-less ad-hoc signals still never collide
--   with each other (verified in workspaceSignalDedup.pg.test.ts), while signals that
--   do carry a period dedupe exactly as intended — and the index is inferrable.
--
--   Rows with a NULL workspace_id cannot be indexed meaningfully. Migration 080
--   backfills and promotes workspace_id to NOT NULL, so in a migrated database there
--   are none; the guard below keeps this migration safe on a database where 080's
--   NOT NULL promotion was skipped.
--
-- Additive in effect and idempotent: safe to run twice.

-- 1. Pre-flight: a workspace-scoped unique index cannot be built while duplicates
--    exist. Report them loudly instead of failing with an opaque index error.
DO $$
DECLARE
  dupe_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dupe_count FROM (
    SELECT workspace_id, provider, signal_type, period_start, period_end
    FROM intelligence_signals
    WHERE workspace_id IS NOT NULL AND period_start IS NOT NULL
    GROUP BY workspace_id, provider, signal_type, period_start, period_end
    HAVING COUNT(*) > 1
  ) d;

  IF dupe_count > 0 THEN
    RAISE EXCEPTION
      'Cannot create workspace-scoped dedup index: % duplicate (workspace_id, provider, signal_type, period) group(s) already exist. Resolve these rows first.',
      dupe_count;
  END IF;
END $$;

-- 2. Create the correct index BEFORE removing the old one.
CREATE UNIQUE INDEX IF NOT EXISTS intelligence_signals_workspace_dedup
  ON intelligence_signals (workspace_id, provider, signal_type, period_start, period_end);

COMMENT ON INDEX intelligence_signals_workspace_dedup IS
  'Replay protection, scoped to the workspace tenancy boundary. Not partial: ON CONFLICT cannot infer a partial index. NULL period_start values remain mutually distinct, so period-less signals are still not deduped.';

-- 3. Only once the replacement exists, retire the founder-scoped rule.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'intelligence_signals_workspace_dedup')
     AND EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'intelligence_signals_dedup')
  THEN
    DROP INDEX intelligence_signals_dedup;
  END IF;
END $$;

-- 4. The hot read path is workspace-scoped too (getCanonicalConnectionStates,
--    readSyncedSignals). founder_id keeps its own index for ownership and audit reads.
CREATE INDEX IF NOT EXISTS intelligence_signals_workspace_provider
  ON intelligence_signals(workspace_id, provider, synced_at DESC);
