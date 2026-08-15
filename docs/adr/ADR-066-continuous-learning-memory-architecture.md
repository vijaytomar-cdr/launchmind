# ADR-066 — Continuous Learning & Marketing Memory Architecture

**Status:** Accepted
**Date:** 2026-08-09
**Milestone:** Phase 3.1 — Retrieval & Continuous Learning (internal designation; never surfaced to owners)
**Supersedes:** nothing. **Amends in spirit:** ADR-019 (memory scoping), ADR-020 (graph in Postgres), ADR-022 (dedup strategy), ADR-023 (Context Engine).

---

## Context

LaunchMind's Growth Brain is marketed on a promise: it remembers what it learned, and it can say why it believes something. The measured reality at the start of Phase 3.1 does not yet support that promise.

A retrieval baseline was built before any architectural change (`backend/tests/evals/memory-retrieval/`, report at `docs/evals/memory-retrieval-baseline.md`). Against 32 hand-labelled owner questions over a 26-memory corpus on real Postgres:

| Arm | What it is | Recall@5 | MRR | No-result |
|---|---|---|---|---|
| A | `searchMemories()` as shipped | **0.0%** | 0.000 | 100% |
| A′ | Same, with a malformed filter removed | 9.4% | 0.094 | 90.6% |
| B | `buildContextPackage()` — what actually feeds the model | 18.8% | 0.120 | 0% (93.1% irrelevant) |

Three facts follow from that table and from the code inspection behind it.

**`searchMemories` has never worked.** Its filter is `.or(\`title.ilike.%${q}%,content.cs.{"${q}"}\`)`. The second disjunct is PostgREST array-literal syntax against a `jsonb` column; Postgres rejects the whole expression with `invalid input syntax for type json`. The service catches the error, reports to Sentry, and returns `[]` — which the caller cannot distinguish from "no matches". Every `GET /memory/search` call has returned nothing.

**The Context Engine does not retrieve.** `buildContextPackage(founderId, productId, opts)` accepts no query. It returns the top `maxMemories` rows ordered by `confidence`, identically for every question. Its 18.8% recall is an accident of which memories hold high confidence, and 93.1% of what it returns is irrelevant to the question asked.

**pgvector is declared but inert.** Four `VECTOR(1536)` columns exist across `products`, `marketing_memories`, `playbook_signals` and `embedding_store`. Zero rows are populated. No code generates an embedding. No ANN index exists. `getSimilarSignals()` returns `[]` on its first line whenever the embedding is null — always — and if it did not, it calls `match_playbook_signals`, an RPC defined in no migration.

The temptation is to treat this as a retrieval-quality problem and reach for embeddings. That would be the wrong first move. The deeper issue the inspection surfaced is that **the substrate the retrieval would sit on is not yet trustworthy**: memory tables are founder-scoped while the rest of the platform moved to workspace tenancy in Step 2; "append-only" history has no `REVOKE`; and memories reach the model as `{type, title, confidence, content}` with **no record id and no version**, so no recommendation can be traced back to what produced it.

Adding a vector index to that substrate would make LaunchMind faster at being unaccountable. This ADR fixes the invariants first, and makes each one enforceable by something other than good intentions.

---

## Decision

### The three headline invariants

Everything in Phase 3.1 is subordinate to these. A design that violates one of them is rejected regardless of its retrieval scores.

---

#### 1. POSTGRES IS AUTHORITATIVE

> All durable observations, evidence, marketing memory, memory versions, belief versions, learning events, knowledge relationships and provenance live in LaunchMind's Supabase/Postgres database.
>
> **The LLM is not memory.**

A model's context window is a rendering of state, never the state. Nothing LaunchMind believes may exist solely because it once appeared in a prompt, a completion, a cache, or a conversation history. If Postgres does not have it, LaunchMind does not know it.

---

#### 2. EMBEDDINGS ARE DERIVED

> Embeddings are disposable, rebuildable search indexes over canonical records.
>
> **No fact, belief or memory may exist only as a vector. Deleting every embedding must not destroy business knowledge.**

`TRUNCATE` on the embeddings table must cost LaunchMind recall and latency, and nothing else. This is testable, and rule 7 requires it to be tested.

---

#### 3. SIMILARITY NOMINATES; IT NEVER DECIDES

> Vector similarity may **nominate** records for retrieval, duplicate analysis, reinforcement analysis, and contradiction analysis.
>
> It may never, by itself: merge memories · classify two claims as equal · classify claims as contradictory · supersede a belief · alter confidence · establish truth.

Cosine proximity measures textual resemblance. "Search converts better than Meta" and "Search converts worse than Meta for enterprise customers" are near-neighbours in every embedding space and are opposite claims. A system that treats similarity as agreement will silently merge them and destroy the exception — which is exactly the knowledge an owner is paying for. Query `retrieval_026` in the eval dataset exists to hold this line permanently.

---

### Memory lifecycle states (semantics defined; transitions not implemented in 3.1A)

| State | Meaning | Retrieval eligibility |
|---|---|---|
| `ACTIVE` | Current belief; no unresolved challenge. | Normal. |
| `CHALLENGED` | Conflicting evidence recorded; owner has not resolved it. | Retrieved **with its challenge**, never silently. |
| `SUPERSEDED` | Replaced by a newer belief; the successor is named. | Excluded from default retrieval; always reachable by history queries. |
| `STALE` | Not contradicted, but its evidence is beyond the freshness window for its type. | Down-ranked, flagged as stale when used. |
| `RETRACTED` | Withdrawn (founder correction, or evidence found invalid). | Never retrieved for reasoning; retained for audit. |

