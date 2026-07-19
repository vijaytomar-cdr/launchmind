# ADR-029: Mission Orchestrator

**Status:** Accepted  
**Date:** 2026-07-08  
**Milestone:** 06 — Agent Platform & Mission Orchestrator

---

## Context

AI work in LaunchMind previously ran through ad-hoc BullMQ jobs (intakeWorker, contentWorker, weeklyBriefWorker) with no unified lifecycle, recovery, or observability. Milestone 06 introduces the Mission as the canonical unit of AI work, with a state machine governing execution, pauses for approval, retry on failure, and resume after crash.

---

## Decision

### Mission State Machine

```
             ┌─────────┐
             │  draft  │
             └────┬────┘
               createMission()
             ┌────▼────┐
             │  queued  │ ◄── retryMission()
             └────┬─────┘
          worker picks up job
             ┌────▼────┐
             │ running  │
             └────┬─────┘
           ┌──────┤────────────┐
    step requires          step fails
    approval                 (max retries not reached)
           │                     │
    ┌──────▼───────┐     ┌───────▼──────┐
    │waiting_appvl │     │    failed    │ ─── retryMission() ──► queued
    └──────┬───────┘     └──────────────┘
    founder responds          ▲
           │                  │
    ┌──────▼──────┐      max retries
    │  running    │       exceeded
    └──────┬──────┘
      all steps done
           │
    ┌──────▼──────┐
    │  completed  │
    └─────────────┘
           
    (from any state except completed)
    cancelMission() → cancelled
```

### Mission Step Lifecycle

1. Step is created with `status = 'pending'`
2. Orchestrator picks first `pending` step
3. Sets step `status = 'running'`, sets `started_at`
4. Agent executes via `AGENT_REGISTRY[agentType](input, ctx)`
5. On success: step `status = 'completed'`, saves output, advances to next step
6. On failure: step `status = 'failed'`, records error, checks retry count
7. On approval required: step `status = 'waiting_approval'`, creates `mission_approvals` row, pauses mission
8. On approval received: step `status = 'running'` again, resumes execution

### Recovery After Crash

If the Fastify server crashes mid-execution:
- BullMQ job is **not acknowledged** (still in `active` state)
- On worker restart, BullMQ re-delivers the job
- Worker checks mission status — if `running`, re-scans for the first non-`completed` step
- Re-executes from that step (idempotency required — agents must be safe to re-run)

### Resume After Approval

```
POST /missions/:id/approve { stepId, response, note }
→ missionService.respondToApproval(missionId, stepId, 'approved')
→ Sets mission_approvals.status = 'approved', responded_at = now()
→ Sets mission_steps.status = 'completed' (approval step)
→ Sets missions.status = 'queued' (re-enqueues with same missionId job)
→ Worker picks up, scans for next pending step, continues
```

### Context Loading

Every mission job loads a fresh ContextPackage at execution time:
```typescript
const ctx = await buildContextPackage(founderId, productId, {
  includeMemories: true,
  includeKnowledgeGraph: true,
  includeCampaigns: true,
});
```
This ensures agents always have up-to-date context regardless of when the mission was queued.

### Token Consumption

Before each step execution:
```typescript
await consumeTokens(founderId, agentType, estimatedTokenCost);
```
If insufficient balance, step fails with `InsufficientTokensError` — mission goes to `failed`.

---

## Consequences

- Any mission can be resumed from the last incomplete step after a crash.
- Approval gates block forward progress cleanly without polling.
- New mission types are added by defining step sequences in `MISSION_TEMPLATES`.
- Existing workers (intakeWorker, contentWorker, weeklyBriefWorker) remain unchanged — they are not migrated into missions in M06.
