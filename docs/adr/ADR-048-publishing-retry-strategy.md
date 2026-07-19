# ADR-048: Publishing Retry Strategy

**Status:** Accepted  
**Date:** 2026-07-08  
**Milestone:** 09

---

## Decision

### Retry Policy Per Channel

| Channel | Max Attempts | Backoff | On Repeated Failure |
|---|---|---|---|
| meta | 3 | 30s → 5m → 30m | Pause campaign, notify founder |
| google | 3 | 30s → 5m → 30m | Pause campaign, notify founder |
| whatsapp | 2 | 60s → 10m | Pause campaign, notify founder |
| email | 5 | 5s → 30s → 2m → 10m → 30m | Auto-archive attempt, notify founder |
| push | 3 | 10s → 60s → 5m | Notify founder |
| Manual export | N/A | — | Never retried |

### `campaign_publish_attempts` Table

Each attempt logged with:
- `attempt_number` (1-indexed)
- `status` ('pending', 'success', 'failed', 'retrying')
- `error_message` (sanitized — no provider tokens in error messages)
- `created_at`

### Dead-Letter Queue

After all retries are exhausted:
1. Set `campaigns.status = 'failed'`
2. Set `campaigns.failed_at`, `campaigns.failure_reason`
3. Create notification for founder
4. Require manual review before re-launch

Paid campaigns (meta/google) require re-approval after failure. Zero-cost campaigns can be re-queued by the founder without re-approval.

### Partial Publish Safety

If a campaign publishes to Channel A successfully but fails on Channel B:
- Channel A publish is NOT rolled back (too late)
- Channel B attempt is retried per policy
- `campaigns.status = 'publishing'` until all channels resolve
- If Channel B exhausts retries: `campaigns.status = 'launched'` (partial launch flag in metadata)
