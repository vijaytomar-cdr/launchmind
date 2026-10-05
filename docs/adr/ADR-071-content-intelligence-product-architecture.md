# ADR-071 — Content Intelligence: the AI CMO content engine (Phase 3.5 product freeze)

Status: **ACCEPTED — product architecture frozen, no implementation**
Date: 2026-08-18
Extends ADR-070 (content contract), ADR-069 (Market Intelligence), ADR-066/067
(memory governance and authority), ADR-043/046 (campaign execution, approval).
Supersedes nothing. **Corrects the scope drift** in ADR-070's implementation.

Scope: **contract only.** No migration, no service, no route, no generation
change. The frozen claim system (`THREE_SIGNAL_CONTRACT_HASH_V2 =
1856b72c0ba0ca7a`) is untouched.

---

## 0. What already exists, and why this is a correction rather than a restart

Phase 3.5B built a governed *content generator*: brief → model → three-signal
claim discovery → grounding → channel validation → owner-safe projection. Every
safety property in that pipeline holds and is carried forward unchanged.

What it did **not** build is the reason a founder would open LaunchMind. The
governed path answers *"is this copy safe to show?"*. It never answers *"what
should we say this week, and why that?"* — and a system that only answers the
first question is a very careful copywriter.

This ADR reframes Phase 3.5 around the second question. The generator becomes
the **last** step of a chain that starts in intelligence, not the product.

**Foundation preserved verbatim** (ADR-070 §7 boundaries all still apply):
ContextPackageV2 · server-issued evidence handles · Growth Brain grounding ·
Market Intelligence applicability/lifecycle/freshness · Marketing Memory
governance · founder authority hierarchy · content strategies and briefs ·
immutable `content_versions` · append-only `asset_approvals` · workspace/product
isolation · three-signal claim discovery (generator ∪ deterministic ∪ semantic,
no majority vote) · generator claim declarations · detection ≠ truth · claim
grounding with substantiation · external MI cannot support a first-party claim ·
a founder goal cannot prove a measured result · channel validators · external
prose guard · PII controls · prompt-injection fencing · **content approval ≠
execution approval** · zero execution in 3.5 · AI request audit and cost ·
fail-closed degradation · V2/V3 contract freezes.

---

## 1. Product contract — what Phase 3.5 is

Phase 3.5 answers exactly one question: **WHAT SHOULD WE SAY AND CREATE?**

```
UNDERSTAND → IDENTIFY OPPORTUNITY → DEVELOP NARRATIVE → CREATE STRATEGY
→ CREATE BRIEFS → CREATE CONTENT → GROUND/GOVERN → CREATE VARIANTS
→ PREPARE FOR OWNER REVIEW → HAND OFF TO EXECUTION
```

Boundaries, stated as what each phase is *allowed to decide*:

| Layer | Decides | Never decides |
|---|---|---|
| **Content Intelligence (3.5)** | what to say, to whom, on which channel, with what proof | targeting, budget, schedule, whether it runs |
| **Campaign Intelligence (3.6)** | audience, placement, budget, schedule | whether the copy is factually supportable |
| **Execution (3.6)** | provider calls, spend, publishing | content truth or founder direction |
| **Performance Learning (3.7)** | what the result means, what may become memory | that a result rewrites founder direction |
| **Guarded Autonomy (3.9)** | safe reversible actions inside owner-set boundaries | anything outside a granted boundary |

The single load-bearing line: **content approval never implies execution
authority**, enforced structurally by migration 114 (`content_approved_at` is a
separate column and the publishing trigger blocks governed artifacts outright).

## 2. The AI CMO flywheel, and the lineage that makes it traceable

```
MARKET → MARKET INTELLIGENCE → GROWTH BRAIN → CONTENT OPPORTUNITY
      → CONTENT CAMPAIGN → CONTENT STRATEGY → CONTENT BRIEF
      → CONTENT ARTIFACT → VERSION → (3.6) DISTRIBUTION
      → PERFORMANCE → (3.7) LEARNING → MARKETING MEMORY → GROWTH BRAIN ↺
```

Lineage is **by reference, downward-pointing, and immutable at each hop**:

```
content_opportunity.recommendation_id  → growth_brain_recommendations.id
content_campaign.opportunity_id        → content_opportunity.id
content_strategies.campaign_id         → content_campaign.id
content_briefs.strategy_id             → content_strategies.id   (exists)
content_assets.brief_ref_id            → content_briefs.id       (exists, 114)
content_versions.asset_id              → content_assets.id       (exists, 047)
```

**Identity must not depend on mutable evidence.** This is the two-timeline rule
proved in 3.4C: the version snapshot records the evidence a draft used; the
evidence's *current* lifecycle is resolved at read time and rendered as an
owner-safe notice. A retraction changes what the owner is told, never what the
artifact is. Applying the same rule here means a campaign keeps its identity when
the opportunity that spawned it goes stale.

Seven questions the lineage must eventually answer, and where each is answered:
*Why was this created?* (opportunity → recommendation) · *What intelligence
influenced it?* (`context_package_id` on the generating AI request) · *What
campaign?* (campaign_id) · *Which version was approved?* (`content_approved_version`) ·
*Where did it run?* (3.6) · *How did it perform?* (3.7) · *What was learned?*
(3.7 → Marketing Memory, under governance).

