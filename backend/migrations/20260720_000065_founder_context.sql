/**
 * @migration 20260720_000065_founder_context
 * @description Stores alignment data captured during Phase 1 onboarding steps 8–11.
 *   Audience segment refinement, context delta (what founder knows that AI doesn't),
 *   and working style preferences.
 * @security RLS: founder-scoped.
 */

CREATE TABLE IF NOT EXISTS founder_context (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id            UUID        NOT NULL REFERENCES onboarding_sessions(id) ON DELETE CASCADE,
  founder_id            UUID        NOT NULL REFERENCES founders(id) ON DELETE CASCADE,

  -- Step 8: Audience alignment
  audience_confirmed    TEXT,       -- confirmed primary audience description
  audience_additions    TEXT,       -- what founder added / corrected about the audience
  audience_segments     JSONB,      -- array of { label, size_estimate, priority }

  -- Step 9: Context delta — what the founder knows that AI doesn't
  context_delta         TEXT,       -- free-form: e.g. "We have 200 beta users in Pune health circles"
  hidden_strengths      JSONB,      -- array of strings
  recent_wins           JSONB,      -- array of strings (not in store data)

  -- Step 11: Working style / autonomy preference
  working_style         TEXT        CHECK (working_style IN ('hands_on','balanced','hands_off')),
  -- hands_on: AI suggests, founder decides everything
  -- balanced: AI decides low-stakes; founder approves high-stakes
  -- hands_off: AI decides unless spend >cap

  notification_cadence  TEXT        DEFAULT 'weekly'
                        CHECK (notification_cadence IN ('daily','weekly','only_critical')),
  time_commitment_hrs   INTEGER,    -- estimated hours/week founder can give

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (session_id)
);

ALTER TABLE founder_context ENABLE ROW LEVEL SECURITY;
CREATE POLICY "founder_context_owner"
  ON founder_context
  USING (founder_id = auth.uid());
