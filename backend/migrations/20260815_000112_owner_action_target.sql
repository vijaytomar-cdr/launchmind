-- ============================================================================
-- 112 — Owner action target (Phase 3.3E over-merge remediation)
--
-- MEASURED P0: `REVIEW_POSITIONING` was an umbrella intent. "Establish a clear
-- positioning statement" and "Clarify whether this product is genuinely for
-- external customers" both validated to it, shared an action key, and the
-- second inherited the first's DEFERRED decision.
--
-- The target is the decision OBJECT inside an intent. Stored so the equivalence
-- key is reproducible from the row and an audit shows what the action was
-- understood to be about at decision time.
--
-- ADDITIVE. No backfill: existing rows keep NULL and fall back to normalized
-- WHAT, which can only UNDER-merge.
-- ============================================================================

ALTER TABLE growth_brain_recommendations
  ADD COLUMN IF NOT EXISTS owner_action_target TEXT;

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
  OR NEW.owner_action_target IS DISTINCT FROM OLD.owner_action_target
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
