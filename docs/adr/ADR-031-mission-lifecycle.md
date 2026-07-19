# ADR-031: Mission Lifecycle

**Status:** Accepted  
**Date:** 2026-07-08  
**Milestone:** 06 — Agent Platform & Mission Orchestrator

---

## Context

Missions need a well-defined lifecycle that supports: creation from API or cron, sequential step execution, approval pauses, recovery after crash, cancellation, and retry. The lifecycle must be auditable and visible to founders in the Mission Center.

---

## Decision

### Mission Types and Their Step Sequences

Each mission type has a pre-defined step sequence. Steps are created when the mission is created (status: `pending`).

```typescript
const MISSION_TEMPLATES: Record<MissionType, MissionStepTemplate[]> = {
  research: [
    { stepName: 'scrape_product',   agentType: 'research',    requiresApproval: false },
    { stepName: 'analyse_reviews',  agentType: 'research',    requiresApproval: false },
    { stepName: 'enrich_icp',       agentType: 'research',    requiresApproval: false },
    { stepName: 'save_learnings',   agentType: 'learning',    requiresApproval: false },
  ],
  strategy: [
    { stepName: 'build_context',    agentType: 'research',    requiresApproval: false },
    { stepName: 'generate_strategy',agentType: 'strategy',    requiresApproval: false },
    { stepName: 'review_strategy',  agentType: 'strategy',    requiresApproval: true  }, // approval gate
    { stepName: 'save_strategy',    agentType: 'learning',    requiresApproval: false },
  ],
  planning: [
    { stepName: 'load_strategy',    agentType: 'planning',    requiresApproval: false },
    { stepName: 'generate_tasks',   agentType: 'planning',    requiresApproval: false },
    { stepName: 'approve_plan',     agentType: 'planning',    requiresApproval: true  },
  ],
  content: [
    { stepName: 'assemble_context', agentType: 'content',     requiresApproval: false },
    { stepName: 'generate_copy',    agentType: 'content',     requiresApproval: false },
    { stepName: 'generate_visuals', agentType: 'creative',    requiresApproval: false },
    { stepName: 'review_assets',    agentType: 'content',     requiresApproval: true  },
    { stepName: 'save_assets',      agentType: 'learning',    requiresApproval: false },
  ],
  creative: [
    { stepName: 'generate_images',  agentType: 'creative',    requiresApproval: false },
    { stepName: 'generate_video',   agentType: 'creative',    requiresApproval: false },
    { stepName: 'review_creative',  agentType: 'creative',    requiresApproval: true  },
  ],
  campaign: [
    { stepName: 'draft_campaign',   agentType: 'campaign',    requiresApproval: false },
    { stepName: 'validate_budget',  agentType: 'campaign',    requiresApproval: false },
    { stepName: 'approve_campaign', agentType: 'campaign',    requiresApproval: true  },
    { stepName: 'create_platform',  agentType: 'campaign',    requiresApproval: false },
  ],
  publishing: [
    { stepName: 'verify_approval',  agentType: 'publishing',  requiresApproval: false },
    { stepName: 'post_content',     agentType: 'publishing',  requiresApproval: false },
    { stepName: 'confirm_post',     agentType: 'reporting',   requiresApproval: false },
  ],
  optimization: [
    { stepName: 'load_metrics',     agentType: 'optimization',requiresApproval: false },
    { stepName: 'analyse_gaps',     agentType: 'optimization',requiresApproval: false },
    { stepName: 'generate_plan',    agentType: 'optimization',requiresApproval: false },
    { stepName: 'approve_changes',  agentType: 'optimization',requiresApproval: true  },
  ],
  learning: [
    { stepName: 'ingest_results',   agentType: 'learning',    requiresApproval: false },
    { stepName: 'update_memories',  agentType: 'memory',      requiresApproval: false },
    { stepName: 'update_graph',     agentType: 'memory',      requiresApproval: false },
  ],
  reporting: [
    { stepName: 'aggregate_metrics',agentType: 'reporting',   requiresApproval: false },
    { stepName: 'generate_brief',   agentType: 'reporting',   requiresApproval: false },
    { stepName: 'send_brief',       agentType: 'reporting',   requiresApproval: false },
  ],
  memory: [
    { stepName: 'scan_stale',       agentType: 'memory',      requiresApproval: false },
    { stepName: 'deduplicate',      agentType: 'memory',      requiresApproval: false },
    { stepName: 'archive_old',      agentType: 'memory',      requiresApproval: false },
  ],
  benchmark: [
    { stepName: 'load_signals',     agentType: 'benchmark',   requiresApproval: false },
    { stepName: 'compare_metrics',  agentType: 'benchmark',   requiresApproval: false },
    { stepName: 'generate_report',  agentType: 'benchmark',   requiresApproval: false },
  ],
};
```

### Lifecycle Transitions (enforced in missionService.ts)

| From | Event | To |
|---|---|---|
| `draft` | `queueMission()` | `queued` |
| `queued` | Worker picks up | `running` |
| `running` | Step requires approval | `waiting_approval` |
| `waiting_approval` | Founder approves | `running` (re-queued) |
| `waiting_approval` | Founder rejects | `cancelled` |
| `running` | All steps complete | `completed` |
| `running` | Step fails, retries remain | `running` (step retried) |
| `running` | Step fails, no retries | `failed` |
| `failed` | `retryMission()` | `queued` (steps reset) |
| `*` | `cancelMission()` | `cancelled` |

### Timeout Policy

| Mission type | Max duration | Behavior on timeout |
|---|---|---|
| research | 5 min | Mark step failed, continue with partial |
| strategy | 3 min | Mark mission failed |
| content | 5 min | Mark step failed, continue with partial |
| campaign | 2 min | Mark mission failed |
| publishing | 10 min | Mark mission failed, alert founder |
| All others | 3 min | Mark mission failed |

### Audit Trail

Every lifecycle transition writes a `mission_logs` row:
```typescript
{ level: 'info', message: `Mission transitioned from ${from} to ${to}`, metadata: { agentType, stepName, retryCount } }
```

---

## Consequences

- All mission types have deterministic step sequences — no dynamic branching in M06.
- Dynamic branching (e.g., skip creative if text-only) deferred to M08.
- Approval gates are always at a natural human checkpoint (before publishing, before strategy is locked).
