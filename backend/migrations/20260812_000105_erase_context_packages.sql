-- ============================================================================
-- 105 · Extend the erasure path to cover context packages
--
-- FOUND DURING THE AUTHORIZED TEST RESET. This is a GDPR defect, not merely a
-- reset inconvenience: account erasure is currently IMPOSSIBLE for any founder
-- who has ever had a ContextPackage built.
--
-- WHY IT IS UNRECOVERABLE WITHOUT THIS CHANGE:
--
--   context_packages.product_id  ->  products  ON DELETE SET NULL
--
-- so `DELETE FROM products` makes Postgres UPDATE context_packages — and
-- lm_reject_history_mutation refuses UPDATE UNCONDITIONALLY:
--
--   IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION ... END IF;          -- no escape
--   IF ... 'lm.allow_history_mutation' <> 'on' THEN RAISE ...     -- DELETE only
--
-- The erasure flag is an escape hatch for DELETE alone, so there is NO value of
-- any session setting that lets the product delete succeed. DELETE /founders/me
-- therefore aborts with 23001 at the products step and the founder's data
-- survives — while the API has already reported success for earlier steps.
--
-- THE FIX IS ORDERING, NOT WEAKENING. Nothing about append-only is relaxed:
-- context packages are removed INSIDE the existing erasure transaction, before
-- products are deleted, so there is no surviving row for the FK to SET NULL.
-- lm_erase_founder_history already runs first in the erasure sequence and
-- already sets the flag transaction-locally, which is exactly the right place.
--
-- WHY DELETE BOTH BY WORKSPACE AND BY FOUNDER: context_package_items carries no
-- founder_id (only workspace_id + context_package_id), and context_packages
-- carries founder_id with ON DELETE SET NULL — so a package whose founder_id was
-- already nulled is reachable only through the workspace. Covering both means an
-- erasure cannot leave a package behind because of the order in which earlier
-- deletes happened.
--
-- Idempotent: CREATE OR REPLACE, and the deletes are no-ops when nothing matches.
-- ============================================================================

-- The return type gains two columns, and CREATE OR REPLACE cannot change an
-- existing function's OUT parameters (42P13). Dropping first is required.
-- The only caller (DELETE /founders/me) checks `error` and ignores the shape,
-- so the widened result breaks nothing.
DROP FUNCTION IF EXISTS lm_erase_founder_history(UUID);

CREATE OR REPLACE FUNCTION lm_erase_founder_history(p_founder_id UUID)
RETURNS TABLE(
  evidence_deleted    BIGINT,
  events_deleted      BIGINT,
  versions_deleted    BIGINT,
  memories_deleted    BIGINT,
  ctx_items_deleted   BIGINT,
  ctx_packages_deleted BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE e BIGINT; ev BIGINT; v BIGINT; m BIGINT; ci BIGINT; cp BIGINT;
        ws UUID[];
BEGIN
  -- Transaction-scoped: cannot leak onto a pooled connection.
  PERFORM set_config('lm.allow_history_mutation', 'on', true);

  DELETE FROM evidence                  WHERE founder_id = p_founder_id;  GET DIAGNOSTICS e  = ROW_COUNT;
  DELETE FROM learning_events           WHERE founder_id = p_founder_id;  GET DIAGNOSTICS ev = ROW_COUNT;
  DELETE FROM marketing_memory_versions WHERE founder_id = p_founder_id;  GET DIAGNOSTICS v  = ROW_COUNT;
  DELETE FROM marketing_memories        WHERE founder_id = p_founder_id;  GET DIAGNOSTICS m  = ROW_COUNT;

  -- Workspaces this founder owns, resolved before anything is removed.
  SELECT array_agg(id) INTO ws FROM workspaces WHERE founder_id = p_founder_id;
  ws := coalesce(ws, ARRAY[]::UUID[]);

  -- Children first: context_package_items -> context_packages is CASCADE, but the
  -- cascade would fire the items' own append-only DELETE trigger anyway, so they
  -- are removed explicitly and counted.
  DELETE FROM context_package_items
   WHERE workspace_id = ANY(ws)
      OR context_package_id IN (SELECT id FROM context_packages WHERE founder_id = p_founder_id);
  GET DIAGNOSTICS ci = ROW_COUNT;

  DELETE FROM context_packages
   WHERE founder_id = p_founder_id OR workspace_id = ANY(ws);
  GET DIAGNOSTICS cp = ROW_COUNT;

  RETURN QUERY SELECT e, ev, v, m, ci, cp;
END $function$;

COMMENT ON FUNCTION lm_erase_founder_history(UUID) IS
  'Sanctioned append-only erasure. MUST run before products/workspaces are deleted: '
  'context_packages.product_id is ON DELETE SET NULL and append-only UPDATE has no '
  'escape hatch, so a surviving package makes the product delete permanently fail.';
