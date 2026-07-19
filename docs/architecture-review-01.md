# Architecture Review — Milestone 01
Status: Complete
Date: July 2026
Reviewer: Claude Code

---

## 1. Frontend Routes Inventory

| Route | File | Status | Notes |
|---|---|---|---|
| `/` | `app/page.tsx` | Exists | Root redirect only — no homepage content |
| `/login` | `app/(auth)/login/page.tsx` | Exists | Supabase auth |
| `/signup` | `app/(auth)/signup/page.tsx` | Exists | Supabase auth |
| `/mfa` | `app/(auth)/mfa/page.tsx` | Exists | TOTP |
| `/forgot-password` | `app/(auth)/forgot-password/page.tsx` | Exists | Resend |
| `/reset-password` | `app/(auth)/reset-password/page.tsx` | Exists | Supabase |
| `/pricing` | `app/pricing/page.tsx` | Exists | Marketing pricing page |
| `/checkout/success` | `app/checkout/success/page.tsx` | Exists | Stripe return |
| `/dashboard` | `app/(dashboard)/dashboard/page.tsx` | Exists | Home dashboard |
| `/dashboard/products` | `...products/page.tsx` | Exists | Product list |
| `/dashboard/products/new` | `...products/new/page.tsx` | Exists | Step 1: URLs |
| `/dashboard/products/new/context` | `...context/page.tsx` | Exists | Step 2: Story |
| `/dashboard/products/new/analysis` | `...analysis/page.tsx` | Exists | Step 3: Progress |
| `/dashboard/products/new/icp` | `...icp/page.tsx` | Exists | Step 4: ICP |
| `/dashboard/products/new/competitors` | `...competitors/page.tsx` | Exists | Step 5 |
| `/dashboard/products/new/markets` | `...markets/page.tsx` | Exists | Step 6 |
| `/dashboard/products/new/confirm` | `...confirm/page.tsx` | Exists | Step 7 |
| `/dashboard/products/[id]` | `...products/[id]/page.tsx` | Exists | Product detail |
| `/dashboard/products/[id]/strategy` | `...strategy/page.tsx` | Exists | 30/60/90 strategy |
| `/dashboard/campaigns` | `...campaigns/page.tsx` | Exists | Campaign list |
| `/dashboard/briefs` | `...briefs/page.tsx` | Exists | Weekly briefs |
| `/dashboard/channels` | `...channels/page.tsx` | Exists | Channel connections |
| `/dashboard/billing` | `...billing/page.tsx` | Exists | Billing + plan |
| `/dashboard/settings` | `...settings/page.tsx` | Exists | Settings shell |
| `/dashboard/settings/[tab]` | `...settings/[tab]/page.tsx` | Exists | Tab router |
| `/dashboard/settings/billing` | `...settings/billing/page.tsx` | Exists | Settings > billing |
| `/dashboard/settings/usage` | `...settings/usage/page.tsx` | Exists | Token usage |
| `/dashboard/workspaces` | `...workspaces/page.tsx` | Exists | Studio workspaces |
| `/dashboard/workspaces/[id]` | `...workspaces/[id]/page.tsx` | Exists | Workspace detail |
| `/dashboard/insights` | `...insights/page.tsx` | Exists | Cross-product KPIs |
| `/dashboard/metrics` | `...metrics/page.tsx` | Exists | Metrics |
| `/dashboard/admin` | `...admin/page.tsx` | Exists | Admin only |
| `/dashboard/admin/mrr` | `...admin/mrr/page.tsx` | Exists | MRR dashboard |
| `/dashboard/brief` | — | **MISSING** | Morning Brief |
| `/dashboard/opportunities` | — | **MISSING** | Opportunities |
| `/dashboard/ask` | — | **MISSING** | Ask LaunchMind |
| `/dashboard/missions` | — | **MISSING** | Missions |
| `/dashboard/approvals` | — | **MISSING** | Approvals queue |
| `/dashboard/results` | — | **MISSING** | Results |
| `/dashboard/content` | — | **MISSING** | Content Studio |
| `/dashboard/experiments` | — | **MISSING** | Experiments |
| `/dashboard/calendar` | — | **MISSING** | Calendar |
| `/dashboard/intelligence/growth-brain` | — | **MISSING** | Growth Brain |
| `/dashboard/intelligence/market` | — | **MISSING** | Market Intelligence |
| `/dashboard/intelligence/reviews` | — | **MISSING** | Reviews |
| `/dashboard/intelligence/ideas` | — | **MISSING** | Ideas Inbox |
| `/dashboard/intelligence/timeline` | — | **MISSING** | Timeline |

