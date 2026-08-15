# ADR-068 — Design B1: Belief Identity & Consolidation Foundation

Status: **PROPOSED — implementation deferred**
Date: 2026-08-13
Supersedes: nothing · Extends: ADR-066, ADR-067
Mode: `shadow` · Design B **not** activated · no owner data mutated

---

## 1. Problem statement

Design A admits memories one at a time. Each admitted claim is an independent row.
Design B asks whether LaunchMind needs a first-class **belief family** — a durable
identity under which many memories about the same belief accumulate — and, if so,
what that identity *is*.

B1 answers "what is a belief?". B2 answers "how does a belief evolve?".

## 2. GATE 0 — harness audit: **TRUSTWORTHY_WITH_LIMITATIONS**

Three defects were found in harnesses I wrote. Two were fixed this pass; one is
newly disclosed here and materially changes a headline number.

**(a) FIXED — claim used as its own evidence.** The Canva runner set each
candidate's `evidenceRecords.text` to the claim itself, making every claim
trivially self-supporting. `support: {SUPPORTED: 85}` was the tell, and the
deliberately fabricated `cv-203` passed Gate A. Fixed: fabricated probes now cite
the real content of their source. Post-fix: `{SUPPORTED: 75, UNSUPPORTED: 2}`.
**All evidence-support results from runs before this fix are inadmissible.**

**(b) FIXED — seeded incumbents reprocessed as candidates.** The 8 incumbents were
also fed in as candidates, producing self-matches that filled 6 of 10 sampled
REINFORCE proposals with no signal. Fixed by excluding them: 77 candidates,
REINFORCE 14 → 6. **REINFORCE population statistics before this fix are
inadmissible.**

**(c) NEWLY DISCLOSED — lenient relation acceptance.** `canvaLocalCertification.ts`
counts `KEEP_AS_EVIDENCE_ONLY` as correct for both CONTRADICTION and SUPERSEDES,
and additionally accepts `REINFORCE` for SUPERSEDES. A deferral is *safe*, but it
is not the labelled relation.

Strict recompute of the same run (deferral ≠ correct; SUPERSEDES requires
SUPERSEDE or CHALLENGE):

| case | expected | actual | lenient | strict |
|---|---|---|---|---|
| cv-077 | SUPERSEDES | CHALLENGE | ✓ | ✓ |
| cv-098 | CONTRADICTION | CHALLENGE | ✓ | ✓ |
| cv-103 | SUPERSEDES | CHALLENGE | ✓ | ✓ |
| cv-122 | REINFORCEMENT | REINFORCE | ✓ | ✓ |
| cv-100 | SUPERSEDES | REINFORCE | ✓ | ✗ |
| cv-101 | SUPERSEDES | REINFORCE | ✓ | ✗ |
| cv-038 | CONTRADICTION | CREATE_NEW | ✗ | ✗ |
| cv-129 | REINFORCEMENT | CREATE_NEW | ✗ | ✗ |

**Canva relation: 6/8 lenient · 4/8 strict.** Both should be quoted; the lenient
figure alone overstates comparator agreement with the frozen labels.

Note also that **no run has ever produced the `SUPERSEDE` outcome**, despite
`PROMOTION_OUTCOMES` containing it. Every frozen SUPERSEDES case resolves to
CHALLENGE or REINFORCE. That is a Design A observation worth carrying forward.

**Still admissible:** retrieval baseline (deterministic, no model path), fair
relation 10/10 (verified twice post-fix), degraded-retrieval drill, dedicated
evidence-support suite (12/12), public-authority suite (6/6), safety counters.

## 3. GATE 0.5 — fragmentation decomposition

Sampled CREATE_NEW population (n=10, seeded stratified sample 20260813):

| case | root cause | category |
|---|---|---|
| cv-051 Assistant tool | genuinely new fact | not fragmentation |
| cv-093 Canva Sheets | genuinely new fact | not fragmentation |
| cv-012 Zeetings acquisition | genuinely new fact | not fragmentation |
| cv-105 Cavalry/MangoAI | genuinely new fact | not fragmentation |
| cv-094 Canva Code | genuinely new fact | not fragmentation |
| cv-020 A$6B valuation 2020 | distinct dated event; correctly separate | not fragmentation |
| cv-203 fabricated CAC | harness defect, now INELIGIBLE | SEED_DATA_DEFECT (fixed) |
| cv-038 $26B mark-down | routed to model; model said UNRELATED | **A. COMPARATOR_FIXABLE** |
| cv-129 GiveDirectly +$100M | routed to model; model said UNRELATED | **A. COMPARATOR_FIXABLE** |
| cv-120 100M education users | not related to education pricing/reach members | **A/B. COMPARATOR or ENTITY_FIXABLE** |

