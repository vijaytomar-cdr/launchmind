# Canva Public Evidence Corpus — Source Manifest

Frozen: 2026-08-13 · Retrieved: 2026-08-13 · Fixture: `backend/tests/fixtures/multiProduct/canvaCorpus.ts`

**CANVA_CORPUS_HASH (v2, authoritative)** `1abd376ffe7911b628bcbeb35987b8169a4268843afb89fcfd4029a7812735da`
**v1 (superseded, invalid)** `e54889fd212c420ff8dcca2eac91efac5cb6740ab9e82d8582407d10e3cbbaca`

The hash covers inputs **and** expected labels together, so a label cannot be relaxed after seeing results without changing it.

## Why there are two hashes

v1 encoded scope as `market` / `segment`. Those are **not** scope dimensions — `scopePolicy.SCOPE_DIMENSIONS` is
`product | channel | audience_segment | geography | funnel_stage | timeframe`. Every event therefore had
`scopeSpecificity = 0` and Gate A correctly refused all 85 as `SCOPE_MISSING`.

That was a **corpus encoding defect, not an engine defect**. Both hashes are published rather than the first
being quietly overwritten. No expected label was weakened between v1 and v2; only the scope vocabulary changed.

## Counts

| | |
|---|---|
| TARGET_COUNT | 75–100 |
| ACTUAL_COUNT | **85** |
| Independent sources | 18 |
| Paired relation cases | 8 |
| Deliberate Gate-A rejection probes | 4 |

**WHY_COUNT_IS_SUFFICIENT** — 85 spans all six eras (ORIGIN 7 · CONSUMER_GROWTH 11 · TEAM_EXPANSION 11 ·
AI_ERA 11 · ENTERPRISE 11 · MATURE 34) and all 20 required validation categories, with 18 independent
`independence_key`s so corroboration is genuinely testable. Additional events would have come from repeating
the same five or six sources with lower-value facts, which inflates the count without adding a distinct
retrieval or comparison case. Quality was preferred over the 100 mark, as instructed.

## Source access

| Access mode | Events |
|---|---|
| DIRECT_FETCH | 40 |
| SEARCH_EXTRACTED_PRIMARY | 24 |
| SEARCH_EXTRACTED_SECONDARY | 21 |

`canva.com/newsroom` returns **HTTP 403** to our fetcher and BusinessWire timed out at 60s. Official Canva
pages were therefore reached via search extraction and are labelled `SEARCH_EXTRACTED_PRIMARY` — never
presented as directly fetched. `en.wikipedia.org/wiki/Canva` **was** directly fetched.

## Source authority classes

| Class | Events |
|---|---|
| REPUTABLE_SECONDARY | 51 |
| OFFICIAL_CANVA | 18 |
| MARKET_COMMENTARY | 10 |
| OFFICIAL_DISTRIBUTION | 6 |

The secondary share is higher than the source hierarchy prefers, and this is a direct consequence of the 403:
Wikipedia (directly fetchable, densely dated) carries the chronological backbone. Where an official Canva
statement and a commentary source disagree, the official statement is the one recorded.

## Sources cited

- https://en.wikipedia.org/wiki/Canva — Wikipedia (DIRECT_FETCH)
- https://en.wikipedia.org/wiki/Serif_Europe — Wikipedia
- https://www.canva.com/newsroom/news/canva-2025-wrap/ — Canva Newsroom
- https://www.canva.com/newsroom/news/one-year-canva-enterprise/ — Canva Newsroom
- https://www.canva.com/newsroom/news/100-million-education-milestone/ — Canva Newsroom
- https://www.canva.com/newsroom/news/25-million-teachers-students-canva/ — Canva Newsroom
- https://www.canva.com/newsroom/news/canva-for-nonprofits-seat-increase/ — Canva Newsroom
- https://www.canva.com/newsroom/news/time-best-inventions/ — Canva Newsroom (citing TIME)
- https://www.canva.com/newsroom/news/canva-ai-launches/ — Canva Newsroom
- https://www.canva.com/nonprofits/ — Canva product page
- https://www.canva.com/help/about-canva-for-education/ — Canva Help Center
- https://www.businesswire.com/news/home/20250410082173/en/... — Canva press release
- https://www.cnbc.com/2025/06/10/canva-cnbc-disruptor-50.html — CNBC
- https://musically.com/2026/02/19/canva-now-has-265m-monthly-active-users-and-31m-are-paying/ — Music Ally
- https://www.macrumors.com/2025/10/31/canva-relaunches-affinity-free-app/ — MacRumors
- https://userjot.com/blog/canva-pricing-2025-free-pro-teams-costs — UserJot
- https://www.kittl.com/blogs/canva-price-increase/ — Kittl
- https://fast.io/resources/canva-ai-review-2026/ — Fastio
- https://www.founded.com/canva-founder-melanie-perkins-origin-story/ — Founded.com

## Excluded by rule

No CAC, conversion rate, retention, cohort economics, attribution, channel budget, roadmap or executive
intent appears in this corpus. One event (`cv-203`) states fabricated private metrics **deliberately**, as a
Gate-A probe; it is expected to be rejected.

## Authority ceiling — measured

`authorityForCandidate()` has **no branch returning `VERIFIED_EXTERNAL`**; the tier is marked
"RESERVED — no producer exists today". Public-source provenance falls to `default:` → **`DERIVED_INFERENCE`**.
Every event records that as its ceiling. This is safe: public reporting can never outrank a founder statement
or a first-party measurement.
