# ADR-022 — Memory Deduplication Strategy

**Date:** 2026-07-08
**Status:** Accepted
**Milestone:** 04 — Marketing Memory & Knowledge Graph

---

## Context

The same learning may arrive multiple times from different sources (e.g. "WhatsApp performs well for India" extracted from campaign metrics AND from playbook signals). Without deduplication, memories accumulate noise and contradictions. But over-aggressive dedup may merge genuinely different insights.

---

## Decision

**Two-stage deduplication: exact-match first, semantic similarity second. Conflicts surface to the founder — never auto-merged.**

Stage 1 — Exact match (synchronous, applied during ingestion):
- Match on `(founder_id, product_id, memory_type, source)` + a content hash of key fields.
- If exact match found with same content → skip insert, update `updated_at` and confidence only.
- If exact match found with different content → create new version of the existing memory.

Stage 2 — Semantic similarity (asynchronous, background job):
- After embedding is generated for a new memory, run pgvector cosine similarity against existing memories of the same `(founder_id, memory_type)`.
- If cosine similarity > 0.92 → flag both as `potential_duplicate` in metadata.
- A `duplicate_candidates` field in `marketing_memories.content` stores candidate IDs.
- The `/memory/duplicates` endpoint returns these for founder review.

Merge rules (triggered by `POST /memory/:id/merge/:targetId`):
- Combined confidence = `max(confidence_a, confidence_b) + 0.05` (capped at 1.0).
- Evidence is unioned.
- The discarded memory is archived (not deleted) with `archive_reason = 'merged_into:{keepId}'`.
- Knowledge graph edges pointing to the discarded node are redirected to the kept node.
- A `marketing_memory_versions` record is created on the kept memory documenting the merge.

Auto-merge threshold: Never. We err on the side of showing the founder two separate memories. The cost of a false merge (losing distinct insights) is higher than the cost of showing a "Review duplicates" badge on the Memory dashboard.

---

## Consequences

- Founders get a clear "Review duplicates" workflow rather than silent auto-merging.
- The database retains both memories until explicitly merged — no data is lost.
- Semantic dedup requires embeddings to be generated (background job). Until embeddings exist, only exact-match dedup runs.
- Knowledge graph merge is handled automatically during memory merge to keep the graph consistent.
- The `evidence` table records which memories have been merged and why — full audit trail.

---

## Rejected Alternatives

- **Full auto-merge on similarity > 0.9**: Rejected. High false-positive rate would silently destroy distinct learnings.
- **No deduplication**: Rejected. Without dedup, "WhatsApp works for India" appears 50+ times from repeated campaign results. Noise degrades AI quality.
- **Founder manually reviews all potential duplicates immediately**: Rejected. Blocking ingestion on founder review creates UX friction. Surface candidates non-blocking, let founder review at their own pace.
