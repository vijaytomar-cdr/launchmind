-- Migration: 056 — decision_rules
-- Registry of all active business rules enforced by the Decision Engine.
-- IMMUTABLE: INSERT only after initial seed. Rules are changed by inserting new versions.
-- Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS decision_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name   TEXT NOT NULL UNIQUE,
  rule_type   TEXT NOT NULL CHECK (rule_type IN (
                'approval','budget','plan_gate','token','rate_limit','experiment','workspace','benchmark'
              )),
  description TEXT NOT NULL,
  config      JSONB,           -- rule parameters e.g. { "maxRegens": 3, "budgetMultiplier": 1.5 }
  is_active   BOOLEAN NOT NULL DEFAULT true,
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed with the 8 known rules from existing codebase
INSERT INTO decision_rules (rule_name, rule_type, description, config) VALUES
  ('approve_before_post',    'approval',    'Campaign or asset must have approved_at set before publishing (§1.5)', '{"resources":["campaign","content_asset"]}'),
  ('spend_cap_enforcement',  'budget',      'Campaign spend cannot exceed weekly cap × 1.5 safety margin (§1.6)',    '{"safetyMultiplier":1.5}'),
  ('budget_increase_reapproval', 'approval','Spend cap increase >20% clears approval and requires re-approval',      '{"threshold":0.20}'),
  ('studio_plan_gate',       'plan_gate',   'Custom AI prompts require Studio plan',                                  '{"requiredPlan":"studio"}'),
  ('content_regen_limit',    'rate_limit',  'Content asset regeneration capped at 3 per asset',                      '{"maxRegens":3}'),
  ('experiment_min_runtime', 'experiment',  'Experiments must run at least 7 days before winner can be declared',    '{"minDays":7}'),
  ('token_balance_gate',     'token',       'AI actions blocked when founder token balance is insufficient',          '{"plans":{"free":50,"solo":300,"builder":1000,"studio":3000}}'),
  ('workspace_tenant_isolation', 'workspace','Founders can only access their own workspace data',                     '{"rlsEnforced":true}')
ON CONFLICT (rule_name) DO NOTHING;

-- RLS: any authenticated founder can read rules; only service_role can modify
ALTER TABLE decision_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "decision_rules_read" ON decision_rules;
CREATE POLICY "decision_rules_read" ON decision_rules FOR SELECT USING (true);
REVOKE INSERT, UPDATE, DELETE ON decision_rules FROM authenticated, anon;
