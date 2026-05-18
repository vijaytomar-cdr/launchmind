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

**Phase prompts:** `/phases/phase-{n}/weeks-{nn}-{nn}.md` — read the relevant one each week.
**Test suites:** `/tests/e2e/` — Playwright sanity + regression per phase.

---

## 1. Non-Negotiable Build Rules

These apply to EVERY task, EVERY file, EVERY commit. No exceptions.

### 1.1 Backend First — Always
1. DB migration (additive only)
2. Fastify route + handler
3. Unit test for the handler
4. Integration test against Supabase local
5. Only then: Next.js page / component

### 1.2 Additive Migrations Only
- NEVER drop, rename, or retype a column
- NEVER delete a table
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
Phases 1–4: no-op (logs only). Phase 5: enforces balance. Function signature never changes.

### 1.5 Approve-Before-Post — Hard Server-Side Constraint
No campaign posts to any platform unless `campaigns.approved_at` is non-null.
Checked in the Fastify route handler. Frontend cannot bypass this.

### 1.6 Spend Guardrails — Hard Server-Side Limit
Before any paid campaign creation:
1. Fetch `campaigns.spend_cap` for founder + platform
2. Fetch current week spend from platform API
3. If (current + proposed) > cap → reject 422

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

All tables. Column names are canonical — use them exactly everywhere.

### 3.1 `founders`
```sql
CREATE TABLE founders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL UNIQUE,
  name            TEXT,
  plan            TEXT NOT NULL DEFAULT 'free'
                  CHECK (plan IN ('free','solo','builder','studio')),
  mfa_enabled     BOOLEAN NOT NULL DEFAULT false,
  token_balance   INTEGER DEFAULT NULL,
  deleted_at      TIMESTAMPTZ,
  onboarding_step INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
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
  workspace_id        UUID,
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
                       CHECK (channel IN
                         ('meta','google','whatsapp','linkedin','email','aso_rewrite')),
  market               TEXT NOT NULL CHECK (market IN ('usa','india')),
  status               TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN
                         ('draft','pending_approval','approved','launched','paused','completed')),
  hook_type            TEXT,
  copy_text            TEXT,
  audience_config      JSONB,
  spend_cap            JSONB,
  external_campaign_id TEXT,
  action               TEXT,
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

### 3.10 `workspaces` (Phase 4, Week 17)
```sql
CREATE TABLE workspaces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id  UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  client_name TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspaces_owner" ON workspaces USING (founder_id = auth.uid());
```

---

## 4. Security — Mandatory Rules

### 4.1 Secrets
- NEVER commit secrets to any file
- `.env.local` is gitignored — never committed
- `.env.example`: placeholder names only, never values
- Secrets: Oracle Cloud VM env file (backend) · Vercel env vars (frontend) · GitHub Actions secrets (CI)
- Pre-commit check: `git grep -rE "(key|secret|password|token)\s*=\s*['\"][^'\"]{8,}"`

### 4.2 OAuth Token Vault
- All OAuth tokens: AES-256 encrypted before DB write
- Encryption key: AWS KMS only — never in DB, never in env vars
- `decryptToken()`: always writes to `audit_logs` before returning
- Decrypted token: never logged, never returned to frontend, never cached
- Token retrieval: always verify `founder_id` matches before decrypting

### 4.3 Row-Level Security
Every founder-data table: RLS enabled with `founder_id = auth.uid()`. No exceptions. Verify after every migration.

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
`semgrep --config=p/nodejs-security .` + `eslint --plugin security .` — block merge on HIGH or CRITICAL.

### 4.7 DAST
OWASP ZAP against staging before every phase promotion. Block promotion on HIGH or CRITICAL.

### 4.8 Dependency Scanning
`npm audit --audit-level=high` + `npx snyk test --severity-threshold=high` — block deploy on HIGH+ CVE.

### 4.9 No Standing Production Access
Time-boxed (2h max) → logged to Axiom → auto-revoked. Document in `docs/access-requests.md`.

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
Types: feat  fix  security  refactor  test  docs  chore  migration
```

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
3. What changed and why + Phase/Week reference
4. Security impact statement

---

## 6. Design System — Slate & Sage (LOCKED)

This is a **light-theme** design system. Never use dark backgrounds for app pages.

Reference files (must be in project root):
- `launchmind-ux-slate-sage.html` — all 12 interactive dashboard screens
- `launchmind-homepage.html` — complete marketing homepage

Every UI component MUST match these reference files exactly.

### 6.1 Colour Tokens

