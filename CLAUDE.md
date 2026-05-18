# LaunchMind — Claude Code Master Reference

> **Read this file completely before writing a single line of code.**
> This file is the permanent architectural reference. It never contains
> task instructions — those live in /phases/. This file changes only when
> a fundamental architectural decision changes.

---

## 0. What Is LaunchMind

LaunchMind is an **AI marketing operating system for app founders**.

**Core loop:**
1. **Discover** — paste App Store / Play Store URL → scrape product intel
2. **Confirm** — review + edit scraped ICP brief → confirm
3. **Execute** — generate 30/60/90 day strategy + content assets (USA + India)
4. **Learn** — weekly Sunday brief → Tuesday retargeting loop

**Markets:** USA (Stripe, USD) + India (Razorpay, INR) from day 1.

**Tiers:** Free · Solo ($19/₹999) · Builder ($49/₹2,499) · Studio ($99/₹4,999)

**Phase prompts:** `/phases/phase-{n}/week-{n}.md` — read the relevant one each week.
**Test suites:** `/tests/e2e/` — Playwright sanity + regression per phase.

---

## 1. Non-Negotiable Build Rules

These apply to EVERY task, EVERY file, EVERY commit. No exceptions.

### 1.1 Backend First — Always
Order for every feature:
1. DB migration (additive only)
2. Fastify route + handler
3. Unit test for the handler
4. Integration test against Supabase local
5. Only then: Next.js page / component

### 1.2 Additive Migrations Only
- NEVER drop, rename, or retype a column
- NEVER delete a table
- To rename: add new column → migrate data → deprecate old with comment
- All migrations: `YYYYMMDD_HHMMSS_description.sql`
- All migrations are idempotent (safe to run twice)

### 1.3 Memory of Existing Implementation
Before writing any new code:
1. Read every file you will touch — completely
2. List every function/route/type the new code will interact with
3. Confirm no existing function signatures will change
4. Run existing tests first — all must pass before adding new code

### 1.4 Token-Ready from Day 1
Every Claude API call routes through:
```typescript
await consumeTokens(founderId, action, estimatedCost);
```
Phases 1–4: no-op (logs only). Phase 5: enforces balance.
Function signature never changes.

### 1.5 Approve-Before-Post — Hard Server-Side Constraint
No campaign posts to any platform unless `campaigns.approved_at` is non-null.
Checked in the Fastify route handler. Frontend cannot bypass this.

### 1.6 Spend Guardrails — Hard Server-Side Limit
Before any paid campaign creation:
1. Fetch `campaigns.spend_cap` for founder + platform
2. Fetch current week spend from platform API
3. If (current + proposed) > cap → reject 422
Frontend shows the rejection — it does not perform this check itself.

---

## 2. Tech Stack — Locked

| Layer | Tool | Notes |
|---|---|---|
| Frontend | Next.js 14 App Router | Confirmed. No alternatives. |
| UI | Tailwind CSS + shadcn/ui | Do not build custom equivalents of shadcn components. |
| Frontend host | Vercel | Auto-deploy on push to main. |
| Backend | Node.js + Fastify | Typed routes, Zod validation. |
| Backend host | Oracle Cloud VM | Docker + Nginx + CI/CD pipeline. |
| Primary DB | Supabase Postgres | RLS on every table from migration 001. |
| Vector store | pgvector (in Supabase) | No separate Pinecone. |
| Cache + Queue | Upstash Redis + BullMQ | Weekly cron + job retries. |
| AI strategy/copy | claude-sonnet-4-6 | Complex generation. |
| AI scoring/classify | claude-haiku-4-5-20251001 | Fast, cheap classification. |
| Scraping static | Cheerio | App Store metadata. |
| Scraping dynamic | Playwright | Play Store + reviews. Sandboxed worker. |
| Token encryption | AES-256 + AWS KMS | OAuth tokens only. Key never in DB. |
| Perimeter | Cloudflare WAF | DNS, DDoS, rate limit, TLS 1.3 only. |
| Email | Resend | Transactional + weekly briefs. |
| Payments USA | Stripe | Subscriptions + token top-up packs. |
| Payments India | Razorpay | UPI + cards + net banking. |
| Error tracking | Sentry | Wired into Fastify error handler first. |
| Product analytics | PostHog | Fires only after cookie consent. |
| Audit logs | Axiom | Immutable append-only. |
| Auth | Supabase Auth | 15-min JWT + rotating refresh tokens. |
| MFA | TOTP via Supabase Auth | Enforced for all accounts. Cannot be disabled. |
| E2E tests | Playwright | Sanity + regression per phase. |
| Unit/integration | Vitest | Backend routes + services. |
| SAST | Semgrep + ESLint security plugin | Blocks merge on HIGH+. |
| DAST | OWASP ZAP | Runs on staging before each phase promotion. |
| Dependency scan | Snyk + npm audit | Blocks deploy on HIGH+ CVE. |

