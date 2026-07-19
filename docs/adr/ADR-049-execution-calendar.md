# ADR-049: Execution Calendar

**Status:** Accepted  
**Date:** 2026-07-08  
**Milestone:** 09

---

## Decision

### Calendar is Derived + Authored

The execution calendar shows two categories:

1. **Derived events** — automatically generated from existing records:
   - Campaign scheduled_at → calendar event
   - Weekly brief sent_at → calendar event
   - Experiment start_date/end_date → calendar event
   
2. **Authored events** — manually created by founder or AI:
   - `execution_calendar_events` table (migration 055)
   - Custom milestones, holidays, launch dates

### `execution_calendar_events` Table

Columns: id, founder_id, product_id, campaign_id (optional), experiment_id (optional), type, title, description, start_date, end_date, all_day, timezone, status ('scheduled'|'completed'|'missed'|'cancelled'), metadata JSONB.

Types: `campaign_launch`, `experiment_window`, `content_publish`, `aso_update`, `review_push`, `brief_sent`, `product_launch`, `holiday_campaign`, `custom`.

### Calendar API

`GET /calendar?from=2026-07-01&to=2026-07-31` returns merged view:
- All `execution_calendar_events` for the period
- All campaigns with `scheduled_at` in the period
- All experiments with `start_date`/`end_date` overlapping
- All weekly_briefs with `sent_at` in the period

Frontend renders these as a unified calendar without separate API calls per type.

### Timezone

All dates stored in UTC. `timezone` column on calendar events records the founder's local timezone at creation time. Frontend displays in browser timezone.

### Conflict Detection

`GET /calendar` includes a `conflicts` array in the response — pairs of events that overlap and target the same audience/channel. This is advisory only; founders can override.
