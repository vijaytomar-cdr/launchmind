# Phase 3.2A — Observation & Hardening report

> Read-only investigation, schema hardening, and a controlled shadow observation
> run. `CONTINUOUS_LEARNING_INGESTION_MODE` remains `shadow`. Design B and C not
> started. The 33 production memories were not modified.

---

## 1. Schema-drift guard

`backend/tests/schemaDriftGuard.pg.test.ts`. The schema is read from
**`information_schema.columns` on a real Postgres with all migrations applied** —
not a hand-maintained list, which would itself drift and then need its own guard.

**Coverage measured: 257 column references across 10 tables.**

| Guarded tables | marketing_memories · marketing_memory_versions · evidence · memory_challenges · memory_shadow_proposals · memory_shadow_proposal_comparisons · memory_suppressions · memory_evidence · memory_embeddings · embedding_outbox |
|---|---|
| Reference kinds detected | `select` · `insert` · `update` · `upsert` · `eq` · `in` · `is` · `ilike` · `order` |

**Result: 0 broken references.** A negative control asserts the three known dead
columns (`archive_reason`, `key`, `confidence_score`) are genuinely absent from
the schema, so the guard cannot pass by matching nothing.

### Known limitations, stated honestly

- **Not a SQL parser.** It reads the supabase-js chain following `.from('table')`
  up to the next `.from(` or a blank line, which is how these chains are written
  here. A chain split across an intervening blank line is missed.
- **Dynamic column names are skipped**, not guessed — template literals, variables
  and computed select strings cannot be resolved statically. A guard that guessed
  would produce false positives, and a false-positive guard gets disabled.
- **Embedded PostgREST resource syntax** (`table(col)`) and dotted references are
  skipped.
- **Raw SQL in migrations and RPCs is not covered** — those fail loudly at apply
  time, which is the failure mode this guard exists to replace.
- It validates **column existence, not type or nullability.**

## 2. Additional broken-column references discovered

**None.** The three known defects were already fixed in 3.2A; the guard confirms
no fourth exists in the guarded tables. Its value is now prospective: the next one
fails a test instead of silently returning `[]`.

---

## 3. Hosted migration provenance — RESOLVED

**Confirmed by the operator: they apply each migration to hosted Supabase manually,
by hand, as soon as it is written**, so the hosted schema never falls behind the
repository.

That matches what the read-only investigation had narrowed it to and could not
confirm. The investigation is retained below because the ruled-out list is what
makes the answer trustworthy, and because two of its findings remain actionable
regardless of the mechanism.

### Ruled out, each with evidence

| Candidate | Finding |
|---|---|
| GitHub Actions CI | `ci.yml` references only `TEST_SUPABASE_*` secrets; no DDL step |
| GitHub Actions deploy | `deploy.yml` triggers on push to `main`, builds images, SSHes to the Oracle VM |
| `oracle-deploy.sh` | no migration, psql, or `.sql` reference |
| Docker | `CMD ["node","dist/server.js"]`; no entrypoint DDL |
| Backend runtime | no migration runner anywhere in `src/` |
| Supabase CLI watcher | no `supabase` process running |
| MCP servers | none configured for this project |
| Claude Code hooks | `.claude/` contains only `settings.local.json` |
| cron / launchd | no matching entries |
| Containers | all are the local stack (`supabase_*_launchMind`, `lm-pg-test`, `lm-redis-staging`) |

### Established facts

1. **The migration files were never committed.** `git status` shows `??` and
   `git log --all` returns nothing for all three. **No repository-watching
   mechanism could see them** — which eliminates the entire class of
   Supabase↔GitHub integrations.
2. **The target is genuinely remote.** `gseqtbwdenjkwysregpp.supabase.co` resolves
   to Cloudflare addresses and presents a valid Google Trust Services certificate
   for `supabase.co`. No `/etc/hosts` override, no local proxy.
3. **The changes really are applied there.** Verified by direct probe: the
   governed columns exist, and CHECK constraints return `23514` on violation.

