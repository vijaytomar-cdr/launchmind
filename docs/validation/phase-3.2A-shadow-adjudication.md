# Phase 3.2A — Shadow Adjudication Dataset

Run 2026-08-13 · corpus hash `1abd376f…` · mode `shadow`

Uncertain cases are **not** adjudicated as correct. Every row carries a defect class.

## Gate A — Canva (85 candidates, frozen labels)

| id | expected | actual | verdict | class |
|---|---|---|---|---|
| cv-001 … cv-130 (81 events) | ELIGIBLE | ELIGIBLE | correct | — |
| cv-202 instruction-shaped | INELIGIBLE / INSTRUCTION_SHAPED | INELIGIBLE / INSTRUCTION_SHAPED | correct | — |
| cv-200 "Canva is good." | INELIGIBLE / CLAIM_TOO_SHORT | ELIGIBLE | incorrect | LABEL_DEFECT — my expectation was stricter than `MIN_CLAIM_LENGTH` |
| cv-201 unfalsifiable narrative | INELIGIBLE / NOT_DECISION_BEARING | ELIGIBLE | incorrect | LABEL_DEFECT — the C1 admission test is narrower than I assumed |
| cv-203 fabricated CAC + conversion | INELIGIBLE / UNSUPPORTED_AI_INFERENCE | ELIGIBLE | **incorrect** | **POLICY_DEFECT** |

**Gate A accuracy vs frozen labels: 82/85 (96.5%).**

`cv-203` is the one that matters. A claim asserting a fabricated internal CAC and blended conversion rate
passed because an evidence row backed it. Gate A validates that evidence *exists*, not that the evidence
*supports the number*. A hostile or careless ingestion source can therefore introduce invented private
metrics. Nothing downstream re-checks this.

## Gate B — Canva

| outcome | n | reason |
|---|---|---|
| CREATE_NEW | 84 | NO_RELATED_MEMORY |
| NO_DECISION | 1 | short-circuited at Gate A |

`requiresFounderReview = 0`, `relatedRetrieved = 0`, `beliefAction` never set, `scopeRelation` never set.

**Class: ENGINE_DEFECT + harness limitation.** Shadow never promotes, so nothing accumulates to compare
against. Gate B therefore had no incumbents and created blind for all 84.

## Relation probe (8 frozen pairs, lab incumbents seeded)

| id | expected | outcome | belief | related | verdict | class |
|---|---|---|---|---|---|---|
| cv-038 | CONTRADICTION | CREATE_NEW | none | 0 | needs-review | RETRIEVAL_DEFECT |
| cv-077 | SUPERSEDES | CREATE_NEW | none | 0 | needs-review | RETRIEVAL_DEFECT |
| cv-098 | CONTRADICTION | CREATE_NEW | none | 0 | needs-review | RETRIEVAL_DEFECT |
| cv-100 | SUPERSEDES | REINFORCE | reinforce | 1 | **incorrect** | UNKNOWN — see below |
| cv-101 | SUPERSEDES | CREATE_NEW | none | 0 | needs-review | RETRIEVAL_DEFECT |
| cv-103 | SUPERSEDES | CREATE_NEW | none | 0 | needs-review | RETRIEVAL_DEFECT |
| cv-122 | REINFORCEMENT | CREATE_NEW | none | 0 | needs-review | RETRIEVAL_DEFECT |
| cv-129 | REINFORCEMENT | CREATE_NEW | none | 0 | needs-review | RETRIEVAL_DEFECT |

**Relation accuracy 0/8 — NOT a valid engine score.** All 8 ran with `retrievalDegraded = true`, and the
incumbents were inserted in the same run so their embeddings were still queued. Seven retrieved nothing at
all. Marked `needs-review`, not `incorrect`, because the probe did not fairly reach the comparator.

`cv-100` is the single case that reached comparison: "260 million MAU (Dec 2025)" against the incumbent
"230 million MAU (Apr 2025)" produced **REINFORCE**. Expected SUPERSEDES — a later, larger measurement of the
same metric replaces the earlier one rather than corroborating it. One observation is not enough to call this
an engine defect, so it is classed UNKNOWN and flagged for a fair re-run.

## Owner arms (ALLIGNX, LAUNCHMIND — 2 candidates each)

