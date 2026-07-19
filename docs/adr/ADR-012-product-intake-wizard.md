# ADR-012: Product Intake Wizard
Status: Accepted
Date: July 2026

## Context
LaunchMind has an existing 7-step intake wizard (URL-scraping path at `/products/new`). Milestone 02 requires a 5-step direct-input wizard capturing: Product Basics, Business, Audience, Brand, Connections.

## Options Considered
1. **Replace** existing 7-step wizard with new 5-step wizard
2. **Duplicate** — run two parallel wizards
3. **Complement** — new 5-step wizard is a separate "Profile Setup" path; both save to same `products` table

## Decision
**Complement** (Engineering Contract: "never duplicate concepts").

The existing wizard ("I have an App Store URL — figure it out") and the new wizard ("I want to tell you directly about my business") serve different intents. Both are valid entry points.

Routing:
- `/dashboard/products/new` — existing URL-scraping wizard (unchanged)
- `/dashboard/products/setup` — new 5-step direct-input wizard

Both paths write to the same `products` row. The new wizard is "resumable from any step" using `intake_v3_step` column. Growth Brain requires `intake_v3_complete_at IS NOT NULL` before generation can begin.

## Data mapping
New wizard saves its fields to:
- Step 1 (Basics) → `products.name`, `products.category`, `products.website_url`, `products.platform`, `products.founder_context.stage`, `products.founder_context.country`, `products.founder_context.primary_language`
- Step 2 (Business) → `products.founder_context` (revenue_model, monthly_budget, primary_kpis, growth_goals, launch_timeline)
- Step 3 (Audience) → `products.confirmed_icp` (targetUser, geography, painPoints) + founder_context (personas, age_range, desired_outcomes)
- Step 4 (Brand) → `products.brand_voice_profile` (voice, values, color_preferences, existing_messaging) + `products.competitor_set`
- Step 5 (Connections) → `platform_tokens` (existing pattern) + `products.selected_markets`

## Consequences
- No new tables for wizard data — extends existing JSONB columns (confirmed_icp, founder_context, brand_voice_profile)
- Two new columns on products: `intake_v3_step` (current step 0-5), `intake_v3_complete_at` (TIMESTAMPTZ)
- Autosave: every step PATCH call updates `intake_v3_step` — wizard resumes from last saved step
- Growth Brain gate: `intake_v3_complete_at IS NOT NULL OR intake_completed_at IS NOT NULL` (either wizard path)