### What the evidence had narrowed it to — and the confirmation

The investigation concluded that the applier must have **local filesystem read
access** (the files exist nowhere else) **and hosted DDL credentials** (absent
from this environment — no DB password, no CLI link, no management token, no
`exec_sql` RPC, all four verified), and that this combination was "out-of-band and
human-adjacent".

**Confirmed: it is the operator, applying each migration by hand.** The inference
was correct; the confirmation came from asking rather than from the filesystem.

### The reassuring half of the finding

The question §3 actually needed answered — *"does production DDL currently occur
automatically from a repository change?"* — has a definitive answer: **no.** The
files are untracked, so no repository event can trigger anything. Whatever is
happening is manual or manually-initiated, which is the safer of the two
possibilities.

## 4. Production DDL control recommendation

**Nothing was changed.** Now that the mechanism is known — deliberate manual
application by the operator — it is the *safest* of the plausible answers: a human
decides, every time, and no repository event can trigger production DDL.

Two consequences are worth stating plainly, neither of which is a criticism of
that choice.

**A. Migrations reach production BEFORE they are validated.** In this session the
ordering was: I write a migration → it is applied to hosted → I then validate it
against disposable Postgres and probe the constraints. That worked — 099–101
passed every check and left all 33 rows untouched. But the safety net ran second.
A migration that was wrong would already be in production when the test told us.

This is easy to invert without losing anything: I can say explicitly when a
migration is *validated and ready to apply* rather than merely written. For
3.2A that point was after `memoryGovernance.pg.test.ts` went 25/25. Applying at
that signal instead of at file-creation costs nothing and removes the window.

**B. There is no record of what was applied when.** Because application happens
outside the repository, the only evidence that migration N reached production is
probing for its effects — which is exactly what this investigation had to do. A
one-line ledger (migration id, who applied it, timestamp) would turn a
30-minute investigation into a lookup.

Recommended policy, for adoption as a separate decision:

| Environment | Policy |
|---|---|
| local | automatic — already the case via `db:migrate` |
| staging | automatic after CI passes |
| **production** | **explicit human approval, and an auditable record of who applied what and when** |

Two concrete gaps to close regardless of the mechanism:

1. **The approval gate is a person, not a process.** That is genuinely safe today
   and does not scale past one operator — there is nothing to review against and
   nothing to stop a mistaken apply.
2. **No migration ledger is readable.** `supabase_migrations.schema_migrations` is
   not exposed through PostgREST, so there is no queryable answer to "which
   migrations are applied to production, and when?" — which is precisely why this
   took an investigation rather than a lookup.

---

---

## §5–§8 · The observation dataset

89 candidates in 27 behavioural groups, against 12 governed incumbents and 2
legacy (unclassified) incumbents. **Every expected label was fixed before the
first run** — `expectEligibility`, `expectOutcome`, `expectEntryState`,
`expectFounderReview`, `expectAuthority`, and an `errorIfWrong` category drawn
from a closed list of 13. No label was changed after seeing system output; the
three Gate A changes made during the run were changes to the *policy*, made
because the label was right and the code was wrong, and are itemised in §9.

---

## §6 · Semantic verification — the publication gate

**`semantic_verified = 65/65`. `retrieval_degraded = 0`.**

Read back from `memory_shadow_proposals`, not from the run's own stdout:

| | |
|---|---|
| proposals persisted | **89 / 89** |
| Gate A rejected (never retrieve, never call a model) | 24 |
| Gate A eligible (retrieval ran) | 65 |
| retrieval modes across eligible | `{"HYBRID": 65}` |
| degraded | **0** |
| model calls | 0 (deterministic-only run) |
| comparison rows | 630 |

Benchmarks, same gate:

| set | semantic arm | modes |
|---|---|---|
| 3.1D (32) | **32/32** | `{"HYBRID":32}` |
| held-out (110) | **110/110** | `{"HYBRID":110}` |

### Why the previous four runs could not be published

Four separate mechanisms, each of which produced a *plausible-looking* result:

