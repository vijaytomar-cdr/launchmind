# ADR-054: Unified Analytics Architecture

**Date:** 2026-07-09  
**Status:** Accepted  
**Milestone:** M11 — Analytics, Reporting & Optimization

## Context

LaunchMind has campaign_metrics, experiments, weekly_briefs, marketing_memories, and playbook_signals tables. Each milestone added analytics in isolation. The /results page (M07) shows interpreted owner-language summaries. Campaign routes (M09) expose per-campaign metrics. Now we need a unified analytics layer for KPI dashboards, attribution, funnel analysis, ROI, and report generation — without duplicating any existing table or dashboard.

## Decision

1. **No new snapshot tables** — all analytics are computed on the fly from existing `campaign_metrics`, `experiments`, `weekly_briefs`, and `saved_opportunities` tables. Only `reports` (M11 migration 060) caches generated AI report content to avoid token waste.

2. **Analytics service extends metricsService** — `analyticsService.ts` imports `getProductMetrics()` from `metricsService.ts` for raw data, then adds KPI trend calculation, attribution (last-touch), funnel, and ROI on top. No function signature changes to `metricsService.ts`.

3. **Attribution strategy** — last-touch attribution using `campaign_metrics.channel` weighted by installs. Multi-touch model deferred to a future ADR when platform-side UTM data is available.

4. **Cross-product summary** — founder-level rollup across all products uses the same underlying query with a GROUP BY product_id.

5. **Morning Brief metrics** stay in `/owner/brief` (ADR-034). KPI Dashboard (`/analytics/kpi`) provides deeper drill-down. No overlap.

6. **No caching layer** — analytics queries are fast (indexed by founder_id + week_start). Caching would add operational complexity without measurable user benefit at current scale.

## Consequences

- All analytics are always fresh (no staleness from snapshot caches).
- Adding a new metric requires a `campaign_metrics` column and a `analyticsService.ts` update — no migration needed unless the column is new.
- Attribution is approximate (last-touch, channel-level) until platform UTM webhooks are wired.
- The `/results` page is kept exactly as-is; `/analytics` page supplements it with deeper drill-down.