| Token | Value | Usage |
|---|---|---|
| `--page` | `#f2f3f6` | App background |
| `--surface` | `#ffffff` | Cards, topbar, modals |
| `--raised` | `#eceef3` | Inputs, metric blocks, subtle containers |
| `--sidebar` | `#28304a` | Left nav (dark navy) |
| `--sidebar2` | `#323c58` | Sidebar hover state |
| `--border` | `rgba(0,0,0,0.07)` | Default border |
| `--border2` | `rgba(0,0,0,0.12)` | Stronger border |
| `--s-border` | `rgba(255,255,255,0.07)` | Sidebar internal borders |
| `--s-text` | `rgba(255,255,255,0.88)` | Sidebar primary text |
| `--s-text2` | `rgba(255,255,255,0.42)` | Sidebar secondary text |
| `--s-text3` | `rgba(255,255,255,0.22)` | Sidebar dim text |
| `--ink` | `#1b1f2e` | Primary text |
| `--ink2` | `#626880` | Secondary text |
| `--ink3` | `#9ca4be` | Muted / placeholder text |
| `--sage` | `#059669` | Primary CTA, success, active states |
| `--sage-l` | `#34d399` | Sage light — sidebar active, highlights |
| `--sage-d` | `rgba(5,150,105,0.12)` | Sage tint background |
| `--sage-b` | `rgba(5,150,105,0.28)` | Sage tint border |
| `--indigo` | `#4f46e5` | Accent — current plan, indigo badges |
| `--indigo-d` | `rgba(79,70,229,0.10)` | Indigo tint background |
| `--indigo-b` | `rgba(79,70,229,0.22)` | Indigo tint border |
| `--amber` | `#d97706` | India market badge, warnings |
| `--amber-d` | `rgba(217,119,6,0.10)` | Amber tint background |
| `--amber-b` | `rgba(217,119,6,0.22)` | Amber tint border |
| `--red` | `#dc2626` | Danger, kill signals |
| `--red-d` | `rgba(220,38,38,0.09)` | Red tint background |
| `--red-b` | `rgba(220,38,38,0.22)` | Red tint border |
| `--r` | `10px` | Default border radius |
| `--r2` | `6px` | Medium border radius |
| `--r3` | `4px` | Small border radius |

Tailwind: `bg-page bg-surface bg-raised bg-sidebar text-ink text-ink2 text-ink3 text-sage text-indigo text-amber text-danger`

### 6.2 Typography
```
Body:    DM Sans  · base 13px · line-height 1.5
Display: Syne     · headings, sidebar logo, card titles, section headers
Mono:    DM Mono  · token counts, metrics, data values, code
```
Google Fonts: `Syne:wght@400;500;600;700;800` + `DM+Sans:wght@300;400;500` + `DM+Mono:wght@400;500`

### 6.3 Component Conventions
```
Card:          bg-surface border border-[--border] rounded-[10px] p-[14px_16px]
Card featured: border-[--sage-b] border-[1.5px]
Input:         bg-raised border border-[--border2] rounded-[6px] px-3 py-2 text-ink
               focus:border-[--sage-b] focus:ring-2 focus:ring-[--sage-d]
Button solid:  bg-sage text-white rounded-[6px] px-4 py-2 text-sm font-medium
Button ghost:  border border-[--border2] text-ink2 hover:bg-raised rounded-[6px]
Button sage:   bg-[--sage-d] border border-[--sage-b] text-sage rounded-[6px]
Sidebar item:  text-[--s-text2] hover:bg-white/6 rounded-[6px] mx-[6px]
               active: bg-[--sage-d] border border-[--sage-b] text-[--sage-l]
Metric block:  bg-raised rounded-[6px] p-[11px_13px]
Topbar:        bg-surface border-b border-[--border]
```

### 6.4 Badges
```
USA market:     bg-[--sage-d]   border-[--sage-b]   color:#046c4e
India market:   bg-[--amber-d]  border-[--amber-b]  color:#92400e
Draft:          bg-raised       border-[--border2]  text-ink2
Active/Success: bg-[--sage-d]   border-[--sage-b]   text-sage
Pending:        bg-[--amber-d]  border-[--amber-b]  text-amber
Pausing/Error:  bg-[--red-d]    border-[--red-b]    text-red
Indigo/Accent:  bg-[--indigo-d] border-[--indigo-b] text-indigo
```

### 6.5 Icons
Use `@tabler/icons-react`. Outline only — never filled variants.
Key: `TbLayoutDashboard TbSearch TbRoute TbSpeakerphone TbFileAnalytics TbPlug TbCreditCard
TbSettings TbCheck TbAlertCircle TbShieldCheck TbSparkles TbArrowRight TbBrandWhatsapp
TbBrandFacebook TbBrandGoogle TbBrandLinkedin TbMail TbLock TbDownload`

### 6.6 shadcn Usage
Use shadcn: `Button Input Textarea Select Card Dialog Toast Badge Tabs Table`
Do NOT build custom equivalents of shadcn components.

