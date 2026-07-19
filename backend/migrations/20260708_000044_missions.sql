-- Migration: 044 — missions table
-- Creates the core mission entity that tracks all AI-driven work.
-- Missions are the unit of work for the Agent Platform (Milestone 06).

CREATE TABLE IF NOT EXISTS missions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id       UUID        NOT NULL REFERENCES founders(id)  ON DELETE CASCADE,
  product_id       UUID                 REFERENCES products(id)  ON DELETE CASCADE,
  workspace_id     UUID                 REFERENCES workspaces(id),

  -- Classification
  type             TEXT        NOT NULL
                   CHECK (type IN (
                     'research','strategy','planning','content','creative',
                     'campaign','publishing','optimization','learning',
                     'reporting','memory','benchmark'
                   )),
  title            TEXT        NOT NULL,

  -- State machine (see ADR-031)
  status           TEXT        NOT NULL DEFAULT 'draft'
                   CHECK (status IN (
                     'draft','queued','running','waiting_approval',
                     'completed','failed','cancelled'
                   )),

  -- Priority (higher = processed first by BullMQ)
  priority         INTEGER     NOT NULL DEFAULT 25,

  -- Trigger source
  trigger_type     TEXT        NOT NULL DEFAULT 'manual'
                   CHECK (trigger_type IN ('manual','cron','event','api')),

  -- Payload
  input            JSONB,
  output           JSONB,
  error            TEXT,

  -- Deduplication (format: founderId:productId:type:YYYY-WW)
  idempotency_key  TEXT,

  -- Timing
  scheduled_at     TIMESTAMPTZ,
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  failed_at        TIMESTAMPTZ,
  cancelled_at     TIMESTAMPTZ,

  -- Retry tracking
  retry_count      INTEGER     NOT NULL DEFAULT 0,
  max_retries      INTEGER     NOT NULL DEFAULT 3,

  -- Token consumption (sum of all steps)
  ai_tokens_consumed INTEGER   DEFAULT 0,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE missions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "missions_owner" ON missions;
CREATE POLICY "missions_owner" ON missions USING (founder_id = auth.uid());

-- Deduplication index — prevents duplicate missions with same idempotency_key
CREATE UNIQUE INDEX IF NOT EXISTS missions_idempotency_key
  ON missions(idempotency_key)
  WHERE idempotency_key IS NOT NULL
    AND status NOT IN ('failed', 'cancelled');

-- Query indexes
CREATE INDEX IF NOT EXISTS missions_founder_status  ON missions(founder_id, status);
CREATE INDEX IF NOT EXISTS missions_product_type    ON missions(product_id, type);
CREATE INDEX IF NOT EXISTS missions_scheduled_at    ON missions(scheduled_at) WHERE scheduled_at IS NOT NULL;
