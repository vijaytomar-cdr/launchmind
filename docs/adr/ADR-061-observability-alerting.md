# ADR-061 — Observability & Alerting Strategy

**Status:** Accepted  
**Date:** 2026-07-10  
**Milestone:** M12 — Production Hardening

---

## Context

LaunchMind's production system spans multiple layers: Vercel (frontend), Oracle VM Fastify (backend), Supabase Postgres (database), Upstash Redis (cache/queue), BullMQ workers (background jobs), Claude API (AI), Replicate (image generation), ElevenLabs (voice), Creatomate (video), Stripe + Razorpay (payments). Operational readiness requires structured observability across all layers.

---

## Decision

### 1. Structured Logging

**Log format:** JSON, emitted to stdout, captured by Docker → Nginx → Axiom.

Standard log fields on every entry:
```json
{
  "level": "info|warn|error",
  "time": "2026-07-10T08:00:00.000Z",
  "requestId": "req-uuid-v4",
  "founderId": "uuid|null",
  "action": "route:method|worker:job|service:fn",
  "durationMs": 142,
  "msg": "human-readable message"
}
```

**Request ID propagation:** Fastify generates `X-Request-ID` (UUID v4) on every request. All downstream service calls (AI, storage, payments) include `X-Request-ID` in headers for correlation. Frontend sends `X-Request-ID` from `lib/api.ts` fetch calls.

**Sensitive field redaction:** The following fields are NEVER logged:
- `encrypted_token` / decrypted token value
- `password` / hashed password
- Credit card numbers / payment method details
- Full JWT tokens (log only `sub` claim)
- Raw webhook payloads from Stripe/Razorpay (log `event.type` only)

### 2. Metrics

**Collected via Fastify `onResponse` hook:**
- `http.request.duration_ms` — tagged by `method`, `route`, `status_code`
- `http.request.count` — tagged by `method`, `route`, `status_code`
- `ai.tokens.consumed` — tagged by `action`, `model`, `founderId`
- `ai.cost.usd` — tagged by `action`, `model`
- `queue.job.duration_ms` — tagged by `queue`, `job_type`, `status`
- `queue.job.count` — tagged by `queue`, `job_type`, `status`

**Latency percentiles:** p50, p95, p99 per route, computed over 1-min windows.

### 3. Alerting

**PagerDuty / Resend email alerts:**

| Alert | Condition | Severity | Runbook |
|---|---|---|---|
| API down | Health check fails 3× in 1 min | P1 | `docs/incidents/playbook.md` |
| High error rate | 5xx rate > 5% over 5 min | P1 | Check Axiom logs, restart if OOM |
| P95 latency spike | > 2s for 5 consecutive minutes | P2 | Check slow query log, add index |
| AI cost spike | `ai.cost.usd` > $10/hour | P2 | Check for runaway generation loop |
| BullMQ DLQ depth | > 20 failed jobs | P2 | Review `mission_logs` for pattern |
| Redis OOM | Upstash memory > 85% | P2 | Flush benchmark caches |
| Supabase connection pool | > 90% utilised | P1 | Scale up or add pgBouncer |
| Anomaly: suspicious requests | > 50 requests/min from single IP | P3 | Cloudflare WAF already blocks; log for review |
| Token vault KMS error | Any KMS API failure | P1 | KMS runbook, use backup key |

**Alert routing:**
- P1 (production down): PagerDuty → on-call phone + Slack `#incidents`
- P2 (degraded): Resend email → `oncall@launchmind.com` + Slack `#alerts`
- P3 (informational): Slack `#monitoring` only

### 4. Distributed Tracing

**Request ID flow:**
1. Cloudflare generates `CF-Ray` header
2. Fastify generates `X-Request-ID` (UUID v4) if not present
3. `X-Request-ID` is logged on every Fastify log entry
4. All outbound HTTP calls (Claude API, Replicate, Stripe) include `X-Request-ID` in `Idempotency-Key` or custom header
5. BullMQ jobs include `requestId` in job data
6. Axiom: cross-filter by `requestId` to trace end-to-end

### 5. Health Checks

**`GET /health` endpoint:**
```json
{
  "status": "ok",
  "uptime": 3600,
  "version": "1.0.0",
  "checks": {
    "database": "ok",
    "redis": "ok",
    "ai": "ok"
  }
}
```

Database check: `SELECT 1` with 500ms timeout.
Redis check: `PING` with 200ms timeout.
AI check: last successful AI request within 5 minutes (cached in Redis).

**`GET /health/ready` endpoint (Kubernetes readiness probe):**
Returns 200 only when all critical checks pass. Returns 503 if database or Redis is unavailable.

### 6. Axiom Integration

**Log shipping:** Docker `json-file` log driver → Axiom via Vector sidecar.

**Datasets:**
- `launchmind-api`: All Fastify request/response logs
- `launchmind-workers`: BullMQ job logs
- `launchmind-security`: Anomaly detection events, failed auth attempts, audit log actions
- `launchmind-ai`: AI request/response metadata (never content)

**Retention:** 90 days for API logs, 2 years for security logs.

**Saved queries:**
- "Top errors last 24h" → `status_code >= 500 | group by route | count`
- "AI spend today" → `action = ai_request | sum(cost_usd)`
- "Failed missions" → `queue = mission-execution AND status = failed | group by job_type`

---

## Consequences

**Positive:**
- End-to-end request tracing via `X-Request-ID` without full OpenTelemetry overhead.
- Proactive cost alerts prevent surprise AI bills.
- Axiom provides immutable security log archive.

**Gaps to address post-launch:**
- OpenTelemetry traces (spans, not just logs) — deferred to M13.
- Grafana dashboard for real-time metrics — using Axiom dashboards for now.
- SLO tracking (error budget) — deferred to M13.

---

## References
- CLAUDE.md §2 (Audit logs: Axiom)
- `backend/src/lib/aiPlatform.ts` (ai_requests table, cost tracking)
- `docs/incidents/playbook.md`