The existing column is `status TEXT CHECK (status IN ('draft','active','archived'))`. These five states are a superset and will be introduced additively in 3.1F. `archived` maps to `SUPERSEDED` on migration; nothing is retyped or dropped (build rule §1.2).

Note the eval already exposes the cost of collapsing this: `retrieval_023` ("What did LaunchMind believe before?") is unanswerable today, because the only mechanism for "no longer current" is `status='archived'`, and `searchMemories` filters archived rows out. History exists in the table and is unreachable through the product.

---

### Source precedence (rule 28, stated once, referenced throughout)

```
founder-confirmed statement
  > observed first-party outcome data
    > verified external observation
      > derived inference
        > anonymized cross-founder / playbook signal
```

Deterministic, evaluated in code, never by a model. A model may *observe* that evidence conflicts with a founder statement; only the deterministic rule decides which one governs, and the answer is always the founder.

---

## Enforceable rules

Every rule names a mechanism that fails a build, a request, or a test. **"Reviewers will notice" is not an enforcement mechanism** and no rule below relies on it.

Status legend: **MET** today · **PARTIAL** · **GAP** (nothing enforces it yet).

### Canonical history

| # | Rule | Rationale | Enforcement mechanism | Owner | Required automated test | Status |
|---|---|---|---|---|---|---|
| 1 | Postgres is the sole system of record. | Invariant 1. A second store means two truths and no way to choose. | Semgrep rule banning durable-state writes outside `backend/src/services/**` and `backend/migrations/**`; no cache/KV may hold a fact not derivable from Postgres. | all services | `memoryIntegrity.test.ts` — asserts no module outside the allow-list writes memory tables. | GAP |
| 2 | Historical memory/belief state is preserved via immutable versions or append-only records. | An overwritten belief cannot be explained later. | `REVOKE UPDATE, DELETE` on `marketing_memory_versions`, `learning_events`, `evidence`, `growth_brain_learning_events`; version row written **before** the mutation. | `marketingMemoryService` | Real-Postgres test: `UPDATE` and `DELETE` as `authenticated` both raise. | GAP (only `growth_brain_learning_events` has the REVOKE) |
| 3 | Durable history must not be silently overwritten. | Silent overwrite is indistinguishable from never having known. | `updateMemory` snapshots first and increments `version`; a trigger rejects a version decrement. | `marketingMemoryService` | Update a memory twice → exactly 2 version rows, `version` strictly increasing. | PARTIAL (snapshot exists; no trigger) |
| 4 | Business history, founder assertions, and LaunchMind belief history are distinguishable. | Precedence (28) is unenforceable if the three are indistinguishable at read time. | `source` CHECK already separates `founder_feedback` from observed sources; 3.1F adds `assertion_class` (`business_fact` \| `founder_assertion` \| `model_belief`) NOT NULL. | `marketing_memories` | Precedence test asserts a founder assertion outranks an inference with higher confidence. | PARTIAL |

### Embeddings

| # | Rule | Rationale | Enforcement mechanism | Owner | Required automated test | Status |
|---|---|---|---|---|---|---|
| 5 | Exactly ONE canonical embedding store exists. | Four vector columns already exist and disagree about what they mean; more stores means more drift. | Migration creates `memory_embeddings`; Semgrep bans new `VECTOR(` declarations outside it. | `memory_embeddings` | Schema test: exactly one table carries a vector column after 3.1B retirement. | GAP |
| 6 | Pre-existing VECTOR columns are retired in 3.1B or explicitly justified. | Dead columns imply working features and mislead the next engineer. | 3.1B migration drops them **only** if provably unused; otherwise the ADR is amended with the justification. | migrations | Test asserting `products.icp_embedding` etc. are absent, or an ADR amendment exists. | GAP |
| 7 | Embeddings are rebuildable from canonical records. | Invariant 2. | A `rebuildEmbeddings(workspaceId)` entry point that reads only canonical tables. | embedding worker | **Truncate-and-rebuild test**: delete all embeddings, rebuild, assert retrieval recall returns to its prior value and no canonical row changed. | GAP |
| 8 | Every embedding references workspace, source table, source id, source field, model, dimensions, embedding version, rendering version, content hash, created_at. | Without these an embedding cannot be invalidated, attributed, or migrated. | `NOT NULL` on every one of those columns. | `memory_embeddings` | Insert missing any field → constraint violation. | GAP |
| 9 | No authoritative text or fact lives only in the embeddings table. | Invariant 2. | The table stores no free text beyond the hash; renderers read canonical rows. | `memory_embeddings` | Schema test: no `TEXT` content column on the embeddings table. | GAP |
| 10 | Canonical text is produced by versioned renderers (`toEmbeddingText(memory)`), never raw JSONB serialization. | `JSON.stringify` embeds key names and punctuation and changes meaning when an unrelated key is added. | `rendering_version` NOT NULL; renderer is a pure function in one module. | `memoryRenderer.ts` | Golden-output test per memory type; changing a renderer without bumping `rendering_version` fails. | GAP |
| 11 | A changed `content_hash` makes the existing embedding STALE. | An embedding of superseded text is a confidently wrong index entry. | DB trigger on canonical update sets `memory_embeddings.status='stale'`; unique index on (source, field, model, version). | trigger + worker | Update a memory → its embedding row becomes `stale` in the same transaction. | GAP |
| 12 | Staleness is observable. | An invisible backlog is an outage nobody pages for. | `/health/detailed` reports `stale_embeddings`, `unembedded_records`, `queue_age_seconds`. | health route | Health test asserts the three keys exist and are numeric. | GAP |

