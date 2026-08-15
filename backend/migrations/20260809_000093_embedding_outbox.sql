-- ============================================================================
-- 093 — Transactional embedding outbox
--
-- Phase 3.1C. Implements ADR-066 rules 25, 26 and 27.
--
-- ATOMICITY IS ACHIEVED BY TRIGGER, NOT BY AN RPC.
--
--   The requirement is that a canonical write and its embedding-work intent
--   commit together, so a memory can never exist without its job. Two mechanisms
--   were considered:
--
--     RPC     — a function that writes the memory AND the outbox row. Atomic,
--               but only for callers that remember to use it. A new call site
--               that inserts directly compiles, passes review, and silently
--               stops producing embeddings. The gap is invisible until someone
--               notices retrieval is missing recent memories.
--
--     TRIGGER — an AFTER INSERT/UPDATE trigger on each canonical table. Atomic
--               by construction, and UNBYPASSABLE: every writer gets it,
--               including backfills, admin SQL and future code nobody has
--               written yet.
--
--   The trigger is chosen. It also means Phase 3.1C requires NO service-layer
--   changes at all, which is what keeps the "no production behaviour change"
--   guarantee credible rather than merely asserted.
--
-- WHY content_hash IS NULLABLE HERE.
--   The canonical hash comes from toEmbeddingText(), a versioned TypeScript
--   renderer. Postgres cannot run it, so the trigger cannot know the hash. The
--   worker computes it, and short-circuits when a CURRENT embedding already
--   carries that hash — so an UPDATE that does not change canonical text costs
--   one cheap comparison and no embedding call.
--
--   De-duplication of *work* is handled instead by a partial unique index on
--   (source_type, source_id, source_field) WHERE status IN ('pending','processing'):
--   ten rapid edits coalesce into ONE pending job rather than ten.
--
-- @security workspace_id is copied from the canonical row, never supplied by a
--   caller. RLS mirrors memory_embeddings. Global (playbook) work carries NULL
--   workspace_id and is constrained to the playbook source type.
-- @idempotent Safe to run repeatedly.
-- ============================================================================

CREATE TABLE IF NOT EXISTS embedding_outbox (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULL only for global playbook work; constrained below.
  workspace_id        UUID REFERENCES workspaces(id) ON DELETE CASCADE,

  source_type         TEXT        NOT NULL
                      CHECK (source_type IN (
                        'marketing_memory','marketing_memory_version',
                        'evidence','playbook_signal','product_icp')),
  source_id           UUID        NOT NULL,
  source_field        TEXT        NOT NULL DEFAULT 'canonical',

  -- Filled by the worker once the canonical text has been rendered.
  rendering_version   INTEGER,
  content_hash        TEXT        CHECK (content_hash IS NULL OR content_hash ~ '^[a-f0-9]{64}$'),

  -- The contract this job was created against. Recorded so a model change
  -- produces new work rather than silently reusing a vector of another family.
  requested_provider  TEXT        NOT NULL,
  requested_model     TEXT        NOT NULL,
  requested_dimensions INTEGER    NOT NULL CHECK (requested_dimensions BETWEEN 1 AND 16000),

  status              TEXT        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','processing','completed','failed','cancelled')),
  reason              TEXT,          -- why enqueued: created | updated | backfill | model_changed
  attempt_count       INTEGER     NOT NULL DEFAULT 0,

  -- Visibility timeout: a claimed job whose worker died becomes claimable again
  -- once available_at passes. Without it a crash strands work forever.
  available_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at           TIMESTAMPTZ,
  locked_by           TEXT,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,

  last_error_code     TEXT,
  last_error_detail   TEXT,          -- machine-safe summary; never provider payloads

  trace_id            TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  -- Same tenancy shape as memory_embeddings, for the same reason: a playbook job
  -- carrying a workspace could produce a vector that looks tenant-owned.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'embedding_outbox_tenancy_shape') THEN
    ALTER TABLE embedding_outbox ADD CONSTRAINT embedding_outbox_tenancy_shape CHECK (
      (source_type =  'playbook_signal' AND workspace_id IS NULL) OR
      (source_type <> 'playbook_signal' AND workspace_id IS NOT NULL)
    );
  END IF;
END $$;

-- ONE open job per source projection. Repeated edits coalesce.
CREATE UNIQUE INDEX IF NOT EXISTS embedding_outbox_one_open_job
  ON embedding_outbox (source_type, source_id, source_field)
  WHERE status IN ('pending','processing');

