# Phase 3.2A — Three-Product Shadow Validation Report

Run: 2026-08-13 · Mode: `shadow` (env unset → `ingestionMode()` defaults to shadow)
Corpus: `CANVA_CORPUS_HASH = 1abd376ffe7911b628bcbeb35987b8169a4268843afb89fcfd4029a7812735da`
Runner: `backend/scripts/threeProductShadow.ts`

## Verdict summary

The engine's **safety** properties held everywhere they were exercised. The engine's
**comparison** properties were **not validated** — the run could not reach them.

---

## 1. Arm results

| | CANVA (lab) | ALLIGNX | LAUNCHMIND |
|---|---|---|---|
| candidates | 85 | 2 | 2 |
| Gate A ELIGIBLE | 84 | 0 | 0 |
| Gate A EVIDENCE_ONLY | 0 | 1 | 1 |
| Gate A INELIGIBLE | 1 | 1 | 1 |
| Gate B CREATE_NEW | 84 | 0 | 0 |
| Gate B reason | NO_RELATED_MEMORY ×84 | — | — |
| requiresFounderReview | 0 | 0 | 0 |
| relatedRetrieved | 0 | 0 | 0 |
| model calls | **0** | **0** | **0** |
| provenance complete | 85/85 | 2/2 | 2/2 |

Gate A reasons — CANVA: `OK` ×84, `INSTRUCTION_SHAPED` ×1.
ALLIGNX / LAUNCHMIND: `RAW_PROVIDER_PROSE` ×1 (founder statement), `NO_EVIDENCE` ×1 (derived challenger).

**The numbers differ for understandable reasons**, as required: Canva has 85 evidence-backed public claims;
the owner businesses have **zero** connected providers, so the real pipeline genuinely produces nothing.
This was not padded.

---

## 2. What was NOT validated, and why

### 2a. Comparison, contradiction, reinforcement, scoped exception — NOT VALIDATED

All 84 eligible Canva candidates returned `relatedRetrieved = 0` and Gate B reason `NO_RELATED_MEMORY`.
Shadow never promotes, so candidate *N+1* cannot see candidate *N*: the corpus was compared against an
empty memory set.

A follow-up **relation probe** seeded the 8 incumbent halves of the frozen pairs as lab memories and re-ran
the challengers. Result **0/8**, with 7 of 8 retrieving nothing. **That figure is confounded and must not be
read as an engine accuracy score**: the incumbents were inserted in the same run, so their embeddings were
still queued and the semantic arm could not match them. The probe was not a fair test.

Consequently **COMPARISON_ACCURACY is unmeasured**, and the **model call budget was never exercised** —
0 calls across all arms means the comparator, its deferral logic and ADR-066 Amendment 5 were not reached.

### 2b. ENGINE DEFECT — Gate B creates blind under degraded retrieval

`marketingMemoryEngine.ts:345` sets `comparisonUnavailable = retrievalFailed`, and `retrievalFailed` is set
**only** when `retrieveMemories()` throws. A retrieval that *degrades* (semantic arm dead) returns zero
results without throwing. `related.degraded` is recorded on the proposal (lines 498, 526) but is **never
passed to `decidePromotion`**.

So a degraded retrieval is indistinguishable from "genuinely nothing related", and Gate B fires `CREATE_NEW`
blind — the exact corpus fragmentation the comment above that code warns about, with the guard covering only
the throw case. In `active` mode this would fragment the corpus during any embedding-provider outage.

Classification: **ENGINE_DEFECT**. Severity: high for activation, none in shadow.

### 2c. Three of four Gate-A rejection probes did not fire

| probe | expected | actual |
|---|---|---|
| cv-200 "Canva is good." | CLAIM_TOO_SHORT | ELIGIBLE |
| cv-201 unfalsifiable narrative | NOT_DECISION_BEARING | ELIGIBLE |
| cv-202 instruction-shaped | INSTRUCTION_SHAPED | **INELIGIBLE ✓** |
| cv-203 fabricated private metrics | UNSUPPORTED_AI_INFERENCE | ELIGIBLE |

`cv-203` is the significant one: a claim asserting a fabricated CAC and conversion rate passed Gate A because
an evidence row backed it. **Gate A cannot detect fabricated private metrics when evidence exists.** The
protection against inventing private metrics lives in the ingestion/corpus layer, not in Gate A — which is
worth stating explicitly, because the opposite is easy to assume.

Classification: cv-200/201 **LABEL_DEFECT** (my thresholds were stricter than policy); cv-203 **POLICY_DEFECT**.

### 2d. Public evidence is not representable as a memory

`marketing_memories.source` is a closed CHECK set —
`intake | growth_brain | campaign_performance | review | analytics | founder_feedback | ai_conversation | experiment`.
There is **no value for externally-sourced public evidence**. Canva-class memory cannot be stored today
without a migration. The lab probe used `growth_brain`, which BeliefPolicy reads for precedence, making the
incumbent stronger than a true public memory would be — conservative for the probe.

---

## 3. Safety properties that DID hold

