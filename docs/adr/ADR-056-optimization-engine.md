# ADR-056: Optimization Engine

**Date:** 2026-07-09  
**Status:** Accepted  
**Milestone:** M11 — Analytics, Reporting & Optimization

## Context

After execution, validated learnings must flow back into Growth Brain (Marketing Memory) and the Recommendation Engine. The Optimization Engine is the bridge: it reads performance data, derives structured insights using AI, and re-injects them as first-class signals.

## Decision

1. **`optimization_insights` table (migration 061)** — stores AI-derived insights per product with type, title, description, impact estimate, confidence, and status lifecycle (pending → applied/dismissed/expired).

2. **Insight types**: `channel_optimization | budget_reallocation | creative_refresh | audience_expansion | timing_optimization | funnel_fix`

3. **Generation trigger**: `POST /analytics/optimize?productId=` — calls `optimizationEngineService.generateInsights()`. Uses `callHaiku` (fast, cheap) with the structured metrics context from `analyticsService`.

4. **Learning pipeline integration**: After inserting insights, the service calls `ingestLearningEvent('analytics_synced', ...)` with the insight data. This feeds Marketing Memory. If insight confidence ≥ 0.8, also calls `generateRecommendations()` to update the Growth Backlog.

5. **No automatic cron** in MVP — generation is founder-triggered (via `POST /analytics/optimize`). Future milestone adds a weekly cron after weekly brief generation.

6. **Decision Engine integration**: `optimizationEngineService` checks `checkTokenBalance` before AI generation — consistent with §1.4.

7. **Insight deduplication**: `UNIQUE(product_id, insight_type, title)` on active insights prevents flooding.

## Consequences

- Optimization insights feed Marketing Memory (via learningPipeline) AND the Recommendation Engine (via generateRecommendations). This closes the execution → intelligence loop.
- Claude Haiku tokens consumed per generate call: ~10.
- Insights expire after 30 days. Expired insights are soft-deleted via `status = 'expired'` by a cron (future milestone).
- The `applied_at` + `action_taken` fields allow tracking ROI of applied insights in future reporting.
