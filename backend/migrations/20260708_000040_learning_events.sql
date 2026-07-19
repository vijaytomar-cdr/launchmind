-- Migration: 20260708_000040_learning_events
-- Audit log for every learning pipeline invocation.
-- Captures the event type, payload, and results (memories created/updated,
-- nodes/edges built). Failed events are retained with error detail for retry.
-- Idempotent: safe to run twice.

CREATE TABLE IF NOT EXISTS learning_events (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id        UUID        NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id        UUID                    REFERENCES products(id) ON DELETE CASCADE,
  event_type        TEXT        NOT NULL
                    CHECK (event_type IN (
                      'intake_completed','growth_brain_approved','campaign_result',
                      'review_ingested','analytics_synced','founder_feedback',
                      'ai_conversation','experiment_result'
                    )),
  payload           JSONB       NOT NULL DEFAULT '{}',
  memories_created  INTEGER     NOT NULL DEFAULT 0,
  memories_updated  INTEGER     NOT NULL DEFAULT 0,
  nodes_created     INTEGER     NOT NULL DEFAULT 0,
  edges_created     INTEGER     NOT NULL DEFAULT 0,
  status            TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','completed','failed')),
  error             TEXT,
  processed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE learning_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'learning_events' AND policyname = 'events_owner'
  ) THEN
    DROP POLICY IF EXISTS "events_owner" ON learning_events;
CREATE POLICY "events_owner" ON learning_events
      USING (founder_id = auth.uid());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS events_product_type
  ON learning_events(product_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS events_status
  ON learning_events(founder_id, status)
  WHERE status IN ('pending','processing','failed');
