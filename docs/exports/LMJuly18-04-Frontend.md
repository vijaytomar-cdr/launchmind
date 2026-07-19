# LMJuly18-04 — LaunchMind: Frontend

**Date:** July 18, 2026 · Part 4 of 6  
**Runtime:** Next.js 14 App Router  
**Host:** Vercel (auto-deploy on push to main)  
**Design System:** Slate & Sage v1.0 (light theme only)

---

## Table of Contents

1. [File Structure](#1-file-structure)
2. [Routing Map](#2-routing-map)
3. [Public Pages](#3-public-pages)
4. [Auth Pages](#4-auth-pages)
5. [Dashboard Layout](#5-dashboard-layout)
6. [Primary Dashboard Pages](#6-primary-dashboard-pages)
7. [Product Intake Wizard (7 steps)](#7-product-intake-wizard-7-steps)
8. [Intelligence Pages](#8-intelligence-pages)
9. [Settings Pages](#9-settings-pages)
10. [Components Library](#10-components-library)
11. [Design System v1.0](#11-design-system-v10)
12. [API Client (`lib/api.ts`)](#12-api-client-libapits)
13. [Utility Libraries](#13-utility-libraries)
14. [Key Patterns & Rules](#14-key-patterns--rules)

---

## 1. File Structure

```
app/
├── page.tsx                          # Marketing homepage
├── layout.tsx                        # Root layout (DM Sans + Syne + DM Mono, PostHog)
├── globals.css                       # Design system CSS variables + base styles
├── pricing/page.tsx
├── checkout/success/page.tsx
├── (auth)/
│   ├── login/page.tsx + actions.ts
│   ├── signup/page.tsx
│   ├── mfa/page.tsx
│   ├── forgot-password/page.tsx
│   └── reset-password/page.tsx
├── (dashboard)/
│   ├── layout.tsx                    # Sidebar + MobileNav + main
│   ├── error.tsx                     # Error boundary → ErrorState
│   └── dashboard/
│       ├── page.tsx                  # redirect → /dashboard/brief
│       ├── brief/page.tsx
│       ├── opportunities/page.tsx
│       ├── ask/page.tsx
│       ├── approvals/page.tsx
│       ├── results/page.tsx
│       ├── analytics/page.tsx
│       ├── reports/page.tsx
│       ├── campaigns/page.tsx
│       ├── experiments/page.tsx
│       ├── calendar/page.tsx
│       ├── content/page.tsx
│       ├── briefs/page.tsx
│       ├── channels/page.tsx
│       ├── billing/page.tsx
│       ├── missions/
│       │   ├── page.tsx
│       │   └── [id]/page.tsx
│       ├── products/
│       │   ├── page.tsx
│       │   ├── [id]/page.tsx
│       │   ├── [id]/strategy/page.tsx
│       │   ├── new/page.tsx + layout.tsx
│       │   ├── new/context/page.tsx
│       │   ├── new/analysis/page.tsx
│       │   ├── new/icp/page.tsx
│       │   ├── new/competitors/page.tsx
│       │   ├── new/markets/page.tsx
│       │   └── new/confirm/page.tsx
│       ├── workspaces/
│       │   ├── page.tsx
│       │   └── [id]/page.tsx
│       ├── settings/
│       │   ├── page.tsx
│       │   ├── billing/page.tsx
│       │   ├── usage/page.tsx
│       │   ├── [tab]/page.tsx
│       │   └── tabs/
│       │       ├── ProfileTab.tsx
│       │       ├── SecurityTab.tsx
│       │       ├── ContentTypesTab.tsx
│       │       ├── VoiceCloneTab.tsx
│       │       ├── NotificationsTab.tsx
│       │       ├── ProductsTab.tsx
│       │       └── AccountManagementTab.tsx
│       ├── intelligence/
│       │   ├── layout.tsx
│       │   ├── growth-brain/page.tsx
│       │   ├── memory/page.tsx
│       │   ├── knowledge/page.tsx
│       │   ├── market/page.tsx
│       │   ├── reviews/page.tsx
│       │   ├── timeline/page.tsx
│       │   ├── ideas/page.tsx
│       │   └── ai-audit/page.tsx
│       ├── admin/
│       │   ├── page.tsx
│       │   └── mrr/page.tsx
│       ├── insights/page.tsx
│       └── metrics/page.tsx
└── api/
    ├── admin/feedback/route.ts
    ├── admin/mrr/route.ts
    ├── admin/stats/route.ts
    └── auth/callback/route.ts

components/launchmind/              # 24 custom components
lib/
├── api.ts                          # Type-safe API client
├── coerce.ts                       # toStringArray() + toRecord()
├── auth.ts
├── analytics.ts                    # PostHog helpers
├── design-system/tokens.ts
├── types/content.ts
├── types/intake.ts
├── types/settings.ts
└── supabase/client.ts + server.ts + middleware.ts

middleware.ts                       # Next.js edge middleware (auth redirect)
tailwind.config.ts                  # Design system v1.0 config
```

---

## 2. Routing Map

| URL | File | Description |
|-----|------|-------------|
| `/` | `app/page.tsx` | Marketing homepage |
| `/pricing` | `app/pricing/page.tsx` | Public pricing |
| `/login` | `app/(auth)/login/page.tsx` | Sign in |
| `/signup` | `app/(auth)/signup/page.tsx` | Create account |
| `/mfa` | `app/(auth)/mfa/page.tsx` | TOTP verification |
| `/forgot-password` | `(auth)/forgot-password/page.tsx` | Reset request |
| `/reset-password` | `(auth)/reset-password/page.tsx` | New password |
| `/dashboard` | → redirect to `/dashboard/brief` | |
| `/dashboard/brief` | `dashboard/brief/page.tsx` | **Morning Brief — primary entry** |
| `/dashboard/opportunities` | `dashboard/opportunities/page.tsx` | Growth backlog |
| `/dashboard/ask` | `dashboard/ask/page.tsx` | Ask LaunchMind |
| `/dashboard/approvals` | `dashboard/approvals/page.tsx` | Unified approvals |
| `/dashboard/results` | `dashboard/results/page.tsx` | Interpreted metrics |
| `/dashboard/analytics` | `dashboard/analytics/page.tsx` | KPI drill-down |
| `/dashboard/reports` | `dashboard/reports/page.tsx` | Report generation |
| `/dashboard/campaigns` | `dashboard/campaigns/page.tsx` | Campaign management |
| `/dashboard/experiments` | `dashboard/experiments/page.tsx` | A/B experiments |
| `/dashboard/calendar` | `dashboard/calendar/page.tsx` | Execution calendar |
| `/dashboard/content` | `dashboard/content/page.tsx` | Content Studio |
| `/dashboard/briefs` | `dashboard/briefs/page.tsx` | Weekly briefs + assets |
| `/dashboard/channels` | `dashboard/channels/page.tsx` | Platform integrations |
| `/dashboard/billing` | `dashboard/billing/page.tsx` | Plan + token top-ups |
| `/dashboard/missions` | `dashboard/missions/page.tsx` | Mission Center |
| `/dashboard/missions/:id` | `dashboard/missions/[id]/page.tsx` | Mission detail |
| `/dashboard/products` | `dashboard/products/page.tsx` | Product list |
| `/dashboard/products/:id` | `dashboard/products/[id]/page.tsx` | Product detail |
| `/dashboard/products/:id/strategy` | `[id]/strategy/page.tsx` | Strategy view |
| `/dashboard/products/new` | `products/new/page.tsx` | Intake step 1 |
| `/dashboard/products/new/context` | `new/context/page.tsx` | Intake step 2 |
| `/dashboard/products/new/analysis` | `new/analysis/page.tsx` | Intake step 3 |
| `/dashboard/products/new/icp` | `new/icp/page.tsx` | Intake step 4 |
| `/dashboard/products/new/competitors` | `new/competitors/page.tsx` | Intake step 5 |
| `/dashboard/products/new/markets` | `new/markets/page.tsx` | Intake step 6 |
| `/dashboard/products/new/confirm` | `new/confirm/page.tsx` | Intake step 7 |
| `/dashboard/workspaces` | `workspaces/page.tsx` | Workspaces (Studio) |
| `/dashboard/workspaces/:id` | `workspaces/[id]/page.tsx` | Workspace detail |
| `/dashboard/settings` | `settings/page.tsx` | Settings (7 tabs) |
| `/dashboard/intelligence/growth-brain` | Growth Brain | |
| `/dashboard/intelligence/memory` | Marketing Memory | |
| `/dashboard/intelligence/knowledge` | Knowledge Graph | |
| `/dashboard/intelligence/market` | Market Intelligence | |
| `/dashboard/intelligence/reviews` | Review Intelligence | |
| `/dashboard/intelligence/timeline` | Timeline | |
| `/dashboard/intelligence/ideas` | Ideas | |
| `/dashboard/intelligence/ai-audit` | AI Audit | |

---

## 3. Public Pages

### `app/page.tsx` — Marketing Homepage

Dark navy hero (`--sidebar` background). Sections:

**Nav** (sticky, dark, `background: rgba(40,48,74,0.97)`, `backdrop-filter: blur(12px)`):
- Logo: `Launch` + `Mind` (green accent #34d399) in Syne 700
- Links: How it works / Features / Markets / Pricing / Security
- CTAs: Sign in (ghost, border) + Start free (sage bg)

**Hero**:
- Badge: "AI marketing OS for app founders" (sage tint pill)
- H1: "Stop guessing how to **market your app**" — Syne 800, `clamp(40px,6vw,68px)`, green "market your app"
- Sub: "Paste your App Store or Play Store URL. LaunchMind builds your strategy, writes your content, runs your campaigns, and tells you what's working — every week."
- Primary CTA: "Start free — no card required →" (sage bg, large)
- Secondary: "See it in 90 seconds" (ghost, IconPlayerPlay)
- Fine print: "Free forever · No credit card · 3-minute setup"
- Market badges: 🇺🇸 USA · Stripe · USD (sage) + 🇮🇳 India · Razorpay · INR (amber)
- Mini dashboard mockup (dark sidebar + metric cards + product list preview)

**Sections**: How it works (4 steps), Features (6 cards), Markets (USA+India CPI data), Pricing (4-tier grid), Security (MFA/AES-256/RLS badges), Footer CTA (waitlist email).

---

## 4. Auth Pages

### `login/page.tsx`
Email + password form. Supabase `signInWithPassword()`. On MFA required → redirect to `/mfa`. OAuth future-ready slots. Uses `actions.ts` for server action form submission.

### `signup/page.tsx`
Email + password + name. Supabase `signUp()`. Triggers `auto_create_founder_on_signup` DB trigger (migration 022) which creates the `founders` row.

### `mfa/page.tsx`
6-digit TOTP input. `supabase.auth.mfa.challengeAndVerify()`. Redirect to `/dashboard/brief` on success.

### `forgot-password/page.tsx`
Email input. `supabase.auth.resetPasswordForEmail()`. Resend link.

### `reset-password/page.tsx`
New password + confirm. `supabase.auth.updateUser({ password })`.

---

## 5. Dashboard Layout

### `app/(dashboard)/layout.tsx`
```tsx
<div className="flex h-screen">
  <Sidebar />                          {/* dark navy, lg:flex hidden on mobile */}
  <main className="flex-1 overflow-y-auto bg-page pb-16 lg:pb-0">
    {children}
  </main>
  <MobileNav />                        {/* bottom tab bar, lg:hidden */}
</div>
```

`Sidebar.tsx`:
- `hidden lg:flex flex-col` (mobile hidden)
- Width: 196px, background: `--sidebar` (#28304a)
- Logo: LaunchMind in Syne 700, `Mind` in sage-l (#34d399)
- Nav items: active state = `bg-[--sage-d] border border-[--sage-b] text-[--sage-l]`, inactive = `text-[--s-text2] hover:bg-white/6`
- Tabler icons v3 (Icon prefix), size 16
- Plan badge at bottom
- Token balance display

`MobileNav.tsx`:
- `flex lg:hidden` — 5-item bottom tab bar
- `bg-sidebar`, height 56px + iOS safe-area-inset-bottom
- Items: Brief / Campaigns / Content / Ask / More

`app/(dashboard)/error.tsx`:
- Route group error boundary
- Renders `<ErrorState>` with retry button
- Sentry-ready: `useEffect(() => { Sentry.captureException(error); }, [error])`

`app/(dashboard)/dashboard/not-found.tsx`:
- 404 handler
- "Back to home" link to /dashboard/brief

---

## 6. Primary Dashboard Pages

### `brief/page.tsx` — Morning Brief (Primary Entry Point)

**State**: `data: BriefResponse | null`, `loading`, `recState: 'loading'|'ready'|'failed'`, `token`

**Data flow**: `api.owner.brief(token)` → single fetch, no polling. 8-second hard ceiling on recommendation state.

**Layout**:
```
Header
  ├── Greeting + narrative ("I reviewed {productName} overnight. {rec.title}")
  ├── Product name (12px, ink3)
  └── 3-up MetricCard grid: Installs this week (+delta%) | Avg CPI | Active campaigns

SinceThenStrip (suppressed if only-bullet = approvals AND banner showing)

ApprovalBanner (amber, full-width, links to /approvals)

Main grid [1fr 360px on xl]
  Left:
    ├── Today's recommendation (RecommendationCard or skeleton/unavailable)
    ├── Growth opportunities (up to 3 OpportunityCards)
    └── Ask LaunchMind (AskBox with 4 starters)
  Right:
    ├── Growth Brain status card
    ├── What I learned (marketing_memories, violet --ai-b left border)
    ├── Awaiting approval (if pendingApprovals.total > 0)
    └── Recent activity (recentTimeline events)
```

**RecommendationCard**: sage border-1.5, sparkle icon, `rec.title` bold, `rec.summary` body, WhyThisPanel expandable, ConfidenceBadge, action button (sage bg → /missions).

**SinceThenStrip**: Bullets from BriefResponse. If `bullets.length === 1 && bannerVisible` → return null (deduplication).

**"What I learned" panel**: Top-2 marketing memories from BriefResponse. Violet `--ai-b` left border per memory. Shows `mem.memoryType` label (uppercase, ink3), `mem.body ?? mem.title` text, ConfidenceBadge. AIBadge in panel header. Link → /intelligence/memory.

### `opportunities/page.tsx` — Growth Backlog
Filter tabs: Active / Saved / All. Each opportunity: title, expected_impact (sage), why_now, effort/risk tags. Actions: Save / Dismiss / Create Mission. EvidenceChips via toStringArray().

### `ask/page.tsx` — Ask LaunchMind
8 starter prompts. Free-text input. `api.owner.ask(q, token)` → structured answer: summary, recommendedAction (sage), evidence chips, suggestedMissionType. Full answer modal with WhyThisPanel.

### `approvals/page.tsx` — Unified Approvals
Two sections: Campaign approvals + Mission approvals. Individual approve/reject per item (paid campaigns = individual approval). Uses `api.owner.brief` for pending count, then `api.campaigns` / `api.missions.approvals` for details.

### `campaigns/page.tsx` — Campaigns
Channel filter pills. Table: channel icon (bare, no box) + market badge + status badge + copy preview + spend cap + CTA. Launch flow: pending_approval → approved (ApprovalCard inline) → launched. Channel icons: bare colored icons (no square background).

### `experiments/page.tsx` — A/B Experiments
Create dialog (title + hypothesis). Variant cards (A/B) with metrics (impressions/clicks/installs/CPI). Start / Select Winner / Archive lifecycle. Learning summary display after winner selected.

### `calendar/page.tsx` — Execution Calendar
Month view (mini grid with event pills by type color) + List view. Prev/next month navigation. Create event dialog (title + type + date). Delete authored events. Auto-scheduled events from campaigns/experiments/briefs are non-deletable (shown in gray).

### `content/page.tsx` — Content Studio
Three-tab layout: Library | Generate | Stats.
- **Library**: Search + type/status filter pills + asset grid (AssetBlock components) + pagination.
- **Generate**: 31-type selector grid with channel filter pills + options panel (market/style selector).
- **Stats**: 4 aggregate cards + type breakdown bar chart.
- **Editor panel** (right drawer): text edit + 7 AI transforms + version history slider + publish button.

### `campaigns/page.tsx`, `briefs/page.tsx`
Responsive: `p-4 sm:p-6 lg:p-8` outer padding. Full-width content area (no max-width on outer wrapper).

### `missions/page.tsx` — Mission Center
Mission list with status filter pills (all/running/completed/failed). Create mission modal (type + title). Retry button on failed missions. Approval banner when `pendingApprovals.total > 0`. EmptyState when no missions.

### `missions/[id]/page.tsx` — Mission Detail
Step cards (expandable — shows input/output/error). Execution log feed. Progress bar. ApprovalCard (approve/reject + note). Auto-polls every 5s when mission is running. Stops polling on completed/failed/cancelled.

### `analytics/page.tsx` — Analytics
4 KPI cards (cross-product totals). Install funnel with per-channel breakdown. ROI table by channel. AI optimization insights panel (apply/dismiss). Weekly installs sparkline. Product tab selector. "Generate insights" button → `POST /analytics/optimize`.

### `reports/page.tsx` — Reports
Report grid with type badge + period. Generate form (type + date range picker). Report drawer: headline callout, whatWorked / fix / insights / actions sections. JSON export download. 1–5 star feedback.

### `products/page.tsx` — Products List
Product cards with platform badge (App Store / Play Store), market tags, campaign count. Three-dot ProductMenu: View / Archive / Edit. ArchivedSection (collapsible, shows archived products with Restore action).

---

## 7. Product Intake Wizard (7 Steps)

Progress bar: `IntakeSteps.tsx` — 7-step with active/completed/pending states.
State persisted to `sessionStorage` (INTAKE_STORAGE keys from `lib/types/intake.ts`).

### Step 1: `/products/new` — URL Entry
Multi-URL input: Play Store URL + App Store URL + Website URL. At least one required. "Analyze my app →" → calls `api.products.setupStart()` → creates product + queues intake job → navigate to step 2.

### Step 2: `/products/new/context` — Founder Context
5 contextual questions (ChipGroup selection UI):
1. Primary marketing channel preference
2. Target markets (USA / India / Both)
3. Current monthly budget range
4. Biggest marketing challenge
5. Any specific campaigns running now

Screenshot upload (optional). "Save & continue →" → `api.products.saveIntakeStep(2, context)`.

### Step 3: `/products/new/analysis` — Live Analysis
Polls `/products/intake/status` every 2s. Shows 6 progress items with animated states:
1. Scraping App Store / Play Store
2. Analysing reviews
3. Building competitor map
4. Structuring ICP
5. Collecting marketing images
6. Extracting brand voice

On completion: saves auto-detected `logoUrl` from `websiteMeta` to sessionStorage.

### Step 4: `/products/new/icp` — ICP Review
Inline editable fields: target persona, pain points (chip UI with add/remove), goals, channels. "Looks right →" → `api.products.saveIntakeStep(4, icp)`.

### Step 5: `/products/new/competitors` — Competitors
List of auto-discovered competitors. Actions: Confirm / Reject / Add custom. "Continue →" → `api.products.saveIntakeStep(5, competitors)`.

### Step 6: `/products/new/markets` — Markets
4-market grid: USA (sage), India (amber), Canada, UK. CPI estimates per market. Amber alerts for India: "UPI install base: 400M users". Sage indicators for strong market signals. "Continue →" → `api.products.saveIntakeStep(6, markets)`.

### Step 7: `/products/new/confirm` — Confirm & Launch
3-column summary: Product info + ICP + Competitors.
MOAT box (brand differentiation from confirmed_icp).
**Brand assets card**: 48×48 logo preview (if auto-detected), logo URL input (pre-filled), "Include logo in ads" toggle.
Strategy preview (30/60/90 pillars).
"Generate strategy →" → `api.products.confirmEnriched({ logoUrl, includeLogo })` → navigate to `/dashboard/products/:id/strategy`.

---

## 8. Intelligence Pages

### `intelligence/layout.tsx`
Tab navigation: Growth Brain / Memory / Knowledge Graph / Market / Reviews / Timeline / Ideas / AI Audit

### `intelligence/growth-brain/page.tsx`
- Multi-product switcher (shown when >1 product)
- ICP display: target persona, pain points, channels
- Brand voice panel: tone, style, vocabulary examples
- Confidence bars for each ICP dimension
- "No products" → "Add app" CTA; "No active product" → product picker
- Links to strategy and memory

### `intelligence/memory/page.tsx`
Two-column layout: left memories / right learning events timeline.
- Search input + filter tabs (all/brand/product/customer/campaign/founder)
- MemoryCard: title, type badge (violet --ai), confidence bar, body preview, source, edit/archive actions
- LearningEventRow: event_type, timestamp, processed badge
- ConfidenceBar component (0-100 gradient bar)

### `intelligence/knowledge/page.tsx`
- NodeGroup (collapsible by node_type): expand to see nodes
- ConfidenceDot: colored dot sized by confidence
- RelationshipRow: "Product X outperforms Channel Y" (plain English)
- Stats grid: total nodes, total edges, avg confidence
- Delete node (with confirmation)

### `intelligence/market/page.tsx`
- Category benchmarks: install delta, conversion, D7 retention, top channel
- 30-day trend badges (up/down/flat with percentage)
- Competitor grid with per-product tab selector, real scraped_meta data
- Synthetic benchmark label when signalCount < 20 (seed data disclosure)
- ErrorState with retry on fetch failure

### `intelligence/reviews/page.tsx`
- Overall rating star display + review count
- Sentiment breakdown: positive/negative/neutral percentages with colored bars
- Star distribution (1-5) with bar chart
- Recurring themes chips
- AI review summary callout (violet --ai border)
- Expandable review cards with sentiment filter pills
- Product tab selector
- Data from `products.scraped_meta` (no separate reviews table)

### `intelligence/ai-audit/page.tsx`
- 4 stat cards: total requests, tokens consumed, total cost ($), success rate
- Model breakdown grid: Sonnet vs Haiku requests/tokens/cost
- Paginated request table: time, prompt, model, status badge, input/output tokens, cost, latency, retries
- Filter by status (success/failed/timeout) + promptId
- Pagination (20 per page)

---

## 9. Settings Pages

### `settings/page.tsx`
Left nav (170px) + content area. 7 tabs:

| Tab | File | Contents |
|-----|------|----------|
| Profile | ProfileTab.tsx | Name, avatar, email (read-only), timezone |
| Security | SecurityTab.tsx | Password change, MFA status (always enabled), active sessions |
| Content types | ContentTypesTab.tsx | Default image style picker (photo/graphic/mockup), logo URL input |
| Voice clone | VoiceCloneTab.tsx | Upload voice sample → ElevenLabs voice clone ID |
| Notifications | NotificationsTab.tsx | Email notification preferences |
| Products | ProductsTab.tsx | List products, archive/restore from settings |
| Account | AccountManagementTab.tsx | Delete account (type "DELETE" to confirm), data export |

### `settings/billing/page.tsx`
Plan comparison grid (2-col at normal width, grid-cols-2 xl:grid-cols-4 for token top-ups). Current plan highlighted with indigo border. Upgrade/downgrade CTA. Token top-up packs.

### `settings/usage/page.tsx`
Token usage history chart. Current balance. Monthly token burn rate.

### `workspaces/page.tsx` (Studio-gated)
Studio plan required. Workspace list (create/delete). Brand voice preview per workspace.

### `workspaces/[id]/page.tsx`
Workspace detail: name, client name, member list. Invite by email. Remove member. Role management (owner/admin/member).

---

## 10. Components Library

All in `components/launchmind/`. Every component uses CSS variable design tokens. No inline dark colors.

### `Sidebar.tsx`
```tsx
// hidden lg:flex flex-col — desktop only
// Mobile: MobileNav handles it
// Active item: bg-[var(--sage-d)] border border-[var(--sage-b)] text-[var(--sage-l)]
// Inactive: text-[var(--s-text2)] hover:bg-white/6
// Icons: @tabler/icons-react v3, size={16}, outline only
```

### `MobileNav.tsx`
```tsx
// flex lg:hidden — mobile only
// Position: fixed bottom-0, full width
// bg-sidebar (dark navy), height 56px
// 5 items: Brief / Campaigns / Content / Ask / More
// style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} — iOS support
// IMPORTANT: use className="flex lg:hidden" not inline display style
// (inline style overrides Tailwind lg:hidden — always use Tailwind class)
```

### `MetricCard.tsx`
```tsx
interface MetricCardProps {
  label: string;
  value: string | number;
  delta?: string;          // "+12%" auto-colors sage; "-3%" auto-colors danger
  sub?: string;            // secondary context line
  accent?: 'sage'|'indigo'|'amber'|'danger';
  insight?: string;        // violet (--ai) AI interpretation text
  confidence?: number;     // 0-100, shows badge if insight provided
}
// bg-surface border border-[--border] rounded-[10px] p-[14px_16px]
// value: font-mono 22px
// delta: font-mono 11px auto-colored by + / - prefix
```

### `AIBadge.tsx`
```tsx
// "✦ AI generated" — violet bg (--ai-d), border (--ai-b), text (--ai)
// font-size: 10px, padding: '2px 7px', border-radius: var(--r3)
// Use ONLY for AI-generated content provenance
// NEVER use violet for buttons or interactive elements
```

### `ConfidenceBadge.tsx`
```tsx
// value: 0-100 (normalized — always pass as 0-100, not 0-1)
// Renders as: "82%" in violet badge (--ai-d / --ai-b / --ai)
// Used in: RecommendationCard, OpportunityCard, MemoryCard, "What I learned" panel
```

### `EvidenceChips.tsx`
```tsx
interface EvidenceChipsProps {
  chips: unknown;   // ALWAYS use unknown — jsonb can be anything
}
// Internally calls toStringArray(chips) for safe coercion
// Renders each string as a small pill: bg-raised border border-[--border2] text-ink3
```

### `WhyThisPanel.tsx`
```tsx
interface WhyThisPanelProps {
  signal: string;            // whyNow
  evidence: unknown;         // toStringArray() internally
  confidence: number;        // 0-100
  risk?: string;
  source?: string;
}
// Expandable accordion (collapsed by default)
// Header: "Why now?" with ChevronDown/Up
// Body: signal text, evidence chips, confidence badge, risk/source if provided
```

### `Button.tsx`
```tsx
// 4 variants: solid (sage bg), ghost (border + ink2), sage (sage-d bg + sage-b border), danger
// 3 sizes: sm (px-2.5 py-1 text-[11px]), md (px-3 py-1.5 text-[12px]), lg (px-4 py-2 text-[13px])
// All variants use rounded-[var(--r2)]
```

### `AssetBlock.tsx`
```tsx
// Renders all 31 content asset types
// Text assets: markdown display, edit button
// Video assets: video player (if videoUrl), script text
// Visual assets: image preview, style selector pills (📷 Photo / 🎨 Graphic / 📱 Mockup)
// Audio: audio player (if audioUrl), transcript
// Actions: download, regenerate, edit, style override
// onGenerateImage(id: string, style?: ImageStyle) callback
```

### `IntakeSteps.tsx`
```tsx
// 7-step progress bar
// completed: sage checkmark + full color
// active: sage border + bold label
// pending: ink3 color + lighter
```

### `ProductMenu.tsx`
```tsx
// Three-dot (IconDots) overflow menu per product card
// Options: View / Edit / Archive / Restore (context-dependent)
// Uses: IconDots, IconEye, IconPencil, IconArchive, IconArchiveOff
```

### `EmptyState.tsx`, `ErrorState.tsx`, `LoadingState.tsx`
The state trio. Every data-dependent section uses one of these three.
```tsx
<EmptyState title="No campaigns yet" description="..." action={{ label: "Create", href: "/..." }} />
<ErrorState title="Couldn't load" description="..." onRetry={() => refetch()} />
<LoadingState />   // pulsing skeleton
```

### `PageShell.tsx`
```tsx
<PageShell title="Campaigns" subtitle="Manage your active campaigns">
  {children}
</PageShell>
// Renders: page title (Syne), subtitle, optional breadcrumb
```

---

## 11. Design System v1.0

### CSS Variables (`app/globals.css`)

```css
:root {
  /* Surfaces */
  --page:      #f2f3f6;
  --surface:   #ffffff;
  --raised:    #eceef3;
  --sidebar:   #28304a;
  --sidebar-2: #323c58;

  /* Borders */
  --border:    rgba(27,31,46,0.07);
  --border2:   rgba(27,31,46,0.12);
  --s-border:  rgba(255,255,255,0.07);

  /* Sidebar text */
  --s-text:    rgba(255,255,255,0.88);
  --s-text2:   rgba(255,255,255,0.42);
  --s-text3:   rgba(255,255,255,0.22);

  /* Ink (text) */
  --ink:       #1b1f2e;
  --ink2:      #626880;
  --ink3:      #9ca4be;

  /* Sage — ALL interactive actions, primary CTA, success */
  --sage:      #059669;
  --sage-l:    #34d399;
  --sage-d:    rgba(5,150,105,0.12);
  --sage-b:    rgba(5,150,105,0.28);

  /* Indigo — accent, current plan badge */
  --indigo:    #4f46e5;
  --indigo-d:  rgba(79,70,229,0.10);
  --indigo-b:  rgba(79,70,229,0.22);

  /* Amber — India market, warnings */
  --amber:     #d97706;
  --amber-d:   rgba(217,119,6,0.10);
  --amber-b:   rgba(217,119,6,0.22);

  /* Danger — errors, negative delta, kill signals */
  --danger:    #dc2626;
  --danger-d:  rgba(220,38,38,0.09);
  --danger-b:  rgba(220,38,38,0.22);

  /* AI — provenance ONLY. Border/badge/text. Never button. Never gradient fill. */
  --ai:        #7c5cff;
  --ai-d:      rgba(124,92,255,0.10);
  --ai-b:      rgba(124,92,255,0.22);
  --ai-l:      #a78bfa;

  /* Radius */
  --r:         10px;
  --r2:        6px;
  --r3:        4px;
  --r-full:    9999px;

  /* Elevation */
  --e1:        0 1px 3px rgba(0,0,0,0.07);
  --e2:        0 4px 12px rgba(0,0,0,0.09);
  --e3:        0 8px 24px rgba(0,0,0,0.12);

  /* Motion */
  --dur-fast:  120ms;
  --dur:       180ms;
  --dur-slow:  280ms;
  --ease:      cubic-bezier(0.4, 0, 0.2, 1);
  --ease-out:  cubic-bezier(0, 0, 0.2, 1);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### Typography

| Usage | Font | Size | Weight |
|-------|------|------|--------|
| Body text | DM Sans | 13px | 400 |
| Body line-height | | | 1.5 |
| Headings, sidebar logo, section titles | Syne | varies | 600–800 |
| Metrics, token counts, data values, code | DM Mono | varies | 400–500 |

Google Fonts loaded: `Syne:wght@400;500;600;700;800` + `DM+Sans:wght@300;400;500` + `DM+Mono:wght@400;500`

### Component Conventions

```css
/* Card */
background: var(--surface);
border: 1px solid var(--border);
border-radius: var(--r);       /* 10px */
padding: 14px 16px;

/* Card featured (recommendation) */
border: 1.5px solid var(--sage-b);

/* Input */
background: var(--raised);
border: 1px solid var(--border2);
border-radius: var(--r2);      /* 6px */
padding: 8px 12px;
/* focus: border-[--sage-b], ring-2 ring-[--sage-d] */

/* Button solid */
background: var(--sage);
color: white;
border-radius: var(--r2);

/* Button ghost */
border: 1px solid var(--border2);
color: var(--ink2);
/* hover: background: var(--raised) */

/* Button sage (tint) */
background: var(--sage-d);
border: 1px solid var(--sage-b);
color: var(--sage);
border-radius: var(--r2);

/* Sidebar nav item */
color: var(--s-text2);
border-radius: var(--r2);
margin: 0 6px;
/* hover: background: rgba(255,255,255,0.06) */
/* active: background: var(--sage-d), border: 1px solid var(--sage-b), color: var(--sage-l) */

/* Metric block */
background: var(--raised);
border-radius: var(--r2);
padding: 11px 13px;

/* Topbar */
background: var(--surface);
border-bottom: 1px solid var(--border);
```

### Badge Conventions

| Type | Background | Border | Text color |
|------|------------|--------|------------|
| USA market | `--sage-d` | `--sage-b` | `#046c4e` |
| India market | `--amber-d` | `--amber-b` | `#92400e` |
| Draft | `--raised` | `--border2` | `--ink2` |
| Active/Success | `--sage-d` | `--sage-b` | `--sage` |
| Pending | `--amber-d` | `--amber-b` | `--amber` |
| Error/Pausing | `--danger-d` | `--danger-b` | `--danger` |
| Accent/Indigo | `--indigo-d` | `--indigo-b` | `--indigo` |
| AI | `--ai-d` | `--ai-b` | `--ai` |

### Icons (`@tabler/icons-react` v3)
- **Prefix**: `Icon` (NOT `Tb` — that's v2)
- **Style**: Outline only, never filled
- **`size` prop**: accepts `string | number` (`size={16}` or `size="16"`)

Commonly used icons:
```
IconLayoutDashboard  IconSparkles        IconBolt
IconRoute            IconSpeakerphone    IconFileAnalytics
IconPlug             IconCreditCard      IconSettings
IconCheck            IconAlertCircle     IconShieldCheck
IconArrowRight       IconBrandWhatsapp   IconBrandFacebook
IconBrandGoogle      IconBrandLinkedin   IconMail
IconLock             IconDownload        IconDots
IconArchive          IconEye             IconPencil
IconChevronDown      IconChevronUp       IconSearch
IconX                IconRefresh         IconPlayerPlay
```

### Tailwind Config

Extended from default in `tailwind.config.ts`:
```javascript
colors: {
  page: 'var(--page)',
  surface: 'var(--surface)',
  raised: 'var(--raised)',
  sidebar: 'var(--sidebar)',
  ink: 'var(--ink)',
  ink2: 'var(--ink2)',
  ink3: 'var(--ink3)',
  sage: 'var(--sage)',
  indigo: 'var(--indigo)',
  amber: 'var(--amber)',
  danger: 'var(--danger)',
  ai: { DEFAULT: 'var(--ai)', d: 'var(--ai-d)', b: 'var(--ai-b)', l: 'var(--ai-l)' },
}
fontSize: {
  lg: '18px',
  xl: '24px',
  '2xl': '32px',
}
transitionDuration: { fast: '120ms', DEFAULT: '180ms', slow: '280ms' }
boxShadow: { e1: 'var(--e1)', e2: 'var(--e2)', e3: 'var(--e3)' }
```

---

## 12. API Client (`lib/api.ts`)

All namespaces and key methods:

```typescript
// Core pattern: every call takes a token param
api.owner.brief(token): Promise<BriefResponse>
api.owner.opportunities(token): Promise<{ opportunities: Opportunity[] }>
api.owner.ask(question, token): Promise<{ answer: AskResponse }>
api.owner.results(token): Promise<ResultsSummary>
api.owner.notifications(token): Promise<{ notifications: Notification[]; unreadCount: number }>

api.products.list(token): Promise<Product[]>
api.products.get(id, token): Promise<Product>
api.products.create(body, token): Promise<Product>
api.products.confirm(id, body, token): Promise<Product>
api.products.confirmEnriched(id, { logoUrl, includeLogo }, token): Promise<Product>
api.products.generateStrategy(id, token): Promise<void>
api.products.setupStart(urls, token): Promise<{ productId: string }>
api.products.saveIntakeStep(step, data, token): Promise<void>
api.products.completeIntake(token): Promise<Product>
api.products.intakeStatus(token): Promise<IntakeStatus>
api.products.archive(id, reason, token): Promise<void>
api.products.restore(id, token): Promise<void>
api.products.activate(id, token): Promise<void>
api.products.generateImage(assetId, token, style?): Promise<ContentAsset>

api.campaigns.create(body, token): Promise<Campaign>
api.campaigns.list(token): Promise<Campaign[]>
api.campaigns.launch(id, token): Promise<void>
api.campaigns.schedule(id, scheduledAt, token): Promise<void>
api.campaigns.cancel(id, token): Promise<void>

api.studio.generate(body, token): Promise<ContentAsset>
api.studio.listAssets(filters, token): Promise<{ assets: ContentAsset[]; total: number }>
api.studio.getAsset(id, token): Promise<ContentAsset>
api.studio.transform(id, transformType, token): Promise<ContentAsset>
api.studio.publish(id, channel, token): Promise<void>
api.studio.archive(id, token): Promise<void>
api.studio.restore(id, token): Promise<void>
api.studio.stats(token): Promise<StudioStats>

api.missions.create(body, token): Promise<Mission>
api.missions.list(token): Promise<Mission[]>
api.missions.get(id, token): Promise<{ mission: Mission; steps: MissionStep[] }>
api.missions.approvals(token): Promise<MissionApproval[]>
api.missions.cancel(id, token): Promise<void>
api.missions.retry(id, token): Promise<void>
api.missions.respond(id, stepId, status, note, token): Promise<void>

api.memory.list(token): Promise<MarketingMemory[]>
api.memory.search(query, token): Promise<MarketingMemory[]>
api.memory.ingest(event, token): Promise<void>

api.knowledge.graph(token): Promise<KnowledgeGraph>

api.ai.context(productId, token): Promise<AIContextPackage>
api.ai.audit(filters, token): Promise<{ requests: AIRequest[]; total: number }>
api.ai.auditStats(token): Promise<AIAuditStats>

api.analytics.summary(token): Promise<AnalyticsSummary>
api.analytics.kpi(productId, token): Promise<KPIPoint[]>
api.analytics.insights(token): Promise<OptimizationInsight[]>

api.recommendations.list(token): Promise<Recommendation[]>
api.recommendations.generate(productId, token): Promise<Recommendation[]>
api.recommendations.convert(id, token): Promise<Mission>

api.benchmarks.get(category, market, token): Promise<BenchmarkResult>
api.benchmarks.trends(category, market, token): Promise<TrendSummary>

api.calendar.list(month, token): Promise<CalendarEvent[]>
api.experiments.list(token): Promise<Experiment[]>
api.experiments.winner(id, variantLabel, token): Promise<void>

api.workspaces.list(token): Promise<Workspace[]>
api.billing.status(token): Promise<BillingStatus>
api.settings.getContentPreferences(token): Promise<ContentPreferences>
api.settings.updateContentPreferences(body, token): Promise<ContentPreferences>
api.founders.me(token): Promise<Founder>
api.founders.deleteAccount(token): Promise<void>
api.founders.export(token): Promise<Blob>
```

**BriefResponse** (key type):
```typescript
export interface BriefResponse {
  founder:     { name: string; plan: string };
  product:     { id: string; name: string; platform: string } | null;
  recommendation: {
    title: string; summary: string; whyNow: string;
    confidence: number; evidence: string[]; action: string; missionType: string | null;
  } | null;
  pendingApprovals: { total: number; items: Array<{ id, type, title, preview, missionId }> };
  opportunities: Opportunity[];
  recentTimeline: TimelineEvent[];
  growthBrain: { hasStrategy: boolean; confidence: number | null; lastUpdated: string | null };
  metrics: { weeklyInstalls: number | null; cpi: number | null; activeCampaigns: number; weekOverWeekInstallDelta: number | null };
  memories: Array<{ id: string; title: string; body: string | null; memoryType: string; confidence: number }>;
}
```

---

## 13. Utility Libraries

### `lib/coerce.ts`
Defensive coercion for JSONB fields (never throw):
```typescript
export function toStringArray(value: unknown): string[]
// Handles: string[] ✓, JSON.stringify'd array ✓, null/undefined → [], objects → values, scalars → [String(x)]

export function toRecord(value: unknown): Record<string, unknown>
// Handles: object ✓, JSON string ✓, null/undefined → {}, arrays → {}
```

Critical usage: `evidence` field in `saved_opportunities` can be any JSONB shape. Always use `toStringArray(opp.evidence)` before rendering `EvidenceChips`. Never trust the TypeScript type alone.

### `lib/supabase/client.ts`
```typescript
export function createClient(): SupabaseClient
// Browser-side Supabase client (anon key)
// Uses @supabase/ssr get/set/remove (NOT getAll/setAll — that's 0.2.x API, silently breaks auth)
```

### `middleware.ts`
Next.js edge middleware. Runs before every request.
- Unauthenticated → /login
- Authenticated + hitting / → /dashboard/brief
- Authenticated + hitting /login → /dashboard/brief

---

## 14. Key Patterns & Rules

### No max-width on page outer wrapper
```tsx
// CORRECT: full-width content area
<div className="p-4 sm:p-6 lg:p-8">
  {/* content fills full available width (viewport − 196px sidebar) */}
</div>

// WRONG: never do this
<div className="max-w-5xl mx-auto p-6">
```

### Fresh JWT on every user action
```tsx
// CORRECT: fetch fresh session inside action handler
const handleSubmit = async () => {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = '/login'; return; }
  await api.products.generateStrategy(id, session.access_token);
};

// WRONG: using a stale token stored in state from page load (15-min JWT expires)
// const { token } = useAuth();  // ← may be stale if user sits on page > 15 min
```

### Inline style vs Tailwind responsive
```tsx
// CORRECT: Tailwind responsive class controls display
<div className="flex lg:hidden">   // MobileNav: hidden on desktop

// WRONG: inline style overrides Tailwind responsive variants
// style={{ display: 'flex' }} className="lg:hidden"  // lg:hidden won't work
```

### JSONB field safety
```tsx
// CORRECT: always coerce before use
import { toStringArray } from '@/lib/coerce';
<EvidenceChips chips={opp.evidence} />  // EvidenceChips uses toStringArray internally

// WRONG: trusting TypeScript type for DB-sourced JSONB
// opp.evidence.map(...)  // ← crashes if DB returns non-array
```

### Supabase session in intake wizard
```tsx
// All 7 intake pages: fetch fresh session inside every action handler
// (prevents stale 15-min JWT from causing 401 at button-click time)
const handleContinue = async () => {
  const { data: { session } } = await createClient().auth.getSession();
  if (!session) { window.location.href = '/login'; return; }
  await api.products.saveIntakeStep(stepNum, data, session.access_token);
  router.push(nextStep);
};
```

---

*Continue to: [LMJuly18-05-Intelligence-Agents.md](./LMJuly18-05-Intelligence-Agents.md)*
