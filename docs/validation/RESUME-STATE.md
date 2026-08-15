# Multi-Product Validation — Resume State

**Mode:** `CONTINUOUS_LEARNING_INGESTION_MODE = shadow` (unchanged).
**Status:** `READY_FOR_OWNER_ONBOARDING`.

---

## Complete

| Artifact | Path | State |
|---|---|---|
| Provenance model | `backend/tests/fixtures/multiProduct/provenance.ts` | 4 classes, 3 fixed labs, `validateProvenance()` |
| Adversarial corpus | `backend/tests/fixtures/multiProduct/adversarialCorpus.ts` | **23 cases · 19/19 categories · FROZEN** |
| Fail-closed guards | `backend/tests/fixtures/multiProduct/labGuards.ts` | isolation · corpus-freeze · semantic-verified |
| Foundation tests | `backend/tests/multiProductFoundation.test.ts` | 23/23 passing |
| AllignX owner package | `docs/validation/allignx-owner-onboarding.md` | ready |
| LaunchMind owner package | `docs/validation/launchmind-owner-onboarding.md` | ready |
| Owner action summary | `docs/validation/multi-product-owner-actions.md` | ready |

**Frozen adversarial manifest:** `09df4586ab34c137…` (sha256 over ids, wording,
scope, independence keys **and expected labels** — a relaxed label breaks the
hash, which is the drift most worth catching).

**Baseline:** 1509/1510 backend tests (the 1 failure is the documented
pre-existing `content.test.ts` mock-shape defect) · `tsc` 0 errors · lint clean.

---

## Not started

1. **Canva chronological corpus** — `backend/tests/fixtures/multiProduct/canvaCorpus.ts`.
   Deliberately not begun: §10 requires actually retrieved and cited public
   sources, not model recall, and §26 forbids answering the benchmark questions
   from pretrained knowledge. Needs a session with live source fetching. Do not
   part-author it — a half-built frozen benchmark is worse than none.
2. **Live three-workspace isolation run** — the guards exist and are tested;
   the live proof (identical wording seeded into all three labs, embedded, then
   retrieved) needs the labs to exist, which needs onboarding.
3. **Stage A embedding acquisition** for the new corpora — reuse
   `backend/scripts/acquireEvalEmbeddings.ts`; add the adversarial and Canva
   query sets to `allEvaluationQueries()`.

---

## Blocked on owner

AllignX and LaunchMind canonical state must come through the real onboarding
path (no SQL, no `service_role` impersonation, no credentials requested). The
two packages above are what unblock it.

---

## Procedure after onboarding completes

1. Locate the resulting workspace + product rows by workspace name.
2. Verify canonical rows exist: `founder_context`, `business_goals`,
   `competitor_relationships`, `approval_boundary_policies`,
   `strategy_directions`, `product_claims`.
3. Verify founder attribution on every row.
4. Verify no SQL bypass — every row traceable to an onboarding session id.
5. Snapshot canonical state (hash the five authoritative tables).
6. Build the AllignX evidence corpus (public sources, cited).
7. Build the LaunchMind cold-start corpus, including the six self-marketing
   cases (A–F) already labelled in the LaunchMind package.
8. Freeze both manifests.
9. Stage A: acquire missing real Voyage vectors.
10. Run all three labs through the identical shadow pipeline.
11. `assertLabIsolation` per lab · `assertSemanticVerified` before publishing.
12. No-mutation proof over the five authoritative tables.
13. Retrieval regression: 32-query and 110-query, `semantic_verified = X/X`.
14. Cross-product comparison + active-memory growth simulation.
15. Design B evidence summary.

---

## Standing constraints

Do not begin Design B · do not enable ACTIVE learning · do not delete the 169
historical fixture rows · do not create authoritative Marketing Memory directly ·
do not request owner credentials · do not impersonate the owner with
`service_role`.
