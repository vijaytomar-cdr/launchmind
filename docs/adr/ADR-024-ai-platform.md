# ADR-024: AI Platform

**Status:** Accepted  
**Date:** 2026-07-08  
**Milestone:** 05 — Context Engine & AI Platform

## Context

Six service files (`strategyService`, `brandVoiceService`, `icpService`, `reviewAnalysis`, `briefService`, `contentService`) made direct calls to the Anthropic SDK or to the thin `aiClient.ts` wrapper. There was no unified place for retry logic, timeout enforcement, latency tracking, token usage capture (input/output counts), or AI audit trail. Each service independently handled errors and had no shared observability.

## Decision

Implement `backend/src/lib/aiPlatform.ts` as the **mandatory single entry point** for all LLM calls. 

### Layer Separation

```
Business logic (services, routes)
       ↓
   aiPlatform.ts          ← new; adds audit, retry, latency, context
       ↓  
    aiClient.ts           ← SDK adapter (only file that imports @anthropic-ai/sdk)
       ↓
 Anthropic SDK / API
```

`aiClient.ts` is the SDK adapter. No service or route may import `@anthropic-ai/sdk` directly or import from `aiClient.ts` directly. Only `aiPlatform.ts` imports `aiClient.ts`.

### AI Platform Exports

1. **`callSonnet(system, user, maxTokens?, auditCtx?)`** — drop-in replacement for `aiClient.callSonnet`, adds audit + retry
2. **`callHaiku(prompt, maxTokens?, auditCtx?)`** — drop-in replacement, adds audit + retry
3. **`callMessages(model, messages, system?, maxTokens?, auditCtx?)`** — multimodal support (image + text)
4. **`generateAI(req)`** — full pipeline: context assembly → prompt resolution → model routing → call → audit

### Features Added by aiPlatform

- **Retry:** Up to 2 retries with 500ms / 1000ms exponential backoff on 429 / 529 / network errors
- **Timeout:** 60s hard timeout for Sonnet, 30s for Haiku (AbortSignal)
- **Latency:** Measured from call start to first token; written to `ai_requests.latency_ms`
- **Token Usage:** `message.usage.input_tokens` + `output_tokens` captured and written to `ai_requests`
- **Cost Estimation:** USD cost estimated from token counts (Sonnet: $3/$15 per M; Haiku: $0.25/$1.25 per M)
- **Prompt Injection Defense:** User-controlled variables sanitized before template interpolation
- **Audit:** All calls with `auditCtx` write an immutable row to `ai_requests`

### AuditContext

```typescript
interface AuditContext {
  founderId?: string;     // null for system-initiated calls (icpService screenshot analysis)
  productId?: string | null;
  promptId: string;       // references prompts.prompt_id
  action: string;         // matches consumeTokens() action string
}
```

`auditCtx` is optional for backward compat. All new calls must provide it.

## Consequences

- **No direct LLM calls remain** in service files after migration. ✓
- **Audit coverage:** All audited calls write to `ai_requests`; system calls (no founderId) are excluded.
- **Backward compat:** `callSonnet`/`callHaiku` signatures are drop-in replacements for `aiClient.ts`.
- **aiClient.ts** is unchanged in external interface; it gains `callWithUsage` / `callMessages` internal extensions used by aiPlatform only.
