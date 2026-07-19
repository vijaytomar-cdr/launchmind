# ADR-025: Prompt Registry

**Status:** Accepted  
**Date:** 2026-07-08  
**Milestone:** 05 — Context Engine & AI Platform

## Context

Prompts lived as inline strings inside service files (`STRATEGY_SYSTEM`, `ASSETS_SYSTEM`, `BRIEF_SYSTEM`, etc.) with no versioning, no audit of which version was used per request, and no way to update a prompt without a code deploy. If a prompt regresses, there is no diff to reference.

## Decision

Introduce a `prompts` table and `promptRegistry.ts` service. The registry:

1. Stores each prompt with a stable `prompt_id` (e.g., `strategy_generation`) and an integer `version`.
2. Only one version can be `active` per `prompt_id` at a time.
3. `archivePrompt()` sets old version to `archived` when a new version is activated.
4. `ai_requests` records `prompt_id` + `prompt_version` so every AI output is traceable to the exact prompt that produced it.

### Prompt Schema

```sql
prompts (
  id              UUID PRIMARY KEY,
  prompt_id       TEXT NOT NULL,       -- stable human-readable ID
  version         INTEGER NOT NULL,
  purpose         TEXT NOT NULL,       -- human description
  owner           TEXT NOT NULL,       -- 'system' or founder UUID
  model           TEXT NOT NULL,       -- 'sonnet' | 'haiku'
  system_template TEXT,               -- system prompt (null for Haiku single-turn)
  user_template   TEXT NOT NULL,      -- user message template ({{variable}} syntax)
  input_schema    JSONB,              -- expected variables
  output_schema   JSONB,              -- expected output shape
  status          TEXT NOT NULL,      -- 'draft' | 'active' | 'archived'
  token_cost      INTEGER NOT NULL,   -- LaunchMind token cost per call
  UNIQUE(prompt_id, version)
)
```

### Initial Prompt Registry (seeded via migration 043)

| prompt_id | version | model | token_cost |
|---|---|---|---|
| strategy_generation | 1 | sonnet | 50 |
| content_assets | 1 | sonnet | 20 |
| content_generation | 1 | sonnet | 30 |
| weekly_brief | 1 | haiku | 20 |
| brand_voice_extract | 1 | haiku | 10 |
| brand_voice_apply | 1 | haiku | 5 |
| icp_structure | 1 | haiku | 10 |
| review_analysis | 1 | haiku | 15 |
| content_score | 1 | haiku | 5 |
| char_limit_rewrite | 1 | haiku | 5 |
| screenshot_analysis | 1 | haiku | 0 |

### Phase-1 Limitation

For M05, service files still build the final prompt dynamically (complex templates with runtime variables). The registry records metadata and the prompt skeleton. Full template migration (prompts fully stored in DB, services fetch + interpolate) is deferred to M06 when the Agent Platform is built.

## Consequences

- Every `ai_requests` row references `prompt_id` + `prompt_version` → full audit trail.
- Prompt changes are visible in git (service files) AND in the registry (new version row).
- `GET /ai/prompts` exposes the registry to the frontend for observability.
- No service or route may hardcode a prompt without registering it first.
