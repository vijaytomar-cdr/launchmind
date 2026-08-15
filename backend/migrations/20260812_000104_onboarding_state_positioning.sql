-- ============================================================================
-- 104 · Add ALIGNMENT_POSITIONING to the onboarding state constraint
--
-- BLOCKER FOUND BY THE END-TO-END WRITER TEST.
--
-- Migration 102 introduced the positioning step (G1/G2/G5/G7) and it was added
-- everywhere EXCEPT here:
--
--   VALID_TRANSITIONS      ALIGNMENT_AUDIENCE → ALIGNMENT_POSITIONING   ✓
--   STATE_TO_ROUTE         /onboarding/positioning                       ✓
--   stepsMap               ALIGNMENT_POSITIONING: 5                      ✓
--   PUT /onboarding/sessions/:id/positioning                             ✓
--   app/onboarding/positioning/page.tsx                                  ✓
--   onboarding_sessions_current_state_check                              ✗
--
-- So EVERY owner's onboarding dies at the audience → positioning transition
-- with 23514, and `transitionState` reports it as
-- "Session was modified concurrently — please refresh" because it treats any
-- failed update as a lost optimistic lock. Retrying, which is what that message
-- tells the owner to do, fails identically forever.
--
-- Nothing caught it: every onboarding test mocks Supabase, so the CHECK
-- constraint was never exercised. It surfaced the first time the real service
-- ran against real Postgres.
--
-- Idempotent. Widening a CHECK constraint accepts a strict superset of the
-- values already permitted, so no existing row can be invalidated.
-- ============================================================================

ALTER TABLE onboarding_sessions
  DROP CONSTRAINT IF EXISTS onboarding_sessions_current_state_check;

ALTER TABLE onboarding_sessions
  ADD CONSTRAINT onboarding_sessions_current_state_check
  CHECK (current_state IN (
    'WORKSPACE_SETUP',
    'DISCOVERY_PENDING',
    'DISCOVERY_IN_PROGRESS',
    'DISCOVERY_MATCH_NEEDED',
    'DISCOVERY_FAILED',
    'PRELIMINARY_REPORT',
    'BELIEF_REVIEW',
    'ALIGNMENT_AUDIENCE',
    'ALIGNMENT_POSITIONING',   -- ← added; every other value is unchanged
    'ALIGNMENT_CONTEXT',
    'ALIGNMENT_GOAL',
    'ALIGNMENT_COMPETITORS',
    'BOUNDARIES_SETUP',
    'FINAL_REVIEW',
    'DIRECTION_GENERATING',
    'DIRECTION_COMPLETE',
    'PHASE_1_COMPLETE'
  ));

COMMENT ON CONSTRAINT onboarding_sessions_current_state_check ON onboarding_sessions IS
  'Must stay in step with VALID_TRANSITIONS in backend/src/types/onboarding.ts. '
  'A state present in code but absent here fails at runtime as 23514, which the '
  'service previously reported as a concurrency error.';
