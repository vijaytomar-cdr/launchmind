-- ============================================================================
-- 097 — Atomic memory lifecycle transition
--
-- Phase 3.1F completion pass. Implements §5 (atomicity) and §6 (learning events).
--
-- WHY THIS MUST BE ONE DATABASE FUNCTION.
--
--   A lifecycle transition is three writes: snapshot the current version, move
--   the memory, record the learning event. PostgREST runs every HTTP request in
--   its own transaction, so doing this from the service layer means three
--   independent commits and two windows where a crash leaves the system lying:
--
--     · memory moved, no learning event  → the belief changed and LaunchMind
--       cannot say why. This is the failure the whole milestone exists to
--       prevent.
--     · event written, memory unchanged  → an audit trail describing something
--       that never happened, which is worse than none.
--
--   One SECURITY DEFINER function makes the three writes one commit. There is no
--   application-level pattern that achieves this over PostgREST, which is why
--   §5 forbids simulating it with independent calls.
--
-- THE FUNCTION DOES NOT DECIDE ANYTHING. The caller supplies an already-decided
-- transition; this validates it against the allow-list and applies it. Policy
-- lives in beliefPolicy.ts, in TypeScript, where it is unit-testable without a
-- database. The duplication of the allow-list here is deliberate defence in
-- depth: a future caller that skips the policy engine still cannot make an
-- illegal move.
--
-- @security SECURITY DEFINER, service_role only. Workspace is validated against
--   the memory row rather than trusted from the argument.
-- @idempotent Safe to run repeatedly.
-- ============================================================================

-- ── Widen the learning-event taxonomy for memory lifecycle ──────────────────
-- 085 defined event_type for the CONNECTION domain. Memory lifecycle events are
-- a new, legitimate category on the same log — the owner-facing question
-- ("why did LaunchMind change its mind?") is answered from one timeline, not two.
DO $$
DECLARE cname TEXT;
BEGIN
  SELECT c.conname INTO cname FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'growth_brain_learning_events' AND c.contype='c'
     AND pg_get_constraintdef(c.oid) ILIKE '%event_type%' LIMIT 1;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE growth_brain_learning_events DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE growth_brain_learning_events
  ADD CONSTRAINT growth_brain_learning_events_type_governed CHECK (event_type IN (
    -- connection domain (migration 085)
    'source_connected','source_synced','source_disconnected','source_reauthorized',
    'context_updated','context_delta_updated','recommendation_updated','authority_changed',
    -- memory lifecycle (3.1F)
    'MEMORY_CREATED','MEMORY_REINFORCED','MEMORY_CHALLENGED','MEMORY_CHALLENGE_RESOLVED',
    'MEMORY_SUPERSEDED','MEMORY_RETRACTED','MEMORY_MARKED_STALE','FOUNDER_CORRECTION',
    'CONFIDENCE_INCREASED','CONFIDENCE_DECREASED'
  ));

/**
 * Applies one lifecycle transition atomically.
 *
 * @returns The new version number and the learning event id.
 * @throws When the transition is not permitted, the memory is absent, or the
 *   workspace does not match — all of which roll back the whole call.
 */
