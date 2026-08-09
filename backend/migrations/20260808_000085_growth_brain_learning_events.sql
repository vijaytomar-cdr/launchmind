-- Migration: 20260808_000085_growth_brain_learning_events
--
-- The explainability surface behind "View learning log →" (spec §4.3, §16).
--
-- WHY A NEW TABLE rather than reusing learning_events (migration 040):
--   learning_events is the Marketing Memory ingestion audit — it records that a
--   pipeline ran and how many memories/nodes it wrote. It has no notion of a prior
--   recommendation, a resulting recommendation, or a confidence before and after,
--   and it is founder-scoped rather than workspace-scoped. The learning log has to
--   answer "what did LaunchMind believe, what changed it, and what does it believe
--   now" for a specific workspace. Bolting those columns onto learning_events would
--   change the meaning of every existing row.
--
-- APPEND-ONLY. A trust surface that can be edited after the fact is not evidence,
-- so UPDATE and DELETE are revoked from every non-superuser role.
--
-- Additive and idempotent: safe to run twice.

CREATE TABLE IF NOT EXISTS growth_brain_learning_events (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenancy. workspace_id is the authorization boundary; founder_id is retained so
  -- founder-scoped surfaces (Growth Brain context cards) can join without a second hop.
  workspace_id                UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  founder_id                  UUID        NOT NULL REFERENCES founders(id)   ON DELETE CASCADE,
  product_id                  UUID                 REFERENCES products(id)   ON DELETE CASCADE,

  -- What caused the change.
  event_type                  TEXT        NOT NULL
                              CHECK (event_type IN (
                                'source_connected',
                                'source_synced',
                                'source_disconnected',
                                'source_reauthorized',
                                'context_updated',
                                'context_delta_updated',
                                'recommendation_updated',
                                'authority_changed'
                              )),
  -- Owner-facing one-line description of the trigger, e.g.
  -- "App Store Connect reported 7 days of product-page performance".
  trigger                     TEXT        NOT NULL,

  -- Provenance. Any of these may be NULL for a founder-initiated change.
  provider                    TEXT,
  connection_id               UUID                 REFERENCES workspace_connections(id) ON DELETE SET NULL,
  sync_run_id                 UUID                 REFERENCES connection_sync_runs(id)  ON DELETE SET NULL,
  trigger_signal_id           UUID                 REFERENCES intelligence_signals(id)  ON DELETE SET NULL,
  trace_id                    TEXT,

  -- The evidence LaunchMind actually used. Array of { label, value } pairs, mirroring
  -- connection_insights.evidence so the two surfaces render identically.
  evidence                    JSONB       NOT NULL DEFAULT '[]'::jsonb,

  -- Before and after. Free-form text so a state can be a recommendation, a strategy
  -- headline, or a context field — the log has to describe all three.
  previous_state              TEXT,
  new_state                   TEXT,

  -- 0–100 to match the Growth Brain understanding score the owner already sees.
  -- NULL when a change genuinely did not move confidence; never defaulted to 0,
  -- which would render as "confidence collapsed".
  prior_confidence            NUMERIC(5,2),
  new_confidence              NUMERIC(5,2),

  -- What downstream work this changed.
  recommendation_ids_affected UUID[]      NOT NULL DEFAULT ARRAY[]::UUID[],
  mission_ids_affected        UUID[]      NOT NULL DEFAULT ARRAY[]::UUID[],

  -- 'system' = LaunchMind concluded this from data on its own.
  -- 'founder' = a person confirmed or entered it.
  -- The distinction is the point of the log, so it is NOT NULL.
  created_by_type             TEXT        NOT NULL DEFAULT 'system'
                              CHECK (created_by_type IN ('system', 'founder')),
  created_by                  UUID                 REFERENCES founders(id) ON DELETE SET NULL,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Newest-first read per workspace is the only access pattern the log has.
CREATE INDEX IF NOT EXISTS gble_workspace_created
  ON growth_brain_learning_events(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS gble_product_created
  ON growth_brain_learning_events(product_id, created_at DESC)
  WHERE product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gble_connection
  ON growth_brain_learning_events(connection_id)
  WHERE connection_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gble_trace
  ON growth_brain_learning_events(trace_id)
  WHERE trace_id IS NOT NULL;

ALTER TABLE growth_brain_learning_events ENABLE ROW LEVEL SECURITY;

-- Read: any accepted member of the workspace. Same rule as workspace_connections
-- (migration 080), using the same helper so the two cannot drift apart.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'growth_brain_learning_events'
      AND policyname = 'gble_workspace_read'
  ) THEN
    CREATE POLICY "gble_workspace_read" ON growth_brain_learning_events
      FOR SELECT
      USING (lm_is_workspace_member(workspace_id));
  END IF;
END $$;

-- Append-only. Writes go through the service role; nobody may rewrite history.
REVOKE UPDATE, DELETE ON growth_brain_learning_events FROM authenticated, anon;
