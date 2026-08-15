# Phase 3.1 — Gap analysis, 3.1B design, and failure modes

**Companion to:** `docs/adr/ADR-066-continuous-learning-memory-architecture.md`
**Baseline:** `docs/evals/memory-retrieval-baseline.md`
**Date:** 2026-08-09
**Status:** Design only. Nothing here is implemented. No migration exists.

---

## 1. Current architecture inventory (measured, not assumed)

### 1.1 Vector columns

| Table | Column | Dims | Non-null (hosted) | Written by | Read by |
|---|---|---|---|---|---|
| `products` | `icp_embedding` | 1536 | **0 / 11** | nothing | passed to `getSimilarSignals()`, which returns `[]` when null — i.e. always |
| `marketing_memories` | `embedding` | 1536 | **0 / 33** | nothing | nothing |
| `playbook_signals` | `signal_embedding` | 1536 | **0 / 206** | nothing | `match_playbook_signals` RPC — **not defined in any migration** |
| `embedding_store` | `embedding` | 1536 | **0 rows in table** | nothing | deleted by GDPR purge only |
| `knowledge_nodes` | `embedding` | 1536 | **0 / 18** | nothing | nothing |

> **Correction (3.1B):** the 3.1A inventory reported FOUR vector columns. There
> were five — `knowledge_nodes.embedding` was collapsed into
> `marketing_memories.embedding` by a census that deduplicated on column name.
> Found by a real-Postgres test asserting exactly one table carries a vector
> type. All five are retired by migration 090.

**pgvector:** extension enabled (`CREATE EXTENSION IF NOT EXISTS vector`), version **0.8.0** on Postgres **17.6**.
**ANN indexes:** none. Zero `USING hnsw` or `USING ivfflat` across all 87 migrations.
**Embedding-generation code:** none. No `embeddings.create`, no Voyage client, no `text-embedding` call anywhere in `backend/src`.
**Vector search functions/RPCs:** one referenced (`match_playbook_signals`), zero defined.

Net: the semantic layer is **declared but inert**. `playbookService`'s file header states "Vectors compared via pgvector `<=>` operator" — accurate as an intention, false as a description of running behaviour.

### 1.2 Retrieval

| Path | Query-aware? | Mechanism | Measured Recall@5 |
|---|---|---|---|
| `searchMemories()` | yes | `.or('title.ilike.%q%,content.cs.{"q"}')` — **malformed, errors, returns `[]`** | **0.0%** |
| same, defect removed | yes | `ILIKE '%<whole query>%'` on `title` | 9.4% |
| `buildContextPackage()` | **no** | top-N by `confidence`, identical for every question | 18.8%, 93.1% irrelevant |

`buildContextPackage(founderId, productId, opts)` reads 10 tables in parallel, each with a hard `.limit()` (memories 5, nodes 15, campaigns 10, metrics 30, context 1, goals 1, competitors 10, directions 1). So retrieval is **targeted in volume but not in relevance**: bounded row counts, chosen without reference to the question.

### 1.3 Integrity, provenance, tenancy

| Property | State |
|---|---|
| Dedup | Exact `ILIKE` on `title` + `memory_type` + `product_id`. No similarity. Matches ADR-022's synchronous tier; the async vector tier was never built. |
| Versioning | `updateMemory` snapshots into `marketing_memory_versions` **before** mutating and increments `version`. Works. |
| Append-only | **Convention only.** Zero `REVOKE` statements across migrations 035–040. Only `growth_brain_learning_events` (085) actually revokes UPDATE/DELETE. |
| Provenance to model | `MemoryEntry = {type, title, confidence, content}` — **no id, no version**. |
| AI audit | `ai_requests.context_sources TEXT[]` stores source *names* ("memories", "campaigns"), not record ids. No context package is persisted. |
| Tenancy | Memory tables are **founder-scoped** (`founder_id = auth.uid()`), not workspace-scoped. Divergent from the Step 2 tenancy model, which added `workspace_id` + `lm_is_workspace_member` to the connection stack. |
| Taxonomy | `memory_type` CHECK (11 values) + `MEMORY_TYPES as const` (11 values). Currently in agreement; nothing detects divergence. |

---

## 2. Gap analysis (Part 8)