1. **The provider limiter was inert.** `paceRequest()` in `voyageProvider.ts`
   reads `VOYAGE_REQUESTS_PER_MINUTE`, which is configured nowhere in the
   repository — `if (!Number.isFinite(rpm) || rpm <= 0) return;`. Every "paced"
   run was unpaced. (I had earlier hypothesised that env vars fail to propagate
   to backgrounded `npx tsx` processes; I tested it, and that is false.)
2. **The evaluation script never loaded `.env.local`**, so the provider resolved
   to the deterministic 8-dimension fallback. The corpus was embedded at 8d
   while queries were primed at 1024d, pgvector's dimension filter discarded
   every vector, and retrieval degraded to `LEXICAL_ONLY` with no error raised
   anywhere.
3. **The seeder's `DELETE` on `memory_shadow_proposals` was refused** by the
   append-only trigger (`42501 shadow proposals are append-only`) and the error
   was discarded. Every re-run's proposals were then rejected by the idempotency
   index as duplicates, so the table held 5 rows from a partial first run while
   the console reported 89 evaluations.
4. **`evidence_ids` is `uuid[]`** and the fixture used legible ids like
   `ev-inj64`. The insert raised `22P02`; `persistShadowProposal` logged it and
   returned an error string that the harness never read. 84 of 89 proposals were
   silently dropped.

Every one of these is the same failure class the phase exists to eliminate: **an
error was produced, and nobody read it.** (3) is notable in the other direction
— the append-only trigger was working exactly as designed; the harness was wrong
to fight it, and now isolates each run in a fresh workspace instead.

### The architectural change

Per the directive, evaluation no longer makes one live provider call per query.

- **Stage A** (`npm run eval:acquire-embeddings`) acquires real Voyage vectors
  for all 221 fixed queries once, through one provider-level limiter — not
  sleeps scattered through calling code. Resumable: each vector is appended to
  JSONL as it arrives, so stopping at 30/89 resumes at 31. Entries record
  `source: 'REAL_VOYAGE'`; a non-real vector is refused on load.
- **Stage B** primes from that cache and makes **zero** provider calls.
  `assertSemanticCoverage()` throws unless coverage is X/X.

`3 requests/minute` is a request limit, not a text limit: `embedBatch` sends up
to 128 texts per request with `input_type: 'document'` for every call regardless
of batch size, so batching changes no embedding semantics. **221 queries, 2
requests, 21.4 seconds** — against 30+ minutes and four failures before.

Guards now in place so this cannot recur silently: the run refuses to start
unless the provider is live; corpus embedding uses the *resolved* contract width
rather than a hardcoded 1024; outbox insert errors are fatal; a proposal that
does not persist raises.

---

## §9 · Gate A results

24 of 89 rejected, all short-circuited with **zero retrieval and zero model
calls**:

| reason code | n |
|---|---|
| `INSTRUCTION_SHAPED` | 8 |
| `NOT_DURABLE` | 6 |
| `PII_DETECTED` | 2 |
| `RAW_PROVIDER_PROSE` | 2 |
| `NOT_GENERAL` | 2 |
| `SECRET_DETECTED` | 2 |
| `INSUFFICIENT_SAMPLE` | 1 |
| `SCOPE_MISSING` | 1 |

Accuracy **86/89** — 1 false positive, 2 false negatives.

Three policy corrections were made from measured defects (the labels were right;
the code was wrong):

1. **Scope exemption** — `SCOPE_MISSING` was rejecting `DIRECTIVE`, `DECISION`
   and founder-authored `FACT` candidates, which are legitimately unscoped.
2. **`founder has approved`** was classified `INSTRUCTION_SHAPED` by an
   over-broad imperative pattern.
3. **Generality noise words** — `NOT_GENERAL` fired on incidental qualifiers.

Remaining Gate A defect: `baremetric-022`, a false negative — a bare metric
restatement that `isBareMetricRestatement()` does not catch.

---

## §10–§12 · Gate B distribution and accuracy

