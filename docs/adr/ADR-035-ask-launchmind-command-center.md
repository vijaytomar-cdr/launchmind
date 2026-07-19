# ADR-035: Ask LaunchMind Command Center

**Status:** Accepted  
**Date:** 2026-07-08  
**Milestone:** 07 — Owner Experience

---

## Context

Founders have marketing questions that don't fit predefined dashboards. "Why did CPI increase?", "What should I run for Diwali?", "Get me 1,000 installs." Traditional BI tools require knowing where to look. LaunchMind should answer questions directly.

---

## Decision

### Ask LaunchMind is a structured question/answer interface (not a chat)

Each question produces a single structured response:
- **Summary** — direct answer in 2 sentences
- **Recommended action** — one clear next step
- **Suggested mission** — optional mission type + title
- **Expected impact** — human-readable estimate
- **Confidence** — 0–100
- **Risks** — up to 3 bullet points
- **Next step** — one thing to do right now
- **Evidence** — 2-3 source chips

This is NOT a multi-turn conversation (that's Milestone 09). Each question is independent.

### All answers flow through Context Engine

`POST /owner/ask` pipeline:
1. `sanitizeInput()` — strip injection patterns
2. `buildContextPackage(founderId, productId)` — full context
3. `callSonnet(ASK_SYSTEM, question + context)` — structured JSON response
4. Return structured `AskResponse`

### Rate limit

10 questions per hour per founder (Fastify rate limit). Enforced server-side, surfaced as a 429 with `retryAfterSeconds`.

### Starter prompts

The UI shows 8 suggested prompts to make the blank state useful:
- "Get me 1,000 installs"
- "Launch in India"
- "Why did CPI increase?"
- "Create a Black Friday campaign"
- "Compare me to competitors"
- "How can I improve reviews?"
- "Reduce my ad spend"
- "What should I do this week?"

Starter prompts lower the cognitive barrier and guide founders toward high-value questions.

### Response attribution

Every response shows: "Based on your Growth Brain, 3 campaigns, and 2 market signals." This builds trust and satisfies the explainability requirement.

---

## Consequences

- `POST /owner/ask` — new endpoint consuming Context Engine + Sonnet
- Rate limit prevents abuse
- No conversation history in Milestone 07 (stateless)
- Milestone 09 adds multi-turn conversation mode on top of this foundation