---

## 2. Layouts Inventory

| File | Covers | Notes |
|---|---|---|
| `app/layout.tsx` | Root | Google Fonts, globals.css, PostHog, Sentry |
| `app/(dashboard)/layout.tsx` | All dashboard routes | Auth gate, Sidebar, FeedbackWidget |
| `app/(dashboard)/dashboard/products/new/layout.tsx` | Intake wizard | IntakeSteps progress bar |

**Gap:** No layout for `/dashboard/intelligence/*` group. Needed for shared Intelligence header.

---

## 3. Components Inventory

**Existing custom components (`components/launchmind/`):**

| Component | Purpose | Keep / Refactor |
|---|---|---|
| `Sidebar.tsx` | Navigation | Refactor — new nav structure, switch lucide → Tabler icons |
| `AssetBlock.tsx` | Content asset renderer | Keep — extend for Content Studio |
| `BudgetRealityCard.tsx` | Budget display | Keep |
| `FeedbackWidget.tsx` | In-app feedback | Keep |
| `IntakeSteps.tsx` | Intake wizard progress | Keep |
| `PostHogIdentify.tsx` | Analytics identity | Keep |
| `PostHogProvider.tsx` | Analytics provider | Keep |
| `PricingCards.tsx` | Pricing display | Keep |
| `ProductMenu.tsx` | Three-dot product menu | Keep |
| `SettingsLayout.tsx` | Settings left-nav | Keep |
| `VideoConceptPicker.tsx` | Video style picker | Keep |

**Missing shared components (to create):**

| Component | Purpose |
|---|---|
| `PageShell` | Consistent page wrapper — title, breadcrumb, actions slot |
| `MetricCard` | Single KPI display (value, label, delta, trend) |
| `MissionCard` | Mission list item (objective, status, progress, actions) |
| `OpportunityCard` | Opportunity display (title, evidence, confidence, accept/dismiss) |
| `ApprovalCard` | Pending approval item (preview, context, approve/reject) |
| `TimelineCard` | Chronological event card |
| `EmptyState` | Consistent empty state (icon, heading, description, CTA) |
| `LoadingState` | Skeleton loader / spinner for async content |
| `ErrorState` | Error display (message, retry action) |
| `SectionHeader` | Page section heading with optional badge + action |

**Shadcn components (in `components/ui/` — DO NOT touch):**
Button, Input, Textarea, Select, Checkbox, Badge, Card, Dialog, Toast, Table, Tabs, Avatar, Progress, Drawer, Tooltip.

---

## 4. Backend Services Inventory

| Service | Responsibility | Status |
|---|---|---|
| `strategyService.ts` | 30/60/90 strategy generation | Complete — needs Context Engine integration |
| `contentService.ts` | 22 asset types, image, video, voice | Complete — needs Context Engine integration |
| `icpService.ts` | ICP build + website scrape | Complete |
| `reviewAnalysis.ts` | Review sentiment analysis | Complete |
| `briefService.ts` | Weekly brief generation | Complete |
| `playbookService.ts` | Playbook signal lookup | Complete |
| `brandVoiceService.ts` | Brand voice extraction | Complete |
| `billingService.ts` | Stripe + Razorpay | Complete |
| `marketingImagesService.ts` | Screenshot collection | Complete — Week 20 |
| `platformTokenService.ts` | OAuth token vault | Complete |
| `metricsService.ts` | Campaign metrics aggregation | Complete |
| `anonymizationService.ts` | PII anonymisation for signals | Complete |
| `utmService.ts` | UTM tracking | Complete |
| `whatsappService.ts` | WhatsApp Business API | Complete |
| `contextEngine.ts` | Unified AI context assembly | **MISSING** |
| `growthBrainService.ts` | Growth Brain CRUD | **MISSING** |
| `marketingMemoryService.ts` | Memory taxonomy | **MISSING** |
| `missionOrchestrator.ts` | Mission state machine | **MISSING** |
| `recommendationEngine.ts` | Opportunity scoring | **MISSING** |
| `decisionEngine.ts` | Business rules separation | **MISSING** |

