# ADR-007: Morning Brief — Daily Cadence Replacing Sunday-Only Cron
Status: Proposed
Date: July 2026

## Context
The current `weeklyBriefWorker.ts` generates a brief every Sunday. Architecture Baseline §5 ("Learn Once") implies a continuous learning loop. The navigation baseline §6 shows "Morning Brief" as a primary nav item alongside "Home" — implying daily relevance.

## Decision
In Phase 9, change from Sunday-weekly to daily-check cadence:
- Every morning, the system checks if there are new signals (new reviews, campaign results, experiments concluded)
- If signals exist → generate a brief with insights
- If no new signals → suppress generation (no noise)

The `weekly_briefs` table is extended with a `brief_type` column (`weekly | daily | signal_triggered`). Existing weekly briefs remain in the same table — no new table needed.

The `weeklyBriefWorker.ts` is extended (not replaced) with a `shouldGenerateDailyBrief(productId)` check function. The Sunday cron remains as a guaranteed weekly fallback.

## Consequences
- Founders get relevant intelligence when it happens, not just Sundays
- Daily cron load: check is cheap (query for new signals); generation only fires when needed
- `weekly_briefs` table grows faster — consider partitioning by month in Phase 9
- Frontend "Morning Brief" route shows latest brief regardless of type
- Deferred to Phase 9 — Sunday cron is correct for current needs
