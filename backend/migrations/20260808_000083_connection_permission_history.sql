-- @file 20260808_000083_connection_permission_history.sql
-- @description Append-only audit trail of every permission change on a connection.
--   Spec §16 (`connection_permission_history`) and §15 (permission changes are audited).
--
--   Every row is the complete permission snapshot AFTER the action, not a delta, so
--   the effective authority at any past moment can be read directly without replaying
--   history. `granted` is the canonical ladder subset:
--     READ · RECOMMEND · DRAFT · CHANGE · PUBLISH · SPEND
--
-- @security
--   - INSERT only. UPDATE and DELETE are REVOKEd from authenticated and anon, so a
--     grant of CHANGE/PUBLISH/SPEND cannot be retroactively erased.
--   - Read is workspace-member scoped via lm_is_workspace_member (migration 080).
--   - changed_by is the acting founder; system-initiated rows use actor_type='system'.
-- @dependencies workspaces, workspace_connections, founders, lm_is_workspace_member

BEGIN;

CREATE TABLE IF NOT EXISTS connection_permission_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id       UUID NOT NULL REFERENCES workspace_connections(id) ON DELETE CASCADE,
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Complete effective permission set AFTER this action.
  permission_snapshot TEXT[] NOT NULL DEFAULT '{}',
  -- Set immediately BEFORE this action, for a readable diff.
  previous_snapshot   TEXT[] NOT NULL DEFAULT '{}',

  action              TEXT NOT NULL
                      CHECK (action IN (
                        'granted',            -- initial least-privilege grant at connect
                        'upgrade_requested',  -- owner asked for higher authority
                        'upgrade_approved',   -- request approved; snapshot widened
                        'upgrade_denied',     -- request refused; snapshot unchanged
                        'downgraded',         -- authority voluntarily reduced
                        'revoked',            -- all authority removed (disconnect)
                        'reauthorized'        -- credential replaced; snapshot re-asserted
                      )),

  changed_by          UUID REFERENCES founders(id),
  actor_type          TEXT NOT NULL DEFAULT 'founder'
                      CHECK (actor_type IN ('founder', 'system')),
  -- Owner-facing justification. Required for any upgrade action at the service layer.
  reason              TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}',
  trace_id            TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS connection_permission_history_connection
  ON connection_permission_history (connection_id, created_at DESC);

CREATE INDEX IF NOT EXISTS connection_permission_history_workspace
  ON connection_permission_history (workspace_id, created_at DESC);

ALTER TABLE connection_permission_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "permission_history_workspace_read" ON connection_permission_history;
CREATE POLICY "permission_history_workspace_read" ON connection_permission_history
  FOR SELECT USING (lm_is_workspace_member(workspace_id));

-- Immutable: the audit trail may be read and appended to, never edited or erased.
REVOKE UPDATE, DELETE ON connection_permission_history FROM authenticated, anon;
GRANT SELECT ON connection_permission_history TO authenticated;
GRANT SELECT, INSERT ON connection_permission_history TO service_role;

COMMIT;
