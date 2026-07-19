# ADR-051: Recommendation Engine

**Status:** Accepted  
**Milestone:** 10 — Intelligence Network & Recommendation Engine  
**Date:** 2026-07-09

## Context

Milestones 07–09 created an opportunities system (`saved_opportunities`, `owner.route.ts`) with basic hardcoded seeding. Recommendations need to be generated from unified signals: Growth Brain, Marketing Memory, Knowledge Graph, campaign metrics, experiment results, and Intelligence Network benchmarks.

## Decision

**Extend `saved_opportunities`** (migration 046) with M10 fields rather than create a new `recommendations` table. This satisfies the "no duplicate recommendation systems" requirement.

New columns on `saved_opportunities`:
- `recommendation_type` — typed enum matching spec: opportunity/warning/optimization/budget/expansion/competitive_response/content_recommendation/campaign_recommendation
- `score` NUMERIC(6,4) — composite score 0–1
- `priority` INTEGER — rank within a founder's backlog
- `source_signals` JSONB — array of signal references that generated this recommendation
- `expires_at` TIMESTAMPTZ — time-bound recommendations auto-expire
- `feedback_summary` JSONB — aggregated feedback signals

**Recommendation Engine service** (`recommendationEngineService.ts`):
- `generateRecommendations(founderId, productId)` — assembles context from 5 parallel sources, scores via Haiku, stores in `saved_opportunities`
- `scoreRecommendation(signals, context)` — deterministic scoring: impact × confidence × urgency
- `deduplicateRecommendations(founderId, productId)` — prevents duplicate active recommendations by key

**Scoring formula:**
```
score = (impact_weight × 0.4) + (confidence × 0.3) + (urgency × 0.2) + (source_quality × 0.1)
```
- impact_weight: 1.0 (expansion/launch), 0.8 (optimization), 0.6 (content), 0.4 (warning)
- urgency: derived from expires_at proximity
- source_quality: 1.0 (campaign data), 0.8 (experiment), 0.6 (memory), 0.4 (benchmark)

## Consequences

- No duplicate storage — recommendations live in `saved_opportunities` with richer metadata
- Existing M07 `/owner/opportunities` endpoints continue to work with no breaking changes
- New `/recommendations` endpoints provide richer access (type filtering, feedback, history)
- Mission conversion remains unchanged (set state='converted', mission_id=...)