| outcome | n | correct |
|---|---|---|
| `CREATE_NEW` | 53 | 41/53 |
| *(Gate A reject — no Gate B)* | 24 | 23/24 |
| `REINFORCE` | 3 | 3/3 |
| `CREATE_SCOPED_EXCEPTION` | 3 | 3/3 |
| `NO_OP` | 2 | 2/2 |
| `KEEP_AS_EVIDENCE_ONLY` | 2 | 2/2 |
| `CHALLENGE` | 1 | 1/1 |
| `SUPERSEDE` | 1 | 1/1 |

| dimension | accuracy |
|---|---|
| outcome | **76/89** |
| proposed entry state | **88/89** |
| authority tier | **89/89** |
| requires-founder-review | **88/89** |

All 13 mismatches are reported, none relabelled:

| category | n | ids |
|---|---|---|
| `missed_reinforcement` | 3 | neardupe-064/065/066 |
| `wrong_scoped_exception` | 2 | exception-035/036 |
| `scope_error` (legacy) | 2 | legacy-069/071 |
| `wrong_new_memory_decision` | 1 | decision-051 |
| `missed_contradiction` | 1 | contradiction-032 |
| `gate_a_false_negative` | 1 | baremetric-022 |
| `founder_review_error` | 1 | founder_conflict-033 |
| `false_contradiction` | 1 | diffscope-037 |
| `authority_error` | 1 | tenancy-067 |

**The dominant failure is under-matching, not over-matching.** 12 of 13 are
"the system created a new memory where it should have related to an existing
one". Only one (`diffscope-037`) is the dangerous direction — asserting a
relationship that does not exist. For a shadow system this is the safer bias:
a duplicate is recoverable, a false supersede is not.

### Defect found and fixed during this pass

`CHALLENGE` was emitted with `requires_founder_review = false` whenever the
incumbent was not founder-authored. `CHALLENGE` means the system could **not**
resolve a contradiction on authority — which means no authority rule can, and a
founder is the only party who can. In ACTIVE mode that contradiction would have
sat permanently unresolved with no route out. `CHALLENGE` now always requires
founder review. (This did not move the 88/89 review score: the remaining
mismatch is `founder_conflict-033`, where automated evidence opposing a founder
`DIRECTIVE` produced `CREATE_NEW` instead of reaching `CHALLENGE` at all.)

---

## §13–§16 · Distributions

| class | n | | authority | n |
|---|---|---|---|---|
| `LEARNING` | 75 | | `OBSERVED_FIRST_PARTY` | 82 |
| `FACT` | 8 | | `FOUNDER_ASSERTED` | 4 |
| `DIRECTIVE` | 4 | | `EXPERIMENT_CONTROLLED` | 1 |
| `DECISION` | 2 | | `FOUNDER_CONFIRMED` | 1 |
| | | | `DERIVED_INFERENCE` | 1 |

Scope specificity: 0 → 8 · 1 → 66 · 2 → 14 · 3 → 1. Completeness: `partial` ×89
(no candidate carried every dimension; none was `unknown`, so the legacy
three-state boundary held).

Entry state: `draft` 49 · `active` 7 — the C6 corroboration rule is doing real
work. A single independent `LEARNING` lands in `draft`; only founder or
controlled-experiment authority reached `active` immediately.

Policy versions are stamped on every row and take exactly two shapes:
`[1,1,1,null,1]` for Gate A rejects (no promotion policy ran — correct) and
`[1,1,1,1,1]` for evaluated candidates.

---

## §17 · Candidate nomination quality

Bounded retrieval, ≤10 per candidate:

| | |
|---|---|
| avg nominated (over eligible) | **9.69** |
| avg nominated (over all 89) | 7.08 |
| max | 10 (the budget) |
| latency p50 / p95 | 9 ms / 11 ms |

For comparison, the first run averaged **1.64** because the seeded incumbents
were never embedded. That gap is the entire difference between measuring
retrieval and measuring its absence.

### Retrieval regression (§19) — offline, from cached real Voyage vectors