---

## 5. Backend Routes Inventory

| Route | File | Notes |
|---|---|---|
| `POST /products/scrape` | `products.route.ts` | Async intake |
| `GET /products/scrape/:jobId` | `products.route.ts` | Job polling |
| `POST /products/intake/context` | `products.route.ts` | Step 2 save |
| `POST /products/intake/screenshots` | `products.route.ts` | Screenshot analysis |
| `POST /products/confirm` | `products.route.ts` | Step 7 confirm |
| `GET /products` | `products.route.ts` | List |
| `GET /products/archived` | `products.route.ts` | Archived list |
| `POST /products/:id/archive` | `products.route.ts` | Archive |
| `POST /products/:id/restore` | `products.route.ts` | Restore |
| `DELETE /products/:id` | `products.route.ts` | Permanent delete |
| `POST /products/:id/strategy/generate` | `products.route.ts` | Generate strategy |
| `GET /products/:id/strategy` | `products.route.ts` | Fetch strategy |
| `GET /content-assets/:productId` | `contentAssets.route.ts` | List assets |
| `POST /content-assets/:productId/generate` | `contentAssets.route.ts` | Generate batch |
| `POST /content-assets/:id/regenerate` | `contentAssets.route.ts` | Regen single |
| `POST /content-assets/:id/approve` | `contentAssets.route.ts` | Approve |
| `POST /content-assets/:id/generate-image` | `contentAssets.route.ts` | AI image |
| `GET /settings/content-preferences` | `settings.route.ts` | Fetch prefs |
| `PUT /settings/content-preferences` | `settings.route.ts` | Save prefs |
| `GET /founders/me` | `founders.route.ts` | Profile |
| `DELETE /founders/me` | `founders.route.ts` | GDPR delete |
| `GET /founders/me/export` | `founders.route.ts` | GDPR export |
| `GET /founders/insights` | `founders.route.ts` | Cross-product KPIs |
| `GET/POST /workspaces` | `workspaces.route.ts` | Workspace CRUD |
| `GET/POST /billing/*` | `billing.route.ts` | Stripe + Razorpay |
| `GET/POST /channels/*` | `channels.route.ts` | OAuth connections |
| `POST /missions` | — | **MISSING** |
| `GET /missions` | — | **MISSING** |
| `GET /opportunities` | — | **MISSING** |
| `GET /growth-brain/:productId` | — | **MISSING** |
| `PUT /growth-brain/:productId` | — | **MISSING** |

---

## 6. Database Schema Inventory

**Existing tables (migrations 001–031):**

| Table | Migration | Status |
|---|---|---|
| `founders` | 001 | Complete + RLS |
| `products` | 001 + 023 | Complete + intake v2 columns |
| `platform_tokens` | 001 | Complete + AES-256 |
| `campaigns` | 001 | Complete |
| `campaign_metrics` | 001 | Complete |
| `weekly_briefs` | 001 | Complete |
| `playbook_signals` | 001 + 011 + 018 | Complete — 52 seed rows |
| `audit_logs` | 001 | Complete — immutable |
| `embedding_store` | 001 | Complete |
| `workspaces` | 017 | Complete |
| `content_assets` | 026 | Complete |
| `content_preferences` | 027 | Complete |
| `content_learnings` | 028 | Complete |
| `growth_brain` | — | **MISSING** |
| `marketing_memory` | — | **MISSING** |
| `missions` | — | **MISSING** |
| `opportunities` | — | **MISSING** |
| `experiments` | — | **MISSING** |
| `kg_entities` | — | **MISSING** |
| `kg_relationships` | — | **MISSING** |

---

## 7. Workers and Queues

| Worker | Queue | Trigger | Status |
|---|---|---|---|
| `intakeWorker.ts` | `scrape-queue` | `POST /products/scrape` | Complete |
| `scraperWorker.ts` | — (called by intake) | — | Complete |
| `weeklyBriefWorker.ts` | `brief-queue` | Sunday BullMQ cron | Complete |
| `contentWorker.ts` | — | Fire-and-forget | Complete |
| `missionWorker.ts` | — | — | **MISSING** |

