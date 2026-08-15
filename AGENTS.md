# AGENTS.md — canonical commands

Architecture, data model, and design system live in `CLAUDE.md`. This file is only
about **how to run things**, because that was previously folklore: `npx vitest run`
from the repository root used to sweep up Playwright specs and backend suites and
report failures that had nothing to do with the code under test.

Two rules make everything below predictable:

- **Frontend commands run from the repository root.** The Next.js app is at the root,
  not in `app/` (`app/` is the App Router directory).
- **Backend commands run from `backend/`.** Several backend suites read files
  relative to the process cwd; `backend/vitest.config.ts` pins `root` so they behave
  identically either way, but the scripts below are the supported path.

## Everything at once

```bash
npm run verify
```

Runs, in order: frontend typecheck → backend typecheck → frontend lint → backend lint
→ backend production build → frontend unit tests → backend tests. This is the same
set CI gates on, minus the real-Postgres tier and the security scanners.

## Tests

| What | Command | Notes |
|---|---|---|
| Frontend unit | `npm run test` | `lib/**` and `components/**` only |
| Backend, everything | `npm run test:backend` | 36 files |
| Backend, no database needed | `npm --prefix backend run test:unit` | excludes `*.pg.test.ts` |
| Provider adapters | `npm run test:providers` | all nine providers + journeys |
| Security | `npm run test:security` | OAuth, credential vault, execution boundary |
| Workspace isolation | `npm run test:isolation` | tenancy + connection state machine |
| Real-Postgres integration | `npm run test:integration` | **needs a database — see below** |
| Retrieval benchmark | `npm --prefix backend run eval:retrieval` | needs the local Supabase stack |
| Embedding backfill (dry run) | `npm --prefix backend run embeddings:backfill` | add `-- --execute` to enqueue |
| Playwright E2E | `npm run test:e2e` | needs a running frontend |
| Visual regression | `npm run test:visual` | see `docs/testing/visual-regression.md` |

### The credential vault (OCI) tier

`credential → encrypt → decrypt → equality` is the precondition for every OAuth
provider: if the vault does not round-trip, the PKCE verifier cannot be stored and
every provider connection fails before it reaches the provider. Mocked tests prove
the error handling; only this tier proves a credential survives.

LaunchMind uses **OCI Vault / Key Management**. AWS KMS was removed.

```bash
# Local: identity from ~/.oci/config. The private key stays a key_file PATH there —
# never copy its contents into .env.local.
OCI_VAULT_AUTH_MODE=config_file \
OCI_VAULT_KEY_OCID=ocid1.key.oc1... \
OCI_VAULT_CRYPTO_ENDPOINT=https://<prefix>-crypto.kms.<region>.oraclecloud.com \
OCI_REGION=<region> \
  npm run test:vault
```

Production uses `OCI_VAULT_AUTH_MODE=instance_principal`: identity comes from the
OCI metadata service, so there is no user API key and nothing long-lived to rotate.

The suite **skips loudly** when the vault is unconfigured or the values are still
template placeholders, rather than reporting green. A skipped round trip is not
evidence of a working vault.

Only the **cryptographic** endpoint is configured. This service encrypts and
decrypts; it never manages keys, which is why no vault OCID or compartment OCID is
required at runtime.

### The real-Postgres tier

`MemoryDb` honours query predicates, which makes tenancy assertions meaningful, but
it **cannot enforce a unique index**. Any test whose subject is a constraint — dedup,
replay protection, conflict targets — is vacuous against it. Those tests run against
a real database:

```bash
npm --prefix backend run db:test:up      # pgvector/pgvector:pg16 on :55432
                                         # (was postgres:16-alpine; migrations 035/089
                                         #  declare vector columns, so pgvector is required)
npm run test:integration
npm --prefix backend run db:test:down
```

Override the target with `TEST_DATABASE_URL`. The harness **refuses** any URL that
looks hosted (Supabase, RDS, Neon, Render): setup drops and recreates the schema.