```
COMPARATOR_FIXABLE            3 / 10 = 30%
ENTITY_RESOLUTION_FIXABLE     0 / 10 =  0%   (cv-120 shared with A)
RETRIEVAL_FIXABLE             0 / 10 =  0%   (related=8 retrieved in every case)
SCOPE_FIXABLE                 0 / 10 =  0%
POST_HOC_CONSOLIDATION        0 / 10 =  0%
NOT_FRAGMENTATION             6 / 10 = 60%
SEED_DATA_DEFECT (fixed)      1 / 10 = 10%
```

**IRREDUCIBLE_FRAGMENTATION_RATE = 0 / 10 (0%) on this sample.**

**The earlier ~40% figure does not survive decomposition.** Six of ten were
genuinely new facts; three are comparator recall; one was my own harness defect.
Nothing in this sample requires post-hoc consolidation.

### But the sample cannot answer the question

The Canva corpus is chronological public facts — funding, launches, acquisitions,
dated scalars. That distribution produces exactly what we see: mostly genuinely
new facts, with recall failures on the rest. It contains almost **no repeated
qualitative observations**, which is the case belief families exist for
("outcome-focused messaging performs better", observed five times across two
channels over six months).

So the correct reading is not "families are unjustified". It is: **the measured
fragmentation does not justify families, and the measurement was taken on a
distribution structurally incapable of demonstrating the need.**

`GATE_0_5_RESULT` = **DESIGN_B_NOT_JUSTIFIED_BY_CURRENT_EVIDENCE; MEASUREMENT ON
WRONG DISTRIBUTION**

## 4. Consequence — scope decision

1. **Fix Design A comparator recall first.** 3/10 of the sample is comparator
   under-match, and the two known cases (cv-038, cv-129) are already traced to the
   model answering UNRELATED on correctly-routed pairs. This is cheaper than any
   family architecture and reduces whatever consolidation load remains.
2. **Build the qualitative corpus before freezing family schema.** Section 4 of the
   B1 brief is the prerequisite, not a parallel task.
3. **Do not freeze family identity, membership, head content or head versioning
   yet.** Those decisions depend on a distribution we have not yet measured.

## 5. Implementation recommendation

`DEFER_IMPLEMENTATION_UNTIL_B2_FREEZE` — and, more precisely, until the
qualitative corpus exists. Committing schema now would encode a belief-identity
model justified by zero measured cases.

## 6. Unresolved questions carried forward

- Does the engine ever need to emit `SUPERSEDE`, or is CHALLENGE-plus-review the
  intended terminal behaviour for temporal replacement?
- Do repeated qualitative learnings actually fragment under the current comparator?
  **UNMEASURED.**
- Is subject identity workspace-scoped in practice, or does product scoping matter?
  Cannot be answered without the qualitative corpus.

## 7. Rejected alternatives

- **Proceed to full B1 schema now.** Rejected: no measured case requires it.
- **Use the ~40% figure as justification.** Rejected: it does not survive
  decomposition and included a defect of my own making.
- **Treat Canva as the representative workload.** Rejected: wrong distribution.

---

# AMENDMENT 1 — Pre-Design-B evidence pass (2026-08-13)

## A1.1 SUPERSEDE reachability — **SUPERSEDE_UNREACHABLE_POLICY_DEFECT**

SUPERSEDE is emitted from exactly one site (`memoryPromotionPolicy.ts:313`) and
requires four conditions simultaneously:

```
classification === 'CONTRADICTION'
&& belief.action === 'supersede'      // from BeliefPolicy.decide(), keyed on SOURCE
&& authorityPermitsOverride           // from mayAutoOverride(), keyed on TIER
&& !founderReview
```

Measured across five authority pairs — including founder-asserted contradicting a
derived inference — **every one returned CHALLENGE**, never SUPERSEDE.

