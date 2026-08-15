-- ============================================================================
-- 098 — Reclaim embedding jobs whose worker died holding the lease
--
-- Phase 3.1G §7. Found by the queue/process failure drill in
-- backend/tests/memoryResilience.pg.test.ts, not by inspection.
--
-- THE DEFECT
--   Migration 093 gave embedding_outbox a visibility timeout and documented its
--   purpose on the column itself:
--
--     available_at ... "once available_at passes. Without it a crash strands
--     work forever."
--
--   lm_claim_embedding_work() sets that lease correctly on claim — it moves the
--   row to 'processing' and pushes available_at into the future — but its own
--   WHERE clause selects `status = 'pending'` only. A row in 'processing' is
--   therefore never looked at again, no matter how long ago its lease expired.
--   The mechanism was built, wired, and then filtered out of existence.
--
--   Consequence: a worker killed between claiming a job and completing it
--   (deploy, OOM, SIGKILL, container eviction) strands that job permanently.
--   The memory silently keeps a stale vector or none at all, so it is retrieved
--   worse than its neighbours forever, and the only trace is a slowly rising
--   processing_jobs count that nothing alerts on.
--
-- THE FIX
--   Claim rows that are 'pending', OR 'processing' with an EXPIRED lease. Both
--   already require available_at <= now(), so a healthy in-flight job is still
--   invisible to other workers for the full visibility window — the guarantee
--   that made SKIP LOCKED safe is unchanged.
--
--   attempt_count still increments on every claim, so a job that reliably kills
--   its worker walks up to MAX_ATTEMPTS and dies as failed rather than cycling
--   forever. That is the behaviour that makes reclaiming safe to enable.
--
--   Terminal states ('completed', 'failed', 'cancelled') are deliberately NOT
--   reclaimable. Their available_at is also in the past, so listing them by
--   timestamp alone would resurrect finished work on every poll.
--
-- Additive and idempotent: replaces one function body. No schema change, no
-- data change, no column dropped, renamed or retyped.
-- ============================================================================

CREATE OR REPLACE FUNCTION lm_claim_embedding_work(
  p_worker TEXT,
  p_limit  INTEGER DEFAULT 10,
  p_visibility_seconds INTEGER DEFAULT 300
)
RETURNS SETOF embedding_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT id FROM embedding_outbox
     -- 'pending'    — never started.
     -- 'processing' — started, but the holder's lease has expired, which is only
     --                possible if that worker died: a live worker renews or
     --                finishes before available_at passes.
     WHERE status IN ('pending', 'processing')
       AND available_at <= now()
     ORDER BY available_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  )
  UPDATE embedding_outbox o
     SET status       = 'processing',
         locked_at    = now(),
         locked_by    = p_worker,
         started_at   = COALESCE(o.started_at, now()),
         available_at = now() + make_interval(secs => p_visibility_seconds),
         attempt_count = o.attempt_count + 1
    FROM claimed
   WHERE o.id = claimed.id
  RETURNING o.*;
END $$;

REVOKE ALL ON FUNCTION lm_claim_embedding_work(TEXT, INTEGER, INTEGER) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION lm_claim_embedding_work(TEXT, INTEGER, INTEGER) TO service_role;

-- ── Observability for the condition this fixes ───────────────────────────────
-- A job reclaimed from a dead worker is not an error, but a workspace producing
-- them steadily is a signal (worker OOM, an unkillable input). Surfacing the
-- count separately keeps that distinguishable from ordinary retry pressure.
CREATE OR REPLACE VIEW embedding_stuck_jobs AS
SELECT
  COUNT(*) FILTER (WHERE status = 'processing' AND available_at <= now()) AS reclaimable_jobs,
  COUNT(*) FILTER (WHERE status = 'processing' AND available_at >  now()) AS in_flight_jobs,
  COUNT(*) FILTER (WHERE status = 'processing' AND attempt_count > 1)     AS retried_after_crash,
  COALESCE(MAX(attempt_count) FILTER (WHERE status = 'processing'), 0)    AS max_attempts_in_flight
FROM embedding_outbox;

GRANT SELECT ON embedding_stuck_jobs TO service_role;
