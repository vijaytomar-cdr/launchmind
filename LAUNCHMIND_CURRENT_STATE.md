# LaunchMind — canonical current state

## Gate 1 certification — 2026-09-21

The current AllignX Plumbing / Product Demonstration core-message package is
production certified. It is tied to the current Arizona demand tournament,
current planning snapshot, and governed artifact `e607df7d-6f81-4c30-a8c3-2f800bf2ea03`,
version 1. Planning item `2b190e64-1592-4227-9f87-3a56b6e96f73` is
`READY_FOR_REVIEW`. Copy remains owner-reviewable with any creative assessment
retained as metadata; it is not performance-backed. Gate 2 is visual
certification. No visual was generated or approved.

## Gate 2A composition certification — 2026-10-04

The failed Gate 2 job `21ecdb15-a86f-4614-aab7-f2b37d2e9c08` used three
wordless FLUX backgrounds and composited an authorized App Store promotional
panel over each. The backgrounds were usable; the panel was not a valid
product-demo hero because it embeds ungoverned marketing claims, including
price/fee language. No owner-review visual was persisted or approved.

The deterministic product-hero composition now prioritizes a governed CTA over
optional support copy, and a Product Demonstration refuses an evidence-only
promotional panel rather than presenting it as product truth. A single owner
visual action is capped at two provider generations; geometry-only failures do
not trigger a new background generation. Gate 2 remains blocked on a clean,
owner-authorized product screenshot or product media asset; no provider calls
were made during Gate 2A.

## Gate 2B governed product-media audit — 2026-10-04

The current AllignX media registry contains one authorized website logo and
three authorized App Store screenshots. Pixel review confirms that all three
screenshots are promotional panels, not clean product UI: they contain embedded
booking, fee, or no-hidden-charges marketing claims. The official website
metadata supplies the same logo as its only image. Generated historical creative
is observed-only and cannot be promoted into product source media.

No clean, owner-authorized product media exists for the certified Product
Demonstration. Gate 2 must stop before a provider call. The required owner input
is one normal, clean screenshot of the real AllignX app or web service-request
experience, preferably a Plumbing request screen, without promotional overlays,
pricing, payment, availability, ratings, or booking-confirmation claims.

## Gate 2C governed product UI extraction — 2026-10-05

The owner-authorized AllignX homepage capture is stored as source media
`b276a69c-df4c-4b07-b297-8f0eb1fabf75`. It remains classified as
`PROMOTIONAL_PRODUCT_EVIDENCE`: surrounding homepage copy and footer claims are
not creative truth. LaunchMind deterministically extracted the Book a Service
interface to `d0ff4163-04a6-4564-9b56-4b07c91d3563`, classified
`CLEAN_PRODUCT_UI`, with the parent asset and exact crop coordinates retained in
`generation_provenance`.

The crop is authorized and eligible for visual rendering. A zero-provider
composition with retained Gate 2 background candidate 1, the clean UI crop,
the certified headline, confirmed logo, and governed CTA passed visual
inspection. The next Gate 2 action must preserve this governed product-media
snapshot and its source lineage.

## Gate 2 static creative / visual certification — 2026-10-05

Gate 2 is certified. Gate 1 artifact/version
`e607df7d-6f81-4c30-a8c3-2f800bf2ea03` / 1 now has the owner-reviewable static
visual asset `18ad9718-1688-4657-b1f6-9be602f2cdde`, associated with render job
`5e27669b-2d6a-455a-981a-0a0bc705c360`. It preserves the retained FLUX
prediction `fvewztwq8nrmy0d111tt3btj28` and uses clean governed product UI
`d0ff4163-04a6-4564-9b56-4b07c91d3563`.

The shared Product Hero contract now governs both deterministic composition and
pixel-QA requirements: authentic product UI, headline, logo, and CTA are
required; supporting copy is optional. The retained raw source was recomposed
locally and persisted through the governed recovery path with no new provider
calls. The owner read model returns `READY_FOR_OWNER_REVIEW` consistently.
The visual is owner-reviewable, not approved, published, or performance-backed.
Next: Gate 3 — owner review certification.

## Gate 3 owner review / approval certification — 2026-10-05

Gate 3 is certified. The canonical planning review route for planning item
`2b190e64-1592-4227-9f87-3a56b6e96f73` now resolves the current governed visual
and real version history alongside the certified message. Its single approval
action binds artifact `e607df7d-6f81-4c30-a8c3-2f800bf2ea03`, Version 1, and
render job `5e27669b-2d6a-455a-981a-0a0bc705c360`.

The owner approved that exact package once. Content status is
`CONTENT_APPROVED`; the existing visual approval is also recorded. Approval is
idempotent for that exact version and does not publish, launch, schedule, spend,
or contact an execution platform. The approved creative remains visible and
Version 1 remains the real current history entry. Next: Gate 4 — campaign
execution certification.

## Gate 3A owner review UX certification — 2026-10-05

The canonical owner-review route remains
`/dashboard/content?planning=2b190e64-1592-4227-9f87-3a56b6e96f73`. It now
uses an active visible loading indicator and retryable failure state, a compact
responsive 1:1 visual preview, and an accessible inspection dialog that preserves
the persisted approved image. The review page keeps the complete message and
Edit/Regenerate actions visible, while Brief is explicitly strategy/direction and
Version History explicitly records creative evolution. Version 1 remains current,
approved, and visually attached. No provider calls or approved-package mutations
occurred. The final owner-facing labels are “Edit creative” and “Create another
version”; the approved advertising CTA remains a read-only `CTA · Learn More`
field. Gate 3 owner review UX is frozen for V1.

The final canonical review layout presents the approved creative and message as
one responsive package: desktop uses a creative/message grid with a 360px
maximum preview and subtle `View larger` inspection affordance; narrow layouts
stack without cropping or horizontal overflow. The CTA is plain read-only message
content. No certified record or provider state changed.

Next: Gate 4A — Meta execution preflight / ready-to-launch certification.

## Content Studio loading UX — 2026-10-05

The Content Studio index and canonical planning review now share the same
in-content loading card and spinner. The index says “Loading Content Studio…”;
the review says “Loading your creative…”. Existing request failures and retry
behavior remain unchanged. No backend, provider, or approved-content state changed.

**Checkpoint date:** 2026-09-05  
**Evidence basis:** current static repository inspection plus the latest scoped
UX2.9 runtime evidence in `artifacts/ux29/`. Runtime claims are identified. This
document records state; `AGENTS.md` records durable operating rules.

## Product and phase

LaunchMind is an **AI CMO / AI Growth Operating System** for app founders:

- **Meet Your AI CMO** on the homepage.
- **Teach Your AI CMO** during onboarding.
- **Work with Your AI CMO** in the product.
- **Discover first. Confirm second. Learn continuously.**

Current work remains in **Phase 3.5: Content Creation and the
Intelligence-to-Content loop**. Do not advance into execution, autonomy, broader
video work, or Phase 3.6 while the owner-visible creative-quality blocker remains.

## Architecture

### Frontend and navigation

The web application is a Next.js 14 App Router application rooted at `app/`.
Supabase SSR carries the authenticated session through middleware, server, and
browser clients. `lib/api.ts` is the typed HTTP boundary to the Fastify backend;
the browser passes the user JWT rather than a service-role credential. Dashboard
pages compose feature components under `components/launchmind/`.

The implemented sidebar matches the canonical navigation:

- COMMAND: Morning Brief, Opportunities, Approvals, Missions
- CREATE: Content Intelligence, Content Studio
- EXECUTION: Campaigns, Calendar, Experiments
- INTELLIGENCE: Growth Brain, Improve Intelligence, Market Intelligence,
  Marketing Memory, Knowledge Graph
- SYSTEM: Launch Readiness, Settings