---

## 3. Data Model — Canonical Reference

All 9 tables. Column names are canonical — use them exactly everywhere.

### 3.1 `founders`
```sql
CREATE TABLE founders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT,
  plan          TEXT NOT NULL DEFAULT 'free'
                CHECK (plan IN ('free','solo','builder','studio')),
  mfa_enabled   BOOLEAN NOT NULL DEFAULT false,
  token_balance INTEGER DEFAULT NULL,
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE founders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "founders_self" ON founders USING (id = auth.uid());
```

### 3.2 `products`
```sql
CREATE TABLE products (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id          UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  store_url           TEXT NOT NULL,
  platform            TEXT NOT NULL CHECK (platform IN ('app_store','play_store')),
  category            TEXT,
  markets             TEXT[] DEFAULT ARRAY['usa'],
  price_tier          TEXT,
  confirmed_icp       JSONB,
  competitor_set      JSONB,
  scraped_meta        JSONB,
  brand_voice_profile JSONB,
  last_scraped_at     TIMESTAMPTZ,
  icp_embedding       VECTOR(1536),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products_owner" ON products USING (founder_id = auth.uid());
```

### 3.3 `platform_tokens`
```sql
-- NEVER return encrypted_token to the frontend under any circumstance.
CREATE TABLE platform_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id      UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL
                  CHECK (platform IN ('meta','google','whatsapp','linkedin','email')),
  encrypted_token TEXT NOT NULL,
  kms_key_id      TEXT NOT NULL,
  scopes          TEXT[] NOT NULL,
  expires_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(founder_id, platform)
);
ALTER TABLE platform_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tokens_owner" ON platform_tokens USING (founder_id = auth.uid());
```

### 3.4 `campaigns`
```sql
CREATE TABLE campaigns (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id           UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  founder_id           UUID NOT NULL REFERENCES founders(id),
  channel              TEXT NOT NULL
                       CHECK (channel IN ('meta','google','whatsapp','linkedin','email')),
  market               TEXT NOT NULL CHECK (market IN ('usa','india')),
  status               TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN
                         ('draft','pending_approval','approved','launched','paused','completed')),
  hook_type            TEXT,
  copy_text            TEXT,
  audience_config      JSONB,
  spend_cap            JSONB,
  external_campaign_id TEXT,
  ai_tokens_consumed   INTEGER DEFAULT 0,
  approved_at          TIMESTAMPTZ,
  launched_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaigns_owner" ON campaigns USING (founder_id = auth.uid());
CREATE INDEX campaigns_product_status ON campaigns(product_id, status);
```

### 3.5 `campaign_metrics`
```sql
CREATE TABLE campaign_metrics (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id          UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  founder_id           UUID NOT NULL REFERENCES founders(id),
  week_start           DATE NOT NULL,
  impressions          INTEGER DEFAULT 0,
  clicks               INTEGER DEFAULT 0,
  installs             INTEGER DEFAULT 0,
  cpi                  NUMERIC(10,4),
  ctr                  NUMERIC(6,4),
  roas                 NUMERIC(10,4),
  top_performing_asset TEXT,
  raw_platform_data    JSONB,
  collected_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, week_start)
);
ALTER TABLE campaign_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "metrics_owner" ON campaign_metrics USING (founder_id = auth.uid());
```

### 3.6 `weekly_briefs`
```sql
CREATE TABLE weekly_briefs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id         UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  founder_id         UUID NOT NULL REFERENCES founders(id),
  week_of            DATE NOT NULL,
  what_worked        TEXT,
  what_to_kill       TEXT,
  next_actions       JSONB,
  generated_assets   JSONB,
  ai_tokens_consumed INTEGER DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','sent','acknowledged')),
  sent_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_id, week_of)
);
ALTER TABLE weekly_briefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "briefs_owner" ON weekly_briefs USING (founder_id = auth.uid());
```

