# Continuous learning — production activation contract

> Phase 3.1G §13. **This document does not activate anything.** It states what
> must be true before `CONTINUOUS_LEARNING_INGESTION_MODE=active` is set in
> production, and what to watch afterwards.
>
> As of this document the system ships in `shadow`. That is the correct state.

---

## 1. What the three modes actually do

| Mode | Candidates built | Compared and decided | Marketing Memory written |
|---|---|---|---|
| `off` | no | no | no |
| `shadow` **(default)** | yes | yes | **no** |
| `active` | yes | yes | yes, subject to the policy below |

Resolution rules, enforced in `ingestionMode()` and covered by test:

- An **unset** variable resolves to `shadow`, never `active`.
- An **empty string** resolves to `shadow`. (`process.env.X ?? 'default'` yields
  `''`, not the default — a trap this codebase has hit repeatedly. Here it would
  silently enable automatic learning.)
- Any **unrecognised** value (`on`, `true`, `1`, `enabled`, a typo) resolves to
  `shadow`. Only the exact word `active`, in any case, enables writing.

There is no code path that enables learning implicitly. Activation is one
deliberate environment change.

---

## 2. Preconditions — all must hold before activation

### 2.1 Blocking

| # | Condition | How to verify | Status today |
|---|---|---|---|
| A1 | Shadow validation run against a workspace with **real connected providers**, not the seeded fixture | `npm run shadow:validate` pointed at a workspace with ≥20 real `connection_insights` | **STILL NOT MET** — hosted holds zero `connection_insights` rows. Nothing in the codebase can fix this; it needs a founder to connect a provider. |
| A2 | Classification accuracy ≥ 90% on that real run, with every mismatch reviewed by a human | Accuracy table in the generated report | **PARTIALLY MET** — 6/7 (86%) on the seeded corpus and 16/16 on the live model set. The one mismatch over-flags in the safe direction. Still unmet against REAL data (blocked by A1). |
| A3 | The false-reinforcement defect is fixed and covered by test | `comparatorSafety.test.ts` (33 tests), ADR-066 Amendment 5 | **MET** — the reinforcement boundary now requires provable alignment; 11 adversarial predicate pairs produce zero reinforcements. |
| A4 | Migrations 088–098 applied to the hosted database | `embedding_stuck_jobs` view present; `lm_claim_embedding_work` callable and refusing completed jobs | **MET (with a provenance caveat)** — verified against hosted; see §7 |
| A5 | Embedding pipeline health is `healthy`, with 0 failed and 0 stale | `getEmbeddingHealth()` | **MET** — 33/33 current, 0 stale, 0 pending, 0 failed, status `healthy`; hosted HYBRID retrieval proven on 4/4 queries |
| A6 | A rollback has been rehearsed, not just written down | §5 below, executed once in staging | **STILL NOT MET** |
| A7 | The embedding worker is started in every deployed environment | `startEmbeddingWorker()` in `server.ts`, Redis-gated | **MET in code, UNVERIFIED in deployment** — the fix is committed; nobody has confirmed a deployed backend runs with `REDIS_URL` set. Without it the outbox silently accumulates again. |

### 2.2 Required but not blocking on their own

| # | Condition | Why |
|---|---|---|
| B1 | An owner-visible surface exists for `requires_founder_review` decisions | Otherwise a decision that correctly defers to a founder is never seen by one, and defers forever |
| B2 | Alerting on `embedding_stuck_jobs.reclaimable_jobs > 0` sustained | A crashed worker is now recoverable (migration 098); nothing yet notices it happened |
| B3 | Alerting on a sustained rise in `action:reinforce` without matching evidence growth | The signature of the §4.1 defect in production |

---

## 3. Activation procedure

1. Confirm every A-row in §2.1 is met. Any single unmet row stops the process.
2. Enable for **one internal workspace first**, not globally. There is currently
   no per-workspace flag — adding one is part of activation work, not a
   follow-up.
3. Set `CONTINUOUS_LEARNING_INGESTION_MODE=active` for that scope.
4. Watch for one full weekly cycle:
   - `marketing_memories` version growth vs. `learning_events` count
   - proportion of decisions with `requires_founder_review = true`
   - confidence distribution before and after
