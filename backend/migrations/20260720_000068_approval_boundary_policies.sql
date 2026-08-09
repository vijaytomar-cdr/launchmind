/**
 * @migration 20260720_000068_approval_boundary_policies
 * @description Records the founder's Phase 1 approval boundary agreement.
 *   Stores what the AI is permitted to do autonomously vs what requires explicit approval.
 *   Immutable once confirmed — any policy change creates a new record.
 * @security RLS: founder-scoped. INSERT only after Phase 1 confirmation gate (checkbox + server-side).
 */

CREATE TABLE IF NOT EXISTS approval_boundary_policies (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id           UUID        NOT NULL REFERENCES onboarding_sessions(id) ON DELETE CASCADE,
  founder_id           UUID        NOT NULL REFERENCES founders(id) ON DELETE CASCADE,

  -- Working style drives defaults
  working_style        TEXT        NOT NULL
                       CHECK (working_style IN ('hands_on','balanced','hands_off')),

  -- What AI can do without approval
  autonomous_permitted JSONB       NOT NULL DEFAULT '[]'::JSONB,
  -- e.g. ["content_draft","icp_update","weekly_brief","experiment_suggestion"]

  -- What always requires founder approval
  approval_required    JSONB       NOT NULL DEFAULT '[]'::JSONB,
  -- e.g. ["campaign_launch","spend_increase","new_channel","platform_connection"]

  -- Hard limits (server-side enforced, cannot be overridden by AI)
  weekly_spend_cap_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
  weekly_spend_cap_inr NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Confirmation gate (§ Approval Boundary Policy)
  -- Checkbox must be checked before button is enabled; server validates confirmed_at is non-null
  founder_acknowledged BOOLEAN     NOT NULL DEFAULT false,
  confirmed_at         TIMESTAMPTZ,         -- null until checkbox + submit

  -- Version (future policy changes increment this)
  policy_version       INTEGER     NOT NULL DEFAULT 1,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE approval_boundary_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "boundary_policies_owner"
  ON approval_boundary_policies
  USING (founder_id = auth.uid());

-- Immutable: no UPDATE or DELETE from any authenticated role
REVOKE UPDATE, DELETE ON approval_boundary_policies FROM authenticated, anon;

CREATE INDEX IF NOT EXISTS boundary_policies_founder
  ON approval_boundary_policies (founder_id);
