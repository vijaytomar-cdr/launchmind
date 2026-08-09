-- @file 20260808_000080_connection_workspace_scoping.sql
-- @description Makes workspace_id the tenant boundary for Improve Intelligence
--   connections and the intelligence they import.
--
--   Before: connections and signals were scoped to founder_id only, so two workspaces
--   belonging to the same founder shared one connection per provider, and a workspace
--   member who was not the founder could not be authorized at all.
--
--   After: workspace_id is the tenant boundary. founder_id is retained as the
--   "who connected it" attribution and is NOT removed — product/founder ownership
--   relationships elsewhere are unaffected.
--
-- @security
--   - Adds lm_is_workspace_member / lm_workspace_role / lm_can_write_workspace.
--     SECURITY DEFINER with a pinned search_path so RLS policies can consult
--     workspace membership without recursive policy evaluation.
--   - RLS read = any accepted member of the workspace.
--     RLS write = owner | admin | editor. Viewers are read-only.
--   - This is intentionally NOT a relaxation: previously only the workspace's
--     founder could be authorized at all. Non-member access remains impossible.
--
-- @compatibility
--   - workspace_id is added nullable, backfilled, then promoted to NOT NULL only
--     when no NULLs remain (guarded DO block; skips with a NOTICE otherwise).
--   - workspace_connections UNIQUE(founder_id, provider) is replaced by
--     UNIQUE(workspace_id, provider). This is a CONSTRAINT change, not a column
--     drop/rename/retype: required so each workspace can hold its own connection
--     to the same provider.
--   - No column is dropped, renamed, or retyped. Idempotent throughout.

BEGIN;

-- ── 1. Membership helpers ────────────────────────────────────────────────────

/**
 * True when the current JWT subject owns the workspace or holds an accepted
 * membership row. Pending invitations (accepted_at IS NULL) do NOT grant access.
 */
