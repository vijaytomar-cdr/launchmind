# Environment Contract — frozen 2026-08-17

Three modes. There is no fourth, and no new hosted or paid environment is
introduced by this contract.

The rule that generates all of it: **normal development and certification have
opposite requirements, and the mistake is to apply one's rules to the other.**
Development needs real data to be useful. Certification needs isolation to be
meaningful. Neither is a defect of the other.

---

## A. LOCAL_REAL_DEVELOPMENT

**Purpose** — normal development, and real-account testing the user explicitly
asks for.

| | |
|---|---|
| Frontend / backend | run locally (`npm run dev`, `npm --prefix backend run dev`) |
| Secrets | `.env.local` |
| Supabase | **may point at the real hosted project. This is intended.** |
| Owner data | may be read, and modified when the requested task requires it |

`.env.local` resolving to hosted Supabase is **not** an architecture defect, and
nothing in this repository may refuse it. A previous pass reported it as a
finding; that reading is withdrawn here.

**This mode is not certification.** No result produced in it may be described as
certified, and no measurement taken in it may be reported as isolated.

### Morning Brief connected-state fixture

Use these explicit frontend commands:

```bash
# REAL DEVELOPMENT — real workspace state; unavailable performance stays unavailable
npm run dev

# MORNING BRIEF CONNECTED DEMO — clearly labeled seeded performance
npm run dev:morning-brief-demo
```

The demo command enables a presentation-only AllignX performance fixture for
local UX review. Its values are seeded development data, not observed AllignX
performance. The flag is scoped to that command, remains default-off, is not
written to `.env.local`, and the server shell refuses it whenever
`NODE_ENV=production`. Precedence is fixed in
`lib/morning-brief/viewModel.ts`: real `/owner/brief` performance wins, then the
explicit development fixture, then the honest unavailable state.

The values live only in `lib/morning-brief/demoFixture.ts`. They are not sent to
the backend, persisted, written to Marketing Memory, treated as evidence, or
supplied to Growth Brain. Provider-backed booking, analytics, acquisition, and
experiment values replace the fixture by populating `BriefResponse.metrics` and
extending the REAL branch of the same normalized view model; the Morning Brief
components do not need a second redesign.

### Local frontend process contract

Both frontend commands are single-instance managed launchers. They atomically
claim a PID lock under `.tmp/`, verify that any existing lock still belongs to a
live LaunchMind launcher, refuse an occupied port, and remove their own lock on a
clean SIGINT/SIGTERM shutdown. A stale lock is removed without terminating any
process. The launcher always passes port 3000 explicitly, so Next.js cannot drift
to another port and share `.next` with the primary server.

For an intentional second frontend use:

```bash
npm run dev:isolated
```

That command uses port 3002 and the supported `next.config.js` `distDir` override
`.next-dev-3002`. The invariant is mechanical: two live dev instances never write
the same build directory. Local backend CORS must explicitly match the alternate
origin before authenticated API work on that instance can count as healthy.

Runtime locks, isolated build output, and preserved `.next.runtime-*` diagnostic
directories are gitignored. If a blank or unstyled shell appears, check for a
duplicate frontend and missing `/_next/static/` chunks before changing product
source. Recover by stopping the managed frontend, clearing only disposable Next.js
output when necessary, and restarting with the same explicit real/demo command.
The staging frontend is managed by the same launcher and writes
`.next-dev-staging`, never primary `.next`.

## B. LOCAL_ISOLATED_CERTIFICATION

**Purpose** — PG integration suites, mutation harnesses, destructive fixtures,
browser certification, security and isolation tests.

| | |
|---|---|
| Secrets | `.env.staging`, loaded **explicitly** by the command |
| Supabase | local, loopback only |
| Redis | local (`lm-redis-staging`) |
| Identity | the synthetic `staging@launchmind.test` founder/workspace/product |
| Owner data | none, ever |

**Fail-closed before anything runs.** A certification entrypoint refuses when the
Supabase host is not loopback, any resolved environment variable carries the
hosted project ref, the approved synthetic identity is absent where the workflow
uses one, or the local stack is unreachable. Refusal is exit code 3 and happens
before a test, fixture or browser starts.

Guards, and what each covers:

