# ADR-058 — Production Security Architecture

**Status:** Accepted  
**Date:** 2026-07-10  
**Milestone:** M12 — Production Hardening

---

## Context

LaunchMind has completed 11 milestones spanning authentication, AI platform, agent orchestration, content studio, campaigns, analytics, and intelligence networks. Before production promotion, a complete security architecture review is required to confirm that all constraints in CLAUDE.md §4 are correctly implemented end-to-end.

Key security assertions to verify:
- JWT 15-min access tokens with rotating refresh tokens (§4.4)
- MFA enforced for all accounts (§4.4)
- AES-256 + AWS KMS token vault — encrypted_token never returned to frontend (§4.2)
- RLS on every founder-data table (§4.3)
- Approve-before-post enforced server-side (§1.5)
- Spend cap enforced server-side (§1.6)
- Audit logs immutable (INSERT only) (§3.8)
- No secrets committed to repo (§4.1)

---

## Decision

The following security architecture decisions are confirmed and locked for production:

### 1. Authentication Layer
- **JWT verification**: All protected routes call `await req.jwtVerify()` first. The `jwtPlugin` uses `supabase.auth.getUser(token)` — algorithm-agnostic, survives key rotations.
- **Anomaly detection**: `anomalyDetectionMiddleware` fires on every authenticated request. New device/country triggers re-auth + Resend alert + audit_log write.
- **MFA**: TOTP via Supabase Auth. Cannot be disabled by users. Enforced at session creation, not just login.
- **Session management**: 15-min access tokens. Refresh tokens rotate on every use. Edge middleware (`middleware.ts`) refreshes session on every request before page code runs.

### 2. Data Isolation
- **Row-Level Security**: Every founder-data table has `founder_id = auth.uid()` RLS policy. Verified: `founders`, `products`, `platform_tokens`, `campaigns`, `campaign_metrics`, `weekly_briefs`, `content_assets`, `content_preferences`, `marketing_memories`, `knowledge_nodes`, `knowledge_edges`, `embedding_store`, `workspaces`, `missions`, `reports`, `optimization_insights`, `saved_opportunities`, `notifications`.
- **Tenant isolation at route layer**: Every route handler applies `.eq('founder_id', founderId)` before any DB operation. RLS provides defense-in-depth.
- **Tenant isolation in tests**: `recommendations.test.ts` and `missions.test.ts` verify that FOUNDER_B cannot access FOUNDER_A's data (confirmed 404 not 403, leaking no info).

### 3. Token Vault
- `platform_tokens.encrypted_token`: AES-256 encrypted before write, KMS key never stored in DB.
- `decryptToken()` in `tokenVault.ts`: always writes to `audit_logs` before returning the decrypted value.
- Decrypted token: never logged, never returned to frontend, never cached in Redis.
- Frontend: `lib/api.ts` has no endpoint that returns `encrypted_token`. Verified: no `encrypted_token` field in any frontend type.

### 4. Input Validation
- All route bodies validated with Zod `safeParse()`. Validation failures return 400 before any DB or AI operation.
- No Zod schemas in Fastify `schema:` config (known incompatibility — see M10 feedback memory).
- Query parameters validated with Zod before use (no raw `req.query` access without parsing).

### 5. Approval Gate (§1.5)
- `campaigns/:id/launch` and `campaigns/:id/schedule`: both check `approved_at IS NOT NULL` → 422 if null.
- `studio/assets/:id/publish`: checks `approved_at IS NOT NULL` → 422 if null.
- Frontend cannot bypass: checks are in Fastify route handlers, not middleware that can be skipped.

### 6. Spend Cap (§1.6)
- `campaigns/:id/launch`: fetches `campaigns.spend_cap` → computes weekly spend from `campaign_metrics` → rejects with 422 if `(current + proposed) > cap × 1.5`.
- Decision Engine `checkSpendCap` (pure TypeScript, zero AI calls) also enforces this as a `DecisionError`.

### 7. Audit Logs
- `audit_logs`: `REVOKE UPDATE, DELETE FROM authenticated, anon` in migration 001.
- All sensitive actions write to audit_logs: token decrypt, GDPR delete, report feedback, anomaly detection.
- Axiom integration planned for external immutable shipping.

### 8. Secrets Management
- `.env.local`: local dev only, gitignored.
- Oracle VM: env file on VM, not in Docker image.
- Vercel: env vars set via Vercel dashboard.
- GitHub Actions: secrets via GitHub Secrets store.
- Pre-commit hook: `git grep -rE "(key|secret|password|token)\s*=\s*['\"][^'\"]{8,}"` blocks commits with hardcoded secrets.

### 9. Network Perimeter
- Cloudflare WAF: DDoS protection, rate limit 100 req/min per IP, TLS 1.3 minimum, HSTS.
- Fastify rate limiting: secondary layer per founder (100 req/min).
- CORS: `launchmind.com` + `localhost:3000` only.
- Security headers: `CSP`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`.

---

## Consequences

**Positive:**
- Multi-layer defence: Cloudflare perimeter → Fastify rate limit → JWT verify → Zod validation → RLS → approval gate.
- Audit trail is immutable and comprehensive.
- No standing production access possible — all access is time-boxed and logged.

**Risks and mitigations:**
- AWS KMS unavailability: tokens cannot be decrypted. Mitigation: KMS is HA across 3 AZs. `tokenVault.ts` throws cleanly rather than returning garbage.
- Supabase JWT rotation: handled — jwtPlugin uses `getUser()` not signature verification. Key rotation is transparent.
- OAuth token expiry: `expires_at` stored on `platform_tokens`. Routes check expiry before decrypt. Reconnect flow triggers when expired.

---

## References
- CLAUDE.md §4 (Security — Mandatory Rules)
- `backend/src/middleware/anomalyDetection.ts`
- `backend/src/lib/tokenVault.ts`
- `backend/src/lib/jwtPlugin.ts`
- `backend/src/routes/campaigns.route.ts` (§1.5 + §1.6)