CREATE OR REPLACE FUNCTION lm_is_workspace_member(ws UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ws IS NOT NULL AND (
    EXISTS (SELECT 1 FROM workspaces w  WHERE w.id = ws AND w.founder_id = auth.uid())
    OR
    EXISTS (SELECT 1 FROM workspace_members m
            WHERE m.workspace_id = ws
              AND m.founder_id  = auth.uid()
              AND m.accepted_at IS NOT NULL)
  );
$$;

/**
 * Effective role of the current JWT subject in a workspace, or NULL when not a
 * member. The workspace's founder is always 'owner' regardless of member rows.
 */
CREATE OR REPLACE FUNCTION lm_workspace_role(ws UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM workspaces w WHERE w.id = ws AND w.founder_id = auth.uid())
      THEN 'owner'
    ELSE (
      SELECT m.role FROM workspace_members m
      WHERE m.workspace_id = ws
        AND m.founder_id  = auth.uid()
        AND m.accepted_at IS NOT NULL
      LIMIT 1
    )
  END;
$$;

/** True when the current JWT subject may mutate workspace-scoped rows. */
CREATE OR REPLACE FUNCTION lm_can_write_workspace(ws UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lm_workspace_role(ws) IN ('owner', 'admin', 'editor');
$$;

REVOKE ALL ON FUNCTION lm_is_workspace_member(UUID)  FROM PUBLIC;
REVOKE ALL ON FUNCTION lm_workspace_role(UUID)       FROM PUBLIC;
REVOKE ALL ON FUNCTION lm_can_write_workspace(UUID)  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lm_is_workspace_member(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION lm_workspace_role(UUID)      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION lm_can_write_workspace(UUID) TO authenticated, service_role;

-- ── 2. Add workspace_id ──────────────────────────────────────────────────────

ALTER TABLE workspace_connections
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE connection_sync_runs
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE intelligence_signals
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;

-- ── 3. Backfill ──────────────────────────────────────────────────────────────
-- Resolution order: founders.active_workspace_id → oldest workspace owned by the
-- founder. Rows whose founder owns no workspace stay NULL and are reported below.

UPDATE workspace_connections c
   SET workspace_id = COALESCE(
         (SELECT f.active_workspace_id FROM founders f WHERE f.id = c.founder_id),
         (SELECT w.id FROM workspaces w WHERE w.founder_id = c.founder_id
           ORDER BY w.created_at ASC LIMIT 1)
       )
 WHERE c.workspace_id IS NULL;

-- Sync runs inherit the workspace of their connection — never re-resolved from the
-- founder, so a run can never drift into a different workspace than its connection.
UPDATE connection_sync_runs r
   SET workspace_id = c.workspace_id
  FROM workspace_connections c
 WHERE r.connection_id = c.id
   AND r.workspace_id IS NULL
   AND c.workspace_id IS NOT NULL;

UPDATE intelligence_signals s
   SET workspace_id = COALESCE(
         (SELECT p.workspace_id FROM products p WHERE p.id = s.product_id),
         (SELECT f.active_workspace_id FROM founders f WHERE f.id = s.founder_id),
         (SELECT w.id FROM workspaces w WHERE w.founder_id = s.founder_id
           ORDER BY w.created_at ASC LIMIT 1)
       )
 WHERE s.workspace_id IS NULL;

-- ── 4. Promote to NOT NULL when fully backfilled ─────────────────────────────

DO $$
DECLARE
  unresolved INTEGER;
BEGIN
  SELECT (SELECT COUNT(*) FROM workspace_connections WHERE workspace_id IS NULL)
       + (SELECT COUNT(*) FROM connection_sync_runs  WHERE workspace_id IS NULL)
       + (SELECT COUNT(*) FROM intelligence_signals  WHERE workspace_id IS NULL)
    INTO unresolved;

  IF unresolved = 0 THEN
    ALTER TABLE workspace_connections ALTER COLUMN workspace_id SET NOT NULL;
    ALTER TABLE connection_sync_runs  ALTER COLUMN workspace_id SET NOT NULL;
    ALTER TABLE intelligence_signals  ALTER COLUMN workspace_id SET NOT NULL;
  ELSE
    RAISE NOTICE
      'connection workspace backfill left % row(s) unresolved; workspace_id stays nullable. Re-run after every founder has a workspace.',
      unresolved;
  END IF;
END $$;

-- ── 5. Tenant uniqueness ─────────────────────────────────────────────────────
-- One connection per (workspace, provider) instead of per (founder, provider).

ALTER TABLE workspace_connections
  DROP CONSTRAINT IF EXISTS workspace_connections_founder_id_provider_key;

CREATE UNIQUE INDEX IF NOT EXISTS workspace_connections_workspace_provider
  ON workspace_connections (workspace_id, provider)
  WHERE workspace_id IS NOT NULL;

-- ── 6. Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS workspace_connections_workspace ON workspace_connections(workspace_id);
CREATE INDEX IF NOT EXISTS connection_sync_runs_workspace  ON connection_sync_runs(workspace_id);
CREATE INDEX IF NOT EXISTS intelligence_signals_workspace  ON intelligence_signals(workspace_id, provider);

-- ── 7. Membership-aware RLS ──────────────────────────────────────────────────
-- Read: any accepted member. Write: owner/admin/editor only.
-- The previous founder-only policies are replaced, not loosened for non-members:
-- someone outside the workspace still matches nothing.

DROP POLICY IF EXISTS "connections_owner"            ON workspace_connections;
DROP POLICY IF EXISTS "connections_workspace_read"   ON workspace_connections;
DROP POLICY IF EXISTS "connections_workspace_write"  ON workspace_connections;

CREATE POLICY "connections_workspace_read" ON workspace_connections
  FOR SELECT USING (lm_is_workspace_member(workspace_id));

CREATE POLICY "connections_workspace_write" ON workspace_connections
  FOR ALL USING (lm_can_write_workspace(workspace_id))
  WITH CHECK (lm_can_write_workspace(workspace_id));

DROP POLICY IF EXISTS "sync_runs_owner"            ON connection_sync_runs;
DROP POLICY IF EXISTS "sync_runs_workspace_read"   ON connection_sync_runs;
DROP POLICY IF EXISTS "sync_runs_workspace_write"  ON connection_sync_runs;

CREATE POLICY "sync_runs_workspace_read" ON connection_sync_runs
  FOR SELECT USING (lm_is_workspace_member(workspace_id));

CREATE POLICY "sync_runs_workspace_write" ON connection_sync_runs
  FOR ALL USING (lm_can_write_workspace(workspace_id))
  WITH CHECK (lm_can_write_workspace(workspace_id));

-- intelligence_signals stays read-only for authenticated users; only the sync
-- worker (service_role) inserts. Migration 074 already REVOKEd INSERT/UPDATE/DELETE.
DROP POLICY IF EXISTS "intelligence_signals_owner"          ON intelligence_signals;
DROP POLICY IF EXISTS "intelligence_signals_workspace_read" ON intelligence_signals;

CREATE POLICY "intelligence_signals_workspace_read" ON intelligence_signals
  FOR SELECT USING (lm_is_workspace_member(workspace_id));

COMMIT;