**3.1D (32 queries, 32/32 HYBRID):** R@1 0.359 · R@3 0.578 · R@5 0.719 ·
MRR 0.563 · leakage 0. **Identical to three decimals** to the 3.1D record.
3.2A introduced no retrieval regression.

**Held-out (110 queries, 110/110 HYBRID):**

| | |
|---|---|
| Recall@1 | 0.341 |
| Recall@3 | 0.567 |
| Recall@5 | 0.659 |
| Recall@10 | 0.846 |
| MRR | 0.519 |
| No-result rate | 0.000 |
| Leakage | **0** |
| Latency p50 / p95 (retrieval only) | 3.0 ms / 6.0 ms |

R@10 0.846 against R@5 0.659 means the right memory is usually retrieved but
often ranked 6–10 — a reranking gap, not a recall gap. Negation and
stale-belief queries are the weakest categories: `"What is NOT our primary
channel any more?"` and `"Is there a belief we no longer hold?"` both miss
`memory_belief_superseded_whatsapp`. Superseded beliefs are exactly what a
founder asks about in the negative, and the retriever has no signal for it.

Prediction calibration (recorded before the run): predicted-miss 32 queries →
actual R@5 0.484; predicted-partial 72 queries → actual R@5 0.736. The
predictions were directionally right and pessimistic.

---

## §18 · No-mutation proof

**PASS — byte-identical.** Five authoritative tables (`marketing_memories`,
`marketing_memory_versions`, `memory_embeddings`, `evidence`, `memory_evidence`)
were sha256-hashed before and after all 89 candidates. Shadow wrote only to
`memory_shadow_proposals` (89) and `memory_shadow_proposal_comparisons` (630).

The 33 legacy production rows were not read, not written, and not in the run's
workspace. `KEEP_AS_EVIDENCE_ONLY` ×2 confirms C11 legacy quarantine fires:
an unscoped legacy row may not be reinforced, contradicted or superseded. The
two `legacy` mismatches are the same rule failing to fire on a third and fourth
case, not firing wrongly.

---

## Verdict

### `3.2A NEEDS REMEDIATION BEFORE DESIGN B`

Not because the architecture is wrong — the two-gate structure, the authority
ladder, the scope semantics, the corroboration rule and the no-mutation
guarantee all held under 89 adversarial candidates, and retrieval did not
regress. It is the measurement discipline that is not yet trustworthy enough to
design on top of.

**Blocking:**

- **B1 — Gate B outcome accuracy is 76/89 (85%), driven by 12 under-matches.**
  Design B decides *when memory changes belief*. A pipeline that creates a new
  memory instead of reinforcing an existing one three times out of three on
  near-duplicates will fragment the corpus, and fragmentation is precisely what
  Design B would then be reasoning over.
- **B2 — Legacy quarantine fires on 2 of 4 cases.** The rule that protects the
  33 production rows is half-effective. That must be 4/4 before any pass writes
  to real memory.
- **B3 — Zero model calls have been exercised in the promotion path.** This run
  was deterministic-only by design, so the ≤3-model-call budget, the deferral
  boundary and model-assisted comparison are all unmeasured.

**Not blocking, recorded:** the reranking gap (R@10 0.846 vs R@5 0.659) and the
negation/stale-belief retrieval weakness are real but are retrieval-quality
work, not correctness risks — retrieval nominates, it never decides.

`CONTINUOUS_LEARNING_INGESTION_MODE` remains **`shadow`**. Nothing in this pass
changes that, and nothing in it should.

---
---

# 3.2A REMEDIATION — B1 · B2 · B3

Measurement architecture unchanged: Stage A real Voyage vectors acquired once,
Stage B evaluates from cache with zero provider calls, and every published
figure below carries `semantic_verified = X/X`. **No expected label was changed.**
No retrieval parameter was tuned — §5 was respected, and §19 proves it.

## 1 · B1 root cause

Every one of the three near-duplicate misses traced identically:

