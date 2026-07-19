# ADR-030: Queue Strategy

**Status:** Accepted  
**Date:** 2026-07-08  
**Milestone:** 06 — Agent Platform & Mission Orchestrator

---

## Context

The spec calls for 8 per-agent queues (research, strategy, content, creative, campaign, publishing, optimization, reporting). The consolidation review shows 3 existing queues (weekly-brief, product-scrape, content-generation). We need to add the Mission execution queue without duplicating the existing infrastructure.

---

## Decision

### Single `mission-execution` Queue

Rather than 8 separate queues with 8 separate workers (high operational overhead, complex priority management), we use a single `mission-execution` queue with a single worker.

**Rationale:**
- Agent execution is the bottleneck at the LLM layer, not the queue layer
- Priority is managed by BullMQ job `priority` field (1–100)
- Agent type is a field in the job payload — the worker dispatches accordingly
- Queue splitting can be introduced in M08 when throughput data justifies it

**Queue name:** `mission-execution`  
**Concurrency:** 3 (balanced against 3 existing workers)  
**Max retries:** 3 (exponential backoff: 5s, 10s, 20s)  
**DLQ:** Failed jobs after 3 retries → stored in `missions.status = 'failed'` with full error context; log to Sentry

### Dead-Letter Queue (DLQ)

BullMQ does not have a native DLQ. We implement it as:
1. Job fails 3 times → BullMQ fires `failed` event
2. Worker catches it → calls `missionService.markFailed(missionId, error)`
3. `missions.status = 'failed'`, `missions.error = errorMessage`
4. Founders can see it in Mission Center and trigger `retryMission()`
5. `retryMission()` resets step statuses and re-enqueues — this is the "DLQ" recovery path

### Idempotency Keys

To prevent duplicate missions:
```typescript
// Uniqueness by (founder_id, product_id, type, YYYY-WW)
const idempotencyKey = `${founderId}:${productId}:strategy:${weekNumber}`;
```
If a mission with the same idempotency key is `queued`, `running`, or `completed`, the new create request returns the existing mission.

### Priority Levels

| Priority | Mission type | Value |
|---|---|---|
| P0 | Publishing (approve-gated, time-sensitive) | 100 |
| P1 | Campaign creation | 75 |
| P2 | Strategy + Content | 50 |
| P3 | Research, Reporting, Benchmark | 25 |
| P4 | Memory sync, Learning | 10 |

### Queue Configuration

```typescript
{
  name: 'mission-execution',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
  concurrency: 3,
}
```

### Existing Queues (Unchanged)

| Queue | Worker | Status |
|---|---|---|
| `weekly-brief` | weeklyBriefWorker | Unchanged |
| `product-scrape` | intakeWorker | Unchanged |
| `content-generation` | contentWorker | Unchanged |
| `video-render` | (inline in contentWorker) | Unchanged |
| **`mission-execution`** | **missionWorker (new)** | **New in M06** |

---

## Consequences

- One new queue, one new worker — minimal operational overhead.
- If a specific agent type causes queue starvation, add a dedicated queue for it in M08.
- Idempotency keys prevent duplicate strategy generations from double-clicks.
- DLQ via DB status means all failed missions are visible in Mission Center.
