# ADR-067 — Marketing Memory Promotion, Authority, Scope & Shadow Architecture

**Status:** Accepted (Design A) · **Date:** 2026-08-10
**Supersedes nothing.** Extends ADR-066 (Continuous Learning & Memory Architecture).
**Posture:** `CONTINUOUS_LEARNING_INGESTION_MODE=shadow`. Nothing in this ADR activates learning.

> Design A closes the foundational decisions required to build the first safe
> SHADOW Marketing Memory Engine. Every CLOSED decision below is a read-only
> constraint for Designs B and C unless implementation or shadow measurement
> produces a contradiction, in which case this ADR must be amended explicitly.

---

## Context

Phase 3.1 built the memory substrate: a 7-state lifecycle, a transactional
transition RPC, a pure belief policy, a hybrid retriever, an embedding outbox, and
a comparison layer whose reinforcement boundary was hardened in Amendment 5.

The Phase 3.2 Pre-Design inspection then established that **the substrate has
never run**. The hosted corpus is 33 uniform synthetic rows: all `active`, all
`version: 1`, **zero evidence**, zero versions, zero challenges, zero
reinforcements, and `content` holding only `{note, slug, synthetic}`.

Three consequences shape this ADR:

1. There is **no production behaviour to generalise from**. Every threshold here
   is a starting hypothesis to be measured in shadow, not a tuned value.
2. There is **no legacy usage to preserve**. Design A can close schema primitives
   (scope, authority) cleanly because nothing depends on their absence.
3. The corpus is **not evidence that the design works**. It is evidence that the
   design is untested.

---

# CLOSED DECISIONS

Each records: decision · rejected alternatives · rationale · invariant ·
enforcement · owning component · tests eventually required.

---

## C1 — Marketing Memory definition

**Decision.** Marketing Memory is:

> A **durable, workspace-scoped, explicitly-scoped marketing claim** that is
> either **founder-authored** or **backed by independent evidence**, that
> **generalises beyond the single observation that produced it**, and that
> **would change a future marketing decision**.

Four admission tests, all required:

| Test | Question | Fails when |
|---|---|---|
| **Durability** | Is it expected to remain useful beyond its immediate context? | it has a horizon ("not this month") |
| **Generality** | Does it say something beyond the one observation? | it restates a single metric reading |
| **Decision-bearing** | Would a plausible future decision differ if LaunchMind knew this? | it is trivia |
| **Attributable** | Is provenance, authority and scope explicit? | scope or source is unknown |

**Rejected:** the proposed "durable, evidence-backed or founder-confirmed piece of
marketing knowledge expected to improve future marketing decisions". Rejected as
**too permissive** — "expected to improve decisions" admits every campaign metric
and provider insight, which turns the corpus into an event warehouse. Generality
and decision-bearing are the tests that actually exclude things.

**What Marketing Memory is NOT:**

| Not this | Because | Lives in |
|---|---|---|
| observation / intelligence_signal | single reading, no generality | `intelligence_signals` |
| connection_insight | a derived finding, not yet a belief; the *input* to a candidate | `connection_insights` |
| evidence | supports a claim; is not itself a claim | `evidence` |
| learning_event | an audit record of ingestion | `learning_events` |
| founder_context / business_goal / strategy_direction | authoritative **current state** (see C2) | own tables |
| campaign metric | measurement, not claim | `campaign_metrics` |
| operational state | configuration | domain tables |
| provider response | third-party text | `connection_insights.detail` |
| AI answer | generated, not remembered | `ai_requests` |
| recommendation | a proposed action, not knowledge | `saved_opportunities` |
| temporary plan | fails Durability | `strategy_directions` |

**Invariant I1.** Nothing becomes durable Marketing Memory without passing all
four admission tests, evaluated deterministically at Gate A.

**Enforcement:** `CandidateEligibilityPolicy` (Gate A). **Owner:** same.
**Tests:** one rejection test per admission test; a corpus-shape test asserting no
memory exists whose claim is a bare metric reading.

---

## C2 — Marketing Memory is not the domain system of record

**Decision.** Marketing Memory **references** authoritative domain state; it never
mirrors it. A memory about domain state is a **historical statement about an
event**, not a live copy of a value.

- Domain record: `products.confirmed_icp = "independent home-service providers"` — authoritative, current, mutable.
- Memory: *"Founder confirmed independent home-service providers as the ICP during onboarding on 2026-03-12."* — durable, historical, immutable in meaning.

**Canonical linkage.** Every memory derived from domain state carries a
`domain_ref`: `{ table, row_id, column?, observed_value_hash, observed_at }`.

- `observed_value_hash` records **what the domain value was when the memory was
  made**, so drift is detectable without the memory pretending to be current.
- Retrieval may surface "this memory references ICP, which has since changed"
  without the memory being wrong — it was true when asserted.

**Rejected:** (a) copying current values into memory — creates two sources of
truth with no synchronisation, and the domain tables have update paths that would
never fire memory transitions; (b) memory owning current state — would require
migrating six domain tables and contradicts the DECIDED framing.

**Invariant I2.** A memory must never be read as the current value of a domain
field. Where a memory carries `domain_ref`, the authoritative current value is the
domain record.

**Enforcement:** `domain_ref` is nullable but, when present, immutable after
creation. **Owner:** `MemoryLifecycleService`.
**Tests:** a memory whose `domain_ref` target has changed still returns its
original claim; no read path substitutes the live domain value.

---

## C3 — Minimal taxonomy: four behavioural classes

**Decision.** Introduce **one** new governed axis, `memory_class`, with **four**
values. A class exists only if it has **genuinely different lifecycle behaviour**.

| `memory_class` | Meaning | Decays? | Auto-supersedable? | Scoped exceptions? | Expires? |
|---|---|---|---|---|---|
| `DIRECTIVE` | what LaunchMind may / must / must not do | **no** | **no** — founder only | no | no |
| `FACT` | a state of the world that is true or false | no | yes, by a newer fact | no | via validity window |
| `LEARNING` | a causal or comparative claim from evidence | **yes** | yes | **yes** | no |
| `DECISION` | a choice made with a stated horizon | no | yes | no | **yes, at horizon** |

