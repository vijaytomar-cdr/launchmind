# ADR-063 — AI Safety & Cost Controls

**Status:** Accepted  
**Date:** 2026-07-10  
**Milestone:** M12 — Production Hardening

---

## Context

LaunchMind makes AI calls on behalf of founders across strategy generation, content creation, optimization insights, report generation, opportunity recommendations, and agent missions. These calls have real cost ($3/M tokens for Sonnet, $0.25/M for Haiku). Without controls, a runaway generation loop or adversarial prompt could cause unbounded spend and security issues.

CLAUDE.md §1.4 mandates: every Claude API call routes through `consumeTokens(founderId, action, estimatedCost)`.

---

## Decision

### 1. Single Entry Point

All AI calls route through `lib/aiPlatform.ts` → `lib/aiClient.ts` → Anthropic SDK. No direct SDK calls anywhere in the codebase. Verified: `strategyService.ts`, `contentService.ts`, `brandVoiceService.ts`, `icpService.ts`, `briefService.ts`, `reviewAnalysis.ts`, `optimizationEngineService.ts`, `reportingService.ts`, `owner.route.ts`, `studio.route.ts`, `recommendations.route.ts` — all import from `aiPlatform.ts`.

The prohibition on direct SDK use is enforced by:
1. Code review requirement
2. SAST rule: `eslint-plugin-security` custom rule that flags `new Anthropic(` outside `lib/aiClient.ts`

### 2. Prompt Injection Defence

`lib/aiPlatform.ts` applies `sanitizeInput()` before any user-provided content reaches a prompt:
- Strips `system:`, `human:`, `assistant:` role markers
- Strips instruction-override patterns (`ignore previous instructions`, `disregard the above`, `new instructions:`, `[INST]`, `</s>`)
- Maximum input length: 50,000 characters (truncated with notice in prompt)

**Structured prompts:** All prompts in the Prompt Registry (`prompts` table) use explicit XML tags to separate system instructions from user content:
```
<system_instructions>
  {resolved_prompt}
</system_instructions>
<founder_context>
  {sanitized_context_package}
</founder_context>
<request>
  {sanitized_user_input}
</request>
```

**Model routing:** `lib/modelRouter.ts` selects model based on `promptId` and `maxTokens`. No user input can override the model selection. `isSonnet()` helper used to enforce correct model for each action.

### 3. Token Balance Enforcement

**Tier balances (Phase 5 enforcement active):**
| Tier | Token balance |
|---|---|
| Free | 50 |
| Solo | 300 |
| Builder | 1,000 |
| Studio | 3,000 |

**`consumeTokens(founderId, action, estimatedCost)`:** 
- Phase 1–4: logs only (no-op on balance)
- Phase 5: enforces balance — throws if `token_balance < estimatedCost`
- Called BEFORE API call (pre-deduct), refunded if API call fails

**`checkTokenBalance`** in `decisionEngineService.ts`: Pre-flight check that returns `DecisionError` before any AI service is invoked. Used in `optimizationEngineService.ts`, `recommendationEngineService.ts`.

### 4. Cost Tracking

Every AI request writes to `ai_requests` table:
```sql
INSERT INTO ai_requests (
  founder_id, prompt_id, model, input_tokens, output_tokens, 
  cost_usd, latency_ms, status, retry_count, action
)
```

**Cost table in `aiPlatform.ts`:**
```typescript
const COST_TABLE = {
  'claude-sonnet-4-6':           { input: 3.00, output: 15.00 },   // per M tokens
  'claude-haiku-4-5-20251001':   { input: 0.25, output: 1.25  },
};
```

**Audit route:** `GET /ai/audit/stats` returns aggregate cost by model, action, and time window. Studio-only access for prompt management; all founders can view their own AI audit.

**Cost alerts:** Axiom alert `ai.cost.usd > $10/hour` → P2 alert.

### 5. Retry & Timeout Strategy

```typescript
// In aiPlatform.ts generateAI()
const MAX_RETRIES = 2;
const RETRY_DELAYS = [500, 1000]; // ms
const SONNET_TIMEOUT_MS = 60_000;
const HAIKU_TIMEOUT_MS  = 30_000;
```

Retried errors: `429` (rate limit), `529` (overloaded). Non-retried: `400` (invalid request), `401` (auth), `403` (permission).

AbortController used for timeout — does NOT count toward Claude's billing if aborted before completion.

### 6. Versioned Prompts

All production prompts stored in `prompts` table with `version` and `is_active` flag. Prompt change workflow:
1. `POST /ai/prompts` (Studio plan only) — inserts new version, archives previous active version
2. New version active immediately
3. `ai_requests.prompt_id` references the specific version used — full audit trail

**Rollback:** Re-activate previous version via direct DB update (ops team only, requires time-boxed access — see §4.9).

### 7. Content Safety

AI-generated content is for marketing (copy, strategy, ads). No content safety classifier is currently applied because:
- Founders provide their own product context
- Prompts are system-authored, not arbitrary user prompts
- Content is reviewed by founders before any campaign posts (§1.5)

If user-generated content is introduced in future (founder-to-founder marketplace), a Haiku-based safety classifier must be added.

### 8. Fallback Behaviour

If AI generation fails after retries:
- `strategyService.ts`: throws — frontend shows error state
- `reportingService.ts`: returns structured fallback from raw metrics data (no AI content)
- `optimizationEngineService.ts`: returns 0 insights (no insights created)
- `briefService.ts`: queues for retry next BullMQ cycle (30-min retry delay)
- `contentService.ts`: asset created with `status='failed'`

---

## Consequences

**Positive:**
- Single entry point enables cost tracking, prompt injection defence, retry logic, and audit in one place.
- Token balance enforcement prevents free-tier founders from consuming paid resources.
- Versioned prompts enable rollback without code deployment.

**Risks:**
- If Anthropic API is down for > 60s, strategy generation and content generation block. Mitigation: fallbacks above + BullMQ retry.
- Token pre-deduction can cause incorrect balance if refund logic in `consumeTokens` has a bug. Mitigation: operations team can adjust balance via Supabase admin.

---

## References
- CLAUDE.md §1.4 (Token-Ready from Day 1)
- `backend/src/lib/aiPlatform.ts`
- `backend/src/lib/modelRouter.ts`
- `backend/src/lib/promptRegistry.ts`
- `backend/src/lib/tokens.ts`
- `backend/src/services/decisionEngineService.ts`
