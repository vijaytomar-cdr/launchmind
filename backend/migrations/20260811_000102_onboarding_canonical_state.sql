-- ============================================================================
-- 102 · Onboarding canonical state — closes ONBOARDING_PRODUCT_GAP G1–G8
--
-- WHY: the Phase-1 onboarding flow could not persist enough owner-confirmed
-- business context for cold-start reasoning, Growth Brain, Context Delta or
-- Marketing Memory bootstrap. Eight gaps were found while preparing the
-- multi-product validation owner packages. Closing them BEFORE the owner
-- onboards means onboarding is completed once, not twice.
--
-- ADDITIVE ONLY (CLAUDE.md §1.2). No column is dropped, renamed or retyped.
-- Every new column is nullable so existing workspaces keep working with the
-- new fields simply UNSET — a missing value is safer than a fabricated one
-- (§15). The single exception is documented at G7 below and removes a DEFAULT
-- rather than data.
--
-- Idempotent: safe to run twice.
-- ============================================================================

-- ── G1 · Positioning + value proposition ────────────────────────────────────
-- ── G2 · Primary customer problem ───────────────────────────────────────────
-- ── G6 · Success definition ─────────────────────────────────────────────────
-- ── G5 · Existing marketing channels ────────────────────────────────────────
-- ── G7 · Market / geography ─────────────────────────────────────────────────
--
-- All land on founder_context: it is already THE owner-confirmed context row
-- for a session, alongside audience and context_delta. Putting positioning on
-- products instead would create a second competing truth for the same concept,
-- since products.scraped_meta already carries an AI-derived description.
ALTER TABLE founder_context
  ADD COLUMN IF NOT EXISTS positioning               TEXT,
  ADD COLUMN IF NOT EXISTS value_proposition         TEXT,
  ADD COLUMN IF NOT EXISTS primary_customer_problem  TEXT,
  ADD COLUMN IF NOT EXISTS success_definition        TEXT,
  -- [{ channel: 'google_ads', status: 'using' | 'planning' }]
  -- BUSINESS CONTEXT ONLY. "We use Google Ads" is not a provider connection
  -- and must never be read as one — workspace_connections remains the only
  -- source of truth for what LaunchMind can actually read.
  ADD COLUMN IF NOT EXISTS current_channels          JSONB,
  -- [{ type: 'country'|'region'|'metro', value: 'us', label: 'United States' }]
  -- Structured so "Phoenix metro" and "United States" stay distinguishable
  -- rather than collapsing into one geography.
  ADD COLUMN IF NOT EXISTS markets                   JSONB,
  -- Which of the above the owner explicitly confirmed, vs merely left prefilled.
  -- Authority comes from confirmation, never from the prefill having existed.
  ADD COLUMN IF NOT EXISTS confirmed_fields          JSONB NOT NULL DEFAULT '[]'::JSONB;

COMMENT ON COLUMN founder_context.positioning IS
  'G1. Owner-confirmed positioning. AI may propose; only owner confirmation grants founder authority.';
COMMENT ON COLUMN founder_context.current_channels IS
  'G5. Business context only. NOT a provider connection — see workspace_connections.';
COMMENT ON COLUMN founder_context.markets IS
  'G7. Structured markets. NULL means unknown, which is safer than a defaulted USA.';
COMMENT ON COLUMN founder_context.confirmed_fields IS
  'Field names the owner explicitly confirmed or corrected. Prefill alone never appears here.';

-- ── G3 · Product maturity ───────────────────────────────────────────────────
-- Governed at the DB layer so it cannot drift, and NULLABLE so legacy rows
-- read as "unknown" rather than being silently assigned a maturity.
--
-- LaunchMind reasoning should be more cautious with little outcome history —
-- but note that this field must NEVER be used to lower Marketing Memory
-- evidence safety. Corroboration and authority rules are identical at every
-- maturity; only the volume of available evidence differs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'maturity'
  ) THEN
    ALTER TABLE products ADD COLUMN maturity TEXT;
    ALTER TABLE products ADD CONSTRAINT products_maturity_ck
      CHECK (maturity IS NULL OR maturity IN ('pre_launch','early','growing','mature'));
  END IF;
END $$;