Mapping the semantics the brief required:

| Concept | Representation |
|---|---|
| founder truth | `FACT` + authority `FOUNDER_ASSERTED` |
| founder preference | `DIRECTIVE` |
| founder constraint | `DIRECTIVE` |
| stable business fact | `FACT` + authority `OBSERVED_FIRST_PARTY` |
| learned / model belief | `LEARNING` + authority `DERIVED_INFERENCE` |
| performance learning | `LEARNING` + authority `OBSERVED_FIRST_PARTY` |
| experiment learning | `LEARNING` + authority `EXPERIMENT_CONTROLLED` |
| **negative learning** | **not a class** — a polarity of the claim text within `LEARNING` |
| strategic decision | `DECISION` |
| **temporary decision** | **not memory** — fails Durability (C1); stays in domain state |

**Rejected:** (a) a 7–10 value class list separating founder-fact from
business-fact and performance from experiment — those differences are
**authority**, not class, and duplicating them across two axes guarantees they
drift; (b) reusing `memory_type` as the semantic axis — it conflates subject
(`brand`, `customer`, `market`) with provenance (`founder`, `review`,
`experiment`), and provenance is already `source`.

**`memory_type` disposition.** Frozen, retained, additive-only. It becomes a
**subject tag** for filtering and UX. It is no longer a semantic or policy input.
No value is removed (additive-migrations rule).

**Invariant I3.** Policy decisions key off `memory_class` and `authority_tier`.
No policy may branch on `memory_type`.

**Enforcement:** CHECK constraint on `memory_class`; structural test greps policy
modules for `memory_type`. **Owner:** `beliefPolicy`, `MemoryPromotionPolicy`.
**Tests:** one lifecycle-behaviour test per class (DIRECTIVE does not decay;
DECISION expires; LEARNING admits an exception; FACT supersedes by validity).

---

## C4 — Persisted, versioned authority

**Decision.** Authority becomes an **explicit, persisted, versioned** value,
separate from `source`. Six tiers, ordered strongest to weakest:

| Tier | Meaning | New? |
|---|---|---|
| `FOUNDER_ASSERTED` | the founder stated it unprompted | — |
| `FOUNDER_CONFIRMED` | the founder approved something LaunchMind proposed | — |
| `EXPERIMENT_CONTROLLED` | a designed test with a control | **new** |
| `OBSERVED_FIRST_PARTY` | measured outcome from a connected provider | — |
| `DERIVED_INFERENCE` | model- or rule-derived without direct outcome evidence | — |
| `ANONYMIZED_PLAYBOOK` | cross-founder generalisation | — |

`VERIFIED_EXTERNAL` from ADR-066 is **retained as RESERVED** — no producer exists
and "verified" has no verification mechanism. Retained rather than removed to
avoid a breaking taxonomy change on a value already in code.

**`EXPERIMENT_CONTROLLED` is the one addition**, and it earns its place by
changing behaviour: today an experiment and a passive observation map to the same
tier, so a controlled result cannot supersede a casual one. That is wrong, and
only a new tier fixes it.

**`FOUNDER_ASSERTED` vs `FOUNDER_CONFIRMED`** are both defined now but currently
behave **identically** in policy (both block automatic supersession). The
distinction is persisted because it cannot be reconstructed later; whether it
should diverge behaviourally is **OPEN for Design B**.

**Where authority lives — four layers, deliberately:**

| Layer | Field | Semantics | Mutability |
|---|---|---|---|
| evidence | `evidence.authority_tier` | what this observation is worth | immutable |
| memory | `marketing_memories.authority_tier` | the **strongest** tier among supporting evidence — the memory's standing | recomputed on evidence change |
| transition | version row: `authority_tier` + `authority_policy_version` | **what was in force when the decision was made** | **immutable** |
| shadow proposal | `authority_tier` + `authority_policy_version` | what would have been used | immutable |

The distinction that matters: **evidence authority is a property of an
observation; memory authority is a derived summary; transition authority is a
historical fact.** Only the third makes past decisions explicable.

**Rejected:** deriving authority from `source` at read time (status quo) — a later
edit to `precedenceTier()` silently reinterprets every historical decision, which
Pre-Design confirmed is possible today.

**Invariant I4.** Every authoritative transition permanently records the authority
tier **and** the authority policy version under which it was decided. Historical
authority is never re-derived.

**Enforcement:** NOT NULL on the version row; `precedenceTier()` retained only as
the **bootstrap mapping** for rows predating the column, never for new decisions.
**Owner:** `authorityPolicy` (new, pure). **Tests:** changing the source→tier
mapping does not alter any historical transition's recorded tier.

---

## C5 — Two-stage promotion

**Decision.** Two gates with different questions, different costs, and different
information available.

### Gate A — `CandidateEligibilityPolicy`

Runs **before** retrieval, comparison, or any model call. Deterministic, pure,
zero I/O beyond the canonical record it validates against.

> *"Is this candidate safe and meaningful enough to be considered at all?"*

| Check | Rejects when |
|---|---|
| tenancy | workspace not resolvable **from the canonical record** (never from payload) |
| provenance | `{kind, sourceId}` missing or unresolvable |
| evidence validity | no evidence row, or evidence `status != valid` |
| source eligibility | source not in the permitted set for the target class |
| idempotency | idempotency key not computable |
| **scope completeness** | scope not `explicit` or `partial` (C10) |
| minimum sample | below the per-rule sample floor |
| PII | claim text matches PII patterns |
| instruction-shaped | claim contains directive/override markers |
| raw provider prose | claim is not template- or rule-generated |
| operational/temporary | claim has a horizon → fails Durability |
| generality | claim restates a single reading → fails Generality |
| decision-bearing | claim would change no decision |

Outcomes: `ELIGIBLE` · `REJECTED(reason_code)` · `EVIDENCE_ONLY`.

