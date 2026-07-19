# ADR-019 — Marketing Memory Ownership

**Date:** 2026-07-08
**Status:** Accepted
**Milestone:** 04 — Marketing Memory & Knowledge Graph

---

## Context

LaunchMind accumulates knowledge from many sources: product intake, campaign performance, reviews, founder feedback, and AI conversations. This knowledge currently lives scattered across `products.confirmed_icp`, `products.brand_voice_profile`, `products.competitor_set`, `campaign_metrics`, `weekly_briefs`, and `content_learnings`. There is no unified, versioned, searchable store.

Milestone 04 introduces Marketing Memory as the canonical persistence layer for all learned knowledge. We need to decide who owns memories, how they are scoped, and how versions are managed.

---

## Decision

**Marketing Memory is founder-scoped, with product-level partitioning.**

Rules:

1. Every `marketing_memory` row has a `founder_id` (always set) and an optional `product_id`.
2. Founder-level memories (`memory_type = 'founder'` or `'brand'`) may have `product_id = NULL` — they describe the founder or brand across all products.
3. Product-specific memories (`memory_type` in `product | customer | campaign | creative | review | competitor | experiment | market | seasonality`) always have `product_id` set.
4. RLS policy: `founder_id = auth.uid()`. A founder never sees another founder's memories.
5. Memory content is **append-only for versions** — existing content is never mutated in place. Every update creates a new row in `marketing_memory_versions` with the previous content before applying the change.
6. A memory can be `draft | active | archived`. Only `active` memories are returned by default queries and consumed by the Context Engine.
7. Confidence is a `NUMERIC(3,2)` value (0.0–1.0) computed from evidence, not set arbitrarily. The system updates confidence automatically when new evidence arrives.

---

## Consequences

- Growth Brain (Milestone 03) and the Context Engine (Milestone 05) consume only `status = 'active'` memories.
- Archiving a memory does not delete it — full audit trail is preserved.
- Founder-level memories (brand voice, founder story, mission) are shared across all products owned by that founder.
- The 11 memory types map directly to the 11 learning sources in the spec: Founder, Brand, Product, Customer, Campaign, Creative, Review, Competitor, Experiment, Market, Seasonality.
- Memory embeddings are populated asynchronously by a background worker. Search falls back to full-text when embeddings are unavailable.

---

## Rejected Alternatives

- **Per-workspace scoping**: Rejected because memories are fundamentally about founder knowledge, not workspace management. Workspaces are for product organisation.
- **Immutable memories (no update)**: Rejected because founders need to correct AI-generated learnings. Versioning gives audit trail without full immutability.
- **Single confidence field set by AI**: Rejected because a single AI call can be wrong. Confidence must accumulate from multiple evidence sources.
