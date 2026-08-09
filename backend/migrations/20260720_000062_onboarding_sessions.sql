/**
 * @migration 20260720_000062_onboarding_sessions
 * @description Tracks the Phase 1 onboarding state machine for each founder.
 *   One active session per founder. Stores the current state, linked product/workspace,
 *   and a lockVersion for optimistic-concurrency conflict detection.
 * @security RLS: founders can only read/write their own session. No cross-founder access.
 */

CREATE TABLE IF NOT EXISTS onboarding_sessions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id       UUID        NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  workspace_id     UUID        REFERENCES workspaces(id) ON DELETE SET NULL,
  product_id       UUID        REFERENCES products(id) ON DELETE SET NULL,

  -- State machine
  current_state    TEXT        NOT NULL DEFAULT 'WORKSPACE_SETUP'
                   CHECK (current_state IN (
                     'WORKSPACE_SETUP',
                     'DISCOVERY_PENDING',
                     'DISCOVERY_IN_PROGRESS',
                     'DISCOVERY_MATCH_NEEDED',
                     'DISCOVERY_FAILED',
                     'PRELIMINARY_REPORT',
                     'BELIEF_REVIEW',
                     'ALIGNMENT_AUDIENCE',
                     'ALIGNMENT_CONTEXT',
                     'ALIGNMENT_GOAL',
                     'ALIGNMENT_COMPETITORS',
                     'BOUNDARIES_SETUP',
                     'FINAL_REVIEW',
                     'DIRECTION_GENERATING',
                     'DIRECTION_COMPLETE',
                     'PHASE_1_COMPLETE'
                   )),

  -- Optimistic concurrency — increment before any state transition
  lock_version     INTEGER     NOT NULL DEFAULT 0,

  -- Progress metadata
  step_completed   INTEGER     NOT NULL DEFAULT 0,  -- number of steps completed (0–15)
  workspace_name   TEXT,
  urls_submitted   TEXT[],     -- raw URLs from step 1
  private_description TEXT,   -- optional free-text product description

  -- Phase 1 completion
  completed_at     TIMESTAMPTZ,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE onboarding_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "onboarding_sessions_owner"
  ON onboarding_sessions
  USING (founder_id = auth.uid());

-- Unique active session per founder
CREATE UNIQUE INDEX IF NOT EXISTS onboarding_sessions_active_founder
  ON onboarding_sessions (founder_id)
  WHERE current_state != 'PHASE_1_COMPLETE';

CREATE INDEX IF NOT EXISTS onboarding_sessions_founder
  ON onboarding_sessions (founder_id);