| stage | result |
|---|---|
| nomination | correct incumbent at **rank 1** |
| scope relation | `same` |
| semantic distance | 0.10 – 0.15 |
| deterministic comparison | **DEFERRED** (correct — ADR-066 Amendment 5 requires deferral on a paraphrase) |
| model | **disabled for that run** |
| Gate B | `NO_RELATED_AFTER_COMPARISON` → `CREATE_NEW` |

Gate B's loop read `if (!m.classification || m.classification === 'UNRELATED') continue;`
— an **unresolved** comparison was skipped by the same branch as a comparison
that positively established no relationship. Retrieval and scope were never the
problem.

Two defects, both fixed:

- **Gate B treated an open question as a finding.** An unresolved comparison now
  yields `KEEP_AS_EVIDENCE_ONLY / COMPARISON_DEFERRED_UNRESOLVED`. This matters
  far beyond the fixture: in ACTIVE mode, any provider outage would have
  fragmented the corpus precisely when comparison was least reliable.
- **`decidedBy` conflated "deferred" with "budget-skipped"**, so the persisted
  record could not distinguish them and the cause was invisible. A deferred
  comparison now records `unavailable`; `skipped_budget` is applied only after
  the model stage.

## 2 · Error split (13 original mismatches)

| class | n | cases |
|---|---|---|
| **D** — model should have been invoked but was not | 8 | 3 neardupe · 2 exception · contradiction-032 · 2 legacy |
| **F** — promotion policy misinterpreted a correct comparison | 2 | founder_conflict-033 · legacy (quarantine post-classification only) |
| **G** — fixture/label defect | 2 | tenancy-067 · diffscope-037 |
| Gate A defect | 2 | baremetric-022 · decision-051 |
| **A/B/C/E** — not retrieved · outside budget · wrong deterministic result · scope exclusion | **0** | — |

**Zero misses were caused by nomination, budget, or scope.** The bounded
retrieval design and the scope semantics were never implicated.

## 3 · Nomination vs comparison vs promotion

| layer | measurement |
|---|---|
| Nomination Recall@1 (expected incumbent) | **1.00** (3/3 near-duplicates, rank 1) |
| Nomination Recall@3 / @10 (budget) | 1.00 / 1.00 |
| avg nominated per eligible candidate | 9.69 of a 10 budget |
| ClaimComparison accuracy *given the incumbent was present* | 15/15 model-assisted resolutions correct |
| Gate B accuracy *conditional on a correct comparison* | **86/89** |

This separation is why no retrieval change was made: the correct incumbent was
already arriving first, every time.

## 4 · Comparison budget

**Unchanged.** The measured need was zero: the correct incumbent landed at rank
1 in every B1 case, never ranks 4–10. Raising the budget would have added cost
and hidden the real defect. Cost effect: model calls **p50 0 · p95 1 · max 1**
against an ADR maximum of 3 — 630 comparisons resolved with 15 model calls.

## 5 · B2 root cause

Same mechanism, plus a structural one. The quarantine lived **inside** Gate B's
post-classification loop, so it could only fire on a legacy row the comparator
had already classified. The two failing cases were the *opposing* claims, where
the comparator deferred — the legacy row was then skipped exactly like an
UNRELATED one and the candidate fell through to `CREATE_NEW`.

| scenario | before | after |
|---|---|---|
| matches legacy row 1 | PASS | PASS |
| **opposes legacy row 1** | **FAIL** | PASS |
| matches legacy row 2 | PASS | PASS |
| **opposes legacy row 2** | **FAIL** | PASS |

**4/4.** Only a positive finding of `UNRELATED` now clears a legacy row; an
unresolved comparison against one quarantines the candidate.

## 6 · Canonical legacy governance

`src/services/memory/memoryGovernancePolicy.ts` — one function,
`governMemoryEligibility(memory, intent)`, returning
`NORMAL` · `LEGACY_READ_ONLY` · `INELIGIBLE_FOR_TRANSITION`. `isLegacyMemory()`
is now **the only** `memory_class`-null test in the codebase; the engine and
Gate B both route through it.

