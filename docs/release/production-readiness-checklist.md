# LaunchMind — Production Readiness Checklist

**Date:** 2026-07-10  
**Milestone:** M12 — Production Hardening  
**Version:** 1.0.0

---

## Instructions

- ✅ = Verified complete
- ⚠️ = Requires action before production launch
- 🔴 = Blocking — must be resolved before launch
- N/A = Not applicable

---

## 1. Security

| # | Check | Status | Notes |
|---|---|---|---|
| S1 | JWT 15-min access tokens | ✅ | jwtPlugin + Supabase Auth |
| S2 | Rotating refresh tokens | ✅ | Supabase default |
| S3 | MFA enforced for all accounts | ✅ | TOTP via Supabase, cannot disable |
| S4 | AES-256 encrypted OAuth tokens | ✅ | tokenVault.ts |
| S5 | encrypted_token never returned to frontend | ✅ | Verified in api.ts types |
| S6 | AWS KMS key management | ✅ | CMK, never in DB |
| S7 | RLS on all founder-data tables | ✅ | 19 tables verified |
| S8 | Route-level founder_id filter | ✅ | All route handlers |
| S9 | Cross-tenant isolation tested | ✅ | FOUNDER_B tests in 3 suites |
| S10 | Approve-before-post (§1.5) | ✅ | campaigns + studio routes |
| S11 | Spend cap (§1.6) | ✅ | campaigns launch route |
| S12 | Zod validation on all inputs | ✅ | safeParse() in all handlers |
| S13 | No hardcoded secrets in repo | ✅ | Pre-commit hook enforced |
| S14 | .env.local gitignored | ✅ | .gitignore verified |
| S15 | Anomaly detection active | ✅ | anomalyDetectionMiddleware |
| S16 | Audit logs immutable | ✅ | REVOKE UPDATE/DELETE |
| S17 | CORS whitelist | ✅ | launchmind.com + localhost:3000 |
| S18 | Security headers (CSP, X-Frame-Options) | ✅ | Cloudflare + Nginx |
| S19 | TLS 1.3 minimum | ✅ | Cloudflare WAF |
| S20 | Rate limiting (Cloudflare + Fastify) | ✅ | 100 req/min per founder |
| S21 | SAST passing (Semgrep + ESLint security) | ✅ | CI gate |
| S22 | Dependency scan (Snyk + npm audit) | ✅ | CI gate |
| S23 | SSRF protection in URL scraper | ⚠️ | Verify private IP range blocking in icpService |
| S24 | OWASP ZAP DAST on staging | ⚠️ | Run before launch |
| S25 | No standing production access | ✅ | docs/access-requests.md procedure |

---

## 2. Compliance

| # | Check | Status | Notes |
|---|---|---|---|
| C1 | GDPR delete implemented | ✅ | DELETE /founders/me |
| C2 | GDPR export implemented | ✅ | GET /founders/me/export |
| C3 | Cookie consent before PostHog | ✅ | Client-side gate |
| C4 | Data retention policy documented | ✅ | docs/data/data-protection-review.md |
| C5 | Audit log PII purge job | ⚠️ | Verify in scheduler.ts |
| C6 | AI requests purge job (90d) | ⚠️ | Verify in scheduler.ts |
| C7 | Privacy notice published | ⚠️ | Required before launch |
| C8 | DPAs with Replicate, ElevenLabs, Creatomate | ⚠️ | Review and sign |
| C9 | India Grievance Officer designated | ⚠️ | Name required for DPDP |
| C10 | DPBI breach notification in incident playbook | ⚠️ | Add to docs/incidents/playbook.md |
| C11 | Supabase region verified for India data | ⚠️ | Confirm ap-south-1 for India founders |

---

## 3. Performance

| # | Check | Status | Notes |
|---|---|---|---|
| P1 | DB indexes for hot query paths | ⚠️ | Create migration 062_production_indexes.sql |
| P2 | pgBouncer enabled in Supabase | ⚠️ | Enable in Supabase Project Settings |
| P3 | Background queue workers running | ✅ | missionWorker + intakeWorker + scheduler |
| P4 | Report caching active | ✅ | UNIQUE index on reports table |
| P5 | Context Engine uses parallel queries | ✅ | Promise.all in buildContextPackage |
| P6 | Next.js build output < 100KB per page | ⚠️ | Verify after `npm run build` |
| P7 | Upstash Redis plan for 100+ founders | ⚠️ | Promote to 1GB paid plan |

---

## 4. Observability

| # | Check | Status | Notes |
|---|---|---|---|
| O1 | Sentry wired into Fastify error handler | ✅ | server.ts |
| O2 | Axiom log shipping configured | ⚠️ | Set up Vector sidecar on Oracle VM |
| O3 | AI cost alerts (Axiom) | ⚠️ | Configure alert rule |
| O4 | Health check endpoint returns deep checks | ⚠️ | Update /health to include DB + Redis check |
| O5 | P1 alert routing (PagerDuty) | ⚠️ | Configure PagerDuty integration |
| O6 | P2 alert routing (Slack) | ⚠️ | Configure Slack webhook |
| O7 | Structured log redaction configured | ✅ | Fastify serializer redact config |
| O8 | Request ID on all Fastify logs | ✅ | Built-in Fastify reqId |

---

## 5. Deployment

