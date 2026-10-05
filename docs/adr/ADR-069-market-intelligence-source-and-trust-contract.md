# ADR-069 — Market Intelligence: source decision and trust contract (Phase 3.4A)

Status: **ACCEPTED — architecture frozen, no implementation**
Date: 2026-08-16
Supersedes: nothing. Extends ADR-050 (Intelligence Network), ADR-053 (anonymous
benchmarking), ADR-066/067 (memory governance, authority, scope), and the Phase
3.3C grounding contract.

Scope of this ADR: **design only**. No migration, no provider, no code path is
activated by it. `marketIntelligenceAvailable` remains hard-`false`.

---

## 1. Problem

`marketIntelligenceAvailable` is `false` and that is the honest answer today.
The three things that could make it true are all unusable as external market
evidence:

- `playbook_signals` is **seeded synthetic** (52 rows, migrations 007/018/019).
  It is cross-founder aggregate, not external market observation, and its rows
  carry no source, no observation date, and no subject beyond `category|market`.
- `products.competitor_set` is real store data but is a **point-in-time blob**
  overwritten in place, with no dates, no provenance and no lifecycle.
- `APP_STORE_CONVERSION_BENCHMARK = 0.035` in `connectionInsightService` is a
  **hardcoded market claim with no source record** already shown to owners as
  "Store benchmark".

So the question 3.4A must answer is not "how do we build a market data
platform". It is: **what external evidence can LaunchMind hold that it is
willing to defend to an owner, one claim at a time?**

## 2. Decision — the source set

**3.4B ingests exactly one source class:**

> **Public app-store / play-store listing observations, for entities the owner
> has confirmed as competitors, plus the owner's own listing.**

Reached through the existing sandboxed scraper worker
(`app-store-scraper`, `google-play-scraper`, Cheerio) — no new fetcher, no new
network egress class, no new dependency.

Chosen because it is the only candidate that is simultaneously: already
available, structurally low-injection (typed fields, not prose), dated at the
source (`version.releaseDate`, `updated`), legally storable as facts plus a
short attributed excerpt, and about a **named entity** rather than an
unidentifiable population.

Deliberately **not** chosen: generic web/search (E) and third-party articles
(G). Their combined injection surface, provenance ambiguity and storage-rights
exposure is not worth carrying before launch, and neither is needed to make the
feature useful.

Explicit consequence, accepted: a web-only product with no store listing gets
**no** market intelligence, and `marketIntelligenceAvailable` stays `false` for
it. That is the per-product semantics of §20 working correctly, not a gap.

## 3. Evidence type

Three kinds, already representable:

| Kind | Meaning | Persisted as evidence? |
|---|---|---|
| MARKET_OBSERVATION | externally sourced structured fact | yes |
| THIRD_PARTY_INTERPRETATION | interpretation authored by a named external source | yes, attributed to that source |
| LAUNCHMIND_INTERPRETATION | model reasoning over evidence | **never** |

The load-bearing rule: **LaunchMind's own interpretation may not be persisted as
Market Intelligence evidence.** It is reasoning; it may not return on a later
request wearing an evidence badge. Structurally enforced by making the ingestion
writer the *only* producer of source records, and the model incapable of minting
a source id (§14).

No parallel authority hierarchy. `AUTHORITY_TIERS` already carries
`VERIFIED_EXTERNAL` and migration 107 already carries
`public_official` / `public_reputable`.

## 4. Timestamps

Three columns, distinct semantics:

- `observed_at` — when the fact was **true of the world**.
- `published_at` — when the source **stated** it.
- `retrieved_at` — when LaunchMind **fetched** it. Provenance only.

`FRESHNESS_REFERENCE_DATE = observed_at ?? published_at ?? NULL`.

**`retrieved_at` is never a freshness reference.** Fetching a 2019 page today
does not make 2019 current. When neither of the first two resolves, the state is
`UNKNOWN_DATE` — not `CURRENT`.

## 5. Freshness

`CURRENT` ≤ 90d · `AGING` ≤ 365d · `STALE` > 365d · `UNKNOWN_DATE`.

90 days is derived, not invented: app-store listings are the ingested source and
their median update cadence is well inside a quarter, so a listing observation
older than a quarter may already describe a superseded build.