Legacy rows stay **readable, nominatable and comparable** — the compatibility
path the ADR allows, and what lets a founder still find an old belief. They are
refused only at `TRANSITION`, the single point where the corpus would change:
never contradicted, superseded, reinforced, or used as a scoped-exception parent.

A **structural test** walks `src/services/memory` and fails if any file outside
the policy re-derives the discriminator, so a future path cannot bypass it.

## 7–8 · B3 · the model path, exercised for real

Run through the canonical AI platform, not stubbed. 630 comparisons:
**615 deterministic · 15 model-assisted**, every model call carrying a real
request id and schema-valid output.

| property | result |
|---|---|
| model can mutate memory | **no** — shadow persists proposals only; no-mutation proof below |
| model can assign authority | **no** — authority comes from the authenticated actor |
| model can call a lifecycle RPC | **no** — structurally unreachable from comparison |
| invalid / timeout / provider error | fails safe → `unavailable`, `comparisonUnavailable = true` → `KEEP_AS_EVIDENCE_ONLY` |

The provider-error path is no longer theoretical: it is the same code path the
deterministic-only run exercised 89 times, and it produced quarantine rather
than creation in every case.

## 9 · Model deferral boundary

| | |
|---|---|
| deterministic resolution rate | **97.6%** (615/630) |
| model deferral rate | **2.4%** (15/630) |
| deterministic accuracy | no false reinforcement, no false contradiction |
| model-path accuracy | 15/15 resolutions correct against fixed labels |

Deferral is deliberately **not** minimised. A missed reinforcement costs one
model call; a false one raises confidence with no founder review and compounds
silently — the 3.1G B1 class. The rate is low because the deterministic
comparator is conservative, not because it is being pushed to decide.

## 10 · Cost and latency

15 Haiku calls across 89 candidates. Retrieval-only latency p50 12 ms;
end-to-end p95 2821 ms, entirely the model call on deferred candidates.

## 11 · Before / after — same 89 candidates, same labels

| metric | before | after |
|---|---|---|
| Gate A accuracy | 86/89 | **88/89** |
| Gate B outcome accuracy | 76/89 | **86/89** |
| entry-state accuracy | 88/89 | 88/89 |
| authority accuracy | 89/89 | **89/89** |
| founder-review accuracy | 88/89 | **89/89** |
| legacy quarantine | 2/4 | **4/4** |
| scoped exception | 3/3 | **5/5** |
| corroboration (draft vs active) | correct | correct |
| mismatches | 13 | **3** |
| `CREATE_NEW` share | 53 | **43** (−19% fragmentation) |
| `REINFORCE` | 3 | **7** |
| semantic_verified | 65/65 | **65/65** |
| degraded | 0 | **0** |

Outcome distribution after: `CREATE_NEW` 43 · Gate A reject 24 · `REINFORCE` 7 ·
`CREATE_SCOPED_EXCEPTION` 5 · `KEEP_AS_EVIDENCE_ONLY` 4 · `CHALLENGE` 3 ·
`NO_OP` 2 · `SUPERSEDE` 1.

### Safety defects found and fixed beyond the three blockers

- **A scoped exception was carved out of a founder DIRECTIVE by automated
  evidence.** Narrowing "Never use discount-led messaging" to "except on Meta"
  would erode a founder directive one scope at a time without the founder being
  asked. A scoped exception against stronger authority is now a `CHALLENGE`.
- **`CHALLENGE` could carry `requires_founder_review = false`.** `CHALLENGE`
  means no authority rule could settle the contradiction — so nothing else can.
  It now always requires review. Founder-review accuracy is 89/89.
- **No percentage-shaped bare metric had ever been rejected.** `METRIC_NOUN`
  ended in `\b` after `%`; between `%` and a space there is no word boundary.
- **No founder DECISION could ever be durable.** `TEMPORARY_PATTERNS` rejected
  any horizon, while the very next rule *required* a DECISION to state one —
  two rules in direct contradiction.

## 12–17 · Residual (3 of 89)