| candidate | expected | actual | verdict |
|---|---|---|---|
| founder audience directive | admitted with founder authority | EVIDENCE_ONLY / RAW_PROVIDER_PROSE | correct — free-text prose is not rule-generated |
| derived public challenger | refused | INELIGIBLE / NO_EVIDENCE | correct — founder authority never at risk |

## Defect register

| class | count | items |
|---|---|---|
| POLICY_DEFECT | 1 | cv-203 fabricated private metrics admitted |
| ENGINE_DEFECT | 1 | Gate B creates blind under degraded retrieval (`marketingMemoryEngine.ts:345`) |
| RETRIEVAL_DEFECT | 7 | relation probe retrieved nothing |
| LABEL_DEFECT | 2 | cv-200, cv-201 expectations stricter than policy |
| SEED_DATA_DEFECT | 1 | corpus v1 used non-existent scope dimensions |
| SCHEMA_LIMITATION | 1 | `marketing_memories.source` has no public-external value |
| UNKNOWN | 1 | cv-100 REINFORCE vs expected SUPERSEDES |

---

# FINAL ADJUDICATION — certified 85-event run (2026-08-13)

Engine frozen: comparator `6c96ab7c866a0251` · promotion/eligibility/authority/comparison all v1 ·
`claude-haiku-4-5-20251001` @ temperature 0 · corpus `1abd376f…` · mode `shadow`.
Run admissible: corpus 8/8, query **85/85**, **85/85 non-degraded**.

Sample: seeded (20260813), 25 proposals, ids persisted before adjudication.
Population: CREATE_NEW 65 · REINFORCE 14 · CHALLENGE 4 · CREATE_SCOPED_EXCEPTION 1 · NO_DECISION 1.

## High-risk (100% reviewed)

| id | outcome | incumbent | verdict |
|---|---|---|---|
| cv-077 | CHALLENGE | Teams per-seat $100/user/yr | CORRECT (pricing supersession → founder review) |
| cv-098 | CHALLENGE | Affinity one-time-purchase | CORRECT |
| cv-103 | CHALLENGE | 230M MAU (Apr 2025) | CORRECT (later measurement of same metric) |
| cv-099 | CREATE_SCOPED_EXCEPTION | Affinity one-time-purchase | CORRECT (narrower: free w/ AI gated) |
| **cv-011** | **CHALLENGE** | US$200M @ US$40B (Sept 2021) | **INCORRECT_FALSE_CONTRADICTION** |

**cv-011 is a confirmed unsafe positive transition.** "A$40M at A$1B valuation" (2018) and
"US$200M at US$40B valuation" (2021) are two different funding rounds. Both are historically
true; company growth is not a contradiction. It requires founder review, so it cannot
auto-mutate — but it is a false contradiction and §14 admits none.

## Two harness defects that limit this run

**SEED_DATA_DEFECT — evidence support was not exercised.** The runner sets each candidate's
evidence text to the claim itself, so every claim trivially supports itself. `support:
{"SUPPORTED": 85}` is the tell, and `cv-203` (fabricated CAC/conversion) passed Gate A here.
The dedicated suite (`gateAEvidenceSupport.test.ts`, 12/12) does prove rejection properly; this
RUN does not.

**SEED_DATA_DEFECT — REINFORCE sample contaminated.** 6 of 10 sampled REINFORCE proposals
(cv-033, cv-100, cv-080, cv-091, cv-035, cv-032) target *themselves*: the 8 seeded incumbents
are re-processed as candidates. Correct idempotent behaviour, but no adjudication signal.
Genuine cases: cv-122→cv-032 CORRECT; cv-101→cv-080 and cv-079→cv-035 safe-but-imprecise
(reinforce where supersede fits); cv-121→cv-032 over-match (reach vs pricing), safe.

## CREATE_NEW under-match (10 sampled)

Genuinely new: cv-051, cv-093, cv-012, cv-105, cv-094 (5).
Under-matches: cv-129, cv-038 (known model under-matches), cv-120, cv-020 (4).
Seed defect: cv-203.
**Under-match rate ≈ 40% of sampled CREATE_NEW.**

## MODEL_UNDERMATCH_REMAINS

cv-038 · cv-129 — routed correctly to the comparator; the model answers UNRELATED. Not hidden,
not fixed, carried forward.
