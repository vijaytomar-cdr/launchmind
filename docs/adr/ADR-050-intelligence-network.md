# ADR-050: Intelligence Network Architecture

**Status:** Accepted  
**Milestone:** 10 — Intelligence Network & Recommendation Engine  
**Date:** 2026-07-09

## Context

LaunchMind collects rich campaign outcomes, ASO trends, review sentiment, and channel performance across all products. This data can improve recommendations for every founder, but sharing raw data violates tenant isolation and privacy.

## Decision

Extend the existing `playbook_signals` table (52 seed rows, migration 007) rather than create a parallel signals table. Add a new `intelligence_trends` table for pre-computed trend snapshots.

**Privacy rules (non-negotiable):**
- `playbook_signals` and `intelligence_trends` NEVER store `founder_id`, `product_id`, workspace identifiers, or any data that could re-identify a founder
- Signals are aggregated to category + market + channel granularity before storage
- Minimum cohort size: 3 products must share a category before a benchmark is published (anti-re-identification)
- Only `service_role` may INSERT; `authenticated` may SELECT only

**Signal sources:**
1. Anonymous campaign outcomes — after campaign completion, aggregate metric deltas by category/market/channel  
2. ASO trends — App Store category ranking shifts (scraped, no PII)
3. Review sentiment — aggregate sentiment by category (not per-product)
4. Seasonal patterns — week_number-indexed performance variations
5. Channel performance — aggregate CPI/CTR/install_delta by channel + category

**Trend computation:**
- BullMQ weekly cron extends existing `scheduleWeeklyBrief` job
- Computes 30-day and 90-day trend snapshots from `playbook_signals`
- Stores in `intelligence_trends` (UPSERT on category+market+trend_type+period_days)

## Consequences

- Zero new PII surfaces — all existing RLS policies remain intact
- Founders benefit from aggregate intelligence without exposing their data
- Trend freshness bounded by weekly cron (acceptable for strategic recommendations)
- Intelligence grows automatically as more campaigns complete