-- Claim path.
CREATE INDEX IF NOT EXISTS embedding_outbox_claimable
  ON embedding_outbox (available_at)
  WHERE status = 'pending';

-- Queue-age and backlog metrics (rule 27).
CREATE INDEX IF NOT EXISTS embedding_outbox_open
  ON embedding_outbox (status, created_at)
  WHERE status IN ('pending','processing','failed');

DROP TRIGGER IF EXISTS embedding_outbox_touch ON embedding_outbox;
CREATE TRIGGER embedding_outbox_touch
  BEFORE UPDATE ON embedding_outbox
  FOR EACH ROW EXECUTE FUNCTION lm_touch_updated_at();

-- ── Atomic enqueue ───────────────────────────────────────────────────────────
--
-- The active embedding contract lives in one place. It is read by the trigger
-- so that enqueued work records the family it was created for. Changing it is a
-- deliberate migration, not an env var read at row-write time — a job must not
-- silently belong to a different model than the one running when it was made.
CREATE TABLE IF NOT EXISTS embedding_contract (
  id                 INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  provider           TEXT    NOT NULL,
  model              TEXT    NOT NULL,
  dimensions         INTEGER NOT NULL CHECK (dimensions BETWEEN 1 AND 16000),
  embedding_version  INTEGER NOT NULL DEFAULT 1,
  -- When false, triggers record intent but the worker will not call a provider.
  -- This is how 3.1C ships enabled-for-durability and disabled-for-generation.
  generation_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO embedding_contract (id, provider, model, dimensions, embedding_version, generation_enabled)
VALUES (1, 'unconfigured', 'unconfigured', 1024, 1, false)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE embedding_contract IS
  'Single-row active embedding contract. generation_enabled stays false until a '
  'provider credential is provisioned and 3.1C live validation passes.';

/**
 * Enqueues embedding work for the row being written, in the SAME transaction.
 *
 * Never throws into the caller's transaction: a failure to record embedding
 * intent must not roll back a founder's memory. It is recorded as a warning
 * instead, and the backfill will pick the row up.
 */
CREATE OR REPLACE FUNCTION lm_enqueue_embedding_work() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source_type TEXT := TG_ARGV[0];
  v_workspace   UUID;
  v_contract    embedding_contract%ROWTYPE;
BEGIN
  SELECT * INTO v_contract FROM embedding_contract WHERE id = 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Tenancy is copied from the canonical row, never supplied by a caller.
  IF v_source_type = 'playbook_signal' THEN
    -- Global source: only eligible signals produce work (ADR-066 rule 45).
    IF NOT COALESCE(NEW.embedding_eligible, false) THEN RETURN NEW; END IF;
    v_workspace := NULL;
  ELSE
    v_workspace := NEW.workspace_id;
    IF v_workspace IS NULL THEN RETURN NEW; END IF;
  END IF;

  INSERT INTO embedding_outbox (
    workspace_id, source_type, source_id, source_field,
    requested_provider, requested_model, requested_dimensions,
    status, reason
  ) VALUES (
    v_workspace, v_source_type, NEW.id, 'canonical',
    v_contract.provider, v_contract.model, v_contract.dimensions,
    'pending', CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'updated' END
  )
  -- An open job already covers this source. The worker re-renders from the
  -- CURRENT canonical row when it runs, so one job absorbs any number of edits.
  ON CONFLICT (source_type, source_id, source_field)
    WHERE status IN ('pending','processing')
  DO UPDATE SET reason = 'updated', updated_at = now();

  -- Conservative staleness (ADR-066 rule 11). The trigger cannot run the
  -- TypeScript renderer, so it cannot know whether this UPDATE changed the
  -- canonical text. It therefore assumes it MIGHT have and marks the existing
  -- vector stale. Under-serving a vector for a few seconds is recoverable;
  -- serving one built from superseded text is not, and would be invisible.
  -- The worker restores 'current' without a provider call when the hash matches.
  IF TG_OP = 'UPDATE' THEN
    UPDATE memory_embeddings
       SET status = 'stale'
     WHERE source_type = v_source_type
       AND source_id   = NEW.id
       AND status      = 'current';
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'embedding enqueue failed for %/%: %', v_source_type, NEW.id, SQLERRM;
  RETURN NEW;
END $$;

-- Attach to every eligible canonical table.
DO $$
DECLARE
  pair TEXT[];
  pairs TEXT[][] := ARRAY[
    ARRAY['marketing_memories', 'marketing_memory'],
    ARRAY['evidence',           'evidence'],
    ARRAY['products',           'product_icp'],
    ARRAY['playbook_signals',   'playbook_signal']
  ];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY pairs
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = pair[1]) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', pair[1] || '_enqueue_embedding', pair[1]);
      EXECUTE format(
        'CREATE TRIGGER %I AFTER INSERT OR UPDATE ON %I FOR EACH ROW '
        'EXECUTE FUNCTION lm_enqueue_embedding_work(%L)',
        pair[1] || '_enqueue_embedding', pair[1], pair[2]);
    END IF;
  END LOOP;
