# Phase 3.1 — final certification (post-remediation)
>
> **SEMANTIC_CORPUS_COVERAGE_NOT_ASSERTED_AT_TIME_OF_RUN.** When these figures
> were produced, the harness verified only that QUERY vectors were primed. It did
> not verify that the CORPUS was embedded, so a zero-vector corpus could publish
> as `HYBRID`. Numbers are preserved unchanged.
>
> Re-measured on 2026-08-13 under an enforced corpus-coverage guard (26/26
> current, voyage-4/1024d/v1): **the figures reproduce exactly** — 3.1D R@5 0.719 /
> MRR 0.563; held-out R@1 0.341 · R@3 0.567 · R@5 0.659 · R@10 0.846 · MRR 0.519 ·
> leakage 0. These artifacts are therefore CONFIRMED, not superseded.


> 3.1G final remediation pass. Supersedes `phase-3.1G-certification.md`, which
> recorded the PARTIAL state. Every figure here was produced by running the
> system during this pass; where something could not be measured or could not be
> explained, it says so.

---

## 22. Recommendation

**PHASE 3.1 FOUNDATION READY.**

Ready means: the architecture is sound, the invariants hold under adversarial
test, the measured defects are closed, and the system is safe to run in `shadow`
against production traffic.

It does **not** mean automatic learning may be switched on.
`CONTINUOUS_LEARNING_INGESTION_MODE` remains `shadow` and three activation
preconditions are still unmet — none of which is a code defect:

| Still open | Why it is not a foundation problem |
|---|---|
| A1 — shadow never validated against REAL provider signals | Hosted holds **zero** `connection_insights`. No code change can produce them; a founder has to connect a provider. |
| A6 — rollback never rehearsed | A written procedure, not an exercised capability. |
| A7 — embedding worker unverified in a deployed environment | The fix is committed and Redis-gated; nobody has confirmed a deployed backend runs with `REDIS_URL` set. |

---

## 1. Migration 098 — hosted status

**Applied and verified.**

| Check | Result |
|---|---|
| `embedding_stuck_jobs` view present on hosted | **Yes** — returns `{reclaimable_jobs, in_flight_jobs, retried_after_crash, max_attempts_in_flight}`, the exact column set 098 defines |
| Control (unknown relation) | `PGRST205` — so the check above is sound, not a false positive |
| `lm_claim_embedding_work` callable on hosted | Yes, no error |
| Gate 0 #4 — completed jobs never reclaimed | **PROVEN on hosted**: 66 completed jobs, claim returned **0 rows**, outbox byte-identical before and after |

**Provenance caveat, stated plainly.** I did not apply 098 to hosted in this
pass, and there is no DDL path from this environment — no database password, no
CLI link, no management token, no `exec_sql` RPC. The view is nonetheless there.
Something outside this session operates on the hosted project. That is the second
such observation (see §8).

Gate 0's remaining lease semantics are proven against real Postgres, not
inferred:

| # | Gate 0 requirement | Evidence |
|---|---|---|
| 1 | Expired PROCESSING jobs are reclaimable | `memoryResilience.pg.test.ts` — claim with a 1 s lease, wait, another worker reclaims |
| 2 | A worker crash cannot permanently strand an embedding | Same test; `attempt_count` reaches 2, so the job progresses rather than vanishing |
| 3 | Active leases are not stolen prematurely | Immediately after the claim a second worker gets **0 rows** |
| 4 | Completed jobs never reclaimed | Hosted probe above + local suite |
| 5 | Duplicate processing remains idempotent | `finalInvariants.test.ts` — redelivery yields exactly **one** current vector |
| 6 | Lease duration observable | `embedding_stuck_jobs` separates `in_flight` from `reclaimable`; both transitions asserted |

**Gate 0: PASS.**

---

## 2. B1 — root cause and correction

### Root cause (deeper than first diagnosed)

My first diagnosis was "`fatigues` is missing from the antonym table". That was
incomplete. The actual mechanism:

```
existing   "Meta creative fatigues above frequency 3"   → polarity {above}
candidate  "Meta creative performs better above frequency 3" → polarity {better, above}
```

