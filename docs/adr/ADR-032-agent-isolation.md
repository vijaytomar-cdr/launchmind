# ADR-032: Agent Isolation

**Status:** Accepted  
**Date:** 2026-07-08  
**Milestone:** 06 — Agent Platform & Mission Orchestrator

---

## Context

Agents must be isolated from each other: no direct calls between agents, no shared mutable state, no ability to read another agent's output except through the Mission Orchestrator. This prevents cascading failures and enables independent testing.

---

## Decision

### Isolation Model

**Input/output via Mission Orchestrator only.**

```
Agent A ──► MissionOrchestrator ──► Agent B
           (stores A's output as
            B's input via mission_steps)
```

Agents never import or call each other. The orchestrator passes the previous step's output as the next step's input.

### AgentContext (injected by orchestrator)

```typescript
interface AgentContext {
  founderId:    string;
  productId:    string | null;
  missionId:    string;
  stepId:       string;
  contextPkg:   ContextPackage;           // from Context Engine
  log:          (message: string, meta?: Record<string, unknown>) => Promise<void>;
  callAI:       typeof callSonnet | typeof callHaiku; // bound to aiPlatform
}
```

Agents receive:
1. Their specific `input` (from previous step output or mission input)
2. A shared `AgentContext` — pre-loaded context + logging + AI call helpers

Agents never receive:
- Direct database access
- Other agents' private state
- Raw Supabase client
- JWT/auth tokens

### Permission Boundaries

| Permission | Allowed agents | Implementation |
|---|---|---|
| Read product data | Research, Strategy, Content, Campaign, Optimization | Via `AgentContext.contextPkg` only |
| Write memories | Learning, Memory | Via `missionService.ingestLearning()` callback |
| Write campaign drafts | Campaign | Return value only — orchestrator writes |
| Send email | Reporting | Via `missionService.sendBriefEmail()` callback |
| Post to platforms | Publishing | Only after `campaigns.approved_at` non-null check |
| Write mission logs | All | Via `AgentContext.log()` only |

### Security: Workspace & Product Authorization

Before any mission step executes:
```typescript
// Verified once at mission creation — not per-step
const product = await supabase.from('products')
  .select('id, founder_id')
  .eq('id', productId)
  .eq('founder_id', founderId)   // RLS double-check
  .single();
if (!product) throw new ForbiddenError('Product not owned by founder');
```

### Test Isolation

Each agent is tested with:
- A mock `AgentContext` (no real DB)
- A mock AI response (from `vi.mock('../lib/aiPlatform')`)
- Assertions on the returned output object only

No agent test imports another agent. No agent test reaches a real queue.

### Injection Attack Prevention

Agent inputs go through:
1. `sanitizeInput()` from aiPlatform (strips role markers)
2. Zod validation of input schema before agent execution
3. Agent never interpolates raw user text into SQL

---

## Consequences

- Each agent can be unit-tested with 5–10 lines of setup.
- A compromised agent cannot affect other agents in the same mission.
- Adding a new agent requires no changes to other agents.
- Agent outputs are stored in `mission_steps.output` (JSONB) — reviewable in the UI.