Failure means **evidence remains evidence**: no durable-memory decision, no
retrieval, no model call. Gate A is the cost boundary as much as the safety one.

### Gate B — `MemoryPromotionPolicy`

Runs **after** bounded retrieval and comparison.

> *"Given what LaunchMind already believes, what should happen to the corpus?"*

Canonical outcome set — **seven**:

| Outcome | When |
|---|---|
| `CREATE_NEW` | no related memory in the bounded set |
| `REINFORCE` | duplicate or agreeing claim from an **independent** evidence source |
| `SUPERSEDE` | contradiction the policy permits to resolve automatically |
| `CHALLENGE` | contradiction requiring founder review, or against founder authority |
| `CREATE_SCOPED_EXCEPTION` | opposing claim, but strictly narrower scope (C13) |
| `NO_OP` | duplicate from the **same** evidence (replay) — nothing learned |
| `KEEP_AS_EVIDENCE_ONLY` | related but not promotable; evidence attaches, no memory changes |

**Why the proposed list was changed.** `DUPLICATE_NO_OP` conflated two different
things: an *independent* corroboration (which should `REINFORCE` — that is how
confidence is earned) and a *replayed* observation (which must change nothing).
Independence is decidable from `evidence.independence_key`, so the two are split.
`SUPERSEDE` was missing from the proposed set even though `BeliefPolicy` can
already return it; omitting it would have made Gate B unable to express a decision
the layer beneath it produces.

**Why Gate B cannot be decided before comparison.** Three of the seven outcomes —
`CREATE_NEW`, `CREATE_SCOPED_EXCEPTION`, `NO_OP` — are statements about the
**absence, partial overlap, or replay** of related memories. None is knowable from
the candidate alone. `CREATE_NEW` in particular is an assertion that *nothing
related exists*, which is only meaningful relative to a retrieval that ran.

### Who decides what

| Component | Scope of decision | Produces |
|---|---|---|
| `ClaimComparison` | one candidate vs **one** memory | classification + ambiguity |
| `BeliefPolicy.decide()` | one **pair** | permitted transition + review flag |
| `MemoryPromotionPolicy` | the candidate vs the **whole bounded set** | one Gate B outcome |

**This is why `MemoryPromotionPolicy` is genuinely distinct from `BeliefPolicy`,
and not a rename.** `decide()`'s signature is
`(classification, incumbentSource, challengerSource)` — it is pairwise by
construction and structurally cannot express `CREATE_NEW` (no incumbent exists) or
`CREATE_SCOPED_EXCEPTION` (both records survive). Widening `decide()` to take a
set would destroy the property that makes it trustworthy: that it is a small pure
function over a fixed tuple.

**Invariant I5.** No model call and no retrieval occurs for a candidate that has
not passed Gate A. Gate B never runs without a completed comparison over a bounded
set.

**Enforcement:** `MarketingMemoryEngine` call order; structural test.
**Owner:** `CandidateEligibilityPolicy`, `MemoryPromotionPolicy`.
**Tests:** every Gate A rejection reason has a case; every Gate B outcome has a
case; a Gate-A-rejected candidate provably issues zero model calls.

---

## C6 — New-memory creation: corroboration before belief

**Decision.** Entry state depends on **authority**, not on class:

| Authority of the candidate | Entry state | Rationale |
|---|---|---|
| `FOUNDER_ASSERTED`, `FOUNDER_CONFIRMED` | **`active`** | the founder is the authority; requiring corroboration of a founder statement is incoherent |
| `EXPERIMENT_CONTROLLED` | **`active`** | a designed test with a control is already corroboration |
| `OBSERVED_FIRST_PARTY`, `DERIVED_INFERENCE`, `ANONYMIZED_PLAYBOOK` | **`draft`** | promoted to `active` only on a **second independent** evidence source (a distinct `independence_key`) or founder confirmation |

**This is the single most important safety rule in Design A.** One provider
reading becoming a durable belief is precisely how a corpus fills with noise.
Requiring a second *independent* observation is cheap, deterministic, and directly
uses `evidence.independence_key`, which already exists.

**Draft is not retrievable** (`RETRIEVABLE_STATES = ['active']`), so a draft costs
nothing until corroborated. Draft memories are the natural queue for founder
confirmation.

**Model participation.** A model MAY propose canonical wording for a claim. A
model MAY NOT create memory, set authority, set scope, or decide an outcome. Model
wording is subject to the same Gate A checks as any other text, and the resulting
memory records `wording_model_request_id` so authorship is auditable.

**Rejected:** (a) everything enters `draft` — automatic learning would then produce
nothing usable without a second promotion mechanism, and founder statements would
sit unreadable; (b) everything enters `active` — single-observation noise becomes
belief immediately.

**Invariant I6.** A `LEARNING` memory from a single evidence source never reaches
`active` automatically.

**Enforcement:** `MemoryPromotionPolicy` computes entry state; the lifecycle RPC
rejects an `active` creation whose authority tier and evidence independence do not
justify it. **Owner:** `MemoryPromotionPolicy`.
**Tests:** two observations sharing an `independence_key` leave the memory in
`draft`; two with distinct keys promote it.

---

## C7 — Cold start comes from founder authority, not relaxed thresholds

**Decision.** The bootstrap corpus is built from **founder-authored onboarding
output**, which is already the strongest authority tier. No eligibility, authority,
scope, or security threshold is relaxed for corpus maturity.

