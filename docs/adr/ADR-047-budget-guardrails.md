# ADR-047: Budget Guardrails

**Status:** Accepted  
**Date:** 2026-07-08  
**Milestone:** 09

---

## Decision

Budget enforcement is server-side only. Frontend budget validation is a UX convenience — it cannot be trusted.

### Spend Cap Structure (JSONB)

```json
{
  "weeklyUSD": 200,
  "weeklyINR": 5000,
  "dailyUSD": 50,
  "dailyINR": 1500,
  "totalUSD": 1000,
  "totalINR": 25000,
  "safetyStop": true
}
```

### Enforcement Logic

Before `POST /campaigns/:id/launch`:
1. Fetch `campaigns.spend_cap` for this campaign
2. Sum all `campaign_metrics.cpi * installs` for this founder this week (approximation)
3. If `current_week_spend + proposed_budget > spend_cap.weeklyUSD` → reject 422

### Safety Stop

If `spend_cap.safetyStop = true` and a campaign fails twice, the campaign is auto-paused and the founder receives a notification. Manual re-approval required to resume.

### Budget Increases

Any update that increases `spend_cap` by more than 20% clears `approved_at` and moves the campaign to `pending_approval`. Existing approval is invalidated.

### Zero-Budget Campaigns

Organic campaigns (ASO, email, WhatsApp broadcast, community posts) can have `spend_cap = null`. No spend enforcement applied. They still require content-level approval.