-- Captured at the FIRST onboarding step, before a product row exists (discovery
-- creates it), then copied onto the product. Kept on the session rather than
-- asked for twice.
ALTER TABLE onboarding_sessions
  ADD COLUMN IF NOT EXISTS product_maturity TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_sessions_maturity_ck') THEN
    ALTER TABLE onboarding_sessions ADD CONSTRAINT onboarding_sessions_maturity_ck
      CHECK (product_maturity IS NULL OR product_maturity IN ('pre_launch','early','growing','mature'));
  END IF;
END $$;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS maturity_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS market_confirmed_at   TIMESTAMPTZ;

COMMENT ON COLUMN products.maturity IS
  'G3. pre_launch|early|growing|mature. NULL = not yet stated. Never inferred as authoritative.';

-- ── G7 (cont.) · Stop defaulting the market to USA ──────────────────────────
-- The ONLY non-additive statement in this migration, and it removes a DEFAULT
-- rather than a column or any data. Existing rows keep the markets they have
-- (§15); new rows created without an explicit market now read NULL/empty
-- instead of silently claiming the USA. An incorrectly authoritative market is
-- worse than a missing one: it mis-scopes every geography-sensitive memory
-- while looking perfectly well-formed.
ALTER TABLE products ALTER COLUMN markets DROP DEFAULT;

-- ── G8 · Primary + supporting goals ─────────────────────────────────────────
-- Deliberately NOT an OKR system. A priority integer and a primary flag are
-- enough for marketing reasoning to know which goal outranks the others.
--
-- target_value stays NOT NULL. The existing contract already treats 0 as
-- "use an AI benchmark"; target_unknown makes "I don't know yet" explicit
-- rather than overloading a magic zero, without relaxing the constraint.
ALTER TABLE business_goals
  ADD COLUMN IF NOT EXISTS is_primary     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS priority       INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS target_unknown BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN business_goals.is_primary IS
  'G8. Exactly one primary goal per session; the rest are supporting, ordered by priority.';
COMMENT ON COLUMN business_goals.target_unknown IS
  'G8. True when the owner legitimately does not know a target yet. Never fabricate one.';

-- One primary goal per session. Partial unique index, so supporting goals are
-- unconstrained and legacy single-goal rows (is_primary defaults true) stay valid.
CREATE UNIQUE INDEX IF NOT EXISTS business_goals_one_primary
  ON business_goals (session_id) WHERE is_primary;

CREATE INDEX IF NOT EXISTS business_goals_session_priority
  ON business_goals (session_id, priority);

-- ── G4 · Explicit approval boundaries ───────────────────────────────────────
-- STYLE and AUTHORITY are now separate concepts.
--
-- working_style stays: it is a genuine collaboration preference (how much the
-- owner wants to be involved). But it may no longer be the SOLE source of what
-- LaunchMind is permitted to do. `explicit_capabilities` records the owner's
-- own choice per capability, using the SAME ladder as the Phase 2 connection
-- permission architecture (RECOMMEND · DRAFT · CHANGE · PUBLISH · SPEND) so
-- there is one authority vocabulary in the product, not two.
--
-- IMPORTANT: this records AUTHORITY only. Phase 2's connectionExecutionGuard
-- remains the enforcement point, and no adapter implements any execute_*
-- capability today — so granting PUBLISH here still cannot cause a publish.
ALTER TABLE approval_boundary_policies
  ADD COLUMN IF NOT EXISTS explicit_capabilities JSONB,
  ADD COLUMN IF NOT EXISTS boundaries_source     TEXT NOT NULL DEFAULT 'derived_from_style';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'approval_boundaries_source_ck'
  ) THEN
    ALTER TABLE approval_boundary_policies ADD CONSTRAINT approval_boundaries_source_ck
      CHECK (boundaries_source IN ('derived_from_style','owner_explicit'));
  END IF;
END $$;

COMMENT ON COLUMN approval_boundary_policies.explicit_capabilities IS
  'G4. { RECOMMEND|DRAFT|CHANGE|PUBLISH|SPEND: "autonomous"|"approval_required"|"never" }. '
  'Owner-chosen. Enforcement stays with Phase 2 connectionExecutionGuard.';
COMMENT ON COLUMN approval_boundary_policies.boundaries_source IS
  'G4. owner_explicit means the owner saw and chose the boundaries; derived_from_style is legacy.';