**`above` is IN the antonym table**, as a direction word. Both claims contain
"above frequency 3", a threshold phrase. So both registered positive polarity, no
opposing pair was found, subject overlap was high — and the comparator inferred
agreement from a preposition, while `fatigues` and `performs`, the words carrying
the actual meaning, sat unexamined in the subject set.

No antonym table would have prevented this.

### The correction

Deterministic `REINFORCEMENT` now requires **provable alignment**, not the
absence of a detected conflict:

1. identical polarity vocabulary on both sides, **and**
2. at most a **one-sided** residual of unmatched content words (elaboration).

Both sides carrying unmatched content words means each asserts something the
other does not — divergence, which defers to the model.

The model prompt was tightened in the same pass: `REINFORCEMENT` now requires the
same subject, direction **and measure**, with an explicit instruction that two
different metrics about one channel are `UNRELATED` and that uncertainty should
resolve to `UNRELATED` because it mutates nothing.

Recorded as ADR-066 Amendment 5.

---

## 3. Deterministic comparator safety policy

> Deterministic REINFORCEMENT is permitted only when two claims make the SAME
> assertion, with one possibly saying more. Everything else defers to the model.

The asymmetry is deliberate. A missed reinforcement costs one model call. A false
reinforcement raises confidence in a belief the evidence undermines, needs no
founder review, and compounds silently. **Deferral rate is explicitly not a metric
to optimise.**

`comparatorSafety.test.ts` — 33 tests. The adversarial pairs use verb forms the
table does *not* contain (`improves`/`declines`, `rising`/`falling`,
`accelerates`/`slows`), and each asserts the **deferral** specifically, so the
suite cannot be satisfied by growing the antonym table.

| Adversarial pair | Result |
|---|---|
| improves vs declines · fatigues vs performs better · converts vs drops · increases churn vs improves retention · cheaper vs more expensive · stronger vs weaker · higher vs lower CAC · higher vs lower conversion · better vs worse retention · rising vs falling · accelerates vs slows | **0 reinforcements** across all 11 |

Not regressed: elaboration still reinforces deterministically, duplicates still
resolve, same-scope contradictions are still caught without a model, and the
different-scope exception is still preserved.

---

## 4. Live claim-comparison results

16 cases — the original 10 with **labels unchanged**, plus B1 and five
predicate-safety cases fixed before the run.

| | |
|---|---|
| Accuracy | **16 / 16 (100%)** |
| Deterministic resolved | 0 |
| Model deferred | 16 |
| Dangerous false reinforcement | **0** |
| Unreviewed reinforce on an opposing pair | **0** |
| Real calls | 15 `ai_requests` rows, 5,180 in / 2,201 out tokens, **$0.004049**, `claude-haiku-4-5` |

§3's required path is demonstrated end to end for B1:
`deterministic → null → AI ClaimComparison → CONTRADICTION → BeliefPolicy → challenge + founder review`.

Two results worth naming:

- **Case 06 now passes.** The previous miss (cost-per-install vs click-through
  rate read as `REINFORCEMENT`) is fixed by the sharpened prompt — it now returns
  `UNRELATED`.
- **Case 16**, added deliberately in the opposite direction (same subject, same
  direction, *different measure*), returns the conservative `UNRELATED`.

The audit trail again showed 15 rows for 16 calls on immediate query, with the
16th appearing moments later — the same non-synchronous audit write documented
previously. Not a loss; a visibility lag.

---

## 5. Ingestion-column fix verification

`insight_type` never existed. The real column is `insight_key` (migration 084).
PostgREST errored, the code destructured only `data`, and shadow ingestion
silently built zero candidates — it **could never have worked**.

`ingestionSchema.test.ts` — 11 tests, two independent guards:

1. **Schema.** Every column the builder selects is checked against the parsed
   migration DDL, so any future rename fails at test time rather than silently at
   runtime. The `InsightRow` interface is checked too, because the row is cast and
   a drift there produces `undefined`, not a compile error.
