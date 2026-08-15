-- ============================================================================
-- 094 — PostgreSQL full-text search over Marketing Memory
--
-- Phase 3.1D. Implements ADR-066 rule 16: replace ILIKE with real full-text
-- retrieval.
--
-- WHY ILIKE HAD TO GO, measured rather than assumed (3.1A baseline):
--   `searchMemories` matched `ILIKE '%<entire question>%'` against `title`, so a
--   natural-language query was tested as ONE literal substring. "What positioning
--   has historically worked best?" cannot match any title, because no title
--   contains that sentence. Recall@5 was 9.4% with the shipped defect removed —
--   a property of substring matching, not a tuning problem.
--
-- WHAT THE INDEXED TEXT IS:
--   `title` (weight A) + `content->>'claim'` (weight B) + the scope qualifiers
--   that change a claim's meaning (weight C): segment, channel, market, metric.
--   This mirrors the governed renderer in embeddingRenderer.ts rather than
--   serialising raw JSONB — ADR-066 rule 10 applies to the lexical arm for the
--   same reason it applies to embeddings: `JSON.stringify` indexes key names and
--   punctuation, which are not marketing meaning.
--
--   It is a GENERATED column, so it cannot drift from the row it describes. The
--   alternative — a trigger-maintained column — has a failure mode where the
--   trigger is dropped and the index quietly serves stale text.
--
-- WEIGHTING: A > B > C. A title is written to be the claim in miniature; the
--   claim body elaborates it; the qualifiers disambiguate. `ts_rank_cd` then
--   favours a title hit over an incidental qualifier match, which is the
--   ordering a reader would expect.
--
-- NOTE ON `simple` VS `english`: the `english` configuration is used so that
--   "converting"/"converts"/"conversion" stem together and stop-words are
--   dropped. 3.1A recorded `retrieval_003` failing because "emphasizing" did not
--   substring-match "emphasis"; stemming is precisely the fix.
--
-- @security No RLS change. The GIN index carries no data not already in the row.
-- @idempotent Safe to run repeatedly.
-- ============================================================================

