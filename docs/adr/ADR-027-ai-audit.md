# ADR-027: AI Audit Trail

**Status:** Accepted  
**Date:** 2026-07-08  
**Milestone:** 05 — Context Engine & AI Platform

## Context

AI generation was fully audited for token cost (via `audit_logs`), but there was no record of latency, token counts (input/output), USD cost, retry attempts, or which prompt version was used. This made it impossible to monitor quality regression, control spending, or debug failures.

## Decision

Introduce `ai_requests` table as an immutable AI-specific audit trail. Unlike `audit_logs` (general-purpose), `ai_requests` is optimized for AI observability.

### Schema

```sql
ai_requests (
  id              UUID PRIMARY KEY,
  founder_id      UUID REFERENCES founders(id),   -- nullable for system calls
  product_id      UUID REFERENCES products(id),
  prompt_id       TEXT NOT NULL,
  prompt_version  INTEGER NOT NULL DEFAULT 1,
  model           TEXT NOT NULL,
  action          TEXT NOT NULL,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  total_tokens    INTEGER,
  cost_usd        NUMERIC(10,6),
  latency_ms      INTEGER,
  retries         INTEGER DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'success',  -- success | failed | retried | timeout
  error           TEXT,
  context_sources TEXT[],
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
)
```

### Access Control

- **Write:** `service_role` only. `aiPlatform.ts` uses `getSupabaseAdmin()`.
- **Read:** `authenticated` via RLS policy `founder_id = auth.uid()`.
- **Update/Delete:** Revoked from all non-superuser roles (immutable).

This matches the `audit_logs` table pattern.

### Observability Metrics (exposed via `GET /ai/audit/stats`)

- Total requests by status
- Average latency by model
- Total tokens consumed (input + output)
- Total estimated USD cost (30-day rolling)
- Retry rate
- Top 5 prompts by usage count
- Top 5 prompts by cost

### Relationship to `audit_logs`

`audit_logs` records business events (`strategy_generated`, `tokens_consumed`). `ai_requests` records technical AI calls (model, latency, token counts). They are complementary: the `audit_logs` row gives business context; the `ai_requests` row gives technical details.

## Consequences

- All AI generation is auditable end-to-end: what was requested, which prompt version, which model, how long it took, how many tokens, what it cost.
- Frontend `intelligence/ai-audit` page surfaces this for founders.
- Write-only from service_role prevents tampering.
- `cost_usd` is an estimate (based on public pricing); actual billing is via Anthropic dashboard.
