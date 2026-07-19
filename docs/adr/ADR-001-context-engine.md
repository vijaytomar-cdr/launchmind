# ADR-001: Context Engine — Assemble-Before-Request Pattern
Status: Accepted
Date: July 2026

## Context
Every AI call in LaunchMind currently assembles its own context. `strategyService.ts`, `contentService.ts`, `briefService.ts`, and `playbookService.ts` each independently query the database for ICP, brand voice, playbook signals, and campaign history. This produces inconsistent AI context, duplicate DB queries, and makes it impossible to guarantee that all AI calls have the same information.

Architecture Baseline §13 states: "No AI request bypasses Context Engine."

## Decision
Create `backend/src/services/contextEngine.ts`. Every AI call begins with `assembleContext(productId, founderId, opts)` which returns a typed `AIContext` object. All service functions accept `AIContext` as their first parameter.

Context assembly has three depth levels:
- `minimal` — Growth Brain + brand voice only (fast, for scoring)
- `standard` — adds memory, recent reviews, competitor delta (default)
- `full` — adds knowledge graph, all experiments, full timeline

## Consequences
- All AI calls produce consistent, reproducible context
- Single DB roundtrip per AI request instead of N
- Context can be cached at the request level
- Easier to debug AI quality issues (log the context)
- Breaking change for all service function signatures — migrate all callers together