## 3. Two creation modes, one pipeline

**MODE A — AI_CMO_RECOMMENDED.** Intelligence proposes: Growth Brain finds a
positioning gap → recommends a narrative → recommends channels → owner creates.

**MODE B — OWNER_DIRECTED.** *"Create an Instagram post about our analytics
feature."*

Both enter the **same** pipeline. Mode is recorded as provenance on the
opportunity/campaign, and is **never** a governance branch. Owner-directed
content does not bypass product context, brand context, founder constraints,
claim detection, grounding, PII, IP, channel validation, provenance or
versioning.

An owner-directed request without a Growth Brain origin is represented as an
opportunity with `origin = 'OWNER_DIRECTED'` and no `recommendation_id` — not as
a null-lineage artifact. Null lineage is how a bypass starts.

## 4. PRODUCT_CONTENT_CONTEXT — composition, not a new store

`PRODUCT_CONTENT_CONTEXT` is **ContextPackageV2 under the existing
`CONTENT_GENERATION` intent, plus one new arm (brand)**. It is assembled at read
time from existing sources; it is not a table.

| Group | Resolved from | Status |
|---|---|---|
| APPLICATION — name, category, store listings, screenshots, description, capabilities, pricing, geography | `products`, `products.scraped_meta`, `products.website_meta`, `products.confirmed_icp` | EXISTS, scattered |
| BRAND — logo, icon, colors, type, tagline, approved/prohibited terms, voice, tone, visual style | **Brand Kit (§6)** — today scattered across `products.brand_voice_profile`, `products.website_meta.logoUrl`, `content_preferences.visual.logoUrl` | **NEW_REQUIRED** |
| FOUNDER DIRECTION — objective, positioning, confirmed/rejected messages, constraints | `founder_context`, `business_goals`, `approval_boundary_policies` | EXISTS |
| INTELLIGENCE — Growth Brain, Market Intelligence, competitors, trends, active recommendations | `growth_brain_recommendations`, `market_intelligence_*`, `competitor_relationships` | EXISTS |
| EVIDENCE — verified capability, performance, social proof, pricing, counts | `issueEvidenceHandles(ContextPackageV2)` | EXISTS |
| MARKETING MEMORY — prior content, winners, losers, owner edits, experiments | `marketing_memories`, `content_learnings` | EXISTS |

**No duplication.** The one genuine gap is brand, which today has **four**
sources of truth and **no provenance on any of them**.

## 5. Isolation — the load-bearing constraint

Content for Product A must never carry Product B's context, brand assets,
evidence, Market Intelligence, Marketing Memory, or product-specific founder
constraints. Workspace A must never influence Workspace B.

Enforcement at **six** layers, matching the pattern migrations 080 and 114
established:

1. **DB identity** — every new table carries `workspace_id` + `product_id` with
   the composite FK `(product_id, workspace_id) REFERENCES products(id, workspace_id)`,
   which makes a mismatched pair *unrepresentable* rather than merely invalid.
2. **RLS** — read via `lm_is_workspace_member`; write via
   `lm_can_write_workspace`.
3. **Context assembly** — ContextPackageV2 is already workspace+product scoped;
   the brand arm inherits that scope rather than resolving its own.
4. **Evidence resolution** — handles are issued per request from one package, so
   a cross-business reference cannot resolve even if a model guesses one.
5. **Generation** — the prompt receives brand and proof **labels**, never a
   store handle or an id that could be swapped.
6. **Read APIs and 3.6 handoff** — workspace resolved server-side from the JWT
   actor; a client-supplied workspace is context, never authorization.

A workspace-global founder constraint is permitted **only** when explicitly
marked workspace-scoped; the default is product-scoped, because the failure that
matters is a constraint from one product silently shaping another's copy.

## 6. Brand Kit — inference is not confirmation

**NEW_REQUIRED.** `brand_kits` (one per product) + `brand_kit_fields`, with
**per-field provenance**:

```
SCRAPED          observed from a website/store listing
INFERRED         derived by LaunchMind (e.g. palette from a logo)
OWNER_CONFIRMED  the owner asserted or corrected it
```

Rules, all deliberate:

- A SCRAPED or INFERRED field **never** becomes founder authority. It may inform
  a draft; it may not substantiate a claim. This mirrors ADR-069's rule that
  external observation cannot become first-party truth.
- Confirmation is **per field**, not per kit. Confirming the logo does not
  confirm the tagline.
- Prohibited terminology is **enforced deterministically** (a validator), not
  requested in a prompt. Telling a model not to say something is not the same as
  it not being said — the same reasoning that made channel limits validators in
  ADR-070 §8A.
- Owner correction supersedes and is versioned; the prior value is retained for
  audit, not deleted.

## 7. Content Opportunity — why content should exist

**EXTEND_EXISTING: `saved_opportunities`.** That table is already the unified
opportunity/recommendation backlog (migration 046, extended by 059 with
`recommendation_type`, `score`, `priority`, `source_signals`, `expires_at`).
Creating a second opportunity table would be exactly the parallel system this
programme has avoided since 3.2.

