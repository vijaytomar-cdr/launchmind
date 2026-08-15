# Phase 3.2A — Engine Remediation

Date 2026-08-13 · mode `shadow` · Canva corpus hash unchanged `1abd376f…`

## Gap 1 — degraded retrieval blind-creates · CLOSED

Root cause: `comparisonUnavailable` was set only when retrieval THREW. A retrieval
that merely *degraded* returned zero rows without throwing, and Gate B read that as
"nothing related exists" → `CREATE_NEW / NO_RELATED_MEMORY`. Measured: 84 such
decisions against a corpus with no vectors.

Fix — `retrievalDegraded` + `retrievalDegradedReasons` now flow from the engine into
`decidePromotion`, and block **only the absence-based outcome**:

- zero related + degraded → `KEEP_AS_EVIDENCE_ONLY / RETRIEVAL_DEGRADED`
- all-compared-UNRELATED + degraded → same (that is also an absence conclusion)
- **presence-based outcomes are untouched** — finding a relation is positive
  evidence and stays valid on a partial search

Invariant: *retrieval failure may reduce learning velocity; it must never increase
memory fragmentation.*

Drill: `degradedRetrievalSafety.test.ts` 12/12 — modes B–G plus throw, plus a
25×replay-under-outage proving **zero** durable creations, plus a control proving
healthy retrieval still creates.

## Gap 2 — Gate A verified existence, not support · CLOSED

New `evidenceSupportPolicy.ts`, fully deterministic (no model on the hot path).
Classifies the assertion (`qualitative | quantitative_metric | comparative |
temporal_change | ranking | quoted | existence_launch`), extracts asserted
quantities (percentages, currency, ratings, multipliers, scales), and requires a
quantitative claim to *locate those quantities in its evidence* — structured fields
preferred over prose.

Verdicts: `SUPPORTED` → continue · `PARTIALLY_SUPPORTED` → evidence-only ·
`UNSUPPORTED` → reject · `UNVERIFIABLE` → reject. The decision is attached to
**every** Gate A exit path, so an adjudicator always sees whether evidence backed
the claim even when a different rule stopped it.

`gateAEvidenceSupport.test.ts` 12/12, including: fabricated CAC/conversion rejected;
official launch admitted; rating change matched from structured evidence; wrong
numbers on real evidence rejected; misattributed quote rejected; idempotent replay;
and injection text in evidence unable to grant support.

## Gap 3 — public/external provenance unrepresentable · CLOSED

Migration `20260813_000107_public_source_provenance.sql` — additive only, widens the
`source` CHECK with `public_official`, `public_reputable`, `founder_bootstrap`.
Nothing renamed, retyped or removed; no backfill required.

`authorityForCandidate` gains two cases: `public_source_official` →
**VERIFIED_EXTERNAL** (previously unreachable), `public_source_reputable` →
`DERIVED_INFERENCE`. The founder branch returns first and is gated on
`actorType === 'founder'`, so a public source can never be laundered into founder
authority. `publicSourceAuthority.test.ts` 6/6 asserts exactly that.

VERIFIED_EXTERNAL means "a high-quality external source shows this was publicly
stated" — not founder-confirmed, not measured private performance, not true forever.

## Gap 4 — founder bootstrap bypassed governance · CLOSED for future writes

New `founderBootstrapPolicy.ts`. `completePhase1()` no longer batch-INSERTs
legacy-shaped rows; it builds `FounderBootstrapCandidate`s and admits them through
`admitFounderBootstrap()`, which stamps `memory_class`, `authority_tier =
FOUNDER_ASSERTED`, both policy versions, scope, and a reconstructible `sourceRef`
to the canonical row — no NULL discriminator.

**Class mapping reviewed, not inherited.** The earlier sketch made `audience` a
DIRECTIVE because a founder said it; that conflates authority with class.

| category | class | why |
|---|---|---|
| audience | FACT | who customers ARE — contradictable by observation, not an instruction |
| context_delta | FACT | what is changing — time-bounded, correctable |
| goal | DECISION | a chosen objective with a horizon |
| competitors | FACT | externally checkable |

No category maps to DIRECTIVE: onboarding collects no rules about what LaunchMind
may *do*. Boundary policies are stored separately.

**Confidence.** The 0.80/0.85/0.90/0.95 gradient is gone. One declared constant
`UNMEASURED_FOUNDER_ASSERTION = 0.50`, deliberately **not** 1.0 — founder authority
is maximal, empirical certainty about a market belief is not what a founder
statement establishes. The real signal is `authority_tier`.

**Confirmation.** AI-prefilled but unconfirmed values are refused.
**Idempotency.** Keyed on workspace + product + category + *source row*, not wording,
so resume/refresh/replay cannot duplicate.

`founderBootstrapGovernance.test.ts` 8/8.

## Measurement gaps

**A1** `fairRelationProbe` now requires QUERY coverage as well as corpus coverage and
refuses a degraded reachability check. Verified by observing it fail closed with
`QUERY_SEMANTIC_COVERAGE_INCOMPLETE — 0/20`, then pass at 20/20.

**A2** The ambiguous criterion accepted `modelCalls > 0`, which passed while the
engine returned `CREATE_NEW` with no review. Corrected to require a genuinely safe
outcome (`KEEP_AS_EVIDENCE_ONLY`, founder review, or challenge). **The case now fails
honestly** — see the report.

## Bootstrap migration dry run — 8/8 unambiguous, NOT APPLIED

Every one of the 8 real rows maps deterministically (class, authority, source,
provenance table). No ambiguity, so nothing needed quarantine. **No migration was
applied to hosted**, per instruction.