| Rule | Current state | Gap | Step |
|---|---|---|---|
| 1 Postgres sole record | Holds in practice | No mechanism prevents regression | 3.1F |
| 2 Immutable history | Versions table exists, no REVOKE | History is silently mutable | **3.1B** |
| 3 No silent overwrite | Snapshot-before-write works | No trigger guards version monotonicity | 3.1F |
| 4 History classes distinguishable | `source` partially separates them | No `assertion_class` | 3.1F |
| 5 One embedding store | Four vector columns | Canonical table absent | **3.1B** |
| 6 Retire legacy vectors | 4 unused columns | Retirement not scheduled | **3.1B** |
| 7 Rebuildable | Nothing to rebuild | No rebuild path or test | 3.1C |
| 8 Required embedding metadata | `embedding_store` has none of it | New table needed | **3.1B** |
| 9 No authoritative text in embeddings | `embedding_store.content TEXT` **violates this today** | Must not be carried forward | **3.1B** |
| 10 Versioned renderers | None | `toEmbeddingText` + `rendering_version` | **3.1B** |
| 11 Hash-driven staleness | No `content_hash` | Trigger + column | **3.1B** |
| 12 Staleness observable | Not surfaced | `/health/detailed` keys | 3.1C |
| 13 Exact scan, no ANN | No index (compliant by accident) | Needs a CI guard to stay compliant | **3.1B** |
| 14 ANN trigger thresholds | Not measured | Emit rows/workspace + p95 | 3.1C |
| 15 Hybrid retrieval | Single weak arm | `RetrievalService` | **3.1D** |
| 16 FTS over ILIKE | ILIKE, and broken | `tsvector` + GIN; **fix the malformed `.or()`** | **3.1D** |
| 17 Graceful degradation | **Anti-pattern shipped**: error → `[]` | `degraded` flag; ban bare empty on error | **3.1D** |
| 18 Arm attribution | None | `RetrievalResult.arms` | **3.1D** |
| 19 Token budget | Row caps only | Per-type token budgets | **3.1E** |
| 20 Ids + versions to model | **Absent** | Extend `MemoryEntry` + select | **3.1E** |
| 21 Persist context package | Only source names | `context_packages` + FK | **3.1E** |
| 22 Reference not prose | n/a | Reference schema | **3.1E** |
| 23 Retention policy | Undefined | Policy + prune job | 3.1E |
| 24 "Why did you recommend this?" | **Not reconstructible** | Depends on 20–22 | **3.1E** |
| 25 Transactional outbox | None | `embedding_outbox` + trigger | **3.1C** |
| 26 Idempotent worker | None | BullMQ deterministic jobId | **3.1C** |
| 27 Pipeline metrics | None | Six metrics | 3.1C |
| 28 Founder precedence | Not implemented | `SOURCE_PRECEDENCE` in ranker | **3.1F** |
| 29 No silent supersede | No supersede path at all | Challenge events | **3.1F** |
| 30 Confidence policy | Static value at write time | `computeConfidence()` | 3.1F |
| 31 Confidence floor | None | Retrieval filter + parameter (**Step 3.3**) | 3.1F |
| 32 Lifecycle states | 3 states, one is overloaded | Additive CHECK expansion | 3.1F |
| 33–36 Dedup safety | Exact-match only; no candidates table | Nomination pipeline | 3.1F |
| 37 Memory is data | `sanitizeInput` exists, not applied to memory | Apply at render | **3.1G** |
| 38 Untrusted external text | No flag | Provenance flag through render | 3.1G |
| 39 Delimited evidence | Ad-hoc string concat | Fixed envelope | **3.1G** |
| 40 Model may reason | Holds | — | MET |
| 41 Model may not write memory | Holds in practice | No import-graph test | **3.1G** |
| 42 Ten-surface isolation | **Founder-scoped, not workspace-scoped** | `workspace_id` + RLS on all ten | **3.1B** |
| 43 Server-side scoping | Route-level `eq('founder_id')` | `WorkspaceContext` type | 3.1D |
| 44 Adversarial semantic isolation | Canaries exist; no semantic path | Tests land with 3.1D | 3.1G |
| 45 Generalized playbook rendering | Signals already anonymised; no renderer | Generalizer before embedding | 3.1G |
| 46 Deletable embeddings | No embeddings | CASCADE + purge extension | 3.1B |
| 47 Caches don't outlive data | No cache | Hash-keyed cache | 3.1D |
| 48 Audit ≠ CASCADE | Partially (founders soft-delete) | Explicit split | 3.1B |
| 49 Governed taxonomy | CHECK + TS union, no drift test | Drift test | **3.1B** |

**Totals:** MET 1 · PARTIAL 5 · GAP 43.