### Retrieval

| # | Rule | Rationale | Enforcement mechanism | Owner | Required automated test | Status |
|---|---|---|---|---|---|---|
| 13 | Initial semantic retrieval uses an **exact** pgvector scan. **No HNSW/IVFFlat in 3.1B** without a formal amendment to this ADR. | ANN trades recall for latency. At LaunchMind's corpus size (largest tenant: 33 memories) that trade buys nothing and costs correctness — and an approximate index would make the 3.1D-vs-baseline comparison unsound. | Semgrep rule failing CI on `USING hnsw` / `USING ivfflat` in any migration. | migrations | CI grep test over `backend/migrations/**`. | GAP |
| 14 | ANN is re-evaluated on **measured semantic pressure**, not raw volume — see Amendment 3. | A volume threshold is a proxy for latency, and measurement showed the proxy wrong by ~40×. | Latency, share-of-package and SLO metrics; a health warning fires on breach. | `RetrievalService` | Scale suite records semantic p95 at 100→25,000 rows. | **MET** |
| 15 | Hybrid retrieval combines: hard workspace/product filters · governed memory type · Postgres full-text · exact vector similarity · deterministic rank fusion · confidence · recency · importance. | Each arm fails differently; fusion is what makes the union robust. | `RetrievalService` is the only retrieval entry point; arms are pure and independently testable. | `RetrievalService` | Per-arm unit tests + a fusion test with fixed inputs and an asserted fixed order. | GAP |
| 16 | Lexical search migrates from `ILIKE` to Postgres full-text search. | Measured: `ILIKE` matches the entire question as one literal substring. Recall@5 9.4% (Arm A′), and the shipped variant is 0.0%. | `tsvector` GENERATED column + GIN index; Semgrep bans `.ilike(` in retrieval modules. | `marketingMemoryService` | The eval suite must show ≥ the Arm A′ baseline; the malformed `.or()` must be gone. | GAP |
| 17 | Retrieval degrades gracefully: if semantic is unavailable, structured/lexical continues, the fallback is observable, and there is no silent empty-memory behaviour. | The defect found in 3.1A is precisely this failure — an error became `[]` and looked like an answer. | `RetrievalResult.degraded: boolean` + `degradedReason`; a caught retrieval error may never return a bare empty array. | `RetrievalService` | Fault-injection test: kill the embedding provider → results still return, `degraded=true`. | GAP |
| 18 | Results report which arms contributed: structured · lexical · semantic · graph · fallback. | Without attribution nobody can tell a working arm from a dead one — which is how a 100%-failing search shipped. | `RetrievalResult.arms: ArmContribution[]`, populated by the fusion step. | `RetrievalService` | Test asserting every result names ≥1 arm and that a dead arm reports zero contribution rather than being absent. | GAP |
| 19 | Context retrieval has a token/size budget per context type. | An unbounded package silently truncates at the model boundary, and what is dropped is unpredictable. | `CONTEXT_BUDGETS` per context type; the builder trims deterministically by rank and records what it dropped. | `contextEngine` | Oversized-corpus test: package stays under budget and `droppedCount` is reported. | GAP (`maxMemories: 5` is a row cap, not a token budget) |

### Provenance and context packages

| # | Rule | Rationale | Enforcement mechanism | Owner | Required automated test | Status |
|---|---|---|---|---|---|---|
| 20 | Every memory sent to a model carries its canonical record id, version, and evidence ids. | Today `MemoryEntry` is `{type, title, confidence, content}`. No id, no version. Nothing sent to a model can be traced back. | `MemoryEntry` gains `id`, `version`, `evidenceIds` as required fields; the select must include them. | `contextEngine` | Type-level + runtime test: every entry in a built package has a non-empty id and version. | GAP |
| 21 | Every recommendation or important model output persists which ContextPackage produced it. | Invariant 1 applied to reasoning: the inputs are as much a record as the output. | `context_packages` table; `ai_requests.context_package_id` FK. | `aiPlatform` | Generate a recommendation → exactly one context package row, linked. | GAP (`ai_requests.context_sources TEXT[]` stores source *names* only) |
| 22 | Context packages store canonical ids + versions, not duplicated prose, where reconstruction is possible. | Copied prose is a second source of truth and drifts (invariant 1). | Package schema stores references; prose is re-rendered from canonical rows at read time. | `context_packages` | Reconstruct a stored package and assert it equals the original rendering. | GAP |
| 23 | Context-package retention is explicit. | Unbounded retention is a silent privacy and cost liability. | Documented policy + scheduled prune job; retention constant in one place. | `context_packages` | Test asserting rows past the window are pruned and audit rows are not. | GAP |
| 24 | "Why did you recommend this?" is reconstructible from stored inputs. | This is the owner-facing promise the whole ADR serves. | Rules 20–22 together; a read path that rebuilds the answer from ids. | `RetrievalService` + `aiPlatform` | End-to-end: recommend → fetch package → assert every cited memory resolves to a live canonical row at the recorded version. | GAP |

### Embedding pipeline