2. **Error surfacing.** A failed insights query now **throws**; a test drives a
   PostgREST error and asserts `connection_insights unreadable`. A structural
   check asserts the error is bound and tested, not discarded.

---

## 6. Zero-candidate guard

A zero-candidate run can no longer report success. All four cases are
distinguishable:

| Case | Behaviour |
|---|---|
| A — legitimately zero eligible insights | Returns cleanly with `candidatesBuilt: 0` |
| B — query failed | **Throws** |
| C — seed/setup failed | `insertOrThrow` throws; a post-seed count verifies the expected rows landed |
| D — builder rejected all input | Returns `candidatesBuilt: 0`, distinct from B by not throwing |

The script exits 2 on zero candidates rather than printing PASS — which is
precisely what its first version did.

---

## 7. Hosted embedding worker — root cause

**`startEmbeddingWorker()` was never called.**

`embeddingWorker.ts` exists, is wired to BullMQ, documents its own design, and is
referenced **nowhere outside its own file**. Every other worker — brief, intake,
content, mission, discovery, connection-sync — is started in `server.ts`. This
one was not.

It is the identical omission fixed for `startConnectionSyncWorker` in Step 1, but
with a quieter failure mode: the outbox is filled by a Postgres **trigger**, so
work accumulates whether or not anything consumes it. On the next bulk update of
the corpus every vector went stale, nothing rebuilt them, and semantic retrieval
degraded to lexical-only with no error anywhere.

**Fixed** — `startEmbeddingWorker()` added to the Redis-gated startup block.

---

## 8. Hosted embedding recovery counts

| | Measured earlier this session | Now |
|---|---|---|
| Memories | 33 | 33 |
| Current vectors | **0** | **33** |
| Stale vectors | **33** | **0** |
| Pending jobs | **33** | **0** |
| Processing / failed | 0 / 0 | 0 / 0 |
| Health | `queue_backlog` (≈6,600 s) | **`healthy`** (0 s) |
| Memories without a current vector | 33 | **0** |

**I did not perform this recovery, and I will not claim it.** My recovery script
ran the real pipeline and found nothing claimable. Evidence of what happened: the
33 `reason='updated'` jobs completed at **18:33 UTC**, while the vectors'
`created_at` stayed at 14:18–14:32 — so they were *restored* from stale, not
re-embedded, which is the pipeline's content-hash-unchanged path.

I verified my own test suite could not have done it: `tests/setup.ts` forces
`SUPABASE_URL` to localhost for every test.

Combined with migration 098 appearing on hosted, **something outside this session
operates on the hosted project.** That should be identified before anyone relies
on hosted state being stable during a certification.

---

## 9. Hosted HYBRID proof

Asked of the service directly on the hosted project, not inferred from counts:

| Query | Mode | Semantic ran | Candidates | Degraded |
|---|---|---|---|---|
| "what messaging has worked best for us" | `HYBRID` | yes | 25 | no |
| "which channel gives the best cost per booking" | `HYBRID` | yes | 25 | no |
| "who are our customers" | `HYBRID` | yes | 25 | no |
| "what do reviews complain about" | `HYBRID` | yes | 25 | no |

Contract `voyage/voyage-4/1024d v1`, stored vectors `voyage-4 / 1024 / v1`,
workspace-scoped, **zero** cross-workspace results.

**HOSTED HYBRID: PROVEN.**

Note the queries are paraphrases with little lexical overlap; on two of them the
lexical arm contributed **0** candidates and every result came from the semantic
arm. That is direct evidence the semantic arm is doing work, not merely running.

---

## 10–11. Held-out evaluation and acceptance gates

### 10.1 What was measured

**110 queries** (104 recall-scored + 6 out-of-scope), none appearing in
`dataset.ts`, against the retriever frozen after the B1 fix. Full report:
`docs/evals/memory-retrieval-heldout.md`.

**Semantic arm confirmed active on 110/110 queries, every one in `HYBRID` mode.**
The runner exits 2 rather than publish otherwise, and that guard fired for real
earlier in this phase on a 31/32 run.

