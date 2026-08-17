-- ============================================================================
-- 109 — Growth Brain decision hardening (Phase 3.3D remediation)
--
-- Migration 108 is left intact; this tightens it additively.
--
-- FOUR MEASURED DEFECTS (independent review):
--   1. The write policy used lm_can_write_workspace, which includes EDITOR — so
--      an editor with a client token could rewrite a recommendation's text,
--      provenance, action_type, requires_approval or founder_conflict directly.
--      An owner decision is not a generic workspace edit.
--   2. Nothing stopped a direct client UPDATE of the SNAPSHOT columns. API-side
--      validation is irrelevant when the row is writable from the client.
--   3. product_id was not constrained to belong to workspace_id.
--   4. (Handled in application code) the fingerprint covered too few columns.
--
-- THE CONTRACT AFTER THIS MIGRATION:
--   · authenticated may SELECT rows in workspaces they belong to
--   · authenticated may NOT INSERT/UPDATE/DELETE at all — decisions go through
--     the validated backend path, which runs as service_role
--   · even service_role cannot rewrite the snapshot: a trigger rejects it, so
--     immutability is a property of the table rather than of a code path that
--     could be bypassed or forgotten
--
-- ADDITIVE. No backfill (hosted holds 0 rows).
-- ============================================================================

-- ── 1. Composite integrity: product must belong to the workspace ────────────
-- products.id is already the PK; this unique pair is what a composite FK needs.
CREATE UNIQUE INDEX IF NOT EXISTS products_id_workspace_unique
  ON products(id, workspace_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'growth_brain_recommendations_product_in_workspace'
  ) THEN
    ALTER TABLE growth_brain_recommendations
      ADD CONSTRAINT growth_brain_recommendations_product_in_workspace
      FOREIGN KEY (product_id, workspace_id)
      REFERENCES products(id, workspace_id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- ── 2. Remove the over-permissive write path ────────────────────────────────
DROP POLICY IF EXISTS growth_brain_recommendations_member_write ON growth_brain_recommendations;

-- Read stays with members. Everything else is server-only: there is no product
-- requirement for a client to write this table directly, so the capability is
-- removed rather than narrowed.
REVOKE INSERT, UPDATE, DELETE ON growth_brain_recommendations FROM authenticated, anon;
GRANT SELECT ON growth_brain_recommendations TO authenticated;

-- ── 3. Snapshot immutability, enforced by the table itself ──────────────────
-- Applies to EVERY writer including service_role. The decision fields below are
-- the only ones an update may touch; anything else is a rewrite of history.
CREATE OR REPLACE FUNCTION lm_growth_brain_recommendation_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.workspace_id       IS DISTINCT FROM OLD.workspace_id
  OR NEW.product_id         IS DISTINCT FROM OLD.product_id
  OR NEW.founder_id         IS DISTINCT FROM OLD.founder_id
  OR NEW.fingerprint        IS DISTINCT FROM OLD.fingerprint
  OR NEW.what               IS DISTINCT FROM OLD.what
  OR NEW.why_now            IS DISTINCT FROM OLD.why_now
  OR NEW.next_step          IS DISTINCT FROM OLD.next_step
  OR NEW.expected_effect    IS DISTINCT FROM OLD.expected_effect
  OR NEW.action_type        IS DISTINCT FROM OLD.action_type
  OR NEW.requires_approval  IS DISTINCT FROM OLD.requires_approval
  OR NEW.evidence_strength  IS DISTINCT FROM OLD.evidence_strength
  OR NEW.supported_by       IS DISTINCT FROM OLD.supported_by
  OR NEW.supporting         IS DISTINCT FROM OLD.supporting
  OR NEW.founder_conflict   IS DISTINCT FROM OLD.founder_conflict
  OR NEW.contract_version   IS DISTINCT FROM OLD.contract_version
  OR NEW.created_at         IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION
      'growth_brain_recommendations: snapshot and policy columns are immutable (attempted change to a non-decision column)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- founder_review_required may never be cleared. An acknowledgement is
  -- recorded ALONGSIDE the conflict; the conflict itself does not go away, so
  -- history can never be read as "there was no conflict".
  IF OLD.founder_review_required = true AND NEW.founder_review_required = false THEN
    RAISE EXCEPTION
      'growth_brain_recommendations: founder_review_required cannot be cleared'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS growth_brain_recommendations_immutable ON growth_brain_recommendations;
CREATE TRIGGER growth_brain_recommendations_immutable
  BEFORE UPDATE ON growth_brain_recommendations
  FOR EACH ROW EXECUTE FUNCTION lm_growth_brain_recommendation_immutable();

REVOKE ALL ON FUNCTION lm_growth_brain_recommendation_immutable() FROM PUBLIC;
