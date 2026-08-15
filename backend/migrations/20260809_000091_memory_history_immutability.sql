-- ============================================================================
-- 091 — Append-only enforcement for memory history
--
-- Phase 3.1B. Implements ADR-066 rules 2 and 3.
--
-- Step 3.1A found that append-only was CONVENTION ONLY: migrations 035-040
-- contain zero REVOKE statements. Only growth_brain_learning_events (085)
-- actually revokes UPDATE/DELETE.
--
-- WHY REVOKE ALONE IS NOT ENOUGH HERE:
--   The backend connects as service_role for every operation (getSupabaseAdmin).
--   `REVOKE ... FROM authenticated, anon` therefore protects only direct client
--   access and does nothing about application code. Enforcing immutability
--   against the application requires a trigger, so both are applied:
--     · REVOKE  → blocks the PostgREST/client path
--     · TRIGGER → blocks the application path, including service_role
--
-- THE CONTROLLED DELETION PATH (Step 3.1B §10):
--   GDPR erasure and account deletion must still be able to remove history, or
--   rule 2 and ADR-064 would be in permanent conflict. The trigger therefore
--   yields to one explicit, auditable signal:
--
--       SET LOCAL lm.allow_history_mutation = 'on';
--
--   It is transaction-scoped (SET LOCAL), so it cannot leak into later
--   statements on a pooled connection. Ordinary application code never sets it;
--   only the erasure path in founders.route.ts does, immediately around the
--   delete. Searching the repository for that string enumerates every place
--   history can legally be mutated — which is the property that makes this
--   auditable rather than merely restrictive.
--
--   UPDATE is refused even with the flag: erasure deletes, it does not rewrite.
--   A rewritten history row is indistinguishable from a forged one.
--
-- @security Makes belief history tamper-evident against application bugs, not
--   only against clients. Does not restrict INSERT.
-- @idempotent Safe to run repeatedly.
-- ============================================================================

CREATE OR REPLACE FUNCTION lm_reject_history_mutation() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION
      'append-only: % rows cannot be updated (ADR-066 rule 2). Insert a new version instead.',
      TG_TABLE_NAME
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- DELETE: permitted only inside an explicit erasure transaction.
  IF coalesce(current_setting('lm.allow_history_mutation', true), 'off') <> 'on' THEN
    RAISE EXCEPTION
      'append-only: % rows cannot be deleted (ADR-066 rule 2). The erasure path must '
      'SET LOCAL lm.allow_history_mutation = ''on''.',
      TG_TABLE_NAME
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN OLD;
END $$;

COMMENT ON FUNCTION lm_reject_history_mutation() IS
  'ADR-066 rule 2. UPDATE always refused; DELETE refused unless the transaction '
  'sets lm.allow_history_mutation, which only the account-erasure path does.';

-- ── learning_events is a PROCESSING record, not a belief record ──────────────
-- It is inserted as 'pending', moved to 'processing', then to 'completed' or
-- 'failed' with result counts. A blanket UPDATE ban would break
-- learningPipelineService and, worse, would have looked correct until the first
-- ingestion ran in production.
--
-- So the guard is column-level instead: the AUDIT CONTENT is frozen and the
-- LIFECYCLE is allowed to move. What an auditor relies on — who, which
-- workspace, which event, what payload, when — can never change; status,
-- counters, processed_at and error can.
CREATE OR REPLACE FUNCTION lm_freeze_learning_event_content() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.founder_id  IS DISTINCT FROM OLD.founder_id
  OR NEW.product_id  IS DISTINCT FROM OLD.product_id
  OR NEW.event_type  IS DISTINCT FROM OLD.event_type
  OR NEW.payload     IS DISTINCT FROM OLD.payload
  OR NEW.created_at  IS DISTINCT FROM OLD.created_at
  OR (to_jsonb(NEW) ? 'workspace_id'
      AND to_jsonb(NEW)->>'workspace_id' IS DISTINCT FROM to_jsonb(OLD)->>'workspace_id')
  THEN
    RAISE EXCEPTION
      'append-only: learning_events audit content is immutable (ADR-066 rule 2). '
      'Only status, counters, processed_at and error may change.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS learning_events_content_frozen ON learning_events;
CREATE TRIGGER learning_events_content_frozen
  BEFORE UPDATE ON learning_events
  FOR EACH ROW EXECUTE FUNCTION lm_freeze_learning_event_content();

