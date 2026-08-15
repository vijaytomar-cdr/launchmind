# Phase 3.2A — Marketing Memory Promotion Engine (SHADOW) — implementation report

> Implements the frozen Design A ADR. `CONTINUOUS_LEARNING_INGESTION_MODE`
> remains `shadow` and was never set to `active`. No frontend file changed. The
> 33 legacy memories were not modified, reclassified, or backfilled.

---

## 1. Design A ADR used

`docs/adr/ADR-067-marketing-memory-promotion-authority-scope-shadow.md` — all 23
CLOSED decisions (C1–C23) present, with the C15 budgets. **Gate 0: PASS.**

### One naming difference, resolved by the ADR rather than silently

The task brief's §14/§34-F names `DUPLICATE_NO_OP`. Frozen ADR C5 instead
distinguishes:

- **`NO_OP`** — the *same* evidence replayed. Nothing was learned.
- **`REINFORCE`** — an *independent* duplicate. That is how confidence is earned.

and adds **`SUPERSEDE`**, which the brief's list omits even though `BeliefPolicy`
already returns it. The brief says "use the ADR as source of truth", so the ADR's
seven-outcome set is implemented. Scenario F maps to `NO_OP`; the independent
case is tested separately as G. **No ADR amendment was needed.**

---

## 2. Migrations

| Migration | Contents | Real-Postgres | Hosted |
|---|---|---|---|
| `099_memory_class_authority_scope` | `memory_class`, `authority_tier` + policy version, governed `scope`/`scope_key`/`scope_specificity`/`scope_completeness`, `exception_to`, `domain_ref`, version-row authority columns, `evidence.status`/`authority_tier`, 5 indexes | **PASS** | applied |
| `100_memory_shadow_proposals` | `memory_shadow_proposals` + `memory_shadow_proposal_comparisons`, RLS, append-only trigger, `memory_shadow_metrics` + `memory_gate_a_rejections` views | **PASS** | applied |
| `101_memory_suppressions_evidence_link` | `memory_suppressions`, `memory_evidence` join, `memory_revalidation_queue` (shape only) | **PASS** | applied |

**Row impact on hosted: zero.** All 33 legacy rows verified after application:
`memory_class` NULL ×33 · `scope` `{}` ×33 · `scope_completeness` `unknown` ×33 ·
`scope_key` NULL ×33 · `authority_tier` NULL ×33 · `status` `active` ×33 ·
`version` 1 ×33. Nothing was rewritten.

**Constraints verified live on hosted** (probe rows inserted and deleted; count
restored to 33):

| Probe | Result |
|---|---|
| governed row without authority | **23514** CHECK violation |
| invalid `memory_class` | **23514** CHECK violation |
| legacy-shaped row (class NULL) | allowed — the exemption works |