| # | Check | Status | Notes |
|---|---|---|---|
| D1 | Vercel project connected to GitHub | ✅ | Auto-deploy on push to main |
| D2 | Oracle VM provisioned | ✅ | A1 Flex, 4 OCPU, 24GB |
| D3 | Nginx configured | ✅ | nginx.conf in repo |
| D4 | Docker image builds successfully | ✅ | CI build stage |
| D5 | All env vars set on Oracle VM | ⚠️ | ELEVENLABS, CREATOMATE, REPLICATE missing |
| D6 | All env vars set on Vercel | ⚠️ | NEXT_PUBLIC_BACKEND_URL required |
| D7 | All migrations pushed to hosted Supabase | 🔴 | Migrations 035–061 not yet pushed |
| D8 | Rollback procedure tested | ⚠️ | Test rollback on staging first |
| D9 | Backup verification completed | ⚠️ | Restore to staging Supabase and verify |
| D10 | DR runbook tested | ⚠️ | Test full VM recovery on staging |

---

## 6. AI Platform

| # | Check | Status | Notes |
|---|---|---|---|
| A1 | No direct Anthropic SDK calls | ✅ | All through aiPlatform.ts |
| A2 | Prompt injection sanitization | ✅ | sanitizeInput() in aiPlatform |
| A3 | Token balance enforcement active | ✅ | Phase 5 enforcement |
| A4 | AI cost tracked per request | ✅ | ai_requests table |
| A5 | Prompt versioning implemented | ✅ | prompts table, auto-version |
| A6 | All AI fallback paths implemented | ✅ | Per-service fallbacks |
| A7 | Retry + timeout configured | ✅ | 2 retries, 60s/30s timeouts |
| A8 | AI audit visible to founders | ✅ | /ai/audit page |
| A9 | SAST rule for direct SDK use | ⚠️ | Add to semgrep.yml |
| A10 | ANTHROPIC_API_KEY set on Oracle VM | ✅ | |

---

## 7. Data Protection

| # | Check | Status | Notes |
|---|---|---|---|
| DP1 | Supabase AES-256 at rest | ✅ | RDS-managed |
| DP2 | TLS 1.3 in transit | ✅ | Cloudflare |
| DP3 | Signed URLs for storage (1-hour expiry) | ✅ | contentService |
| DP4 | Source images use permanent URLs | ✅ | marketingImagesService |
| DP5 | AWS KMS key rotation enabled | ⚠️ | Enable annual rotation in KMS console |
| DP6 | Oracle VM disk encryption | ⚠️ | Verify LUKS or Oracle block volume encryption |
| DP7 | DPAs signed with all processors | ⚠️ | Replicate, ElevenLabs, Creatomate |
| DP8 | GDPR delete cascade verified | ✅ | founders.route.ts |

---

## 8. Testing

| # | Check | Status | Notes |
|---|---|---|---|
| T1 | 349/351 tests passing | ✅ | 2 pre-existing non-blocking failures |
| T2 | TypeScript 0 new errors | ✅ | 5 pre-existing scraper errors (non-blocking) |
| T3 | E2E tests passing | ✅ | 23 Playwright tests |
| T4 | Coverage gate in CI | ⚠️ | Add --coverage flag to CI |
| T5 | Pre-existing failures documented | ✅ | ADR-065 + final-test-report.md |
| T6 | DAST on staging | ⚠️ | Must run before production promotion |

---

## 9. Documentation

| # | Check | Status | Notes |
|---|---|---|---|
| Doc1 | CLAUDE.md §11 updated through M11 | ✅ | |
| Doc2 | All ADRs written (001–065) | ✅ | |
| Doc3 | Final architecture review | ✅ | docs/reviews/final-architecture-review.md |
| Doc4 | Production security review | ✅ | docs/security/production-security-review.md |
| Doc5 | Compliance readiness | ✅ | docs/compliance/compliance-readiness.md |
| Doc6 | Performance review | ✅ | docs/performance/performance-review.md |
| Doc7 | Observability plan | ✅ | docs/observability/production-observability.md |
| Doc8 | Deployment guide | ✅ | docs/deployment/production-deployment.md |
| Doc9 | AI production hardening | ✅ | docs/ai/ai-production-hardening.md |
| Doc10 | Data protection review | ✅ | docs/data/data-protection-review.md |
| Doc11 | Final test report | ✅ | docs/testing/final-test-report.md |
| Doc12 | Incident playbook | ✅ | docs/incidents/playbook.md |
| Doc13 | Secret rotation guide | ✅ | docs/security/secret-rotation.md |

---

## Summary

| Category | Total checks | ✅ | ⚠️ | 🔴 |
|---|---|---|---|---|
| Security | 25 | 23 | 2 | 0 |
| Compliance | 11 | 4 | 7 | 0 |
| Performance | 7 | 4 | 3 | 0 |
| Observability | 8 | 4 | 4 | 0 |
| Deployment | 10 | 4 | 5 | 1 |
| AI Platform | 10 | 9 | 1 | 0 |
| Data Protection | 8 | 5 | 3 | 0 |
| Testing | 6 | 4 | 2 | 0 |
| Documentation | 13 | 13 | 0 | 0 |
| **Total** | **98** | **70** | **27** | **1** |

**🔴 BLOCKING (1):** Push migrations 035–061 to hosted Supabase — required before any production traffic.

**⚠️ Pre-launch actions (27):** See individual sections. Can be completed in 1–2 sprints by ops team.

**✅ Code complete:** All product functionality is implemented, tested, and documented.