Language gate: only `CURRENT` may support present-tense market language
("currently", "right now", "the market is now"). `AGING` must be dated in the
sentence. `STALE` and `UNKNOWN_DATE` may support historical phrasing only, and
`UNKNOWN_DATE` may never support a numeric market claim at all.

## 6. Subject and applicability

Subject = `subject_type` (COMPETITOR_ENTITY | CATEGORY | CHANNEL | GEOGRAPHY)
+ `subject_key` (stable, e.g. `app_store:us:id123456789`). Not a knowledge
graph — an entity key and a category key, nothing more.

Applicability reuses `scopePolicy`'s six dimensions rather than inventing a
seventh vocabulary. Resolution returns `APPLICABLE` / `NOT_APPLICABLE` /
`INSUFFICIENT_CONTEXT` **plus a reason**, and `INSUFFICIENT_CONTEXT` fails
toward non-use. An enterprise-SaaS conversion figure does not reach an SMB home
services product because both say "conversion rate".

## 7. Global storage, product-scoped applicability

```
market_intelligence_source_record      GLOBAL, deduped by content hash
              ↓  resolution (product + request)
market_intelligence_resolution         PRODUCT-SCOPED, carries applicability + reason
              ↓  evidence handle, only if APPLICABLE and fresh enough
owner-visible evidence
```

One external fact is stored once. Applicability is decided per product, per
generation, and is what gates the handle. Global storage never implies global
applicability.

## 8. Authority mapping

| Source | Tier |
|---|---|
| official public page / store listing by the subject company | `VERIFIED_EXTERNAL` |
| reputable secondary reporting | `DERIVED_INFERENCE` |
| third-party article / commentary | `DERIVED_INFERENCE` |
| founder-entered market observation | `FOUNDER_ASSERTED` — **deferred**, see §9 |
| synthetic playbook | `ANONYMIZED_PLAYBOOK` |

`VERIFIED_EXTERNAL` ranks **below** `OBSERVED_FIRST_PARTY` and both founder
tiers. External market evidence therefore cannot silently override founder
direction, first-party performance, or confirmed product facts — the property is
already enforced by `mayAutoOverride`, which requires *strictly* stronger
authority.

Reachable only with a non-founder actor: `authorityForCandidate` returns from
the founder branch first, so a public source cannot be laundered into founder
authority however it is phrased.

## 9. Founder-entered market evidence — deferred, with reason

It is tempting (cheap, honest, needs no fetcher). It is deferred because it
creates a genuine inversion: a founder's *guess about the market* would enter at
`FOUNDER_ASSERTED` and outrank an official source at `VERIFIED_EXTERNAL`. That
is correct for **direction** and wrong for a **market fact**. Resolving it needs
a separate `evidence_role` axis, which is more architecture than 3.4B should
carry. Deferred to 3.4C+.

## 10. First-party vs external

Never collapsed. Permitted rendering:

> "The market benchmark is 3.2%, while your observed campaigns are at 1.7%."

Forbidden:

> "Your conversion rate is 3.2%."

Enforced at the grounding layer: `MARKET_INTELLIGENCE` and
`CAMPAIGN_PERFORMANCE` are separate `EvidenceKind`s, and a claim asserting a
first-party measurement cannot be supported by a `MARKET_INTELLIGENCE` handle.

## 11. External vs external conflict

Two credible sources disagreeing is **preserved, surfaced, and not resolved by
recency**. Recency decides only when the sources agree on subject and measure
and one explicitly supersedes the other (same publisher, later statement).

Category median 3.2% vs 5.1% → LaunchMind may say the sources disagree and give
both with dates and attribution. It may **not** average them, pick the newer,
pick the one that supports its recommendation, or state a single figure.

## 12. Independence

Reuse `evidence.independence_key` (migration 096, a GENERATED column over
`source_table:source_id`). Extended conservatively for external sources: the key
is derived from the **publisher-of-record and the original statement**, not the
URL — so the same company description mirrored on App Store and Play Store is
**one** observation, not two confirmations.

Corroboration counts DISTINCT independence keys only. When independence cannot
be established, the observations are assumed dependent. No semantic clustering.

