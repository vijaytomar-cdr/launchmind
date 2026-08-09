-- @file 20260708_000034_integrations_extend.sql
-- @description Extends platform_tokens to support additional integration types (ADR-014).
--   Widens the platform CHECK to include ga4/firebase/search_console/website.
--   Adds integration_type (auth mechanism) and integration_config (integration metadata).
--   All changes additive — existing rows unaffected.

BEGIN;

-- Drop the existing CHECK constraint and replace with wider one
-- (PostgreSQL requires drop+recreate to change CHECK values)
ALTER TABLE platform_tokens
  DROP CONSTRAINT IF EXISTS platform_tokens_platform_check;

ALTER TABLE platform_tokens
  ADD CONSTRAINT platform_tokens_platform_check
  CHECK (platform IN (
    'meta', 'google', 'whatsapp', 'linkedin', 'email',
    'ga4', 'firebase', 'search_console', 'website'
  ));

-- Auth mechanism type — helps UI render the correct connection UI
ALTER TABLE platform_tokens
  ADD COLUMN IF NOT EXISTS integration_type TEXT
    CHECK (integration_type IN ('oauth', 'api_key', 'service_account', 'url_only')),
  ADD COLUMN IF NOT EXISTS integration_config JSONB;
  -- integration_config examples:
  --   ga4:            { propertyId: '123456789', measurementId: 'G-XXXX' }
  --   firebase:       { projectId: 'my-app', appId: '1:xxx' }
  --   search_console: { siteUrl: 'https://example.com' }
  --   website:        { url: 'https://example.com', verified: true }

COMMIT;
