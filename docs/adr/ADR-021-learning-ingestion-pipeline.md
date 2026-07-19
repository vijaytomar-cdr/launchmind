# ADR-021 — Learning Ingestion Pipeline

**Date:** 2026-07-08
**Status:** Accepted
**Milestone:** 04 — Marketing Memory & Knowledge Graph

---

## Context

Learnings must be captured from 8 sources: product intake, Growth Brain approvals, campaign performance, reviews, analytics, founder feedback, AI conversations, and experiment results. Each source produces different data shapes. We need a pipeline that is consistent, auditable, and resilient to partial failures.

---

## Decision

**All learning ingestion goes through a single `ingestLearningEvent()` entry point in `learningPipelineService.ts`. Events are written to `learning_events` before processing.**

Pipeline stages:

```
1. Write learning_events row (status = 'pending')
2. Extract memory drafts from event payload  
3. Validate & score each draft (confidence 0.0–1.0)
4. Deduplicate against existing active memories
5. Persist: upsert marketing_memory + create version record
6. Build/update knowledge graph nodes and edges
7. Write evidence records linking memories to source data
8. Update learning_events row (status = 'completed')
```

Synchronous vs asynchronous:

- `intake_completed`, `founder_feedback`, `growth_brain_approved` → **synchronous** — called inline from the route handler. Founder is waiting for a response.
- `campaign_result`, `review_ingested`, `analytics_synced`, `experiment_result` → **asynchronous** via BullMQ `learningQueue`. High volume, non-blocking.
- `ai_conversation` → **synchronous** (triggered by founder explicitly submitting feedback in a conversation).

Failure handling:

- If pipeline fails after writing the event, `status = 'failed'` and `error` is set.
- BullMQ retries async events up to 3 times with exponential backoff.
- Failed events are never silently dropped — they remain in `learning_events` for inspection.

Memory extraction per event type:

| Event type | Memories extracted |
|---|---|
| intake_completed | product (from confirmed_icp), brand (from brand_voice_profile), customer (from icp.targetUser + painPoints), competitor (from competitor_set) |
| growth_brain_approved | market (from market strategy), product (positioning), channel (recommendations) |
| campaign_result | campaign (metrics + hook performance), creative (top asset), channel (platform CPI/CTR) |
| review_ingested | review (sentiment + themes), customer (new pain point discovered) |
| analytics_synced | market (install velocity), seasonality (time-based signals) |
| founder_feedback | any type (founder explicitly corrects/adds to memory) |
| ai_conversation | any type (extracted from conversation by Claude Haiku) |
| experiment_result | experiment (hypothesis + outcome), creative (winning variant) |

---

## Consequences

- Every learning is auditable via `learning_events` — who triggered it, what payload came in, what was created.
- The `memories_created` and `memories_updated` counters on `learning_events` give observability metrics.
- Pipeline is idempotent: re-processing the same event with the same payload produces the same result (dedup prevents duplicate memories).
- Growth Brain (Milestone 03) automatically benefits from improved memories after any intake or campaign result.
- Context Engine (Milestone 05) reads from `marketing_memories` directly — it is never aware of where learnings came from.

---

## Rejected Alternatives

- **Webhook-based ingestion**: Rejected because we control all event sources. Internal function calls are simpler and faster.
- **Event sourcing with event store**: Rejected as over-engineering for current scale. `learning_events` provides the audit trail without full event sourcing complexity.
- **Direct DB inserts from routes (no pipeline)**: Rejected because it bypasses validation, scoring, and deduplication — leading to noisy/inconsistent memories.