Root cause: `beliefPolicy.precedenceTier()` has no case for the three source
values migration 107 introduced, so all three fall through `default`:

| source | precedenceTier | should be |
|---|---|---|
| `founder_bootstrap` | `derived_inference` | founder-level |
| `public_official` | `derived_inference` | `verified_external` |
| `public_reputable` | `derived_inference` | (arguably correct) |

`founder_bootstrap` — the governed FOUNDER_ASSERTED path added in the previous
pass — is therefore treated by pairwise belief comparison as the **weakest**
precedence tier. With incumbent and challenger both collapsing to
`derived_inference`, no precedence gap exists, `decide()` returns `challenge`, and
SUPERSEDE cannot fire.

SUPERSEDE is **not** dead code: with sources BeliefPolicy knows,
`growth_brain vs founder_feedback` → `supersede / review=false`. The outcome works;
the source vocabulary is incomplete.

**This is a defect introduced by this project's own migration 107 work** — the same
source-vs-tier trap recorded in the ADR-067 notes, reintroduced through a different
route (new `source` values rather than tier values).

**Safety impact: contained.** The authority-tier path (`mayAutoOverride`,
`requiresFounderReview`) reads tiers correctly, so contradictions still fail toward
CHALLENGE + founder review. Nothing is silently overridden. But the precedence
signal is wrong, and it explains the standing observation that no evaluated run has
ever emitted SUPERSEDE: every Canva memory is `public_official`/`public_reputable`,
which now collapse to equal precedence.

**Not fixed in this pass** — it is an engine change, and this pass is evidence-only.

## A1.2 Harness audit (partial, read-only)

Confirmed still present and load-bearing: corpus/query coverage guards,
degraded-retrieval detection, MODEL_UNAVAILABLE separation, temperature pinning
(temperature 0, `claude-haiku-4-5-20251001`), incumbent exclusion, probe evidence
de-tautologisation.

Confirmed still lenient: the Canva relation scorer (see Gate 0 above) — **6/8
lenient, 4/8 strict**. Both figures carried.

## A1.3 Qualitative corpus — **NOT BUILT**

The designated critical evidence for the Design B decision was not produced in this
pass. Consequently Gate 0.5 could not be repeated on a qualitative distribution,
`FAMILY_JUSTIFYING_CASE_COUNT` is unmeasured, and
`SUBJECT_RESOLUTION_FAILURE_RATE` is unmeasured.

**Decision gate result: `EVIDENCE_STILL_INSUFFICIENT_FOR_DESIGN_B1`.**

---

# AMENDMENT 2 — Authority / precedence remediation (2026-08-13)

## A2.1 The canonical contract — now enforced

> **SOURCE IS PROVENANCE. AUTHORITY_TIER IS AUTHORITY. PRECEDENCE IS DERIVED FROM
> AUTHORITY_TIER.** A source name must not independently establish precedence once
> a governed authority tier exists.

## A2.2 Root cause — TWO disagreeing mappings, not one gap

The audit found `beliefPolicy.precedenceTier()` and
`authorityPolicy.bootstrapTierFromSource()` were two independent source→authority
mappings that **disagreed on sources they both knew**:

| source | precedenceTier | bootstrapTierFromSource |
|---|---|---|
| `intake` | `verified_external` | `FOUNDER_CONFIRMED` |
| `review` | `verified_external` | `OBSERVED_FIRST_PARTY` |
| `founder_feedback` | `founder_confirmed` | `FOUNDER_ASSERTED` |

Neither knew the migration-107 sources, so all three fell to
`default: derived_inference`.

## A2.3 Full unification attempted, measured, and NARROWED

Deriving *all* precedence from `bootstrapTierFromSource` was implemented first.
Measured effect: `review` verified_external → observed_first_party and `intake`
verified_external → founder_confirmed — which additionally changed **decay
classification** and failed two lifecycle tests. That blast radius is real and is
not part of closing this defect.

**Shipped instead:** the eight pre-3.2A sources keep their certified precedence
verbatim; every *other* source resolves through the authority path. The silent
`derived_inference` default is gone. Full unification (and its decay implications)
is deferred to its own pass.

## A2.4 SUPERSEDE reachability — **RESOLVED**

