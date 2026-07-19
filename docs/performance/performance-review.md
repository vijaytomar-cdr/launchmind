# LaunchMind — Performance Review

**Date:** 2026-07-10  
**Milestone:** M12 — Production Hardening  

---

## 1. Latency Targets

| Endpoint category | P50 target | P95 target | Current status |
|---|---|---|---|
| Health check | < 20ms | < 50ms | ✅ Meets target |
| Auth-protected list (campaigns, assets) | < 100ms | < 200ms | ✅ Meets target |
| Analytics summary (cross-product) | < 300ms | < 500ms | ✅ With indexes |
| Strategy generation | < 15s | < 30s | ✅ Async with polling |
| Content asset generation | < 30s | < 60s | ✅ Async |
| Mission execution | Async | Async | ✅ BullMQ |

---

## 2. Database Indexes

### 2.1 Existing (from migrations)

All campaign and metric queries use the following indexes created in migration 004:
```sql
CREATE INDEX campaigns_product_status ON campaigns(product_id, status);
```

### 2.2 Required Before Production

The following indexes should be verified or added:

```sql
-- campaign_metrics: hot path for analytics weekly summaries
CREATE INDEX IF NOT EXISTS metrics_campaign_week ON campaign_metrics(campaign_id, week_start DESC);
CREATE INDEX IF NOT EXISTS metrics_founder_week ON campaign_metrics(founder_id, week_start DESC);

-- content_assets: Studio library queries
CREATE INDEX IF NOT EXISTS assets_product_status ON content_assets(product_id, status);
CREATE INDEX IF NOT EXISTS assets_founder_type ON content_assets(founder_id, type);

-- ai_requests: audit dashboard queries
CREATE INDEX IF NOT EXISTS ai_req_founder_created ON ai_requests(founder_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_req_prompt_created ON ai_requests(prompt_id, created_at DESC);

-- reports: cache lookup (UNIQUE already covers this but explicit index helps planner)
CREATE INDEX IF NOT EXISTS reports_founder_product_period ON reports(founder_id, product_id, period_start DESC);

-- marketing_memories: confidence-ranked retrieval
CREATE INDEX IF NOT EXISTS memories_founder_confidence ON marketing_memories(founder_id, confidence DESC);

-- missions: status filter
CREATE INDEX IF NOT EXISTS missions_founder_status ON missions(founder_id, status);

-- knowledge_nodes: type queries
CREATE INDEX IF NOT EXISTS knowledge_nodes_founder_type ON knowledge_nodes(founder_id, node_type);

-- saved_opportunities: priority filter
CREATE INDEX IF NOT EXISTS opps_founder_status ON saved_opportunities(founder_id, status);
```

**Action:** Create a migration `20260710_000062_production_indexes.sql` with these index definitions before production launch.

### 2.3 pgvector IVFFlat Index

```sql
-- For icp_embedding similarity search (product recommendations)
CREATE INDEX IF NOT EXISTS products_icp_ivfflat 
  ON products USING ivfflat (icp_embedding vector_cosine_ops) 
  WITH (lists = 100);

-- Must run ANALYZE after first batch of embeddings
ANALYZE products;
```

---

## 3. Query Performance Analysis

### 3.1 Analytics Summary (`getAnalyticsSummary`)

Current implementation:
1. Fetch all products for founder: O(n products)
2. For each product: call `getProductMetrics()` → 1 Supabase query (campaign_metrics join)
3. Total: 1 + n queries

**Optimisation for > 10 products:** Replace per-product loop with single GROUP BY query:
```sql
SELECT cm.campaign_id, c.product_id, c.channel, c.market,
       SUM(cm.impressions) AS impressions, SUM(cm.clicks) AS clicks,
       SUM(cm.installs) AS installs, AVG(cm.cpi) AS avg_cpi
FROM campaign_metrics cm
JOIN campaigns c ON cm.campaign_id = c.id
WHERE c.founder_id = $1
  AND cm.week_start >= NOW() - INTERVAL '12 weeks'
GROUP BY cm.campaign_id, c.product_id, c.channel, c.market
```

