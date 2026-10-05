-- 20260824_000123_creative_engagement_check_fix.sql
--
-- Corrects a CHECK in migration 122 that could never fire — Phase 3.5B6.6 §11.
--
-- THE DEFECT, measured rather than reviewed. 122 carried:
--
--   CHECK (public_engagement IS NULL OR array_length(signal_limitations, 1) >= 1)
--
-- intended to make it impossible to store a public popularity figure without
-- also storing what that figure cannot tell us. It cannot do that.
-- `array_length(ARRAY[]::text[], 1)` returns NULL, not 0 — Postgres reports the
-- length of an EMPTY array as unknown rather than zero — so for the exact case
-- the constraint exists to catch, the expression evaluates to NULL, and a CHECK
-- that evaluates to NULL is SATISFIED. The constraint was decorative.
--
-- Found by probing it against a real workspace. The first probe used a
-- non-existent workspace id and the foreign key fired first, which returned an
-- error and made the constraint look enforced. A constraint has to be tested
-- with everything else about the row valid, or the wrong thing is being proven.
--
-- The service layer (creativeIntelligenceService.validateObservation) rejected
-- this case correctly throughout and is covered by tests, so no observation was
-- ever stored without its limitations. The guarantee held; it just did not hold
-- where migration 122 claimed it did.
--
-- Additive and idempotent. No column is dropped, renamed or retyped.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'creative_observations_engagement_needs_limits'
      AND conrelid = 'creative_observations'::regclass
  ) THEN
    ALTER TABLE creative_observations
      DROP CONSTRAINT creative_observations_engagement_needs_limits;
  END IF;
END $$;

-- COALESCE makes the empty-array case evaluate to 0 rather than NULL, so the
-- comparison is false and the CHECK genuinely refuses the row.
ALTER TABLE creative_observations
  ADD CONSTRAINT creative_observations_engagement_needs_limits
  CHECK (
    public_engagement IS NULL
    OR COALESCE(array_length(signal_limitations, 1), 0) >= 1
  );
