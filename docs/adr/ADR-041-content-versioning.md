# ADR-041: Content Versioning

**Status:** Accepted  
**Date:** 2026-07-08  
**Milestone:** 08 — Content Studio

---

## Context

Content assets are currently single-row records. When a founder edits or regenerates an asset, the previous version is lost. We need version history for: audit trail, A/B testing attribution, rollback, and prompt version tracking.

---

## Decision

### Append-Only Version History in `content_versions`

Every time a content asset is edited (`PUT /studio/assets/:id`) or regenerated, a new row is inserted into `content_versions` before the update:

```
content_assets (current state) ← points to active text/structured_data
content_versions (history) ← every prior state
```

`content_assets` stores the **current live version**. `content_versions` stores every **prior version**.

### Version Record Schema

```sql
content_versions:
  id, asset_id (FK content_assets), version_number,
  text_content, structured_data,
  prompt_version, growth_brain_version,
  change_type (editor_save | ai_regen | ai_transform | bulk_approve),
  change_summary (string, e.g. "Tone changed to conversational"),
  changed_by (founder_id),
  created_at
```

### When Versions Are Created

| Trigger | change_type |
|---|---|
| Founder saves in editor | `editor_save` |
| Regeneration (existing) | `ai_regen` |
| AI transform (rewrite/expand/shorten/tone/translate) | `ai_transform` |
| Bulk approve (touched copy) | `bulk_approve` |

The initial generation does NOT create a version row — the first version is the `content_assets` row itself.

### Version Numbering

`version_number` is incremented from `MAX(version_number) + 1` for that `asset_id`. No gaps, no locks needed — version writes are sequential per asset (single founder, low concurrency).

### AI Transform Endpoint

`POST /studio/assets/:id/transform` with:
- `transformType`: `rewrite | expand | shorten | tone | translate | seo | aso`
- `targetTone` (optional, for tone transform): `professional | casual | urgent | friendly | authoritative`
- `targetLanguage` (optional, for translate): `hindi | hinglish | spanish | french`
- `targetLength` (optional): target character count for shorten/expand

The transform:
1. Saves current version to `content_versions`
2. Calls `callHaiku()` (< 512 tokens) with the transform prompt
3. Updates `content_assets.text_content` with the transformed text
4. Returns the new text

### Version Compare

`GET /studio/assets/:id/versions` returns all versions ordered by `version_number DESC`. Frontend can diff any two versions.

---

## Consequences

- `content_versions` table is append-only (REVOKE UPDATE, DELETE for authenticated)
- Every edit is auditable with who changed what and when
- Rollback = `PUT /studio/assets/:id` with a previous version's text_content
- Prompt version tracking enables correlation between prompt changes and performance