This reduces from O(n) queries to O(1). **Implement in M13 when founders with > 3 products exist.**

### 3.2 Context Engine (`buildContextPackage`)

Uses `Promise.all()` for 6 parallel Supabase queries. All individual queries are fast (< 50ms each). Total: limited by slowest source (~50ms). ✅ Acceptable.

### 3.3 Report Generation Cache

Cache hit ratio expected:
- Week 1: 0% (all new)
- Week 2+: ~80% (founders re-view same weekly report multiple times)

Cache key: `UNIQUE(founder_id, product_id, report_type, period_start)` — implemented in migration 060. ✅

### 3.4 Recommendation Engine Scoring

`generateRecommendations()` calls `callHaiku()` once per generation cycle. Haiku latency: < 5s. Triggered only when:
- Founder clicks "Generate" in `/recommendations`
- High-confidence optimization insight found (async via `optimizationEngineService`)

Not in critical path. ✅

---

## 4. Frontend Performance

### 4.1 Bundle Size

Next.js 14 App Router with React Server Components. Key bundle characteristics:
- Pages load only their own component tree (no global SPA bundle)
- `@tabler/icons-react v3`: tree-shakeable — only imported icons are bundled
- `tailwindcss`: purged in production build — only used classes remain

**Verify:** `npm run build` output shows page sizes. Target: main page bundle < 100KB gzipped.

### 4.2 Image Optimisation

- Marketing images: stored permanently in Supabase Storage CDN (`content-assets` bucket)
- App Store screenshots used as real mockup images (no Flux.1 token cost for `style=mockup`)
- All images served via Next.js `<Image>` component with proper `sizes` and `loading` props

### 4.3 API Waterfall Prevention

Dashboard pages use parallel data fetching:
```typescript
const [brief, opportunities] = await Promise.all([
  api.owner.brief(token),
  api.owner.opportunities(token),
]);
```

No sequential API calls in page components. ✅

---

## 5. Background Processing

### 5.1 BullMQ Queue Health

| Queue | Concurrency | Expected job time | Max queue depth |
|---|---|---|---|
| mission-execution | 5 | 10s–120s | 50 |
| intake-worker | 3 | 30s–120s | 20 |
| weekly-brief | 10 (burst) | 60s per founder | All active founders |

**Weekly brief cron:** Runs Sunday 06:00 UTC. With 100 founders, 100 jobs at 60s each = 10 min elapsed time (with concurrency=10). Acceptable. Scale concurrency to 20 when > 200 founders.

### 5.2 Redis Usage

| Key pattern | Size estimate | TTL |
|---|---|---|
| Rate limit counters | 100B × founders | 15 min |
| Anomaly detection | 500B × founders | 15 min |
| Analytics cache | 5KB × founders | 5 min |
| BullMQ job metadata | 2KB × active jobs | Until complete + 24h |
| Benchmark cache | 20KB × 50 categories | 30 min |

**Total estimated at 1000 founders:** ~50MB. Well within Upstash 256MB free tier. Promote to 1GB plan at 500+ founders.

---

## 6. Supabase Connection Pool

Supabase Postgres connection limit (Pro plan): 100 connections.

With 4 Fastify worker processes (PM2 cluster mode) × max 25 connections each = 100 connections. At capacity.

**Action:** Enable `pgBouncer` in Supabase dashboard (connection pooler, transaction mode). This multiplexes thousands of backend connections onto ~20 Postgres connections. Required before scaling backend workers.

---

## 7. Performance Action Items

| # | Action | Priority | Target |
|---|---|---|---|
| P1 | Create migration `062_production_indexes.sql` | HIGH | Pre-launch |
| P2 | Enable pgBouncer in Supabase | HIGH | Pre-launch |
| P3 | Verify Next.js build output bundle sizes | MEDIUM | Pre-launch |
| P4 | Set up Axiom latency alerts (P95 > 1s) | MEDIUM | Pre-launch |
| P5 | Refactor `getAnalyticsSummary` to single GROUP BY query | LOW | M13 |
| P6 | Add pgvector ANALYZE job to weekly cron | LOW | M13 |