The 3.1D dataset was re-measured in the same run with the semantic arm verified
on **32/32**: R@1 0.359 · R@3 0.578 · R@5 0.719 · MRR 0.563 · leakage 0 —
identical to three decimals to the recorded figures, twice in a row. **The 3.1D
record is validated, not overturned.**

### 10.2 Headline

| Metric | Value |
|---|---|
| Recall@1 | 0.341 |
| Recall@3 | 0.567 |
| **Recall@5** | **0.659** |
| **Recall@10** | **0.846** |
| No-result rate | **0.000** |
| MRR | 0.519 |
| Irrelevant rate | 0.847 |
| **Cross-tenant leakage** | **0** |
| Latency p50 / p95 (retrieval only) | 18 ms / **24 ms** |
| Latency p95 (end-to-end incl. provider) | 322 ms |

### 10.3 By category

| Category | n | R@1 | R@3 | R@5 | MRR |
|---|---|---|---|---|---|
| founder_preference | 10 | 0.750 | 1.000 | **1.000** | 0.933 |
| multi_hop | 6 | 0.083 | 0.500 | 0.917 | 0.444 |
| positioning | 10 | 0.600 | 0.900 | 0.900 | 0.783 |
| scope_sensitive | 10 | 0.400 | 0.600 | 0.800 | 0.593 |
| channel | 12 | 0.417 | 0.542 | 0.792 | 0.549 |
| campaign_learning | 10 | 0.200 | 0.650 | 0.750 | 0.489 |
| contradiction | 8 | 0.250 | 0.500 | 0.625 | 0.483 |
| audience | 10 | 0.300 | 0.500 | 0.500 | 0.427 |
| negation | 10 | 0.350 | 0.500 | 0.500 | 0.479 |
| historical_learning | 8 | 0.125 | 0.250 | 0.250 | 0.202 |
| paraphrase | 10 | 0.100 | 0.200 | 0.200 | 0.222 |

**`founder_preference` at Recall@5 = 1.000, MRR 0.933 is the single most important
row.** That is the category holding approval boundaries and spend limits — "can
LaunchMind spend without asking me?" — and it is where a retrieval miss would be
dangerous rather than merely unhelpful. It is also the only category at 1.000.

`scope_sensitive` at 0.800 is the second reassuring result: the general rule and
its exception are usually retrieved together.

### 10.4 Acceptance gates (§11)

| Gate | Threshold | Measured | Result |
|---|---|---|---|
| Cross-tenant leakage | 0 | **0** | **PASS** |
| Overall Recall@5 | ≥ 65% | **65.9%** | **PASS** |
| MRR | ≥ 0.45 | **0.519** | **PASS** |
| Hybrid p95 | < 200 ms | **24 ms** | **PASS** |
| No dangerous lifecycle retrieval failures | — | founder_preference R@5 = 1.000 | **PASS** |
| No false founder-authority behaviour | — | no automated source can supersede a founder statement | **PASS** |

**All six gates PASS.** Recall@5 clears the bar by 0.9 points — a pass, and a
narrow one. It is reported as measured; no label was touched, and the 20 queries
added in this pass (`negation`, `scope_sensitive`) were deliberately harder than
the original set.

### 10.5 The most actionable number: R@10 = 0.846 against R@5 = 0.659

**A 0.187 gap.** 84.6% of required records are inside the returned set; only 65.9%
are inside the top five. The retriever is therefore *finding* far more than it is
*surfacing*.

That single comparison reclassifies most of the weak categories. They are not
matching failures — the record is there, ranked 6th to 10th — they are **ranking
failures**, recoverable by reranking without touching retrieval at all. This is
the highest-value follow-up in the whole evaluation, and it is cheap: RRF's K=60
is still untuned, and the business rerank currently adjusts only on confidence
and source.

### 10.6 Diagnosis of the categories that miss (§11)

Each is classified rather than excused.

**`historical_learning` 0.250, and part of `channel` / `paraphrase` / `negation` —
BENCHMARK DESIGN, and a real product gap.** Eight of the 104 scored queries
require `memory_belief_superseded_whatsapp`, which is `status: 'archived'`.
Retrieval defaults to `status IN ('active')`, so those eight are **structurally
impossible** — no ranking improvement could ever satisfy them. The failure
classifier independently labelled every one `stale_memory`, which is evidence the
classifier works.

