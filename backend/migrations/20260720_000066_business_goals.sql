/**
 * @migration 20260720_000066_business_goals
 * @description Captures the founder's measurable growth goal from Phase 1 step 10.
 *   Structured as metric + baseline + target + unit + time horizon.
 *   This becomes the north-star metric that all strategy and direction content optimises toward.
 * @security RLS: founder-scoped.
 */

CREATE TABLE IF NOT EXISTS business_goals (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID        NOT NULL REFERENCES onboarding_sessions(id) ON DELETE CASCADE,
  founder_id       UUID        NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id       UUID        REFERENCES products(id) ON DELETE CASCADE,

  -- The measurable goal
  goal_type        TEXT        NOT NULL
                   CHECK (goal_type IN (
                     'installs','dau','mau','revenue','paying_users',
                     'retention_d7','retention_d30','nps','custom'
                   )),
  custom_metric    TEXT,       -- label when goal_type = 'custom'

  baseline_value   NUMERIC(12,2),   -- current value (can be 0 for new apps)
  target_value     NUMERIC(12,2)    NOT NULL,
  unit             TEXT        NOT NULL, -- e.g. 'installs/week', 'paying users', '₹/month'
  time_horizon_days INTEGER    NOT NULL DEFAULT 30,

  -- AI-suggested milestone targets (for the 4-week plan)
  milestones       JSONB,      -- array of { week: 1, target: 250, label: 'Early traction' }

  -- Context
  motivation       TEXT,       -- why this goal matters to the founder
  current_blockers TEXT,       -- what's stopping them right now

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (session_id)
);

ALTER TABLE business_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "business_goals_owner"
  ON business_goals
  USING (founder_id = auth.uid());