**Step loading:** 3.1B 12 · 3.1C 6 · 3.1D 8 · 3.1E 6 · 3.1F 11 · 3.1G 6.

---

## 3. Proposed 3.1B design (Part 9 — design only)

### 3.1 The dimension problem, resolved empirically

`vector(1536)` must not be hard-coded: embedding models differ in width (768 / 1024 / 1536 / 3072), and rule 5 requires a single store. Four options were considered and one was tested against the actual stack (pgvector 0.8.0 / PG 17.6) rather than assumed:

| Option | Verdict |
|---|---|
| Fixed `vector(1536)` | Rejected — makes the model unreplaceable, contradicting the ADR's provider-replaceability position. |
| Separate table per dimension | Rejected — violates rule 5 and multiplies tenancy enforcement across tables, the same argument ADR-020 used against a graph database. |
| Pad every model to a common width | Rejected — padding distorts cosine distance; the stored vector would no longer be the model's output. |
| **Dimension-less `vector` column + mandatory `(model, version, dimensions)` filter** | **Recommended.** |

Measured on this stack:

```sql
CREATE TABLE t (dims int, v vector);              -- legal, no dimension modifier
INSERT INTO t VALUES (3,'[1,2,3]'), (4,'[1,2,3,4]');   -- mixed widths coexist

SELECT v <=> '[1,2,3]' FROM t;                    -- ERROR: different vector dimensions 4 and 3
SELECT v <=> '[1,2,3]' FROM t WHERE dims = 3;     -- works, returns 0.0000
CREATE INDEX ON t USING hnsw (v vector_cosine_ops);    -- ERROR: column does not have dimensions
```

Three consequences, all verified above:

1. One table holds every model's vectors.
2. **Every query MUST filter `embedding_model` + `embedding_version` + `dimensions` before the distance operator.** Omitting the filter is not a subtle ranking bug — it is a hard Postgres error, which is the desirable failure mode. This will be enforced by making the filter part of the only query builder, not a caller's responsibility.
3. A dimension-less column **cannot** be ANN-indexed. That is compatible with rule 13 (exact scan only) and is why rule 13 and this design must be amended together: adopting ANN under rule 14 requires migrating to per-`(model, dimensions)` partitions. Recorded here so the coupling is not discovered later.

Migration path when ANN is needed: `PARTITION BY LIST (embedding_model)`, each partition declaring its own `vector(N)` and its own index. Additive, and the logical table name does not change.

### 3.2 `memory_embeddings` (proposed)

```
id                  UUID PK
workspace_id        UUID NOT NULL      → RLS via lm_is_workspace_member
source_type         TEXT NOT NULL      CHECK IN (marketing_memory, evidence, learning_event,
                                                 knowledge_node, playbook_signal, product_icp)
source_id           UUID NOT NULL
source_field        TEXT NOT NULL      which rendered field ('canonical', 'title', …)
embedding_provider  TEXT NOT NULL
embedding_model     TEXT NOT NULL
dimensions          INTEGER NOT NULL   CHECK (dimensions BETWEEN 1 AND 16000)
embedding_version   INTEGER NOT NULL DEFAULT 1
rendering_version   INTEGER NOT NULL   bumped when toEmbeddingText() changes
content_hash        TEXT NOT NULL      sha256 of the rendered canonical text
vector              vector NOT NULL    dimension-less; see 3.1
status              TEXT NOT NULL      CHECK IN (current, stale, failed)
created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()

UNIQUE (source_type, source_id, source_field, embedding_model, embedding_version)
INDEX  (workspace_id, source_type, status)
INDEX  (status) WHERE status = 'stale'
```

Deliberately **no text column** — rule 9. `embedding_store.content TEXT` violates that rule today and is not carried forward.

### 3.3 `embedding_outbox` (proposed)

```
id            UUID PK
workspace_id  UUID NOT NULL
source_type   TEXT NOT NULL
source_id     UUID NOT NULL
source_field  TEXT NOT NULL
content_hash  TEXT NOT NULL
reason        TEXT NOT NULL   CHECK IN (created, updated, rendering_changed, model_changed, backfill)
enqueued_at   TIMESTAMPTZ NOT NULL DEFAULT now()
claimed_at    TIMESTAMPTZ
completed_at  TIMESTAMPTZ
attempts      INTEGER NOT NULL DEFAULT 0
last_error    TEXT

UNIQUE (source_type, source_id, source_field, content_hash) WHERE completed_at IS NULL
INDEX  (enqueued_at) WHERE completed_at IS NULL          -- queue age (rule 27)
```

