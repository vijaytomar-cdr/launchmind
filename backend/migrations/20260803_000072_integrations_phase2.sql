-- @file 20260803_000072_integrations_phase2.sql
-- @description Extends platform_tokens CHECK constraint to include Phase 2 capability unlock
--   sources: app_store_connect, revenue_cat, google_ads, meta_ads.
--   All changes additive — existing rows unaffected.
--   Idempotent: DROP CONSTRAINT IF EXISTS before re-adding.

BEGIN;

ALTER TABLE platform_tokens
  DROP CONSTRAINT IF EXISTS platform_tokens_platform_check;

ALTER TABLE platform_tokens
  ADD CONSTRAINT platform_tokens_platform_check
  CHECK (platform IN (
    'meta', 'google', 'whatsapp', 'linkedin', 'email',
    'ga4', 'firebase', 'search_console', 'website',
    'app_store_connect', 'revenue_cat', 'google_ads', 'meta_ads'
  ));

COMMIT;
