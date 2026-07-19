/**
 * @migration 20260708_000048_asset_approvals
 * @description Detailed approval tracking for content assets.
 *   Supplements content_assets.approved_at with approver identity, notes,
 *   approval duration, and full audit trail.
 * @security RLS founder-scoped. Append-only — no UPDATE/DELETE for authenticated.
 */

CREATE TABLE IF NOT EXISTS asset_approvals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id          UUID NOT NULL REFERENCES content_assets(id) ON DELETE CASCADE,
  founder_id        UUID NOT NULL REFERENCES founders(id),
  action            TEXT NOT NULL CHECK (action IN ('approved', 'rejected', 'held', 'restored')),
  note              TEXT,
  version_number    INTEGER,
  approved_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE asset_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "asset_approvals_owner" ON asset_approvals;
CREATE POLICY "asset_approvals_owner" ON asset_approvals
  USING (founder_id = auth.uid());

REVOKE UPDATE, DELETE ON asset_approvals FROM authenticated;

CREATE INDEX IF NOT EXISTS asset_approvals_asset ON asset_approvals(asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS asset_approvals_founder ON asset_approvals(founder_id, created_at DESC);
