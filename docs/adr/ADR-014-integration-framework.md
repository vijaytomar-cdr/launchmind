# ADR-014: Integration Framework
Status: Accepted
Date: July 2026

## Context
The existing `platform_tokens` table stores OAuth credentials for meta/google/whatsapp/linkedin/email. Milestone 02 requires additional integrations: App Store (read-only scraping), Google Play (read-only), GA4 (analytics API key), Firebase (service account), Search Console (OAuth), Website (URL-based), Meta Ads, Google Ads.

## Options Considered
1. **New `integrations` table** — separate from platform_tokens, different schema
2. **Extend `platform_tokens`** — widen the CHECK constraint, add integration_config JSONB

## Decision
**Extend `platform_tokens`** (Engineering Contract: "Never duplicate database tables").

Changes:
- DROP + RECREATE the `platform` CHECK to include new values: `ga4 | firebase | search_console | website`
- Add `integration_config` JSONB column — stores integration-specific metadata (e.g. GA4 property ID, website URL, service account project ID)
- Add `integration_type` column — distinguishes the auth mechanism: `oauth | api_key | service_account | url_only`

For integrations that don't have tokens (website URL-only): encrypted_token stores a placeholder `'url_only'`, actual URL in integration_config.

Existing rows are unaffected — all new columns nullable with sensible defaults.

## Security
- GA4 API keys and Firebase service accounts: AES-256 encrypted in `encrypted_token`, same KMS as OAuth tokens
- Website integration: no token — `encrypted_token = 'url_only'`, URL in `integration_config.url`
- App Store / Play Store: no persistent token — URL stored in `products.app_store_url` / `products.play_store_url` (already done)
- All existing security properties of `platform_tokens` (RLS, never return encrypted_token) apply to new integration types

## Consequences
- Existing channel connect/disconnect routes continue to work unchanged
- New integration routes added to `channels.route.ts` alongside existing OAuth routes
- `integration_type` enables the UI to show the correct connection UI (OAuth button vs API key input vs URL field)
- Listing integrations (GET /channels) returns `integration_config` but never `encrypted_token`