DROP TRIGGER IF EXISTS learning_events_no_delete ON learning_events;
CREATE TRIGGER learning_events_no_delete
  BEFORE DELETE ON learning_events
  FOR EACH ROW EXECUTE FUNCTION lm_reject_history_mutation();

REVOKE UPDATE, DELETE ON learning_events FROM authenticated, anon;

-- ── Fully append-only tables ─────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['marketing_memory_versions','evidence',
                           'growth_brain_learning_events']
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = t) THEN

      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_append_only', t);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I '
        'FOR EACH ROW EXECUTE FUNCTION lm_reject_history_mutation()',
        t || '_append_only', t);

      EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM authenticated, anon', t);
    END IF;
  END LOOP;
END $$;

-- ── The controlled erasure path ──────────────────────────────────────────────
-- The flag MUST be set in the same transaction as the deletes. PostgREST runs
-- every HTTP request in its own transaction, so a client that called an
-- "enable" RPC and then issued DELETEs would set the flag in transaction 1 and
-- delete in transaction 2, where it no longer applies — the deletes would be
-- refused and erasure would silently fail. Wrapping both in one SECURITY
-- DEFINER function is what makes this correct rather than merely plausible.
--
-- Deletion ORDER matters: memories and their versions go first, so that the
-- caller's later `DELETE FROM products` has nothing left to cascade into
-- append-only tables.
CREATE OR REPLACE FUNCTION lm_erase_founder_history(p_founder_id UUID)
RETURNS TABLE (evidence_deleted BIGINT, events_deleted BIGINT, versions_deleted BIGINT, memories_deleted BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE e BIGINT; ev BIGINT; v BIGINT; m BIGINT;
BEGIN
  -- Transaction-scoped: cannot leak onto a pooled connection.
  PERFORM set_config('lm.allow_history_mutation', 'on', true);

  DELETE FROM evidence                  WHERE founder_id = p_founder_id;  GET DIAGNOSTICS e  = ROW_COUNT;
  DELETE FROM learning_events           WHERE founder_id = p_founder_id;  GET DIAGNOSTICS ev = ROW_COUNT;
  DELETE FROM marketing_memory_versions WHERE founder_id = p_founder_id;  GET DIAGNOSTICS v  = ROW_COUNT;
  DELETE FROM marketing_memories        WHERE founder_id = p_founder_id;  GET DIAGNOSTICS m  = ROW_COUNT;

  RETURN QUERY SELECT e, ev, v, m;
END $$;

COMMENT ON FUNCTION lm_erase_founder_history(UUID) IS
  'ADR-064 erasure + ADR-066 rule 2. The ONLY sanctioned way to delete belief '
  'history. Does not touch audit_logs, connection_permission_history or '
  'growth_brain_learning_events — those follow the audit retention policy '
  '(ADR-066 rule 48) and are anonymised, never deleted.';

REVOKE ALL ON FUNCTION lm_erase_founder_history(UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION lm_erase_founder_history(UUID) TO service_role;

-- ── memory_type governance (ADR-066 rule 49, Step 3.1B §9) ───────────────────
-- The CHECK from migration 035 is retained as the enforcement mechanism. A
-- Postgres ENUM was rejected: adding a value needs ALTER TYPE, which is awkward
-- under the additive-migration rule and cannot share a transaction with other
-- DDL on older servers. A lookup table was rejected as a join and an FK for an
-- 11-element set that changes about once a year.
--
-- What was missing is not enforcement but DETECTION OF DRIFT between the CHECK
-- and the TypeScript union. That is closed by a test
-- (tests/memoryTaxonomy.test.ts) which parses this constraint out of the
-- migration and asserts set-equality with MEMORY_TYPES.
--
-- The constraint is named here so the test can find it by name rather than by
-- scraping an anonymous system-generated identifier.
DO $$
DECLARE conname_existing TEXT;
BEGIN
  SELECT c.conname INTO conname_existing
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'marketing_memories'
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%memory_type%'
   LIMIT 1;

  IF conname_existing IS NOT NULL AND conname_existing <> 'marketing_memories_memory_type_governed' THEN
    EXECUTE format('ALTER TABLE marketing_memories RENAME CONSTRAINT %I TO %I',
                   conname_existing, 'marketing_memories_memory_type_governed');
  END IF;
END $$;