| # | Rule | Rationale | Enforcement mechanism | Owner | Required automated test | Status |
|---|---|---|---|---|---|---|
| 25 | Embedding generation uses a **transactional outbox**: the canonical write and the embedding-work intent commit atomically. | Enqueueing to Redis after the commit loses work whenever the process dies between the two, and the gap is invisible. | `embedding_outbox` written in the same transaction (DB trigger on canonical insert/update). | `embedding_outbox` | Kill-after-commit test: canonical row exists ⇒ outbox row exists, with no code path that produces one without the other. | GAP |
| 26 | The worker is asynchronous, idempotent, retryable, observable. | Embedding is slow and remote; on the request path it becomes an availability risk. | BullMQ with a deterministic `jobId` = `${source_type}:${source_id}:${content_hash}`; `ON CONFLICT DO NOTHING` on write. | embedding worker | Run the same job three times → exactly one embedding row. | GAP |
| 27 | Track unembedded count, stale count, failures, queue age, p50/p95 embedding lag. | Rule 12; also the ANN trigger in rule 14 needs real numbers. | Metrics emitted per run; surfaced on `/health/detailed`. | embedding worker | Health test asserting all six keys. | GAP |

### Founder precedence

| # | Rule | Rationale | Enforcement mechanism | Owner | Required automated test | Status |
|---|---|---|---|---|---|---|
| 28 | Direct founder assertion outranks model inference, per the precedence ladder above. | The owner is the authority on their own business. Everything else is evidence about it. | `SOURCE_PRECEDENCE` constant consulted by the ranker; pure TypeScript, no model involvement. | `RetrievalService` | Founder assertion at confidence 0.60 outranks an inference at 0.95. | GAP |
| 29 | Founder-confirmed statements are never silently superseded by inference. Material conflict creates a **challenge event** for owner resolution. | Silently overriding the owner is the single fastest way to lose their trust in the product. | `supersede()` refuses when the target is a founder assertion and the challenger is not; it emits a challenge instead. | `marketingMemoryService` | Attempt to supersede a founder assertion with an inference → rejected, challenge row created, original still `ACTIVE`. | GAP |

### Confidence and contradiction

| # | Rule | Rationale | Enforcement mechanism | Owner | Required automated test | Status |
|---|---|---|---|---|---|---|
| 30 | Confidence considers at minimum: source precedence · evidence recency · sample size · evidence volume · evidence independence · contradiction strength. | Today confidence is a number assigned at write time and never recomputed; it is decoration. | One pure `computeConfidence(inputs)`; direct writes to `confidence` banned outside it by Semgrep. | `confidencePolicy.ts` | Property tests: each input moves confidence in the declared direction, and only in that direction. | GAP |
| 31 | A confidence floor makes a memory ineligible for normal retrieval while remaining historically preserved. | Weak signals should not be quietly promoted into strategy. | `RETRIEVAL_CONFIDENCE_FLOOR` policy parameter, applied in the retrieval filter, not at write time. | `RetrievalService` | A below-floor memory is absent from retrieval and present in history. | GAP |
| 32 | Lifecycle states ACTIVE / CHALLENGED / SUPERSEDED / STALE / RETRACTED (semantics above). | A single `archived` flag cannot express "contested" or "expired", so today both are invisible. | Additive CHECK expansion in 3.1F; the retrieval filter is state-aware. | `marketing_memories` | State-transition matrix test; `retrieval_023` becomes answerable. | GAP |

> **Policy parameters deliberately NOT fixed in 3.1A** — no approved product policy defines them, and inventing production thresholds here would give arbitrary numbers the standing of an accepted decision. To be finalised in **Step 3.3**: `RETRIEVAL_CONFIDENCE_FLOOR`; per-type staleness windows; "material conflict" threshold for rule 29; minimum sample size for confidence gain.

### Semantic dedup safety

| # | Rule | Rationale | Enforcement mechanism | Owner | Required automated test | Status |
|---|---|---|---|---|---|---|
| 33 | Similarity may nominate a possible duplicate. | Invariant 3; nomination is the useful half. | Candidates written to `memory_merge_candidates` with a score; never applied. | dedup worker | High-similarity pair produces a candidate row and no mutation. | GAP |
| 34 | Similarity must not silently merge. | Invariant 3. The contradiction pair in the eval set proves the cost. | No code path from a similarity score to a write on `marketing_memories`; enforced by Semgrep and by a structural test. | dedup worker | Structural test: the dedup module imports no memory-mutation function. | GAP |
| 35 | Candidate resolution supports duplicate · reinforcement · contradiction · unrelated. | Collapsing these four into "same/not same" is what destroys exceptions. | `resolution` CHECK on the candidates table; all four handled explicitly. | `memory_merge_candidates` | One test per resolution type asserting its distinct effect. | GAP |
| 36 | Any merge/supersede decision creates auditable history. | Rule 2 applied to the most destructive operation available. | Merge writes a version row and a learning event, both append-only, naming the actor. | `marketingMemoryService` | Merge → both records exist and identify the actor. | GAP |

### AI safety and prompt injection

| # | Rule | Rationale | Enforcement mechanism | Owner | Required automated test | Status |
|---|---|---|---|---|---|---|
| 37 | Retrieved memory is DATA, never instruction. | Memory is partly derived from provider and customer text LaunchMind does not control. | Memory rendered inside delimited, labelled blocks; existing `sanitizeInput()` extended to every retrieved field. | `contextEngine` | Inject "ignore previous instructions" into a memory → appears as quoted data, instruction not followed. | PARTIAL (`sanitizeInput` exists in `aiPlatform`, not applied to retrieved memory) |
| 38 | External/provider/customer text remains untrusted. | A review body is attacker-controlled in the general case. | Untrusted flag carried from ingestion through rendering. | `contextEngine` | Provider-sourced memory renders inside the untrusted block. | GAP |
| 39 | Context construction delimits evidence so memory/provider text cannot override model instructions. | Rules 37–38 need a concrete structural mechanism, not an intention. | Fixed envelope: system instructions, then `<evidence>` blocks; delimiter sequences stripped from content. | `contextEngine` | Content containing the delimiter is escaped, not honoured. | GAP |
| 40 | A model MAY summarize · classify · compare evidence · propose relationships · explain · recommend. | These are judgement tasks where a model genuinely adds value. | Allowed by design. | `aiPlatform` | — | MET |
| 41 | A model MAY NOT write authoritative memory · assign confidence · delete history · remove provenance · override founder assertions · promote similarity into evidence · change precedence. | Invariants 1 and 3. A model that can write its own memory can launder a guess into a fact. | Structural: no memory-mutation, confidence, or precedence function is reachable from `aiPlatform`/`aiClient`/agent modules. Enforced by an import-graph test, the pattern already used for the execution boundary in Step 5. | `aiPlatform` | Import-graph test asserting none of those modules import the mutation surface. | GAP |