Content Intelligence is the upstream recommendation/decision surface. Content
Studio is the downstream artifact workbench for comparison, editing, version
review, and separate copy/creative approval. Campaigns, Calendar, and Experiments
remain execution-oriented surfaces.

### Backend and persistence

The backend is Node.js/Fastify with Zod-validated route inputs.
`backend/src/server.ts` registers shared security and observability plugins before
product, workspace, owner, Studio, campaign, experiment, calendar, memory,
knowledge, onboarding, and other routes. Authenticated workspace context is
resolved server-side. Supabase Postgres is the primary store; Redis/BullMQ workers
handle queued/background work where required. The server-held Supabase
administration client is not exposed to the frontend.

Migrations are additive, idempotent files under `backend/migrations/`. Static
inspection finds migrations through `20260824_000123`. Migration 121 was previously
owner-reported as applied while earlier runtime evidence found its columns absent.
Current runtime migration state is **Unverified / requires runtime confirmation**.
Do not investigate or execute it unless a task depends on video schema.

### Workspace and approval boundaries

Product-content context joins authoritative application facts, founder direction,
governed evidence, current brand kit, and workspace/product-scoped authorized
assets. Observed-only assets are counted for display but withheld from creative
inputs. Content approval, creative approval, and execution authorization are
distinct persisted decisions. No content or creative approval grants publishing,
scheduling, sending, launching, or spend authority.

## Foundation, onboarding, and intelligence

Phase 1 foundation is represented by Supabase authentication, founder/product
records, product discovery/onboarding routes, workspaces, configuration, core API
boundaries, and initial dashboard/product surfaces. Precise historical Phase 1
acceptance status was not re-certified in this pass.

Onboarding implements discover-then-confirm behavior and persists canonical
onboarding/context state. Runtime completion for any particular owner is
**Unverified / requires runtime confirmation**.

Growth Brain combines governed product/founder context with observed signals and
recommendation/decision records. Recommendations do not become evidence or action
authority. Owner action identity and target are represented explicitly rather than
inferred from a click label.

Improve Intelligence is the connection and source-improvement surface. Provider
connections can improve observation coverage; a connection does not imply product
mapping, strategic relevance, execution permission, or unobserved evidence.

Market Intelligence has dedicated routes, services, persistence, provenance, and
active-record handling. External intelligence may inform strategy and creative
structure but cannot substantiate first-party performance or product capabilities.

Marketing Memory has retrieval, lifecycle, governance, promotion, suppression,
and authority policies. Generation, editing, approvals, rendering, and Creative
Intelligence observations do not silently become durable Marketing Memory.

Knowledge Graph has a dedicated route and owner-facing explorer for marketing
entity relationships. Its live completeness for a specific workspace is
**Unverified / requires runtime confirmation**.

## Phase 3 content surfaces

Content Intelligence answers what to create, why now, for whom, in which format,
and what LaunchMind needs. The simplified presentation includes the recommended
opportunity, audience, creative direction, tone, generated concepts, their
readiness/refinement state, comparison, and collapsed supporting reasoning. It
should route to review rather than become an editor.

Compare Concepts presents families such as question-hook, demonstration-hook,
Relief, Product Demonstration, and Problem Recognition across hook, visual thesis,
message, rationale, state, and review action.

Content Studio reviews, edits, compares versions, and separately approves copy and
visuals LaunchMind already created. It should not repeat upstream strategy
decisions. Static code retains video services and schema, but current owner UX
intentionally reports video production unavailable in development. Runtime
provider availability is **Unverified / requires runtime confirmation** and is not
a reason to enable video in Phase 3.5.

## Creative generation architecture

The implemented Meta creative path is:

1. `creativeSetOrchestrator.ts` selects distinct concept contracts and performs
   bounded concept attempts.
2. `b3ContentGeneration.ts` generates channel-shaped copy and CTA.
3. Claim, capability, terminology, structural, and brand checks determine copy
   disposition; `contentArtifactPersistence.ts` stores exact versions and
   governance summaries.
4. `scenePlan.ts` maps concept family to visual objective, focal order,
   composition, asset requirements, and structural execution. Recent qualified
   execution IDs/signatures help avoid repetition.
5. `creativeRenderService.ts` resolves workspace-authorized assets and routes the
   render. In deterministic product composition, the image provider receives a
   wordless-background request with no source screenshot.
6. `productComposition.ts` places authorized screenshot pixels, confirmed logo,
   and exact governed overlay text using deterministic geometry and typography.
7. Structural composition checks run first; `visualCritique.ts` then evaluates
   actual final pixels for concept clarity, hierarchy, legibility, composition,
   brand fit, authenticity, and invented claims.
8. Failed candidates feed bounded internal refinement. Only a candidate with a
   passing final-pixel critique is uploaded and persisted as a successful visual.
9. `creativeApprovalService.ts` exposes owner-safe render state and prevents a
   failed or absent render from receiving creative approval.

Providers are adapters under LaunchMind control. Anthropic is used in inspected
strategy/copy/semantic and visual-assessment paths; Replicate supplies still-image
generation. Provider output never creates strategy, evidence, product truth,
owner approval, or execution authority.

## Governance and owner states

Claim discovery uses the conservative union of generator declaration,
deterministic detection, and semantic detection. Frozen contract hash:
`1856b72c0ba0ca7a`. Detection is not truth. Claims resolve against governed
evidence handles; product capability language is separately constrained by the
server-held capability contract. Narrative framing cannot launder unsupported
factual or capability assertions.

CTA text enters the same field discovery, capability, and factual-governance path
as other copy. Creative Intelligence contributes structural patterns only.
Authorized product imagery and confirmed logos remain authentic source assets;
the deterministic path does not send them to the image generator.

Canonical state meanings:

- `READY_FOR_OWNER_REVIEW`: LaunchMind completed the work relevant to that review
  surface.
- `LAUNCHMIND_CAN_REPAIR`: LaunchMind owns repair; owner copy should say
  **LaunchMind is refining this**.
- `NEEDS_OWNER_INPUT`: an actual confirmation, decision, or missing owner truth.

The current API often represents repair as the owner-safe `launchMindCanRepair`
collection rather than returning that literal enum. Content Studio distinguishes
**Copy ready** from visual readiness. Governance-eligible copy does not make a weak
or missing visual ready.

## Frozen UX decisions

### Morning Brief

Morning Brief is essentially frozen as the command/orientation surface. It should
lead with one priority, grounded business pulse, clear uncertainty, exact routing,
and a compact AI CMO rail. Do not redesign it.

The approved labeled demo fixture exists in `lib/morning-brief/demoFixture.ts`:

- monthly booking goal: 8 / 20
- 31 requests
- 25.8% request-to-booking conversion
- $42 cost per booking
- 132 installs
- interpretation: fix conversion before increasing acquisition
- priority: Test Preferred Availability in the Request Flow

`app/(dashboard)/dashboard/brief/page.tsx` activates it only when
`MORNING_BRIEF_DEMO_DATA=true` outside production. `npm run dev` deliberately
shows truthful real-workspace state and may render `20 bookings / month` plus
`Performance not measured` when live performance is absent. `npm run
dev:morning-brief-demo` enables the labeled fixture. Which mode the owner's target
runtime should use is **runtime-dependent and requires confirmation**.

Latest scoped evidence at 1440×900 records a 6 px Current Direction → Ask AI CMO
gap with Today's Priority collapsed and expanded, sticky behavior retained, and no
filler card added. This was spacing restoration, not redesign.

### Content Intelligence and Studio

Preserve Content Intelligence's simplified recommendation/review routing. Preserve
Studio's responsibility to review/edit/approve existing artifacts. Neither should
duplicate the other's responsibility, and Studio must not become execution.

## Completed fixes confirmed in source

- Copy lineage reads persisted `content_versions.disposition = ELIGIBLE`, avoiding
  the prior artifact-status/version-disposition mismatch behind repair 422s.
