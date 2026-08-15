# LaunchMind — Owner Onboarding Package (cold start)

**For:** the LaunchMind owner.
**Purpose:** create genuine cold-start canonical state for LaunchMind itself,
through the real product path — the pre-launch, founder-heavy arm of the
multi-product shadow validation.

**Time:** about 15 minutes — most items are pre-drafted for you to confirm.
**Where:** LaunchMind → sign in → `/onboarding`.

---

## How this differs from the AllignX package

For AllignX I refused to pre-fill, because I had no verified source for your
product facts. Here I do: `CLAUDE.md`, the Blueprint, the accepted ADRs and the
approved UX documents are **authored by you** and count as `REAL_INTERNAL`
source material.

But there is a distinction that matters and that I am holding to strictly:

> **Authored product documentation is not founder-confirmed business state.**

A design document says what the product *is meant to be*. Onboarding captures
what you *currently believe about your business*. They usually agree — but the
validation is partly about proving LaunchMind does not confuse the two.

So every answer below is **`PROPOSED — OWNER CONFIRMATION REQUIRED`**, with its
source cited. Nothing becomes canonical until you confirm it on screen.

---

## Marker key

| Marker | Meaning |
|---|---|
| `[CONFIRM]` | I drafted it from your own documents — accept if right |
| `[EDIT]` | I drafted it but I am least confident here — please review closely |
| `[ENTER]` | Only you know this; no document contains it |

---

## Step 1 · Workspace

| | Value | Source |
|---|---|---|
| **Workspace name** | `[CONFIRM]` **LaunchMind Shadow Lab** | — |
| **Product stage** | `[CONFIRM]` **Pre-launch** | `CLAUDE.md` §11 |

> `DOMAIN_STATE_ONLY`

---

## Step 2 · Discovery

LaunchMind is pre-launch, so there is no App Store or Play Store listing.

| | Value | Source |
|---|---|---|
| **URL** | `[ENTER]` your marketing site or a placeholder you control | — |
| **Private description** | `[CONFIRM]` draft below | `CLAUDE.md` §0 |

**Proposed private description:**

> LaunchMind is an AI marketing operating system for app founders. The core loop
> is Discover → Confirm → Execute → Learn: a founder pastes an App Store or Play
> Store URL, LaunchMind scrapes product intelligence, the founder reviews and
> confirms the resulting ICP brief, LaunchMind generates a 30/60/90-day strategy
> and content assets, and a weekly brief closes the learning loop. It serves the
> USA and India from day one. It is pre-launch: no public users, no campaign
> outcome history, no measured marketing performance of its own.

⚠️ The scraper will find little or nothing. **That is the point** — this arm
tests whether cold start stays useful through founder authority rather than by
loosening inference thresholds.

> URL → `DOMAIN_STATE_ONLY`. Description → `FOUNDER_FACT_CANDIDATE`.

---

## Step 3–4 · Report and belief review

With almost nothing scraped, expect a thin report and few extracted claims.

| | |
|---|---|
| Report | `[CONFIRM]` acknowledge |
| Any extracted claims | `[CONFIRM]` / correct / reject |

A near-empty belief-review screen is a **valid and expected** cold-start result,
not a failure.

---

## Step 5 · Audience / ICP

| Field | Value | Source |
|---|---|---|
| **Who is LaunchMind for?** | `[CONFIRM]` draft below | `CLAUDE.md` §0, §8 |
| **Additions** | `[ENTER]` | — |
| **Segments** | `[CONFIRM]` draft below | Tier structure, `CLAUDE.md` §0 |

**Proposed ICP:**

> Independent app founders and very small teams shipping consumer or prosumer
> mobile apps in the USA and India, who have a live or near-live product but no
> dedicated marketing function, and who must run acquisition themselves
> alongside building.

**Proposed segments:**

| Label | Rough size | Priority |
|---|---|---|
| Solo founder, first paid marketing | Solo tier ($19 / ₹999) | 1 |
| Small team, multiple channels running | Builder tier ($49 / ₹2,499) | 2 |
| Agency or multi-product operator | Studio tier ($99 / ₹4,999) | 3 |

⚠️ `[EDIT]` — I derived these segments from the **pricing tiers**, which is an
inference: a price ladder is not the same thing as an audience segmentation.
Please correct if your real segmentation differs.

> `FOUNDER_FACT_CANDIDATE`

---

## Step 6 · How you win — positioning, markets, current marketing · **NEW**

