-- Migration 076: connection_sync_runs
-- Tracks each sync attempt per connection for progress polling and history.

CREATE TABLE IF NOT EXISTS connection_sync_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id     UUID NOT NULL REFERENCES workspace_connections(id) ON DELETE CASCADE,
  founder_id        UUID NOT NULL REFERENCES founders(id),
  status            TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','running','completed','partial','failed')),
  progress          INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  current_step      TEXT,
  steps_completed   JSONB DEFAULT '[]',
  signals_imported  INTEGER DEFAULT 0,
  error_message     TEXT,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE connection_sync_runs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "sync_runs_owner" ON connection_sync_runs USING (founder_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS sync_runs_connection ON connection_sync_runs(connection_id);
CREATE INDEX IF NOT EXISTS sync_runs_founder_status ON connection_sync_runs(founder_id, status);
