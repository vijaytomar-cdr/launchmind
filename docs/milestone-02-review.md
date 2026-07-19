# Milestone 02 — Repository Review Assessment
> Product Workspace & Product Intake

**Date:** 2026-07-08 · **Branch:** jun14UXfix

---

## 1. Pre-implementation inventory

### Tables that needed to exist before Milestone 02
| Table | Status before |
|---|---|
| `workspaces` | ✅ Existed (Phase 4, migration 010) |
| `workspace_members` | ❌ Missing |
| `workspace_preferences` | ❌ Missing |
| `founders.active_workspace_id` | ❌ Missing |
| `founders.active_product_id` | ❌ Missing |
| `products.intake_v3_step` | ❌ Missing |
| `products.intake_v3_complete_at` | ❌ Missing |
| `products.stage / revenue_model / monthly_budget` | ❌ Missing |
| `platform_tokens.integration_type` | ❌ Missing |
| `platform_tokens.integration_config` | ❌ Missing |
| `platform_tokens` CHECK for ga4/firebase/search_console/website | ❌ Missing |

### Services that needed to exist
| Service | Status before |
|---|---|
| `workspaceService.ts` | ❌ Missing — workspace logic was inline in route |
| `integrationService.ts` | ❌ Missing |

### Routes missing before Milestone 02
| Route | Status before |
|---|---|
| `POST /workspaces/:id/activate` | ❌ Missing |
| `POST /products/:id/activate` | ❌ Missing |
| `GET/POST/DELETE /workspaces/:id/members` | ❌ Missing |
| `POST /products/setup/start` | ❌ Missing |
| `PATCH /products/:id/intake/step/:step` | ❌ Missing |
| `POST /products/:id/intake/complete` | ❌ Missing |
| `GET /products/:id/intake/status` | ❌ Missing |
| `POST /integrations/ga4` | ❌ Missing |
| `POST /integrations/firebase` | ❌ Missing |
| `POST /integrations/website` | ❌ Missing |
| `GET /integrations` | ❌ Missing |
| `DELETE /integrations/:platform` | ❌ Missing |

---

## 2. Decisions made

### Workspace model (ADR-011)
**Decision:** Extend existing `workspaces` table (add `workspace_type`, `settings`). Create separate `workspace_members` and `workspace_preferences` tables. Add `active_workspace_id` + `active_product_id` to `founders`.

**Why:** Engineering Contract requires extending existing tables before creating new ones. The existing `workspaces` table had all the columns we needed as a base.

**Consequences:**
- Personal workspace auto-created on signup (handled by existing signup flow — TODO: add trigger or route to auto-create)
- Plan limits enforced in `workspaceService.createWorkspace()`, not in middleware, to avoid distributed constraint logic

### Intake V3 (ADR-012)
**Decision:** New 5-step wizard at `/dashboard/products/setup/` complementary to the existing 7-step URL-scraping wizard at `/dashboard/products/new`. Both write to the same `products` table.

**Why:** The existing wizard is URL-first. Many founders don't have a store URL (pre-launch, web apps). The V3 wizard is manual-entry first, store URL optional.

**Key implementation detail:** `store_url` and `platform` columns made nullable in migration 033 to support V3 products. Existing rows unaffected (they already have values).

**Consequences:**
- `intake_v3_complete_at` is the gate for Growth Brain generation (Phase 6)
- V3 wizard saves `confirmed_icp` partially across steps 2 and 3 — step 3 overwrites with a richer object. This is intentional and idempotent.

### Multi-product support (ADR-013)
**Decision:** `founders.active_product_id` column + `POST /products/:id/activate` endpoint. Plan limits: Free/Solo=1, Builder=3, Studio=10 (enforced in `products.route.ts`).

**Consequence:** The product limit was already enforced for the 7-step wizard; it now applies equally to V3 setup start.

### Integration framework (ADR-014)
**Decision:** Extend `platform_tokens` table (widen CHECK, add `integration_type` + `integration_config`). New `integrationService.ts` with `connectApiKeyIntegration()`, `connectUrlIntegration()`, `disconnectIntegration()`, `listIntegrations()`. Routes added to `channels.route.ts`.

**Why:** Avoids a new table for non-OAuth integrations. Same security guarantees (AES-256 via KMS for API keys, audit log on every operation). `encrypted_token` never returned to frontend.

**Consequence:** URL-only integrations store `'url_only'` as the `encrypted_token` placeholder. This is documented and safe — `url_only` is never decrypted.

---

## 3. What was built

### Migrations (3 new files)
| File | What it does |
|---|---|
| `backend/migrations/20260708_000032_workspace_members.sql` | `workspace_members` + `workspace_preferences` tables, extends `workspaces` + `founders` |
| `backend/migrations/20260708_000033_products_intake_v3.sql` | Extends `products` for V3 wizard columns; makes `store_url`/`platform` nullable |
| `backend/migrations/20260708_000034_integrations_extend.sql` | Widens `platform_tokens` CHECK; adds `integration_type` + `integration_config` |

