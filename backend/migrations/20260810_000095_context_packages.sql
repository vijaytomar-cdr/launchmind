-- ============================================================================
-- 095 — Persistent ContextPackage provenance
--
-- Phase 3.1E. Implements ADR-066 rules 21, 22, 23 and 24: every important model
-- decision records WHICH canonical records, at WHICH versions, were supplied to
-- it — so "why did you recommend this?" is answerable by lookup rather than by
-- trust.
--
-- REFERENCES, NOT PROSE (rule 22). An item stores memory_id + version +
-- content_hash + evidence ids, never the memory text. Three reasons, in order of
-- importance:
--
--   1. Copied prose is a SECOND source of truth and drifts from the first
--      (invariant 1). A package saying one thing while the memory says another
--      is worse than no record at all.
--   2. Account deletion stays tractable. Duplicating tenant content into an
--      audit table would create copies outside the canonical retention model —
--      exactly what rule 47 forbids.
--   3. It is far smaller.
--
--   The cost is that reconstruction must handle a deleted source. It does, and
--   says so explicitly, rather than inventing text (rule 24 / Step 3.1E §23).
--
-- WHY content_hash IS STORED ANYWAY. It is not the text; it is a fingerprint of
-- the text as rendered AT THE TIME. Reconstruction compares it against the
-- memory's hash today and can therefore state "this memory has changed since"
-- instead of silently presenting today's wording as what the model saw. Version
-- alone cannot do that: a renderer change alters the rendering without touching
-- the version.
--
-- IMMUTABILITY (Step 3.1E §5). Packages are append-only. A package describes a
-- decision that has already happened; editing it would falsify an audit record.
-- Enforced by the same trigger pattern as migration 091, with the same
-- controlled-erasure escape.
--
-- @security Workspace-scoped RLS. Items carry no tenant text, so a leak exposes
--   ids and ranks, not memory content — though the RLS still prevents that.
-- @idempotent Safe to run repeatedly.
-- ============================================================================

-- ── Retention classes (Step 3.1E §6) ─────────────────────────────────────────
-- Declared as data rather than hard-coded so retention is inspectable and can be
-- changed by migration with an audit trail, rather than by editing a constant.
--
-- These are OPERATIONAL defaults chosen for usefulness and cost. They are NOT a
-- legal guarantee, and nothing here should be read as one.
CREATE TABLE IF NOT EXISTS context_retention_classes (
  name        TEXT PRIMARY KEY,
  ttl_days    INTEGER,          -- NULL = retain with the decision it explains
  description TEXT NOT NULL
);

INSERT INTO context_retention_classes (name, ttl_days, description) VALUES
  ('decision',  NULL, 'Context behind a durable owner-facing decision (strategy, recommendation, campaign plan). Retained as long as the decision it explains.'),
  ('briefing',  365,  'Morning Brief and periodic summaries. One year, so a season can be reviewed.'),
  ('ephemeral', 30,   'Ad-hoc assistance such as Ask LaunchMind. Short-lived; the answer is not a durable commitment.')
ON CONFLICT (name) DO NOTHING;

