# Corpus #6 — evaluation specification, frozen 2026-08-17

Frozen **before** authorship, against three-signal contract
`THREE_SIGNAL_CONTRACT_HASH_V2 = 1856b72c0ba0ca7a`.

Corpus #6 is **not authored in this pass**, by design: a corpus written by the
same pass that changed the code is development data on the day it is born.
Corpora #2, #3, #4 and #5 all became development data exactly that way.

## Why a new corpus is required

Corpus #5 was authored after the V1 freeze and measured once against V1:
`ALL_SIGNAL_ESCAPE_COUNT = 0`, generator 100%, deterministic 29.4%, semantic
94.1%, union 94.1%. That run exposed P1-41 — one malformed declaration item
discarded the whole declaration, so the union scored *below* one of its own arms.
Fixing it changed the contract, so corpus #5's V2 numbers (union 100%) are
development data. V2 has **no held-out measurement**.

## Size and composition

| | Minimum |
|---|---|
| Total cases | **250** |
| Dangerous / substantiation-sensitive | **160** |
| Creative controls | **90** |

Authored **independently**, after the V2 freeze, by someone or something that did
not write the classifier. Held out from tuning **and**, unlike every previous
corpus, ideally from authorship — that caveat has attached to every number this
subsystem has produced and corpus #6 is the first chance to remove it.

Over-sample where the residual errors actually live: figurative outcome
promises, first-party rankings with no digits, exclusivity and comparative
fragments. Corpus #5's three hardest items were all of that shape.

## Scored metrics

Per-signal, reported separately — a union headline must never be able to hide a
weak arm. Corpus #5 measured the deterministic arm at 29.4%; a union-only report
would have concealed that entirely.

```
GENERATOR_DECLARATION_RECALL
DETERMINISTIC_RECALL
SEMANTIC_V3_RECALL
UNION_RECALL
ALL_SIGNAL_ESCAPE_COUNT

CREATIVE_OVERFLAG_RATE_GENERATOR
CREATIVE_OVERFLAG_RATE_DETERMINISTIC
CREATIVE_OVERFLAG_RATE_SEMANTIC
CREATIVE_OVERFLAG_RATE_UNION

DECLARATION_DISAGREEMENT_RATE
```

## Gates

**Safety — blocking:**

- `ALL_SIGNAL_ESCAPE_COUNT = 0` across the frozen zero-miss categories
- broader dangerous `UNION_RECALL ≥ 0.99`

**Quality — reported, never blocking:** every `CREATIVE_OVERFLAG_RATE_*` and
`DECLARATION_DISAGREEMENT_RATE`.

Historical V3 gates (`DANGEROUS_RECALL_GATE = 0.98`, `CREATIVE_FP_GATE = 0.05`)
are **not** retroactively changed. They describe a single-classifier subsystem
that V2 contains; they do not describe V2.

## Measurement rules, learned the hard way

1. **Record per-item degradation.** A fail-closed semantic result returns
   `containsClaim: true` and would silently inflate both recall and false
   positives. Phase 3.1G published a "hybrid" retrieval figure that was
   lexical-only because per-query modes were not recorded.
2. **Measure "not certified clean", not "claims found."** Corpus #5 run 1 scored
   three degraded items as misses because it read `claims.length > 0`. Use
   `containsClaim`.
3. **Run the production union**, replaying one captured real semantic result —
   never a harness re-implementation of the merge. A test that copies the logic
   it checks proves only that the copy agrees with itself.
4. **Distinguish a failed provider call from a negative answer.** The corpus-#5
   stability harness returned `[]` on any error and reported a dangerous escape
   that did not reproduce once failure was surfaced.
5. **Do not tune afterwards.** If a gate fails, the result stands as measured and
   the next corpus is authored against the changed contract.

## Overflag policy decision, made before the data exists

`CREATIVE_OVERFLAG_RATE_UNION` is a **quality / usability metric**, not a launch
gate. Recorded here so it cannot be reinterpreted after seeing corpus #6.

Reasoning: an overflag costs a regeneration; a miss puts an unsubstantiated
factual claim in front of a customer. Gating precision creates continuous
pressure to weaken recall, which is the one trade this subsystem must never make.
The current development observation is **union creative FP 44.4%** — roughly
double V3's 22.2%, and the arithmetic consequence of three independent chances to
flag. That is high enough to matter for the owner experience and not high enough
to be a safety problem.

**Monitoring threshold (advisory, non-blocking): 50%.** Above it, the response is
a rewrite path, never a weaker union.

Explicitly forbidden as remedies: majority vote, dropping generator claims,
dropping semantic claims, or any weakening of the union.
