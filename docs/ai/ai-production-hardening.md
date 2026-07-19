# LaunchMind — AI Production Hardening

**Date:** 2026-07-10  
**Milestone:** M12 — Production Hardening

---

## 1. AI Architecture Summary

LaunchMind uses two Claude models:
- **claude-sonnet-4-6** — complex generation (strategy, reports, content, recommendations)
- **claude-haiku-4-5-20251001** — fast classification (ICP structuring, brand voice, scoring, optimization insights)

All AI calls flow through a single pipeline:
```
Caller → aiPlatform.generateAI() → contextEngine.buildContextPackage()
       → promptRegistry.resolvePrompt() → modelRouter.routeModel()
       → aiClient.callSonnet/callHaiku() → Anthropic SDK
       → audit write to ai_requests table
```

---

## 2. No Direct AI Calls Verification

**Rule:** No `new Anthropic()` or `createAnthropic()` call outside `lib/aiClient.ts`.

**Verified services using aiPlatform (not direct SDK):**

| Service | Import | Function |
|---|---|---|
| `strategyService.ts` | `aiPlatform.callSonnet` | Strategy generation + content assets |
| `contentService.ts` | `aiPlatform.callSonnet + callHaiku` | Asset generation + scoring |
| `brandVoiceService.ts` | `aiPlatform.callHaiku` | Extract + apply brand voice |
| `icpService.ts` | `aiPlatform.callMessages('haiku')` | Screenshot analysis |
| `briefService.ts` | `aiPlatform.callMessages('haiku')` | Weekly brief generation |
| `reviewAnalysis.ts` | `aiPlatform.callMessages('haiku')` | Review sentiment |
| `optimizationEngineService.ts` | `aiPlatform.callHaiku` | Optimization insights |
| `reportingService.ts` | `aiPlatform.callSonnet + callHaiku` | Report generation |
| `owner.route.ts` (ask) | `aiPlatform.callSonnet` | Ask LaunchMind |
| `studio.route.ts` (generate + transform) | `aiPlatform.callSonnet + callHaiku` | Content Studio |
| `recommendations.route.ts` (generate) | `aiPlatform.callHaiku` | Recommendation generation |

**How to enforce:** SAST rule in `semgrep` config that flags `new Anthropic()` outside the allowed file. Add to `semgrep.yml`:
```yaml
rules:
  - id: no-direct-anthropic-sdk
    patterns:
      - pattern: new Anthropic(...)
      - pattern-not-inside: |
          # lib/aiClient.ts
    message: "Direct Anthropic SDK instantiation not allowed outside lib/aiClient.ts. Use aiPlatform.ts"
    severity: ERROR
```

---

## 3. Prompt Injection Defence

### 3.1 Input Sanitization

`sanitizeInput()` in `lib/aiPlatform.ts`:
```typescript
const INJECTION_PATTERNS = [
  /ignore\s+(previous|all|above)\s+instructions?/gi,
  /disregard\s+(the\s+)?(above|previous|system)/gi,
  /new\s+instructions?:/gi,
  /system:\s*/gi,
  /\[INST\]/gi,
  /<\/s>/gi,
  /human:\s*/gi,
  /assistant:\s*/gi,
];

function sanitizeInput(input: string): string {
  let clean = input;
  for (const pattern of INJECTION_PATTERNS) {
    clean = clean.replace(pattern, '[filtered]');
  }
  return clean.slice(0, 50_000); // length limit
}
```

### 3.2 Structured Prompt Template

All prompts use XML delimiters to separate system from user content:
```xml
<system_instructions>
  You are a marketing intelligence assistant for app founders.
  {resolved_prompt_from_registry}
</system_instructions>

<founder_context>
  {sanitized_context_package}
</founder_context>

<request>
  {sanitized_user_input}
</request>
```

The Claude model cannot be instructed to ignore `<system_instructions>` by content within `<founder_context>` or `<request>` — the XML structure makes the role boundary explicit.

### 3.3 What Is Not Protected

- Founder-authored prompt inputs for "Ask LaunchMind" (`owner.route.ts /ask`): sanitized but can still ask the AI questions. This is by design — founders are asking their own AI assistant.
- Studio transforms: founder provides the text to transform. Sanitized but not restricted.

---

## 4. Cost Controls

### 4.1 Model Routing Table