- Meta CTA is generated, structurally validated, claim-discovered, capability
  checked, and persisted with its copy version.
- Repair prompts carry rejected wording and detailed governance feedback.
- Scene planning and structural executions are explicit by concept family.
- Product screenshots are withheld from the image provider and deterministically
  composited when used.
- Final pixels receive strict critique; failed candidates are withheld.
- Recent-history selection ignores failed or unqualified visual executions.
- Owner UI distinguishes copy readiness from creative readiness.
- Morning Brief rail spacing was restored while preserving desktop stickiness.

These implementation improvements do not establish owner-visible creative quality.

## Highest-priority blocker: creative quality

The Problem Recognition loop is safer and self-repairing in control flow, but the
owner-visible artifact has not met the bar. Recurring failures include a tiny or
weak product role, excessive whitespace, weak hierarchy and crop, insufficient
supporting-copy emphasis, isolated CTA, generic brand treatment, and insufficient
visual tension.

Latest scoped runtime evidence used AllignX Problem Recognition artifact
`3bb84a9f-e377-463b-b559-33e8e98501c2`. Copy version 5 was governance-eligible:

- headline: “Home projects shouldn't start on hold.”
- supporting line: “Connect with vetted pros.”
- CTA: “See AllignX”

Five diagnostic runs created 15 internal candidates. All were withheld. The final
job had no output asset. Remaining failures were inert lower-left space, isolated
CTA, insufficient feed-size subhead emphasis, unresolved right-edge crop, a dated
visual prop, and generic brand treatment. No manual refinement click was needed for
those internal attempts, but no candidate qualified. The creative loop is **NOT
READY** and has no passing final screenshot. Do not spend more provider calls until
composition architecture is diagnosed and corrected.

## Environment limits and invalid findings

- Real mode does not inject demo performance. Demo mode is explicit, labeled,
  default-off, and refused in production.
- Provider credentials, balances, and availability are runtime facts. The earlier
  claim that Anthropic credits block all live generation is stale: scoped copy and
  critique calls succeeded on 2026-09-05. Ten-set stability remains unmeasured.
- Migration 121 remains a runtime discrepancy, not permission to migrate.
- Old B6.7/B6.8A browser conclusions based on CORS-broken blank pages are invalid.
- The diagnosis that recommendation failure alone collapses Morning Brief is
  retracted.
- The claim that Content Studio is essentially empty came from a stale Next build
  manifest and is retracted.
- A stale local React client manifest recurred during UX2.9 and was resolved by a
  managed real-mode restart and disposable build-output replacement; fresh page
  health passed afterward. This is environment history, not product UX.

## Meaningful contradictions

### Approved Morning Brief baseline versus ordinary runtime

- **Classification:** C — runtime-dependent.
- **Files:** `lib/morning-brief/demoFixture.ts`,
  `app/(dashboard)/dashboard/brief/page.tsx`, `scripts/launchmind-dev.mjs`.
- **Issue:** the approved 8/20 connected baseline exists, while normal real mode
  truthfully renders unmeasured state without live performance. Static code cannot
  determine which mode the intended owner runtime should use.
- **Future action:** inspect the actual process environment and read-model response,
  restore the approved seeded mode where intended, verify it, freeze Morning Brief,
  and stop.

### Creative control flow versus creative outcome

- **Classification:** D — genuine architectural contradiction.
- **Files:** `creativeRenderService.ts`, `productComposition.ts`, `scenePlan.ts`,
  `visualCritique.ts`, and `artifacts/ux29/README.md`.
- **Issue:** the system critiques pixels and refines internally, but the
  compositor/prompt/layout interaction repeatedly fails to construct publishable
  first-visible creative.
- **Future action:** diagnose composition without provider calls, then fix dominant
  geometry, typography, asset role, crop, CTA relationship, brand balance, and
  feed-size readability before generating one acceptance image.

### Infrastructure reference drift

- **Classification:** A — documentation stale.
- **Files:** `CLAUDE.md` still names AES/AWS KMS; current vault instructions and
  backend implementation use OCI Vault/Key Management.
- **Future action:** update `CLAUDE.md` only in a separate architecture-document
  maintenance task.

### Video code versus development product policy

- **Classification:** C — runtime-dependent.
- **Files:** `videoRenderService.ts`, migration 121, and `VideoPanel.tsx`.
- **Issue:** backend capability exists, but development UX and unresolved runtime
  migration/provider state intentionally keep production unavailable.
- **Future action:** leave disabled; resolve migration 121 and provider readiness
  only in a separately authorized video task.

No navigation discrepancy was found.

## Immediate roadmap — frozen order

### Step A — Restore Morning Brief

Verify actual runtime/demo/read-model/environment state. Restore the approved
seeded Morning Brief, freeze it, and stop.

### Step B — Diagnose creative composition architecture

Do not generate images. Trace visual-family planning, scene planning, layout
constraints, compositor, asset roles, screenshot sizing, typography, provider
prompt, post-provider composition, and critique feedback.

### Step C — Fix the visual composition engine

Build strong dominant composition, advertising-scale hierarchy, purposeful
product/screenshot role and crop, hook dominance, problem/product contrast, CTA
placement, brand balance, and feed-size readability.

### Step D — Generate one Problem Recognition Meta creative

Only after architecture is fixed. Run one real owner flow with bounded internal
retries and visually judge the final artifact. It must be genuinely publishable.

### Step E — Prove structural diversity

Only after the first creative passes, generate a small set of other concept
families and confirm they are structurally different.

### Step F — Freeze the creative loop

Only after first-generation quality is consistently strong may scope expand toward
Content Intelligence integration refinements, Campaign Intelligence / Phase 3.6,
or later execution capabilities.

## Validation rules

For implementation tasks, use focused tests, one real owner workflow, mandatory
visual inspection for UX/creative, then stop. Do not default to full repository
suites, migration audits, unrelated browser checks, or repeated provider calls.

## Next task readiness

Repository context is sufficient for the next task: **Restore Frozen Morning Brief
Runtime State**. That task has not been started here.

## Morning Brief restoration — 2026-09-05 runtime follow-up

The restoration above is now complete. The owner explicitly selected the approved
seeded AllignX development experience. Before restoration, the port-3000 managed
frontend had started at `2026-09-05T07:23:49.775Z` with `--mode=real`, which explicitly
set `MORNING_BRIEF_DEMO_DATA=false`. This agrees with the UX2.9 recovery record of a
real-mode restart. Normal owner login confirmed `/owner/brief` at
`http://localhost:3001` returned AllignX with `performanceDataAvailable=false`; the
server rendered `demoPerformanceRequested=false`, so the page honestly displayed
unmeasured performance instead of selecting the intact approved fixture.

Only that frontend was restarted using `npm run dev:morning-brief-demo`, at
`2026-09-05T18:24:14.131Z`. The new process has `MORNING_BRIEF_DEMO_DATA=true` and the
rendered server prop is true. The same live API still reports unavailable
performance; the existing view-model selector now uses
`lib/morning-brief/demoFixture.ts` for labeled development performance. No
application code, environment files, backend, or fixture changed. Future starts
of this approved runtime should use the demo command; `npm run dev` intentionally
continues to select honest real mode, and production continues to refuse demo data.

Normal owner login and the actual Morning Brief at 1440×900 passed: AllignX,
8 / 20, 31 Requests, 25.8% Request → booking, $42 Cost / booking, 132 Installs,
“Fix conversion before increasing acquisition,” and “Test Preferred Availability
in the Request Flow.” The right rail retains I need from you, I'm watching,
Current direction, Ask Your AI CMO, and working/memory/opportunity state. Observed
API responses were successful. One screenshot was captured and visually inspected:
`artifacts/morning-brief-restoration/restored-1440x900.png`. Before/after runtime
responses and rendered text are in that directory. No test suite or build was run.
Morning Brief is frozen again; no creative work was started.

