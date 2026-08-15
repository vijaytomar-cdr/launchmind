# AllignX — Owner Onboarding Package

**For:** the LaunchMind owner. No database or ADR knowledge needed.
**Purpose:** create genuine canonical state for AllignX through the real product
path, so the multi-product shadow validation measures the architecture rather
than fixtures I wrote.

**Time:** about 20–30 minutes.
**Where:** LaunchMind → sign in → `/onboarding`.

---

## Before you start — one important note

**I have deliberately not pre-filled your product facts.**

I have no verified public AllignX sources in hand, and guessing your ICP,
positioning or goals from marketing copy would defeat the point: the validation
exists to test whether founder-owned facts get founder authority. If I invented
them, the "founder authority" arm would be measuring my invention.

Where LaunchMind can genuinely discover something, **it does that itself** —
you give it your URLs in Step 2 and it scrapes the App Store, Play Store and
your website, then asks you to confirm what it found. That is the real prefill
mechanism, and it is better than anything I could supply.

So: the only things marked `[CONFIRM]` below are things **LaunchMind will show
you on screen**. Everything else is `[ENTER]`.

---

## Marker key

| Marker | Meaning |
|---|---|
| `[ENTER]` | You type this. LaunchMind has no way to know it. |
| `[CONFIRM]` | LaunchMind shows you its own finding — you accept, correct, or reject it. |
| `[EDIT]` | A default is pre-selected; change it only if it is wrong. |

---

## Step 1 · Workspace

| | |
|---|---|
| **Workspace name** | `[ENTER]` Suggest: **AllignX Shadow Lab** |
| **Product stage** | `[EDIT]` Live product / Pre-launch / Private beta / Idea stage |
| **How established is your marketing?** | `[EDIT]` Early · Growing · Mature — *only shown if you chose Live product* |

*Please use that exact name.* The validation identifies the workspace by it, and
the "Shadow Lab" suffix keeps it visibly separate from any real AllignX
workspace you may later create.

> Design A role: workspace name → `DOMAIN_STATE_ONLY`. Product stage and
> marketing maturity → `FOUNDER_FACT_CANDIDATE`. **New:** these were previously
> asked and then discarded; they are now stored (gap G3, closed).

---

## Step 2 · Discovery — give LaunchMind your URLs

| | |
|---|---|
| **Product URLs** (1–3) | `[ENTER]` App Store link, Play Store link, and/or website |
| **Private description** (optional, up to 2000 chars) | `[ENTER]` Anything about AllignX that is not on the public web |

The private description box is the single most valuable field in the whole flow
for this validation. Public pages tell LaunchMind what AllignX *says*; this box
is where it learns what you *know*. Worth spending five minutes on.

> Design A role: URLs → `DOMAIN_STATE_ONLY`. Private description → `FOUNDER_FACT_CANDIDATE`.

---

## Step 3 · Growth report

LaunchMind scrapes your URLs and shows a preliminary report.

| | |
|---|---|
| Report | `[CONFIRM]` Read it, then acknowledge |

> Design A role: `NOT_MARKETING_MEMORY` — an AI-generated summary is not evidence.

---

## Step 4 · Belief review — the important screen

LaunchMind shows what it believes about AllignX, each item tagged **FACT** or
**ASSUMPTION**. For each one you choose:

- **Confirm** — accurate
- **Correct** — accurate-ish; you supply the right version
- **Reject** — wrong

| | |
|---|---|
| Each extracted claim | `[CONFIRM]` / correct / reject |

**Please correct rather than reject where you can.** A correction carries your
authority and becomes a strong founder-backed candidate; a rejection just
deletes the claim and teaches the system nothing.

This screen is also where your **product description, category and positioning
language** effectively get confirmed — see the product-gap note at the end.

> Design A role: confirmed → `FOUNDER_FACT_CANDIDATE`; corrected → `FOUNDER_FACT_CANDIDATE`
> with your wording; rejected → `NOT_MARKETING_MEMORY`.

---

## Step 5 · Audience / ICP

| Field | Marker | Notes |
|---|---|---|
| **Who is AllignX for?** (10–1000 chars) | `[ENTER]` | LaunchMind proposes one from the scrape; replace it with yours if it is off |
| **What did it miss?** (optional) | `[ENTER]` | Corrections and additions |
| **Audience segments** (optional) | `[ENTER]` | Each: label, rough size, priority 1–3 |

Concrete beats broad. "Homeowners aged 30–55 in metro India booking recurring
home services" is usable; "everyone who needs services" is not.

> Design A role: `FOUNDER_FACT_CANDIDATE` — this is the anchor fact most other
> memory gets scoped against.

---

## Step 6 · How you win — positioning, markets, current marketing · **NEW**

One screen, four answers. Anything LaunchMind scraped appears pre-filled and
marked **✦ suggestion** — it becomes yours only when you confirm or edit it.

| Field | Marker | Notes |
|---|---|---|
| **Positioning** | `[CONFIRM]` | How you want customers to think about AllignX |
| **Value proposition** | `[CONFIRM]` | The main value customers get from choosing you |
| **The problem you solve** | `[ENTER]` | What customers are *hiring* AllignX to do — different from who they are |
| **Where do you sell?** | `[ENTER]` | Add each market: country, region/state, or city/metro |
| **What marketing are you already doing?** | `[ENTER]` | Tap once for “using”, twice for “planning”, or “Nothing yet” |

⚠️ **Markets are required and no longer default to the USA.** Previously an
unanswered flow silently claimed the United States, which mis-scoped every
geography-sensitive conclusion. Add "India" or "Phoenix metro" — they stay
distinguishable rather than collapsing into one geography.

