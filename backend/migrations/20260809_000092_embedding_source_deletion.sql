-- ============================================================================
-- 092 — Derived-vector ownership and deletion
--
-- Phase 3.1B. Implements ADR-066 rules 46, 47 and 48.
--
-- memory_embeddings.source_id is POLYMORPHIC: it points at one of five source
-- tables depending on source_type, so a foreign key cannot express the
-- relationship. Deletion is therefore enforced by AFTER DELETE triggers on each
-- source table — one per table, each deleting only its own source_type.
--
-- WHY NOT A SINGLE GENERIC TRIGGER: matching on source_id alone would let a
-- deleted evidence row remove a marketing_memory embedding that happened to
-- share a UUID. Vanishingly unlikely, and silently wrong if it ever happened.
-- Each trigger names its own source_type.
--
-- RULE 48 — the deliberate asymmetry:
--   DERIVED artifacts CASCADE. Embeddings are rebuildable indexes with no
--   independent value, so they follow their source immediately.
--   AUDIT records DO NOT. audit_logs, connection_permission_history and
--   growth_brain_learning_events have their own retention policy and are
--   anonymised in place rather than deleted — the same treatment `founders`
--   already receives. Nothing here cascades into them.
--
-- Note memory_embeddings.workspace_id already carries ON DELETE CASCADE to
-- workspaces (089), so deleting a workspace removes its vectors too. These
-- triggers cover the finer-grained case of a single source record.
--
-- @security Prevents a deleted memory's vector from remaining searchable, which
--   would make erasure cosmetic (ADR-064).
-- @idempotent Safe to run repeatedly.
-- ============================================================================

CREATE OR REPLACE FUNCTION lm_delete_derived_embeddings() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  -- TG_ARGV[0] is the source_type this table owns. Passing it explicitly keeps
  -- one function serving every source table without guessing from TG_TABLE_NAME.
  DELETE FROM memory_embeddings
   WHERE source_type = TG_ARGV[0]
     AND source_id   = OLD.id;
  RETURN OLD;
END $$;

COMMENT ON FUNCTION lm_delete_derived_embeddings() IS
  'ADR-066 rule 46: a derived vector never outlives its canonical source.';

DO $$
DECLARE
  pair TEXT[];
  pairs TEXT[][] := ARRAY[
    ARRAY['marketing_memories',        'marketing_memory'],
    ARRAY['marketing_memory_versions', 'marketing_memory_version'],
    ARRAY['evidence',                  'evidence'],
    ARRAY['playbook_signals',          'playbook_signal'],
    ARRAY['products',                  'product_icp']
  ];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY pairs
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = pair[1]) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', pair[1] || '_drop_embeddings', pair[1]);
      EXECUTE format(
        'CREATE TRIGGER %I AFTER DELETE ON %I FOR EACH ROW '
        'EXECUTE FUNCTION lm_delete_derived_embeddings(%L)',
        pair[1] || '_drop_embeddings', pair[1], pair[2]);
    END IF;
  END LOOP;
END $$;
