# ADR-042: Media Integration

**Status:** Accepted  
**Date:** 2026-07-08  
**Milestone:** 08 — Content Studio

---

## Context

Image and video generation exist (`replicateClient.ts`, `creatomateClient.ts`, `elevenLabsClient.ts`) but are invoked through separate one-off endpoints (`/content-assets/:id/generate-image`, `/content-assets/:id/render`). The Content Studio needs media generation wired into the unified pipeline with publishing targets and signed URL delivery.

---

## Decision

### Image Generation — Replicate Flux.1 Schnell (Existing)

Existing `POST /content-assets/:id/generate-image?style=photorealistic|graphic|mockup` remains unchanged. The Content Studio calls this for `meta_image_brief` and `carousel_brief` asset types.

New in M08: Image generation is also available for new types `landing_page_copy` (hero image) and `blog_post` (featured image) via the same endpoint.

### Video Generation — Creatomate (Existing)

Existing `POST /content-assets/:id/render` remains unchanged. Used for `video_reels_30s`, `video_shorts_60s`, `video_app_preview`.

### Signed URL Delivery

All media stored in Supabase Storage bucket `content-assets`. URLs stored in `content_assets.media_url` are already public CDN URLs. No change needed.

### Publishing Targets

New `publishing_targets` table records the destination of published media:

```sql
publishing_targets:
  id, asset_id (FK content_assets), founder_id,
  channel (meta | google | whatsapp | email | web | app_store | play_store),
  platform_url (TEXT — the live URL once published),
  external_id (TEXT — platform-assigned ID, e.g. Facebook Post ID),
  published_by (founder_id),
  published_at (TIMESTAMPTZ),
  status (TEXT: 'scheduled' | 'live' | 'removed' | 'error'),
  error_message (TEXT),
  created_at
```

### M08 Media Scope

M08 implements:
- ✅ Image generation for all visual types (existing + landing_page_copy hero)
- ✅ Video generation via Creatomate (existing)
- ✅ Publishing target records (new table)
- ⏳ Actual API posting to Meta/Google/WhatsApp (Milestone 09 — Campaign Manager)

Publishing to live channels in M08 = "mark as published + store URL". Actual programmatic posting via platform APIs is Milestone 09.

### Observability

Every media generation call logs to `ai_requests` via `aiPlatform.ts`:
- Model: `flux-schnell` or `creatomate-v1`
- Tokens/cost: approximated from resolution × time
- Latency: measured end-to-end

---

## Consequences

- No new media generation services needed — Replicate + Creatomate + ElevenLabs already wired
- Publishing targets table is the source of truth for "what's live"
- Platform API posting deferred to M09 — M08 records intent, M09 executes
- Signed URL pattern is ready when private buckets are needed (future enterprise plan)
