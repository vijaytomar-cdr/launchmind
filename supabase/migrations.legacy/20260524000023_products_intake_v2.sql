-- Phase 5 Week 18: Enhanced product intake flow.
-- Adds 11 new nullable columns to products for multi-URL intake,
-- founder context, website metadata, screenshot analysis, and intake progress tracking.
-- All columns are nullable and additive — existing rows are unaffected.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS app_store_url        TEXT,
  ADD COLUMN IF NOT EXISTS play_store_url       TEXT,
  ADD COLUMN IF NOT EXISTS website_url          TEXT,
  ADD COLUMN IF NOT EXISTS founder_context      JSONB,
  ADD COLUMN IF NOT EXISTS website_meta         JSONB,
  ADD COLUMN IF NOT EXISTS screenshot_analysis  JSONB,
  ADD COLUMN IF NOT EXISTS intake_step          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS intake_completed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS selected_markets     TEXT[],
  ADD COLUMN IF NOT EXISTS primary_channel      TEXT,
  ADD COLUMN IF NOT EXISTS excluded_channels    TEXT[];