| Onboarding artifact | Domain owner | Becomes memory? | Class | Authority |
|---|---|---|---|---|
| product identity | `products` | **no** — reference | — | — |
| geography / markets | `products.markets` | **no** — reference | — | — |
| business goal | `business_goals` | **no** — has a horizon | — | — |
| strategy direction | `strategy_directions` | **no** — temporary plan | — | — |
| **ICP** | `products.confirmed_icp` | **yes**, with `domain_ref` | `FACT` | `FOUNDER_CONFIRMED` |
| **positioning / confirmed claims** | `product_claims` (kind `FACT`) | **yes** | `FACT` | `FOUNDER_CONFIRMED` |
| product_claims kind `INFERENCE` | `product_claims` | **no** — unconfirmed | — | — |
| **founder preference** | `founder_context.working_style` | **yes** | `DIRECTIVE` | `FOUNDER_ASSERTED` |
| **founder constraint / boundaries** | `approval_boundary_policies` | **yes**, with `domain_ref` | `DIRECTIVE` | `FOUNDER_ASSERTED` |
| **Context Delta** | `founder_context.context_delta` | **yes** | `FACT` or `LEARNING` | `FOUNDER_ASSERTED` |
| competitor identity | `competitor_relationships` | **no** — reference | — | — |
| competitor differentiator claim | `competitor_relationships.key_differentiator` | **yes** | `FACT` | `FOUNDER_CONFIRMED` |

Bootstrap memories are created through the **same** pipeline (Gate A → Gate B →
lifecycle), with `provenance.kind = 'onboarding'` and `domain_ref` set. They are
not bulk-inserted.

**Adaptive thresholds: REJECTED.** The cold-start problem is solved by the founder
being an authority, not by trusting weak inference more when the corpus is small.
A maturity-scaled threshold is exactly the mechanism that would fill an empty
corpus with unreviewed inference — the failure it purports to avoid.

**Invariant I7.** No eligibility, authority, or scope rule varies with corpus size.

**Enforcement:** no maturity parameter exists in any policy signature; structural
test. **Owner:** `CandidateEligibilityPolicy`.
**Tests:** identical candidate produces an identical decision against a 0-memory
and a 10,000-memory corpus.

---

## C8 — Founder input: durability decides the destination

**Decision.** Founder input is routed by the **Durability** test, not by phrasing.

| Utterance | Durable? | Destination | Class / authority |
|---|---|---|---|
| *"I don't want to run Meta this month."* | **no** — horizon | domain state (campaign/plan constraint) | not memory |
| *"Never use discount-led messaging."* | **yes** | Marketing Memory | `DIRECTIVE` / `FOUNDER_ASSERTED` |
| *"Meta repeatedly generated low-quality customers."* | **yes** | Marketing Memory | `LEARNING` / `FOUNDER_ASSERTED` |

The third is the subtle one: it is a founder-authored **LEARNING**, not a
DIRECTIVE. It carries founder authority (so it cannot be silently overridden) but
it is an empirical claim, so it **may be challenged by data** and admits scoped
exceptions. A DIRECTIVE cannot be challenged by data at all — only the founder can
change it.

Semantics:

| Concept | Definition |
|---|---|
| founder assertion | unprompted statement → `FOUNDER_ASSERTED` |
| founder confirmation | approval of a LaunchMind proposal → `FOUNDER_CONFIRMED` |
| founder correction | supersession of an existing memory by founder action → new version, actor `founder` |
| "remember this" | explicit creation request → Gate A still applies (PII, injection) |
| temporary preference | horizon present → domain state |

**Invariant I8.** Founder-authored memory is never superseded by a lower authority
tier without `requires_founder_review = true` (inherited from ADR-066 §17).

**Enforcement:** `authorityPolicy.mayAutoOverride`. **Owner:** same.
**Tests:** each of the three example utterances routes to its stated destination.

---

## C9 — Confidence stored; importance and quality derived

**Decision.**

| Score | Definition | Storage |
|---|---|---|
| **Confidence** | strength of support for the claim being true | **stored + versioned** (exists) |
| **Importance** | expected usefulness for future decisions | **derived**, not stored |
| **Quality** | completeness and trustworthiness of provenance and evidence | **derived**, not stored |

**Implementation: deterministic TypeScript policy modules** (`importancePolicy.ts`,
`qualityPolicy.ts`) — pure functions over an explicit input struct, with a
`POLICY_VERSION` constant.

**Rejected:** (a) SQL function or view — the inputs span `context_package_items`,
`memory_challenges` and `evidence`, and a view would either be expensive or drift
from the TS policy that consumes it; (b) stored columns — they require invalidation
on every evidence, retrieval and challenge change, which is a cache-coherence
problem in exchange for speed nobody has shown is needed (measured exact vector
scan is 4–5 ms at 25,000 vectors). Materialise only if profiling justifies it.

**Importance inputs:** `memory_class` (DIRECTIVE ranks highest — it gates
behaviour) · authority tier · retrieval-use frequency from `context_package_items`
· `reinforcement_count` · recency vs `decay_class` · scope breadth · linkage to an
active `business_goal`.

**Quality inputs:** evidence count · **evidence independence** (distinct
`independence_key` count) · authority tier · provenance completeness ·
`scope_completeness` · challenge survival history · `content_hash` stability
across versions.

Both are computable from data that exists today.

**Invariant I9.** Importance and quality never gate a **lifecycle** transition.
They influence retrieval eligibility and ranking only (C-DECIDED: eligibility is
derived, not a lifecycle state).

**Enforcement:** neither module is importable by `beliefPolicy` or
`MemoryLifecycleService`; structural test. **Owner:** the two policy modules.
**Tests:** each declared input moves the score in the declared direction and only
that direction (property tests, as ADR-066 rule 30 requires for confidence).

---

## C10 — Governed scope: one normalized JSONB + a derived key

**Decision.** Scope becomes a **first-class schema primitive**: one governed JSONB
column plus a derived canonical key.

```
scope              JSONB   NOT NULL          -- governed dimensions, normalized
scope_key          TEXT    GENERATED         -- canonical serialization, for equality/dedup
scope_completeness TEXT    NOT NULL          -- 'explicit' | 'partial' | 'unknown'
scope_specificity  INTEGER GENERATED         -- count of BOUND dimensions
```

**Governed dimensions for 3.2A** (closed set):
`product` · `channel` · `audience_segment` · `geography` · `funnel_stage` ·
`timeframe`. Workspace is the `workspace_id` column, never a scope key.

**Deferred to Design B:** `campaign`, `creative/message`, `competitor`. These are
**entity references**, not scope facets — a claim is not scoped *to* a campaign,
it is *evidenced by* one. They belong on the evidence link.

