# Phase 3.2 — Pre-Design A: Marketing Memory inspection and pressure test

> Inspection only. No code, schema, or data was modified. Every claim below was
> verified against the repository or the hosted database; where something could
> not be verified it says so.
>
> `CONTINUOUS_LEARNING_INGESTION_MODE` remains `shadow` and was not touched.

---

## Recommendation

**READY FOR 3.2 DESIGN A.**

The inspection produced hard, specific constraints rather than open questions, so
Design A has something firm to build against. Three defects were found in passing
(§2, §3) — they are pre-existing bugs to be scheduled, not blockers to designing.

The single most important finding is that **Marketing Memory has never actually
run.** The 33-row corpus is uniform synthetic seed data: every row `active`, every
row `version: 1`, **zero evidence rows**, zero reinforcements, no lifecycle
transition ever executed, and `content` holding only `{note, slug, synthetic}`.
Design A is therefore designing on a *specification*, not on observed behaviour.

---

## 1. Current Marketing Memory schema inventory

`marketing_memories`, assembled across migrations 035 · 088 · 090 · 094 · 096.

| Concern | Field | Notes |
|---|---|---|
| identity | `id` UUID PK | |
| workspace ownership | `workspace_id` → workspaces | added 088, RLS via `lm_is_workspace_member` |
| product ownership | `product_id` → products | nullable |
| founder attribution | `founder_id` → founders | original owner axis, pre-workspace |
| memory_type | `memory_type` | CHECK, 11 values |
| belief classification | `assertion_class` | CHECK, nullable: `business_fact` · `founder_assertion` · `model_belief` |
| title / claim | `title` TEXT NOT NULL | the claim lives here in practice |
| content | `content` JSONB | free-form, no schema, no CHECK |
| **scope** | **none** | **no column. See §6.** |
| source | `source` | CHECK, 8 values |
| **authority** | **none** | **derived from `source` at runtime. See §7.** |
| confidence | `confidence` NUMERIC(3,2) | 0.00–1.00 CHECK |
| confidence policy | `confidence_policy_version` INTEGER | nullable — **NULL on all 33 rows** |
| evidence references | `evidence_ids` UUID[] | array, no FK enforcement |
| lifecycle | `status` | CHECK, 7 values (096) |
| founder confirmation | **none explicit** | inferred from `source='founder_feedback'` |
| review-required | `review_required` BOOLEAN NOT NULL DEFAULT false | |
| version | `version` INTEGER | |
| reinforcement history | `reinforcement_count` INT, `last_reinforced_at` | |
| supersession | `superseded_by` → self, `superseded_at` | |
| retraction | `retracted_at`, `retraction_reason` | |
| **time validity** | **none** | **`valid_from`/`valid_until` exist on VERSIONS only. See §9.** |
| decay class | `decay_class` | CHECK, 4 values, nullable |
| timestamps | `created_at`, `updated_at`, `archived_at` | |
| provenance | via `source` + `evidence_ids` + version chain | no single provenance object |
| retrieval eligibility | `status`, `workspace_id`, `product_id`, `memory_type`, `search_tsv` | GENERATED tsvector + GIN (094) |
| **importance / quality / salience** | **none — verified absent** | |

Verified absent on the live table: `scope`, `authority`, `valid_from`,
`valid_until`, `importance`, `quality`, `salience`, `key`, `archive_reason`.

**Supporting tables:** `marketing_memory_versions` (036 + 096: adds
`valid_from`, `valid_until`, `change_reason`, `content_hash`, `learning_event_id`,
`evidence_ids`, `title`, `memory_type`, `status`, `rendering_version`) ·
`evidence` (039 + `independence_key` GENERATED, 096) · `memory_challenges` (096) ·
`confidence_policies` (096) · `context_packages` / `context_package_items` (095) ·
`memory_embeddings` / `embedding_outbox` (089/093) ·
`growth_brain_learning_events` (085) · `learning_events` (040) ·
`knowledge_nodes` / `knowledge_edges` (037/038).

---

## 2. Current write-path map

**`MemoryLifecycleService` is NOT the only authoritative mutation boundary.**
Eight direct writes bypass it, in three files:

| File | Line | Operation | Bypasses lifecycle |
|---|---|---|---|
| `marketingMemoryService.ts` | 70 | `.insert()` — `createMemory` | yes |
| `marketingMemoryService.ts` | 232 | `.update(patch)` — `updateMemory` | yes |
| `marketingMemoryService.ts` | 276 | `.update(patch)` — `archiveMemory` | yes |
| `marketingMemoryService.ts` | 426 | `.update({evidence_ids})` — `mergeMemories` | yes |
| `marketingMemoryService.ts` | 495 | `.update({evidence_ids, confidence})` — `addEvidence` | yes |
| `onboardingService.ts` | 893 | bulk `.insert(memories.map(...))` | yes |
| `agents/memoryAgent.ts` | 51 | `.update({status:'archived'})` | yes |
| `agents/memoryAgent.ts` | 81 | `.update({status:'archived', archive_reason:'duplicate'})` | yes |

