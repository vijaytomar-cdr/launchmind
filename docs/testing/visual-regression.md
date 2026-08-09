# Visual regression — how to establish and run it

**Current status: BLOCKED.** No approved baseline PNGs exist in the repository, and
until they do, visual regression cannot pass — a first run only *creates* baselines,
which is not a comparison. This document exists so that the moment the prerequisites
are met, one documented command produces baselines and a second command regresses
against them.

## What already passes without any of this

Design-token parity against the approved UX HTML is checked on every PR and needs no
browser, server, or credentials:

```bash
node scripts/check-design-tokens.mjs      # 23/23 tokens, exits non-zero on drift
```

A screenshot diff cannot tell you that `--sage` changed by one hex digit across forty
components. That check can, and it names the token.

## Prerequisites for screenshot baselines

| Requirement | Why |
|---|---|
| `TEST_EMAIL` / `TEST_PASSWORD` | Every screenshot spec is behind auth; without them the specs skip |
| A running frontend | Baselines must come from a **production** build (`next build` + `next start`), not `next dev` — dev injects overlays and different CSS delivery |
| A seeded environment | Connected-source cards cannot be photographed if no source is connected. This needs at least one provider credential |

The third is the real blocker: nine of the screenshot specs photograph
*connected* provider cards, and no provider has ever completed a sync in this
environment.

## Establishing baselines (once, deliberately)

Baselines are an **approval action**, not a build step. Whoever runs this is
asserting "this is what the product should look like".

```bash
# 1. Build and serve a production frontend on a port that is definitely free.
npm run build
npx next start -p 3111

# 2. In another shell — create the baselines.
export TEST_EMAIL='...' TEST_PASSWORD='...'
PLAYWRIGHT_BASE_URL=http://localhost:3111 npm run test:visual:update

# 3. Review every generated PNG by eye, then commit them.
git add tests/e2e/**/*-snapshots/
```

Do not commit baselines produced from `next dev`, and do not commit a baseline for a
screen you have not looked at.

## Running the regression afterwards

```bash
npx next start -p 3111
export TEST_EMAIL='...' TEST_PASSWORD='...'
PLAYWRIGHT_BASE_URL=http://localhost:3111 npm run test:visual
```

`npm run test:visual` compares against the committed PNGs and fails on a diff above
`maxDiffPixelRatio: 0.01`.

## Why `PLAYWRIGHT_BASE_URL` matters

`playwright.config.ts` defaults to `http://localhost:3000`, which is usually a dev
server. Pointing a visual run at a dev server produces baselines that will never
reproduce. Always target the production server explicitly.

## Definition of done for this item

Visual regression may be reported as PASS only when **both** hold:

1. Approved baseline PNGs are committed.
2. A **second** run against those baselines passes.

Until then it is BLOCKED, and reporting it any other way would be fabricating a
result.