### Privacy and tenancy

| # | Rule | Rationale | Enforcement mechanism | Owner | Required automated test | Status |
|---|---|---|---|---|---|---|
| 42 | Workspace isolation applies independently to memories · versions · embeddings · lexical retrieval · semantic retrieval · graph traversal · evidence · learning events · context packages · embedding jobs. | Ten surfaces; isolation on nine of them is isolation on none. **Memory tables are currently founder-scoped, not workspace-scoped** — a divergence from the tenancy model adopted in Step 2. | `workspace_id NOT NULL` on all ten; RLS via `lm_is_workspace_member`. | migrations | One isolation test per surface — ten tests, not one. | GAP |
| 43 | Every retrieval path requires explicit server-side workspace scoping. | A client-supplied workspace id is context, never authorization (established Step 2). | `RetrievalService` takes a verified `WorkspaceContext`, not a raw id; there is no overload that accepts a bare string. | `RetrievalService` | Compile-time: no call site can pass an unverified id. | GAP |
| 44 | Adversarial tests exist for cross-workspace **semantic** retrieval. | Vector search does not naturally respect tenancy: the nearest neighbour to a tenant's question may belong to another tenant. | Filter applied in SQL before the distance operator, never post-filtered in application code. | `RetrievalService` | Near-identical memories in two workspaces; querying A never returns B's. The eval corpus already ships these canaries. | GAP (canaries exist; semantic path does not) |
| 45 | Cross-founder/playbook signals use a deliberately generalized canonical representation before embedding. Identifiable founder phrasing is never embedded. | An embedding of a distinctive sentence is a fingerprint; nearest-neighbour search over it can re-identify the author. | Playbook rendering passes through a generalizer emitting category/channel/market/outcome only; free text is dropped, not paraphrased. | `playbookService` | Test asserting a distinctive phrase in a source signal never appears in, and is not recoverable from, the generalized rendering. | GAP |

### Deletion and retention

| # | Rule | Rationale | Enforcement mechanism | Owner | Required automated test | Status |
|---|---|---|---|---|---|---|
| 46 | Derived embeddings are deletable when their canonical source is deleted under the applicable retention/account-deletion policy. | GDPR erasure must reach derived artifacts, or deletion is cosmetic. | `ON DELETE CASCADE` from canonical to embeddings; `DELETE /founders/me` extended to cover them. | `memory_embeddings` | Delete a memory → its embeddings are gone in the same transaction. | GAP |
| 47 | Caches and derived retrieval artifacts do not outlive canonical data where deletion is required. | A warm cache is an undeleted copy. | Cache keyed by `content_hash`; deletion purges by workspace; TTL bounded. | `RetrievalService` | Delete → a subsequent retrieval cannot return the deleted content from cache. | GAP |
| 48 | **Historical/audit records follow the established legal/audit retention policy, NOT indiscriminate CASCADE.** | Rules 46 and 47 pull toward deletion; `audit_logs`, `connection_permission_history` and `growth_brain_learning_events` are immutable by deliberate decision. These two requirements genuinely conflict and the resolution must be explicit rather than emergent. | **Derived artifacts CASCADE. Audit records do not.** Audit rows are anonymised in place (subject id nulled or tombstoned), never deleted — the same treatment `founders` already receives (soft-delete, email anonymised). | migrations | Account-deletion test: embeddings and context packages are gone; audit rows survive with the subject anonymised. | GAP |

### Taxonomy

| # | Rule | Rationale | Enforcement mechanism | Owner | Required automated test | Status |
|---|---|---|---|---|---|---|
| 49 | `memory_type` is governed, never uncontrolled free text. | An ungoverned type column silently forks into synonyms and every type-filtered query quietly loses rows. | **Recommendation: keep the CHECK constraint + TypeScript `as const` union, and add a drift test.** Rejected alternatives: a Postgres `ENUM` (adding a value requires `ALTER TYPE`, which is awkward under the additive-migration rule §1.2 and cannot be done inside a transaction with other DDL on older PG); a lookup table (a join and an FK for an 11-element set that changes once a year). The existing pair is already the right shape — what is missing is that nothing detects divergence between the two halves. | `types/memory.ts` + migration 035 | Drift test parsing the CHECK constraint out of the migration SQL and asserting set-equality with `MEMORY_TYPES`. Applies equally to `MEMORY_SOURCES`. | PARTIAL |

---

## LangChain / LangGraph architectural position

Recorded explicitly so this is settled rather than relitigated per sprint.

- **Hybrid RAG is an architectural capability**, not a library choice.
- **LaunchMind-owned retrieval is mandatory.** `RetrievalService` is ours: tenancy, precedence, confidence and fusion are business rules, and business rules do not live in a third-party abstraction.
- **LangChain is OPTIONAL.** Not installed. Not required by any rule above.
- **LangGraph is OPTIONAL.** Not installed.
- **Embedding providers are replaceable.** Behind an `EmbeddingProvider` interface; `embedding_model` and `dimensions` are persisted per row precisely so a provider change is a migration, not a rewrite.
- **Orchestration libraries are replaceable.** BullMQ is already the queue (ADR-030).

