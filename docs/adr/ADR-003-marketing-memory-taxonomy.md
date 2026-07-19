# ADR-003: Marketing Memory — 10-Type Taxonomy vs. Flat Learning Store
Status: Accepted
Date: July 2026

## Context
The current `content_learnings` table stores regen reasons, approvals, and winners in a flat structure with a `learning_type` field (`regen_reason | approved | winner | loser`). This is insufficient for the Marketing Memory system described in Architecture Baseline §11, which requires 10 distinct memory categories: Founder, Brand, Product, Campaign, Customer, Review, Competitor, Market, Experiment, Seasonality.

## Decision
Create a new `marketing_memory` table with a `memory_type` CHECK constraint covering all 10 types. The existing `content_learnings` table is preserved for backward compatibility and migrated into `marketing_memory` as part of Phase 6 setup.

The `marketing_memory` table uses:
- `key` (TEXT) — what is remembered (e.g. "hook_type_winner_india_whatsapp")
- `value` (JSONB) — structured memory content
- `confidence` (NUMERIC 0–1) — how confident we are in this memory
- `source` (TEXT) — what generated this memory (e.g. "content_approval", "weekly_brief")
- `supersedes_id` — points to the row this memory replaces
- `embedding` (VECTOR 1536) — for semantic memory retrieval

Every AI request via Context Engine retrieves relevant memories via semantic search (`embedding <-> query_embedding`).

## Consequences
- Richer learning loop — 10 memory types vs. 4 learning types
- Memories can be retrieved semantically (not just by type)
- Memory can be versioned and superseded
- `content_learnings` preserved — no breaking change
- `marketing_memory` starts empty and builds over time as founders use the product