---

## 8. AI Integrations

| Integration | File | Model | Purpose | Status |
|---|---|---|---|---|
| Claude Sonnet | `lib/aiClient.ts` | claude-sonnet-4-6 | Strategy, copy, briefs | Complete |
| Claude Haiku | `lib/aiClient.ts` | claude-haiku-4-5-20251001 | Scoring, short assets | Complete |
| Replicate/Flux.1 | `lib/replicateClient.ts` | flux-schnell | Marketing images | Complete |
| ElevenLabs | `lib/elevenLabsClient.ts` | TTS API | Voice synthesis | Complete |
| Creatomate | `lib/creatomateClient.ts` | Video API | Video assembly | Complete |
| Context Engine | — | — | Pre-request context assembly | **MISSING** |

---

## 9. Technical Debt

| Item | Severity | Notes |
|---|---|---|
| Sidebar uses `lucide-react` | Low | CLAUDE.md §6.5 specifies `@tabler/icons-react` v3. Fix in Milestone 01. |
| No response envelope standard | Medium | Routes return varied shapes — some `{ data }`, some raw objects. Fix: `lib/response.ts`. |
| `contextEngine.ts` missing | High | Every AI call assembles its own context. Violates Architecture Baseline §13. |
| No PageShell component | Medium | Every page re-implements padding/header pattern differently. |
| `lucide-react` still in package.json | Low | Should migrate fully to Tabler icons over time. Not a blocker. |
| 5 pre-existing TypeScript errors in scraper layer | Low | Library type drift, no runtime impact — tracked in memory. |
| No `/intelligence/*` layout group | Low | Intelligence sub-pages need a shared layout. |

---

## 10. Security Audit

| Item | Status | Notes |
|---|---|---|
| RLS on all founder tables | ✅ | Verified across all 15 tables |
| JWT auth middleware | ✅ | `jwtPlugin.ts` — algorithm-agnostic since ES256 migration |
| Token encryption | ✅ | AES-256 + AWS KMS |
| `encrypted_token` never returned | ✅ | `platform_tokens` select always excludes it |
| MFA enforcement | ✅ | TOTP via Supabase Auth |
| Anomaly detection | ✅ | `auth.middleware.ts` — new device/country |
| `approved_at` gate | ✅ | Hard check in campaign routes |
| Spend cap enforcement | ✅ | 422 if over cap |
| GDPR delete/export | ✅ | `/founders/me` routes |
| Audit logs immutable | ✅ | UPDATE/DELETE revoked |
| Prompt injection defense | ⚠️ | Not explicitly implemented. Add to `contextEngine.ts`. |
| Signed URLs for media | ⚠️ | Supabase Storage bucket is public. Should use signed URLs for private media. |

---

## 11. Observability Audit

| Item | Status | Notes |
|---|---|---|
| Sentry (backend) | ✅ | Wired in Fastify error handler |
| Sentry (frontend) | ✅ | In root layout |
| PostHog analytics | ✅ | After cookie consent |
| Axiom audit logs | ✅ | `audit_logs` table |
| Structured logging | ⚠️ | `console.log/warn/error` — no JSON structure or correlation IDs |
| AI cost tracking | ⚠️ | `ai_tokens_consumed` tracked per asset but no dashboard |
| Queue health monitoring | ⚠️ | No BullMQ dashboard or alerts |
| Request tracing | ⚠️ | No correlation IDs on API requests |

---

## Summary: Milestone 01 Implementation Scope

### Implement in this milestone:
1. Architecture Review (this document) ✅
2. ADR files (8) — see `docs/adr/`
3. Design System tokens file (`lib/design-system/tokens.ts`)
4. Shared components: PageShell, MetricCard, MissionCard, OpportunityCard, ApprovalCard, EmptyState, LoadingState
5. Updated Sidebar (new nav, Tabler icons)
6. New route stubs (15 routes)
7. Backend response envelope (`backend/src/lib/response.ts`)
8. Intelligence layout group

### Deferred to Phase 6 (requires new migrations):
- Growth Brain service + routes + migration 031
- Marketing Memory service + routes + migration 032
- Context Engine (requires Growth Brain to exist)
- Mission Orchestrator + routes + migration 033