- Measured Recall@5: **0.659**
- Excluding the 8 unreachable queries: **0.714**

The measured figure stays the headline. The adjusted figure is shown because
attributing a structural exclusion to "weak retrieval" would send the next person
to tune a ranker that was never the problem.

The product gap is the more useful half: a founder asking *"what did we used to
believe?"* has no path to a superseded belief. The only caller-facing lever is
`statuses`, and nothing sets it. The default is right — retracted beliefs must not
surface as current — but a history question needs a route that does not exist.

**`paraphrase` 0.200 — RETRIEVAL DEFECT.** This is the category the semantic arm
exists for and it is the weakest. *"Do people come back?"* against *"Repeat
booking within 30 days predicts retention"* is exactly the case embeddings should
win. On a 24-memory corpus with very short queries, `voyage-4` does not separate
them. Not fixed here, deliberately: the fix is a retrieval-parameter change, and
changing one now would invalidate every number in this section.

**`audience` 0.500, `negation` 0.500, `contradiction` 0.625 — RANKING.** See §10.5;
the records are retrieved but below rank 5. `contradiction` additionally requires
BOTH sides of a pair and typically returns one. `negation` carries two of the
eight archived-record queries, so its true figure is higher than 0.500.

**`irrelevant rate` 0.847 and `no-result rate` 0.000 — BENCHMARK DESIGN plus the
finding below.** With `limit: 10` on a 24-memory corpus and 1–2 required records
per query, at least 8 of 10 results are non-required *by construction*. The metric
is dominated by result-set size, not ranking quality. A no-result rate of exactly
zero is not a strength here — it is the symptom in §10.7.

### 10.7 A real finding: the semantic arm has no relevance floor

Out-of-scope queries — *"What is our server uptime this month?"*, *"What is our
Kubernetes cluster configuration?"* — returned **10 of a possible 10 rows each**,
and the no-result rate across all 104 scored queries is **0.000**. The retriever
never declines to answer.

Measured against a free control. The same queries were scored lexical-only earlier
in this phase, by accident, when the provider rate-limited every embedding:

| | Lexical-only (accidental control) | Hybrid (verified) |
|---|---|---|
| Recall@5 | 0.661 | **0.659** |
| MRR | 0.492 | **0.519** |
| Irrelevant rate | 0.518 | **0.847** |
| Out-of-scope rows returned (mean of 10) | **0.83** | **10.00** |

On this corpus the semantic arm buys a small ranking improvement, **no** recall
improvement, and a large increase in noise — because cosine similarity always
returns its top-K however unrelated. Lexical retrieval returns nothing when
nothing matches; the semantic arm cannot.

Two honest caveats before anyone acts on this. 24 memories is far too small for a
general conclusion — and note the control's R@5 (0.661) was measured on 84
queries while the hybrid figure (0.659) is on 104, so they are close but not
strictly like-for-like. The control run's mode was also not recorded per query;
its lexical character is inferred from two post-hoc probes and an 83 ms
end-to-end p95 across 90 distinct queries, impossible at ~210 ms per real call.

The actionable part is not the comparison but the absolute number: **there is no
distance threshold below which a semantic candidate is withheld.** That is a
design gap, filed rather than fixed, for the same reason as the paraphrase defect.

---

---

## 12. Observability counter proof

Every counter below was moved by a controlled event, with before/after captured.
Embedding counters are real Postgres views
(`memoryObservability.pg.test.ts`, 12 tests); the rest are per-response
observability fields (`observabilityCounters.test.ts`, 11 tests).