**Three-state semantics per dimension** — the distinction that makes contradiction
safe:

| State | Encoding | Meaning |
|---|---|---|
| ANY | key absent | the claim applies regardless of this dimension |
| BOUND | `"channel": "google_ads"` | the claim applies only for this value |
| UNKNOWN | `"channel": "__UNKNOWN__"` | we do not know — **legacy only** |

"Absent" and "unknown" must never be conflated. Treating an unstated dimension as
"applies to everything" is exactly how a segment-specific finding gets applied to
all customers.

**Normalization** (`scopePolicy.ts`, versioned): lowercase; canonical controlled
vocabulary per dimension; keys sorted; stable JSON; `scope_key = sha256(...)`.

**Consumability — the requirement that drove the design.** The same representation
must serve every component:

| Component | Uses |
|---|---|
| `ClaimCandidateBuilder` | writes normalized scope |
| `CandidateEligibility` | rejects `unknown` |
| `RetrievalService` | **filters** via GIN index on `scope`, ranks by `scope_specificity` |
| `ClaimComparison` | reads bound dimensions for `compareScope()` |
| `MemoryPromotionPolicy` | detects scoped exceptions via specificity |
| contradiction logic | same-scope test = `scope_key` equality |
| Context Engine | formats "generally X; for enterprise, Y" |

**Rejected:** (a) one nullable column per dimension — does not extend, and NULL
cannot distinguish ANY from UNKNOWN; (b) leaving scope in `content` — Pre-Design
proved retrieval cannot filter it and production data does not populate it; (c) a
separate `memory_scope` table — a join on every retrieval for data that is always
needed with the row.

**Invariant I10.** Every new durable memory has `scope_completeness ∈ {explicit,
partial}`. `unknown` cannot be created; it exists only for legacy rows.

**Enforcement:** CHECK constraint + Gate A. **Owner:** `scopePolicy`.
**Tests:** normalization is idempotent and order-independent; `scope_key` equality
implies semantic scope equality; ANY vs UNKNOWN produce different contradiction
outcomes.

---

## C11 — Legacy unknown-scope memories are quarantined, not grandfathered

**Decision.** The existing 33 rows are marked `scope_completeness = 'unknown'` and
**quarantined**:

| Capability | Legacy unknown-scope row |
|---|---|
| retrievable | **yes** — it is the only corpus that exists |
| usable as historical / bootstrap context | **yes** |
| eligible as a **contradiction target** | **no** |
| eligible for **supersession** | **no** |
| eligible for **reinforcement** | **no** |
| eligible as the general memory of a **scoped exception** | **no** |

**Rationale.** Missing scope must never be read as workspace-global truth. A
memory with unknown scope cannot be safely contradicted, because the contradiction
may be a scoped exception that nobody can detect. Quarantine keeps them useful for
reading while making them inert for automated belief change.

They are **not** grandfathered as valid durable memories. An audit and
classification pass is required (**Design B**), and it must be founder-visible: a
human decides the scope, not a model.

**Invariant I11.** Automated belief change never targets a memory with
`scope_completeness = 'unknown'`.

**Enforcement:** Gate A / Gate B filter; retrieval marks these rows.
**Owner:** `MemoryPromotionPolicy`. **Tests:** an unknown-scope memory is returned
by retrieval but never selected as a contradiction target.

---

## C12 — Conservative scope inheritance

**Decision.** **No inheritance by default.** A memory applies only within its
stated scope. Explicit rules:

| Question | Answer | Why |
|---|---|---|
| workspace-level memory → all products? | **`DIRECTIVE` yes; `FACT`/`LEARNING` no** | a directive governs LaunchMind's behaviour, not a product's properties |
| product A learning → product B? | **no** | different products, different markets |
| founder preference workspace-wide? | **yes** — it is a `DIRECTIVE` | |
| channel performance across products? | **no** | |
| geography-specific outside its geography? | **no** | |
| campaign evidence → channel? | **no** | generalisation requires its own promotion step (Design B) |
| segment-specific → upward? | **no** | the exception is the valuable part; generalising discards it |

**Matching rule.** A memory matches a query scope when, for **every dimension the
memory BINDS**, the query either agrees or leaves it unspecified. Memories binding
fewer dimensions are broader. `scope_specificity` = count of bound dimensions.

**Invariant I12.** Confidence and evidence are never transferred between scopes.
A broader claim is never strengthened by narrower-scope evidence, and vice versa.

**Enforcement:** `scopePolicy.matches()` is the only matcher; evidence links are
scope-checked at attach time. **Owner:** `scopePolicy`.
**Tests:** one per row of the table above.

---

## C13 — Scoped exceptions are first-class

**Decision.** A scoped exception is a **separate memory** linked to its general
memory, with both remaining `active`.

```
exception_to  UUID REFERENCES marketing_memories(id)
```

Detection rule — this is what fixes the over-flagging measured in 3.1G §4.2:

> Comparison returns `CONTRADICTION`, **and** the candidate binds at least one
> dimension the general memory leaves ANY, **and** the candidate's
> `scope_specificity` is strictly greater
> → **`CREATE_SCOPED_EXCEPTION`**, not `CHALLENGE`.

| Property | Behaviour |
|---|---|
| both active | yes — both are true |
| precedence | more specific wins where both match |
| confidence | **independent** |
| evidence | **independent** — never shared |
| retrieval | when both match, return the exception ranked above, general retained as context |
| Context Engine | *"Generally: Search outperforms Meta. Exception (enterprise): Meta outperforms Search."* |
| history | the exception's creation is a transition on the **exception**, not on the general memory — the general memory's history stays clean |

An exception is **not** forced into contradiction, and it does not weaken the
general memory's confidence.

**Invariant I13.** Creating a scoped exception never mutates the general memory's
confidence, status, or version.

**Enforcement:** `MemoryPromotionPolicy` emits `CREATE_SCOPED_EXCEPTION`; the
lifecycle RPC rejects a transition on the general memory in the same call.
**Owner:** `MemoryPromotionPolicy`. **Tests:** the general memory is byte-identical
after an exception is created.

