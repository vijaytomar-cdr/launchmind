# ADR-052: Decision Engine

**Status:** Accepted  
**Milestone:** 10 — Intelligence Network & Recommendation Engine  
**Date:** 2026-07-09

## Context

Business rules (§1.5 Approve-Before-Post, §1.6 Spend Cap, plan gating, token balance, regen limits) are currently duplicated as inline guards across 5+ route files. The Decision Engine spec requires AI to be unable to override these rules.

## Decision

**Implement `decisionEngineService.ts`** as the authoritative service for all deterministic business rules.

**Approach (phased):**
- Phase 1 (this milestone): Implement the service with all rules. Register rules in `decision_rules` table. New routes (recommendations, benchmarks) use the service.
- Phase 2 (follow-on): Refactor existing route inline guards to delegate to the service. Existing guards remain functional — no regression risk.

**The service NEVER calls AI.** Rules are pure TypeScript functions.

**Rules implemented:**
```typescript
checkApprovalGate(resourceType, resourceId, founderId)  // §1.5
checkSpendCap(campaignId, proposedBudget, founderId)     // §1.6
checkPlanFeature(founderId, feature)                     // plan gating
checkTokenBalance(founderId, estimatedCost)              // token enforcement
checkRegenLimit(assetId, currentCount)                   // max 3 regens
checkExperimentRuntime(experimentId)                     // min 7 days
checkWorkspacePermission(founderId, workspaceId)         // tenant isolation
checkBenchmarkAccess(founderId)                          // any authenticated founder
```

**`decision_rules` table:** Registry of all active rules with config. Used for observability and audit — the source of truth remains the TypeScript code, not the DB.

## Consequences

- Decision Engine is AI-proof by construction (no LLM calls, no async external dependencies in the critical path)
- Existing routes are not broken — they continue with inline guards
- New routes use the service, demonstrating the pattern
- `decision_rules` table provides audit trail for compliance reviews