`memoryLifecycleService.ts` itself performs exactly one read (line 68) and routes
every mutation through `lm_apply_memory_transition` (line 98). Within its own
boundary the discipline is clean; the boundary simply is not exclusive.

**Two distinct, competing mutation APIs exist:**

| `marketingMemoryService` (M04) | `memoryLifecycleService` (3.1F) |
|---|---|
| createMemory · updateMemory · archiveMemory · mergeMemories · addEvidence | reinforce · challenge · resolveChallenge · supersede · retract · markStale · founderCorrect · ingestCandidateClaim |
| direct table writes | single transactional RPC |
| no state-machine validation | `ALLOWED_TRANSITIONS` enforced in SQL |
| no version snapshot on all paths | snapshot written atomically with the transition |

### Defect found — `memoryAgent` writes a column that does not exist

[memoryAgent.ts:81](backend/src/services/agents/memoryAgent.ts#L81) sets
`archive_reason` on `marketing_memories`. That column exists only on `products`
(migration 029). Verified live: `42703 column marketing_memories.archive_reason
does not exist`. `memoryAgent` **is** registered in `agentRegistry` as `memory:`,
so this is reachable via the Mission Orchestrator — its dedup path cannot succeed.

### Who can do what today

| Action | Path(s) | Authoritative? |
|---|---|---|
| create | `createMemory`, `onboardingService` bulk insert, `ingestCandidateClaim` | no — 2 of 3 bypass |
| reinforce | `reinforceMemory`, and `addEvidence` (raises confidence directly) | split |
| challenge | `challengeMemory` only | yes |
| supersede | `supersedeMemory`; `memoryAgent` approximates it via `status='archived'` | split |
| retract | `retractMemory` only | yes |
| mark stale | `markStale` only | yes |
| founder-correct | `founderCorrect` only | yes |
| change confidence | `lm_apply_memory_transition`, **and** `updateMemory`, **and** `addEvidence` | no |
| attach evidence | `addEvidence` (direct), `lm_apply_memory_transition` (p_evidence_ids) | no |

---

## 3. Current read-path map

| Consumer | Reads | Via RetrievalService? | Status-filtered? | Scope-filtered? |
|---|---|---|---|---|
| `retrievalService.ts` | 3 arms + RRF | — (is the service) | yes, default `['active']` | workspace + product + type only |
| `contextEngine.ts` (V1) | direct SELECT | **no** | yes `.eq('status','active')` | founder/product |
| `context/contextPackageV2.ts` | direct SELECT | **no** | selects `status`, applies lifecycle filter downstream | workspace |
| `routes/owner.route.ts` | direct SELECT | **no** | yes `.eq('status','active')` | founder/product |
| `recommendationEngineService.ts` | direct SELECT | **no** | **no** | founder/product |
| `marketingMemoryService.ts` | 16 direct SELECTs | **no** | varies | founder/product |
| `memoryAgent.ts` | 4 direct SELECTs | **no** | `.eq('status','active')` on one path | founder/product |
| `claimCandidateBuilder.ts` | direct SELECT of ALL active | **no** | yes | workspace only |
| `learningPipelineService.ts` | direct SELECT | **no** | via `findDuplicateMemory` | founder/product |

**Only one consumer uses RetrievalService.** Every reasoning surface —
Morning Brief (`owner.route`), Context Engine V1, Recommendations, Growth Brain,
the memory agent — reads `marketing_memories` directly.

### Defect found — the Recommendation Engine has never used Marketing Memory

[recommendationEngineService.ts:109](backend/src/services/recommendationEngineService.ts#L109)
selects `memory_type, key, content, confidence`. There is no `key` column.
Verified live: `42703 column marketing_memories.key does not exist`, `data: null`.
The result is consumed as `const memories = memoriesRes.data ?? []` — the error is
discarded, so `memories` is **always `[]`**.

This is the same failure shape as the `insight_type` / `insight_key` defect closed
in 3.1G: a wrong column name, an unchecked `error`, and a silent empty result that
is indistinguishable from "nothing to say".

Also noted: no consumer reconstructs historical versions at all
(`marketing_memory_versions` has **0 rows**), so incorrect reconstruction cannot
currently occur — the capability is simply unexercised.

---

## 4. Current ingestion / shadow path

```
connection_insight (084)
  └─ buildFromConnectionInsight()        deterministic template; claim = row.headline
campaign_result   → buildFromCampaignResult()      claim from numbers only
experiment_result → buildFromExperimentResult()    refuses inconclusive
        │
        ├─ eligibility:  headline ≥ 8 chars · workspace_id present · a metric exists
        │                (no separate eligibility layer)
        ├─ candidate retrieval:  SELECT * FROM marketing_memories
        │                        WHERE workspace_id = ? AND status = 'active'
        │                        ← ALL of them; RetrievalService is NOT used
        ├─ compareClaims()  deterministic → model only when deferred
        ├─ decide()         beliefPolicy, pure
        └─ ShadowReport     RETURNED IN MEMORY — nothing persisted
```

| Question | Answer |
|---|---|
| Promotion policy exists? | Partially — `decide()` returns an action; there is no threshold/promotion policy |
| Candidate eligibility exists? | Only inline guards inside each builder; no eligibility layer |
| Shadow records stored? | **None.** `claimCandidateBuilder.ts` contains zero inserts |
| What data is stored in shadow? | Nothing |
| Shadow mirrors the active path? | Yes for build → compare → decide; diverges at apply |
| Production caller wired? | Yes — `learningPipelineService` routes `campaign_result` and `experiment_result` through `routeClassA` → `ingestClassACandidate`. `runShadowIngestion` has **no** production caller (script only) |
| Source without provenance? | No — every builder sets `provenance {kind, sourceId, provider}`; tenancy resolved from the canonical record via `resolveMemoryWorkspace` |

---

## 5. Current taxonomy

| Dimension | Values | DB enforced | TS enforced |
|---|---|---|---|
| `memory_type` | founder · brand · product · customer · campaign · creative · review · competitor · experiment · market · seasonality (11) | CHECK | `MEMORY_TYPES` |
| `source` | intake · growth_brain · campaign_performance · review · analytics · founder_feedback · ai_conversation · experiment (8) | CHECK | `MEMORY_SOURCES` |
| `status` | draft · active · challenged · superseded · stale · retracted · archived (7) | CHECK (096) | `MEMORY_STATES` |
| precedence tier | founder_confirmed · observed_first_party · verified_external · derived_inference · anonymized_playbook (5) | **not persisted** | `SOURCE_PRECEDENCE_ORDER` |
| `decay_class` | NON_DECAYING · SLOW_DECAY · PERFORMANCE_DECAY · SOURCE_FRESHNESS_DRIVEN (4) | CHECK | `DECAY_CLASSES` |
| `assertion_class` | business_fact · founder_assertion · model_belief (3) | CHECK | — |
| actor type | system · founder · ai (3) | RPC param + `changed_by` CHECK | `ActorType` |
| classification | DUPLICATE · REINFORCEMENT · CONTRADICTION · UNRELATED (4) | CHECK on challenges | `ClaimClassification` |
| challenge status | open · resolved_kept · resolved_superseded · resolved_retracted · dismissed (5) | CHECK | — |
| confidence band | LOW · MODERATE · STRONG · VERY_STRONG (4) | — | `CONFIDENCE_BANDS` |

### Overlap and semantic ambiguity

1. **`status='archived'` vs `'superseded'`** — 096 documents archived as "legacy
   synonym for superseded; retained, never rewritten". Two values, one meaning.
   `memoryAgent` still writes `archived`; the lifecycle service writes `superseded`.
2. **`memory_type` conflates subject with provenance** — `founder`, `review`,
   `experiment` describe *where it came from*; `brand`, `customer`, `market`
   describe *what it is about*. `source` already carries provenance, so the two
   axes overlap.
3. **`assertion_class` vs precedence tier** — both express "how much authority",
   independently. `assertion_class` is persisted but consulted by nothing;
   precedence is consulted everywhere but persisted nowhere. Exactly inverted.
4. **`source` mixes channel and mechanism** — `intake`, `ai_conversation` are
   capture mechanisms; `campaign_performance`, `analytics`, `review` are data
   origins.
5. **`stale` vs `decay_class`** — one is a state, one is a rate, and nothing
   currently transitions the first based on the second.

---

## 6. Current scope model

**Scope has no physical representation.**

| Dimension | Column | JSONB | Read by comparison | Filterable by retrieval |
|---|---|---|---|---|
| workspace | `workspace_id` | — | via productId only | **yes** |
| product | `product_id` | — | yes | **yes** |
| channel | no | `content.channel` | yes | **no** |
| segment | no | `content.segment` | yes | **no** |
| audience | no | (declared, unread) | yes | **no** |
| market / geography | no | `content.market` | yes | **no** |
| timeframe | no | `content.timeframe` | yes | **no** |
| campaign | no | — | no | no |
| funnel stage | no | — | no | no |
| creative / message | no | — | no | no |
| competitor | `memory_type='competitor'` | — | no | via memory_type |

- **Where it lives:** `content` JSONB, unindexed and unconstrained. No CHECK, no
  enum, no GIN index on any scope key.
- **Where ClaimComparison gets it:** `memoryLifecycleService.ts:486-487` and
  `claimCandidateBuilder.ts:307,422` read `content.channel`, `content.segment`,
  `content.market`, `content.timeframe`; `productId` comes from the column.
- **Can RetrievalService filter on the same representation?** **No.** It filters
  `workspace_id`, `product_id`, `memory_type`, `status` only
  ([retrievalService.ts:160-164](backend/src/services/memory/retrievalService.ts#L160)).

**The scope keys are absent from real data.** All 33 hosted memories have exactly
three `content` keys: `note`, `slug`, `synthetic`. There is no `claim`, no
`channel`, no `segment`, no `market`, no `timeframe`. So `compareScope()` returns
`unknown` for every real comparison today, and `claimComparison` falls back to
`title` because `content.claim` does not exist either.

This is the sharpest constraint on Design A: **scope is asymmetric** — six
dimensions readable by comparison, two filterable by retrieval, zero populated in
production.

---

## 7. Current founder-authority model

| Concept | Representation |
|---|---|
| founder assertion | `source='founder_feedback'`, or `assertion_class='founder_assertion'` (unused) |
| founder confirmation | none explicit; inferred from source |
| founder correction | `founderCorrect()` → transition with `actor_type='founder'` |
| founder preference | a `memory_type='founder'` row |
| founder constraint | `approval_boundary_policies` (separate table, 1 row) — not memory |
| review required | `review_required` BOOLEAN + `memory_challenges.requires_founder_review` |

**Authority is inferred, not persisted.** `precedenceTier(source)` is a hard-coded
`switch` in `beliefPolicy.ts:88`. `mayAutoOverride()` and `requiresFounderReview()`
both call it. There is no authority column.

**Historical transitions do NOT preserve the authority tier under which they
happened.** `marketing_memory_versions` stores `source` and `changed_by`, and the
tier is re-derived at read time from the *current* mapping. If the `switch` in
`precedenceTier` is ever edited, every historical decision is silently
reinterpreted under the new rules, with nothing recording that it changed.

`assertion_class` is populated on all 33 rows (`business_fact` 21,
`model_belief` 12, `founder_assertion` **0**) and is read by no policy code.

---

## 8. Current confidence / importance / quality

**Stored:** `confidence` NUMERIC(3,2) with CHECK; `confidence_policy_version`
INTEGER (**NULL on all 33 rows**); `evidence.confidence_boost`;
`confidence_policies` table (version · description · inputs[] · floor · active).

**Policy:** `computeConfidence()` in `beliefPolicy.ts`, `CONFIDENCE_POLICY_VERSION = 1`,
`RETRIEVAL_CONFIDENCE_FLOOR = 0.25`, founder floor 0.60, four `CONFIDENCE_BANDS`.
Inputs: source precedence · evidence count · independence · recency · decay class ·
contradiction. Confidence is *recomputed from the full evidence set*, not
incremented ([memoryLifecycleService.ts:132](backend/src/services/memory/memoryLifecycleService.ts#L132)) — except on the
`marketingMemoryService.addEvidence` path, which writes `confidence` directly.

**Versioning:** `confidence_policies` holds exactly one active row —
`version 1, floor 0.25, active true`, described as *"Confidence is the STRENGTH OF
SUPPORT for a LaunchMind belief, not the probability that the statement is
objectively true."* The registry therefore exists and is populated. What is
missing is the **link**: `marketing_memories.confidence_policy_version` is NULL on
all 33 rows, so no stored confidence is attributable to the policy that produced
it. Note the two floors are distinct and both real: the registry/retrieval floor
is 0.25, and the founder floor of 0.60 is applied in `computeConfidence`
(`beliefPolicy.ts:298`).

**Importance / quality / salience / decision value: verified absent everywhere** —
no column, no service, no type.

**What could support derived importance today:** `reinforcement_count`,
`last_reinforced_at`, `evidence_ids` cardinality, `evidence.independence_key`,
`memory_challenges` count, `context_package_items` (how often a memory was
actually selected into a reasoning context), `saved_opportunities` linkage,
`growth_brain_learning_events.affected_recommendation_ids`.

**What could support derived quality:** `assertion_class`, precedence tier,
evidence independence, `content_hash` stability across versions, challenge
survival rate, `decay_class` versus `last_reinforced_at`.

Both are computable from existing data. Neither exists.

---

## 9. Version / time-validity model

| Capability | Supported | Evidence |
|---|---|---|
| A. memory changes over time | **yes, by design** — untested | `marketing_memory_versions` + `lm_apply_memory_transition` writes a snapshot atomically with each transition. **0 rows exist.** |
| B. time-bounded business fact (Price $49 Jan–May, $59 June+) | **no** | `valid_from`/`valid_until` exist on **versions only**, not on `marketing_memories`. The live record cannot express a validity window; only its history can. Two overlapping facts cannot both be `active`. |
| C. founder constraint changed on a known date | **partially** | The transition is recorded with `created_at` and `change_reason`; the *effective* date of the business change is not separable from the *recording* date. |
| D. historical reconstruction | **mechanically yes, in practice untested** | Version chain + `content_hash` + `learning_event_id` are present. Zero versions exist, so reconstruction has never been exercised on real data. |

Present: `version`, `valid_from`, `valid_until`, `change_reason`, `content_hash`,
`learning_event_id`, `superseded_by`, `superseded_at`.
**Gaps:** no validity window on the live row; no distinction between *recorded_at*
and *effective_at*; no successor pointer on versions (only on the parent record);
no constraint preventing two `active` memories with overlapping validity.

---

## 10. Idempotency and concurrency

| Mechanism | Present | Where |
|---|---|---|
| row lock on transition | **yes** | `SELECT … FOR UPDATE` at `097:100` |
| state-machine validation in SQL | **yes** | `097:123` raises on invalid transition |
| workspace re-verification in SQL | **yes** | `097:107` |
| atomic snapshot + transition | **yes** | `097:130` insert, `097:145` update, one transaction |
| optimistic version check | **NO** | the RPC takes no `p_expected_version` |
| one-open-challenge guard | **yes** | `memory_challenges_one_open` partial unique index |
| embedding identity dedup | **yes** | `memory_embeddings_identity` unique index |
| outbox single open job | **yes** | `embedding_outbox_one_open_job` unique index |
| outbox claim | **yes** | `FOR UPDATE SKIP LOCKED` + lease (093 + 098) |
| evidence idempotency | **partial** | `independence_key` GENERATED, but no unique index on it |
| candidate idempotency | **NO** | nothing dedupes a candidate across runs |
| advisory locks | none | |

### Actual race risks

1. **Lost update on confidence.** `marketingMemoryService.updateMemory` and
   `addEvidence` write outside the RPC and take no lock, so a concurrent
   lifecycle transition and a direct update can clobber one another. The RPC's
   `FOR UPDATE` protects only callers that use the RPC.
2. **Founder correction racing automated ingestion.** Both serialise on the row
   lock *if both use the RPC*. `founderCorrect` does; `updateMemory` does not.
3. **Duplicate candidates.** No candidate-level idempotency key, so re-running
   ingestion over the same `connection_insight` produces the same candidate again.
   Harmless in shadow (nothing persists); a duplicate-creation risk when active.
4. **Simultaneous reinforcement** is safe *within* the RPC (recompute-under-lock),
   unsafe via `addEvidence`.
5. **No `expected_version`**, so a caller that read v3 and transitions after
   another writer moved it to v4 will apply against v4 without noticing.

---

## 11. Evidence lifecycle

`evidence` has: `id`, `founder_id`, `product_id`, `workspace_id`, `evidence_type`
(7 CHECK values), `source_id`, `source_table`, `data` JSONB, `confidence_boost`,
`independence_key` (GENERATED), `created_at`.

| Can evidence become… | Supported |
|---|---|
| invalid | **no** — no status column |
| retracted | **no** |
| corrected | **no** — the table is append-only by trigger (091) |
| deduplicated | **partially** — `independence_key` exists but is not uniquely indexed and nothing consumes it for dedup |
| reclassified | **no** |
| deleted | only via `lm_erase_founder_history` (GDPR) or FK cascade |

**No memory citing changed evidence is re-evaluated.** There is no trigger, no
job, and no service that recomputes confidence when the evidence set changes
underneath a memory. `evidence_ids` is a plain UUID array with no foreign key, so
an id can point at a deleted row with nothing detecting it.

**Documented gap, not implemented.**

---

## 12. Retraction / re-promotion

| Question | Answer |
|---|---|
| Why retracted | `retractMemory(opts.reason)` — required argument |
| Reason persisted | **yes** — `retraction_reason` column + `change_reason` on the version row |
| Retracted from retrieval | yes — `RETRIEVABLE_STATES = ['active']` |
| Can old evidence recreate the same memory later | **yes, nothing prevents it.** `findDuplicateMemory` matches on **title equality** and is used by the legacy path; the Class-A path compares only against `status='active'` memories, so a retracted belief is invisible to comparison and an identical claim is classified `NO_MATCH → create_new` |
| Founder correction blocks weaker re-promotion | **only while the memory is `active`.** `requiresFounderReview` keys off the *incumbent's* source; once retracted, the incumbent is not retrieved at all |
| Tombstone / blocked-claim mechanism | **absent** — verified, no matches anywhere in `src/` or `migrations/` |

This is a real re-promotion hole: retract a belief, and the next matching
observation recreates it as new, with no memory of the retraction.

---

## 13. Cold start

Onboarding produces, and the hosted database currently holds:

| Table | Rows | Content |
|---|---|---|
| `founder_context` | 2 | audience, context_delta, working_style, notification_cadence |
| `business_goals` | 1 | goal_type, target_value, unit, time_horizon |
| `strategy_directions` | 1 | AI-generated 4-week direction |
| `competitor_relationships` | 7 | name, relationship, key_differentiator |
| `product_claims` | 6 | FACT / INFERENCE / QUESTION + evidence_sources |
| `approval_boundary_policies` | 1 | autonomous_permitted[], approval_required[] |
| `products` | 3 | confirmed_icp, brand_voice_profile, scraped_meta |
| `onboarding_sessions` | 3 | 16-state machine |

**None of it becomes Marketing Memory.** The 33 memories carry sources
`intake` (12), `analytics` (9), `campaign_performance` (6), `review` (3),
`experiment` (3) — and `founder_feedback` **0**. `onboardingService.ts:893` does
bulk-insert memories, but that path has evidently not produced the current corpus
(all 33 rows carry `content.synthetic`).

### Duplication risk

| Fact | Lives in | Also would live in |
|---|---|---|
| ICP / audience | `products.confirmed_icp`, `founder_context.audience` | a `customer` memory |
| positioning | `products.brand_voice_profile`, `product_claims` | a `brand` memory |
| goals | `business_goals` | a `founder` memory |
| boundaries | `approval_boundary_policies` | a `founder` memory |
| competitors | `competitor_relationships` | `competitor` memories |
| direction | `strategy_directions` | a `founder` memory |
| context delta | `founder_context.context_delta` | a `founder` memory |

Every one of these is **already authoritative somewhere else**. Copying them into
Marketing Memory creates two sources of truth with no synchronisation, and the
onboarding tables have their own update paths that would not fire memory
transitions. Design A must decide *reference or copy* for each; today the answer
is implicitly "neither", and Marketing Memory is empty of founder knowledge as a
result.

---

## 14. Current memory-corpus statistics

Hosted, measured directly.

| Metric | Value |
|---|---|
| Total memories | **33** |
| active | **33** |
| challenged / stale / superseded / retracted / archived / draft | **0 each** |
| by memory_type | 3 of each of the 11 types — perfectly uniform |
| by source | intake 12 · analytics 9 · campaign_performance 6 · review 3 · experiment 3 · **founder_feedback 0** |
| by assertion_class | business_fact 21 · model_belief 12 · **founder_assertion 0** |
| by decay_class | SLOW_DECAY 15 · PERFORMANCE_DECAY 9 · SOURCE_FRESHNESS_DRIVEN 9 · NON_DECAYING 0 |
| review_required | false × 33 |
| version | 1 × 33 |
| confidence_policy_version | NULL × 33 |
| **evidence rows** | **0** — average evidence per memory **0.00**, memories with no evidence **33** |
| reinforcement_count | 0 on every row |
| superseded_by / retracted_at / last_reinforced_at | 0 / 0 / 0 |
| workspaces / products | 1 / 3 |
| `marketing_memory_versions` | **0** |
| `memory_challenges` | **0** |
| `learning_events` | **0** |
| `growth_brain_learning_events` | 2 |
| `context_packages` | 3 |
| `memory_embeddings` | 33 (all current) |
| `connection_insights` | **0** |
| `intelligence_signals` | **0** |

Adjacent corpora that *do* have data: `campaigns` 24 · `campaign_metrics` 47 ·
`experiments` 6 · `saved_opportunities` 14 · `knowledge_nodes` 18 ·
`knowledge_edges` 12.

**Reading:** the memory subsystem is fully built and essentially unused. Every
lifecycle mechanism — versions, challenges, reinforcement, supersession,
retraction, evidence — has zero production instances.

---

## 15. Shadow measurement capability

| Can it measure… | Today |
|---|---|
| candidate count | in memory, per run |
| eligibility rejection | **no** — a builder returning `null` is silently skipped, with no reason recorded |
| duplicate / reinforcement / contradiction / unrelated | yes, in `ShadowReport.counts` |
| proposed new memory | yes (`create_new`) |
| proposed challenge | yes |
| proposed confidence change | **no** — `decide()` returns an action, not a target confidence |
| founder-review required | yes |

**The blocking gap: shadow persists nothing.** `claimCandidateBuilder.ts` contains
zero `insert` calls; `ShadowReport` is returned to the caller and discarded. There
is no `shadow_proposals` table.

Consequences:
- Shadow proposals **cannot be adjudicated later** — nobody can review last week's
  decisions, because they no longer exist.
- No precision/recall can be computed over time.
- The `active` path (`ingestClassACandidate`) likewise records nothing when it
  declines to apply, so a "queued for founder review" decision is lost.
- `growth_brain_learning_events` (2 rows) is the only durable learning surface and
  is not written by the shadow path.

---

## 16. Derived-score reproducibility

`context_packages` persists: `context_type`, `retention_class`, `retrieval_mode`,
`degraded`, `degraded_reasons`, `memory_outcome`, `memories_considered`,
`memories_selected`, `excluded_for_budget`, `token_budget`, `tokens_used`,
`build_ms`, `trace_id`, `expires_at`. `context_package_items` holds the referenced
record ids + versions (reference-not-prose).

**Absent from every persisted surface:** `retrieval_policy_version`,
`confidence_policy_version` (column exists on memories, never written),
`scoring_version`, `importance_policy_version`, `quality_policy_version`,
`prompt_version`, `model`.

`ai_requests` separately records model, prompt_id, tokens and cost per AI call,
and `prompts` is versioned — so the *generation* step is reproducible while the
*retrieval and scoring* steps are not.

**To explain a September recommendation in December after formulas change**, you
would need, and do not have: the retrieval policy version and its parameters
(RRF K, rerank weights, budgets), the confidence policy version actually applied,
the scope filter used, and a link from the recommendation to the
`context_package` that produced it. `context_packages` also carries
`expires_at` under a retention class, so the evidence may be *deleted* before the
question is asked.

---

## 17. Candidate cost / latency path

Per single candidate, traced from code:

| Step | Cost |
|---|---|
| build candidate | deterministic, 0 model calls |
| fetch comparison set | **1 DB query returning ALL active memories in the workspace** — no RetrievalService, no top-K, no scope narrowing |
| comparison | **a sequential `for` loop over every active memory**, breaking only on the first non-`UNRELATED` |
| deterministic comparison | free |
| model-assisted comparison | 1 Haiku call **per deferred pair** |
| policy | pure, free |
| persistence | 0 writes in shadow |

**Maximum model calls per candidate = N**, where N is the number of active
memories in the workspace — reached in the common case where the candidate is
genuinely new, because nothing matches and the loop never breaks early.

- Retry: `MAX_RETRIES = 2` in `aiPlatform`, so **up to 3N provider requests**.
- Latency: the loop is `await`-ed sequentially. At the measured ~2 s per Haiku
  call and today's 33 memories, a fully-deferred candidate is **~66 s**, ~200 s
  with retries.
- Scaling: cost and latency are **O(N) per candidate, O(N·M) per batch** of M
  candidates. At 1,000 memories a single candidate could issue 1,000 sequential
  model calls.
- Quota: Anthropic is the constraint for comparison; the embedding provider tier
  measured during 3.1G was **3 requests/minute**, which is a separate and much
  tighter limit on any retrieval-narrowed design.

The expensive step is unambiguous: **the unbounded comparison fan-out.**

---

## 18. Security / privacy findings

| Risk | Protection today | Gap |
|---|---|---|
| PII promotion | claims are built from structured fields via deterministic templates | `content` JSONB is unconstrained; nothing scans it |
| Prompt injection retained as durable memory | claim body is a template or a LaunchMind-authored `headline`; provider prose stays in `detail`/evidence; proven by test | `title` on the legacy `createMemory` path is caller-supplied and unfiltered |
| Spoofed founder attribution | precedence derives from the pipeline-set `source`, never from claim text; proven by test | any direct caller of `createMemory` may set `source: 'founder_feedback'` freely |
| Cross-workspace candidate | workspace resolved from the canonical record (`resolveMemoryWorkspace`); RLS via `lm_is_workspace_member`; retrieval filters in SQL | `founder_id` and `workspace_id` coexist as parallel ownership axes |
| Source substitution | RPC re-verifies workspace; embedding pipeline re-verifies tenancy | no signature/integrity on `provenance` |
| Provider prose promoted directly | only `row.headline` (rule-generated) is used, and only if ≥ 8 chars | headline is still provider-adjacent text; nothing validates it is rule-generated |
| False model-generated fact | the model **classifies only**; it never authors a claim; enforced structurally | — |
| Playbook de-anonymisation | `playbook_signals` has no `founder_id`/`product_id` by construction, stated in 3 migrations | — |
| Legal erasure conflict | `lm_erase_founder_history()` is the single sanctioned path through append-only triggers | `context_packages` expire on their own schedule, which can delete the evidence for a decision before an erasure request is even made |
| Shadow record leakage | nothing is persisted, so nothing can leak | the same fact is why nothing can be audited (§15) |

---

## 19. Components Design A should reuse UNCHANGED

1. **`lm_apply_memory_transition`** (097) — row lock, SQL-side state validation,
   workspace re-verification, atomic snapshot + transition. Correct and tested.
2. **`beliefPolicy`** as the sole decision authority — pure, deterministic,
   admits no similarity score. Invariant 3 depends on it.
3. **The three-module separation** — compare (proposes) → policy (decides) →
   lifecycle (applies). Structurally enforced by tests.
4. **`ALLOWED_TRANSITIONS`** and the 7-state machine.
5. **The comparator safety boundary** (ADR-066 Amendment 5) — reinforcement
   requires provable alignment.
6. **The embedding outbox + trigger enqueue + lease reclaim** (093, 098).
7. **`RetrievalService`** contract and its degradation reporting.
8. **`context_packages` / `context_package_items`** reference-not-prose model.
9. **Append-only history triggers + `lm_erase_founder_history`** (091).
10. **Workspace RLS helpers** (`lm_is_workspace_member`).

## 20. Components Design A must NOT duplicate

1. **A second mutation API.** Two already exist (§2); a third guarantees drift.
   Design A should *converge* on the lifecycle boundary, not add to it.
2. **A second confidence formula.** `computeConfidence` exists; importance and
   quality must be *derived* from stored inputs, not become parallel scores that
   silently disagree.
3. **A second scope representation.** Adding a `scope` JSONB beside the existing
   `content.channel` keys leaves two.
4. **A second history table.** `marketing_memory_versions` already carries
   `valid_from`/`valid_until`.
5. **A second learning-event log.** `learning_events` (M04 ingestion audit) and
   `growth_brain_learning_events` (3.1 explainability) already overlap; a third
   would be unmanageable.
6. **A second retrieval path.** Direct SELECTs are the problem to remove, not a
   pattern to extend.
7. **A second taxonomy for provenance.** `source` and `memory_type` already
   overlap on this axis.
8. **A separate vector store.** pgvector + the outbox are settled.

## 21. Constraints that should become DECIDED inputs to Design A

1. **`MemoryLifecycleService` is not exclusive.** 8 direct writes bypass it, in
   `marketingMemoryService`, `onboardingService`, `memoryAgent`. Design A must
   state which survive.
2. **Scope is asymmetric and unpopulated.** Comparison reads 6 JSONB dimensions;
   retrieval filters 2 columns; production data has none of them.
3. **Authority is derived, never persisted**, so history is reinterpreted whenever
   the mapping changes.
4. **The live record cannot express a validity window.** Only versions can.
5. **Shadow persists nothing** — no proposal can be adjudicated after the fact.
6. **Comparison is O(N) sequential with up to N model calls per candidate**, and
   does not use RetrievalService. This is the scaling wall.
7. **`evidence_ids` is an unenforced UUID array**, evidence has no lifecycle, and
   no memory is re-evaluated when its evidence changes.
8. **No tombstone**, so a retracted belief can be recreated by the same evidence.
9. **Retrieval is `status='active'` only**, so history questions are unanswerable
   (measured: 8 of 104 held-out queries structurally impossible).
10. **No policy versions are persisted on any decision**, so past recommendations
    cannot be explained after a formula change.
11. **The corpus is empty of real behaviour** — 0 evidence, 0 versions,
    0 challenges, 0 connection_insights. Design A cannot be validated against
    production data that does not exist.
12. **Onboarding knowledge is authoritative elsewhere** in 6 tables and is not
    memory; copying creates dual sources of truth.
13. **Two ownership axes** (`founder_id`, `workspace_id`) coexist on every table.
14. **`archived` and `superseded` are documented synonyms**, both still written.
15. **`assertion_class` is persisted but unread; precedence is read but unpersisted.**

## 22. Questions that remain genuinely OPEN

1. Is Marketing Memory the **system of record** for founder-stated facts, or an
   **index over** systems of record (`founder_context`, `business_goals`,
   `approval_boundary_policies`)? §13 shows today's answer is accidental.
2. Should scope be **structured columns**, a **typed JSONB with a CHECK**, or a
   **scope table**? Retrieval filterability versus comparison expressiveness pull
   in opposite directions, and only measurement on real data can settle it.
3. Should a **time-bounded fact** be one memory with a validity window, or a chain
   of superseded memories? Both are representable; they behave differently under
   contradiction.
4. What narrows the comparison set — retrieval top-K, scope match, embedding
   threshold, or type? §17 makes *something* mandatory; which is unresolved.
5. Should `memory_type` be **split** into subject and provenance axes, or left
   overlapping?
6. Does a retraction tombstone block **the claim**, **the evidence**, or **the
   source**?
7. Should importance/quality be **stored** (fast, needs invalidation) or
   **computed at read** (always current, costs latency)?
8. What is the **founder-review queue**? Decisions requiring review are produced
   today and go nowhere.
9. Does shadow adjudication need **founder labels**, or is agreement with the
   eventual active decision sufficient ground truth?
10. Should `marketingMemoryService` be **deleted**, **wrapped**, or **frozen**?
11. What is the **active-memory budget** per workspace, and does it need one given
    that measured exact vector scan is 4–5 ms at 25,000 vectors?
12. How does Design A get **real validation data** given the corpus is synthetic
    and zero providers are connected?