5. Expand only after a human has read every applied decision from the first
   cycle. "Nothing broke" is not evidence that the right things happened.

---

## 4. Known defects that argue against activation today

### 4.1 ~~False reinforcement~~ — CLOSED (3.1G remediation)

**Fixed.** The deterministic reinforcement boundary now requires provable
alignment rather than the absence of a detected conflict; see ADR-066
Amendment 5. B1 now resolves to `CONTRADICTION → challenge`, the live model set
scores 16/16 with zero dangerous reinforcements, and 11 adversarial predicate
pairs produce none. The original finding is kept below for the record.

**Originally measured:** in the controlled shadow run:

```
existing  "Meta creative fatigues above frequency 3"        (inferred, conf 0.70)
incoming  "Meta creative performs better above frequency 3"
result    REINFORCEMENT → action=reinforce → founder review = NO
```

These claims contradict each other. `fatigues` is not in the deterministic
antonym table (`POLARITY_PAIRS`), so no polarity conflict is detected, the
subject overlap is high, and the pair is classified as mutually supporting.

Why this is the most serious of the two: the deterministic path **decided
confidently**, so the case never reaches the model that would likely have caught
it, and `reinforce` requires no founder review. In `active` mode this raises
confidence on a belief the new evidence actually undermines.

In `shadow` mode it is recorded and nothing happens. That is the entire argument
for the current default.

Candidate fixes, none adopted here:
- Extend `POLARITY_PAIRS` with domain antonyms (`fatigues`/`performs`,
  `degrades`/`improves`). Cheap, partial, and will always trail the language.
- Route *every* same-subject pair to the model rather than only ambiguous ones.
  More correct, materially more expensive, and makes comparison non-deterministic.
- Require agreement between the deterministic path and the model before allowing
  an unreviewed `reinforce`. Preferred: it bounds the cost to reinforcement
  decisions and keeps the deterministic path authoritative for everything else.

### 4.2 A scoped exception against an unscoped belief reads as a contradiction — OPEN, safe

```
existing  "Search converts better than Meta"                (no segment stated)
incoming  "Search converts worse than Meta for enterprise buyers"  (segment=enterprise)
result    CONTRADICTION → action=challenge → founder review = YES
```

`compareScope()` returns `same` here because only `channel` is comparable — the
existing belief states no segment, so the segment dimension is skipped rather
than treated as a difference. The ideal answer is `UNRELATED`: both statements
are true, and the second is the exception that makes the corpus valuable.

This is a **safe** failure — it stops for a founder — but it will generate review
requests for findings that were never in conflict, and reviewer fatigue is how
review gates stop working. Note that the live model run (§4 of the certification)
classified the equivalent case correctly when both sides stated their segment in
prose, so the gap is specifically the *unscoped existing belief*.

---

## 5. Rollback

Setting `CONTINUOUS_LEARNING_INGESTION_MODE=shadow` stops all further writes
immediately. It does **not** undo writes already applied.

To reverse applied changes:

1. `marketing_memory_versions` holds a snapshot before every change, and
   `lm_apply_memory_transition` writes it atomically with the transition, so
   there is a prior state to return to for every affected belief.
2. Identify affected rows by `learning_events` in the activation window whose
   `created_by_type = 'system'`.
3. Restore through `MemoryLifecycleService`, never with a direct `UPDATE`:
   the lifecycle service is the only writer, and a manual update would leave the
   version history describing a state that never existed.
4. `audit_logs` and `growth_brain_learning_events` are append-only by trigger and
   are **not** rewritten as part of a rollback. The record shows what happened
   and then shows it being reversed. That is the intended behaviour.

**Rehearse this in staging before activation (A6).** A rollback procedure that
has never been executed is a plan, not a capability.

---

## 6. What activation does not grant

Activation permits LaunchMind to change what it *believes*. It grants no
authority to act:

- No campaign is created, changed, paused or funded.
- No spend is authorised. The execution boundary is a separate ladder
  (`READ · RECOMMEND · DRAFT · CHANGE · PUBLISH · SPEND`) with its own audited
  upgrade path, and no adapter implements any execution capability.
- An automated source can never supersede a founder statement, in any mode.
  That is a property of `beliefPolicy.decide()`, which does not consult the
  ingestion mode at all.
