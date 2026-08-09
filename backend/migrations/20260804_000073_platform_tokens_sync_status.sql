-- @file 20260804_000073_platform_tokens_sync_status.sql
-- @description Adds sync tracking columns to platform_tokens so the Capability Unlocks
--   "Initial sync complete" proof check can reflect real state instead of always false.
--   Additive only — existing rows get sync_status='pending', last_synced_at=NULL.
--   Idempotent: uses IF NOT EXISTS / DO NOTHING patterns.

BEGIN;

ALTER TABLE platform_tokens
  ADD COLUMN IF NOT EXISTS sync_status    TEXT DEFAULT 'pending'
    CHECK (sync_status IN ('pending', 'synced', 'error')),
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sync_error     TEXT;

-- Index for quick lookup of pending syncs by workers
CREATE INDEX IF NOT EXISTS platform_tokens_sync_status_idx
  ON platform_tokens (sync_status)
  WHERE revoked_at IS NULL;

COMMIT;
