# Staging environment — provider validation

A disposable stack for Step 9B provider validation, OAuth, E2E, visual regression,
and destructive recovery testing. **Nothing here touches the hosted Supabase project.**

## What it is

| Component | Staging | Production/dev |
|---|---|---|
| Supabase | local stack, `http://127.0.0.1:54321` | hosted `gseqtbwdenjkwysregpp` |
| Postgres | `:54322` (local container) | hosted |
| Redis | **separate container**, `:6380` | `:6379` |
| Credential vault | OCI — **shared key**, see below | same |
| Analytics | **disabled** (no PostHog key) | PostHog enabled |
| Frontend | `:3000` via `npm run staging:dev` | `:3000` via `npm run dev` |
| Backend | `:3001` via `npm --prefix backend run dev:staging` | `:3001` via `npm run dev` |

Config lives in `.env.staging` (gitignored). `.env.local` is untouched — switching
environments is a matter of which command you start, not which file you edit.

### Why a local Supabase rather than a second hosted project

Creating a hosted staging project needs a `SUPABASE_ACCESS_TOKEN`, which is yours to
supply. The local stack is also a better fit for §13 destructive recovery testing:
revoking tokens, corrupting state, and resetting between runs are all free and
instant. If you later want a hosted staging project, everything below transfers —
only `.env.staging`'s Supabase URL and keys change.

### Why the credential vault key is shared with dev

OCI Vault charges per key version, and a second key would prove nothing extra: the
vault is verified by its own round-trip test, and staging encrypts only throwaway
provider credentials. The isolation that matters — the database, the queue, the
analytics — is real and complete.

**If you connect a production provider account in staging, create a separate OCI key
first.** Sharing is safe only while staging holds nothing you would not throw away.

## First-time setup

```bash
npm run staging:up        # local Supabase + staging Redis
npm run staging:migrate   # applies backend/migrations (the authoritative set)
npm run staging:seed      # founder + workspace + product fixture
```

`supabase/migrations` is **not** used: it is stale (61 files vs 87) and contains the
ClientPulse demo seed. Staging must have no demo or customer data, so
`staging:migrate` reads `backend/migrations` and skips the two seed files by name.

Ten migrations are not idempotent (`CREATE INDEX` / `CREATE POLICY` without
`IF NOT EXISTS`), which violates `CLAUDE.md` §1.2. `staging:migrate` reports those
as *already present* rather than failures so a correct re-run does not look broken —
but the underlying defect is real and worth fixing.

## Daily use

```bash
npm --prefix backend run dev:staging   # backend  → staging
npm run staging:dev                    # frontend → staging
npm run staging:verify                 # 14 checks, must print PASS
```

Between provider journeys:

```bash
npm run staging:reset        # wipes provider output, KEEPS the login/workspace
npm run staging:reset -- --full   # also removes the fixture; re-seed afterwards
```

`staging:reset` is what makes a validation run meaningful. A leftover signal from a
previous attempt is indistinguishable from one a provider just returned.

## The fixture

| | |
|---|---|
| Founder | `staging@launchmind.test`, plan `builder` |
| Workspace | **LaunchMind Provider Validation** |
| Product | "Staging Validation App" — fixture text only, **no observed metrics** |

Deliberately **not** seeded: connections, credentials, signals, insights, sync runs.
Every one of those must come from a real provider. Seeding any of them would make a
PASS meaningless.

## Provider secrets

Not configured, by design (§13). Add only the provider you are actively validating,
to `.env.staging`, then remove it:

```
# META_ADS_CLIENT_ID=
# META_ADS_CLIENT_SECRET=
```

Register this redirect URI **verbatim** in every provider console:

```
http://localhost:3001/connections/oauth/callback
```

Exact string match, no wildcards. A trailing slash or `127.0.0.1` instead of
`localhost` will be rejected by the allow-list.

## Two traps

**`PORT` in `.env.staging` is the backend's.** Next.js would otherwise claim 3001 and
collide. `scripts/staging-frontend.sh` unsets it and passes `-p 3000` explicitly.

**Next auto-loads `.env.local`, which points at production.** Real environment
variables outrank `.env` files, so the launcher exports `.env.staging` before
starting Next. Use `npm run staging:dev`, never a bare `next dev`, for staging.

## Verifying isolation

`npm run staging:verify` fails — not warns — if Supabase points at the production
project, if `REDIS_URL` is `:6379`, if a PostHog key is set, or if any founder other
than the staging one exists. The last check is the tripwire for accidentally copying
production data.

The decisive functional proof is the browser login: `staging@launchmind.test` exists
**only** in the staging stack, so a successful UI login could not happen against
production.

## Teardown

```bash
npm run staging:down     # stops Supabase + staging Redis
```

Data survives a restart. `supabase stop --no-backup` discards it entirely.
