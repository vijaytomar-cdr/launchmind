# ADR-038: Approval UX Enforcement

**Status:** Accepted  
**Date:** 2026-07-08  
**Milestone:** 07 — Owner Experience

---

## Context

Approvals are the single most important safety gate in LaunchMind. Currently, `/dashboard/approvals` redirects to the campaigns page. This must be replaced with a dedicated approval center that surfaces ALL approval types (campaign + mission) in one place.

---

## Decision

### Unified Approval Center at `/dashboard/approvals`

Replaces the redirect. Shows:

1. **Campaign approvals** — campaigns with `status = 'pending_approval'`
2. **Mission approvals** — `mission_approvals` rows with `status = 'pending'`

Both types are shown together, grouped by risk level (High → Medium → Low).

### Approval groupings (for UI organization)

| Group | What it contains |
|---|---|
| Paid campaigns | Campaign approvals for meta/google channels |
| Publishing | Mission approvals for publishing steps |
| Content assets | Mission approvals for content/creative steps |
| Strategy changes | Mission approvals for strategy steps |
| Other | Everything else |

### What every approval card must show

- **Title** — what is being approved (from campaign.copy_text or mission_approvals.title)
- **Why generated** — copy from mission log or campaign hook_type
- **Risk level** — derived from channel type (paid = high, content = medium)
- **Preview** — copy snippet, or mission output JSON preview
- **Approve** — primary action (sage button)
- **Reject** — secondary action (red-border button)
- **Edit** — links to the relevant resource for editing

### Hard constraints (never bypassed)

Per §1.5 of CLAUDE.md:
- **Paid campaigns** (meta/google): individual approval required, never bulk
- **Publishing steps**: individual approval required

All approval actions hit the Fastify backend:
- Campaign approval: `POST /campaigns/:id/approve`
- Mission step approval: `POST /missions/:id/approvals/:stepId`

Frontend cannot optimistically update approval state — wait for backend confirmation.

### Notification on new approval

When `mission_approvals` or `campaigns.status = 'pending_approval'` is created:
- Add row to `notifications` table (type = `approval_needed`)
- Frontend polls `/owner/notifications` or badge updates on sidebar

---

## Consequences

- `/dashboard/approvals` is now a real page (not a redirect)
- Both campaign approvals and mission approvals shown in one UI
- Individual approval required for paid campaigns and publishing (enforced)
- Notifications table populated when new approvals arrive