-- ── Packages ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS context_packages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id       UUID REFERENCES products(id) ON DELETE SET NULL,
  -- Attribution: who the package was built for. Tenancy is workspace_id.
  founder_id       UUID REFERENCES founders(id) ON DELETE SET NULL,

  context_type     TEXT NOT NULL,           -- governed intent; see contextIntents.ts
  retention_class  TEXT NOT NULL DEFAULT 'ephemeral'
                   REFERENCES context_retention_classes(name),

  -- What retrieval was actually able to do. Persisted because a package built
  -- while the semantic arm was down is a different artifact from one built with
  -- it, and six months later nobody will remember which.
  retrieval_mode   TEXT NOT NULL
                   CHECK (retrieval_mode IN ('HYBRID','LEXICAL_ONLY','STRUCTURED_ONLY','FAILED','NONE')),
  degraded         BOOLEAN NOT NULL DEFAULT false,
  degraded_reasons TEXT[]  NOT NULL DEFAULT '{}',

  -- Distinguishes "no relevant memory exists" from "retrieval failed" from
  -- "excluded by policy/budget" (Step 3.1E §16).
  memory_outcome   TEXT NOT NULL DEFAULT 'none'
                   CHECK (memory_outcome IN ('selected','none_relevant','retrieval_failed','excluded_by_budget')),

  memories_considered INTEGER NOT NULL DEFAULT 0,
  memories_selected   INTEGER NOT NULL DEFAULT 0,
  excluded_for_budget INTEGER NOT NULL DEFAULT 0,

  token_budget     INTEGER NOT NULL,
  tokens_used      INTEGER NOT NULL DEFAULT 0,
  build_ms         INTEGER,

  trace_id         TEXT,
  expires_at       TIMESTAMPTZ,     -- computed from retention_class at insert
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS context_packages_workspace ON context_packages (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS context_packages_type      ON context_packages (context_type, created_at DESC);
CREATE INDEX IF NOT EXISTS context_packages_expiry    ON context_packages (expires_at) WHERE expires_at IS NOT NULL;

-- ── Items ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS context_package_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  context_package_id  UUID NOT NULL REFERENCES context_packages(id) ON DELETE CASCADE,
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  item_type           TEXT NOT NULL
                      CHECK (item_type IN (
                        'marketing_memory','evidence','knowledge_node',
                        'campaign','campaign_metric','founder_context',
                        'business_goal','strategy_direction','competitor','product','founder')),

  -- Canonical reference. NOT the content.
  source_id           UUID,
  source_version      INTEGER,
  content_hash        TEXT,
  evidence_ids        UUID[] NOT NULL DEFAULT '{}',

  -- Why it was here, and how it was found.
  inclusion_reason    TEXT NOT NULL
                      CHECK (inclusion_reason IN (
                        'authoritative','founder_confirmed','retrieved','operational','constraint')),
  retrieval_arms      TEXT[] NOT NULL DEFAULT '{}',
  lexical_rank        INTEGER,
  semantic_rank       INTEGER,
  fused_rank          INTEGER,
  final_rank          INTEGER,
  position            INTEGER NOT NULL,     -- order as presented to the model
  estimated_tokens    INTEGER NOT NULL DEFAULT 0,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS context_package_items_pkg
  ON context_package_items (context_package_id, position);
CREATE INDEX IF NOT EXISTS context_package_items_source
  ON context_package_items (item_type, source_id);

-- ── Link AI requests to the context that produced them (rule 21) ─────────────
-- Additive and nullable: existing rows stay valid, and utility calls that carry
-- no provenance value are legitimately left unlinked.
ALTER TABLE ai_requests
  ADD COLUMN IF NOT EXISTS context_package_id UUID REFERENCES context_packages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ai_requests_context_package
  ON ai_requests (context_package_id) WHERE context_package_id IS NOT NULL;

COMMENT ON COLUMN ai_requests.context_package_id IS
  'ADR-066 rule 21. The chain output → ai_request → context_package → memory '
  'version is what makes "why did you recommend this?" answerable.';

-- ── Immutability ─────────────────────────────────────────────────────────────
-- A package records a decision already made. UPDATE is always refused; DELETE is
-- refused except under the erasure flag from migration 091, so account deletion
-- and retention pruning still work through one auditable path.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['context_packages','context_package_items']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_append_only', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION lm_reject_history_mutation()', t || '_append_only', t);
    EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM authenticated, anon', t);
  END LOOP;
END $$;

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE context_packages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE context_package_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS context_packages_ws_read ON context_packages;
CREATE POLICY context_packages_ws_read ON context_packages
  FOR SELECT USING (lm_is_workspace_member(workspace_id));

DROP POLICY IF EXISTS context_package_items_ws_read ON context_package_items;
CREATE POLICY context_package_items_ws_read ON context_package_items
  FOR SELECT USING (lm_is_workspace_member(workspace_id));

REVOKE INSERT ON context_packages, context_package_items FROM authenticated, anon;
GRANT  SELECT ON context_packages, context_package_items TO authenticated;

ALTER TABLE context_retention_classes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS context_retention_classes_read ON context_retention_classes;
CREATE POLICY context_retention_classes_read ON context_retention_classes FOR SELECT USING (true);
GRANT SELECT ON context_retention_classes TO authenticated;

-- ── Retention pruning ────────────────────────────────────────────────────────
/**
 * Deletes packages past their retention TTL.
 *
 * Runs inside the erasure flag because the append-only trigger would otherwise
 * refuse — deliberately, so that pruning is a named, auditable operation rather
 * than something any caller can do with a DELETE.
 *
 * `decision`-class packages have a NULL ttl_days and are NEVER pruned here: they
 * are retained with the decision they explain, and disappear only when that
 * decision's workspace is erased.
 */
CREATE OR REPLACE FUNCTION lm_prune_expired_context_packages()
RETURNS TABLE (packages_deleted BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n BIGINT;
BEGIN
  PERFORM set_config('lm.allow_history_mutation', 'on', true);
  DELETE FROM context_packages
   WHERE expires_at IS NOT NULL AND expires_at < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN QUERY SELECT n;
END $$;

REVOKE ALL ON FUNCTION lm_prune_expired_context_packages() FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION lm_prune_expired_context_packages() TO service_role;

COMMENT ON TABLE context_packages IS
  'ADR-066 rules 21-24. Stores canonical references and versions, never memory '
  'prose, so provenance cannot drift from the record it cites and account '
  'deletion stays tractable.';
