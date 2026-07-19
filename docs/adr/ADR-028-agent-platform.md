# ADR-028: Agent Platform

**Status:** Accepted  
**Date:** 2026-07-08  
**Milestone:** 06 — Agent Platform & Mission Orchestrator

---

## Context

LaunchMind needs an execution layer where AI-driven work is broken into discrete, reusable, stateless units. Each unit (an "agent") has a defined contract: inputs, outputs, tools, failure behavior, and retry policy. Agents must never call each other directly to prevent spaghetti orchestration; the Mission Orchestrator mediates all coordination.

---

## Decision

### Agent Catalog (12 agents)

| Agent | Responsibility | Model | Input | Output |
|---|---|---|---|---|
| **Research** | Scrape and enrich product/competitor data | Haiku | product_id, scrape_targets | enriched_meta, competitor_set |
| **Strategy** | Generate 30/60/90-day marketing strategy | Sonnet | product_id, icp, context | strategy JSON |
| **Planning** | Break strategy into ranked weekly tasks | Haiku | strategy, budget, channels | task_list[] |
| **Content** | Generate channel-specific copy assets | Sonnet | product_id, channel, market | content_assets[] |
| **Creative** | Generate visual/audio assets (images, voice) | Sonnet+Flux | content_assets[], style | media_urls[] |
| **Campaign** | Draft and validate platform campaign configs | Haiku | content_assets[], channel | campaign_drafts[] |
| **Publishing** | Post approved campaigns to platforms | Haiku | campaign_id (approved_at non-null) | external_campaign_ids[] |
| **Optimization** | Analyse metrics, generate improvement plan | Haiku | campaign_metrics[], brief | optimization_plan |
| **Learning** | Ingest results into memory + knowledge graph | Haiku | execution_results | memory_ids[], node_ids[] |
| **Reporting** | Compose human-readable performance brief | Haiku | metrics, memories | weekly_brief |
| **Memory** | Sync, deduplicate, archive stale memories | Haiku | founder_id, product_id | memory_delta |
| **Benchmark** | Compare metrics against playbook_signals | Haiku | campaign_metrics[], category | benchmark_report |

### Execution Model

- Every agent is a **pure async TypeScript function** — `(input, ctx) => Promise<output>`.
- Agents are **stateless and idempotent** — given the same input and context, they return the same output.
- Agents consume **Context Engine context** for AI prompts — never query the DB directly.
- Agents write results through **missionService** — never write to DB independently.
- Agents log via **missionService.log()** — never to console or external directly.

### Tools Available to Agents

| Tool | Used by | Implementation |
|---|---|---|
| App Store scraper | Research | `scraperService.scrapeAppStore()` |
| Play Store scraper | Research | `scraperService.scrapePlayStore()` |
| Website scraper | Research | `icpService.scrapeWebsite()` |
| AI generation | Strategy, Content, Planning, etc. | `aiPlatform.callSonnet/callHaiku/generateAI` |
| Memory read | Memory, Optimization | `marketingMemoryService.listMemories()` |
| Memory write | Learning, Memory | `marketingMemoryService.createMemory()` |
| Knowledge graph | Memory, Learning | `knowledgeGraphService.createNode/Edge` |
| Metrics read | Optimization, Reporting, Benchmark | Supabase `campaign_metrics` |
| Mission log | All | `missionService.log()` |

### Failure Behavior & Retry Policy

| Agent | Failure behavior | Max retries | Backoff |
|---|---|---|---|
| Research | Log warning, continue without enrichment | 2 | 5s, 10s |
| Strategy | Throw — blocks mission | 2 | 10s, 20s |
| Planning | Throw — blocks mission | 2 | 5s, 10s |
| Content | Throw — blocks mission; partial assets saved | 2 | 10s, 20s |
| Creative | Log warning, continue with text-only fallback | 3 | 5s, 10s, 20s |
| Campaign | Throw — blocks mission | 2 | 5s, 10s |
| Publishing | Throw — blocks mission | 3 | 30s, 60s, 120s |
| Optimization | Log warning, skip optimization step | 2 | 5s, 10s |
| Learning | Log warning, skip (non-blocking) | 2 | 2s, 5s |
| Reporting | Throw — blocks brief delivery | 2 | 10s, 20s |
| Memory | Log warning, skip dedup run | 2 | 2s, 5s |
| Benchmark | Log warning, skip comparison | 1 | 5s |

### Events Emitted

Each agent emits structured events via `missionService.log()`:

```typescript
type AgentEvent = 'agent.started' | 'agent.completed' | 'agent.failed' 
                | 'agent.approval_requested' | 'agent.skipped';
```

---

## Consequences

- Agents are testable in isolation — mock `agentContext.callAI()` and assert on output.
- Adding a new agent = adding one file + one entry in `AGENT_REGISTRY`.
- No agent has side effects outside its defined output + missionService.log().