END $$;

-- ── Cancel work whose source disappeared ─────────────────────────────────────
-- Migration 092 deletes derived vectors when a source goes. Open JOBS need the
-- same treatment, or the worker would later load nothing and retry until its
-- attempts ran out — noise that looks like a provider failure.
CREATE OR REPLACE FUNCTION lm_cancel_embedding_work() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE embedding_outbox
     SET status = 'cancelled', last_error_code = 'SOURCE_DELETED', completed_at = now()
   WHERE source_type = TG_ARGV[0]
     AND source_id   = OLD.id
     AND status IN ('pending','processing');
  RETURN OLD;
END $$;

DO $$
DECLARE
  pair TEXT[];
  pairs TEXT[][] := ARRAY[
    ARRAY['marketing_memories', 'marketing_memory'],
    ARRAY['evidence',           'evidence'],
    ARRAY['products',           'product_icp'],
    ARRAY['playbook_signals',   'playbook_signal']
  ];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY pairs
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = pair[1]) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', pair[1] || '_cancel_embedding', pair[1]);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW '
        'EXECUTE FUNCTION lm_cancel_embedding_work(%L)',
        pair[1] || '_cancel_embedding', pair[1], pair[2]);
    END IF;
  END LOOP;
END $$;

-- ── Claim ────────────────────────────────────────────────────────────────────
/**
 * Atomically claims up to p_limit pending jobs.
 *
 * FOR UPDATE SKIP LOCKED is what makes several workers safe without a
 * distributed lock: each transaction takes rows nobody else holds, so two
 * workers never claim the same job and neither blocks the other.
 */
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
     WHERE status = 'pending' AND available_at <= now()
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

-- ── Observability (rule 27) ──────────────────────────────────────────────────
CREATE OR REPLACE VIEW embedding_pipeline_stats AS
SELECT
  COUNT(*) FILTER (WHERE status = 'pending')    AS pending_jobs,
  COUNT(*) FILTER (WHERE status = 'processing') AS processing_jobs,
  COUNT(*) FILTER (WHERE status = 'failed')     AS failed_jobs,
  COUNT(*) FILTER (WHERE status = 'cancelled')  AS cancelled_jobs,
  COUNT(*) FILTER (WHERE status = 'completed')  AS completed_jobs,
  -- Age of the OLDEST waiting job: the number that tells you the pipeline has
  -- stopped, which an average would hide.
  COALESCE(EXTRACT(EPOCH FROM (now() - MIN(created_at)
    FILTER (WHERE status IN ('pending','processing'))))::BIGINT, 0) AS queue_age_seconds,
  (SELECT COUNT(*) FROM memory_embeddings WHERE status = 'stale')     AS stale_embeddings,
  (SELECT COUNT(*) FROM memory_embeddings WHERE status = 'current')   AS current_embeddings
FROM embedding_outbox;

GRANT SELECT ON embedding_pipeline_stats TO service_role;

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE embedding_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS embedding_outbox_ws_read ON embedding_outbox;
CREATE POLICY embedding_outbox_ws_read ON embedding_outbox
  FOR SELECT USING (workspace_id IS NOT NULL AND lm_is_workspace_member(workspace_id));

-- The outbox is operational state. Clients never write it; the trigger and the
-- worker (service_role) do.
REVOKE INSERT, UPDATE, DELETE ON embedding_outbox FROM authenticated, anon;
GRANT SELECT ON embedding_outbox TO authenticated;

ALTER TABLE embedding_contract ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON embedding_contract FROM authenticated, anon;