---

## C14 — Idempotency and concurrency

**Decision.** Four mechanisms, each at the narrowest scope that is safe.

1. **Deterministic candidate idempotency key**
   `sha256(workspace_id ‖ source_kind ‖ source_id ‖ normalized_claim ‖ scope_key ‖ sorted(evidence.independence_key[]))`
   UNIQUE on the shadow-proposal table. Replay is a no-op, not a second proposal.

2. **Optimistic version check.** `lm_apply_memory_transition` gains
   `p_expected_version`. A caller that read v3 and applies after another writer
   moved it to v4 **fails closed**. Pre-Design confirmed this guard is absent
   today.

3. **Advisory lock at claim-family scope.**
   `pg_advisory_xact_lock(hashtext(workspace_id ‖ scope_key))` — serializes
   candidates that could affect the same claim family. Deliberately **not**
   workspace-wide: unrelated memories must process in parallel.

4. **Row lock** — the existing `SELECT … FOR UPDATE` inside the RPC, retained.

**Founder correction racing automated ingestion:** founder transitions take the
row lock and bump the version; the automated transition then fails its
`p_expected_version` check and is re-evaluated against the corrected memory. The
founder wins by construction, without a special case.

**Invariant I14.** No two workers can create competing memories or exceptions for
the same `(workspace_id, scope_key, normalized_claim)`.

**Enforcement:** unique index + advisory lock + expected-version.
**Owner:** `MarketingMemoryEngine` + the RPC. **Tests:** concurrent identical
candidates produce exactly one proposal; concurrent contradictory transitions
serialize; replayed evidence does not double-reinforce.

---

## C15 — Bounded cost per candidate

**Decision.** Cost is bounded **independently of corpus size**.

| Budget | Value |
|---|---|
| related memories retrieved | **≤ 10** (RetrievalService top-K) |
| deterministic comparisons | **≤ 10** |
| model-assisted comparisons | **≤ 3** — the top 3 by fused rank that the deterministic path deferred |
| **model calls per candidate** | **≤ 3** (≤ 9 with the existing 2 retries) |
| query-embedding calls | 1, batched across candidates where possible |
| timeout | inherited from `aiPlatform` (30 s Haiku) |

This replaces the current unbounded `O(N)` sequential scan, which at 33 memories
already costs up to 33 sequential model calls (~66 s) for a genuinely new claim.

**Degradation — evidence ingestion must never block:**

| Condition | Behaviour |
|---|---|
| embedding provider down | retrieval degrades to lexical (proven in 3.1G); comparison proceeds |
| comparison model down | proposal persisted with `comparison_unavailable`; **queued for re-evaluation** |
| rate limited | backoff and queue; never drop |
| both down | Gate A result still persisted; evidence is stored regardless |

**Invariant I15.** A candidate's model-call count does not grow with the number of
memories in the workspace.

**Enforcement:** constants in `promotionBudgets.ts`; the engine counts calls and
refuses to exceed them. **Owner:** `MarketingMemoryEngine`.
**Tests:** a 10,000-memory workspace issues the same call count as a 10-memory one.

---

## C16 — One canonical mutation boundary

**Decision.**

```
evidence / connection_insight / campaign_result / experiment_result / founder input
        ↓
ClaimCandidateBuilder            deterministic claim + normalized scope
        ↓
CandidateEligibilityPolicy       GATE A — pure, no I/O, no model
        ↓
RetrievalService                 bounded related set (≤10), scope-filtered
        ↓
ClaimComparison                  deterministic → model only when deferred (≤3)
        ↓
MemoryPromotionPolicy            GATE B — corpus-level outcome
        ↓
BeliefPolicy                     pair-level permission + review flag
        ↓
   ┌────────────────┴────────────────┐
SHADOW                            ACTIVE
memory_shadow_proposals      MemoryLifecycleService
(durable proposal)           → lm_apply_memory_transition
                             → Postgres + learning event
```

**`MarketingMemoryEngine` is justified, and is orchestration-only.** It owns call
order, budget enforcement, idempotency, locking, and the shadow/active fork. It
performs **no** table writes and contains **no** policy. Without it, call order
lives in each caller — which is how the current three bypass paths arose.

**Answers to the specific questions:**

| # | Question | Answer |
|---|---|---|
| 1 | Is `MarketingMemoryEngine` justified? | Yes — order, budget, idempotency, fork |
| 2 | Orchestration-only? | Yes — no writes, no policy |
| 3 | Is `MemoryPromotionPolicy` distinct from `BeliefPolicy`? | **Yes** — corpus-level vs pair-level; `decide()` is structurally pairwise (C5) |
| 4 | Where does `CREATE_NEW` belong? | `MemoryPromotionPolicy` decides; `MemoryLifecycleService` executes |
| 5 | Where does `CREATE_SCOPED_EXCEPTION` belong? | Same |
| 6 | Founder-confirmed creation? | Same pipeline, authority `FOUNDER_*`, entry `active` (C6) |
| 7 | How do the three direct writers migrate? | C17 |
| 8 | The ONLY authoritative mutation boundary? | **`MemoryLifecycleService` → `lm_apply_memory_transition`** |

**Invariant I16.** `marketing_memories` is written by exactly one code path.

**Enforcement, layered:**
1. **3.2A** — ESLint/Semgrep rule banning `.from('marketing_memories')` with
   insert/update/delete outside `memoryLifecycleService.ts`, plus a structural
   test (the pattern already used for ADR-066 invariant 3).
2. **Design C** — revoke table-level write grants; the RPC is `SECURITY DEFINER`,
   so application roles need no direct write access at all. This makes the
   invariant enforced by the database rather than by review.

**Tests:** structural grep test; a live test asserting the application role cannot
UPDATE the table directly (Design C).

---

## C17 — Migration away from the direct writers

**Decision.** Three writers, three different dispositions. All additive; nothing
is deleted in 3.2A.