Written by a trigger on canonical insert/update, in the same transaction (rule 25). BullMQ pulls from the outbox; the outbox — not Redis — is the durable record, so a Redis flush loses throughput and never work.

### 3.4 `context_packages` (proposed)

```
id             UUID PK
workspace_id   UUID NOT NULL
founder_id     UUID NOT NULL
product_id     UUID
purpose        TEXT NOT NULL     recommendation | ask | brief | mission_step
refs           JSONB NOT NULL    [{type, id, version, arm, rank, score}]  ← ids, not prose
budget_tokens  INTEGER NOT NULL
used_tokens    INTEGER NOT NULL
dropped_count  INTEGER NOT NULL DEFAULT 0
degraded       BOOLEAN NOT NULL DEFAULT false
arms           TEXT[] NOT NULL
created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
```

Plus `ai_requests.context_package_id UUID REFERENCES context_packages(id)` — additive, nullable, so existing rows remain valid (build rule §1.2).

### 3.5 Full-text search

```sql
ALTER TABLE marketing_memories
  ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(content->>'claim','')), 'B')
  ) STORED;

CREATE INDEX marketing_memories_fts ON marketing_memories USING GIN (search_tsv);
```

Generated + stored, so it cannot drift from the row. Weighting `title` above `content.claim` matches how the corpus is written. Note this reads `content->>'claim'` — which presumes a JSONB convention the fixtures follow but the schema does not enforce; formalising that convention belongs in 3.1B alongside the renderer.

### 3.6 `memory_type` governance

Keep the CHECK + TypeScript union (ADR-066 rule 49) and add a **drift test** that parses the CHECK out of migration 035 and asserts set-equality with `MEMORY_TYPES`. Same for `MEMORY_SOURCES` and the lifecycle `status` values. Cheap, and it closes the only real hole: nothing currently notices when the two halves diverge.

---

## 4. Failure-mode matrix (Part 10)

| # | Failure | Expected behaviour | Fallback | Observability | Data-integrity guarantee |
|---|---|---|---|---|---|
| 1 | Embedding provider unavailable | Outbox rows stay unclaimed; retrieval continues without the semantic arm | Structured + lexical arms serve the query, `degraded=true` | `unembedded_records` and `queue_age_seconds` rise; provider error rate | No canonical write is blocked or lost |
| 2 | Embedding generation times out | Job fails, attempts++, exponential back-off | As #1 | `embedding_failures`, p95 lag | Outbox row remains uncompleted; retried |
| 3 | Canonical committed, worker crashes | Outbox row is uncompleted and re-claimed after the visibility timeout | Semantic arm misses that record until embedded | `unembedded_records` > 0 | **Atomic by construction (rule 25)** — a canonical row cannot exist without its outbox row |
| 4 | Stale embedding | Trigger marks `status='stale'` on canonical change | Stale rows excluded from retrieval; lexical still covers the record | `stale_embeddings` | Ranking never uses a vector whose `content_hash` ≠ the row's |
| 5 | Missing embedding | Record retrievable by structured + lexical arms only | Same | `unembedded_records` | Record is never invisible — this is why hybrid, not semantic-only |
| 6 | Malformed vector (wrong width) | Insert rejected by the `dimensions` CHECK; query with a mismatched filter raises a hard Postgres error | Job marked failed, no silent write | `embedding_failures` | **Verified above**: mixing widths errors rather than silently mis-ranking |
| 7 | Embedding-model migration | New `(model, version)` rows written alongside old; retrieval pinned to the active pair; cutover after backfill | Old model serves until the new one is complete | Per-model coverage % | Both generations coexist; no window with zero coverage |
| 8 | Lexical search unavailable/errors | Error propagates as a **degraded result**, never as `[]` | Structured + semantic arms | `arms` shows lexical absent; `degradedReason` | **Directly fixes the 3.1A defect**: an error may never be laundered into an empty success |
| 9 | Semantic search unavailable | Same as #8 for the semantic arm | Structured + lexical | Same | Same |
| 10 | Retrieval returns zero | Distinguish "no matching records" from "retrieval failed" in the result type | Owner-facing empty state, not a silent gap | `no_result` counter split by cause | The two cases are never conflated — the exact conflation that hid the defect |
| 11 | Excessive result count | Hard `limit` after fusion; overflow counted | Truncate by fused rank | `truncated_count` | Deterministic ordering, so truncation is reproducible |
| 12 | Context exceeds token budget | Trim deterministically by rank; record `dropped_count` | Highest-ranked context survives | `dropped_count` on the package | Never a silent mid-prompt truncation |
| 13 | Conflicting memories | Both retrieved; conflict surfaced, not resolved | Owner sees both with their evidence | Contradiction candidate count | **Invariant 3** — similarity never collapses them |
| 14 | Founder contradicts inference | Founder wins deterministically; a challenge event is created | Inference down-ranked, retained | Challenge count | **Rule 29** — never silently superseded |
| 15 | Cross-workspace retrieval attempt | 404-shaped refusal (indistinguishable from "does not exist") | None — refusal is correct | Isolation-violation counter (should stay 0) | Filter applied in SQL before the distance operator, never post-filtered |
| 16 | Memory deleted while embedding job queued | Job finds no canonical row and completes as a no-op | — | `orphaned_jobs` | Embedding for a deleted record can never be written |
| 17 | Workspace deleted mid-execution | Worker re-verifies the workspace binding before writing (the Step 2 pattern) | Job aborts | `aborted_jobs` | No write into a deleted tenant |
| 18 | Prompt injection in stored memory | Rendered as delimited data inside an untrusted block; delimiters escaped | Instruction not followed | Injection-pattern detections | **Rule 37** — memory is data, never instruction |
| 19 | Playbook signal contains identifying language | Generalizer drops free text before embedding | Category/channel/market/outcome only | Rejected-phrase count | **Rule 45** — distinctive phrasing is never embedded, so it cannot be recovered by nearest-neighbour search |

