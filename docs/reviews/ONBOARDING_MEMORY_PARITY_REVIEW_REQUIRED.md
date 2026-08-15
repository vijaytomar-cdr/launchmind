# ONBOARDING_MEMORY_PARITY_REVIEW_REQUIRED

**Status:** OPEN — deferred to Phase 3.2 multi-product validation
**Raised:** 2026-08-12, during the onboarding confidence audit
**Do not action in the readiness/UX pass.** Recorded so it is not lost.

## Observation

Both real businesses on `vijaytomar217@gmail.com` hold **exactly 4
`marketing_memories`**, despite having very different evidence:

| | AllignX | LaunchMind |
|---|---|---|
| Maturity | `growing` (live) | `pre_launch` |
| Public evidence | `websiteMeta` (5 keys) | **none** (`preLaunch: true`) |
| `product_claims` | 9 (3 FACT, 6 INFERENCE) | **0** |
| Reviewed claims | 5 (3 confirmed, 2 corrected) | **0** |
| Competitors | 7 | 1 |
| Owner-asserted channels | 4 | none (`none_yet`) |
| `marketing_memories` | **4** | **4** |
| `evidence` rows | 0 | 0 |

Two businesses at opposite ends of the evidence spectrum produced an identical
memory count, and neither produced any `evidence` rows.

## Why it matters

This is the same shape as the defect just fixed on the completion screen:
**onboarding COMPLETION being treated as knowledge ACQUIRED.** If memories are
created because the flow finished rather than because something was observed,
then a pre-launch business with no public presence carries the same durable
memory footprint as a live product — and Marketing Memory is meant to hold
decision-bearing, attributable knowledge, not a setup receipt.

The count being *equal* is the signal. A parity of 4/4 across such different
inputs suggests a fixed set is written per completed onboarding.

## What to check (not now)

1. Which code path creates them — most likely
   `learningPipelineService.ingestLearningEvent('intake_completed')`.
2. Whether the memories are derived from actual evidence or from the fact of
   completion.
3. Whether they carry `evidence_ids`. Zero `evidence` rows exist for either
   workspace, so if the memories cite none, they are unsupported by the
   corroboration rules in ADR-066 / Phase 3.2A Gate A.
4. Whether a pre-launch business should produce durable memory at all, or only
   founder-confirmed context that later graduates through the governed shadow
   path.
5. Whether `memory_class IS NULL` (legacy discriminator) applies to them, i.e.
   whether they would even qualify as governed memory under Design A.

## Constraints when it is picked up

- `CONTINUOUS_LEARNING_INGESTION_MODE` stays `shadow`.
- Do not delete or rewrite existing memories for either business without an
  explicit decision — AllignX's canonical state is under a no-mutation rule.
- Phase 3.2A's legacy audit already concluded that pre-3.2A memory rows are
  synthetic bootstrap rather than durable memory; these 8 rows may fall into the
  same category and should be classified, not silently upgraded.