Conceptual LaunchMind-owned interfaces for 3.1B onward:

```
EmbeddingProvider          embed(texts) → vectors; declares model + dimensions
RetrievalService           retrieve(WorkspaceContext, query, opts) → RetrievalResult
ContinuousLearningWorkflow ingest → nominate → resolve → version → re-embed
```

If future requirements include long-running learning flows, resumability, checkpointing, or human-in-the-loop interruption, **LangGraph may be evaluated then**. If adopted, **LangGraph checkpoint state is workflow plumbing, NOT Marketing Memory** — it is subject to invariant 1 like any other cache, and nothing LaunchMind believes may live only in a checkpoint.

---

## Consequences

**Accepted.**

- 3.1B–3.1G carry substantial enforcement work: 40 of the 49 rules currently have no mechanism at all. That is the honest cost of the inspection, and each is scheduled in `docs/roadmap/phase-3.1-gap-analysis.md`.
- Exact vector scan (13) is slower asymptotically than ANN. At present corpus sizes it is faster in practice, and it is exact — which the 3.1D comparison requires.
- Moving memory tables to workspace scope (42) changes a tenancy boundary. It is additive (`workspace_id` added and backfilled, as in migration 080) but it is the one structurally significant change in Phase 3.1.

**Rejected alternatives.**

- *Embeddings first, invariants later.* Would have produced a faster retriever over a substrate that cannot say where an answer came from — optimising the wrong property.
- *A dedicated vector database.* Contradicts invariant 1, splits tenancy enforcement across two systems, and ADR-020 already rejected the equivalent argument for a graph database.
- *Let the model resolve contradictions.* Contradicts invariant 3 and rule 41. A model asked "are these the same?" answers plausibly, not verifiably, and the failure is silent.
- *Fix `searchMemories` during 3.1A.* Tempting — it is a small change. Rejected because it would invalidate the baseline this step exists to record. It is scheduled in 3.1D and the report states the defect prominently so no one mistakes the 0.0% for an algorithmic result.

---

## Verification of this step

Production retrieval behaviour is unchanged by 3.1A. No migration was created, no `src/` file modified, no dependency added. The evaluation harness is additive and seeds only a local, disposable Supabase.

---

## Amendment 1 — implementation findings from Phase 3.1B (2026-08-09)

Recorded here rather than by editing the text above, so the decision and what
implementing it taught are both legible.

**1. The vector inventory was wrong: there were FIVE columns, not four.**
`knowledge_nodes.embedding` (migration 037) was missed. The 3.1A census
deduplicated by column name and collapsed it into `marketing_memories.embedding`.
It held 0 of 18 rows and had zero code references, so no conclusion changes — but
the count in the Context section above should read five. It was found by a
real-Postgres test asserting *exactly one table carries a vector type*, which is
the general lesson: assert the invariant, do not count by hand.

**2. `learning_events` is a processing record, not a belief record.** Rule 2 named
it append-only. Implementing a blanket UPDATE ban would have broken
`learningPipelineService`, which moves rows `pending → processing → completed`
with result counts. Migration 091 therefore freezes its AUDIT CONTENT
(`founder_id`, `workspace_id`, `product_id`, `event_type`, `payload`,
`created_at`) and leaves the lifecycle columns writable. Rule 2 is satisfied in
substance — what an auditor relies on cannot change — and the distinction is now
explicit rather than accidental.

**3. `REVOKE` alone cannot enforce append-only in this architecture.** The backend
connects as `service_role` for every operation, so revoking from `authenticated`
protects only the direct client path. Migration 091 pairs the REVOKE with a
trigger, and the sanctioned erasure path is a single `SECURITY DEFINER` function
(`lm_erase_founder_history`) rather than a settable flag — because PostgREST runs
each HTTP request in its own transaction, so a "set the flag" call followed by a
"delete" call would set it in one transaction and delete in another, and erasure
would silently fail.

**4. Rule 13's no-ANN constraint is coupled to the dimension-less column.**
Verified on pgvector 0.8.x: a dimension-less `vector` column cannot be
ANN-indexed at all (`ERROR: column does not have dimensions`). Adopting ANN under
rule 14 therefore requires partitioning by `(embedding_model, dimensions)` first.
Rules 13 and 14 may not be amended without amending the storage design with them.

**5. Rule 42 is implemented; the memory tables are now workspace-scoped.**
`founder_id` is retained everywhere as attribution. Backfill used only exact
mappings plus the unambiguous "founder owns exactly one workspace" case;
everything else is preserved in `memory_workspace_backfill_audit` rather than
assigned.

**Rules now MET (were GAP):** 2 (in substance, per finding 2), 5, 6, 8, 9, 11
(schema), 13, 42 (schema + RLS), 45 (generalizer + eligibility flag), 46, 48, 49.

---

## Amendment 2 — implementation findings from Phase 3.1C (2026-08-09)

**1. Atomicity is enforced by TRIGGER, not by an RPC (rule 25).** An RPC is atomic
only for callers that remember to use it; a new call site that inserts directly
compiles, reviews clean, and silently stops producing embeddings. An AFTER
INSERT/UPDATE trigger cannot be bypassed. It also meant 3.1C required no
service-layer change at all, which is what makes "no production behaviour change"
verifiable rather than merely asserted.

