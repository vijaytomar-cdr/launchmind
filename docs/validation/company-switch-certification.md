# Company Switch — Certification (Phase 3.2A, Parts 26–29)

Date: 2026-08-13
Account: the real two-company founder account (AllignX + LaunchMind).
Credentials read from `.env.local` by the Playwright `cert` project; never printed,
logged, committed, or placed in fixtures.

---

## 1. Reported symptom

> When switching company in the top-right switcher the dropdown selection changes
> quickly and the company name changes, but page content takes several seconds to
> catch up. For a short period the header can represent company B while the page
> still shows company A.

Confirmed, measured, and root-caused. It was **not** only a latency problem.

---

## 2. Root cause

Two independent faults compounding.

### 2a. A business-unscoped client cache (the real defect)

`BriefClientView` kept a stale-while-revalidate cache under a single global key:

```ts
const CACHE_KEY = 'lm_brief_data';   // no company in the key
```

The dashboard layout remounts business-scoped content with
`<main key={activeBusinessId}>`, which correctly destroys React state on a switch.
It cannot clear `sessionStorage`, which lives outside React. So on switching
company the Morning Brief remounted, immediately re-read that key, and rendered
**the previous company's brief under the new company's header**.

The remount guard could never have caught this: the component was rebuilt
correctly and then reloaded the wrong data by hand.

Evidence captured by the harness during the defect window:

```
-> Launchmind: Your growth system reviewed AllignX・Home Services App - App Store
               overnight. Here is what needs your attention today.
-> AllignX:    Your growth system reviewed Launchmind overnight. …
```

Symmetric in both directions. This is transient cross-business content in the
owner's view — a business-scope defect, not a cosmetic delay.

### 2b. The overlay ended on a clock, not on readiness

```ts
router.refresh();
setTimeout(() => setSwitching(null), 4000);   // fixed delay
```

`router.refresh()` is non-blocking, and Next.js commits the layout segment and the
page segment independently. Measured: layout committed at ~1.6s, content at
~10.4s, overlay lifted at ~4.5s — i.e. squarely between them. The fixed delay was
simultaneously too long for fast switches and far too short to cover a slow one.

### 2c. Contributing latency (reported, not fixed)

`GET /owner/brief` calls `callSonnet` on every request to generate the morning
recommendation. That is the ~10s content figure. Part 28 asks that expensive AI
state not be regenerated merely because a company was switched when a persisted
current artifact could be read. **No persisted brief-recommendation artifact
exists today**, so this was reported rather than half-implemented — adding a
persistence layer has staleness semantics that deserve their own decision.

After the fixes the content figure is ~1.6s because the brief now renders its own
loading state for the destination instead of another company's cached data; the
Sonnet call still happens behind that state.

---

## 3. Fixes

| Fix | File | What changed |
|---|---|---|
| Company-partitioned client caches | `lib/business/scope.tsx` (new) | `BusinessScopeProvider` + `businessCacheKey()`. Returns `null` when no company is active, so an unattributed cache cannot be written. |
| Brief cache scoped | `app/(dashboard)/dashboard/brief/BriefClientView.tsx` | Reads/writes `lm_brief_data:<companyId>`. |
| Provider mounted | `app/(dashboard)/layout.tsx` | Wraps `children` inside the existing `<main key>`. |
| Overlay ends on readiness | `components/launchmind/BusinessSwitcher.tsx` | `startTransition(() => router.refresh())`; lock releases when the transition has committed **and** the server reports the destination as active. 20s failsafe only. No artificial delay. |

Audit: `BriefClientView` was the **only** business-scoped client cache in the
dashboard. All other `sessionStorage` writes are single-flow intake/onboarding
state, which is not a company-switching surface.

---

## 4. Measurements

Four consecutive switches (A→B→A→B), Morning Brief, local dev.

### Before

| Metric | p50 | p95 |
|---|---|---|
| activate API | 544ms | 842ms |
| header updates | 1,802ms | 2,047ms |
| content correct | 11,077ms | 11,077ms |
| overlay lifts | 4,581ms | 4,882ms |
| **split-brain** | — | **5,200 / 21,800 / 5,000 / 20,160 ms** |

### After

| Metric | p50 | p95 |
|---|---|---|
| activate API | 520ms | 543ms |
| header updates | 1,621ms | 1,653ms |
| content correct | 1,621ms | 1,653ms |
| overlay lifts | 1,665ms | 1,696ms |
| **split-brain** | — | **0 / 0 / 0 / 0 ms** |

Header, content and overlay now converge at the same instant.

### Mutation test (proves the fix is load-bearing)

Reverting only the cache key to the unscoped `CACHE_BASE` reproduces the defect:
split-brain **7,840 / 40 / 0 / 17,240 ms**. Restored → 0ms across the board.

### A measurement correction

The first harness used a bare `/Launchmind/i` sentinel. That also matched product
self-reference copy on AllignX's own opportunity ("A starting point while
LaunchMind has no performance data yet"), producing a 40ms false positive and
inflating two "before" runs. The sentinel now matches the Morning Brief's
business-identity sentence (`/reviewed[^.]*<NAME>/`). The **5,200ms** and
**5,000ms** figures were verified genuine via the located stale text; the
~21s figures were partly contaminated by that copy string and should be read as
"≥5s and unbounded within the 30s observation window", not as exact.

---

## 5. Regression gates

| Gate | Result |
|---|---|
| `switch-latency.cert.spec.ts` | PASS (0ms split-brain) |
| `business-isolation.cert.spec.ts` (2 specs) | PASS |
| `opportunity-badge.cert.spec.ts` | PASS |
| backend vitest | 1704/1705 — only the documented pre-existing `content.test.ts` |
| frontend `tsc --noEmit` | 0 errors |
| backend `tsc --noEmit` | 0 errors |

---

## 6. Not covered in this pass

- Parts 30–35 (switcher discoverability redesign, accessibility re-verification,
  multi-screen browser certification across Opportunities / Approvals / Marketing
  Memory / Growth Brain) — **not started**.
- Part 28's recommendation to read a persisted brief artifact instead of
  regenerating — **reported, not implemented**.