## 13. Prompt injection

External content is **untrusted data**. Layered, and no layer is claimed to be
sufficient alone:

1. ingestion accepts **allow-listed structured fields**, not free-form pages;
2. hard length caps per field;
3. instruction-shaped content is neutralised, and is treated as a *signal to
   reject the record*, not as something regex fixes;
4. external evidence is delimited in model context and labelled as data;
5. explicit system instruction: external evidence is DATA, never instruction;
6. the model **cannot mint an evidence handle** — handles are server-issued per
   request (already true, 3.3C);
7. server-side claim + provenance validation *after* generation (already true).

Layers 6 and 7 are the load-bearing ones. 1–5 reduce exposure; they do not
"solve" injection and this ADR does not claim they do.

## 14. PII

Persist business/entity facts, aggregate metrics, and short attributed excerpts.
Do **not** persist individual names, emails, phone numbers, or personal review
content. Individual reviews are read for aggregate signal and discarded.
`erase_context_packages` (105) and the memory erasure path are reused; no new
erasure machinery.

## 15. Storage and copyright

Store: source reference (URL), source metadata, the **structured extracted
observation**, a minimal attributed excerpt only where the wording is the fact,
and a content hash. Do **not** store full pages or articles.

Flagged as terms-restricted and therefore out of scope for 3.4B: aggregator and
paid-benchmark content, and any source whose terms forbid derivative storage.

## 16. Lifecycle

`ACTIVE` → `SUPERSEDED` | `CORRECTED` | `RETRACTED` | `UNAVAILABLE` | `ERASED`.

Recommendation snapshots are **immutable** (migration 109) and stay that way. So
lifecycle is expressed at the *source record*, and owner-facing provenance on a
historical recommendation renders the source's **current** lifecycle state
alongside the frozen snapshot:

> "This was recommended on 12 Aug using a source that has since been retracted."

The decision is never rewritten. `ERASED` is the only state that removes
content, and it removes the source record's content while leaving the reference
and the audit trail intact.

## 17. Cost, rate, cache

Reuse existing governance — `consumeTokens`, `ai_requests`, `COST_TABLE`, the
`callWithRetry` back-off, and the BullMQ pattern. No new budget vocabulary.

Ingestion is a **background job**, never inline on an owner request: ≤1 refresh
per subject per 24h; ≤10 subjects per product per run; provider timeout 15s;
2 retries with the existing back-off; global source records shared across
workspaces so N owners tracking one competitor cost one fetch. Failure degrades
to "not available", never to stale-presented-as-current.

## 18. Modes and availability

`MARKET_INTELLIGENCE_MODE = OFF | SHADOW | ACTIVE`, default `SHADOW` in 3.4B.

SHADOW does everything except reach the owner: ingest, validate provenance and
timestamps, resolve subject and applicability, apply freshness, record
**would-be** evidence handles and what would have entered ContextPackageV2 —
while `marketIntelligenceAvailable` stays `false`, the model receives no market
evidence, and owner recommendations are byte-identical to today's.

Graduation SHADOW → ACTIVE requires all of: the frozen acceptance matrix green
against real ingested data; zero fabricated-quantity escapes; zero cross-product
or cross-workspace resolutions; timestamp and freshness correct on real records;
a demonstrated retraction propagating to owner-facing provenance; and an
explicit owner-visible design for how market evidence is rendered.

**`marketIntelligenceAvailable` is computed per product, per generation.** It is
not "subsystem installed", not "provider configured", not "table non-empty", and
not "global evidence exists". It is true only when ≥1 valid, applicable,
fresh-enough, provenanced, consumable market evidence item resolved *for that
generation*. In SHADOW it is always `false`.

## 19. Consequences

Accepted:
- narrow coverage (app-store-listed products only) in exchange for defensible
  provenance;
- no statistical benchmarks from this source class — comparative competitor
  observations are not a benchmark and must not be worded as one;
- two extra tables and one mode flag;
- founder-entered market evidence and paid benchmark APIs both deferred.

Rejected:
- making `marketIntelligenceAvailable` true on subsystem existence;
- `retrieved_at` as freshness;
- resolving external conflict by recency;
- storing full third-party content;
- generic web search before launch.