| Writer | Disposition | When |
|---|---|---|
| `marketingMemoryService.createMemory` | **wrap** — delegate to the engine's founder/bootstrap path | 3.2A |
| `marketingMemoryService.updateMemory` | **freeze** — deprecate, error in non-production, remove in Design C | 3.2A deprecate |
| `marketingMemoryService.archiveMemory` | **redirect** to `supersedeMemory` | 3.2A |
| `marketingMemoryService.mergeMemories` | **freeze** — merge becomes a Gate B `REINFORCE`/`NO_OP` outcome | Design B |
| `marketingMemoryService.addEvidence` | **replace** — evidence attach goes through the lifecycle RPC so confidence is recomputed under lock | 3.2A |
| `onboardingService` bulk insert | **replace** with per-claim bootstrap candidates through the engine (C7) | 3.2A |
| `memoryAgent` archive writes | **redirect** to `supersedeMemory`; fixes the `archive_reason` defect as a side effect | 3.2A |

`marketingMemoryService` retains its **read** functions unchanged.

**Tests:** structural test enumerating permitted write call sites; each redirected
path keeps its existing tests green.

---

## C18 — Durable shadow proposal contract

**Decision.** Two new tables. Shadow **must not** write to `learning_events`, which
is the authoritative ingestion audit — a proposal is not an event that happened.

### `memory_shadow_proposals`

Identity and tenancy: `id`, `workspace_id`, `product_id`, `idempotency_key`
(UNIQUE), `trace_id`, `created_at`.
Candidate: `claim_text`, `normalized_claim`, `memory_class`, `scope` JSONB,
`scope_key`, `scope_completeness`, `authority_tier`, `provenance` JSONB,
`evidence_ids` UUID[], `evidence_independence_keys` TEXT[].
Gate A: `eligibility_result`, `eligibility_reason_code`,
`eligibility_policy_version`.
Retrieval: `retrieval_mode`, `retrieval_degraded`, `related_memory_count`,
`retrieval_diagnostics` JSONB.
Gate B: `promotion_outcome`, `promotion_policy_version`,
`target_memory_id`, `exception_to_memory_id`.
Transition that WOULD have occurred: `proposed_action`, `lifecycle_before`,
`lifecycle_after`, `confidence_before`, `confidence_after`,
`proposed_entry_state`, `requires_founder_review`.
Policy versions: `authority_policy_version`, `comparison_policy_version`,
`confidence_policy_version`, `scope_policy_version`,
`importance_policy_version`, `quality_policy_version`.
Derived snapshots: `importance_score`, `quality_score` — **snapshotted**, because
they are otherwise unreproducible after a formula change.
Model: `model_request_ids` TEXT[], `model_call_count`, `deterministic_only` BOOL.
**Adjudication, reserved:** `adjudication_label` (`CORRECT` · `INCORRECT` ·
`PARTIALLY_CORRECT` · `UNSURE`), `adjudication_error_category`,
`adjudicated_by`, `adjudicated_at`, `adjudication_note`.

### `memory_shadow_proposal_comparisons`

One row per compared memory — without this, retrieval ranks and per-pair results
are lost and precision cannot be attributed:
`proposal_id`, `memory_id`, `memory_version`, `memory_scope_key`,
`lexical_rank`, `semantic_rank`, `fused_rank`, `final_rank`, `semantic_distance`,
`classification`, `rationale_code`, `ambiguity`, `decided_by`,
`model_request_id`, `belief_policy_action`, `requires_founder_review`.

**Invariant I17.** A shadow proposal records what ACTIVE **would** have done,
including every policy version, without asserting the transition occurred.

**Enforcement:** append-only triggers (the 091 pattern); no FK from
`marketing_memories` to a proposal. **Owner:** `MarketingMemoryEngine`.
**Tests:** the same candidate in shadow and active produces identical decisions up
to the fork; shadow leaves `marketing_memories` byte-identical.

---

## C19 — Traceability invariant

**Decision.** Every **authoritative** lifecycle transition permanently preserves:
triggering evidence ids · prior memory + version · resulting memory + version ·
authority tier · authority policy version · promotion policy version · confidence
policy version · scope policy version · actor · change reason · timestamp ·
trace id.

Derived retrieval eligibility and ranking changes are **not** transitions and must
never create version rows. Importance dropping does not make history.

Every shadow proposal preserves the equivalent proposal-time information without
implying the transition happened.

**Invariant I18.** No lifecycle transition exists without a complete provenance
record; no derived-score change creates one.

**Enforcement:** NOT NULL columns on the version row; the RPC is the only writer.
**Tests:** a transition missing any required field is rejected by the RPC; an
importance change produces zero version rows.

---

## C20 — Retraction and re-promotion: suppression, not a lifecycle state

**Decision.** A new `memory_suppressions` table. **No `DEMOTED` state** — the
DECIDED constraint is respected.

```
workspace_id · claim_fingerprint · scope_key · reason_class ·
suppressed_evidence_independence_keys TEXT[] · created_by_actor ·
created_at · expires_at (NULL = indefinite) · reversal_note
```

`reason_class` drives what is blocked — the four cases genuinely differ:

| `reason_class` | Blocks | Reopenable by |
|---|---|---|
| `FOUNDER_RETRACTION` | the claim family, indefinitely | **founder reversal only** |
| `FOUNDER_CORRECTION` | the superseded wording | founder, or materially different new evidence |
| `SYSTEM_INVALID_SOURCE` | only evidence from the named independence keys | a **new** independence key |
| `LEGAL_DELETION` | permanently; content erased | nothing |

**Re-promotion rule.** A candidate matching a live suppression is `NO_OP` at Gate A
**unless** it carries at least one `independence_key` absent from
`suppressed_evidence_independence_keys` — in which case it may enter `draft` with
`requires_founder_review = true`. Genuinely new evidence gets a hearing; replayed
old evidence does not.

This closes the hole Pre-Design found: today a retracted belief is invisible to
comparison (only `active` memories are compared), so the same evidence recreates
it as new.