### 6.7 12 Dashboard Screens → Next.js Routes
| Screen ID | Route | File |
|---|---|---|
| s-login | `/login` | `app/(auth)/login/page.tsx` |
| s-signup | `/signup` | `app/(auth)/signup/page.tsx` |
| s-mfa | `/mfa` | `app/(auth)/mfa/page.tsx` |
| s-dashboard | `/dashboard` | `app/(dashboard)/page.tsx` |
| s-discover | `/products/new` | `app/(dashboard)/products/new/page.tsx` |
| s-confirm | `/products/new/confirm` | `app/(dashboard)/products/new/confirm/page.tsx` |
| s-strategy | `/products/[id]/strategy` | `app/(dashboard)/products/[id]/strategy/page.tsx` |
| s-campaigns | `/campaigns` | `app/(dashboard)/campaigns/page.tsx` |
| s-briefs | `/briefs` | `app/(dashboard)/briefs/page.tsx` |
| s-channels | `/channels` | `app/(dashboard)/channels/page.tsx` |
| s-billing | `/billing` | `app/(dashboard)/billing/page.tsx` |
| s-settings | `/settings` | `app/(dashboard)/settings/page.tsx` |

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
| Brand voice extract | 10 | Haiku |
| Brand voice apply | 5 | Haiku |
| Scoring / classify | 5 | Haiku |

Tier balances (Phase 5 enforcement): Free=50 · Solo=300 · Builder=1000 · Studio=3000

---

## 9. Pre-Session Checklist

```bash
# 1. Read CLAUDE.md sections relevant to today's task
# 2. Read phases/phase-{n}/weeks-{nn}-{nn}.md for today's prompt
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
├── .env.example                      ← placeholder names only
├── .gitignore                        ← committed first, before everything
├── .dockerignore
├── docker-compose.yml                ← local dev only
├── docker-compose.prod.yml           ← Oracle Cloud VM production
├── nginx.conf                        ← Oracle VM reverse proxy + SSL
├── playwright.config.ts
├── launchmind-ux-slate-sage.html     ← UI reference: all 12 dashboard screens
├── launchmind-homepage.html          ← UI reference: marketing homepage
├── phases/
│   ├── phase-1/ weeks-01-04.md       ← Weeks 0–4 (DONE)
│   ├── phase-2/ weeks-05-08.md       ← Weeks 5–8 (DONE)
│   ├── phase-3/ weeks-09-13.md       ← CURRENT — start here
│   ├── phase-4/ weeks-14-17.md
│   └── phase-5/ weeks-18-20.md
├── tests/e2e/
│   ├── sanity.spec.ts
│   └── regression.spec.ts
├── backend/
│   ├── Dockerfile
│   ├── Dockerfile.scraper
│   ├── oracle-deploy.sh
│   ├── src/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── repositories/
│   │   ├── middleware/
│   │   ├── workers/
│   │   └── lib/
│   │       ├── tokens.ts             ← consumeTokens()
│   │       ├── tokenVault.ts         ← AES-256 + AWS KMS
│   │       ├── aiClient.ts
│   │       └── scheduler.ts          ← BullMQ cron
│   ├── migrations/
│   └── tests/
├── app/                              ← Next.js 14 App Router → Vercel
├── components/
│   ├── ui/                           ← shadcn (do not modify)
│   └── launchmind/                   ← custom shared components
├── lib/
│   └── api.ts                        ← type-safe API client
├── scripts/
│   └── localstack-init.sh
├── .github/workflows/
│   ├── ci.yml
│   └── deploy.yml
└── docs/
    ├── oracle-setup.md
    ├── local-setup.md
    ├── security/secret-rotation.md
    ├── incidents/playbook.md
    └── access-requests.md
```

---

## 11. Current Build State

> Update this section at the end of every phase.

```
Last updated: Starting Phase 3 (Week 9)

Backend — Weeks 0–8: COMMITTED AND COMPLETE
  Week 0: Scaffold, Docker, CI/CD, Oracle deploy, GitHub Actions
  Week 1: Fastify, all 9 DB migrations, RLS, token vault, consumeTokens()
  Week 2: Scraper (Cheerio + Playwright), ICP service, product routes + tests
  Week 3: Strategy generation (Claude Sonnet), playbookService, OAuth, WhatsApp routes
  Week 4: Stripe, Razorpay, metrics aggregation, BullMQ briefs + tests
  Week 5: platformTokenService, WhatsApp Business API, approve-before-post
  Week 6: BullMQ weekly cron, anonymizationService, brief pipeline, Resend
  Week 7: Admin trigger, UTM service, email campaigns, metrics dashboard
  Week 8: Bug fixes, performance, waitlist page

Frontend — Weeks 2–8: EMPTY SCAFFOLDS
  Build in Phase 3 from reference files in project root.
  Reference: launchmind-ux-slate-sage.html (all 12 screens)
  Reference: launchmind-homepage.html (marketing site)

Seed data:
  playbook_signals: EMPTY
  FIRST TASK in Week 9: run 20250601_000011_seed_playbook_signals.sql (28 rows)

Next: open phases/phase-3/weeks-09-13.md and start Week 9.
```

---

*Stack: Next.js 14 + Vercel · Fastify + Oracle Cloud VM · Supabase · pgvector · BullMQ · Claude API · AWS KMS · Cloudflare*
*Markets: USA + India · Rule: Backend first · Additive migrations · Token-ready from day 1*
