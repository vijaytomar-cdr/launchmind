# AGENTS.md — LaunchMind operating contract

Read this file and `LAUNCHMIND_CURRENT_STATE.md` before substantial work. Use
`CLAUDE.md` for deeper architecture and data-model reference. When evidence differs,
prefer current repository/runtime truth, then this contract, then the state
checkpoint. Record meaningful discrepancies instead of silently rewriting history.

## Product philosophy

LaunchMind is an **AI CMO / AI Growth Operating System**.

- Homepage: **Meet Your AI CMO**
- Onboarding: **Teach Your AI CMO**
- Product: **Work with Your AI CMO**
- Principle: **Discover first. Confirm second. Learn continuously.**

LaunchMind should do the homework, ask the owner only for decisions or truth it
cannot supply, and learn from governed evidence. It must never silently publish,
schedule, spend, or execute an action requiring owner authorization.

## Outcome standard

Judge work by the requested owner-visible outcome, not code volume, test count, or
pipeline completion. A technically successful weak result is a failure.

For creative generation, the normal path is **one generation → bounded internal
refinement when needed → ship-ready owner-visible creative**. The first visible
artifact needs a strong hook and hierarchy, intentional composition, feed-size
readability, brand-appropriate execution, authentic product imagery where
appropriate, purposeful product/screenshot role, visual tension, structural
distinction from recent work, governed claims, and factual safety. If LaunchMind
judges its candidate deficient, it repairs it before presentation. The owner is not
the retry mechanism.

Generation success, an image row, passing tests, a completed critique, or several
candidates do not prove creative quality. Inspect the artifact itself.

## Scope and validation

- Work only on requested screens and services.
- Preserve frozen product decisions; avoid unrelated refactors and audits.
- Investigate migrations only when the requested change depends on them.
- Prefer focused tests, one real owner workflow, and visual inspection for UX or
  creative work; then stop.
- Before UX assertions, prove network health, substantive content, and expected
  owner/product identity. A blank or error page cannot pass.
- Do not broaden a task into another phase, video, execution, autonomy, or
  migration work.

## Owner-state semantics

- `READY_FOR_OWNER_REVIEW`: LaunchMind completed its work and the owner can judge
  the artifact.
- `LAUNCHMIND_CAN_REPAIR`: a system-repairable problem; communicate **LaunchMind is
  refining this** and repair internally.
- `NEEDS_OWNER_INPUT`: a real owner decision, confirmation, or missing truth.

A repairable LaunchMind problem must not be presented as owner work. Copy
eligibility must not imply its dependent visual is ready.

## Creative orchestration

Preserve **concept → governance → safe copy → visual execution → scene plan →
render → actual-pixel critique → bounded internal refinement → owner review**.

Actual rendered pixels, not metadata alone, determine visual readiness. Failed
internal candidates do not become owner-visible versions. Historical repetition
checks should consider qualified completed creative, not failed experiments.

## Governance boundaries

- Claim discovery is the conservative union of generator declaration,
  deterministic detection, and semantic detection. Never use majority vote.
- Frozen claim contract: `THREE_SIGNAL_CONTRACT_HASH_V2 = 1856b72c0ba0ca7a`.
- Product capability claims must be supported by the server-held capability
  contract. Post-generation validation is authoritative; never weaken it to make
  generation pass.
- Narrative framing cannot launder unsupported capabilities, outcomes, guarantees,
  metrics, customer counts, or fabricated customer experiences.
- Creative Intelligence may shape structure but cannot create product truth,
  evidence, performance proof, or Marketing Memory.
- An image provider may create a wordless background. When authentic product
  representation is required, deterministically composite owner-authorized
  screenshots, confirmed logos, and governed text. Never ask an image model to
  redraw an authorized product screenshot or UI.
- Content approval, creative approval, and execution authorization are separate.
  Neither approval implies publishing, scheduling, launching, sending, or spend.
- Content creation, editing, approval, rendering, and ordinary persistence must
  not silently write Marketing Memory.
- Preserve workspace isolation and provider authority boundaries.

## Frozen product surfaces

**Morning Brief** is the command/orientation surface. Treat its approved information
architecture as frozen. Do not redesign it unless explicitly requested or a
verified regression requires restoration. Runtime/demo discrepancies belong in the
checkpoint.

**Content Intelligence** is the decision surface: recommended opportunity, why now,
audience, format, creative direction, brand tone, created concepts, state, and
review route. Preserve the simplified recommendation experience. It is not an
editor.

**Content Studio** reviews, edits, compares, and approves what LaunchMind already
created. It must not force the owner to repeat upstream strategy decisions, and it
is not an execution surface. Video production is intentionally unavailable in the
current development environment unless current repository/runtime evidence proves
that decision changed.

## Canonical navigation

- COMMAND: Morning Brief, Opportunities, Approvals, Missions
- CREATE: Content Intelligence, Content Studio
- EXECUTION: Campaigns, Calendar, Experiments
- INTELLIGENCE: Growth Brain, Improve Intelligence, Market Intelligence,
  Marketing Memory, Knowledge Graph
- SYSTEM: Launch Readiness, Settings

## Supported commands

Run frontend commands from the repository root and backend commands from
`backend/` (or use the root wrappers).

```bash
npm run typecheck
npm run typecheck:backend
npm run lint
npm run lint:backend
npm run build
npm run build:backend
npm run test
npm run test:backend
npm --prefix backend run test:unit
npm run test:e2e
npm run test:visual
```

`npm run verify` is the broad CI-equivalent check; do not run it by default for a
focused task. Real-Postgres constraint tests use the dedicated local test database;
never point destructive setup at a hosted database.

Use `npm run dev` for truthful real-workspace state and
`npm run dev:morning-brief-demo` for the labeled, production-refused Morning Brief
fixture. Use managed launchers rather than invoking `next dev` directly. Never run
`next build` against the same `.next` directory while development is running.

Migrations are additive and idempotent. Remote migration execution is deliberate,
never routine.
