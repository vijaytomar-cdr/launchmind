# ADR-040: Asset Library

**Status:** Accepted  
**Date:** 2026-07-08  
**Milestone:** 08 — Content Studio

---

## Context

Content assets are currently stored in `content_assets` but only surfaced through the briefs page with minimal filtering. Founders need a searchable, filterable asset library with tags, archiving, publishing records, and performance attribution.

---

## Decision

### Asset Library is `content_assets` + Extensions

The library is not a separate table — it's the existing `content_assets` table extended with:

- `tags TEXT[]` — founder-defined labels for organisation
- `mission_id UUID` — mission that triggered generation (FK missions)
- `growth_brain_version INTEGER` — ICP version at time of generation
- `archived_at TIMESTAMPTZ` — soft-delete (null = active)
- `published_at TIMESTAMPTZ` — when first published to a live channel

Search and filtering on these columns enables the full asset library experience.

### Library API

`GET /studio/assets` with query params:
- `search` — full-text search on `text_content` + `structured_data`
- `type` — filter by asset_type
- `status` — pending / approved / held / archived
- `channel` — meta / google / whatsapp / email / linkedin / web
- `market` — usa / india / both
- `language` — english / hindi / hinglish
- `missionId` — assets from a specific mission
- `tags` — comma-separated tag filter
- `limit` / `offset` — pagination

### Archive / Restore

- `POST /studio/assets/:id/archive` — sets `archived_at`. Archived assets don't appear in default list.
- `POST /studio/assets/:id/restore` — clears `archived_at`.

Archived assets are not deleted from DB. Performance data (`installs`, `impressions`, `cpi`) is preserved.

### Publishing Targets

`publishing_targets` table records every time an asset is published to a live channel:
- `channel`, `platform_url`, `published_by`, `published_at`, `status` (live/removed/error)
- Linked to `content_assets.id`
- RLS: founder_id-scoped

### Tags

Tags are free-text arrays stored in `content_assets.tags`. No separate tag table — array operations in Postgres are sufficient at this scale.

---

## Consequences

- Existing `/products/:id/content-assets` route unchanged — asset library is an additive layer
- Archive replaces delete — performance data never lost
- Publishing records enable "what's live right now" queries
- Tags enable grouping assets across products and campaigns