### 3.7 `playbook_signals`
```sql
-- ANONYMIZED. No founder_id. No product_id. No PII.
-- service_role may INSERT. authenticated: SELECT only.
CREATE TABLE playbook_signals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category          TEXT NOT NULL,
  market            TEXT NOT NULL CHECK (market IN ('usa','india')),
  channel           TEXT NOT NULL,
  hook_type         TEXT,
  price_tier        TEXT,
  install_delta_pct NUMERIC(8,2),
  conversion_rate   NUMERIC(6,4),
  retention_d7      NUMERIC(6,4),
  week_number       INTEGER,
  signal_embedding  VECTOR(1536),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON playbook_signals TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON playbook_signals FROM authenticated;
```

### 3.8 `audit_logs`
```sql
-- IMMUTABLE. INSERT only. REVOKE UPDATE, DELETE from all non-superuser roles.
CREATE TABLE audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id    UUID REFERENCES founders(id),
  action        TEXT NOT NULL,
  resource_type TEXT,
  resource_id   UUID,
  metadata      JSONB,
  ip_address    INET,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_owner_read" ON audit_logs FOR SELECT USING (founder_id = auth.uid());
REVOKE UPDATE, DELETE ON audit_logs FROM authenticated, anon;
```

### 3.9 `embedding_store`
```sql
CREATE TABLE embedding_store (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id  UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id  UUID REFERENCES products(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('icp','campaign_history','learning_log')),
  content     TEXT NOT NULL,
  embedding   VECTOR(1536),
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE embedding_store ENABLE ROW LEVEL SECURITY;
CREATE POLICY "embeddings_owner" ON embedding_store USING (founder_id = auth.uid());
```

---

## 4. Security — Mandatory Rules

### 4.1 Secrets
- NEVER commit secrets to any file
- `.env.local` is gitignored — never committed
- `.env.example`: placeholder names only, never values
- Secrets: Oracle Cloud VM env file (backend, gitignored) · Vercel env vars (frontend) · GitHub Actions secrets (CI)
- Pre-commit check: `git grep -rE "(key|secret|password|token)\s*=\s*['\"][^'\"]{8,}"`

### 4.2 OAuth Token Vault
- All OAuth tokens: AES-256 encrypted before DB write
- Encryption key: AWS KMS only — never in DB, never in env vars
- `decryptToken()`: always writes to `audit_logs` before returning
- Decrypted token: never logged, never returned to frontend, never cached
- Token retrieval: always verify `founder_id` matches before decrypting

### 4.3 Row-Level Security
Every founder-data table: RLS enabled with `founder_id = auth.uid()` policy. No exceptions. Verify after every migration.

### 4.4 Authentication
- JWT: 15-min access tokens, rotating refresh tokens
- MFA: TOTP enforced for all — cannot be disabled by users
- Anomaly: new device/country → re-auth + Resend alert email + audit log

### 4.5 API
- Zod on all inputs (body, params, query)
- Rate limit: 100 req/min per founder (Cloudflare + Fastify)
- CORS: `launchmind.com` + `localhost:3000` only
- Headers: `CSP` · `X-Frame-Options: DENY` · `X-Content-Type-Options: nosniff`
- TLS 1.3 minimum, HSTS via Cloudflare

### 4.6 SAST
`semgrep --config=p/nodejs-security .` + `eslint --plugin security .`
Block merge on HIGH or CRITICAL.

### 4.7 DAST
OWASP ZAP against staging before every phase promotion.
Block promotion on HIGH or CRITICAL.

### 4.8 Dependency Scanning
`npm audit --audit-level=high` + `npx snyk test --severity-threshold=high`
Block deploy on HIGH+ CVE.

### 4.9 No Standing Production Access
Time-boxed (2h max) → logged to Axiom → auto-revoked.
Document every session in `docs/access-requests.md`.

### 4.10 Data Privacy
- GDPR right-to-delete: `DELETE /founders/me` — purges all personal data
- `playbook_signals` NOT deleted (PII-free)
- `founders`: soft-delete only (email anonymised)
- Data export: `GET /founders/me/export` — GDPR-compliant JSON
- India: review PDPB 2023 before Phase 3