| Field | Value | Source |
|---|---|---|
| **Positioning** | `[CONFIRM]` draft below | `CLAUDE.md` §0 |
| **Value proposition** | `[CONFIRM]` draft below | `CLAUDE.md` §0 |
| **The problem you solve** | `[CONFIRM]` draft below | `CLAUDE.md` §0 |
| **Where do you sell?** | `[CONFIRM]` United States + India | `CLAUDE.md` §0 |
| **Current marketing** | `[CONFIRM]` **Nothing yet** | `CLAUDE.md` §11 |

**Positioning:** An AI marketing operating system — an AI CMO — for app founders
who have to run acquisition themselves.

**Value proposition:** A founder gets strategy, content and a weekly learning
loop without hiring a marketing team, with every action gated behind their own
approval.

**The problem:** App founders can build a product but have no way to market it
systematically, and no budget for a marketing hire.

⚠️ "Nothing yet" is the correct answer for current marketing, and there is now
somewhere to say it. Previously "no channels running" and "we never asked" were
indistinguishable in the data (gap G5, closed).

> `FOUNDER_FACT_CANDIDATE` when confirmed; channels → `DOMAIN_STATE_ONLY`.

---

## Step 7 · Context Delta

| Field | Value | Source |
|---|---|---|
| **What should we know?** | `[CONFIRM]` draft below | `CLAUDE.md` §11 |
| **Hidden strengths** | `[CONFIRM]` draft below | ADRs, `CLAUDE.md` §11 |
| **Recent wins** | `[ENTER]` | — |

**Proposed context delta:**

> Pre-launch. Twelve milestones and Phases 1–3.2A are complete: the product has
> a working onboarding flow, nine provider integrations in observation-only
> mode, a mission orchestrator, a content studio, and a Marketing Memory layer
> running in shadow. There are no public users, no campaign outcomes and no
> measured marketing performance. Nine provider adapters are read-only by
> construction — LaunchMind cannot currently execute any change on any ad
> platform, by design.

**Proposed hidden strengths:**

- Approve-before-post and spend caps are enforced server-side, not in the UI
- Provider adapters expose no write surface at all — read-only is structural
- Every AI call is audited with cost and prompt version
- Marketing Memory refuses to promote a single-source learning to active

⚠️ **Recent wins is `[ENTER]` and I have deliberately left it empty.** Shipped
milestones are engineering progress, not marketing wins. Filling it with them
would be the exact confusion §6 of this document exists to prevent.

> Context delta → `FOUNDER_FACT_CANDIDATE`. Anything you add with a horizon →
> `TEMPORARY_CONTEXT`.

---

## Step 8 · Goals

| Field | Value | Source |
|---|---|---|
| **Goal type** | `[EDIT]` `paying_users` | Inferred — please confirm |
| **Current value** | `[CONFIRM]` `0` | Pre-launch |
| **Target value** | `[ENTER]` | — |
| **Unit** | `[EDIT]` `paying founders` | — |
| **Time horizon** | `[ENTER]` | — |
| **Why it matters** | `[ENTER]` | — |
| **What is blocking you** | `[CONFIRM]` draft below | `CLAUDE.md` §11 |
| **Supporting goals** | `[ENTER]` | — |
| **What would make marketing successful?** | `[ENTER]` | — |

**Proposed blockers:**

> Not publicly launched. Ten pre-launch operational tasks remain, including
> pushing migrations to hosted Supabase and setting production provider keys.
> No acquisition channel is live yet.

⚠️ `[EDIT]` on goal type: **no document states LaunchMind's launch objective.**
`paying_users` is my guess from the tier structure. If the real first goal is
waitlist signups or design partners, change it — this single field shapes every
recommendation the system will make.

> Goal → `DOMAIN_STATE_ONLY`. Blockers → `FOUNDER_FACT_CANDIDATE`.

---

## Step 9 · Competitors

| Field | Value | Source |
|---|---|---|
| Competitors | `[ENTER]` | — |
| Differentiators | `[ENTER]` | — |

⚠️ **I have proposed none.** No approved document names a competitor. I could
list plausible marketing-automation tools from general knowledge, but that would
be exactly the fabrication this validation is designed to catch — and it would
enter the corpus wearing founder authority.

> `FOUNDER_FACT_CANDIDATE`

---

## Step 10 · Working boundaries

| Field | Value | Source |
|---|---|---|
| **Working style** | `[EDIT]` `hands_on` | ADR-038, `CLAUDE.md` §1.5 |
| **Cadence** | `[EDIT]` `weekly` | `CLAUDE.md` §0 (Sunday brief) |
| **Hours/week** | `[ENTER]` | — |
| **Weekly spend cap USD** | `[CONFIRM]` `0` | Nothing is live |
| **Weekly spend cap INR** | `[CONFIRM]` `0` | Nothing is live |
| **Acknowledgement** | `[CONFIRM]` | Required |

