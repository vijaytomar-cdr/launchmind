# Multi-Product Validation — What You Need To Do

Two onboardings, about 55 minutes total. Read this instead of the ADRs.

**Do them in this order: LaunchMind first, then AllignX.** LaunchMind is mostly
confirming drafts I prepared, so it warms you up on the flow; AllignX needs real
thinking and benefits from you already knowing the screens.

I will never ask for your password, and I cannot and will not sign in as you.

---

## 1 · LaunchMind Shadow Lab — ~18 min

Sign in → `/onboarding` → workspace name **LaunchMind Shadow Lab**.

Full detail: [launchmind-owner-onboarding.md](./launchmind-owner-onboarding.md)

| | Count |
|---|---|
| `[CONFIRM]` — drafted from your own documents | **18** |
| `[EDIT]` — drafted but review closely | **6** |
| `[ENTER]` — only you know | **9** |

**The three decisions that actually matter:**

1. **What is LaunchMind's first goal?** I guessed `paying_users` from the
   pricing tiers. No document states it. If the real first goal is waitlist
   signups or design partners, this changes every recommendation the system
   makes.
2. **Are the audience segments right?** I derived them from your price ladder,
   which is an inference — a pricing tier is not an audience segment.
3. **Who are the competitors?** I proposed none, deliberately. No approved
   document names one, and inventing them would put fabricated facts into the
   corpus wearing founder authority.

I also left **Recent wins empty on purpose**. Shipped milestones are engineering
progress, not marketing wins, and conflating them is precisely the failure this
arm exists to detect.

---

## 2 · AllignX Shadow Lab — ~25–35 min

Sign in → `/onboarding` → workspace name **AllignX Shadow Lab**.

Full detail: [allignx-owner-onboarding.md](./allignx-owner-onboarding.md)

| | Count |
|---|---|
| `[CONFIRM]` — LaunchMind shows you its own finding | **5 screens** |
| `[EDIT]` — change only if wrong | **7** |
| `[ENTER]` — you type | **19** |

**I pre-filled nothing here, on purpose.** I have no verified public AllignX
sources, and guessing your ICP or positioning from marketing copy would mean the
"founder authority" arm was measuring my guesses. LaunchMind does its own
prefill anyway: you give it URLs, it scrapes, you confirm what it found.

**The two screens worth real time:**

1. **Private description** (Step 2, up to 2000 chars) — the single highest-value
   field in the flow. Public pages tell LaunchMind what AllignX *says*; this is
   where it learns what you *know*.
2. **Belief review** (Step 4) — **correct rather than reject** wherever you can.
   A correction carries your authority and becomes strong founder-backed
   memory; a rejection just deletes the claim and teaches nothing.

---

## 3 · Tell me when each is done

I will then verify — reading only, changing nothing — that the canonical rows
exist, are attributed to you, and were created through the product path rather
than by SQL. Only then do I build the evidence corpora and run the validation.

---

## Product gaps — all eight closed before you start

The eight gaps I found while preparing these packages were closed in migration
102, so you complete onboarding **once**:

| # | Gap | Now |
|---|---|---|
| G1 | Positioning / value proposition | New "How you win" step |
| G2 | Primary customer problem | New "How you win" step |
| G3 | Product & marketing maturity | Step 1 — it was already asked, and then discarded |
| G4 | Per-action approval boundaries | Visible and editable per capability |
| G5 | Existing marketing channels | New "How you win" step; "Nothing yet" is a valid answer |
| G6 | Success definition | Goals step |
| G7 | Market / geography | Required; the silent USA default is gone |
| G8 | One goal only | Primary + up to 4 supporting |

Two are worth knowing about as you go:

- **Markets are now required and no longer default to the USA.** A wrong default
  is worse than a missing value — it silently mis-scopes every geography-
  sensitive conclusion instead of leaving an obvious hole. This one probably
  matters for AllignX.
- **Your permissions are now shown to you.** They used to be derived from the
  working-style dropdown and never displayed. "Never" means never, and does not
  quietly become "ask me first".

There is also a new **"What LaunchMind understands"** review before you finish,
covering your product, customer, their problem, positioning, markets, current
marketing, goals, next move and boundaries — every row correctable.

I have not worked around any gap with direct database writes.
