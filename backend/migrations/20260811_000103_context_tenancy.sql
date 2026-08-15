-- ============================================================================
-- 103 · Business-context tenancy — BLOCKER 1
--
-- WHY: founder_context and approval_boundary_policies carry only founder_id and
-- session_id. founder_context holds ICP, positioning, value proposition,
-- customer problem, markets, current channels, success definition, context
-- delta and working style — and four production readers select it by
-- founder_id with `order(updated_at desc) limit 1`, or merge the five newest
-- rows. So two businesses owned by one founder contaminate each other AT READ
-- TIME, even in separate workspaces. Nothing overwrites anything, which is
-- exactly why it would not be noticed.
--
-- Approval boundaries have the same shape, so "AllignX: never spend" and
-- "LaunchMind: spend needs approval" would resolve by founder identity alone.
--
-- ADDITIVE ONLY. New columns are nullable; constraints are promoted only for
-- rows that carry tenant identity, so legacy rows stay readable and are never
-- silently reassigned to a workspace nobody verified.
--
-- Idempotent.
-- ============================================================================

ALTER TABLE founder_context
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS product_id   UUID REFERENCES products(id)   ON DELETE CASCADE;

ALTER TABLE approval_boundary_policies
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS product_id   UUID REFERENCES products(id)   ON DELETE CASCADE;

COMMENT ON COLUMN founder_context.workspace_id IS
  'Canonical tenant. Business-context readers MUST filter on this; founder_id alone mixes businesses.';
COMMENT ON COLUMN approval_boundary_policies.workspace_id IS
  'Canonical tenant. A policy from one business must never resolve for another.';

-- ── Backfill from the onboarding session, which is the only authority ───────
-- Deliberately NOT a guess. A row whose session is missing, or whose session
-- has no workspace, is LEFT NULL and reported rather than assigned somewhere
-- plausible: the whole defect being fixed is context attaching to the wrong
-- business, and an invented backfill would recreate it in permanent form.
UPDATE founder_context fc
SET    workspace_id = os.workspace_id,
       product_id   = COALESCE(fc.product_id, os.product_id)
FROM   onboarding_sessions os
WHERE  os.id = fc.session_id
  AND  os.workspace_id IS NOT NULL
  AND  fc.workspace_id IS DISTINCT FROM os.workspace_id;

UPDATE approval_boundary_policies ab
SET    workspace_id = os.workspace_id,
       product_id   = COALESCE(ab.product_id, os.product_id)
FROM   onboarding_sessions os
WHERE  os.id = ab.session_id
  AND  os.workspace_id IS NOT NULL
  AND  ab.workspace_id IS DISTINCT FROM os.workspace_id;

-- ── Quarantine view for rows that could not be mapped ───────────────────────
-- These must be visible, not silently tolerated: every one is a row that a
-- founder-scoped reader could still pick up.
CREATE OR REPLACE VIEW lm_untenanted_context AS
  SELECT 'founder_context' AS table_name, fc.id, fc.founder_id, fc.session_id
  FROM   founder_context fc WHERE fc.workspace_id IS NULL
  UNION ALL
  SELECT 'approval_boundary_policies', ab.id, ab.founder_id, ab.session_id
  FROM   approval_boundary_policies ab WHERE ab.workspace_id IS NULL;

COMMENT ON VIEW lm_untenanted_context IS
  'Rows with no resolvable workspace. Non-empty means a founder-scoped read can still mix businesses.';

-- ── Integrity: a product must belong to the workspace it is paired with ─────
-- Cheap to state, and it is the specific corruption that would let a scoped
-- reader still return another business's context.
CREATE OR REPLACE FUNCTION lm_context_product_matches_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.product_id IS NOT NULL AND NEW.workspace_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = NEW.product_id AND p.workspace_id = NEW.workspace_id
    ) THEN
      RAISE EXCEPTION 'product % does not belong to workspace %',
        NEW.product_id, NEW.workspace_id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION lm_context_product_matches_workspace() FROM PUBLIC;

DROP TRIGGER IF EXISTS founder_context_tenant_ck ON founder_context;
CREATE TRIGGER founder_context_tenant_ck
  BEFORE INSERT OR UPDATE ON founder_context
  FOR EACH ROW EXECUTE FUNCTION lm_context_product_matches_workspace();

DROP TRIGGER IF EXISTS approval_boundaries_tenant_ck ON approval_boundary_policies;
CREATE TRIGGER approval_boundaries_tenant_ck
  BEFORE INSERT OR UPDATE ON approval_boundary_policies
  FOR EACH ROW EXECUTE FUNCTION lm_context_product_matches_workspace();

CREATE INDEX IF NOT EXISTS founder_context_tenant
  ON founder_context (workspace_id, product_id);
CREATE INDEX IF NOT EXISTS approval_boundaries_tenant
  ON approval_boundary_policies (workspace_id, product_id);

-- ============================================================================
-- BLOCKER 3 · Canonical product identity
--
-- Display names are NOT identity: "AllignX・Home Services" and
-- "AllignX・Home Services App - App Store" are the same product, and two
-- unrelated products can share a name. Identity comes from the stable id the
-- platform itself issues.
--
--   apple:<numeric id>     from an App Store URL
--   play:<package id>      from a Play Store URL
--   web:<canonical domain> for a website
--
-- Nullable: a manually created product may legitimately have none, and such a
-- row must stay insertable rather than be blocked by an identity it cannot
-- produce.
-- ============================================================================
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS canonical_identity TEXT;

COMMENT ON COLUMN products.canonical_identity IS
  'apple:<id> | play:<package> | web:<domain>. Never derived from display name.';

-- Duplicate protection, scoped to the workspace.
--
-- Archived products are INCLUDED on purpose: re-adding an archived product must
-- be detected and reported, not silently duplicated. Excluding them would make
-- archiving a way to create duplicates.
--
-- Partial because both columns are legitimately nullable. Note for callers:
-- do NOT use ON CONFLICT against this index — inference over a partial index on
-- nullable columns is the mistake found in Phase 2. Look the row up first and
-- treat 23505 as the race backstop.
CREATE UNIQUE INDEX IF NOT EXISTS products_workspace_identity_uk
  ON products (workspace_id, canonical_identity)
  WHERE workspace_id IS NOT NULL AND canonical_identity IS NOT NULL;

-- Governed onboarding must not create untenanted products (BLOCKER 2). A
-- global NOT NULL is deliberately NOT applied: three legacy AllignX rows carry
-- NULL and the owner intends to purge them, so forcing it now would either
-- fail or require touching rows this task must leave alone. Enforcement lives
-- in the service, and this index makes the remaining legacy rows visible.
CREATE INDEX IF NOT EXISTS products_null_workspace
  ON products (founder_id) WHERE workspace_id IS NULL;
