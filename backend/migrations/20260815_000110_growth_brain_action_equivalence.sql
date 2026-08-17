-- ============================================================================
-- 110 — Action-equivalence identity (Phase 3.3E remediation)
--
-- MEASURED P0 (browser certification): exact-snapshot identity is correct for
-- AUDIT but wrong as the sole basis for "is this outstanding?". The owner
-- approved "Define a real ICP before any marketing activity begins"; a reload
-- regenerated the same action with whyNow and nextStep merely rephrased; the
-- snapshot hash legitimately changed; a new RECOMMENDED row appeared; and the
-- already-approved action looked outstanding again.
--
-- The fix is a SECOND identity, not a weaker first one:
--   fingerprint  — the exact grounded snapshot the owner saw (unchanged)
--   action_key   — what the owner is being ASKED TO DECIDE
--
-- A regenerated snapshot whose action was already decided is still persisted
-- (audit stays truthful) but is LINKED to that decision and withheld from the
-- actionable list. Nothing about the earlier row is rewritten.
--
-- ADDITIVE. No backfill.
-- ============================================================================

ALTER TABLE growth_brain_recommendations
  ADD COLUMN IF NOT EXISTS action_key TEXT,
  -- Points at the earlier, already-decided recommendation for the same action.
  -- Non-null means "do not present this as a fresh decision".
  ADD COLUMN IF NOT EXISTS superseded_by_decision_id UUID
    REFERENCES growth_brain_recommendations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS growth_brain_recommendations_action_key
  ON growth_brain_recommendations(workspace_id, product_id, action_key);

-- action_key is part of the immutable snapshot: it is derived from the action,
-- so changing it would change what the row means. superseded_by_decision_id is
-- NOT immutable — it is a link the server may set when a later regeneration is
-- recognised as the same action.
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
  OR NEW.action_key         IS DISTINCT FROM OLD.action_key
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

  IF OLD.founder_review_required = true AND NEW.founder_review_required = false THEN
    RAISE EXCEPTION
      'growth_brain_recommendations: founder_review_required cannot be cleared'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