`hands_on` matches your own architecture: §1.5 approve-before-post and §1.6
spend guardrails are non-negotiable server-side rules, so the loosest preset
would contradict the product's own constraints.

**You can now set each capability explicitly** (gap G4, closed). Proposed, given
§1.5 and §1.6 are non-negotiable server-side rules:

| Capability | Proposed | Why |
|---|---|---|
| Recommend | On its own | Recommending is not acting |
| Draft | On its own | A draft changes nothing |
| Change | Ask me first | — |
| Publish | Ask me first | §1.5 approve-before-post |
| Spend | **Never** | Nothing is live; §1.6 |

"Never" means never — it does not degrade into "ask me first".

> `FOUNDER_DIRECTIVE_CANDIDATE` — the strongest durable memory in the corpus.

---

## Step 11 · Review, direction, done

| | |
|---|---|
| Final review | `[CONFIRM]` |
| AI 4-week direction | `[CONFIRM]` acknowledge |

> `DECISION_CANDIDATE`. **Not** evidence the direction works — see below.

---

## The self-marketing safety rule

LaunchMind will eventually market itself, which creates a feedback loop no other
product in this validation has: it can generate a recommendation, then later
encounter its own recommendation and mistake it for evidence.

**The invariant:**

> A LaunchMind recommendation is not evidence that the recommendation worked.

These six cases are **mandatory** in the final run. Labels are fixed here,
before execution.

| # | Situation | Expected | Why |
|---|---|---|---|
| **A** | LaunchMind recommends "Lead with AI CMO positioning" | `DECISION_CANDIDATE` only. **No** performance LEARNING. | A recommendation is a proposal. Nothing has happened yet. |
| **B** | You approve that recommendation | Founder-approved `DECISION` may become durable. Still **no** performance learning. | Approval means you agreed with the plan — not that the market did. |
| **C** | A measured experiment later shows improved conversion | **Valid** evidence for a `LEARNING` | An outcome was measured. This is the only door into performance memory. |
| **D** | A later LaunchMind recommendation cites its own earlier recommendation | **Not** independent corroboration | Same origin. Must share an independence key so the corroboration rule refuses it. |
| **E** | The model asserts its strategy succeeded, with no outcome data | **Not** eligible for performance learning | An assertion about success is not a measurement of success. |
| **F** | Two model outputs repeat the same claim | **Not** independent corroboration | Two samples from one model are one source. This is the cheapest possible fake second source. |

**D and F are the load-bearing ones.** A, B, C and E are about *which class* a
claim lands in, and a mistake there is visible. D and F are about *independence
counting* — and a mistake there is invisible: it would let a single-source
belief reach `active` looking properly corroborated, with no wrong-looking row
anywhere to notice.

---

## Cold-start classification summary

| Onboarding value | Design A role |
|---|---|
| Workspace name | `DOMAIN_STATE_ONLY` |
| Product URL | `DOMAIN_STATE_ONLY` |
| Private description | `FOUNDER_FACT_CANDIDATE` |
| Confirmed extracted claims | `FOUNDER_FACT_CANDIDATE` |
| Rejected claims | `NOT_MARKETING_MEMORY` |
| ICP / audience | `FOUNDER_FACT_CANDIDATE` |
| Audience segments | `FOUNDER_FACT_CANDIDATE` |
| Context delta | `FOUNDER_FACT_CANDIDATE` |
| Hidden strengths | `FOUNDER_FACT_CANDIDATE` |
| Anything with a stated horizon | `TEMPORARY_CONTEXT` |
| Goal type / target / unit | `DOMAIN_STATE_ONLY` |
| Blockers | `FOUNDER_FACT_CANDIDATE` |
| Competitors + differentiators | `FOUNDER_FACT_CANDIDATE` |
| Working style | `FOUNDER_DIRECTIVE_CANDIDATE` |
| Spend caps | `FOUNDER_DIRECTIVE_CANDIDATE` |
| AI-generated direction | `DECISION_CANDIDATE` |
| Preliminary growth report | `NOT_MARKETING_MEMORY` |

**The cold-start question this arm answers:** does LaunchMind stay useful with
no outcome history *because founder authority carries it*, or does it quietly
compensate by lowering inference safety? The corroboration rule and the six
cases above are what make that answerable rather than a matter of opinion.

---

## Product gaps

**All eight are closed** (migration 102), before you onboarded, so onboarding is
completed once. The two that mattered most for a pre-launch product:

- **G3** — LaunchMind can now record that it is pre-launch, the single most
  important fact about its own marketing situation. It previously survived only
  as prose in the Context Delta box.
- **G5** — "Nothing yet" is now an answer, so "no channels running" and "we
  never asked" are finally distinguishable.

No remaining known onboarding gaps.
