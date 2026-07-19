# ADR-026: Model Routing

**Status:** Accepted  
**Date:** 2026-07-08  
**Milestone:** 05 — Context Engine & AI Platform

## Context

Model selection was scattered — some services hardcoded `claude-sonnet-4-6`, others hardcoded `claude-haiku-4-5-20251001`. There was no central place to change the model for all instances of an action type, and no logic to automatically route based on task complexity.

## Decision

Implement `backend/src/lib/modelRouter.ts` with a static routing table that maps `promptId` → model. The `generateAI()` function in `aiPlatform.ts` calls `routeModel(promptId)` before making the API call.

### Routing Table (M05)

```typescript
const ROUTING_TABLE: Record<string, ModelChoice> = {
  // Sonnet: complex multi-step reasoning, structured JSON output
  strategy_generation:  { model: 'claude-sonnet-4-6',          maxTokens: 4096 },
  content_assets:       { model: 'claude-sonnet-4-6',          maxTokens: 2048 },
  content_generation:   { model: 'claude-sonnet-4-6',          maxTokens: 12000 },

  // Haiku: scoring, rewrites, classification, single-turn tasks
  weekly_brief:         { model: 'claude-haiku-4-5-20251001',  maxTokens: 600 },
  brand_voice_extract:  { model: 'claude-haiku-4-5-20251001',  maxTokens: 400 },
  brand_voice_apply:    { model: 'claude-haiku-4-5-20251001',  maxTokens: 300 },
  icp_structure:        { model: 'claude-haiku-4-5-20251001',  maxTokens: 512 },
  review_analysis:      { model: 'claude-haiku-4-5-20251001',  maxTokens: 1024 },
  content_score:        { model: 'claude-haiku-4-5-20251001',  maxTokens: 600 },
  char_limit_rewrite:   { model: 'claude-haiku-4-5-20251001',  maxTokens: 300 },
  screenshot_analysis:  { model: 'claude-haiku-4-5-20251001',  maxTokens: 512 },
};
```

### Fallback

Unknown `promptId` falls back to `haiku` with 600 max tokens. Services may override `maxTokens` via `AIRequest.maxTokens`.

### Future: Dynamic Routing (M07+)

Routing can become dynamic once we have performance data from `ai_requests`:
- Auto-upgrade to Sonnet if Haiku quality score falls below threshold
- Auto-downgrade to Haiku during cost overruns
- A/B test model variants for the same prompt

For M05, static routing is sufficient and auditable.

## Consequences

- Centralized: changing a model for all instances of `strategy_generation` is a one-line change.
- Auditable: `ai_requests.model` records which model was actually used.
- `callSonnet`/`callHaiku` still hardcode the model for backward compat — routing applies to `generateAI()` only.