ALTER TABLE marketing_memories
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content->>'claim', '')), 'B') ||
    -- `||` rather than concat_ws: concat_ws is STABLE, not IMMUTABLE, and a
    -- generated column requires an immutable expression ("generation expression
    -- is not immutable"). Plain concatenation of coalesced text is immutable.
    setweight(to_tsvector('english',
        coalesce(content->>'segment',   '') || ' ' ||
        coalesce(content->>'channel',   '') || ' ' ||
        coalesce(content->>'market',    '') || ' ' ||
        coalesce(content->>'metric',    '') || ' ' ||
        coalesce(content->>'timeframe', '') || ' ' ||
        coalesce(content->>'window',    '')
      ), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS marketing_memories_fts
  ON marketing_memories USING GIN (search_tsv);

-- Workspace-first composite: every retrieval filters tenancy before ranking, so
-- the planner should never consider another tenant's rows at all.
CREATE INDEX IF NOT EXISTS marketing_memories_ws_status_type
  ON marketing_memories (workspace_id, status, memory_type);

COMMENT ON COLUMN marketing_memories.search_tsv IS
  'ADR-066 rule 16. Generated from governed fields (title A, claim B, scope C), '
  'never from raw JSONB serialisation. Read by RetrievalService''s lexical arm.';

-- ── Exact semantic retrieval (ADR-066 rule 13: exact scan, NO ANN) ───────────
/**
 * Returns the nearest CURRENT embeddings for one workspace.
 *
 * Exists as a function because the mandatory pre-filter — model + version +
 * dimensions + status + workspace — must be applied BEFORE the distance
 * operator, and PostgREST cannot express `<=>` at all. Putting it here means
 * there is exactly one place where a vector comparison can happen, and it is
 * impossible to call without the filter.
 *
 * The dimensions filter is not defensive decoration: memory_embeddings.embedding
 * is dimension-less, so comparing across widths raises
 * `ERROR: different vector dimensions N and M` at runtime.
 *
 * @security workspace_id is a required argument and is applied inside the query.
 *   SECURITY DEFINER is deliberately NOT used — the caller's own privileges and
 *   RLS still apply.
 */
CREATE OR REPLACE FUNCTION lm_search_memory_embeddings(
  p_workspace_id UUID,
  p_query_vector vector,
  p_model        TEXT,
  p_version      INTEGER,
  p_dimensions   INTEGER,
  p_limit        INTEGER DEFAULT 20
)
RETURNS TABLE (source_id UUID, distance DOUBLE PRECISION)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT e.source_id,
         (e.embedding <=> p_query_vector)::DOUBLE PRECISION AS distance
    FROM memory_embeddings e
   WHERE e.workspace_id      = p_workspace_id      -- tenancy, before distance
     AND e.source_type       = 'marketing_memory'
     AND e.embedding_model   = p_model             -- family, before distance
     AND e.embedding_version = p_version
     AND e.dimensions        = p_dimensions        -- width, before distance
     AND e.status            = 'current'           -- stale/failed/pending excluded
     AND e.embedding IS NOT NULL
   ORDER BY e.embedding <=> p_query_vector
   LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION lm_search_memory_embeddings(UUID, vector, TEXT, INTEGER, INTEGER, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION lm_search_memory_embeddings(UUID, vector, TEXT, INTEGER, INTEGER, INTEGER)
  TO authenticated, service_role;

/**
 * Converts a parsed tsquery from AND semantics to OR semantics.
 *
 * WHY THIS IS NECESSARY. `websearch_to_tsquery` (like `plainto_tsquery`) joins
 * every term with `&`, so "What positioning has historically worked best?"
 * becomes `position & histor & work & best` — a memory must contain ALL FOUR to
 * match at all. For natural-language questions that is nearly as brittle as the
 * ILIKE it replaces, and measurably so: it returned zero rows for the 3.1A
 * question set in testing.
 *
 * Switching to `|` makes any term sufficient to MATCH, while `ts_rank_cd` still
 * ranks documents covering more terms higher — recall from OR, precision from
 * ranking, which is the standard shape for question-style retrieval.
 *
 * SAFETY: the input has already been parsed and normalised by
 * `websearch_to_tsquery`, so this operates on a canonical tsquery rendering,
 * not on raw owner text. There is no injection surface — an owner cannot smuggle
 * an operator through, because anything they typed was already reduced to
 * lexemes before this runs. Phrase (`<->`) and negation (`!`) operators are
 * untouched, so quoted phrases and -exclusions still behave as the owner meant.
 */
CREATE OR REPLACE FUNCTION lm_any_term_tsquery(p_config regconfig, p_query TEXT)
RETURNS tsquery
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN websearch_to_tsquery(p_config, p_query)::text = '' THEN NULL::tsquery
    ELSE replace(websearch_to_tsquery(p_config, p_query)::text, ' & ', ' | ')::tsquery
  END;
$$;

/**
 * Full-text arm.
 *
 * `websearch_to_tsquery` is used rather than `to_tsquery`: it accepts raw owner
 * input safely (quotes, OR, -negation) and cannot raise a syntax error on
 * punctuation, which `to_tsquery` does on input as ordinary as "What's next?".
 * Its AND semantics are then relaxed to OR — see lm_any_term_tsquery.
 */
CREATE OR REPLACE FUNCTION lm_search_memory_fulltext(
  p_workspace_id UUID,
  p_query        TEXT,
  p_product_id   UUID DEFAULT NULL,
  p_memory_types TEXT[] DEFAULT NULL,
  p_statuses     TEXT[] DEFAULT ARRAY['active'],
  p_limit        INTEGER DEFAULT 20
)
RETURNS TABLE (id UUID, rank DOUBLE PRECISION)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT m.id,
         ts_rank_cd(m.search_tsv, lm_any_term_tsquery('english', p_query))::DOUBLE PRECISION AS rank
    FROM marketing_memories m
   WHERE m.workspace_id = p_workspace_id
     AND (p_product_id   IS NULL OR m.product_id  = p_product_id)
     AND (p_memory_types IS NULL OR m.memory_type = ANY(p_memory_types))
     AND (p_statuses     IS NULL OR m.status      = ANY(p_statuses))
     AND lm_any_term_tsquery('english', p_query) IS NOT NULL
     AND m.search_tsv @@ lm_any_term_tsquery('english', p_query)
   ORDER BY rank DESC, m.confidence DESC, m.id     -- id breaks ties deterministically
   LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION lm_search_memory_fulltext(UUID, TEXT, UUID, TEXT[], TEXT[], INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION lm_search_memory_fulltext(UUID, TEXT, UUID, TEXT[], TEXT[], INTEGER)
  TO authenticated, service_role;