**Invariant I19.** Correctly retracted or founder-corrected knowledge never
reappears automatically from the same evidence.

**Enforcement:** Gate A checks suppressions before anything else.
**Owner:** `CandidateEligibilityPolicy`. **Tests:** one per `reason_class`; replay
of retracted evidence produces `NO_OP`; new independent evidence produces
`draft + review`.

---

## C21 — Evidence invalidation: make it possible now, implement later

**Decision.** Design A closes the **schema shape** required; Design B implements
the cascade.

1. `evidence.status` — `valid` · `superseded` · `invalid` · `deleted`, plus
   `invalidated_at`, `invalidation_reason`.
2. **`memory_evidence` join table** — `(memory_id, evidence_id, contribution,
   attached_at)` with real FKs, replacing the unenforced `evidence_ids` UUID[].
   The array is retained (additive rule) but the join table becomes canonical.
   Without it, invalidation cannot find dependents.
3. **`memory_revalidation_queue`** — reuses the proven outbox pattern (trigger
   enqueue, lease claim, `SKIP LOCKED`), so evidence invalidation queues affected
   memories for confidence recomputation.

Design A does **not** implement recomputation, requeue-on-change, or the
retrieval effect.

**Invariant I20.** Today's schema must never make evidence invalidation
impossible. Every memory's evidence dependency is discoverable by query.

**Enforcement:** the join table's FKs. **Owner:** Design B.
**Tests:** given an invalidated evidence row, all dependent memories are
enumerable in one query.

---

## C22 — Active-memory budget: soft, health-based, no cap

**Decision.** No hard cap. **Health signals** with thresholds that trigger a
memory-quality review, not a database action:

| Signal | Warning threshold | Reads as |
|---|---|---|
| evidence-to-memory ratio | **< 3:1** | promoting too eagerly |
| active-memory growth | **> 50 / workspace / month** | curation failing |
| duplicate rate | **> 30%** of outcomes | comparison or scope too coarse |
| reinforcement rate | **< 10%** | nothing is corroborating anything |
| scoped-exception rate | **> 25%** | general memories are too broad |
| challenge rate | **> 15%** | the corpus is internally inconsistent |
| retraction rate | **> 5%** | promotion is admitting bad claims |
| memories never retrieved in 90 days | **> 40%** | dead weight |
| retrieval concentration (top 20 serving) | **> 80%** | the tail is not earning its place |
| active memories per workspace | **> 500** (soft) | review curation |

Tens of thousands of active memories is a **curation failure**, not a scaling
problem — the measured retrieval cost at 25,000 vectors is 4–5 ms.

**Owner:** a health view, reported not enforced. **Tests:** each signal computes
from existing tables.

---

## C23 — Backend capabilities required for future UX

Backend only; no UI is designed here.

| Owner question | Backend capability |
|---|---|
| What do you remember? | list memories by workspace + class + scope, with derived importance |
| Why do you remember this? | resolve `evidence_ids` → evidence with provenance |
| Who told you this? | `authority_tier` + actor on the creating transition |
| What evidence supports it? | `memory_evidence` join + independence count |
| Founder-confirmed or inferred? | `authority_tier` on the memory |
| What changed? | version chain with `change_reason` and before/after |
| Is this challenged? | open rows in `memory_challenges` |
| Scoped to what? | `scope` rendered from governed dimensions |
| When was this true? | validity window (Design B) + transition timestamps |
| Remember this. | founder-authored candidate through the engine |
| Correct this. | `founderCorrect` transition |
| Don't use this. | `DIRECTIVE` creation, or suppression |
| Show memory history. | version chain + transitions + suppressions |

---

# OPEN DECISIONS

## OPEN FOR DESIGN B — needs shadow measurement to decide

| # | Question | Why it needs measurement |
|---|---|---|
| B1 | Final promotion thresholds (corroboration count, sample floors, ambiguity cutoff) | choosing them now would be guessing; shadow produces the distribution |
| B2 | Should `FOUNDER_ASSERTED` and `FOUNDER_CONFIRMED` diverge behaviourally? | needs real founder-correction data |
| B3 | Legacy 33-row audit and classification pass | requires the scope model shipped and founder review |
| B4 | Evidence-invalidation cascade | schema shape closed in C21; behaviour needs observed failure modes |
| B5 | Validity windows on the live record (time-bounded facts) | needs a real case; versions carry `valid_from/until` today |
| B6 | Generalisation (campaign → channel, segment → broader) | requires exception-rate data from C22 |
| B7 | Should importance/quality be materialised? | only if profiling justifies it |
| B8 | Adjudication workflow and who labels | schema reserved in C18 |
| B9 | `campaign`, `creative`, `competitor` as scope vs evidence links | needs real claim shapes |
| B10 | Merge semantics for `mergeMemories` | frozen in C17 pending a real duplicate corpus |

## OPEN FOR DESIGN C — activation-time

| # | Question |
|---|---|
| C1 | Activation thresholds and the precision bar required to leave shadow |
| C2 | Per-workspace activation flag (none exists today) |
| C3 | Database-level write revocation (C16 enforcement layer 2) |
| C4 | Founder-review queue and its SLA |
| C5 | Rollback rehearsal for applied automatic learning |
| C6 | Active-memory compaction policy when C22 signals fire |
| C7 | Removal of the frozen `marketingMemoryService` mutators |

---

# Consequences

**Positive.** Scope becomes filterable and comparable in one representation. Cost
becomes independent of corpus size. Authority becomes historically explicable.
Shadow becomes measurable. There is exactly one intended mutation path, with a
migration plan for the three that exist.

**Negative.** Six new schema objects (scope columns, authority columns, two shadow
tables, suppressions, `memory_evidence`, revalidation queue). The corroboration
rule (C6) means automatic learning produces `draft` memories that nobody sees
until a founder-review surface exists (Design C4) — accepted deliberately, because
the alternative is unreviewed belief.

**Risk accepted.** Every threshold in this ADR is a hypothesis. Design B must
revisit them against measured shadow data, and this ADR must be amended rather
than silently adjusted.