---

## 5. Readiness

Preconditions for starting 3.1B:

- [x] Baseline measured on real Postgres and persisted, with the dataset committed
- [x] Vector inventory verified against live data (not from documentation)
- [x] ADR-066 accepted with 49 rules, each naming an enforcement mechanism and a test
- [x] Dimension strategy verified empirically against pgvector 0.8.0
- [x] No production behaviour changed
- [ ] `searchMemories` defect scheduled — **3.1D**, deliberately not fixed in 3.1A so the baseline stays valid
- [ ] Confidence thresholds — **Step 3.3**, deliberately unset

**Recommendation: READY FOR 3.1B.**

---

## 6. 3.1B outcome (2026-08-09)

Delivered: migrations 088-092, the canonical `memory_embeddings` store, retirement
of all five legacy vector columns plus `embedding_store`, workspace tenancy across
the six memory tables, database-enforced append-only history, the rendering and
`EmbeddingProvider` contracts, and the playbook generalizer.

Rules moved GAP → MET: 2 (in substance), 5, 6, 8, 9, 11 (schema), 13, 42, 45, 46,
48, 49. Revised totals: **MET 13 · PARTIAL 5 · GAP 31.**

Nothing was embedded. No provider was selected or called. Retrieval is byte-for-byte
unchanged — the 3.1A benchmark reproduces at Arm A 0.0% / Arm A′ 9.4% / Arm B 18.8%,
identical to the pre-migration run.

Remaining step loading: 3.1C 6 · 3.1D 8 · 3.1E 6 · 3.1F 9 · 3.1G 6.

---

## 7. 3.1C outcome (2026-08-09)

Delivered: migration 093 (`embedding_outbox`, `embedding_contract`, trigger-based
atomic enqueue, `lm_claim_embedding_work`, `embedding_pipeline_stats`), the
`EmbeddingProvider` registry with a Voyage adapter and an offline deterministic
provider, the pipeline, the BullMQ sweep worker, the backfill CLI, and embedding
health on `/health/detailed`.

Rules moved GAP → MET: 7 (rebuildable via backfill), 12 (staleness observable),
25 (transactional outbox), 26 (async/idempotent/retryable/observable),
27 (six metrics). Revised totals: **MET 18 · PARTIAL 5 · GAP 26.**

**Provider comparison.** Voyage was selected over OpenAI and Cohere: it is
Anthropic's documented embedding recommendation and this backend is already an
Anthropic shop (one vendor relationship, one DPA); its models are retrieval-tuned,
which matters for a corpus of short domain assertions; and Matryoshka training
makes narrowing dimensions principled truncation — relevant because ADR-066 rule
13 mandates exact scan, where width is a direct linear cost. Model and dimensions
are configuration, never code, and no default was inherited from the retired
1536-wide columns.

**Live validation is BLOCKED** — no Voyage credential exists in this environment.
The full path was proved end to end on a real stack using the offline provider.

Remaining step loading: 3.1D 8 · 3.1E 6 · 3.1F 10 · 3.1G 6.