---

## 5. Code Quality Standards

### 5.1 File Header (every file)
```typescript
/**
 * @file filename.ts
 * @description What this file does and why it exists.
 * @security Security-relevant behaviour (auth checks, token handling, RLS, audit logging).
 * @dependencies Other services/tables this file reads or writes.
 */
```

### 5.2 Function JSDoc (every exported function)
```typescript
/**
 * One-line summary.
 * @param name - Description
 * @returns    Description
 * @throws {ErrorType} When and why
 * @security   Any security note specific to this function
 */
```

### 5.3 Commit Format
```
type(scope): short description (imperative mood)

Why this change. What existing behaviour is preserved. What is new.

Closes #issue
```
Types: `feat` `fix` `security` `refactor` `test` `docs` `chore` `migration`

### 5.4 Branch Strategy
```
main       ← production
staging    ← DAST target + phase gate
dev        ← integration
feature/*  ← branch from dev
security/* ← expedited, 1-reviewer merge to main
```

### 5.5 PR Requirements
1. Passing SAST + dependency scan + all tests
2. Test coverage for all new paths
3. What changed and why
4. Phase/Week reference
5. Security impact statement

---

## 6. Design System — Slate & Sage

This is a **light-theme** design system. Never use dark backgrounds for app pages.
Reference HTML: `launchmind-ux-slate-sage.html` (full interactive prototype).

### 6.1 Colour Tokens

| Token | Value | Usage |
|---|---|---|
| `--page` | `#f2f3f6` | App background |
| `--surface` | `#ffffff` | Cards, modals |
| `--raised` | `#eceef3` | Inputs, subtle containers, metric blocks |
| `--sidebar` | `#28304a` | Left nav (dark navy) |
| `--sidebar2` | `#323c58` | Sidebar hover state |
| `--border` | `rgba(0,0,0,0.07)` | Default border |
| `--border2` | `rgba(0,0,0,0.12)` | Stronger border |
| `--ink` | `#1b1f2e` | Primary text |
| `--ink2` | `#626880` | Secondary text |
| `--ink3` | `#9ca4be` | Muted / placeholder text |
| `--sage` | `#059669` | Primary CTA, success, active states |
| `--sage-l` | `#34d399` | Sage light — sidebar active, highlights |
| `--sage-d` | `rgba(5,150,105,0.12)` | Sage tint background |
| `--sage-b` | `rgba(5,150,105,0.28)` | Sage tint border |
| `--indigo` | `#4f46e5` | Accent — current plan, indigo badges |
| `--amber` | `#d97706` | India market badge |
| `--red` | `#dc2626` | Danger, kill signals |

Tailwind class names: `bg-page`, `bg-surface`, `bg-raised`, `bg-sidebar`,
`text-ink`, `text-ink-2`, `text-ink-3`, `text-sage`, `bg-sage-bg`, `border-sage-border`,
`text-indigo`, `text-amber`, `text-danger`

### 6.2 Typography
```
Body:    DM Sans  · base 13px · line-height 1.5
Display: Syne     · headings, sidebar logo, card titles
Mono:    DM Mono  · token counts, metrics, code
```

### 6.3 Component Conventions
```
Card:          bg-surface border border-[--border] rounded-[10px] p-[14px_16px]
Card featured: border-sage-border border-2
Input:         bg-raised border border-[--border2] rounded-sm px-3 py-2 text-ink focus:ring-2 focus:ring-sage-border
Button solid:  bg-sage text-white rounded-sm px-4 py-2 text-sm font-medium
Button ghost:  border border-[--border2] text-ink-2 hover:bg-raised
Sidebar item:  text-[--s-text2] hover:bg-white/6 active:bg-sage-bg active:text-sage-light active:border-sage-border
Metric block:  bg-raised rounded-sm p-[11px_13px]
```

### 6.4 Badges
```
USA market:     bg-sage-bg   border-sage-border   text-sage
India market:   bg-amber-bg  border-amber-border  text-amber
Draft:          bg-raised    border-[--border2]   text-ink-2
Active/Success: bg-sage-bg   border-sage-border   text-sage
Pending:        bg-amber-bg  border-amber-border  text-amber
Pausing/Error:  bg-danger-bg border-danger-border text-danger
Indigo/Accent:  bg-indigo-bg border-indigo-border text-indigo
```