## Creative composition implementation — 2026-09-05 follow-up

Scoped changes in `scenePlan.ts`, `productComposition.ts`, and
`creativeRenderService.ts` now carry executable recognition composition intent,
two grammars (hook/product fragment and problem visual/message), deterministic
asset suitability, authentic source-region crop/bleed, measured typography,
message-relative CTA placement, targeted geometry repairs, background reuse, and
actual final-execution provenance on successful renders. Fifty focused tests
passed in the four composition/scene/repair test files. Backend typecheck and lint
of the three production files passed. These checks do not establish creative quality.

Exactly one real owner generation was submitted through Content Studio's
“Create a new visual” button for artifact `3bb84a9f-e377-463b-b559-33e8e98501c2`.
Job `13e35b48-5de3-4f87-ad5b-78d2015562d2` used eligible copy version 5 and the
normal DRAFT/Flux Schnell route. It failed after three internal attempts with no
output asset. Three successful pixel-critique requests, with no transport retries,
are recorded in `ai_requests` during this job's window. The exact image-generation
call count was not persisted on failure; the bounded path permits one to three.

**Acceptance: FAIL.** The final critique found a wrong-category baking-tray/rolling-pin
visual instead of recognizable home-project imagery, invented lettering in the
background, and weak integration of the visual with the message. It recognized
clear headline and CTA rendering and a legible logo. All new candidates were
withheld; the previous incomplete owner visual remains. There is no new accepted
1024 image or feed preview. Rejected candidate pixels were not saved, so their
appearance was not independently re-inspected after rejection. Do not treat the
offline deterministic previews as successful generated advertisements.

Evidence: `artifacts/composition-engine/` contains the job/copy record, owner API
result, owner read-model result, unchanged owner-visible screenshot, focused-test
log, and explicitly labeled offline composition previews. The stopped local
backend was started to enable the workflow. Morning Brief, its frontend runtime
configuration, navigation, Content Intelligence and Content Studio implementation
were untouched. No second owner generation, batch, approval, publishing, or
diversity testing followed the failure.

## Problem Recognition visual semantics — 2026-09-05 follow-up

The prior composition implementation remains the baseline. Read-only recovery of
Replicate prediction records found all three exact prompts for job
`13e35b48-5de3-4f87-ad5b-78d2015562d2`: the previous run made **exactly three image
calls**, resolving the earlier accounting uncertainty. Each prescribed the same
paint-roller/tray still life; retries appended mixed critique text rather than
changing the visual thesis. The third prompt repeated the rejected “PAINT” prop
label. Full prompts and per-attempt feedback are in
`artifacts/visual-semantics/previous-prompts.md` and `prior-attempt-analysis.json`.

The creative scene contract now supports two bounded, context-grounded theses:
STALLED_PROJECT and COORDINATION_FRICTION. The selected scene describes an
unfinished residential doorway repair, or a homeowner arranging help beside that
repair. Unrelated industries, standalone metaphor props, all generated lettering,
pseudo-text, labels, branding and UI are explicitly forbidden in the positive
provider prompt. Raw critique and old visual-brief layouts no longer enter that
prompt. Semantic mismatch can switch thesis and regenerate; text artifacts
regenerate the scene; layout-only defects reuse imagery. Existing typography,
composition grammars, factual governance, and owner-version withholding remain.
Pixel critique adds explicit semantic-context and background-text checks without
weakening existing gates.

Development-only local diagnostics (`NODE_ENV=development`) retain at most ten
jobs, three candidate images per job, pruning entries older than 24 hours on new
job creation. They store exact prompts, thesis, grammar, critique, repair decision,
status and image/critique/recomposition/semantic-regeneration counters outside the
owner asset system. Explicit development mode was enabled by restarting only the
backend; the frozen Morning Brief frontend process and settings were untouched.

**Real creative acceptance remains UNPROVEN / BLOCKED.** The requested original
artifact's eligible version 5 already had four jobs and hit the existing 12-call
per-version bound. No limit was changed. The one allowed owner action therefore
used existing eligible Problem Recognition artifact
`72d53a16-aec7-44c7-a269-411d438a1d48` in the same AllignX campaign, with no prior
jobs. Its missing CTA/incomplete supporting copy invoked the existing governed
copy-repair path. That path returned HTTP 422, “LaunchMind is still refining the
wording. Your current visual is unchanged.” No new version or render job was
created. Image calls: 0; pixel critiques: 0; recompositions: 0; semantic
regenerations: 0. No candidate or final artifact exists to inspect. Owner UI was
inspected and shows this alternative creative as not created. No second owner
action or provider generation followed. Do not infer semantic visual quality from
focused tests or saved prompt text. The next real proof requires eligible complete
copy with available render budget through normal governance.

Focused validation: 66 tests passed across scene plan, composition, layouts,
repair loop, visual semantics and pixel critique; backend typecheck and scoped
production-file lint passed. Full findings and exact changed-file paths are in
`artifacts/visual-semantics/REPORT.md`. Morning Brief, Content Intelligence/Studio
UX, navigation, migrations, governance thresholds, publishing and Marketing
Memory were untouched.

## Core creative loop — 2026-09-05 follow-up (workflow proof failed)

The current imagery route is Replicate `black-forest-labs/flux-schnell` (DRAFT);
copy and pixel critique use Anthropic `claude-sonnet-4-6`, verified against audit
rows. PRODUCTION is configured as `black-forest-labs/flux-1.1-pro` but was not
selected. Verdict BENCHMARK; no model switch or extra provider benchmark occurred.
Details: `artifacts/core-creative-loop/MODELS.md`.

A later, distinct owner regeneration created original artifact version 6 at
22:19:51Z as REWRITE_REQUIRED: the existing route persisted its exhausted rejected
candidate. This is not the earlier alternative-artifact visual 422, which created
no version. Version-6 stored governance rejected a CTA declaration and an
ARTIFACT-level outcome declaration. Three-signal/capability governance is unchanged.

Scoped implementation now withholds failed AI copy candidates from current owner
versions, requires complete visual copy inside bounded repair, automatically
continues eligible META_AD regeneration through the authenticated visual route,
returns canonical owner states and prevents old-copy imagery from being current
for new copy. The UI shows one operation without redesign. Development visual
evidence includes raw backgrounds and exact governed copy. There are 58 passing
focused tests; frontend/backend typechecks and changed-file lint pass.

The one authorized Regenerate Copy owner action at 23:13:06Z targeted existing
eligible alternative `72d53a16-aec7-44c7-a269-411d438a1d48`, version 1, with zero
image-attempt history. It exhausted two copy repairs and returned HTTP 200,
LAUNCHMIND_CAN_REPAIR, for channel-field validity. No new version/job or image was
created. This remains a WORKFLOW FAILURE, not a visual-quality FAIL. No image
pixels exist to inspect and the core outcome is not proven.

After that failure, exact measured field-limit feedback (excluding advisory
truncation warnings) and private rejected-copy diagnostics were added and tested.
The user explicitly authorized one additional bounded owner action, which completed
with the same upstream workflow failure. Three retained copy candidates had
description lengths 31, 32 and 31 against the unchanged 30-character limit. The
final candidate also exceeded the CTA limit, despite passing claim governance.
Exact measured repair feedback was present but did not make the model comply.
Version 1 remains unchanged; no render jobs or image calls occurred. There is no
creative to inspect or publish. Both authorized owner actions are exhausted; no
further owner action was run. This is not a visual-quality FAIL.

The additional evidence is archived under
`artifacts/core-creative-loop/additional/`, including all rejected copy diagnostics.
The owner screenshot was directly inspected and shows existing copy / creative
not created. Browser preflight encountered an unrelated Morning Brief dev client
manifest error; direct login to Content Studio avoided it without changing the
frozen surface or launcher. The initial automatic approval rejection was resolved
by explicit authorization evidence and is not an outstanding blocker.