**2. The durable queue is the OUTBOX TABLE, not Redis.** BullMQ runs a periodic
sweep that claims from Postgres via `FOR UPDATE SKIP LOCKED`. Enqueuing one Redis
job per write would create a second queue that can disagree with the first, and a
flushed Redis would lose work Postgres still believes is pending.

**3. Staleness is CONSERVATIVE.** The trigger cannot run the TypeScript renderer,
so it cannot know whether an UPDATE changed canonical text. It marks the existing
vector stale regardless. The worker restores `current` without a provider call
when the hash matches, so the false-positive costs one comparison — and the
alternative, serving a vector built from superseded text, is silent and wrong.

**4. Version retention, decided (rule 11):** ONE row per family
(source + field + model + embedding_version); re-embedding replaces it. Families
COEXIST, so a model migration runs alongside the old one with no coverage gap.
Superseded vectors of the same model are not retained — "what did we used to
believe" lives in `marketing_memory_versions`, which is canonical, append-only and
readable, and which a vector could not express anyway.

**5. A consequence of migration 091 surfaced.** Deleting a product CASCADES into
`evidence`, which the append-only trigger refuses — so product deletion now fails
for any product with evidence. Production is unaffected (the only such path is the
GDPR purge, which calls `lm_erase_founder_history` first), but any other caller
must use the erasure path. Whether lifecycle cascade should be distinguished from
tampering is left open for **3.1F**.

**6. Generation ships OFF.** `embedding_contract.generation_enabled` is false, and
the provider registry defaults to an offline deterministic provider, so no test,
eval or developer run can reach a paid API by accident (rule 26 / Step 3.1C §15).

---

## Amendment 3 — the ANN trigger is latency-based, not volume-based (2026-08-10)

**Rule 14 as originally written was not supported by measurement.** It set
`>10,000 vector rows per workspace` as an ANN review trigger alongside a
200 ms p95 latency trigger. The 3.1G scale suite measured both, on synthetic
data in a disposable Postgres:

| memories | full-text p95 | **exact vector p95** |
|---|---|---|
| 100 | 1 ms | 1 ms |
| 1,000 | 9 ms | 1 ms |
| 5,000 | 41 ms | 2 ms |
| 10,000 | 82 ms | 2 ms |
| 25,000 | **208 ms** | **5 ms** |

At 25,000 vectors — two and a half times the original trigger — exact semantic
scan costs **5 ms**, roughly 40× under the latency threshold the volume figure was
standing in for. Firing an ANN review there would trade exactness for a problem
that does not exist, and pgvector ANN trades *recall* for latency, which is
precisely the property retrieval quality depends on.

**Rule 14 is amended.** ANN review becomes due when ANY of:

- exact semantic retrieval **p95 > 200 ms**, measured at production corpus size;
- semantic retrieval becomes a **material share of ContextPackage build latency**
  (guide: > 40% of total);
- exact vector scans breach an established **infrastructure SLO** for memory or CPU;
- **load/concurrency testing** shows exact search no longer meets the service SLO
  under realistic parallelism.

Raw row count is no longer a trigger on its own. It remains worth emitting as an
observability signal, because a sudden jump in vector rows is a useful early
warning — it is simply not evidence of a latency problem by itself.

**The first scaling bottleneck is LEXICAL retrieval, not semantic.** Full-text
p95 reached 208 ms at 25,000 memories while the vector arm stayed at 5 ms. The
cause is `lm_any_term_tsquery` (migration 094), which relaxes
`websearch_to_tsquery`'s AND semantics to OR so that natural-language questions
match at all. That relaxation is correct for recall — with AND semantics the 3.1A
question set returned nothing — but at scale a single query matches a large
fraction of the corpus and `ts_rank_cd` must score all of it.

Options for a later step, none adopted here: bound the candidate set before
ranking; require a minimum term count for OR expansion; use `ts_rank_cd` with a
normalisation flag; or move the OR relaxation behind a first-pass AND attempt
that only falls back when AND returns too few rows. **No change is made in 3.1G**
— the measurement is recorded so the work is aimed at the real bottleneck rather
than at the one that was assumed.

---

## Amendment 4 — measured limits of the comparison layer, and a queue defect (2026-08-10)

Phase 3.1G. Three findings, all produced by running the system rather than by
reading it. Recorded here because each one changes what the ADR can honestly
claim.

### 4.1 The deterministic comparator can be confidently wrong (accuracy, not authority)

Controlled shadow validation (`docs/evals/continuous-learning-shadow-report.md`)
scored **5 of 7** decisions against expectations fixed before the run. Two
mismatches, with opposite severities:

| Existing belief | Incoming observation | Expected | Actual | Consequence |
|---|---|---|---|---|
| "Meta creative fatigues above frequency 3" (inferred) | "Meta creative performs better above frequency 3" | CONTRADICTION | **REINFORCEMENT** | `reinforce`, **no founder review** |
| "Search converts better than Meta" (no segment stated) | "Search converts worse than Meta for enterprise buyers" | UNRELATED | **CONTRADICTION** | `challenge`, founder review — safe but noisy |

The first is the serious one. `fatigues` is absent from `POLARITY_PAIRS`, so no
polarity conflict is detected and two contradictory claims are read as mutually
supporting. Because the deterministic path *decided*, the case never reaches the
model that would likely have caught it — and `reinforce` requires no review. In
`active` mode this raises confidence on a belief the evidence undermines.

