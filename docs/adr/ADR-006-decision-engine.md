# ADR-006: Decision Engine — Business Rules Separated from AI
Status: Accepted
Date: July 2026

## Context
Business rules (budget cap, approval gate, plan-tier gating, token balance, MFA) are currently enforced as inline guards scattered across route handlers. This mixes concerns and makes it easy to miss a rule when adding a new route.

Architecture Baseline §16 states: "Business rules decide. AI explains."

## Decision
Create `backend/src/services/decisionEngine.ts` that centralises all business rule enforcement. Each rule is a typed async function that throws a typed error on violation.

```typescript
checkBudgetCap(campaignId, proposed)   → throws 422 AppError if over cap
checkApprovalGate(type, resourceId)    → throws 403 if not approved
checkPlanFeature(founderId, feature)   → throws 402 if plan insufficient
checkTokenBalance(founderId, cost)     → throws 402 if insufficient tokens
checkExperimentRuntime(experimentId)   → throws 409 if too early to conclude
```

Existing route handlers are refactored to call Decision Engine instead of inline logic. No new rules are added — existing logic is migrated.

AI is still used to explain decisions ("your spend cap was set to $500 to prevent overspend during the India launch") but never to make them.

## Consequences
- All business rules in one file — auditable, testable
- New routes cannot accidentally skip a rule
- Rules can be unit-tested in isolation
- Breaking change to route handlers — migrate incrementally, route by route
- Deferred to Phase 7 — current inline guards are correct, just unstructured