A Content Opportunity states: **what** opportunity exists · **why now** · **who**
it matters to · **what message** could exploit it · **what evidence** supports it
· **which channels/formats** fit.

Recognised kinds: competitor positioning gap · new capability · market trend ·
poor conversion · a historically winning message · seasonal · feature launch ·
new audience · organic trend · content fatigue · competitive response.

**A Content Opportunity is not content.** It carries no copy and cannot be
approved or executed. It explains why a campaign should exist, and it is the
object the owner actually reads on the Today screen.

## 8. Viral / organic growth — an opportunity class, not a promise

`VIRAL_GROWTH_OPPORTUNITY` is a *kind* of Content Opportunity. LaunchMind
reasons about **what conversation this product could legitimately own** and what
content could raise the probability of organic reach.

**LaunchMind never promises virality**, and the phrase "make your app go viral"
is prohibited owner-facing copy.

Signals permitted as input: emerging trend · high-engagement topic · competitor
narrative · founder insight · genuine industry tension · differentiation ·
timely event · feature novelty · customer pain · observed social conversation ·
historical engagement · format trend.

**Governed against, structurally:** fabricated trends and fake controversy (a
trend claim needs Market Intelligence evidence or it is not asserted) · fake
customer stories and endorsements (`SOCIAL_PROOF`/`ENDORSEMENT` already require
evidence or owner confirmation) · manufactured scarcity (`SCARCITY_URGENCY` is
already `PROHIBITED_IN_3_5`) · unsupported claims (three-signal + grounding) ·
spam and engagement bait (brand-trust validator; a named quality dimension in
§23, not a claim question).

## 9. Content Campaign — a narrative, not an ad buy

**NEW_REQUIRED: `content_campaigns`.**

**Naming is a safety decision.** `campaigns` already exists and is *executable*:
it carries `spend_cap`, `approved_at`, `launched_at` and the §1.5/§1.6 gates. A
"campaign" that means both a narrative and a spend authorisation is the
single-column-two-meanings defect that migration 114 had to unwind for
`approved_at`. The table is `content_campaigns`, the two are never joined, and
`content_campaigns` has no spend, schedule or approval column at all — execution
authority is unrepresentable on it.

One strategic narrative, many channel adaptations:

```
CONTENT CAMPAIGN "Your AI CMO"
objective  position LaunchMind as an AI CMO, not another dashboard
narrative  stop managing marketing tools; give your business an AI CMO
assets     Google RSA · Meta ad · LinkedIn founder post · IG carousel ·
           X thread · short video · landing page · email · comparison page
```

## 10. Content Strategy v2

`content_strategies` (114) already holds objective · audience · angle ·
message_hierarchy · **proof_available** · **proof_unavailable** · cta_intent ·
constraints. `proof_unavailable` stays load-bearing: a strategy that cannot name
what it cannot prove will invent it downstream.

**EXTEND** with: `campaign_id` · funnel stage · awareness level · positioning ·
differentiation · emotional driver · rational proof · anticipated objections ·
channel role · campaign hypothesis.

**A strategy may not invent proof.** Every `proof_available` entry must resolve
to an eligible evidence handle at strategy time, and the resolution is
re-checked at generation time — evidence can be retracted between the two.

## 11. Content Brief v2

`content_briefs` (114) exists. **EXTEND** with `campaign_id`, brand context
reference, visual direction, required assets, and channel role.

Owner confirmation remains required for unresolved **offer · pricing · CTA
destination · certifications · guarantees** and every other
`REQUIRES_OWNER_CONFIRMATION` class. Owner-entered brief fields remain
user-controlled prompt input: data, never instruction.

## 12. Content families, by business purpose

| Family | Formats | Status |
|---|---|---|
| ACQUISITION | Google RSA, Meta ad | **SUPPORTED_NOW** · LinkedIn ads NEXT |
| ORGANIC/GROWTH | LinkedIn post **NEXT** · X post/thread, IG post, carousel, short-form video concept FUTURE |
| CONVERSION | landing page **SUPPORTED_NOW** · hero/CTA/pricing/comparison NEXT |
| LIFECYCLE | welcome, nurture, re-engagement, update, feature announcement | FUTURE |
| PRODUCT MARKETING | App Store / Play Store copy, launch, positioning, comparison | NEXT |
| VISUAL CREATIVE | ad image, social graphic, carousel, screenshot treatment, feature card | FUTURE |
| VIDEO | short-form **script/brief NEXT**; storyboard, demo, explainer, launch, avatar/VO FUTURE |

Nothing is deleted from the architecture by being FUTURE.

## 13. Recommended first implementation set

**Google RSA · Meta ad · Landing page** (retained) **+ LinkedIn post + short-form
video script/brief.**

Reasoning: the first four are text under deterministic channel validators, so the
governed pipeline already covers them end to end. LinkedIn is the highest-value
addition for this audience and needs no new machinery. A video **script** is text
— it exercises narrative adaptation and claim governance at the point where
claims are most often smuggled in ("in just 30 days…") — while a rendered video
requires a provider, asset rights and a review surface that do not exist. **Text
and scripts before rendering integrations**: the risk in a wrong sentence is
recoverable, the risk in a wrongly-licensed rendered asset is not.

