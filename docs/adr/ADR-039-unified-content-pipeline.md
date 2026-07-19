# ADR-039: Unified Content Pipeline

**Status:** Accepted  
**Date:** 2026-07-08  
**Milestone:** 08 — Content Studio

---

## Context

The existing `contentService.ts` generates 24 asset types in a single Sonnet call tied to the weekly brief cycle. Founders cannot generate individual content types on demand, cannot generate blog posts or landing pages, and cannot request a single asset type without running the full pipeline. Milestone 08 must add support for 5 new content types and on-demand per-type generation without breaking the existing weekly brief pipeline.

---

## Decision

### Single Pipeline — One Entry Point, Multiple Modes

All content generation (existing + new) routes through a single pipeline:

```
Mission (optional) → Context Engine → Prompt Registry → AI Platform → Draft → Version → Approval Gate → Asset Library
```

**Two invocation modes:**
1. **Batch** — existing: `generateContentAssets(productId, founderId, briefId)` generates all types in one Sonnet call. Used by weekly brief worker and strategy generation.
2. **On-demand** — new: `POST /studio/generate` generates one content type on demand using `callSonnet()` with a type-specific prompt.

Both modes write to `content_assets`. On-demand calls also create a `content_versions` row immediately.

### New Content Types (5)

Added to `content_assets.asset_type` CHECK constraint in migration 050:

| New Type | Channel | Use Case |
|---|---|---|
| `blog_post` | web | SEO-optimised blog article (title + body + meta description) |
| `landing_page_copy` | web | Landing page sections (headline, sub, 3 features, CTA, FAQ) |
| `push_notification` | mobile | Push title (50c) + body (100c) + action label (20c) |
| `release_notes` | mobile | App store release notes (500c max, what's new) |
| `press_release` | web | Press release (headline + boilerplate + quotes + body) |

### Mission Linking

Every `POST /studio/generate` call accepts an optional `missionId`. When provided:
- `content_assets.mission_id` is set
- The mission step is logged as "content generated"
- Mission agent type `content` uses this endpoint

### Growth Brain Versioning

Every generated asset stores the Growth Brain version at time of generation (`confirmed_icp` hash, incremented when ICP is updated). This allows A/B attribution: "version 2 assets outperformed version 1 by 18% CPI."

---

## Consequences

- Existing weekly brief pipeline unchanged — no breaking changes
- On-demand generation enabled for all 32 types (24 existing + 5 new + 3 future slots)
- Every on-demand asset is versioned from creation
- Mission ↔ asset linkage enables attribution reporting