| Guard | Used by | Enforces |
|---|---|---|
| `scripts/cert-env-guard.mjs` | `staging:seed`, `staging:reset` | parsed-hostname loopback, hosted-ref scan, synthetic identity |
| `scripts/browser-cert-guard.mjs` | `cert:browser` | the above, plus frontend/backend/browser target agreement |
| `scripts/pgCertify.mjs` | `test:pg` | loopback, live reachability probe, PG/browser database separation, refuses a skip-only run |
| `backend/tests/helpers/requirePostgres.ts` | every `*.pg.test.ts` | loopback; **throws** rather than skipping under `PG_INTEGRATION=required` |
| `scripts/staging-migrate.sh` | `staging:migrate` | structurally local — talks to the Docker container, cannot reach a hosted database |

**Skipping is allowed; claiming certification while skipping is not.** That
distinction is enforced in code, not convention: `pgCertify` fails a run in which
everything skipped, and `requirePostgres` throws under `PG_INTEGRATION=required`.

## C. FUTURE_PRODUCTION

**Purpose** — deployed LaunchMind.

Secrets come from a **Key Vault / secret manager**. There is no `.env.prod`
containing production secrets, and this repository does not need one to exist.
`.env.production.example` lists **variable names only** — no values, no
placeholders shaped like credentials.

---

## Dual local database generations (P1-45)

Two disposable local databases, mechanically distinct, both local, no hosted or
paid resource involved.

| | BROWSER_CERT | PG_INTEGRATION |
|---|---|---|
| Supabase project | `launchMind` (`supabase/`) | `launchMindPgCert` (`.pgcert/supabase/`) |
| API port | 54321 | 54421 |
| DB port | 54322 | 54422 |
| Services | full stack | Postgres + PostgREST + GoTrue only |
| Fixture | `staging@launchmind.test` seeded | **none** |
| Marker row | `BROWSER_CERT` | `PG_INTEGRATION` |
| Used by | `cert:browser`, `staging:*` | `test:pg`, `*.pg.test.ts` |

**Generation is decided by an explicit marker, not by row counts.** An empty PG
database and a freshly reset browser database look identical, and that ambiguity
is what allowed one database to serve both lifecycles. `lm_database_generation`
holds exactly one row (enforced by a unique constraint) and is written by a
bootstrap command — never by a migration, because migrations replay on both and
would stamp the same answer in both places.

Each guard also checks a **second, independent** signal — whether the canonical
browser identity is present — and any disagreement between marker and fixture is
a refusal, not a vote.

### Lifecycles — neither may reuse the other's dirty generation

**PG certification**
```
npm run pgdb:up        # start the isolated stack (.pgcert)
npm run pgdb:reset     # discard the previous generation
npm run pgdb:migrate    # replay backend/migrations, no seed of any kind
npm run pgdb:mark      # stamp PG_INTEGRATION
npm run test:pg        # PG_INTEGRATION=required; refuses to skip
npm run pgdb:down      # optional: discard
```

**Browser certification**
```
npm run staging:up
npm run staging:reset
npm run staging:migrate
npm run staging:seed    # the canonical fixture — PG database never gets this
npm run staging:mark    # stamp BROWSER_CERT
npm run staging:verify
npm run cert:browser
```

`pgCertify` resolves its target **only** from `PG_CERT_WORKDIR` (default
`.pgcert`) and its own `supabase status`. It never reads `SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_URL`, `.env.local` or the browser staging configuration —
inference is how one database came to serve two lifecycles in the first place.

## Known environment defect — P1-45

There is **one** local Supabase instance, and it currently serves two
incompatible lifecycles:

- the **browser-certification** generation, which retains a canonical fixture
  (`staging@launchmind.test`) and long-lived audit/history rows
- the **PG-certification** generation, which several integration suites
  deliberately fill with retained audit rows

**Design and guards are implemented** (above); the isolated stack has **not been
started**, because the host disk reached 100% and Docker's containerd metadata
store began returning I/O errors. Until that is cleared, `npm run pgdb:up`
cannot pull or run images and PG certification stays blocked — correctly, by a
guard doing its job rather than by contaminating the browser fixture.

`lm-pg-test` (plain `pgvector/pgvector:pg16`, port 55432) is **not** a substitute:
15 of 16 PG suites talk to PostgREST and 3 create users through GoTrue, neither
of which a bare Postgres container provides. It remains correct for the one
`DATABASE_ONLY` suite that uses it today.