- **Founder authority preserved.** The derived public challenger to a founder audience directive was refused
  `NO_EVIDENCE` at Gate A on both owner businesses. It never reached comparison, so it could not override.
- **Public evidence never became founder authority.** No branch of `authorityForCandidate` can return a
  founder tier for `actorType: 'system'`; the entire Canva arm resolved to `DERIVED_INFERENCE`.
- **Instruction-shaped injection rejected** (cv-202), and the rejection short-circuited before any model call.
- **Cold start conservative.** LaunchMind (no public evidence, no providers) produced zero promotable
  candidates and zero fabricated observations. Corroboration was not relaxed for `maturity=pre_launch`.
- **Provenance completeness 100%** (89/89): every candidate carried a trace id and a deterministic
  idempotency key.
- **Idempotency held.** Re-running produced `duplicates = 85 / 2 / 2` and zero new proposals.
- **Append-only enforced.** `evidence` refused an update (ADR-066 rule 2) on re-freeze, forcing insert.
- **Governed CHECKs enforced.** A hand-built `scope_key` was refused by `marketing_memories_scope_key_shape_ck`.

---

## 4. Isolation and mutation

**CROSS_BUSINESS_ISOLATION — PASS.** Proposals partition cleanly: CANVA_LAB 178, ALLIGNX 2, LAUNCHMIND 2.
Canva claim text inside owner workspaces: **0**.

Canva lives under a dedicated **lab founder** (not an auth user, cannot sign in), so it cannot appear in the
real owner's company switcher.

**NO_MUTATION_PROOF — PASS at owner scope.** Owner marketing memories: **8, unchanged**. Full-row hashes
identical before/after for `marketing_memory_versions`, `founder_context`, `business_goals`,
`strategy_directions`, `approval_boundary_policies`, `product_claims`, `competitor_relationships`.

Two tables changed, both lab-only and expected: `evidence` 0 → 170 (85 v1 + 85 v2 corpus rows, append-only)
and `marketing_memories` 41 → 49 (8 lab incumbents in workspace `808ccff3…`). The runner's global check
flagged the latter because it was too coarse; owner-scoped verification confirms owner rows are untouched.

---

## 5. FOUNDER_BOOTSTRAP_GOVERNANCE_GAP

**Classification: GOVERNANCE_GAP** (not a valid special case, not an architecture defect).

Measured basis: when a real founder statement was replayed through the governed path it received
`EVIDENCE_ONLY / RAW_PROVIDER_PROSE` — free-form founder prose is not a deterministic template, so the
governed path **will not** create durable memory from it. That is precisely why `completePhase1()` writes
directly. The bypass is doing real work; it is not gratuitous.

- **A. Is a special bootstrap path justified?** Yes. Without it a new founder has no memory at all, and the
  governed path structurally cannot admit free-text founder prose.
- **B. Should bootstrap memories still carry governance?** Yes — all of it. There is no reason a bootstrap
  memory should lack `memory_class`, `authority_tier`, `authority_policy_version`, provenance and lifecycle
  state. Today all 8 carry `NULL` for each and are exempted only by the legacy discriminator, which was
  designed for *pre-existing* rows, not for a live writer to keep producing new ones.
- **C. Should `completePhase1()` keep writing directly?** Not in its current form. It should write through a
  governed **bootstrap admission** that stamps class, `FOUNDER_ASSERTED` authority, policy version and
  provenance — while keeping its exemption from the rule-generated-text requirement.
- **D. Should founder context enter the normal candidate path?** No. `RAW_PROVIDER_PROSE` would make it
  evidence-only, and demanding a founder phrase their ICP as a template is incoherent.
- **E. Migration needed later:** backfill the 8 rows with `memory_class`, `authority_tier = FOUNDER_ASSERTED`,
  `authority_policy_version`, a `scope` (they are legitimately workspace-wide), and provenance pointing at the
  originating `founder_context` / `business_goals` / `competitor_relationships` row. Additive; no rewrite of
  content. **Not performed in this pass.**

## 6. BOOTSTRAP_CONFIDENCE_FINDING

The four values are **fabricated ordinals, not measurements**:

| memory | confidence | what it actually encodes |
|---|---|---|
| founder (goal) | 0.95 | nothing measured — a hand-picked rank |
| product (context delta) | 0.90 | nothing measured |
| customer (audience) | 0.85 | nothing measured |
| competitor | 0.80 | nothing measured |

They form a descending rank of how much the author trusted each *category*, written once as literals. They do
not vary with evidence, sample size, corroboration or recency, and no code re-derives them.

Separating the two axes as instructed: **source authority is genuinely high** — an authenticated founder
stated these directly, which is `FOUNDER_ASSERTED`, the strongest tier. **Claim confidence is unmeasured** —
"our audience is X" is a founder's belief about a market, not a validated fact. Encoding that belief as 0.85
asserts an empirical precision nobody established. The authority is real; the number is decoration.

Recommendation (not implemented): bootstrap rows should carry authority explicitly and either omit confidence
or record a single declared constant meaning "founder-asserted, unmeasured" — not four different numbers that
imply a measured gradient.
