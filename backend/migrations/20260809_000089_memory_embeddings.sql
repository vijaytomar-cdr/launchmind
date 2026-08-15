-- ============================================================================
-- 089 — Canonical embedding store
--
-- Phase 3.1B. Implements ADR-066 rules 5, 8, 9, 11, 13 and 46.
-- Creates the ONE table in which every LaunchMind embedding will live.
--
-- NOTHING IS EMBEDDED BY THIS MIGRATION. The table is created empty and stays
-- empty until 3.1C builds the outbox worker. No embedding provider is called.
--
-- DIMENSION STRATEGY (ADR-066 §3.1, verified against pgvector 0.8.x):
--   The vector column is declared WITHOUT a dimension modifier, so one table
--   holds 768-, 1024-, 1536- and 3072-wide vectors as models change. Three
--   verified consequences:
--     · mixed widths coexist in the column
--     · a distance operator across mixed widths raises
--       `ERROR: different vector dimensions N and M` — every query MUST filter
--       embedding_model + embedding_version + dimensions first. The failure mode
--       is a hard error, never a silent mis-ranking.
--     · a dimension-less column CANNOT be ANN-indexed
--       (`ERROR: column does not have dimensions`)
--
--   The third point is deliberate, not a limitation worked around: ADR-066 rule
--   13 mandates exact scan only, and forbids HNSW/IVFFlat without a formal
--   amendment. When rule 14's thresholds trigger a review, the migration path is
--   PARTITION BY LIST (embedding_model) with a per-partition vector(N) and index.
--
-- NO AUTHORITATIVE TEXT LIVES HERE (rule 9): the table stores a hash, never the
--   rendered content. Truncating it costs recall and latency and destroys no
--   business knowledge — which is invariant 2, and is directly tested.
--
-- @security Workspace-scoped RLS via lm_is_workspace_member. Tenant-owned rows
--   always carry workspace_id; global (playbook) rows never do, and are readable
--   through a separate policy so they can never masquerade as tenant memory.
-- @idempotent Safe to run repeatedly.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS memory_embeddings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenancy. NULL only for global/anonymised sources (playbook_signal), which
  -- the CHECK below ties to source_type so a tenant row can never lose its
  -- workspace by omission.
  workspace_id       UUID REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Governed source identity (Step 3.1B §6) — an enumerated type, never a free
  -- -text table name, so a typo cannot silently create an unreadable partition
  -- of the index.
  source_type        TEXT        NOT NULL
                     CHECK (source_type IN (
                       'marketing_memory',
                       'marketing_memory_version',
                       'evidence',
                       'playbook_signal',
                       'product_icp'
                     )),
  source_id          UUID        NOT NULL,
  -- Which rendered projection of the source this vector represents.
  source_field       TEXT        NOT NULL DEFAULT 'canonical',

  -- Provider independence (ADR-066 §7). Recorded per row so a model change is a
  -- backfill, not a schema rewrite.
  embedding_provider TEXT        NOT NULL,
  embedding_model    TEXT        NOT NULL,
  dimensions         INTEGER     NOT NULL CHECK (dimensions BETWEEN 1 AND 16000),
  embedding_version  INTEGER     NOT NULL DEFAULT 1 CHECK (embedding_version >= 1),

  -- Renderer identity (rule 10) and staleness key (rule 11).
  rendering_version  INTEGER     NOT NULL CHECK (rendering_version >= 1),
  content_hash       TEXT        NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),

  -- Dimension-less on purpose. See the header.
  embedding          vector,

  status             TEXT        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','current','stale','failed','ineligible')),
  last_error         TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Structural constraints that make malformed rows impossible ───────────────