Full evidence and exact application/test file list:
`artifacts/core-creative-loop/STATUS.md`. Morning Brief, navigation, models,
composition families, governance thresholds and migrations remain untouched.

## Copy field fitting — 2026-09-05 (image-generation checkpoint passed)

The follow-up task added scoped META_AD visual-copy field fitting. Existing
lengths, claim/capability governance and model configuration are unchanged.
Initial generation and field proposals share the same full evaluator. Only
failing fields are normalized or replaced; invalid CTA first tries bounded
neutral navigation labels through governance. One targeted call may return up to
five alternatives per failing field; application-measured lengths and renewed
governance select a valid candidate. Mechanical exhaustion does not trigger
another broad bundle rewrite. Semantic failures retain the prior two-repair bound.

56 focused tests pass (13 field-fitting, 9 workflow, 34 B3); backend typecheck
and scoped lint pass. Fixtures retain all three preceding failing payloads and
generator declarations. Failed candidates remain withheld from current copy.

The ONE authorized normal Regenerate Copy action at 23:32:34Z targeted
72d53a16-aec7-44c7-a269-411d438a1d48. Initial description was again 31/30. One
targeted call returned lengths 30,31,31,31,32; the 30-character governed option
was selected. Other fields were unchanged: primary 235/2200, headline 31/40, CTA
24/24. Two copy-generation calls, zero broad semantic rewrites; eligible version
2 became current and visual generation began automatically. No manual visual
request or second owner action occurred.

IMAGE GENERATION REACHED: YES. Render job 15ae743b-6a74-4024-b5c3-a1a69176bc98
used Flux Schnell DRAFT. Three provider calls, three pixel critiques, zero
layout-only recompositions, two semantic/background regenerations. All three
visual candidates failed. Direct raw/full/feed-size inspection found invented
prop lettering/implausible repair hardware, then weak repair recognition and
copy contrast over busy imagery. No owner visual asset was persisted. Final
state LAUNCHMIND_CAN_REPAIR (bounded visual failure), not READY_FOR_OWNER_REVIEW.
The copy-workflow checkpoint passed; WOULD PUBLISH: NO.

Full report, all image candidates/backgrounds and exact prompt/critique/call
evidence: artifacts/copy-field-fitting/REPORT.md. Morning Brief, navigation,
rendering code, visual families, critique thresholds, all model choices,
migrations, publishing and Marketing Memory remained untouched. No benchmark
ran. The task's one-owner-action allowance is exhausted; stop here.

## Controlled image model benchmark — 2026-09-05

Completed the separately authorized one-Schnell / one-Pro benchmark using existing
eligible AllignX Problem Recognition copy version 2, the exact retained initial
STALLED_PROJECT prompt, and frozen composition intent. No copy generation or
owner action occurred. Same request body/seed/aspect/PNG format; both raw outputs
1344×768, both composites 1024×1024 and previews 350px. The same confirmed brand
v8 logo and compositor reproduced the old candidate pixel-for-pixel, and both
new compositor manifests were equal. No semantic or layout retry was used.

Two image POSTs total (one/model), two Sonnet 4.6 critique calls. Both critiques
returned NEEDS_CREATIVE_REVISION. Direct raw/full/feed inspection found Pro
materially better: plausible separate hardware, a contextual hinge focal point,
and no invented lettering. Schnell fused/distorted hardware and generated a
screwdriver label; the critique incorrectly treated that label as authentic.
Both still lack the requested unmistakably unfinished doorway, so neither is
publishable. Full controls, nine-dimension score table, exact response metadata,
latencies, critique audit and image paths: artifacts/image-model-benchmark/REPORT.md.

Recommendation: SWITCH TO FLUX 1.1 PRO. The central DRAFT route in
backend/src/services/creative/creativeModelRouting.ts now selects
black-forest-labs/flux-1.1-pro. The existing adapter and PRODUCTION route are
unchanged. Five selected routing/cost tests and a direct DRAFT-route assertion
passed. No broad suite, model repair attempts or generation after the switch.
Image invoice cost was not returned; do not infer it from critique audit estimates.

Morning Brief, copy fitting/governance, UX/navigation, rendering/composition,
critique thresholds, migrations, publishing and Marketing Memory are untouched.
The benchmark's generation allowance is exhausted. A clean owner-flow proof using
the changed DRAFT selection remains a separate future task, not completed here.

## Robust Stalled Project owner proof — 2026-09-05 (FAIL)

Narrow art-direction change replaced hinge/recess dependence with two existing-
thesis patterns: UNFINISHED_WALL_PATCH and PAUSED_WALL_PAINT. The initial prompt
requires a large unfinished wall area and a few idle materials; semantic failure
switches patterns, then uses existing COORDINATION_FRICTION within the unchanged
three-attempt limit. scenePattern is retained in the existing prompt/diagnostics.
No compositor geometry, render service, copy, model or critique-threshold change.

26 focused tests passed (visual semantics 10, scene plan 9, repair loop 7).
DRAFT was verified as Flux 1.1 Pro. The preflight prompt matched the live first
prompt exactly. The ONE normal Content Studio visual-creation action reused
eligible AllignX artifact 72d53a16-aec7-44c7-a269-411d438a1d48 copy version 2,
verified unchanged afterward. No copy generation, version 3 or private-provider
proof occurred.

Render job c737388e-f3ed-45f4-b0fa-599ca27d9f27 failed after three Pro generations
and three pixel critiques; two semantic/background retries, zero layout-only
recompositions. Sequence: stalled wall patch → paused paint → coordination
friction with wall patch. All raw/full/feed pixels were inspected. The large
unfinished cue improved recognition, but the patch images resemble decorative
white panels rather than convincing repairs. The paint scene is more plausible
but did not qualify. Automated geometry descriptions sometimes overstate how
small the scene is; direct inspection's dominant blocker is photographic
credibility of the unfinished-work depiction. No failed candidate was promoted.

Final state LAUNCHMIND_CAN_REPAIR (bounded visual failure). WOULD PUBLISH: NO.
Full exact first prompt, candidate table, image paths, counts and changed-file
list: artifacts/publishable-problem/REPORT.md. Morning Brief and all frozen
surfaces are untouched. Stopped after the one owner flow, with no model change,
benchmark or additional generation. Further owner generation is not authorized
by this exhausted task allowance.


## Creative Director Pivot owner proof — 2026-09-06 UTC (bounded failure)

WAITING_FOR_HELP is now the default residential callback Problem Recognition
thesis. Literal-project metaphors remain representable only for bounded exhaustion:
two semantic/credibility failures pivot to the human waiting direction. Human
retries stay human-centered, seated first and standing after the second failure.
No compositor geometry, render service, copy, governance or model-routing change.

30 focused scene/semantics/repair tests passed. Exact preflight matched the first
live provider prompt, excluded retired repair terms, and DRAFT stayed Flux 1.1 Pro.
One normal Content Studio action reused unchanged eligible artifact
72d53a16-aec7-44c7-a269-411d438a1d48 copy version 2. Job
4d8347fd-e2fc-4de2-a891-5d21314fbf5a used three provider calls, three pixel critiques,
two background regenerations and zero layout-only recompositions. It began in
WAITING_FOR_HELP: zero in-job direction-family pivots, one seated-to-standing
execution change. No literal repair image was generated.

All raw/1024/350 candidates were inspected. The human waiting idea and photography
improved, but the final deterministic copy field overlaps the human subject,
obscuring emotion and degrading supporting-copy readability. This is the dominant
remaining visual blocker. Automated phone-screen claims were not substantiated by
direct inspection; visible white surfaces read as plain phone backs.

