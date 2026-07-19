# LaunchMind — Production Observability

**Date:** 2026-07-10  
**Milestone:** M12 — Production Hardening

---

## 1. Logging Architecture

### 1.1 Log Levels

| Level | When to use | Examples |
|---|---|---|
| `error` | Unhandled exceptions, 5xx responses, critical failures | DB connection lost, KMS unavailable, Claude API 5xx |
| `warn` | Expected errors requiring attention, 4xx with business significance | Spend cap rejected, approval gate blocked, anomaly detected |
| `info` | Normal operations, successful requests | Route handled, job completed, campaign launched |
| `debug` | Development only — NEVER in production | Query results, prompt content |

**Production log level:** `info` (suppress `debug`).

### 1.2 Standard Log Fields

Every Fastify log entry includes:

```json
{
  "level": 30,
  "time": "2026-07-10T08:00:00.000Z",
  "pid": 1234,
  "hostname": "launchmind-vm-1",
  "reqId": "req-a1b2c3d4",
  "req": {
    "method": "POST",
    "url": "/campaigns/abc/launch",
    "remoteAddress": "1.2.3.4"
  },
  "res": {
    "statusCode": 200
  },
  "responseTime": 142,
  "founderId": "uuid",
  "msg": "campaigns:launch success"
}
```

### 1.3 Sensitive Field Redaction

Fastify serializer configured to redact:
```javascript
redact: [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.encrypted_token',
  '*.password',
  '*.token',
]
```

Note: `reqId` (not `req.headers.authorization`) is the only identity correlation field logged.

### 1.4 Axiom Log Shipping

**Docker log driver:**
```yaml
logging:
  driver: "json-file"
  options:
    max-size: "10m"
    max-file: "3"
```

**Vector sidecar** ships JSON logs to Axiom:
```yaml
axiom:
  type: axiom
  dataset: launchmind-api
  token: ${AXIOM_API_KEY}
```

**Datasets:**
| Dataset | Content | Retention |
|---|---|---|
| `launchmind-api` | All Fastify request/response logs | 90 days |
| `launchmind-workers` | BullMQ job lifecycle events | 30 days |
| `launchmind-security` | Anomaly events, auth failures, audit_log actions | 2 years |
| `launchmind-ai` | AI request metadata (no content) | 30 days |

---

## 2. Metrics

### 2.1 Application Metrics

Collected via `onResponse` Fastify hook and emitted to Axiom as structured events:

```javascript
server.addHook('onResponse', async (request, reply) => {
  const metric = {
    type: 'http_metric',
    method: request.method,
    route: request.routerPath,
    status: reply.statusCode,
    duration_ms: reply.getResponseTime(),
    founder_id: request.user?.sub ?? null,
  };
  axiom.ingest('launchmind-api', [metric]);
});
```

### 2.2 AI Cost Metrics

Every `ai_requests` insert includes `cost_usd`. Daily cost rollup query:
```sql
SELECT DATE(created_at) as date, model, SUM(cost_usd) as total_cost
FROM ai_requests
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY date, model
ORDER BY date DESC
```

Exposed via `GET /ai/audit/stats` (authenticated, founder-scoped).

### 2.3 Queue Depth Metrics

BullMQ provides built-in queue depth via:
```typescript
const waiting = await missionQueue.getWaitingCount();
const active  = await missionQueue.getActiveCount();
const failed  = await missionQueue.getFailedCount();
```

Emitted to Axiom every 60 seconds by scheduler worker.

---

## 3. Alerting

### 3.1 Alert Definitions

| Alert name | Axiom query | Threshold | Severity | Channel |
|---|---|---|---|---|
| API error rate | `status >= 500 \| rate(5m)` | > 5% | P1 | PagerDuty + Slack |
| High latency | `duration_ms \| percentile(95, 5m)` | > 2000ms | P2 | Slack |
| AI cost spike | `cost_usd \| sum(1h)` | > $10 | P2 | Email + Slack |
| Queue failure spike | `queue.status = failed \| count(15m)` | > 20 | P2 | Slack |
| Auth failures | `status = 401 \| count(5m)` | > 50 | P3 | Slack |
| Anomaly detected | `action = anomaly_detected \| count(1m)` | > 5 | P3 | Slack |
| Health check fail | External monitor | 3 failures/1min | P1 | PagerDuty |

