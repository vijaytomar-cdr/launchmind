-- ============================================================================
-- 111 — Owner action intent (Phase 3.3E semantic-equivalence remediation)
--
-- MEASURED P0: equivalence keyed on normalized WHAT text, so ordinary model
-- paraphrasing resurfaced settled actions —
--   "…before any marketing ACTIVITY begins" vs "…before any marketing WORK begins"
--   "Import or connect real provider/audience data…" vs "Import real provider
--    data to establish an observed signal baseline"
--
-- The intent is a SERVER-VALIDATED classification of the substantive action.
-- Stored on the snapshot so an audit can show what the action was understood to
-- be at decision time, and so the equivalence key is reproducible from the row.
--
-- ADDITIVE. No backfill; existing rows keep NULL and fall back to WHAT.
-- ============================================================================

ALTER TABLE growth_brain_recommendations
  ADD COLUMN IF NOT EXISTS owner_action_intent TEXT;

-- Part of the immutable snapshot: it describes the action, so changing it would
-- change what the row means.
CREATE OR REPLACE FUNCTION lm_growth_brain_recommendation_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.workspace_id        IS DISTINCT FROM OLD.workspace_id
  OR NEW.product_id          IS DISTINCT FROM OLD.product_id
  OR NEW.founder_id          IS DISTINCT FROM OLD.founder_id
  OR NEW.fingerprint         IS DISTINCT FROM OLD.fingerprint
  OR NEW.action_key          IS DISTINCT FROM OLD.action_key
  OR NEW.owner_action_intent IS DISTINCT FROM OLD.owner_action_intent
  OR NEW.what                IS DISTINCT FROM OLD.what
  OR NEW.why_now             IS DISTINCT FROM OLD.why_now
  OR NEW.next_step           IS DISTINCT FROM OLD.next_step
  OR NEW.expected_effect     IS DISTINCT FROM OLD.expected_effect
  OR NEW.action_type         IS DISTINCT FROM OLD.action_type
  OR NEW.requires_approval   IS DISTINCT FROM OLD.requires_approval
  OR NEW.evidence_strength   IS DISTINCT FROM OLD.evidence_strength
  OR NEW.supported_by        IS DISTINCT FROM OLD.supported_by
  OR NEW.supporting          IS DISTINCT FROM OLD.supporting
  OR NEW.founder_conflict    IS DISTINCT FROM OLD.founder_conflict
  OR NEW.contract_version    IS DISTINCT FROM OLD.contract_version
  OR NEW.created_at          IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION
      'growth_brain_recommendations: snapshot and policy columns are immutable (attempted change to a non-decision column)'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.founder_review_required = true AND NEW.founder_review_required = false THEN
    RAISE EXCEPTION
      'growth_brain_recommendations: founder_review_required cannot be cleared'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