Final LAUNCHMIND_CAN_REPAIR, bounded failure; WOULD PUBLISH: NO. No rejected visual
was promoted. Complete prompt, candidate table, paths and exact changes are in
artifacts/creative-director-pivot/REPORT.md. Morning Brief and copy are untouched,
Pro retained. Stopped after the sole authorized action; no further generation.


## Subject-aware composition — 2026-09-06 UTC

The deterministic WAITING_FOR_HELP compositor now protects an intent-derived right
human envelope with padding, measures headline/support/CTA as one left-side group,
and uses localized translucent contrast backing. It preserves source aspect ratio
instead of raising/cropping the photo behind an 87%-wide text block. Intersections
are rejected before final rasterization. This is conservative intent protection,
not face detection; pixel critique still gates provider placement deviations.
Layout-only face/text overlap now reuses the photograph unless an actual semantic
or photographic failure is also present. Visual thesis/art direction unchanged.

The saved previous Attempt 3 was recomposed with ZERO provider calls and identical
raw bytes. Direct 1024/350 inspection: WOULD PUBLISH RECOMPOSED ATTEMPT 3 YES.
Before/after and side-by-side proof: artifacts/subject-aware-composition/REPORT.md.
13 focused tests pass (human composition 5, render repair loop 8), including
one-provider/two-critique layout-only repair. No broad suite.

After that checkpoint, one normal owner action reused unchanged eligible artifact
72d53a16-aec7-44c7-a269-411d438a1d48 copy version 2. Job
960bcd1b-372d-4b6a-bf7b-cdeb7691bad3 used Flux 1.1 Pro: 3 provider calls, 3 visual
attempts, 3 critiques, 0 layout-only recompositions and 2 semantic regenerations.
All new raw/full/feed candidates were inspected. Faces remain clear and support
readable, but all three new photographs omit the home-project context cue. The
critique also objects to CTA wrapping/split styling. No failed candidate promoted.
Final owner state LAUNCHMIND_CAN_REPAIR; WOULD PUBLISH new owner run NO.

Morning Brief, copy version 2, model routing, visual thesis, governance, Studio UX
and Content Intelligence untouched. The raw replay pass is not a persisted owner
approval. Stopped after the one authorized owner action with no further generation.


## Minimum intelligence → opportunity → content planning — 2026-09-06 UTC

Added evidence-first opportunity planning on ProductContentContext and existing
issued evidence/memory/pattern reads. Explicit owner-confirmed catalog services
are supported; absent catalog falls back to the known product without invented
categories. Missing demand/performance/capacity/momentum/fatigue factors are null.
No LLM chooses the initial opportunity. The Content Intelligence read model now
shows selected normalized opportunity, explanation, evidence, missing signals and
three shared-identity concept briefs; existing saved production direction remains
separate. Existing opportunity prompt receives the selected grounded brief.

Real AllignX browser proof selected the known home-services app and post-request
customer reachability education, based on the owner's reported contact gap and
20 bookings/month goal. Audience remains the confirmed professionals/entrepreneurs
seeking efficiency; US is positioning, not verified coverage. Landing-page
education is a first-test channel, not measured performance. No eligible current
market evidence, campaign metrics, service catalog or relevant creative pattern
was available in this scoped context. Retrieved memory records goal/audience,
not creative outcomes. Confidence explicitly LIMITED. Concepts: problem recognition,
product explanation, customer education; no invented availability feature.

41 focused tests passed (groundedOpportunity 7, contentOpportunity 34). Actual
Content Intelligence HTTP 200, correct identity, rendered recommendation inspected,
zero API/browser failures and zero production requests. Full map, exact recommendation,
concepts, screenshot and changed files: artifacts/intelligence-content-loop/REPORT.md.
No images, FLUX, video, campaign execution, publishing or Marketing Memory writes.
This completes the minimum read-only planning/grounded-brief path, not a new
production campaign or 3.7 learning implementation. Morning Brief untouched.


## Minimum real-signal foundation — 2026-09-06 UTC (Outcome B)

Live AllignX website discovery found 14 explicit service headings. Saved them only
as DISCOVERED_UNCONFIRMED in products.scraped_meta.catalogDiscovery with source and
observation time. No service/coverage confirmation or Marketing Memory write.
The site has broad location links but FAQ says Arizona; neither became confirmed
fulfillment truth. National product positioning is not service coverage.

Added a bounded catalog confirmation path using existing product confirmed context,
actor/time/version and optimistic concurrency. Content Intelligence now requests
service and per-service area confirmation instead of substituting a generic app
recommendation. All real proof checkboxes remained unchecked. Zero eligible service
candidates, no selected opportunity or A/B/C briefs; confidence LIMITED.

Existing scoped B7 reads returned no connections or owned signals (including
unmapped workspace rows); zero MI resolutions. Eight creative observations have
no public engagement; eight structural patterns do not establish performance
learning. No performance-backed Creative Intelligence is available yet.

One request-scoped SEARCH_DEMAND adapter under existing MI uses SerpApi Google
Trends with external authority, query/service/geography/window/fetched-time/hash,
freshness and limitations. No new store/migration/crawler. SHADOW mode and absent
SERPAPI_API_KEY mean live demand is unavailable. Fixtures are test-only and excluded
from real applicability. No live demand call or creative generation occurred.
Existing ranking consumes applicable demand but still rejects cross-scope/geography,
stale and fixture signals; product-wide metrics are not service-level conversion.

17 focused catalog/signal/ranking tests passed. Actual Content Intelligence owner
flow inspected: HTTP 200, correct product, substantive insufficient-evidence state,
14 unchecked discovered offerings, zero API/browser failures/production requests.
Full sources, exact files, constraints and screenshots: artifacts/real-signal-foundation/REPORT.md.
Morning Brief, creative production, publishing and full 3.7 remain untouched.
Stopped at the explicitly valid Outcome B, with no invented winner or new roadmap.

## Service confirmation → opportunity ranking — 2026-09-06 UTC

READY FOR OWNER CONFIRMATION on /dashboard/intelligence/content. Shared service
areas and per-service overrides added; blanks stay unknown. Confirmation retains
server-held discovery provenance, actor/time/version and existing bounded history.
Only confirmed services become candidates. Tied/insufficient evidence now returns
no selected winner or A/B/C briefs; candidates expose missing dimensions. Save
refreshes the same page; catalog remains editable after confirmation.

Real AllignX GET/browser proof: HTTP 200, 14 unchecked discoveries, zero confirmed
services/areas, no live demand or attributable campaign data, no performance-backed
creative learning. No real confirmation submitted: owner selection explicitly
required. Intercepted browser save/refresh test passed, as did 19 focused backend
tests. No creative/content generation or Marketing Memory writes.

Runtime discrepancy: port 3000 demo frontend stalled; isolated 3002 had backend
origin restriction. Restarted managed 3000 in its original demo mode, then proved
the page successfully. Morning Brief configuration/UI unchanged. Full evidence,
screenshot paths, exact files and limits: artifacts/service-confirmation-ranking/REPORT.md.

## Content Intelligence owner-input UX — 2026-09-06 UTC

Reused the already-present service confirmation/ranking foundation. Replaced the
technical disclosure-first state with a primary Confirm services owner-action
card and focused compact inline panel. Shared area, explicit unknown choice,
optional exceptions, client field validation, typed server errors, current-context
version requirement and retained selections on errors. Save closes automatically
and refreshes; confirmed catalog reduces to count/Edit. Missing signals are concise
and detailed provenance secondary. Historical content retains its separate label.

Live AllignX proof remains 14 discovered/0 confirmed; no geography, live demand,
attributable campaign data or performance-backed creative learning. No real
confirmation submitted. 25 backend + 2 frontend focused tests passed; browser
proved actual input state and isolated save/error/close/refresh interactions.