### 6.5 shadcn Usage
Use shadcn: `Button Input Textarea Select Card Dialog Toast Badge Tabs Table`
Do NOT build custom equivalents of shadcn components.

---

## 7. Agent Roles

| Agent | Writes to | Never touches |
|---|---|---|
| Backend | `/backend/**` | `/app` |
| Frontend | `/app/**` `/components/**` `/lib/**` | `/backend`. Never calls Supabase directly. |
| Security | `/docs/security/**`, reviews all PRs | Cannot approve own PRs |
| QA/Test | `/backend/tests/**` `/tests/e2e/**` | Production data |

---

## 8. Token Cost Reference

| Action | Tokens | Model |
|---|---|---|
| Strategy generation | 50 | Sonnet |
| Weekly brief | 20 | Sonnet |
| Content asset batch | 20 | Sonnet |
| Review analysis | 15 | Haiku |
| ICP structuring | 10 | Haiku |
| Scoring / classify | 5 | Haiku |

Tier balances (Phase 5): Free=50 · Solo=300 · Builder=1000 · Studio=3000

---

## 9. Pre-Session Checklist

```bash
# 1. Read CLAUDE.md sections relevant to today's task
# 2. Read phases/phase-{n}/week-{n}.md for today's prompt
# 3. Read all files you will modify — completely
npm test                          # 4. All existing tests must pass
git grep -rE "(key|secret|password|token)\s*=\s*['\"][^'\"]{8,}"  # 5. No secrets
git branch                        # 6. Confirm correct branch
# 7. Backend gate passed before any frontend work starts
```

---

## 10. File Structure

```
launchmind/
├── CLAUDE.md                         ← permanent reference (this file)
├── .env.example                      ← placeholder names only, never values
├── .gitignore                        ← committed first, before everything
├── .dockerignore
├── docker-compose.yml                ← local dev only
├── docker-compose.prod.yml           ← Oracle Cloud VM production
├── nginx.conf                        ← Oracle VM reverse proxy + SSL
├── playwright.config.ts
├── phases/
│   ├── phase-1/ weeks-01-04.md       ← includes Week 0 project setup
│   ├── phase-2/ weeks-05-08.md
│   ├── phase-3/ weeks-09-13.md
│   ├── phase-4/ weeks-14-17.md
│   └── phase-5/ weeks-18-20.md
├── tests/e2e/
│   ├── sanity.spec.ts                ← smoke tests after every deploy
│   └── regression.spec.ts            ← full suite before phase promotion
├── backend/
│   ├── Dockerfile                    ← API image → OCIR
│   ├── Dockerfile.scraper            ← Playwright worker image → OCIR
│   ├── oracle-deploy.sh              ← runs on Oracle VM to pull + restart
│   ├── src/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── repositories/
│   │   ├── middleware/
│   │   ├── workers/
│   │   └── lib/
│   │       ├── tokens.ts             ← consumeTokens()
│   │       ├── tokenVault.ts         ← AES-256 + AWS KMS
│   │       ├── aiClient.ts           ← Anthropic SDK wrapper
│   │       └── scheduler.ts          ← BullMQ cron
│   ├── migrations/
│   └── tests/
├── app/                              ← Next.js 14 App Router → Vercel
├── components/
│   ├── ui/                           ← shadcn (do not modify)
│   └── launchmind/
├── lib/
│   └── api.ts                        ← type-safe API client
├── scripts/
│   └── localstack-init.sh            ← creates KMS key in LocalStack
├── .github/
│   └── workflows/
│       ├── ci.yml                    ← PR gate (SAST + tests + dep scan)
│       └── deploy.yml                ← deploys to Oracle VM on merge to main
└── docs/
    ├── oracle-setup.md               ← Oracle Cloud VM setup guide
    ├── local-setup.md                ← local dev setup guide
    ├── security/secret-rotation.md
    ├── incidents/playbook.md
    └── access-requests.md
```

---

*Stack: Next.js 14 + Vercel · Fastify + Oracle Cloud VM · Supabase · pgvector · BullMQ · Claude API · AWS KMS · Cloudflare*
*Markets: USA + India · Rule: Backend first · Additive migrations · Token-ready from day 1*