| case | incumbent → challenger | action | review |
|---|---|---|---|
| A | derived → founder_bootstrap | **supersede** | false |
| B | derived → public_official | **supersede** | false |
| C | founder_bootstrap → derived | challenge | **true** |
| D | equal authority (both public_official) | challenge | false |
| E | public_reputable → public_official | **supersede** | false |

`SUPERSEDE_REACHABLE = true`. Founder authority is not auto-overridable (C);
equal authority invents no precedence (D).

## A2.5 Regression

Authority + safety suites **158/158**. Fair relation **10/10** semantic, all safety
counters 0. Canva **6/8 lenient / 4/8 strict — unchanged**, because every Canva
memory is `public_official`/`public_reputable` and the frozen SUPERSEDES cases are
same-tier or resolved by CHALLENGE before precedence is consulted. Backend
**1760/1761**. New drift guard: `authorityPrecedenceDrift.test.ts` (5).

---

# AMENDMENT 3 — Authority contract finalization (Codex review applied)

Codex returned `AUTHORITY_REMEDIATION_NEEDS_CHANGES`. All four findings accepted
and closed. Amendment 2's narrow fix was necessary but **not sufficient**: it
removed the silent default without removing source as a load-bearing veto.

## A3.1 Governed promotion no longer re-derives authority from source

`memoryPromotionPolicy` called `decide(classification, m.source, candidateSource)`
— source-derived precedence — alongside the tier-based override check. A source
string therefore still vetoed a governed authority decision.

New `beliefPolicy.decideWithAuthority(classification, incumbentTier, challengerTier)`
keys purely on persisted tiers. Gate B uses it when **both** sides are governed
(`!isLegacy && both tiers present`); otherwise the legacy source path is used.

## A3.2 Three tables reduced to one governed axis

| location | before | after |
|---|---|---|
| `beliefPolicy.precedenceTier` | independent source map | **LEGACY fallback only** |
| `authorityPolicy` | tier map | **canonical** (`authorityPrecedenceRank`) |
| `retrievalService.SOURCE_PRECEDENCE` | third independent table, unknown → 1.0 | renamed `LEGACY_SOURCE_PRECEDENCE`; governed rows weight on `AUTHORITY_RETRIEVAL_WEIGHT` |

`retrievalService.SOURCE_PRECEDENCE` was **authority weighting** (its own comments
said "founder-confirmed", "derived inference"). Its unknown-source default of 1.0
ranked a governed `public_official` row (VERIFIED_EXTERNAL) *below* `review` (1.05).
Legacy values are unchanged, so legacy-row retrieval behaviour is preserved exactly.

## A3.3 Lifecycle reads persisted authority

`memoryLifecycleService.loadMemory` now selects `authority_tier`, and all four
call sites use `isFounderMemory()` — persisted tier first, `precedenceTier(source)`
only when no tier exists.

## A3.4 AUTHORITY ≠ DECAY — explicitly deferred to B2

**This remediation fixes authority interpretation only.** It deliberately does NOT
settle: which founder-authored facts decay, which founder directives do not,
performance-specific decay, or stale confidence floors.

A full unification of `precedenceTier` was implemented and measured earlier: it
moved `review` and `intake` stronger and changed **decay classification**,
breaking two lifecycle tests. Decay is coupled to precedence today. The
compatibility code that remains is **not** the final decay architecture, and the
`markStale` case — a memory can be stale while founder precedence still forces
non-decaying confidence behaviour — is recorded here as an open B2 question.

## A3.5 Verification

Governed invariance (8 tests): a synthetic `future_verified_source` present in
**no** source switch behaves as VERIFIED_EXTERNAL purely because `authority_tier`
is populated; changing only the source changes nothing; founder authority is not
overridable by an unknown-source challenger; equal authority invents no precedence;
legacy null-tier paths preserved and conservative.

SUPERSEDE end-to-end through real promotion: A supersede · B supersede · C
challenge+review · D challenge+review · E supersede.

Retrieval baseline unchanged (R@5 .659 / R@10 .846 / MRR .519 / leakage 0; 3.1D
R@5 .719 / MRR .563). Fair relation 10/10, safety counters 0. Canva 6/8 lenient /
4/8 strict, unchanged. Backend 1768/1769.
