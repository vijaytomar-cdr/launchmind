/**
 * @migration 20260720_000069_strategy_directions
 * @description Stores the 30-day growth direction generated at the end of Phase 1.
 *   Distinct from the 30/60/90 strategy (stored in products.confirmed_icp / campaign data) —
 *   this is the personalised first-direction based on all Phase 1 alignment data.
 *   Includes a 4-week sequence, evidence refs, and the prompt version used.
 * @security RLS: founder-scoped.
 */

CREATE TABLE IF NOT EXISTS strategy_directions (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id           UUID        NOT NULL REFERENCES onboarding_sessions(id) ON DELETE CASCADE,
  founder_id           UUID        NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id           UUID        REFERENCES products(id) ON DELETE CASCADE,

  -- Generation metadata
  prompt_version       TEXT        NOT NULL DEFAULT '1.0',
  input_snapshot       JSONB,      -- snapshot of all Phase 1 inputs used to generate this
  ai_model             TEXT,

  -- The direction content
  headline             TEXT        NOT NULL,   -- one-sentence north-star
  rationale            TEXT        NOT NULL,   -- 2–3 paragraphs: why this direction
  primary_channel      TEXT,                   -- the single focus channel for week 1
  primary_market       TEXT        CHECK (primary_market IN ('usa','india','both')),

  -- 4-week plan
  week_1               JSONB,      -- { focus, tasks[], expectedOutcome }
  week_2               JSONB,
  week_3               JSONB,
  week_4               JSONB,

  -- Evidence references (linked product_claims)
  evidence_claim_ids   UUID[]      NOT NULL DEFAULT ARRAY[]::UUID[],

  -- Risks / assumptions
  key_assumptions      JSONB,      -- array of strings
  risk_flags           JSONB,      -- array of strings

  -- Founder interaction
  acknowledged_at      TIMESTAMPTZ,            -- when founder read and accepted direction
  edited_at            TIMESTAMPTZ,            -- if founder requested changes
  edit_notes           TEXT,

  -- AI usage
  ai_tokens_consumed   INTEGER     NOT NULL DEFAULT 0,

  status               TEXT        NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','generating','ready','acknowledged')),

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE strategy_directions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "strategy_directions_owner"
  ON strategy_directions
  USING (founder_id = auth.uid());

CREATE INDEX IF NOT EXISTS strategy_directions_session
  ON strategy_directions (session_id);
CREATE INDEX IF NOT EXISTS strategy_directions_founder
  ON strategy_directions (founder_id);
