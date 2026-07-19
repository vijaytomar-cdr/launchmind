# ADR-060 — Performance & Scalability Architecture

**Status:** Accepted  
**Date:** 2026-07-10  
**Milestone:** M12 — Production Hardening

---

## Context

LaunchMind's backend serves a growing number of concurrent founders across USA and India markets. As the intelligence pipeline deepens (Marketing Memory, Context Engine, Agent Platform, Analytics), query complexity increases. This ADR documents the performance architecture decisions for production.

Target latency budgets:
- API health check: < 50ms
- Simple CRUD (list campaigns, list assets): < 200ms
- Analytics summary (cross-product): < 500ms
- Strategy generation (Claude Sonnet): < 30s (async with job polling)
- Content asset generation: < 60s (async)
- Mission orchestration: async via BullMQ (no latency SLA)

---

## Decision

### 1. Database Indexes

All high-traffic query patterns have covering indexes:

**campaigns:**
```sql
CREATE INDEX campaigns_product_status ON campaigns(product_id, status);
CREATE INDEX campaigns_founder_created ON campaigns(founder_id, created_at DESC);
```

**campaign_metrics:**
```sql
CREATE INDEX metrics_campaign_week ON campaign_metrics(campaign_id, week_start DESC);
CREATE INDEX metrics_founder_week ON campaign_metrics(founder_id, week_start DESC);
```

**content_assets:**
```sql
CREATE INDEX assets_product_type ON content_assets(product_id, type);
CREATE INDEX assets_founder_status ON content_assets(founder_id, status);
```

**marketing_memories:**
```sql
CREATE INDEX memories_founder_type ON marketing_memories(founder_id, memory_type);
CREATE INDEX memories_confidence ON marketing_memories(founder_id, confidence DESC);
```

**missions:**
```sql
CREATE INDEX missions_founder_status ON missions(founder_id, status);
CREATE INDEX mission_steps_mission ON mission_steps(mission_id, step_order);
```

**ai_requests:**
```sql
CREATE INDEX ai_requests_founder ON ai_requests(founder_id, created_at DESC);
CREATE INDEX ai_requests_prompt ON ai_requests(prompt_id, created_at DESC);
```

**reports:**
```sql
CREATE INDEX reports_founder_product ON reports(founder_id, product_id, period_start DESC);
UNIQUE INDEX reports_dedupe ON reports(founder_id, product_id, report_type, period_start);
```

**embedding_store:**
```sql
CREATE INDEX embedding_store_founder_type ON embedding_store(founder_id, type);
```

**pgvector IVFFlat index (icp_embedding):**
```sql
CREATE INDEX products_icp_embedding_idx ON products USING ivfflat (icp_embedding vector_cosine_ops) WITH (lists = 100);
```

### 2. Query Optimisation

**N+1 prevention:** All analytics aggregations (getAnalyticsSummary, getKPITrend) use a single Supabase query with `.select()` on `campaign_metrics` grouped in application code — no per-campaign follow-up queries.

**Pagination:** All list endpoints accept `limit` (max 50) and `offset`. Frontend uses cursor-based pagination for infinite scroll (passing `createdAt` as cursor). No unbounded `SELECT *` in production routes.

**Report caching:** AI-generated report content cached in `reports` table. Cache-first in `reportingService.generateReport()` — hit rate expected >80% for recurring weekly reports. Only raw metrics are recomputed on each call.

**Context Engine parallelism:** `buildContextPackage()` in `contextEngine.ts` fires 6 Supabase queries in parallel with `Promise.all()`. Non-fatal: if any source fails, the package is built with available sources.

### 3. Background Queue Architecture

**BullMQ on Upstash Redis:**
- `mission-execution`: concurrency=5, priority queue (research > strategy > content > reporting)
- `intake-worker`: concurrency=3, handles scraping + ICP generation
- `weekly-brief`: cron every Sunday at 06:00 UTC, processes all active founders

**DLQ:** Failed jobs → `missions.status='failed'` with error captured in `mission_logs`. Retry with exponential backoff: 3 attempts, 1s → 5s → 30s delay. DLQ visible in `/missions` page.

**Worker isolation:** Scraper worker (`Dockerfile.scraper`) runs in a separate container to prevent Playwright browser memory from affecting the main API process.

### 4. Caching Strategy

**Upstash Redis TTL map:**
| Key pattern | TTL | Rationale |
|---|---|---|
| `analytics:summary:{founderId}` | 5 min | Balance freshness vs compute |
| `founder:{founderId}:plan` | 15 min | Plan changes are rare |
| `benchmarks:{category}:{market}` | 30 min | Aggregate signals change slowly |
| `prompts:{promptId}` | 60 min | Prompt registry changes are infrequent |

**Anomaly detection Redis:** `anomaly:{founderId}:{windowStart}` → request count. TTL = 15 min window.

### 5. Frontend Performance

**Vercel Edge Network:** Next.js 14 App Router pages are statically generated where possible. Dynamic routes (dashboard pages) use React Server Components with streaming.

**Image optimisation:** Next.js `<Image>` component with `priority` on above-the-fold images. Marketing images served via Supabase Storage CDN (permanent URLs — scraper worker stores permanent URLs at intake, not expiring Replicate CDN URLs).

**API client:** `lib/api.ts` uses native `fetch` with no additional abstraction layer. SWR or React Query could be added if cache invalidation patterns become complex.

### 6. Oracle VM Sizing

Current production sizing (Oracle Cloud A1 Flex — free tier):
- 4 OCPUs (ARM), 24 GB RAM
- Fastify + 4 worker processes (via PM2 cluster mode)
- Docker containers: `launchmind-backend` + `launchmind-scraper` + Nginx

Scaling triggers:
- CPU > 70% sustained 5 min → scale to 8 OCPUs
- P95 API latency > 1s → investigate slow queries, add indexes
- Redis memory > 80% → flush benchmark caches, increase Upstash plan

---

## Consequences

**Positive:**
- Covering indexes eliminate full-table scans on all hot paths.
- Background queue prevents any AI generation from blocking API responses.
- Report caching dramatically reduces AI token spend on repeated report views.

**Risks:**
- pgvector IVFFlat index requires `ANALYZE` after significant data growth — add as weekly maintenance job.
- Oracle free tier CPU burst is limited — monitor p95 latency under real load.
- Redis on Upstash has 256 MB free tier limit — promote to paid before 100+ active founders.

---

## References
- CLAUDE.md §2 (Tech Stack — Upstash Redis + BullMQ)
- `backend/src/lib/scheduler.ts`
- `backend/src/workers/missionWorker.ts`
- `backend/src/lib/contextEngine.ts`
- `backend/src/services/reportingService.ts`
