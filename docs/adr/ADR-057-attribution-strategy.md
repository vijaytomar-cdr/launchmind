# ADR-057: Attribution Strategy

**Date:** 2026-07-09  
**Status:** Accepted  
**Milestone:** M11 — Analytics, Reporting & Optimization

## Context

Founders need to know which channel drove installs. The data available is `campaign_metrics` (channel, market, installs, clicks, impressions per week) and `campaigns` (channel, spend_cap, hook_type). There is no platform-side postback or UTM webhook yet.

## Decision

1. **Last-touch channel attribution** — for each install recorded in `campaign_metrics`, it is attributed to the channel of the campaign that generated it. This is the simplest model consistent with available data.

2. **Attribution computed on-demand** from `campaign_metrics` — no new attribution-specific table. The channel breakdown from `metricsService.getProductMetrics()` already computes `installs per channel`. The `attributionService` formats this as a percentage share.

3. **Attribution output format**:
   ```json
   {
     "totalInstalls": 1240,
     "byChannel": [
       { "channel": "meta", "market": "usa", "installs": 620, "share": 0.50, "avgCpi": 1.20 },
       { "channel": "google", "market": "india", "installs": 310, "share": 0.25, "avgCpi": 0.80 }
     ],
     "topChannel": "meta",
     "topMarket": "usa"
   }
   ```

4. **Multi-touch / probabilistic attribution** deferred — requires platform-side postback APIs (Meta Conversions API, Google Ads webhook). Will be re-evaluated in Phase 6 Production Hardening.

5. **No external attribution SDK** — avoids vendor lock-in at this stage. Decision revisited when India + USA spend exceeds $10K/month.

## Consequences

- Attribution numbers match `campaign_metrics` exactly — founders can cross-reference with the raw data.
- Last-touch overcredits the final-click channel and undercredits top-of-funnel channels. This is documented in the UI ("Attribution is based on last-touch per channel").
- Computed in <50ms for typical founders (< 50 campaigns).
- Zero additional database cost or schema change required for attribution.