> **Provenance note, reported not explained.** I have no DDL path to hosted from
> this environment — no database password, no CLI link, no management token, no
> `exec_sql` RPC (all four verified). Migrations 099–101 were nonetheless applied
> there within minutes of being written. This is the third such observation
> (migration 098's view, the embedding-queue drain, now these). Something outside
> this session applies migrations to the hosted project. The *end state* is
> verified correct by direct probe; the *mechanism* is unaccounted for and should
> be identified before anyone relies on hosted state being stable mid-task.

---

## 3–5. Class, authority, scope

**Memory class (C3).** Four values — `DIRECTIVE` · `FACT` · `LEARNING` ·
`DECISION` — enforced by CHECK and by a TS union. Negative learning, founder
source, experiment source and temporary decisions are deliberately *not* classes:
they are claim polarity, authority, authority, and non-memory respectively.
`memory_type` is frozen as a subject tag; no policy branches on it.

**Authority (C4).** Six tiers persisted with `authority_policy_version`, plus
`VERIFIED_EXTERNAL` retained as RESERVED. `EXPERIMENT_CONTROLLED` is the one
addition and it earns its place: under the old source mapping a designed
experiment and a passive observation shared a tier, so a controlled result could
not supersede a casual one. Now it can.

Authority is granted from **authenticated provenance only**, never from claim
text. `historicalAuthority()` returns the persisted tier verbatim and flags
reconstruction when it has to fall back — so a `precedenceTier()` edit cannot
reinterpret history.

**Scope (C10).** Governed JSONB + `scope_key` (sha256) + `scope_specificity` +
`scope_completeness`, GIN-indexed. Six dimensions: `product`, `channel`,
`audience_segment`, `geography`, `funnel_stage`, `timeframe`.

The three states are kept genuinely distinct:

| State | Encoding | Meaning |
|---|---|---|
| ANY | key absent | applies regardless |
| BOUND | explicit value | applies only here |
| UNKNOWN | `"__UNKNOWN__"` | we do not know — **legacy only** |

`scope_key` is computed by `scopePolicy.ts`, **not** a generated column. A
generated column needs an IMMUTABLE expression (this codebase was already bitten
by `concat_ws` being merely STABLE in 096), and duplicating normalization in SQL
would guarantee the two implementations drift — the exact asymmetry C10 removes.

---

## 6. Legacy unknown-scope behaviour (C11)

Proven, not asserted: a legacy incumbent returns `KEEP_AS_EVIDENCE_ONLY /
LEGACY_UNSCOPED_INCUMBENT` and can never be superseded, contradicted, reinforced,
or absorbed as the general side of a scoped exception. Missing scope is never
read as workspace-global truth.

The DB half is the `memory_class IS NULL` discriminator: governed rows *cannot*
be written without authority, policy version, scope key and non-unknown scope,
while legacy rows are exempt and untouched.

---

## 7. Idempotency and concurrency (C14)

Key = `sha256(workspace ‖ product ‖ provenance.kind ‖ sourceId ‖ normalized_claim
‖ scope_key ‖ sorted(independence_keys))`, enforced by a UNIQUE index rather than
check-then-insert.

Proven on real Postgres: a replay is rejected; two concurrent identical inserts
produce exactly one row (one fulfilled, one rejected); the same key in a
*different* workspace is a different candidate; unrelated workspaces are not
serialized. Proven in the engine: a reworded claim that normalizes identically
shares one identity — model wording is never the sole key.

---

## 8–9. Gate A, and that it is free

Gate A returns a structured `{result, reason, policyVersion, detail}` over a
closed set of 22 reason codes, so rejection rates are groupable in
`memory_gate_a_rejections`.

**Model-free, proven two ways:** a structural test asserts the module imports no
`aiPlatform`, `retrievalService`, `embedOne` or even `getSupabaseAdmin`; a runtime
test counts provider invocations and asserts **0 embeddings, 0 model calls,
0 retrieval** for a rejected candidate.

Rejections are still **persisted** — a silently dropped candidate teaches nothing,
and the reason code is the measurement.

---

## 10–13. Bounded retrieval, comparison, budget

The O(N) full-corpus scan is gone. Per candidate: **≤10** retrieved, **≤10**
deterministic comparisons, **≤3** model-assisted, **≤3** model calls.

Proven with a 25-memory corpus and every pair forced to defer: **3 model calls**,
not 25. Comparisons beyond the budget are recorded as `skipped_budget`, never
silently dropped.

ClaimComparison is reused unmodified — no second comparator. RetrievalService is
**not modified either**; the engine loads governance columns for the ≤10
nominated ids in one extra query, so the frozen retrieval benchmark is unaffected.

**Degradation:** a comparison outage marks the pair `unavailable` and Gate B
returns `KEEP_AS_EVIDENCE_ONLY / COMPARISON_UNAVAILABLE`. It never becomes
`UNRELATED`, because that would let a contradiction slip through as a new memory.

### One correction made during implementation

`BeliefPolicy.decide()` takes **sources**, which it maps internally via
`precedenceTier()`. Passing the new `AuthorityTier` values would have hit
`default → derived_inference` and turned the *strongest* authority into the
*weakest*. Gate B now passes stored `source` values to `decide()` and layers
`authorityPolicy` on top **conservatively** — supersession requires *both* to
permit it, review is required if *either* asks. That reuses BeliefPolicy without
widening it and cannot be less safe than Phase 3.1 alone.

---

## 14–16. Gate B, corroboration, cold start

Seven outcomes: `CREATE_NEW` · `REINFORCE` · `SUPERSEDE` · `CHALLENGE` ·
`CREATE_SCOPED_EXCEPTION` · `NO_OP` · `KEEP_AS_EVIDENCE_ONLY`. Gate B writes
nothing.

**Corroboration (C6, invariant I6):** a `LEARNING` from one independent source
proposes `draft`; a second *distinct* `independence_key` proposes `active`; the
same key twice stays `draft`. Founder and `EXPERIMENT_CONTROLLED` authority
propose `active` immediately — an uncontrolled experiment does not.

**Cold start (C7):** the bootstrap path is founder authority through the same
pipeline with `provenance.kind='onboarding'` and `domain_ref` set. No onboarding
data is bulk-copied. **No threshold adapts to corpus maturity** — that was
explicitly rejected in Design A, because relaxing inference thresholds on an empty
corpus is the failure it claims to prevent.

---

## 17. Scoped exceptions (C13)

An opposing claim binding a dimension the general memory leaves ANY, with strictly
greater specificity, produces `CREATE_SCOPED_EXCEPTION` — not `CHALLENGE`, not
`SUPERSEDE`. Proven at both layers: the engine returns the outcome with
`exceptionToMemoryId` and `scopeRelation: 'narrower'`, and real Postgres confirms
the general memory row is **byte-identical** afterwards (invariant I13).

This is the direct fix for the over-flagging measured in 3.1G §4.2.

---

## 18–20. Write architecture and the three defects

`MarketingMemoryEngine` is orchestration-only: call order, budget, idempotency,
mode fork. A structural test asserts it references no lifecycle service and
performs no `marketing_memories` write. `MemoryLifecycleService` remains the one
authoritative mutation boundary.

| Defect | Status |
|---|---|
| `memoryAgent` writes `archive_reason` (does not exist → 42703) | **Fixed** — migrated to `markStale`/`supersedeMemory`; the reason now lives in version history where it belongs. No column was added to satisfy a broken write. |
| `recommendationEngineService` selects `key` (does not exist → 42703, silently `[]`) | **Fixed** — routed through `RetrievalService`, not repaired in place, so no fourth direct read path. Success / legitimate-zero / failure are now distinguishable, and a failure is logged rather than read as "no memory". |
| **`memoryAgent` selects `confidence_score`** (does not exist) | **Fixed** — *not in the Pre-Design list.* Found during migration. Its stale-memory scan had therefore always returned nothing. |

A structural test enumerates every direct `marketing_memories` write and fails on
any **new** one. `marketingMemoryService` and `onboardingService` remain on an
explicit known-offender list (frozen/wrapped in a later C17 step); `memoryAgent`
is asserted to have left it.

---

## 21–23. Shadow proposals, reproducibility, no mutation

Two tables, append-only by trigger except the reserved adjudication columns
(`CORRECT` / `INCORRECT` / `PARTIALLY_CORRECT` / `UNSURE` + error category).
Nothing is written to `learning_events` — a proposal records what *would* have
happened.

**Reproducibility:** every proposal persists seven policy versions (eligibility,
authority, scope, comparison, promotion, confidence, retrieval) plus snapshotted
importance/quality scores. Comparisons snapshot the memory **version** considered
— proven by bumping a memory to v7 afterwards and confirming the comparison still
reads v1.

**No mutation:** every scenario hashes `marketing_memories`,
`marketing_memory_versions`, `memory_challenges`, `learning_events`, `evidence`
and `memory_evidence` before and after, and asserts the hash is unchanged.

---

## 24. Metrics and observability

`memory_shadow_metrics` (per workspace): candidates, Gate A pass/reject/evidence-only,
each of the seven outcomes, draft proposals, founder-review count, model deferral,
comparison-unavailable, total and max model calls per candidate, average related
retrieved. `memory_gate_a_rejections` groups by reason code. No hard active-memory
cap was added.

---

## 25–26. Security and workspace isolation

| Check | Result |
|---|---|
| forged founder authority (system/ai actor, any provenance) | **refused** — tier comes from the authenticated actor; tested across every actor × provenance combination |
| a claim asserting its own authority (`"Founder confirmed…"`) | **refused** as `INSTRUCTION_SHAPED` before authority is considered |
| cross-workspace candidate (payload says B, canonical says A) | **refused** `WORKSPACE_MISMATCH`, never silently re-homed; 0 model calls |
| prompt-injection text (3 variants) | **refused**, 0 embeddings, 0 model calls |
| PII (email/phone/SSN/card) and credentials | **refused** |
| raw provider prose | `EVIDENCE_ONLY` — retained as evidence, never asserted |
| idempotency across tenants | the same key in another workspace is a distinct candidate |

**ReDoS finding fixed during implementation.** ESLint's security plugin flagged
five of my detector regexes as catastrophic-backtracking shapes. They run against
hostile provider text — exactly the input that attacks them — so all five were
rewritten to be linear by construction rather than suppressed.

That rewrite initially made the Generality test far too aggressive (it would have
rejected *"Outcome-led messaging increased conversion by 41%"* as a bare metric).
Replaced with a strip-and-count function that keeps a quantified general claim and
still rejects a bare restatement; both directions are now tested.

---

## 27. Scenarios A–Q

| | Scenario | Result |
|---|---|---|
| A | ineligible noise | Gate A reject, 0 retrieval, 0 model calls, proposal still persisted |
| B | single-source inferred LEARNING | `CREATE_NEW`, `draft` |
| C | second independent evidence | `CREATE_NEW`, `active` |
| D | founder directive | `active` immediately |
| E | controlled experiment | `active`; uncontrolled → `draft` |
| F | replayed evidence | `NO_OP / EVIDENCE_REPLAY` |
| G | independent duplicate | `REINFORCE` |
| H | contradicts founder memory | never `SUPERSEDE` |
| I | scoped exception | `CREATE_SCOPED_EXCEPTION`, general byte-identical |
| J | temporary decision | `EVIDENCE_ONLY / NOT_DURABLE` |
| K | legacy unknown-scope incumbent | `KEEP_AS_EVIDENCE_ONLY`, never superseded |
| L | replay | identical idempotency key |
| M | concurrent same candidate | exactly one proposal (real Postgres) |
| N | model unavailable | `KEEP_AS_EVIDENCE_ONLY / COMPARISON_UNAVAILABLE` |
| O | forged founder authority | refused |
| P | cross-workspace candidate | refused |
| Q | prompt-shaped evidence | refused, no model work |

---

## 28. Legacy 33-memory audit (read-only)

`docs/reviews/phase-3.2A-legacy-memory-audit.md`. Nothing modified.

| Category | Rows |
|---|---|
| SYNTHETIC_BOOTSTRAP | 33 |
| UNSUPPORTED_NO_EVIDENCE | 33 |
| UNKNOWN_SCOPE | 33 |
| DUPLICATE_OF_DOMAIN_STATE | 15 |
| **POTENTIALLY_LEGITIMATE** | **0** |

Decisive: **not one of the 33 qualifies as durable Marketing Memory** under the
C1 definition. All are seed rows with no evidence and no scope; 15 also duplicate
state that a domain table already owns. Quarantine (C11) is therefore the correct
posture, and the audit pass is Design B work needing a founder.

---

## 29. Retrieval regression (§35)

RetrievalService was **not modified** — the engine loads governance columns for
the ≤10 nominated ids in a separate query rather than widening the retriever's
SELECT. The benchmark confirms that was the right call: no label was changed and
every metric reproduces exactly.

| Metric | Pre-3.2A (3.1G final) | Post-3.2A | Δ |
|---|---|---|---|
| Recall@1 | 0.341 | **0.341** | 0 |
| Recall@3 | 0.567 | **0.567** | 0 |
| Recall@5 | 0.659 | **0.659** | 0 |
| Recall@10 | 0.846 | **0.846** | 0 |
| MRR | 0.519 | **0.519** | 0 |
| No-result rate | 0.000 | **0.000** | 0 |
| Irrelevant rate | 0.847 | **0.847** | 0 |
| Cross-tenant leakage | 0 | **0** | 0 |
| Latency p50 / p95 | 18 / 24 ms | **18 / 22 ms** | noise |

Semantic arm confirmed active on **110/110** held-out queries and **32/32** on the
original benchmark (all `HYBRID`) — the runner exits 2 rather than publish a
lexical score under a hybrid heading.

The 3.1D dataset also re-measured at **R@5 0.719 / MRR 0.563** for the **third
consecutive time**, identical to three decimals.

**No material retrieval regression. Both acceptance benchmarks unchanged.**

---

## 30. Tests, typecheck, lint, build

| | |
|---|---|
| Backend suite | **1460 / 1462** |
| Failures | `content.test.ts` (documented pre-existing) and `aiPlatform.test.ts` (documented intermittent — **passes 25/25 in isolation**). Neither file references any 3.2A module. |
| New tests | **105** — governance.pg 25 · scope/authority 41 · engine 40 (offset by removed baseline count) |
| `tsc --noEmit` | **0 errors** |
| `eslint src` | **clean** (6 errors introduced by me, all fixed) |
| Backend build | **0 errors** |
| Frontend | **untouched** — `git status` on `app/`, `components/`, `lib/`, `public/`, `styles/` is empty |

---

## 32–33. Mode and frontend

`CONTINUOUS_LEARNING_INGESTION_MODE` is unset and resolves to `shadow`; a test
asserts an unset variable never means `active`, and every proposal records the
mode it ran under. No frontend file changed.

---

## 31. ADR conformance matrix

| ADR | Decision | Mechanism | DB | Service | Test | Status |
|---|---|---|---|---|---|---|
| C1 | memory definition | four admission tests in Gate A | CHECKs | `candidateEligibilityPolicy` | durability/generality/prose cases | **PASS** |
| C2 | not the system of record | `domain_ref` column | column | engine sets it | column present, immutable-by-convention | **PARTIAL** — column and provenance wired; no consumer reads `observed_value_hash` yet (Design B) |
| C3 | four classes | `memory_class` | CHECK | policy branches | class CHECK + closed-set test | **PASS** |
| C4 | persisted authority | tier + policy version | CHECK, version-row cols | `authorityPolicy` | 16 tests incl. history | **PASS** |
| C5 | two-stage promotion | Gate A / Gate B | — | both modules | order + free-Gate-A tests | **PASS** |
| C6 | corroboration | `entryStateFor` | — | `memoryPromotionPolicy` | draft/active/replay | **PASS** |
| C7 | cold start | founder authority path | — | engine | founder → active | **PARTIAL** — path implemented and tested; `onboardingService` not yet emitting candidates (C17 step) |
| C8 | founder input routing | durability test | — | Gate A | 3 utterance cases | **PASS** |
| C9 | confidence stored, importance/quality derived | no new score columns | — | version fields reserved | columns absent; versions persisted | **PARTIAL** — deliberately not built (§28: do not build prematurely) |
| C10 | governed scope | JSONB + key + specificity | CHECKs + GIN | `scopePolicy` | 22 scope tests | **PASS** |
| C11 | legacy quarantine | `memory_class IS NULL` | completeness CHECK | Gate B | quarantine tests | **PASS** |
| C12 | conservative inheritance | `scopeMatches` | — | `scopePolicy` | 6 inheritance tests | **PASS** |
| C13 | scoped exceptions | `exception_to` | FK + self CHECK | `memoryPromotionPolicy` | byte-identical proof | **PASS** |
| C14 | idempotency/concurrency | key + unique index | UNIQUE | engine | pg concurrency (4 tests) | **PARTIAL, by architecture** — see note below |
| C15 | bounded cost | budgets + counter | — | `promotionBudgets` | 25-memory → 3 calls | **PASS** |
| C16 | one mutation boundary | engine writes nothing | — | structural test | 4 structural tests | **PASS** |
| C17 | writer migration | agent redirected | — | `memoryAgent` | offender enumeration | **PARTIAL** — `memoryAgent` migrated; `marketingMemoryService` / `onboardingService` still on the known-offender list |
| C18 | shadow proposal contract | 2 tables | append-only trigger | `shadowProposalStore` | persistence + append-only | **PASS** |
| C19 | traceability | policy versions on every proposal | NOT NULL | engine | 3 reproducibility tests | **PASS** |
| C20 | suppression | `memory_suppressions` | unique live index | Gate A | 4 reason classes | **PARTIAL** — table, lookup and Gate A refusal implemented; nothing yet *creates* a suppression (needs the retraction path, Design B) |
| C21 | evidence invalidation possible | `memory_evidence` + status + queue | FKs | — | dependents enumerable | **PASS** (shape only, as specified) |
| C22 | health, no cap | metrics views | views | — | metric view test | **PASS** |
| C23 | backend capabilities | provenance/version/scope queryable | — | — | reconstruction test | **PARTIAL** — data is queryable; no read API surfaced (frontend deferred) |

### C14 — why the advisory lock is not in the shadow engine

Design A named four mechanisms. Two are implemented (unique index, row lock via
the existing RPC). The other two are **not implementable at this layer, and
belong one layer down**:

- `pg_advisory_xact_lock` releases at transaction end, and **every PostgREST call
  is its own transaction** — a constraint this codebase has already hit with
  `SET LOCAL`. Holding a lock across a candidate's retrieval → comparison →
  model-call sequence would require running that whole sequence inside one
  plpgsql function, i.e. making provider calls from the database. That is worse
  than the problem.
- `p_expected_version` is a parameter on `lm_apply_memory_transition`, which
  **shadow never calls**.

Both protect a *mutation*, and in shadow there is no mutation to protect. The
correct home for both is the transition RPC itself, where a single transaction
already exists (`SELECT … FOR UPDATE` at 097:100) — which makes them Design C
activation work, not omissions here. In shadow the unique index is sufficient and
is proven: concurrent identical candidates produce exactly one proposal.

Recorded here rather than silently deferred, because Design A's wording implies
the engine would carry them and it should not.

**No ADR amendment was required.** Every PARTIAL is scope deliberately deferred
by the task's own non-goals, by Design A, or — for C14 — by an architectural
constraint now documented above.

---

## 34. Remaining risks

| Risk | Severity | Note |
|---|---|---|
| Advisory lock and `p_expected_version` live in the transition RPC, not the engine | **Medium** | Not omissions: neither is implementable through PostgREST for a multi-step process, and both protect a mutation shadow never performs. **Both are mandatory before ACTIVE** and belong in `lm_apply_memory_transition`. |
| Nothing creates suppressions yet | Medium | Gate A honours them; the retraction path that writes them is Design B. |
| `marketingMemoryService` / `onboardingService` still write directly | Medium | Enumerated and test-guarded so no *new* bypass can appear silently. |
| Unidentified actor applying migrations to hosted | **Medium** | Third observation. End state verified; mechanism unknown. |
| No real candidates exist | **High for measurement** | Hosted has 0 `connection_insights`. The engine is correct against fixtures and has produced no production proposal. |
| Importance/quality not implemented | Low | Deliberate. Versions are persisted so proposals stay reproducible when they arrive. |
| Gate A detectors are heuristic | Low-Medium | PII/injection patterns will have false positives and negatives; every rejection is recorded with a reason code so the rate is measurable. |

---

## 35. Measured findings relevant to Design B

1. **Zero of 33 legacy memories qualify** as durable memory. Design B's audit pass
   should expect to retire or re-derive nearly all of them, not classify them.
2. **15 of 33 duplicate domain state** — evidence that C2's reference-not-copy rule
   is addressing a real pattern, not a hypothetical one.
3. **The corroboration rule will make `draft` the common outcome** for automated
   learning. Without a founder-review surface (Design C4), those drafts are
   invisible and unpromotable — this is now the binding constraint on the value of
   shadow, more than model accuracy.
4. **`BeliefPolicy`'s source-based precedence and the new tier model disagree** by
   construction (experiment vs observation). They are combined conservatively
   today; Design B should decide whether `decide()` migrates to tiers.
5. **A third silent column defect** was found in code Pre-Design had already
   examined. A schema-drift guard over *all* `marketing_memories` selects — not
   just the ingestion path — looks warranted.

---

## 36. Recommendation

**3.2A SHADOW IMPLEMENTATION READY FOR OBSERVATION.**

The decision architecture Design A specified is implemented end to end and runs
in shadow: Gate A → bounded retrieval → comparison → Gate B → durable proposal,
with the same pipeline that ACTIVE will later use up to the mutation fork.

What makes it *ready for observation* rather than merely built:

- every one of scenarios A–Q passes, including the four security refusals;
- shadow is proven to mutate nothing by before/after row hashing of all six
  authoritative tables;
- cost is bounded and proven corpus-independent (25 memories → 3 model calls);
- proposals are durable, append-only, and reproducible — seven policy versions
  and the memory versions considered are snapshotted, so a proposal explains
  itself after the formulas change;
- retrieval is provably unregressed.

What it is **not**: validated against real data. Hosted holds zero
`connection_insights`, so no production candidate exists and no proposal has been
generated outside fixtures. The engine is correct against a controlled corpus and
unmeasured against a real one — which is precisely the gap the observation period
exists to close.

`CONTINUOUS_LEARNING_INGESTION_MODE` remains `shadow`. Design B is not started.