CREATE OR REPLACE FUNCTION lm_apply_memory_transition(
  p_memory_id        UUID,
  p_workspace_id     UUID,
  p_to_status        TEXT,
  p_event_type       TEXT,
  p_actor_type       TEXT,               -- 'system' | 'founder' | 'ai'
  p_reason           TEXT,
  p_new_confidence   NUMERIC DEFAULT NULL,
  p_policy_version   INTEGER DEFAULT NULL,
  p_classification   TEXT    DEFAULT NULL,
  p_evidence_ids     UUID[]  DEFAULT '{}',
  p_superseded_by    UUID    DEFAULT NULL,
  p_requires_review  BOOLEAN DEFAULT false,
  p_trace_id         TEXT    DEFAULT NULL,
  p_content_hash     TEXT    DEFAULT NULL,
  p_reinforce        BOOLEAN DEFAULT false
)
RETURNS TABLE (new_version INTEGER, learning_event_id UUID, prior_status TEXT, prior_confidence NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m              marketing_memories%ROWTYPE;
  v_event_id     UUID;
  v_prior_status TEXT;
  v_prior_conf   NUMERIC;
  v_next_version INTEGER;
  -- Mirrors ALLOWED_TRANSITIONS in beliefPolicy.ts. Defence in depth: a caller
  -- that bypasses the policy engine still cannot make an illegal move.
  v_allowed TEXT[];
BEGIN
  SELECT * INTO m FROM marketing_memories WHERE id = p_memory_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'memory % not found', p_memory_id USING ERRCODE = 'no_data_found';
  END IF;

  -- Tenancy is verified against the ROW, never taken from the argument.
  IF m.workspace_id IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'workspace mismatch for memory %', p_memory_id USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_prior_status := m.status;
  v_prior_conf   := m.confidence;

  v_allowed := CASE m.status
    WHEN 'draft'      THEN ARRAY['active','retracted']
    WHEN 'active'     THEN ARRAY['active','challenged','stale','superseded','retracted']
    WHEN 'challenged' THEN ARRAY['active','challenged','superseded','retracted']
    WHEN 'stale'      THEN ARRAY['active','stale','superseded','retracted']
    WHEN 'archived'   THEN ARRAY['superseded','retracted']
    ELSE ARRAY[]::TEXT[]                       -- superseded / retracted are terminal
  END;

  IF NOT (p_to_status = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'invalid memory transition % -> %', m.status, p_to_status
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- 1. Snapshot the version being left behind. COMPLETE snapshot (Gate 0.5):
  --    without title/type/status the historical row cannot reproduce what a
  --    model was shown.
  INSERT INTO marketing_memory_versions (
    memory_id, founder_id, workspace_id, version,
    title, memory_type, status, evidence_ids, content_hash,
    content, source, confidence, changed_by, change_note, change_reason,
    valid_from, valid_until
  ) VALUES (
    m.id, m.founder_id, m.workspace_id, m.version,
    m.title, m.memory_type, m.status, COALESCE(m.evidence_ids, '{}'), p_content_hash,
    m.content, m.source, m.confidence, p_actor_type, p_reason, p_event_type,
    m.updated_at, now()
  );

  v_next_version := m.version + 1;

  -- 2. Move the memory.
  UPDATE marketing_memories
     SET status              = p_to_status,
         version             = v_next_version,
         confidence          = COALESCE(p_new_confidence, confidence),
         confidence_policy_version = COALESCE(p_policy_version, confidence_policy_version),
         review_required     = p_requires_review,
         superseded_by       = CASE WHEN p_to_status = 'superseded' THEN p_superseded_by ELSE superseded_by END,
         superseded_at       = CASE WHEN p_to_status = 'superseded' THEN now() ELSE superseded_at END,
         retracted_at        = CASE WHEN p_to_status = 'retracted'  THEN now() ELSE retracted_at END,
         retraction_reason   = CASE WHEN p_to_status = 'retracted'  THEN p_reason ELSE retraction_reason END,
         last_reinforced_at  = CASE WHEN p_reinforce THEN now() ELSE last_reinforced_at END,
         reinforcement_count = reinforcement_count + CASE WHEN p_reinforce THEN 1 ELSE 0 END,
         -- Evidence links accumulate; a reinforcement adds support without
         -- discarding what already supported the claim.
         evidence_ids        = CASE
                                 WHEN array_length(p_evidence_ids, 1) IS NULL THEN evidence_ids
                                 ELSE ARRAY(SELECT DISTINCT unnest(COALESCE(evidence_ids,'{}') || p_evidence_ids))
                               END,
         updated_at          = now()
   WHERE id = p_memory_id;

  -- 3. The learning event. Same transaction, so a belief cannot change without
  --    an explanation existing.
  INSERT INTO growth_brain_learning_events (
    workspace_id, founder_id, product_id, event_type,
    trigger, previous_state, new_state,
    prior_confidence, new_confidence,
    evidence, created_by_type, trace_id
  ) VALUES (
    m.workspace_id, m.founder_id, m.product_id, p_event_type,
    -- Owner-facing one-liner, matching how the connection domain writes it.
    COALESCE(p_reason, p_event_type),
    format('%s (v%s): %s', v_prior_status, m.version, m.title),
    format('%s (v%s)%s', p_to_status, v_next_version,
           CASE WHEN p_requires_review THEN ' — awaiting founder review' ELSE '' END),
    -- The log stores confidence on a 0-100 scale (it renders as the Growth Brain
    -- understanding score); memories store 0-1. Converted here rather than at
    -- every call site, so the two scales cannot drift.
    ROUND(v_prior_conf * 100, 2),
    ROUND(COALESCE(p_new_confidence, v_prior_conf) * 100, 2),
    jsonb_build_array(
      jsonb_build_object('label','reason',        'value', COALESCE(p_reason,'')),
      jsonb_build_object('label','classification','value', COALESCE(p_classification,'n/a')),
      jsonb_build_object('label','policy version','value', COALESCE(p_policy_version::text,'n/a')),
      jsonb_build_object('label','memory',        'value', p_memory_id::text),
      jsonb_build_object('label','evidence count','value', COALESCE(array_length(p_evidence_ids,1),0)::text)
    ),
    -- The table records only 'system' or 'founder'. An AI-proposed change is
    -- still a SYSTEM change: the model proposed, the policy engine decided.
    CASE WHEN p_actor_type = 'founder' THEN 'founder' ELSE 'system' END,
    p_trace_id
  )
  RETURNING id INTO v_event_id;

  RETURN QUERY SELECT v_next_version, v_event_id, v_prior_status, v_prior_conf;
END $$;

REVOKE ALL ON FUNCTION lm_apply_memory_transition(UUID,UUID,TEXT,TEXT,TEXT,TEXT,NUMERIC,INTEGER,TEXT,UUID[],UUID,BOOLEAN,TEXT,TEXT,BOOLEAN)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION lm_apply_memory_transition(UUID,UUID,TEXT,TEXT,TEXT,TEXT,NUMERIC,INTEGER,TEXT,UUID[],UUID,BOOLEAN,TEXT,TEXT,BOOLEAN)
  TO service_role;

COMMENT ON FUNCTION lm_apply_memory_transition IS
  'The ONLY sanctioned way to move a memory between lifecycle states. Snapshot, '
  'transition and learning event commit together, so a belief can never change '
  'without an explanation existing.';

-- ── Observability (§16) ──────────────────────────────────────────────────────
CREATE OR REPLACE VIEW memory_lifecycle_stats AS
SELECT
  m.workspace_id,
  COUNT(*)                                              AS total_memories,
  COUNT(*) FILTER (WHERE m.status = 'active')           AS active,
  COUNT(*) FILTER (WHERE m.status = 'challenged')       AS challenged,
  COUNT(*) FILTER (WHERE m.status = 'superseded')       AS superseded,
  COUNT(*) FILTER (WHERE m.status = 'retracted')        AS retracted,
  COUNT(*) FILTER (WHERE m.status = 'stale')            AS stale,
  COUNT(*) FILTER (WHERE m.review_required)             AS review_required,
  COUNT(*) FILTER (WHERE m.reinforcement_count > 0)     AS reinforced,
  COUNT(*) FILTER (WHERE m.assertion_class = 'founder_assertion') AS founder_assertions,
  (SELECT COUNT(*) FROM memory_challenges c
    WHERE c.workspace_id = m.workspace_id AND c.status = 'open')  AS open_challenges,
  (SELECT COUNT(*) FROM growth_brain_learning_events e
    WHERE e.workspace_id = m.workspace_id)                        AS learning_events
FROM marketing_memories m
GROUP BY m.workspace_id;

GRANT SELECT ON memory_lifecycle_stats TO service_role;