### Backend services (2 new files)
| File | What it does |
|---|---|
| `backend/src/services/workspaceService.ts` | Workspace CRUD, plan limit enforcement, member management, active state |
| `backend/src/services/integrationService.ts` | GA4/Firebase/website connect, disconnect, list — all encrypted via KMS |

### Backend routes (extended)
| File | What was added |
|---|---|
| `backend/src/routes/workspaces.route.ts` | Imports `workspaceService`; adds `/activate`, `/members` CRUD, `/products/:id/activate` |
| `backend/src/routes/products.route.ts` | Intake V3: `/setup/start`, `/intake/step/:step`, `/intake/complete`, `/intake/status` |
| `backend/src/routes/channels.route.ts` | Integration routes: `/integrations/ga4`, `/firebase`, `/website`, `GET /integrations`, `DELETE /integrations/:platform` |

### ADRs (4 new files)
| File | Decision |
|---|---|
| `docs/adr/ADR-011-workspace-model.md` | Workspace roles and plan limits |
| `docs/adr/ADR-012-product-intake-wizard.md` | Complementary intake wizard |
| `docs/adr/ADR-013-multi-product-support.md` | Active product switching + plan limits |
| `docs/adr/ADR-014-integration-framework.md` | Non-OAuth integrations in platform_tokens |

### Frontend (5 new pages + 2 shared files)
| File | What it does |
|---|---|
| `app/(dashboard)/dashboard/products/setup/page.tsx` | Entry — choose manual vs store-import; resumes in-progress intake |
| `app/(dashboard)/dashboard/products/setup/SetupSteps.tsx` | 5-step progress bar shared across all wizard pages |
| `app/(dashboard)/dashboard/products/setup/basics/page.tsx` | Step 1: name, category, stage, store URL, country, language |
| `app/(dashboard)/dashboard/products/setup/business/page.tsx` | Step 2: revenue model, budget, KPIs, goals |
| `app/(dashboard)/dashboard/products/setup/audience/page.tsx` | Step 3: ICP persona, age, markets, pain points, outcomes |
| `app/(dashboard)/dashboard/products/setup/brand/page.tsx` | Step 4: brand voice, values, color, competitors, differentiator |
| `app/(dashboard)/dashboard/products/setup/connect/page.tsx` | Step 5: GA4, website URL, Meta/Google stubs; completes intake |

### API client additions (`lib/api.ts`)
- `api.products.activate(id, token)` — activates a product as the founder's current product
- `api.products.setupStart(data, token)` — creates V3 product
- `api.products.saveIntakeStep(id, step, data, token)` — saves step data
- `api.products.completeIntake(id, token)` — completes intake, gates Growth Brain
- `api.products.intakeStatus(id, token)` — returns step + completeness
- `api.workspaces.activate(id, token)` — sets active workspace
- `api.workspaces.listMembers / inviteMember / removeMember`
- `api.integrations.list / connectGa4 / connectFirebase / connectWebsite / disconnect`
- New types: `WorkspaceMember`, `Integration`

---

## 4. Security review

| Check | Status |
|---|---|
| `encrypted_token` never in any response | ✅ Only `integration_config` (non-secret metadata) returned |
| KMS used for API key encryption (GA4, Firebase) | ✅ `encryptToken()` from `tokenVault.ts` |
| Audit log on every integration connect/disconnect | ✅ |
| `founder_id` ownership verified on workspace mutations | ✅ `getWorkspace()` used as guard before every write |
| Plan limits enforced server-side | ✅ Checked in `createWorkspace()` and `setupStart` route |
| RLS on `workspace_members` + `workspace_preferences` | ✅ Policies in migration 032 |
| JWT required for all new routes | ✅ `await request.jwtVerify()` on every route |
| `store_url` nullable migration — backward compat | ✅ Existing rows already had values; `ALTER COLUMN DROP NOT NULL` is safe |

---

## 5. Gaps and follow-up

| Item | Priority | Notes |
|---|---|---|
| Personal workspace auto-creation on signup | High | No trigger or route currently creates a personal workspace when a new founder signs up. Should be added to the signup route or as a Supabase trigger. |
| Search Console OAuth connect | Medium | Needs OAuth flow similar to Meta/Google. Stub is in the spec. |
| Workspace switcher in sidebar | Medium | `api.workspaces.activate()` is wired; a UI switcher dropdown in `Sidebar.tsx` would surface it |
| E2E tests for V3 wizard | Medium | Add a `sanity.spec.ts` test that walks the 5 steps |
| `tsc --noEmit` — 0 errors | ✅ Verified |

---

## 6. TypeScript check

```
npx tsc --noEmit
→ 0 errors
```
