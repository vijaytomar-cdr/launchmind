# ADR-053: Anonymous Benchmarking

**Status:** Accepted  
**Milestone:** 10 — Intelligence Network & Recommendation Engine  
**Date:** 2026-07-09

## Context

Founders need to know how their metrics compare to peers in the same category and market. But individual product data cannot be shared across tenants.

## Decision

**Benchmarks are category-level aggregates only.** A benchmark answers: "For apps in the [Productivity] category in [usa], the median CPI is $2.40." It never answers: "Your competitor X has CPI $1.80."

**Minimum cohort requirement:** Benchmarks are only published when ≥3 products share the category. This is enforced at ingestion time in `intelligenceNetworkService.ts`.

**Benchmark data flow:**
1. Campaign completes → `intelligenceNetworkService.ingestCampaignOutcome()` strips founder/product identity, aggregates into `playbook_signals`
2. Weekly BullMQ cron runs `intelligenceNetworkService.computeTrends()` → upserts `intelligence_trends`
3. Founder requests benchmarks → `GET /benchmarks` queries `playbook_signals` aggregate + `intelligence_trends`

**Authorization:**
- Any authenticated founder can read benchmarks (no plan gating — benchmark access is a core product value)
- Benchmarks are filtered by the requesting founder's product category (personalized but not identifying)

**Anti-gaming:**
- Founders cannot ingest their own data into `playbook_signals` directly — only `service_role` inserts
- No individual data point can be queried — only aggregates (AVG, MEDIAN, COUNT)

## Consequences

- Every founder benefits from platform intelligence without privacy risk
- No separate analytics service needed — Supabase Postgres aggregation is sufficient for this scale
- Trend freshness is weekly — acceptable for strategic decisions (not real-time dashboards)
- Benchmark quality improves automatically as platform grows (network effect)