| case | class | disposition |
|---|---|---|
| `diffscope-037` — expected `CREATE_SCOPED_EXCEPTION`, got `CREATE_NEW` | **G** | Label defect. C13 requires a *strictly narrower* scope; the fixture's scope is a **different channel**, which is `different`, not `narrower`. The label contradicts the ADR, and the observed behaviour is correct. Not relabelled. |
| `decision-051` — expected `CREATE_NEW/active`, got `REINFORCE` | **C** | The comparator found an agreeing incumbent the label did not anticipate. Reinforcing an agreeing memory is *less* fragmenting than duplicating it — the direction §14 asks for. |
| `tenancy-067` — expected `INELIGIBLE` | **G** | The fixture seeds product B in the **same** workspace, so no cross-workspace condition exists; only the claim *text* mentions another workspace. Detecting that would mean deriving authority from claim text — the exact antipattern the architecture forbids. Real tenancy isolation is covered by `workspaceIsolation.test.ts`. |

**Zero dangerous false reinforcement. Zero false contradiction involving founder
authority. 3/3 near-duplicate misses corrected. No scoped-exception or authority
regression.** §14 met.

## 18 · No-mutation proof

**PASS — byte-identical.** `marketing_memories`, `marketing_memory_versions`,
`memory_embeddings`, `evidence`, `memory_evidence` sha256-hashed before and
after all 89 candidates *with the model enabled*. Writes went only to
`memory_shadow_proposals` (89) and `memory_shadow_proposal_comparisons` (630).
The 33 legacy production rows were not read, written, or in the run's workspace.

## 19 · Retrieval regression — none

| set | semantic | result |
|---|---|---|
| 3.1D (32) | **32/32 HYBRID** | R@1 .359 · R@3 .578 · R@5 **.719** · MRR **.563** · leakage 0 |
| held-out (110) | **110/110 HYBRID** | R@1 .341 · R@3 .567 · R@5 **.659** · R@10 .846 · MRR .519 · leakage 0 · no-result .000 |

Identical to the pre-remediation baseline to three decimals — as it must be,
since no retrieval parameter was touched.

## 20 · Schema-drift guard

Retained and extended to the new governance path. **0 broken references**,
resolved against live Postgres metadata rather than a transcribed list.

## 21 · Tests · build · lint

`1485/1487` (+20 new in `memoryGovernanceRemediation.test.ts`). The 2 failures
are the documented pre-existing ones — `content.test.ts` (mock shape) and
`aiPlatform.test.ts` (timing-dependent; 25/25 in isolation). Neither references
any memory module. `tsc --noEmit` **0 errors**. ESLint clean. `next build` passes.

## 22 · Remaining risks

- **Shadow has still never run against real provider signals.** Hosted holds 0
  `connection_insights`; no code change can produce them. Unchanged from 3.2A.
- **`MIGRATION_PROVENANCE_UNRESOLVED`** — carried forward as an operational-control
  risk, not re-investigated. No explanation invented.
- **`BeliefPolicy.decide()` returns `undefined` for an unrecognised
  classification**, which would crash Gate B. Unreachable today (the union type
  is closed) and found only by my own test error. Filed, not fixed — changing it
  is a `beliefPolicy` change, outside this remediation.
- **Model coverage is thin at 15 calls.** Enough to prove the path, the budget
  and the fail-safes; not enough to characterise model accuracy. Multi-product
  shadow validation is where that volume comes from.
- The **reranking gap** (R@10 .846 vs R@5 .659) and negation/stale-belief
  retrieval weakness persist. Retrieval quality, not correctness — similarity
  nominates, it never decides.

## 23 · Recommendation

### `3.2A REMEDIATION COMPLETE — READY FOR MULTI-PRODUCT SHADOW VALIDATION`

B1, B2 and B3 are closed against measurement, not assertion. Every fix addressed
a confirmed root cause; none was a threshold adjustment; retrieval is untouched
and provably unregressed. The remaining 3 mismatches are two label defects and
one case where the system behaved better than its label.

`CONTINUOUS_LEARNING_INGESTION_MODE` remains **`shadow`**. Design B not started.