DO $$ BEGIN
  -- Tenant sources MUST carry a workspace; global sources MUST NOT.
  -- Without this, a playbook embedding could be inserted with a workspace_id and
  -- would then be returned by tenant retrieval as if it were the owner's own
  -- memory, which ADR-066 rule 45 exists to prevent.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memory_embeddings_tenancy_shape') THEN
    ALTER TABLE memory_embeddings ADD CONSTRAINT memory_embeddings_tenancy_shape CHECK (
      (source_type = 'playbook_signal' AND workspace_id IS NULL)
      OR
      (source_type <> 'playbook_signal' AND workspace_id IS NOT NULL)
    );
  END IF;

  -- A row claiming to be usable must actually carry a vector; a row without one
  -- must say so in its status rather than silently returning no neighbours.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memory_embeddings_vector_presence') THEN
    ALTER TABLE memory_embeddings ADD CONSTRAINT memory_embeddings_vector_presence CHECK (
      (status IN ('current','stale') AND embedding IS NOT NULL)
      OR
      (status IN ('pending','failed','ineligible'))
    );
  END IF;

  -- The recorded width must match the stored vector. Otherwise the mandatory
  -- `dimensions = N` filter could select a vector of a different width and the
  -- query would fail at distance time with a confusing error far from the cause.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memory_embeddings_dimension_match') THEN
    ALTER TABLE memory_embeddings ADD CONSTRAINT memory_embeddings_dimension_match CHECK (
      embedding IS NULL OR vector_dims(embedding) = dimensions
    );
  END IF;
END $$;

-- One vector per (source projection, model generation). Re-embedding the same
-- source with the same model replaces rather than accumulates.
CREATE UNIQUE INDEX IF NOT EXISTS memory_embeddings_identity
  ON memory_embeddings (source_type, source_id, source_field, embedding_model, embedding_version);

CREATE INDEX IF NOT EXISTS memory_embeddings_workspace
  ON memory_embeddings (workspace_id, source_type, status);

-- Backlog queries for the 3.1C worker and the rule-12 health metrics.
CREATE INDEX IF NOT EXISTS memory_embeddings_stale
  ON memory_embeddings (status) WHERE status IN ('stale','pending','failed');

-- Deliberately NO ivfflat / hnsw index. ADR-066 rule 13.

-- ── updated_at ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION lm_touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS memory_embeddings_touch ON memory_embeddings;
CREATE TRIGGER memory_embeddings_touch
  BEFORE UPDATE ON memory_embeddings
  FOR EACH ROW EXECUTE FUNCTION lm_touch_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE memory_embeddings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS memory_embeddings_ws_read   ON memory_embeddings;
DROP POLICY IF EXISTS memory_embeddings_ws_write  ON memory_embeddings;
DROP POLICY IF EXISTS memory_embeddings_global_read ON memory_embeddings;

-- Tenant-owned vectors: members only.
CREATE POLICY memory_embeddings_ws_read ON memory_embeddings
  FOR SELECT USING (workspace_id IS NOT NULL AND lm_is_workspace_member(workspace_id));

CREATE POLICY memory_embeddings_ws_write ON memory_embeddings
  FOR ALL USING (workspace_id IS NOT NULL AND lm_can_write_workspace(workspace_id))
          WITH CHECK (workspace_id IS NOT NULL AND lm_can_write_workspace(workspace_id));

-- Global playbook vectors: a SEPARATE, read-only path (Step 3.1B §12). Kept
-- distinct so cross-founder signals can never be served as workspace memory.
CREATE POLICY memory_embeddings_global_read ON memory_embeddings
  FOR SELECT USING (workspace_id IS NULL AND source_type = 'playbook_signal');

-- Nobody may write global embeddings through the client API; that path is
-- service_role only.
REVOKE INSERT, UPDATE, DELETE ON memory_embeddings FROM authenticated, anon;
GRANT  SELECT ON memory_embeddings TO authenticated;

COMMENT ON TABLE memory_embeddings IS
  'ADR-066: the single canonical embedding store. Derived, rebuildable, and '
  'authoritative for nothing. Empty until Phase 3.1C.';