## 14. Multi-channel adaptation — one narrative, many surfaces

Channels are **adaptations of a campaign narrative**, never independent
generations. A channel may change length, hook, structure, CTA, tone intensity
and format. It may **not** change strategic intent, product truth, founder
boundaries, evidence boundaries or campaign identity.

Enforcement: every channel artifact carries `campaign_id` + `strategy_id`, and
each is claim-detected and grounded **independently** — adaptation is where a
claim gets introduced ("in 30 days" appearing only in the short-form hook), so
inheriting a parent's grounding verdict is forbidden.

## 15. Visual content architecture

```
LaunchMind Intelligence → Creative Brief → Creative Provider
→ Candidate Visual → Validation → Owner Review
```

LaunchMind owns strategy, message, brand context, brief, governance and lineage.
The provider renders. **No provider is selected in this pass.**

Inputs: Brand Kit · logo · app icon · authorized product screenshots · campaign
narrative · brief · CTA · visual style · channel dimensions.

**A rendered visual is a claim surface.** Text inside an image ("4.9★", "50%
off") is subject to the same claim governance as body copy, and any pipeline that
renders text into an image must extract and govern it. Recorded now because it is
much harder to retrofit.

## 16. Video content architecture

strategy → hook → script → scene plan → storyboard → voice direction → CTA →
brand assets → product footage → **provider abstraction**.

Not coupled to a vendor. LaunchMind owns the marketing intelligence; the provider
owns rendering. A synthetic voice or avatar that could be mistaken for a real
person requires explicit owner confirmation — an unconfirmed synthetic
spokesperson is an implied endorsement.

## 17. CreativeProvider abstraction

Capabilities: `TEXT | IMAGE | VIDEO | VOICE | TEMPLATE_RENDER`.

Provider selection must **not** affect content identity, strategy identity,
evidence, approval, founder authority, Marketing Memory or execution permission.
Modelled on `ProviderAdapter` from Improve Intelligence: a registry, typed
errors, and — critically — **no `execute_*` surface**, so a creative provider
cannot become an execution path.

## 18. Owner marketing assets — observation is not a licence

**NEW_REQUIRED**, and it closes a live gap. Today `intakeWorker` downloads App
Store / Play Store screenshots, website hero images and Google image-search
results into Storage as `products.scraped_meta.marketingImages`, and
`contentService` uses them directly in ad generation. **Scraped external imagery
is being treated as an authorized marketing asset.**

Two classes, kept apart:

| | OBSERVED_EXTERNAL_ASSET | AUTHORIZED_MARKETING_ASSET |
|---|---|---|
| Origin | scraped/observed | owner-provided or owner-authorized |
| Use | reasoning, brand inference | may appear in generated marketing |
| Rights | unknown | owner asserted |

Tracked per asset: workspace · product · source · provenance · usage rights ·
status · version · archival. **An asset with unknown rights is never composited
into generated marketing.** Existing scraped rows are reclassified as OBSERVED,
not grandfathered — that is a migration for 3.5B1, and it will change current
behaviour.

## 19. Owner provenance — the "why" without the internals

Owner-safe example:

> **Created because**
> • Growth Brain identified a positioning opportunity
> • your confirmed objective is customer acquisition
> • Market Intelligence observed competitors emphasising automation
> • your founder direction says not to compete on price
> • this message uses your verified product capability

**Never exposed:** evidence handles (`m1`, `mi3`, `goal`), authority enums,
system prompts, model reasoning, policy internals, internal ids, lifecycle enums.
This reuses `ownerTextBoundary` — the two-layer boundary built for P1-20, which
normalises citation syntax and rejects anything residual.

## 20. Intelligence must materially change the output

This is the test that separates an AI CMO from a generic generator, and it should
be a certification suite, not a claim.

| | Setup | Expected |
|---|---|---|
| **A** | same product + request, **with** vs **without** Market Intelligence | strategy/content differ **only** where MI legitimately informs them; no diff elsewhere |
| **B** | same intelligence, founder direction changed | founder direction wins, per the existing authority hierarchy |
| **C** | Marketing Memory holds a historical winner | it may influence *strategy*; it must **not** become factual evidence merely because it performed |
| **D** | competitor prose present | LaunchMind reasons from it; the prose guard blocks reproduction |

A is the sharpest: **no-diff would prove the intelligence is decorative**, and an
everywhere-diff would prove it is contaminating unrelated decisions. Both are
failures, and only a diff-shaped assertion catches both.

## 21. Variants vs versions

**Versions are history. Variants are alternatives.** Conflating them is how an
A/B test becomes an accidental overwrite.

**EXTEND `content_assets`** with `variant_group_id` + `variant_label` rather than
adding a table: variants share campaign, strategy and brief, and differ only in
copy, so they *are* artifacts. Each variant is independently claim-detected,
grounded and approved — approving "Hook A" grants nothing to "Hook B".

## 22. Owner edits

The owner may edit, regenerate, request a variant, reject or approve. An edit
changes artifact text and creates a version (append-only, already enforced).

An edit must **not** automatically change founder direction, change product
truth, create evidence, mutate Marketing Memory, or authorize execution. Edit
deltas are retained for **3.7** to learn from *under governance* — never
automatically. An edited artifact re-enters claim detection: an owner can
introduce a claim just as a model can.

## 23. Quality model — six dimensions, never one score

| Dimension | Decided by | Certifiable? |
|---|---|---|
| Factual safety | three-signal + grounding | **yes**, deterministically |
| Structural validity | channel validators | **yes** |
| Brand alignment | Brand Kit validators (prohibited terms, voice) | partly |
| Strategic relevance | strategy ↔ opportunity linkage | partly |
| Creative quality | human judgement | **no** |
| Performance | measured after execution | **not until 3.6/3.7** |

No composite "AI score". Creative quality is never presented as certified, and no
model grades its own output — ADR-070 §7, restated because a single score is the
most tempting shortcut in this whole design.

## 24. Owner experience

The primary screen is **not** "what content do you want to create?".

```
TODAY / GROWTH BRAIN
  "I found an opportunity."        ← what and why now
  Why it matters                   ← owner-safe provenance (§19)
  Recommended narrative
  Recommended content
  [ Create recommended content ]   ← primary
  [ Create something else ]        ← secondary (MODE B, same pipeline)
→ Strategy → Content Campaign → Assets → Review
```

The owner returns for *"what does my AI CMO recommend today?"*. Mode B stays one
click away — but it is the secondary action, and that ordering is the product.

## 25. Retention flywheel

LaunchMind should be more valuable each week because it remembers what was
tried, approved, changed, run, what worked and failed, which messages performed,
which audiences responded, which channels worked, and what fatigued.

The promise: **"LaunchMind knows more about how to market my application every
week."** All of it flows through 3.7 governance — performance is an observation,
not a belief, until the governed comparator says otherwise.

## 26. Growth loop, and its limits

```
trend/opportunity → narrative → rapid multi-format content → distribution
→ engagement → identify winning hook → governed variants → amplify
→ detect fatigue → refresh creative
```

Boundaries: no fabricated trends or controversy · no fake stories or endorsements
· no manufactured scarcity · no engagement bait that trades brand trust for
reach · **no volume-for-volume's-sake** — more content is not the goal, and a
system rewarded for output will produce spam.

## 27. Handoff to 3.6

3.5 hands over: approved content campaign · approved artifact · immutable version
· channel · strategy · brief · product/workspace · brand assets · grounding and
provenance · CTA intent · content approval.

3.6 independently determines audience targeting · budget · schedule · placement ·
provider credentials · **execution approval** · spend authorization.

**Content approval never implies execution approval** — procedurally here, and
structurally in migration 114.

## 28. Handoff to 3.7

Performance metadata that should eventually return, keyed to campaign · artifact
· version · variant · channel · audience: impressions · reach · clicks · CTR ·
conversion · cost · revenue where available · engagement · video completion ·
owner edits · approval/rejection · creative fatigue.

3.7 decides what may become governed learning. **Raw performance never rewrites
founder direction**, and a winning message becomes a *preference*, not a fact.

## 29. Compatibility with 3.9 guarded autonomy

Eventually: *"This creative is fatigued. Variant B historically performs better.
I prepared a replacement."* — prepared, and in 3.9 possibly applied within an
owner-granted boundary.

Nothing here makes that impossible, and three choices actively enable it:
variants are first-class (a replacement already exists as an artifact); approval
binds one immutable version (a swap is representable and auditable); and the
execution guard's rule that **a `system` actor is refused before every other
gate** means autonomy must arrive as an explicit owner grant rather than as an
absence of checks.

---

## 30. Governance matrix

Legend — Mut: A=append-only, V=versioned, M=mutable-with-audit. Exec: can this
object authorize execution (**always NO in 3.5**).

| Object | Identity | WS | Prod | Source of truth | Mut | Authority | Owner confirm | Approval | Exec | Memory effect | Failure |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Product Content Context | ephemeral, `context_package_id` | ✓ | ✓ | composed at read time | — | inherits sources | — | n/a | NO | none | degrade → refuse |
| Brand Kit | `brand_kits.id` | ✓ | ✓ | own table | V | per-field SCRAPED/INFERRED/OWNER_CONFIRMED | per field | n/a | NO | none | unconfirmed ⇒ not usable as proof |
| Brand/Marketing Asset | `marketing_assets.id` | ✓ | ✓ | own table + Storage | V | OBSERVED vs AUTHORIZED | rights assertion | n/a | NO | none | unknown rights ⇒ never composited |
| Content Opportunity | `saved_opportunities.id` | ✓ | ✓ | existing table (EXTEND) | M | derived from Growth Brain | no | n/a | NO | none | expire, never auto-act |
| Viral Growth Opportunity | same, `kind` | ✓ | ✓ | same | M | same | no | n/a | NO | none | unevidenced trend ⇒ not asserted |
| Content Campaign | `content_campaigns.id` | ✓ | ✓ | new table | M | none | no | n/a | **structurally NO** | none | orphan ⇒ inert |
| Content Strategy | `content_strategies.id` | ✓ | ✓ | existing (EXTEND) | V | none | proof entries | n/a | NO | none | unresolved proof ⇒ blocked |
| Content Brief | `content_briefs.id` | ✓ | ✓ | existing (EXTEND) | immutable snapshot | none | offer/pricing/CTA/certs | n/a | NO | none | unresolved ⇒ needs confirm |
| Content Artifact | `content_assets.id` | ✓ (114) | ✓ | existing | M text, V history | none | per claim class | `content_approved_at` | NO (trigger) | none | ungrounded ⇒ not approvable |
| Content Version | `content_versions.id` | inherited | inherited | existing (047) | **A**, REVOKE U/D | none | no | binds one version | NO | none | immutable |
| Content Variant | `content_assets.id` + `variant_group_id` | ✓ | ✓ | existing (EXTEND) | as artifact | none | per variant | per variant | NO | none | approval never spreads |
| Visual Asset | `content_assets.id` (visual type) | ✓ | ✓ | existing + Storage | V | none | asset rights | as artifact | NO | none | in-image text ⇒ claim-governed |
| Video Asset | same | ✓ | ✓ | same | V | none | rights + synthetic voice/avatar | as artifact | NO | none | script governed as text |
| Provenance | derived | ✓ | ✓ | read-time composition | — | none | no | n/a | NO | none | unknown ⇒ say so |
| Performance Feedback | 3.7 | ✓ | ✓ | 3.6/3.7 | A | observation only | no | n/a | NO | **only via 3.7 governance** | absent ≠ zero |

PII: owner-supplied brief text and uploaded assets are the only PII-bearing
inputs; neither is persisted into prompts or logs, and neither may be reproduced
in generated copy without owner confirmation.
Injection boundary: **every** owner-authored and externally-sourced field —
brief fields, Brand Kit values, competitor prose, store descriptions, provider
responses — is DATA, never instruction, and is fenced at the prompt and governed
downstream by the claim engine (the fence is not the control; the engine is).
External IP: external prose is reasoning input only, enforced by the prose guard;
external imagery is OBSERVED and never composited.
Audit: every generation writes an `ai_requests` row with actor, model, tokens,
cost and `context_package_id`; every approval writes an append-only
`asset_approvals` row.
Retention: opportunities expire; campaigns/strategies/briefs/artifacts archive
(soft delete); versions and approvals are permanent.

## 31. Threat model

| # | Threat | Control | Residual |
|---|---|---|---|
| T1 | Workspace A content uses Workspace B data | composite FK + RLS + server-resolved workspace + per-request handles | none known |
| T2 | Product A uses Product B brand/evidence | product-scoped context, product-scoped Brand Kit, handles from one package | workspace-global constraints must be explicit |
| T3 | Brand asset leakage across products | assets are product-scoped; Storage path includes product | Storage path is not itself authorization — **must be verified in 3.5B1** |
| T4 | Content generated for the wrong application | brief carries product_id; generation refuses without it | — |
| T5 | Competitor prose copied | `externalProseGuard` shingle overlap; evidence bodies never sent to the generator | short taglines below the shingle floor |
| T6 | Fake social proof / pricing / capability / performance | three-signal detection + grounding + SUPPORTING_KINDS; first-party needs first-party evidence carrying the figure | figurative copy (measured, P1-36/37) |
| T7 | PII leakage | owner text boundary; no PII in prompts or logs | uploaded imagery containing faces — **open** |
| T8 | Prompt injection via owner brief | fenced as data; claim engine governs regardless | fence alone is not a control |
| T9 | Injection via scraped/competitor content | same; MI carries no instructions into prompts | — |
| T10 | Injection via provider response | provider output is untrusted; declaration schema `.strict()`; forbidden fields rejected | — |
| T11 | Logo/asset rights violation | OBSERVED vs AUTHORIZED split (§18) | **live gap today** — scraped images used in generation |
| T12 | Cross-product Marketing Memory | memory is workspace+product scoped; retrieval enforces it | — |
| T13 | Founder authority spoofing | authority is persisted, never derived from copy or performance | — |
| T14 | Approval confusion | separate columns, separate audit trails | — |
| T15 | Content approval → execution escalation | migration 114 trigger; no spend column on `content_campaigns` | — |
| T16 | Provider credentials misuse | credentials in the vault, never in content paths | creative providers not yet integrated |
| T17 | Spend without authorization | no spend surface exists in 3.5 | 3.6 |
| T18 | Provenance spoofing | provenance is derived server-side from lineage, never model-authored | — |
| T19 | Unaudited AI usage | `ai_requests` with actor split (P1-43 closed) | — |
| T20 | Silent failure | fail-closed: degraded ⇒ not certified, not approvable | — |

## 32. Data model gap analysis

| Concept | Classification | Notes |
|---|---|---|
| ContextPackageV2 · evidence handles · grounding | **EXISTS** | reuse unchanged |
| Market Intelligence · Marketing Memory · authority | **EXISTS** | reuse unchanged |
| `content_assets` · `content_versions` · `asset_approvals` | **EXISTS** | reuse; 114 added workspace + governance lane |
| `content_strategies` · `content_briefs` | **EXTEND_EXISTING** | add `campaign_id` and §10/§11 fields |
| Content Opportunity | **EXTEND_EXISTING** | `saved_opportunities` + `kind`, `narrative`, `channels[]`, `origin` |
| Content Variant | **EXTEND_EXISTING** | `variant_group_id`, `variant_label` on `content_assets` |
| Content Campaign | **NEW_REQUIRED** | `content_campaigns`; deliberately not `campaigns` |
| Brand Kit | **NEW_REQUIRED** | `brand_kits` + `brand_kit_fields` with provenance |
| Marketing Asset governance | **NEW_REQUIRED** | `marketing_assets`; reclassifies today's scraped images |
| Creative provider registry | **NEW_REQUIRED** | contract only in 3.5 |
| Visual / video artifacts | **EXTEND_EXISTING** | new `asset_type` values, same table |
| Performance feedback | **FUTURE_ONLY** | 3.7; `content_learnings` (028) already exists |
| Execution handoff | **FUTURE_ONLY** | 3.6 |

**Three new tables, two extensions, no parallel systems.** Everything else is
composition over what already exists.

## 33. Roadmap

| Pass | Scope | Why here |
|---|---|---|
| **3.5B1** | Brand Kit + Marketing Asset governance + product content context | Everything downstream needs brand and asset rights; **T11 is a live gap** and should be closed first |
| **3.5B2** | Content Opportunity (extend `saved_opportunities`) + Content Campaign | the "why" must exist before the "what"; unlocks the Today screen |
| **3.5B3** | Strategy/Brief real intelligence composition + §20 influence certification | proves intelligence materially changes output — the AI-CMO claim |
| **3.5B4** | Multi-channel adaptation + variants (+ LinkedIn, video script) | narrative → channels, on the frozen pipeline |
| **3.5B5** | Owner Content Intelligence UX | the flywheel is only real when the owner sees it |
| **3.5B6** | Creative provider abstraction + visual foundation | contract-first; no vendor lock |
| **3.5B7** | Shadow E2E + corpus #6 + security certification | corpus #6 last, against a settled contract |

Two deliberate changes from the suggested order: **UX before visual creative** —
the AI-CMO promise is delivered by the recommendation surface, not by images;
and **corpus #6 last**, because every earlier pass could move the contract it is
meant to be held out against.

## 34. Acceptance for Phase 3.5

*(The instruction defining acceptance was truncated in transmission. The
following is proposed and should be confirmed or replaced.)*

Phase 3.5 is complete when, in SHADOW:

1. Growth Brain produces a Content Opportunity an owner can read, with owner-safe
   provenance and no internals leaked.
2. An opportunity produces a Content Campaign, strategy, briefs and channel
   artifacts sharing one narrative and one traceable lineage.
3. Both creation modes traverse the identical governance pipeline, proven by test.
4. §20 A–D pass: intelligence materially and *narrowly* changes output.
5. Brand Kit resolves with per-field provenance; unconfirmed inference never
   becomes proof.
6. No unauthorized asset is composited into generated marketing.
7. Corpus #6 gates hold: `ALL_SIGNAL_ESCAPE_COUNT = 0`, union dangerous recall ≥ 99%.
8. Cross-workspace and cross-product isolation proven at all six layers.
9. Zero execution, zero spend, zero Marketing Memory mutation, content approval
   still unable to authorize execution.
10. The 3.6 handoff package is complete and the 3.7 feedback contract is defined.

## 35. Roadmap addendum — B7 marketing channel connections (FROZEN, not implemented)

Added to the §33 roadmap after B6. **No OAuth, no provider code in 3.5B3.1.**

**B7 — MARKETING CHANNEL CONNECTIONS.** Initial providers: **Google Ads**, **Meta Ads**.

Purpose, and its hard ceiling:

| B7 does | B7 never does |
|---|---|
| connect an account | launch a campaign |
| discover accessible accounts | publish anything |
| read structure (campaigns, ad sets, assets) | change a budget |
| read performance and safe observations | pause or resume |
| map an authorised account to ONE LaunchMind product | authorise spend |

**Three things that look like one and are not:**

```
CREDENTIAL OWNERSHIP     ≠   PRODUCT / BUSINESS ACCOUNT MAPPING   ≠   EXECUTION AUTHORISATION
"I can sign in"              "this ad account is THIS product"        "you may spend money"
```

A founder commonly has access to several Google or Meta accounts — an agency
login, a client account, a personal test account. **LaunchMind must never map
every accessible account to every product.** The owner chooses explicitly which
business/ad account belongs to which LaunchMind product, and a connection that
grants read access grants nothing else. This is the same distinction Improve
Intelligence already enforces for observation providers, where connecting a
source never implied the right to act on it.

Execution authorisation is obtained separately in **3.6**, per action, with its
own approval trail.

## 36. Creative provider roadmap — reconfirmed

| Provider | Role | Status |
|---|---|---|
| **Claude** | marketing intelligence, strategy, all text | in use |
| **Replicate** | image generation and editing, generative video | B6, behind `CreativeProvider` |
| **HeyGen** | avatar / spokesperson / UGC-style video | B6, env names only (§0) |
| **ElevenLabs** | voice and audio | B6, behind the same abstraction |

Every integration sits behind the provider abstraction of §17, so a vendor change
is never a governance change. HeyGen environment **names** exist with an empty
value; **no global avatar or voice id is defined**, because those are governed
product/content configuration an owner chooses per product, not a process-wide
default.

## 37. B4 content package — model and boundaries (implemented)

**No package table.** `content_campaigns.content_package` (migration 117) already
holds it. A package is *what this campaign should produce*: it has no identity
apart from its campaign and is replaced wholesale when the plan changes, so a
separate table would add a lifecycle nothing needs.

Limits, chosen for **owner review burden** as much as cost: 5 channels · 3
variants per channel · 10 artifacts total. A system rewarded for output produces
spam, and a package nobody can read is the same as no package.

Item readiness: `READY_TO_GENERATE` · `BLOCKED_ON_OWNER_CONFIRMATION` ·
`BLOCKED_ON_ASSET` · `BLOCKED_ON_PROOF` · `UNSUPPORTED_CHANNEL`. **One blocked
item never fails the package.**

Variant dimensions: `HOOK · ANGLE · TONE · PROOF · CTA`. A proof-led variant is
not planned when there is no proof — it would have to invent one.

## 38. Creative provider capability map (frozen, not implemented)

| Capability | Claude | Replicate | HeyGen | ElevenLabs |
|---|---|---|---|---|
| TEXT / reasoning | ✓ | | | |
| IMAGE_GENERATION | | ✓ | | |
| IMAGE_EDITING | | ✓ | | |
| IMAGE_TO_VIDEO | | ✓ | | |
| TEXT_TO_VIDEO | | ✓ | | |
| AVATAR_VIDEO | | | ✓ | |
| LIPSYNC | | | ✓ | |
| VOICE | | | | ✓ |
| TEMPLATE_RENDER | | ✓ | | |

Interface-only in 3.5. A provider receives content, brief and authorised assets —
never founder authority, execution approval, Marketing Memory write access or
spend. **Avatar and voice selection are product/content configuration**, never
environment variables.

### Cost-aware routing (future contract)
LaunchMind will eventually choose a draft / production / premium tier from
quality need · channel · asset type · owner preference · cost ceiling. **Pricing
is never hardcoded** — it comes from provider metadata, and an owner-facing
"estimated creative cost" may only be shown when calculated from current
provider pricing.

## 39. B5 owner journey (contract, no UI built)

```
Today / Growth Brain
  "I found an opportunity"           ← what and why now
  Why it matters                     ← owner-safe provenance
  Recommended Content Campaign       ← the narrative
  Recommended Content Package        ← what LaunchMind would make
  [ Create recommended content ]     ← primary
       ↓ generation progress
  Package review                     ← ready / needs you / needs proof / needs asset
  Artifact cards + variants
  Approve individual content         ← binds ONE version, grants no execution
  [ Create something else ]          ← secondary, same pipeline
```

**Review data contract:** campaign · package · artifact · variant · version ·
content · channel · status · needs-attention · why created · proof · brand
version · owner-confirmation gaps · creative brief · rendering readiness. No
handles, enums, prompts or policy internals.

## 40. B7 account mapping and read-only capability (frozen)

```
CREDENTIAL          ≠  ACCESSIBLE PROVIDER ACCOUNTS  ≠  PRODUCT MAPPING  ≠  EXECUTION AUTHORISATION
"I signed in"          "these 6 ad accounts exist"      "THIS one is       "you may spend"
                                                         THIS product"
```

One founder authenticates once and may see several ad accounts — agency, client,
personal. **LaunchMind never maps every accessible account to every product.**
The owner chooses each mapping explicitly, one provider account to one product.

**B7 may:** connect · discover accounts · map account → product · read campaign
structure · read performance · read conversion configuration · read account
status.
**B7 may not:** launch · pause · resume · change budget · publish · change bid ·
change targeting.

**Owner trust disclosure**, to be shown verbatim in the connection UI:

> LaunchMind can currently: ✓ read campaign structure · ✓ read performance ·
> ✓ read conversion configuration
> LaunchMind cannot currently: ✕ launch campaigns without approval · ✕ change
> budgets · ✕ publish ads · ✕ pause campaigns automatically

## 41. Performance and fatigue identity (3.7 handoff)

Every artifact already carries campaign · strategy · brief · channel · variant
group + label · version · brand kit version. When performance returns in 3.7 it
can be attributed to exactly one variant of one version on one channel, and
fatigue can be compared across variant × version × time window × channel ×
audience. **No inference is implemented and no Marketing Memory is written.**

## 42. Remaining Phase 3.5 sequence (frozen)

| Pass | Scope |
|---|---|
| **B5** | AI-CMO content UX (§39) |
| **B6** | Creative provider integration — Replicate, HeyGen, ElevenLabs, behind §38 |
| **B7** | Marketing channel connections — Google Ads, Meta Ads; read-only and account mapping first (§40) |
| **B8** | Shadow E2E + corpus #6 + final 3.5 security/isolation certification |
| **3.6** | Campaign Intelligence + human-approved execution |

## Consequences

**Accepted:** three new tables; a live IP gap (T11) to close before further
generation work; corpus #6 deferred to the end; several content families
deliberately FUTURE.

**Rejected:** a second opportunity table; naming the narrative object
`campaigns`; a composite AI quality score; owner-directed content bypassing
governance; treating scraped assets as authorized; promising virality.
