-- @file 20260808_000079_connection_trace_id.sql
-- @description Adds correlation (trace) identifiers across the Improve Intelligence
--   sync chain so a single owner action can be followed end to end:
--     HTTP request → workspace_connections → connection_sync_runs → BullMQ job
--     → intelligence_signals → learning_events.
--   learning_events carries its trace id inside the existing payload JSONB
--   (payload->>'trace_id') so this migration does not touch that table.
-- @security No RLS change. No column drops, renames, or retypes. Additive only.
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.

BEGIN;

-- Last trace id that touched this connection (most recent sync or auth attempt).
ALTER TABLE workspace_connections
  ADD COLUMN IF NOT EXISTS last_trace_id TEXT;

-- Trace id for the request/job that produced this sync run.
ALTER TABLE connection_sync_runs
  ADD COLUMN IF NOT EXISTS trace_id TEXT;

-- Trace id of the sync run that imported this signal.
ALTER TABLE intelligence_signals
  ADD COLUMN IF NOT EXISTS trace_id TEXT;

-- Lookup by trace id when debugging a single owner action across tables.
CREATE INDEX IF NOT EXISTS connection_sync_runs_trace
  ON connection_sync_runs(trace_id)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS intelligence_signals_trace
  ON intelligence_signals(trace_id)
  WHERE trace_id IS NOT NULL;

COMMIT;