### 3.2 Alert Channels

- **PagerDuty:** P1 only — 24/7 on-call rotation, phone + SMS
- **Slack `#incidents`:** P1 alerts (mirrored from PagerDuty)
- **Slack `#alerts`:** P2 alerts
- **Slack `#monitoring`:** P3 informational
- **Email `oncall@launchmind.com`:** P2 alerts (backup to Slack)

### 3.3 On-Call Runbook

**P1: API down**
1. Check Axiom `launchmind-api` for last successful request
2. SSH to Oracle VM: `docker ps | grep launchmind-backend`
3. If container stopped: `docker start launchmind-backend`
4. If OOM: `docker stats` → restart + scale `--memory 4g`
5. If DB: check Supabase status page
6. Notify Slack `#incidents` within 5 min of detection

**P1: KMS failure**
1. Check AWS KMS console for key status
2. If key disabled: re-enable via AWS console
3. Platform token operations will fail — founders cannot post to channels
4. Notify affected founders via Resend if > 30 min outage

**P2: High AI cost**
1. Query `ai_requests` for top-spending founders and actions in last hour
2. If runaway loop: identify `action` and `founder_id` → temporary disable via `decision_rules`
3. If legitimate spike (many founders generating simultaneously): monitor, no action unless > $50/hour

---

## 4. Health Checks

### 4.1 Current Implementation

`GET /health` (registered in `server.ts`):
- Returns `{ status: 'ok', uptime: N }` immediately if server is running
- No deep checks yet

### 4.2 Required Before Production

Enhance `GET /health` to include:

```typescript
server.get('/health', async (req, reply) => {
  const checks: Record<string, 'ok' | 'degraded' | 'error'> = {};

  // Database check
  try {
    await getSupabaseAdmin().from('founders').select('id').limit(1);
    checks.database = 'ok';
  } catch { checks.database = 'error'; }

  // Redis check
  try {
    await redis.ping();
    checks.redis = 'ok';
  } catch { checks.redis = 'degraded'; }

  const allOk = Object.values(checks).every(v => v === 'ok');
  return reply.code(allOk ? 200 : 503).send({
    status: allOk ? 'ok' : 'degraded',
    uptime: process.uptime(),
    version: process.env.npm_package_version,
    checks,
  });
});
```

**Action:** Update `server.ts` health endpoint before production launch.

---

## 5. Distributed Tracing

### 5.1 Current: Request ID

`X-Request-ID` generated by Fastify on each request (UUID v4). Logged in every request log entry. BullMQ jobs include `requestId` in job data.

**Gap:** Outbound calls to Claude API, Supabase, Stripe do not yet propagate `X-Request-ID`. Manual correlation via Axiom time window required.

### 5.2 Planned: OpenTelemetry (M13)

- Add `@opentelemetry/sdk-node` + `@opentelemetry/exporter-trace-otlp-http`
- Export spans to Axiom OTel endpoint (supported natively)
- Auto-instrument: Fastify, pg, http, fetch
- Trace propagation header: `traceparent` (W3C standard)
- Deferred to M13: low priority for initial production launch.

---

## 6. Sentry Integration

Sentry is wired into the Fastify error handler (registered in `server.ts`). All uncaught exceptions reach Sentry.

**Configured:**
- `SENTRY_DSN` in `.env.local` + Oracle VM env
- Source maps uploaded on deploy for readable stack traces
- Release tracking: `SENTRY_RELEASE=${GIT_SHA}`
- Performance monitoring: 10% sample rate (avoid Sentry bill explosion)
- Ignored errors: rate limit 429 (expected), validation 400 (expected)

---

## 7. Dashboard Queries (Axiom Saved)

| Query name | APL | Purpose |
|---|---|---|
| Top errors (24h) | `launchmind-api \| where status >= 500 \| summarize count() by route \| sort by count_ desc` | Identify most broken routes |
| AI cost by action (7d) | `launchmind-ai \| summarize sum(cost_usd) by action, model` | Track AI spend breakdown |
| Latency P95 by route | `launchmind-api \| summarize percentile(duration_ms, 95) by route` | Find slow endpoints |
| Failed missions | `launchmind-workers \| where status = 'failed' \| summarize count() by job_type` | Agent failure patterns |
| Anomaly events | `launchmind-security \| where action = 'anomaly_detected'` | Security review |