The channel list is **business context only**. Saying "we use Google Ads" tells
LaunchMind what you are doing; it does **not** connect anything or give it
access to your account.

> Design A role: positioning, value proposition, problem, markets →
> `FOUNDER_FACT_CANDIDATE` (only when confirmed). Channels → `DOMAIN_STATE_ONLY`.

---

## Step 7 · Context Delta — what you know that the data cannot show

| Field | Marker |
|---|---|
| **What is changing / what should we know?** (10–2000 chars) | `[ENTER]` |
| **Hidden strengths** (up to 10) | `[ENTER]` |
| **Recent wins** (up to 10) | `[ENTER]` |

Examples of genuinely useful entries: a pricing change last month, a channel
you already tried that failed, a supply constraint in a particular city, a
partnership about to land.

> Design A role: `FOUNDER_FACT_CANDIDATE`, some `TEMPORARY_CONTEXT` — anything
> with a horizon ("for the next 6 weeks") is deliberately *not* durable memory.

---

## Step 8 · Goals

| Field | Marker | Notes |
|---|---|---|
| **Goal type** | `[EDIT]` | installs · dau · mau · revenue · paying_users · retention_d7 · retention_d30 · custom |
| **Current value** | `[ENTER]` | Today's number. 0 is fine. |
| **Target value** | `[ENTER]` | Enter **0** to let LaunchMind propose a benchmark |
| **Unit** | `[ENTER]` | e.g. "installs/week", "paying users" |
| **Time horizon** | `[EDIT]` | 7–365 days, default 30 |
| **Why this goal matters** | `[ENTER]` | Free text |
| **What is blocking you now** | `[ENTER]` | Free text |
| **Anything else you are working towards?** | `[ENTER]` | Up to 4 supporting goals |
| **What would make marketing successful?** | `[ENTER]` | Optional, your own words |

**You can now set supporting goals** alongside the main one (gap G8, closed).
Your primary goal still outranks them. Leaving the target blank is valid — "I
don't know yet" is recorded as exactly that rather than turned into a number.

> Design A role: the goal → `DOMAIN_STATE_ONLY` (it is a target, not a belief).
> "What is blocking you" → `FOUNDER_FACT_CANDIDATE`.

---

## Step 9 · Competitors

LaunchMind proposes competitors from the scrape.

| Field | Marker |
|---|---|
| Each proposed competitor | `[CONFIRM]` keep / reject |
| **Add ones it missed** | `[ENTER]` name + URL |
| **How AllignX is different** (per competitor) | `[ENTER]` |

The differentiator field is what makes competitor rows useful to the memory
engine — a bare name is close to noise.

> Design A role: `FOUNDER_FACT_CANDIDATE`.

---

## Step 10 · Working boundaries

| Field | Marker | Notes |
|---|---|---|
| **Working style** | `[EDIT]` | hands_on · balanced · hands_off |
| **How often to hear from us** | `[EDIT]` | daily · weekly · only_critical |
| **Hours/week you can give marketing** | `[ENTER]` | 1–40 |
| **Weekly spend cap (USD)** | `[ENTER]` | 0 = no paid spend |
| **Weekly spend cap (INR)** | `[ENTER]` | 0 = no paid spend |
| **Acknowledgement checkbox** | `[CONFIRM]` | Required |

| **What LaunchMind may do** | `[EDIT]` | A row per capability: Recommend · Draft · Change · Publish · Spend |

**You can now see and set your permissions directly** (gap G4, closed). Your
working style picks sensible defaults; you can change any row to **On its own**,
**Ask me first**, or **Never**.

“Never” means never — it does not quietly become “ask me first”. Note that
LaunchMind cannot publish or spend anything today regardless: no provider
adapter implements a write capability, so these boundaries take effect as those
abilities arrive.

> Design A role: `FOUNDER_DIRECTIVE_CANDIDATE` — spend caps and approval
> boundaries are the strongest form of durable founder instruction.

---

## Step 11 · Review, direction, done

| | |
|---|---|
| **What LaunchMind understands** — now covers your product, customer, their problem, positioning, markets, current marketing, goals, next move and boundaries. Every row is correctable before you finish. | `[CONFIRM]` |
| AI-generated 4-week direction | `[CONFIRM]` acknowledge |

> Design A role: the direction is `DECISION_CANDIDATE` — a plan LaunchMind
> proposed and you acknowledged. It is **not** evidence that the plan works.
> Nothing has been measured yet.

---

## When you are done

Tell me, and I will verify — without touching anything — that:

1. the workspace and product rows exist and belong to you;
2. `founder_context`, `business_goals`, `competitor_relationships`,
   `approval_boundary_policies` and `strategy_directions` are populated;
3. every row is attributed to your founder id;
4. **no row was created by SQL** — all of it came through the product path.

Only then do I build the AllignX evidence corpus.

---

## Product gaps — all eight closed

The eight gaps found while preparing this package were closed in migration 102
before you onboarded, so you only complete onboarding once.

| # | Gap | Status |
|---|---|---|
| G1 | Positioning / value proposition | **Closed** — Step 6 |
| G2 | Primary customer problem | **Closed** — Step 6 |
| G3 | Product & marketing maturity | **Closed** — Step 1 (was asked, then discarded) |
| G4 | Per-action approval boundaries | **Closed** — Step 10, visible and editable |
| G5 | Existing acquisition channels | **Closed** — Step 6 |
| G6 | Definition of marketing success | **Closed** — Step 8 |
| G7 | Market / geography | **Closed** — Step 6; the USA default was removed |
| G8 | More than one goal | **Closed** — Step 8, primary + up to 4 supporting |

No remaining known onboarding gaps.
