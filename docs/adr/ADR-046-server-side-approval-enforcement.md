# ADR-046: Server-Side Approval Enforcement

**Status:** Accepted  
**Date:** 2026-07-08  
**Milestone:** 09

---

## Decision

### Approval is Mandatory Server-Side for All Paid Campaigns and Public Posts

The §1.5 rule from CLAUDE.md extends to all M09 publishing actions:

1. `campaigns.approved_at` must be non-null before any POST to a publishing channel
2. `content_assets.approved_at` must be non-null for every asset being published
3. Budget increases require new approval (approval scope includes budget amount)
4. Any retry of a failed publish requires re-approval if the original approval is >24h old

### `campaign_approvals` Table

Detailed approval records (migration 053) complement `campaigns.approved_at`:
- Tracks: approver, scope, asset IDs, budget, channel, risk level, timestamp
- Append-only (REVOKE UPDATE/DELETE for authenticated)
- Referenced in campaign detail view for audit trail

### What Requires Approval

| Action | Required |
|---|---|
| Paid campaign launch (meta/google) | Yes — individual approval + budget confirmation |
| WhatsApp broadcast | Yes — approved_at + asset approval |
| Email campaign | Yes — asset approval |
| Push notification | Yes — asset approval |
| App Store update | Yes — individual approval |
| Budget increase > 20% | Yes — new approval required |
| Experiment start | No — experiments are zero-cost by default |
| Manual export | No — founder acts manually outside the system |

### Enforcement Point

All approval checks happen in the route handler BEFORE the publishing adapter is invoked:

```typescript
if (!campaign.approved_at) return reply.status(422).send({ error: 'Campaign must be approved before launch' });
```

Frontend validation is supplementary — it can NEVER replace server-side checks.