```typescript
const ROUTING_TABLE: Record<string, { model: ModelChoice; maxTokens: number }> = {
  strategy_generation:   { model: 'sonnet', maxTokens: 4096 },
  content_assets:        { model: 'sonnet', maxTokens: 2048 },
  report_monthly:        { model: 'sonnet', maxTokens: 2048 },
  report_executive:      { model: 'sonnet', maxTokens: 2048 },
  recommendation_generation: { model: 'haiku', maxTokens: 1024 },
  optimization_insights: { model: 'haiku', maxTokens: 1024 },
  review_analysis:       { model: 'haiku', maxTokens: 1024 },
  icp_structuring:       { model: 'haiku', maxTokens: 512  },
  brand_voice_extract:   { model: 'haiku', maxTokens: 512  },
  scoring:               { model: 'haiku', maxTokens: 256  },
};
```

No user input can override the model. `maxTokens` is a hard cap on output tokens.

### 4.2 Token Balance Pre-Flight

Every AI call path includes:
```typescript
await consumeTokens(founderId, action, estimatedCost);
```

Phase 5 enforcement: throws `InsufficientTokensError` if `token_balance < estimatedCost`.

Decision Engine `checkTokenBalance()` provides an earlier pre-flight in optimization/recommendation paths.

### 4.3 Per-Request Cost Tracking

```typescript
const costUsd = (inputTokens / 1_000_000) * COST_TABLE[model].input
              + (outputTokens / 1_000_000) * COST_TABLE[model].output;
```

Stored in `ai_requests.cost_usd` on every request. Visible in:
- `/ai/audit` page (per-request breakdown)
- `/ai/audit/stats` endpoint (aggregate by model/action)
- Axiom alert (P2 when hourly spend > $10)

### 4.4 Retry + Circuit Breaker

```typescript
const MAX_RETRIES = 2;
const RETRYABLE_ERRORS = [429, 529];
const BACKOFF_MS = [500, 1000];
const TIMEOUT_MS = { sonnet: 60_000, haiku: 30_000 };
```

After 3 total failures (original + 2 retries): throw, do NOT retry further. Caller's fallback handles gracefully (see ADR-063 §8).

---

## 5. Versioned Prompts

### 5.1 Prompt Lifecycle

1. Initial prompts seeded in migration 043 (11 prompts covering all action types)
2. New prompt version: `POST /ai/prompts` (Studio plan only)
3. New version auto-activates, previous version archived (`is_active = false`)
4. `ai_requests.prompt_id` references the specific version used — full audit trail
5. Rollback: ops team sets `is_active = true` on previous version (requires time-boxed DB access)

### 5.2 Prompt Registry (`lib/promptRegistry.ts`)

```typescript
// Cache in Redis (60-min TTL) to avoid per-request DB hit
async function resolvePrompt(action: string): Promise<Prompt | null>

// Auto-increments version, archives previous active
async function registerPrompt(action: string, template: string, notes?: string): Promise<Prompt>
```

### 5.3 Prompt Audit

`GET /ai/prompts/:promptId/versions` — full version history with created_at and notes. Studio-only access.

---

## 6. Fallback Behaviour

| Service | AI failure action |
|---|---|
| `strategyService` | Throws → frontend shows error; no partial strategy saved |
| `reportingService` | Returns structured fallback from raw metrics (no AI content field) |
| `optimizationEngineService` | Returns 0 insights created |
| `briefService` | Job marked failed in BullMQ; retried next Sunday |
| `owner.route.ts /ask` | Returns `{ answer: 'I was unable to process your request...', context: [] }` |
| `studio.route.ts /generate` | Asset created with `status='failed'`, `asset_data: { error: message }` |
| `contentService` | Asset created with `status='failed'` |

---

## 7. AI Audit Requirements

Every AI request writes to `ai_requests`:
```sql
INSERT INTO ai_requests (
  id, founder_id, product_id, prompt_id, action,
  model, input_tokens, output_tokens, cost_usd,
  latency_ms, status, retry_count, error_message, created_at
)
```

`ai_requests` has RLS: founders can only read their own rows. Service role can read all (for ops dashboard).

`GET /ai/audit` — paginated, filterable by status/promptId. Max page size: 50.  
`GET /ai/audit/stats` — aggregate counts, total tokens, total cost, success rate, model breakdown.

---

## 8. AI Safety Checklist

| Check | Status |
|---|---|
| No direct Anthropic SDK calls outside aiClient.ts | ✅ |
| All calls through aiPlatform.generateAI or callSonnet/callHaiku | ✅ |
| Prompt injection sanitization active | ✅ |
| Structured XML prompt delimiter on user content | ✅ |
| Token balance pre-flight before AI call | ✅ |
| Cost tracked per request in ai_requests | ✅ |
| Model routing locked (not user-overridable) | ✅ |
| Retry + timeout configured | ✅ |
| Fallback for all AI failure paths | ✅ |
| Prompt versioning + audit trail | ✅ |
| Cost alert configured (Axiom) | ✅ (configuration) |
| SAST rule for direct SDK use | ⚠️ Rule written; add to semgrep.yml |
