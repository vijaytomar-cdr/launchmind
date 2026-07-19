# ADR-065 — Quality Gate Strategy

**Status:** Accepted  
**Date:** 2026-07-10  
**Milestone:** M12 — Production Hardening

---

## Context

LaunchMind has completed 11 milestones with 19 Vitest test suites covering 350 tests. The test pyramid, coverage requirements, and quality gates must be formalised before production promotion.

---

## Decision

### 1. Test Pyramid

**Unit tests (fast, isolated — `backend/tests/`):**
- Test: service functions, route handlers (via Fastify `inject`), utility functions
- Mock: external services (Supabase, Claude API, Redis, Stripe)
- Runtime: < 30s for full suite
- Current: 349/351 passing (2 pre-existing failures in content.test.ts and aiPlatform.test.ts — see known issues below)

**Integration tests (deferred to M13):**
- Test against Supabase local (Docker)
- Verify actual RLS policies
- Verify actual migration schema

**E2E tests (`tests/e2e/`):**
- Playwright: `sanity.spec.ts` + `regression.spec.ts`
- Covers: auth flow, product intake wizard, strategy generation, campaign creation, content generation
- 12 E2E tests added in Week 18 for intake wizard

### 2. Coverage Requirements

**New code gate (CI enforced):**
- Line coverage: ≥ 80% for any file touched in the PR
- Branch coverage: ≥ 70% for any file touched in the PR

**Current coverage (approximate from 350 tests):**
- Routes: ~90% (every route has at least 401 + success test)
- Services: ~75% (happy path + key error path)
- Lib utilities: ~60% (aiPlatform, contextEngine well covered; tokenVault partially covered)

**Exemptions (coverage not enforced):**
- Migration files (`.sql`)
- Type declaration files (`.d.ts`)
- Mock/fixture files
- Frontend pages (no Vitest coverage — E2E covers these)

### 3. Known Test Failures (Pre-Existing)

**`content.test.ts` (1 failure):**
- Test: `POST /content/generate returns 201 with asset`
- Root cause: contentService `generateContentAssets()` mock returns object shape that changed in M08 when new asset types were added to the union.
- Status: Non-blocking for production (route works correctly; test mock mismatch only).
- Fix: Update mock to match current M08 `ContentAsset` shape. Scheduled for M13 housekeeping.

**`aiPlatform.test.ts` (1 failure):**
- Test: `callSonnet retries on 429`
- Root cause: Mock implementation of retry delay uses `setTimeout` which conflicts with Vitest fake timers.
- Status: Non-blocking for production (retry logic verified manually via Axiom logs).
- Fix: Convert to Vitest fake timer setup. Scheduled for M13 housekeeping.

### 4. Quality Gates Summary

| Gate | Tool | Threshold | Block on |
|---|---|---|---|
| TypeScript | `tsc --noEmit` | 0 new errors | Any new error |
| Unit tests | Vitest | 349/351 passing | Any new failure |
| Coverage | Vitest `--coverage` | ≥ 80% lines (new code) | Below threshold |
| SAST | Semgrep + ESLint security | 0 HIGH+ findings | HIGH or CRITICAL |
| Dependency scan | npm audit + Snyk | 0 HIGH+ CVEs | HIGH or CRITICAL |
| Secret scan | git grep regex | 0 matches | Any match |
| DAST (staging) | OWASP ZAP | 0 HIGH+ findings | HIGH or CRITICAL |
| Build | npm run build | Success | Any build error |

### 5. Test Maintenance Rules

1. **No test should test the mock, not the code.** Mocks simulate external dependencies (Supabase, Claude). Business logic must be in the service/route, not the mock.
2. **`vi.mock()` factory data must be inlined** — no outer variable references (vi.mock is hoisted before variable initialization). This caused 4 test failures during M11 and is now a documented pattern.
3. **JWT format for tests:** `Bearer eyJhbGciOiJFUzI1NiJ9.{base64_payload}.MOCK_SIG` — ES256 format matching jwtPlugin.
4. **Route tests use `jwtVerify()` pattern** — not `req.server.supabase` which is unavailable in tests.
5. **Tenant isolation tests** — every new route file must include one test verifying FOUNDER_B cannot access FOUNDER_A's data.

### 6. Regression Test Policy

Any production bug must:
1. First be reproduced by a failing test
2. Fix implemented
3. Test confirmed passing
4. PR merged with reference to the incident

This prevents regression without adding unnecessary tests for hypothetical scenarios.

---

## Consequences

**Positive:**
- Clear gate prevents regressions from reaching production.
- Known failures are documented and non-blocking (not silent).
- Test patterns are standardised across 19 test files.

**Negative:**
- 2 pre-existing test failures create noise in CI output — must be fixed in M13 to maintain trust in the suite.
- No integration tests against real Supabase — RLS verification relies on manual testing and code review.

---

## References
- `backend/tests/` — all 19 test files
- `tests/e2e/` — Playwright E2E specs
- `playwright.config.ts`
- ADR-057 attribution strategy (last-touch implementation)
