-- Migration 077: platform_tokens_providers_and_founder_context_extend
-- 1. Extends platform_tokens CHECK to accept all workspace connection providers
--    (stripe, hubspot, mailchimp not previously allowed).
-- 2. Extends founder_context with product planning context delta fields
--    (next_initiative, primary_goal, target_window).
-- 3. Makes founder_context.session_id nullable so context-delta rows can be
--    created outside of an onboarding session.
-- 4. Adds a partial unique index on founder_context(founder_id) for session-less rows.
--
-- All changes additive — existing rows unaffected.
-- Idempotent: IF NOT EXISTS / DROP CONSTRAINT IF EXISTS patterns.

BEGIN;

-- 1. Extend platform_tokens to accept all workspace connection providers
ALTER TABLE platform_tokens
  DROP CONSTRAINT IF EXISTS platform_tokens_platform_check;

ALTER TABLE platform_tokens
  ADD CONSTRAINT platform_tokens_platform_check
  CHECK (platform IN (
    'meta', 'google', 'whatsapp', 'linkedin', 'email',
    'ga4', 'firebase', 'search_console', 'website',
    'app_store_connect', 'revenue_cat', 'google_ads', 'meta_ads',
    'stripe', 'hubspot', 'mailchimp'
  ));

-- 2. Extend founder_context with product planning context delta columns
ALTER TABLE founder_context
  ADD COLUMN IF NOT EXISTS next_initiative  TEXT,
  ADD COLUMN IF NOT EXISTS primary_goal     TEXT,
  ADD COLUMN IF NOT EXISTS target_window    TEXT;

-- 3. Make session_id nullable so rows can exist without an onboarding session
ALTER TABLE founder_context
  ALTER COLUMN session_id DROP NOT NULL;

-- 4. Partial unique index: only one context-delta row per founder (where session_id IS NULL)
--    Does not affect existing rows that have a session_id.
CREATE UNIQUE INDEX IF NOT EXISTS founder_context_founder_delta_unique
  ON founder_context (founder_id)
  WHERE session_id IS NULL;

COMMIT;