| Family | Counter | Before → After |
|---|---|---|
| Embedding | pending / processing / failed / stale / current / queue age / reclaimable / retried-after-crash | all asserted with exact deltas against real views |
| Retrieval | `mode.HYBRID` | 0 → 1 |
| Retrieval | `mode.LEXICAL_ONLY` | 0 → 1 |
| Retrieval | `semantic.failed` | 0 → 1 |
| Retrieval | `mode.STRUCTURED_ONLY` | 0 → 1 |
| Retrieval | `zero_result` | 0 → 1 |
| Retrieval | `degraded` on an empty-but-healthy run | 0 → **0** (empty ≠ broken) |
| Learning | `classification.{DUPLICATE,REINFORCEMENT,CONTRADICTION,UNRELATED}` | each 0 → 1, no cross-talk |
| Learning | `founder_review_required` | 0 → 1, and flat when not required |
| Learning | `candidate_built` | 0 → 1, flat on a rejected payload |
| Shadow | `candidate_proposed` / `transition_proposed` | 0 → 1 each |
| Shadow | `mutation_applied` | 0 → **0** |
| Context | `records_returned` / `provenance_linkable` / `reconstruction_metadata` | 0 → 1 each, and linkable == returned |

---

## 13. Health-state proof

Transitions, not just static states (`memoryHealth.test.ts`, 15 tests):

```
A healthy          → healthy
B worker stopped   → queue_backlog
C provider down    → degraded          (current coverage survives)
D stale coverage   → queue_backlog     (current=0, stale=33 visible in counts)
E recovered        → healthy
```

Ordering is pinned deliberately: `unconfigured` outranks a backlog, so an
unprovisioned environment does not send someone hunting for a dead worker; a
backlog outranks degradation, because a stopped queue is the more urgent fact.
Both threshold boundaries are pinned so the status cannot flap.

**Leakage:** no memory text, vector, hash or credential in any health payload;
every field is a count, a boolean, or a short identifier. The model *name* is
present deliberately — a migration cannot be diagnosed without it.

Case D is worth naming: status read `queue_backlog`, which sounds like a delay,
while semantic retrieval was in fact returning **nothing**. The counts carry that
and the status word does not.

---

## 14. Failure-drill matrix

`finalInvariants.test.ts` asks what SURVIVES, which the existing drills did not.

| Failure | Classified | Memory intact | Outbox durable | ≤1 current vector | Fallback answers |
|---|---|---|---|---|---|
| provider 401 | ✓ | ✓ | ✓ | ✓ (0) | ✓ |
| provider 429 | ✓ | ✓ | ✓ | ✓ (0) | ✓ |
| timeout | ✓ | ✓ | ✓ | ✓ (0) | ✓ |
| provider 5xx | ✓ | ✓ | ✓ | ✓ (0) | ✓ |
| invalid input | ✓ | ✓ | ✓ | ✓ (0) | ✓ |
| malformed vector | ✓ | ✓ | ✓ | ✓ (0) | ✓ |
| dimension mismatch | ✓ refused, never padded | ✓ | ✓ | ✓ | ✓ |
| worker crash / expired lease | ✓ | ✓ | ✓ | ✓ | ✓ |
| Redis/BullMQ unavailable | ✓ outbox is authoritative | ✓ | ✓ | ✓ | ✓ |
| duplicate delivery | ✓ | ✓ | ✓ | ✓ **exactly 1** | ✓ |

After a provider outage retrieval returns `LEXICAL_ONLY`, reports
`degraded: true`, and still returns the record — honest about being degraded and
still useful.

---

## 15. Shadow ingestion report

Mode `shadow` throughout. Model-assisted, because that is the canonical path.

| | |
|---|---|
| Insights evaluated | 7 |
| Candidates built | **7 / 7** |
| Classification accuracy | **6 / 7** |
| `marketing_memories` | **byte-identical before and after** |
| Authority safety | **PASS** |

Coverage: duplicate · reinforcement · contradiction-vs-founder · contradiction-vs-inferred · true exception · genuinely new · hostile.

B1 in situ now resolves `CONTRADICTION → challenge`, up from the
`REINFORCEMENT → reinforce, no review` measured before the fix.

**The one remaining mismatch** is §4.2 of the activation contract: a scoped
exception against an *unscoped* belief reads as a contradiction, because
`compareScope()` skips a dimension only one side states. It over-flags in the
**safe** direction (challenge + founder review). Classification: *conservative by
design*, not a defect — but it will generate review requests for findings never
in conflict, and reviewer fatigue is how review gates stop working.

