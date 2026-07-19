# ADR-023: Context Engine

**Status:** Accepted  
**Date:** 2026-07-08  
**Milestone:** 05 — Context Engine & AI Platform

## Context

Every AI generation task (strategy, content, brief, brand voice) re-assembles scattered data from multiple tables: product ICP, campaigns, marketing memories, knowledge graph, founder preferences, budget. This duplication led to inconsistent context windows — strategy and content used different slices of the same data — and made it impossible to audit what information influenced each generation.

## Decision

Implement a **Context Engine** (`backend/src/lib/contextEngine.ts`) as the single source for assembling AI generation context. It:

1. Accepts `founderId`, `productId`, and `ContextOptions` (which sources to include).
2. Queries all sources in parallel via `Promise.all`.
3. Returns a normalized `ContextPackage` with typed fields for each source.
4. Exposes `formatContextForPrompt(pkg)` to serialize the package into a prompt-ready string.

### Context Sources

| Source | Table(s) | Default Included |
|---|---|---|
| Founder | `founders` | Always |
| Product | `products` | If productId provided |
| Marketing Memories | `marketing_memories` | Yes (top 5 active) |
| Knowledge Graph | `knowledge_nodes` | Yes (depth-1) |
| Campaign History | `campaigns` + `campaign_metrics` | Yes (last 10) |
| Analytics Summary | `campaign_metrics` aggregate | Yes |
| Budget | `founders.token_balance` + product markets | Always |

Growth Brain and external integrations are reserved for M06.

### ContextPackage Structure

```typescript
interface ContextPackage {
  founderId: string;
  productId: string | null;
  assembledAt: string;
  sources: string[];
  founder: { plan: string; tokenBalance: number | null };
  product: ProductContext | null;
  memories: MemoryEntry[];
  knowledgeNodes: NodeEntry[];
  campaigns: CampaignEntry[];
  analytics: AnalyticsSummary | null;
  budget: BudgetContext;
}
```

## Consequences

- **Consistent context:** Every AI call that uses `generateAI()` assembles context the same way.
- **Auditable:** `ai_requests.context_sources` records which sources were included.
- **Performance:** Parallel queries typically resolve in 50–100ms on Supabase.
- **Selective inclusion:** Callers can disable sources via `ContextOptions` for low-latency quick rewrites.
- **Growth Brain gap:** The Growth Brain stub is not yet implemented; context includes an empty placeholder for M06.