Historical confirm failure's exact payload was unavailable. Verified old client
accepted API-invalid area lengths and hid every server error; reproduced the live
400 field-validation path with a guaranteed-invalid synthetic one-character area.
Current product lookup and null-context CAS read predicate succeed. Do not claim
this proves the original owner's area value/cause. Real successful persistence
remains pending owner selection. No generation, execution or Memory writes.
Report, exact files and screenshots: artifacts/owner-input-ux/REPORT.md.

## Service UX and search-demand readiness — 2026-09-06 UTC

Owner runtime now confirms 7 services at catalog version 1 (05:39:21 UTC): House
Cleaning, Electrical, HVAC & AC Repair, Handyman, Plumbing, Makeup Artist, Pool
Cleaning & Maintenance. All share a comma-split narrative about focusing on Phoenix;
it is not a normalized provider geography. No catalog write or geography inference.

Removed redundant Apply control; shared area defaults correctly on edit. Renamed
unknown choice in owner language. Evidence summary omits raw statuses/URLs; concise
seven-row candidate comparison. Outcome B: NEEDS CONFIGURATION plus clearer-area
and comparison-size constraints. Runtime SerpApi key absent; actual mode SHADOW.
(The standalone probe's initial OFF fallback was corrected to the real resolver.)
Existing provider supports at most 5 queries; no single comparable request for all
7. No provider call, fixtures, subset comparison or invented winner. Keep SerpApi;
complete-set preflight and transparent proposed queries added, existing ranking
weights unchanged. All seven candidates tied, no selected opportunity/A/B/C briefs.

24 backend + 2 frontend focused tests passed. One real browser proof: correct
AllignX identity, HTTP 200, no browser/API errors or POSTs; screenshots inspected.
No generation, execution, B7 changes or 3.7 learning. Configuration, exact saved
area text, proposed queries, files and mapping: artifacts/search-demand-readiness/REPORT.md.

## Structured service geography — 2026-09-06 UTC

Fixed comma-split narrative geography at the Content Intelligence input/API boundary.
Structured city/metro, state/province and country; provider geography derived server-side
and kept separate. Explicit Phoenix/Arizona/US confirmation maps to state US-AZ with
Arizona-level scope disclosure, never Phoenix-only or nationwide demand. No defaults
inferred from existing prose. Unknown explicit; local mappings outside US remain limited.

Scoped CAS migrated the actual 7-service catalog version 1→2: geography marked
NEEDS_RECONFIRMATION, original five narrative strings and owner/service provenance
unchanged, version 1 retained in history, SYSTEM geography-review annotation separate
from owner confirmation. No real area confirmed. Live provider geography none; key
absent, mode SHADOW. Owner NEEDS_OWNER_INPUT and admin NEEDS_CONFIGURATION separate.

Seven-service comparison remains explicitly fail-closed. No direct seven-query provider
mode; anchor batching evaluated but no validated stability/uncertainty bounds, so not
implemented. Credentials/area alone do not fix that limitation. Complete response/group
coverage now required by adapter/ranking; zero calls, no subset or fixture ranking.

37 focused tests passed. Real AllignX HTTP 200, three screenshots inspected, no browser/API
errors. Intercepted browser save proved structured validation, panel closure, one refresh
and removal of the area action while preserving seven services. Real read afterward
still version 2/reconfirmation status. No creative, execution or Memory writes.
Report, math assessment, limits and exact files: artifacts/service-geography/REPORT.md.

## Demand tournament selection — 2026-09-06 UTC

READY FOR DEMAND CONFIGURATION. Actual AllignX catalog now version 3 with all seven
services owner-confirmed for Phoenix, Arizona, United States; provider scope US-AZ,
explicitly Arizona-level rather than Phoenix-only demand. No catalog/geography edits.
Live SerpApi credential absent, MI SHADOW: zero provider requests and no real winner.

Implemented bounded tournament on existing adapter: stable service-ID first five,
then their winner plus remaining two. One explicit recent 90-day window (current
plan Jun 8–Sep 5), identical geography/date grids. Stage-local mean interest only;
no cross-batch arithmetic/anchor calibration/global seven-service numeric index.
Complete, fresh, non-sparse, clear winners required; second-stage failure yields no
final winner/briefs. Quality thresholds and sampling limitations are documented.
Group lineage/provenance revalidated at ranking; six-hour process cache coalesces
reads to the bounded pair, including failures. Generic consumer query contract v2
is transparent (electrician/plumber etc.); narrowed AC/pool-cleaning intent explicit.

Existing groundedOpportunity consumes valid final demand evidence without changing
owner-priority weights; confidence LIMITED, missing conversion/capacity/learning
explicit. Shared A/B/C planning context includes demand evidence/market moment;
no LLM production calls. Upper comparison UI shows advancement/outcome, values only
within separately labeled stage tables. Current real UI remains unavailable/no winner.

26 backend + 3 focused presentation tests pass. Actual browser HTTP 200, correct
identity/geography, no browser/API errors or POSTs; screenshots inspected. No copy,
FLUX, Studio production, campaign execution or Marketing Memory writes.

Existing Content Direction / Created From This Direction and historical concepts
remain LEGACY / PRE-GROUNDED INTELLIGENCE PRESENTATION. Do not redesign/delete until
a real grounded recommendation succeeds; then align current opportunity → why now
→ A/B/C → prior work as history. No lower-section redesign in this task.
Exact configuration, groups/queries, limits, screenshots and files:
artifacts/demand-tournament/REPORT.md.

## First live demand verification — 2026-09-06 UTC

Owner supplied SerpApi credential in root .env.local. Restarted backend; live
read model confirms configured YES / ACTIVE, seven confirmed Phoenix/Arizona/US
services, provider US-AZ. One real SerpApi request returned HTTP 200 with all five
Stage-1 queries and 90 daily samples for Jun 8–Sep 5. Makeup Artist and Pool
Cleaning each have only 14/90 nonzero samples, below the existing 50% per-service
coverage gate. Tournament FAILED closed; Stage 2 not called, no selected grounded
opportunity or A/B/C. No gates weakened and no retry/query substitution.

Real owner browser: HTTP 200, correct identity, no API/browser errors or POSTs.
Upper page honestly remains market demand unavailable; evidence wording currently
says “not connected or unavailable” even though provider is now connected. Lower
legacy presentation unchanged. No creative or Memory writes.

Backend is running with temporary .tmp/demand-live-guard.cjs preload, enforcing a
maximum of two SerpApi requests across this verification using a local request
ledger; one consumed. This is a verification guard, not durable product budgeting.
It is not part of the normal npm launcher configuration. Cached failed result
lasts six hours in this backend process. No additional refresh authorized here.
Evidence, screenshots and diagnostic request/response subset (no credentials):
artifacts/demand-live/REPORT.md.

## First real market-driven recommendation — 2026-09-06 UTC

Corrected sparsity semantics: the prior response had 90 complete daily values for
every query. Removed only the per-loser 50% nonzero gate; winner mean >=5, >=80%
nonzero and clear lead remain. Missing/malformed/scope/window/provenance checks
unchanged. Queries and seven-service stable-ID grouping unchanged.

Normal owner read path, SerpApi configured / ACTIVE, Phoenix owner area / US-AZ
demand scope: exactly two new HTTP 200 requests. Plumbing won Stage 1 and Stage 2.
Existing groundedOpportunity selects Plumbing, LIMITED, stable trend, opportunity
planning-f2e1386d1d688406fe81. No conversion/capacity/performance claims. Three
existing planning structures A/B/C share opportunity and evidence; no production.

Content Intelligence now leads with Current opportunity → Recommended concepts →
service comparison/evidence → collapsed Previous work. Calling-around direction
and six prior generated concepts preserved with historical labels and review
links. No lower-page work remains under the previous deferred alignment instruction
for this scope. 17 focused backend + 5 frontend tests pass; actual browser HTTP
200, correct identity, no errors or POSTs, screenshots inspected.

Real lineage is in existing process cache and artifacts/demand-grounded/owner-proof.json;
no new durable store or Marketing Memory write. Temporary verification preload
now uses artifacts/demand-grounded/provider.json; two-call allowance exhausted.
Normal launcher does not include that guard. Process cache expires after six hours;
future runtime refresh/budget persistence remains separate work.
Report: artifacts/demand-grounded/REPORT.md. No creative or execution performed.

## Actionable planning concepts / conditional history — 2026-09-06 UTC

Content Intelligence retains cached Plumbing opportunity and unchanged demand
selection. A/B/C now show Idea, Why test it, Approach and explicit disabled Create
this concept actions. Detailed grounding collapsed; concept comparison adds job,
why test, landing-page hypothesis and risk. No recommended-first invented: current
planning policy supplies no supported preference.

Pure groundedConceptPlanning handoff builder preserves scoped opportunity/service,
concept, evidence, memory context, product truth, constraints and full brief. It
rejects mismatched lineage; prepared only, productionAuthorized false, requires
server capability/scope revalidation. No safe existing grounded draft-only route,
so no creation/persistence/provider calls performed.

Previous Work only renders for actual prior direction/content/history counts when
a current opportunity exists. AllignX history stays collapsed and neutral about
success/failure; first-time owner has no history section or placeholder. Existing
records/lineage/review routes and Memory governance unchanged. 9 focused tests pass;
real AllignX HTTP 200 and isolated first-time browser state verified, screenshots
inspected. Prior provider ledger unchanged at two requests.
Report and exact prepared payloads: artifacts/actionable-concepts/REPORT.md.

## Concept recommendation, override and Studio planning — 2026-09-06 UTC

Shared bounded concept-fit-v1 selects B Product Demonstration for the existing
landing-page explanation and supported product description. Demand is not a
creative-family selection input; performanceBacked false. Default B with 3 reasons,
selectable A/C, neutral override and one enabled primary CTA. Plumbing opportunity
planning-f2e1386d1d688406fe81, confidence and demand lineage unchanged.

POST /studio/governed/planning accepts only product/opportunity/concept IDs. Server
resolves current context/catalog, validates fingerprint, existing demand freshness
and provenance, current opportunity and concept lineage. Full handoff and decision
persist in existing content_assets as held/GOVERNED_CONTENT_INTELLIGENCE/DRAFT,
structured PLANNED; no copy/image/model tokens. Original serialized snapshot is
server-HMAC signed to survive JSONB key reordering without breaking demand hashes.
Signed stored evidence allows process-restart reuse without provider refresh.
No demand adapter/tournament rule edits or new ranking/generation engine.

One-time local recovery of genuine prior read-model evidence, validated against
current context, seeded B draft 2b190e64-1592-4227-9f87-3a56b6e96f73. Real browser
C override created aa8b1817-bd23-4593-a1e1-800b3f527d77; repeat checks reused it.
Studio route /dashboard/content?planning=<id> shows the selected planning context,
not generated content. Future production still needs server revalidation and
existing generation orchestration; no generation authorization from planning.

5 backend + 9 frontend focused tests pass. Real override→201→Studio, old-opportunity
409, first-time no-history fixture, returning collapsed history, no final browser/API
errors. Provider calls zero, previous SerpApi ledger remains two. Managed frontend
restarted in existing demo mode after route stalls; no Morning Brief UI changes.
Normal test Supabase authentication used; no auth implementation changes.

Stale stored planning context fails closed; automatic demand renewal was not added.
No performance learning, Memory writes, campaigns, publishing or production.
Full report/screenshots/payloads: artifacts/concept-handoff/REPORT.md.

## Concept choice polish and handoff verification — 2026-09-06

Plumbing and concept-fit-v1 recommendation B remain unchanged. Explicit accessible
“Choose this instead” buttons replace subtle radios; selected card shows ✓ Selected.
After override, B keeps neutral LaunchMind recommendation. One primary CTA retains
default/override labels. Per-card grounding disclosures replaced by one shared
“What these concepts are based on”; Compare concepts remains collapsed.

Studio now explicitly names recommended and selected families. Normal AllignX C
override → planning POST 201 → Studio verified, reusing existing C planning item;
no production/provider calls or policy, Memory, demand or ranking changes. Prior
provider ledger remains two. Returning history collapsed; isolated first-time
fixture has no history section. Nine focused frontend tests pass. Final browser
proof has no errors. Initial stale Next 404 resolved by restarting managed frontend
in the same existing mode; no Morning Brief change.

Report and screenshots: artifacts/concept-choice-polish/REPORT.md.

## Production brief presentation / preparation boundary — 2026-09-06

B planning item 2b190e64-1592-4227-9f87-3a56b6e96f73 now shows an owner-facing
Plumbing / Product demonstration landing-page production brief: message, audience,
Phoenix service area with Arizona demand scope, goal and Change direction link.
Duplicate shared grounding removed from Content Intelligence; data unchanged.
Studio index lists both stored Plumbing briefs before prior work and excludes
planning rows from generated-copy queues. Historical content untouched.

Generation NOT connected: button disabled with truthful availability explanation.
Existing production requires saved opportunity/campaign/strategy/brief lineage;
this grounded planning ID has no such binding. Do not reuse historical IDs.
New read-only production-contract boundary resolves scoped server-held plan,
verifies signed evidence/current ranker context and rebuilds current capability
contract; preserves full handoff and owner decision. No generator invoked, no
production write or new pipeline. Adapter to existing production still required.
This is not a ready-to-generate or end-to-end production completion.

16 focused tests passed. Real B brief, preparation endpoint, Change direction and
Studio index browser check passed with no final browser/API errors. No provider
calls; prior SerpApi ledger remains two. Managed frontend restarted same mode for
stale Next 404. Report/screenshots: artifacts/production-brief/REPORT.md.

## Planning → persisted production enabled — 2026-09-06

Current accepted B Plumbing plan 2b190e64-1592-4227-9f87-3a56b6e96f73 now
resolves real existing production entities: saved opportunity
d386a15d-56e6-4118-85d8-fdd6bd71a0ba, campaign
f1819238-a3aa-435f-93a8-e47787f56627, strategy
16546675-59c5-4c7b-942b-91db2dc94dab, brief
2010f652-01f1-4da7-a4e0-b9b7fa7619b2. Grounded opportunity remains
planning-f2e1386d1d688406fe81. No historical IDs reused. Existing writers reused
with reserved insert-once UUIDs, timestamp CAS and signed canonical binding;
partial retries/concurrent opens are idempotent. Real repeat counts 1/1/1/1.

Preparation validates signature/context/ranking/scope/concept/capabilities and
production parents. Generation is now enabled, wired by planning ID to the
existing governed artifact route with repeated current-plan validation. Current
format stays landing-page copy. NO GENERATION EXECUTED: copy/image/video zero.
No Memory learning, approval, publishing or campaign execution.

Content Intelligence detects current valid brief → Production brief created /
Open in Content Studio, with overrides still available. Studio normal navigation
leads with current B Ready to create; other valid briefs are secondary. Custom
32px production title removed in favor of existing T.pageTitle.

C aa8b1817-bd23-4593-a1e1-800b3f527d77 exactly matched automated override proof
and had no generated content/lineage. Archived via existing route at
2026-09-06T21:22:38.451+00:00; reversible, no genuine history removed.

23 focused tests pass; real browser final PASS at 1440×900, no errors, enabled
Generate untouched. Broader typechecks still report unrelated existing demand
literal types / benchmark imports / DemandComparison nullability; untouched.
Prior generation blocker resolved. Next authorized run may exercise production;
provider output quality has not been tested in this task. Full report and exact
lineage/screenshots: artifacts/planning-production/REPORT.md.