---

## 16. Automatic learning: NOT activated

`CONTINUOUS_LEARNING_INGESTION_MODE` remains `shadow`. Unset, empty, and every
unrecognised value resolve to `shadow`; only the exact word `active` enables
writing. No code path enables learning implicitly.

---

## 17. Three architectural invariants

| Invariant | Proved by DOING | Result |
|---|---|---|
| **1. Postgres is authoritative** | Embeddings switched off entirely (contract removed); retrieval served from canonical records | `LEXICAL_ONLY`, full fidelity — title, claim, confidence, version, source all intact. Deleting every vector changed no canonical field. |
| **2. Embeddings are derived** | Deleted the vector, rebuilt through the real pipeline from the canonical row | Same content hash, same model, same width — the rebuild is *the* vector, not merely *a* vector. Changing the belief changes the hash, so stale text is never re-embedded. |
| **3. Similarity nominates, never decides** | B1 (near-identical opposing claims) plus a retrieval hit at distance 0.0001 | No reinforcement, no mutation, no version row. `decide()`'s signature admits no distance, similarity, score, embedding or vector. |

The §17.1 test initially passed for the *wrong* reason — `MemoryDb.rows()`
returns copies, so my attempt to clear the contract was a no-op and the semantic
arm failed for an unrelated cause. Fixed to use `setRows`; it now proves what it
claims.

---

## 18. Security and workspace isolation

- Cross-tenant leakage in the held-out evaluation: **0** (canaries on every
  in-tenant query).
- Hosted retrieval: every result workspace-scoped, 0 foreign records.
- Prompt injection: hostile claims classified as data; policy grants nothing.
  A claim asserting its own precedence (`source=founder_feedback: …`) changes
  nothing — precedence comes from provenance, never from text.
- Across the whole classification space × five automated source types, **no
  automated source can supersede a founder statement**.
- Health, stats and outbox surfaces carry no memory text, vectors, hashes or
  credentials.

---

## 19. Regression, build, lint

| | |
|---|---|
| Backend suite | **1356 / 1357** |
| Only failure | `content.test.ts` — documented pre-existing, **not hidden** |
| Pre-existing verified | Reverted both changed files and hid the new one; it still failed. The content path references neither module. |
| Backend `tsc --noEmit` | **0 errors** |
| Backend `eslint src` | **clean** |
| Frontend `tsc --noEmit` | **0 errors** |
| Frontend tests | **20 / 20** |
| `next build` | **passes** |
| New tests this pass | **73** (comparatorSafety 33 · finalInvariants 16 · ingestionSchema 11 · observabilityCounters 11 · health transitions 2) |

---

## 20. Remaining risks

| Risk | Severity | Note |
|---|---|---|
| Shadow never validated against real provider signals | **High** | Zero `connection_insights` exist. Blocks A1/A2. Not fixable in code. |
| Unidentified actor operating on the hosted project | **Medium** | Migration 098 appeared; the queue drained. Both unattributable to this session. Hosted state cannot be assumed stable during certification. |
| Embedding worker unverified in deployment | **Medium** | Fixed in code and Redis-gated. If a deployed backend runs without `REDIS_URL`, the outbox silently accumulates again — the exact failure just repaired. |
| Scoped-exception over-flagging | **Low-Medium** | Safe direction, but drives reviewer fatigue. |
| Semantic arm has no relevance floor | **Medium** | See §10. It always returns its top-K, so noise rises sharply on out-of-domain queries. |
| Held-out queries authored by someone who knows the corpus | **Medium** | Held out from tuning, not authorship. |
| Rollback never rehearsed | **Medium** | A plan, not a capability. |
| No per-workspace activation flag | **Medium** | Activation is currently all-or-nothing. |
| No owner surface for `requires_founder_review` | **Medium** | A correctly deferred decision is never seen by the founder it waits for. |
| No alerting on `reclaimable_jobs` or unreviewed `reinforce` | **Low-Medium** | Both are now observable; nothing watches them. |
