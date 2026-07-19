# ADR-055: Reporting Framework

**Date:** 2026-07-09  
**Status:** Accepted  
**Milestone:** M11 — Analytics, Reporting & Optimization

## Context

Founders need narrative reports that explain business outcomes — not just tables of metrics. Reports must also feed validated learnings back into Marketing Memory and the Recommendation Engine. Reports should be exportable and not regenerated unnecessarily.

## Decision

1. **`reports` table (migration 060)** — stores report metadata, AI-generated narrative content (JSONB), and a metrics snapshot. UNIQUE constraint on (founder_id, product_id, report_type, period_start) prevents duplicate generation.

2. **Generation is on-demand** — `POST /reports/generate` triggers Claude Sonnet. If a report for the same period already exists and is `ready`, it is returned without regenerating (cache hit). Founders can force-regenerate by setting `force: true`.

3. **Weekly reports trigger learning pipeline** — `reportingService.generateReport()` calls `ingestLearningEvent('founder_feedback', ...)` after weekly report generation, feeding the structured "what worked / what to kill" narrative into Marketing Memory.

4. **Monthly / executive reports** — aggregate weekly report data for the period. Use Claude Haiku (cheaper) for executive summaries since the input is already structured.

5. **Export format** — JSON only (MVP). PDF export via Puppeteer deferred until Phase 6. The JSON export includes full narrative content plus raw metrics snapshot, and increments `export_count`.

6. **Report types**: `weekly | monthly | executive | campaign | experiment`

7. **Report authorization** — RLS + route-level `eq('founder_id', founderId)`. Reports are never shared across founders.

## Consequences

- Claude tokens consumed per report: ~30 Sonnet (weekly), ~20 Haiku (monthly/executive).
- Duplicate generation prevented by DB UNIQUE constraint — safe to call `generate` from UI multiple times.
- Weekly briefs (`weekly_briefs` table) and weekly reports (`reports` table) are different: briefs are operational (Monday actions), reports are analytical (what happened and why).
- Export count tracked for audit; no rate-limiting on exports in MVP.
