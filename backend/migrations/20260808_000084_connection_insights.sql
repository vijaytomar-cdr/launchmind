-- @file 20260808_000084_connection_insights.sql
-- @description Evidence-backed insights derived from imported provider data.
--
--   Spec §11 (every useful connection produces a value moment) and §12
--   (store evidence/provenance so the insight can be explained).
--
--   An insight is NOT free text. Each row records:
--     - the headline and explanation shown to the owner
--     - `evidence`: the actual numbers the conclusion rests on
--     - `source_signal_ids`: the intelligence_signals rows it was computed from
--     - `provenance`: which provider, report, sync run, and period produced it
--   so "why does LaunchMind believe this?" can be answered from the database rather
--   than regenerated.
--
-- @security
--   - Workspace-scoped read via lm_is_workspace_member (migration 080).
--   - Insert is service_role only: insights are derived by the sync pipeline, never
--     authored by a client.
--   - No provider credentials or raw payloads are stored here — evidence holds
--     aggregate numbers only.
-- @dependencies workspaces, workspace_connections, products, intelligence_signals,
--   lm_is_workspace_member

BEGIN;

CREATE TABLE IF NOT EXISTS connection_insights (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id     UUID NOT NULL REFERENCES workspace_connections(id) ON DELETE CASCADE,
  product_id        UUID REFERENCES products(id) ON DELETE SET NULL,
  provider          TEXT NOT NULL,

  -- Stable identifier for the rule that produced this insight (e.g.
  -- 'app_store.conversion_below_benchmark'). Lets a later sync supersede the same
  -- finding instead of stacking duplicates.
  insight_key       TEXT NOT NULL,
  headline          TEXT NOT NULL,
  detail            TEXT NOT NULL,
  -- What the owner should consider doing. Never an instruction to spend.
  recommended_focus TEXT,

  -- The numbers behind the conclusion: [{ label, value, unit? }, …]
  evidence          JSONB NOT NULL DEFAULT '[]',
  -- Which intelligence_signals rows this was computed from.
  source_signal_ids UUID[] NOT NULL DEFAULT '{}',
  -- { provider, report_name, sync_run_id, period_start, period_end, computed_at, method }
  provenance        JSONB NOT NULL DEFAULT '{}',

  -- 0–1. Derived from sample size and margin, never hand-set.
  confidence        NUMERIC(4,3),

  period_start      DATE,
  period_end        DATE,
  sync_run_id       UUID REFERENCES connection_sync_runs(id) ON DELETE SET NULL,
  trace_id          TEXT,

  -- Set when a later sync replaces this finding. Superseded rows are retained so the
  -- learning history stays explainable.
  superseded_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One live insight per (connection, rule). Superseded rows are excluded so history
-- accumulates without violating the constraint.
CREATE UNIQUE INDEX IF NOT EXISTS connection_insights_live
  ON connection_insights (connection_id, insight_key)
  WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS connection_insights_workspace
  ON connection_insights (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS connection_insights_connection
  ON connection_insights (connection_id, created_at DESC);

ALTER TABLE connection_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "connection_insights_workspace_read" ON connection_insights;
CREATE POLICY "connection_insights_workspace_read" ON connection_insights
  FOR SELECT USING (lm_is_workspace_member(workspace_id));

-- Derived by the sync pipeline only; clients read.
REVOKE INSERT, UPDATE, DELETE ON connection_insights FROM authenticated, anon;
GRANT SELECT ON connection_insights TO authenticated;
GRANT SELECT, INSERT, UPDATE ON connection_insights TO service_role;

COMMIT;
