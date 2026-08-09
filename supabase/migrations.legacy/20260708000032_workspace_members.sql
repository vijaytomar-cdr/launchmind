-- @file 20260708_000032_workspace_members.sql
-- @description Extends workspace model per ADR-011.
--   1. workspaces: add workspace_type + settings JSONB
--   2. workspace_members: roles for future team support
--   3. workspace_preferences: per-workspace defaults
--   4. founders: add active_workspace_id + active_product_id for active-state persistence
-- All changes are additive and idempotent.

BEGIN;

-- ── 1. Extend workspaces ────────────────────────────────────────────────────

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS workspace_type TEXT NOT NULL DEFAULT 'personal'
    CHECK (workspace_type IN ('personal', 'team')),
  ADD COLUMN IF NOT EXISTS settings JSONB;

-- ── 2. workspace_members ────────────────────────────────────────────────────
-- Stores explicit role grants. The workspace owner (workspaces.founder_id) always
-- has owner-level access — no row required. Rows here are for additional members.

CREATE TABLE IF NOT EXISTS workspace_members (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  founder_id     UUID REFERENCES founders(id) ON DELETE CASCADE,
  role           TEXT NOT NULL DEFAULT 'viewer'
                 CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  invited_email  TEXT,           -- pre-invite placeholder (founder_id NULL until accepted)
  accepted_at    TIMESTAMPTZ,    -- NULL = invite pending
  invited_by     UUID REFERENCES founders(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

-- Members can see their own rows; workspace owner can see all members of their workspaces
DROP POLICY IF EXISTS "wm_member_read" ON workspace_members;
CREATE POLICY "wm_member_read" ON workspace_members
  FOR SELECT USING (
    founder_id = auth.uid()
    OR workspace_id IN (
      SELECT id FROM workspaces WHERE founder_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "wm_owner_write" ON workspace_members;
CREATE POLICY "wm_owner_write" ON workspace_members
  FOR ALL USING (
    workspace_id IN (SELECT id FROM workspaces WHERE founder_id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_workspace_members_ws ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_founder ON workspace_members(founder_id);

-- ── 3. workspace_preferences ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workspace_preferences (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE UNIQUE,
  default_channel  TEXT,
  default_market   TEXT CHECK (default_market IN ('usa', 'india', 'uk', 'canada')),
  notification_prefs JSONB,
  ui_prefs         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE workspace_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wp_owner" ON workspace_preferences;
CREATE POLICY "wp_owner" ON workspace_preferences
  USING (workspace_id IN (SELECT id FROM workspaces WHERE founder_id = auth.uid()));

-- ── 4. Extend founders for active state ───────────────────────────────────

ALTER TABLE founders
  ADD COLUMN IF NOT EXISTS active_workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS active_product_id   UUID REFERENCES products(id) ON DELETE SET NULL;

COMMIT;