Without a database these specs report `[SKIPPED — no Postgres at …]` rather than
passing silently. A skipped constraint test is not evidence of a working constraint.

## Types, lint, build

| What | Command |
|---|---|
| Frontend typecheck | `npm run typecheck` |
| Backend typecheck | `npm run typecheck:backend` |
| Frontend lint | `npm run lint` |
| Backend lint | `npm run lint:backend` |
| Frontend production build | `npm run build` |
| Backend production build | `npm run build:backend` → emits `backend/dist/` |
| Run the compiled backend | `npm --prefix backend start` |
| Design-token parity | `node scripts/check-design-tokens.mjs` |

**Backend typecheck and backend build are not the same gate.** They share a tsconfig,
but only the build emits, and only the build proves a deployable `dist/` exists. CI
runs both.

## Running the stack locally

```bash
npm --prefix backend run dev     # Fastify + workers on :3001
npm run dev                      # Next.js on :3000
```

Two things that will otherwise waste an afternoon:

- **Never run `next build` while `next dev` is running.** They share `.next`, and a
  concurrent build leaves the dev server serving 404s for its own CSS. Stop dev
  first, or build and serve on another port.
- **`next start` fails silently into an existing listener.** If port 3000 is already
  taken, `next start` prints `EADDRINUSE` and exits, but curl still answers — from
  the *other* server. Check with `lsof -ti:3000` before concluding anything about
  which build you just tested.

## Staging (provider validation)

A disposable stack isolated from the hosted Supabase project. Full detail in
`docs/staging-setup.md`.

```bash
npm run staging:up        # local Supabase (:54321) + staging Redis (:6380)
npm run staging:migrate   # backend/migrations — NOT supabase/migrations (stale + demo seed)
npm run staging:seed      # founder + "LaunchMind Provider Validation" workspace + product

npm --prefix backend run dev:staging   # backend  → staging
npm run staging:dev                    # frontend → staging
npm run staging:verify                 # 14 isolation + readiness checks; must print PASS

npm run staging:reset                  # wipe provider output between journeys
npm run staging:down                   # stop everything
```

| | staging | dev/production |
|---|---|---|
| Supabase | local `:54321` | hosted |
| Redis | `:6380` | `:6379` |
| Analytics | disabled | PostHog |
| Config | `.env.staging` | `.env.local` |

Three rules worth internalising:

- **Never run a provider journey against the hosted project.** `staging:verify`
  fails outright if Supabase points at it, if Redis is `:6379`, if a PostHog key is
  set, or if any founder other than the staging one exists.
- **Never seed a connection, signal, or insight.** They must come from a real
  provider or a PASS means nothing.
- **Use `npm run staging:dev`, not `next dev`.** Next auto-loads `.env.local`
  (production) and would claim the backend's `PORT`.

## Provider credentials

### Meta

One canonical pair, used by every Meta code path:

```
META_ADS_CLIENT_ID
META_ADS_CLIENT_SECRET
```

`META_ADS_APP_ID` / `META_ADS_APP_SECRET` are **deprecated aliases**. They still work
for one release and log a startup warning. Canonical wins if both are set.

Two rules the resolver (`src/services/providers/metaCredentials.ts`) enforces:

- **Never both pairs required.** Either one alone is sufficient.
- **Never a half of each.** An id and a secret always come from the SAME pair. A
  partial configuration disables Meta rather than half-working.

`WHATSAPP_APP_ID` / `WHATSAPP_APP_SECRET` are a **different Meta app** and are not
part of this. Meta Ads used to fall back to them, which silently ran Ads OAuth
against the WhatsApp app; that fallback is gone.

## Migrations

Additive and idempotent only (`CLAUDE.md` §1.2). Files are
`backend/migrations/YYYYMMDD_NNNNNN_description.sql`.

```bash
npm --prefix backend run db:migrate          # local Supabase
npm --prefix backend run db:migrate:remote   # hosted — deliberate, not routine
```

The real-Postgres test harness applies migration files directly, so a migration that
does not run is a test failure rather than a production surprise.
