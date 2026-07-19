/**
 * @migration 20260708_000053_campaign_approvals
 * @description Detailed approval audit trail for campaigns.
 *   Supplements campaigns.approved_at with approver identity, scope, budget confirmation,
 *   asset IDs, risk level, and full audit history.
 *   Append-only — REVOKE UPDATE/DELETE for authenticated users.
 * @security RLS founder-scoped. Append-only enforced at DB level.
 */

CREATE TABLE IF NOT EXISTS campaign_approvals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  founder_id      UUID NOT NULL REFERENCES founders(id),
  action          TEXT NOT NULL CHECK (action IN (
                    'approved', 'rejected', 'revision_requested', 'budget_confirmed'
                  )),
  note            TEXT,
  scope           TEXT,
  budget_amount   NUMERIC(12,2),
  budget_currency TEXT CHECK (budget_currency IN ('USD', 'INR') OR budget_currency IS NULL),
  channel         TEXT,
  asset_ids       UUID[],
  risk_level      TEXT CHECK (risk_level IN ('low', 'medium', 'high') OR risk_level IS NULL),
  approved_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE campaign_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "campaign_approvals_owner" ON campaign_approvals;
CREATE POLICY "campaign_approvals_owner" ON campaign_approvals USING (founder_id = auth.uid());

REVOKE UPDATE, DELETE ON campaign_approvals FROM authenticated;

CREATE INDEX IF NOT EXISTS campaign_approvals_campaign ON campaign_approvals(campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS campaign_approvals_founder ON campaign_approvals(founder_id, created_at DESC);