The second is `compareScope()` returning `same` when only one side states a
segment: the dimension is skipped as incomparable rather than treated as a
difference. Rule 35 (duplicate · reinforcement · contradiction · unrelated)
therefore separates the four reliably only when **both** claims state the
dimension that distinguishes them. That qualification is now part of the rule:
scope-aware comparison degrades to channel-only comparison whenever one side is
silent, and a silent side is the common case for older, unscoped beliefs.

**Neither is an authority breach.** No automated source superseded a founder
statement in any case, in any mode — `decide()` does not consult the ingestion
mode and cannot be widened by a classification. Invariant 3 is intact.

**Consequence for the ADR:** rule 30 is amended to "scope-aware comparison,
reliable only where both claims state the dimension". Automatic learning stays
in `shadow` until 4.1 is fixed; see
`docs/continuous-learning-activation-contract.md`.

### 4.2 The model path is real and measurably good, on the cases that reach it

Ten hand-labelled ambiguous pairs, all verified to be ones the deterministic path
defers on, run against a live provider: **9/10** matched the pre-registered label
(2,106 input / 731 output tokens, $0.001440, ten `ai_requests` rows). Every
safety invariant held, including a prompt-injection case that was classified
CONTRADICTION and still produced only `challenge` + founder review.

The single miss — two different metrics about one channel read as
REINFORCEMENT with ambiguity 0.65 — is the same failure family as 4.1: a
reinforcement decision made without a founder on evidence that does not support
it.

### 4.3 The visibility timeout was inert — a crashed worker stranded work forever

Migration 093 gave `embedding_outbox` a lease and documented its purpose on the
column ("Without it a crash strands work forever"), but
`lm_claim_embedding_work()` selected `status = 'pending'` only. A row moved to
`'processing'` was never reconsidered, however long its lease had expired.

Any worker killed between claim and completion therefore stranded that job
permanently: the belief keeps a stale vector or none, is retrieved worse than its
neighbours forever, and the only trace is a slowly rising `processing_jobs`.

Fixed in **migration 098**, which claims `pending` OR `processing`-with-expired-lease
and adds an `embedding_stuck_jobs` view so a crash is distinguishable from
healthy in-flight work. `attempt_count` still increments per claim, so a job that
reliably kills its worker dies at `MAX_ATTEMPTS` instead of cycling.

Found by the §7 drill in `backend/tests/memoryResilience.pg.test.ts`, not by
inspection — the mechanism was built, wired, documented, and then filtered out of
existence by its own `WHERE` clause.

---


## Amendment 5 — the deterministic reinforcement boundary (2026-08-10)

Phase 3.1G remediation. Closes B1 from Amendment 4.

### The rule, changed

**Before:** deterministic REINFORCEMENT was returned whenever two claims shared a
subject, both carried polarity vocabulary, and no OPPOSING pair was detected.
Absence of a detected conflict was treated as evidence of agreement.

**After:** deterministic REINFORCEMENT requires PROVABLE alignment — the two
claims must make the same assertion, with one possibly saying more:

  1. identical polarity vocabulary on both sides, and
  2. at most a ONE-SIDED residual of unmatched content words (elaboration).

Both sides carrying unmatched content words means each asserts something the
other does not. That is divergence, not agreement, and it now DEFERS to the
model rather than resolving.

### Why the obvious fix was rejected

The measured failure was:

    existing   "Meta creative fatigues above frequency 3"
    candidate  "Meta creative performs better above frequency 3"

The tempting repair is to add `fatigues`/`performs` to `POLARITY_PAIRS`. That
fixes one sentence and leaves the shape of the bug untouched, because the table
can never cover English and every word it misses is another silent false
reinforcement.

The actual mechanism was subtler than a missing antonym: **`above` appears in
both claims and IS in the table**, as a direction word. Both sides therefore
registered positive polarity, no opposite was found, and the comparator inferred
agreement from a threshold preposition while the words carrying the real meaning
— `fatigues` and `performs` — sat unexamined in the subject set. No antonym table
would have prevented that.

### The asymmetry this encodes

A missed reinforcement costs one model call. A false reinforcement raises
confidence in a belief the new evidence undermines, and `reinforce` requires no
founder review, so it happens silently and compounds. The comparator is therefore
deliberately biased toward deferral, and deferral rate is explicitly NOT a metric
to optimise.

### The model prompt was tightened in the same pass

REINFORCEMENT now requires the model to judge that B supports THE SAME ASSERTION
as A — same subject, same direction, same measure — with an instruction that two
different metrics about one channel are UNRELATED, and that uncertainty should
resolve to UNRELATED because it mutates nothing. This closed the one live-set
miss from Amendment 4 (cost-per-install vs click-through-rate read as mutually
supporting).

### Measured effect

| Surface | Before | After |
|---|---|---|
| Live model-assisted set | 9/10, one dangerous reinforcement | **16/16**, zero |
| Controlled shadow validation | 5/7, B1 reinforced with no review | **6/7**, B1 → CONTRADICTION → challenge |
| Adversarial predicate pairs (11) | not covered | **0 reinforcements**, all defer or contradict |

The remaining shadow mismatch is the scope case from Amendment 4 §4.2, which
over-flags in the SAFE direction (challenge + founder review) and is left as
conservative-by-design.

### Rule 35, amended

Rule 35 (duplicate · reinforcement · contradiction · unrelated) now reads: the
four resolutions are separated reliably only where both claims state the
dimension that distinguishes them, and REINFORCEMENT specifically requires
provable predicate alignment rather than the absence of a detected conflict.

---


**Related:** ADR-019, ADR-020, ADR-021, ADR-022 (memory model) · ADR-023 (Context Engine) · ADR-027 (AI audit) · ADR-030 (queue strategy) · ADR-064 (data protection).
