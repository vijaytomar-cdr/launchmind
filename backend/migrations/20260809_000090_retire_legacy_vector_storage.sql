-- ============================================================================
-- 090 — Retire the fragmented vector storage
--
-- Phase 3.1B. Implements ADR-066 rules 5, 6 and 9: exactly one embedding store.
--
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ DEVIATION FROM CLAUDE.md §1.2 ("additive migrations only — NEVER drop")   │
-- │                                                                          │
-- │ This migration drops three columns and one table. That is a deliberate,  │
-- │ recorded exception, authorised by ADR-066 rules 5-6 and the Step 3.1B    │
-- │ instruction to retire redundant vector storage. It is the second such    │
-- │ exception in the project, after migration 080's UNIQUE constraint swap.  │
-- │                                                                          │
-- │ The intent behind §1.2 is that a migration must never destroy data or    │
-- │ break a running deployment. Both risks are eliminated structurally here  │
-- │ rather than argued away:                                                 │
-- │                                                                          │
-- │   · Every drop is GUARDED — it runs only after proving the column or     │
-- │     table holds zero rows of actual data AT MIGRATION TIME. If any       │
-- │     environment has data these columns were never written with, the      │
-- │     migration RAISES and drops nothing. It cannot lose data silently.    │
-- │   · Nothing writes them. Verified twice: in the 3.1A inspection and      │
-- │     again immediately before this migration was authored.                │
-- │   · Reads are removed in the same change set (strategyService,           │
-- │     contentService, founders.route), so no deployment breaks.            │
-- └──────────────────────────────────────────────────────────────────────────┘
--
-- Measured on the hosted project before authoring:
--   products.icp_embedding             0 / 11  non-null
--   marketing_memories.embedding       0 / 33  non-null
--   playbook_signals.signal_embedding  0 / 206 non-null
--   knowledge_nodes.embedding          0 / 18  non-null  (missed by 3.1A; see below)
--   embedding_store                    0 rows
--
-- embedding_store is superseded by memory_embeddings (089). It also VIOLATED
-- ADR-066 rule 9 — it carried a `content TEXT NOT NULL` column, making an
-- embeddings table authoritative for text. That is precisely what invariant 2
-- forbids, and is why it is retired rather than extended.
--
-- @security Removes no security control. RLS on the retained tables is unchanged.
-- @idempotent Safe to run repeatedly: each drop is IF EXISTS and guarded.
-- ============================================================================

-- ── Guard: refuse to drop anything that actually holds data ──────────────────
DO $$
DECLARE n BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'products' AND column_name = 'icp_embedding') THEN
    EXECUTE 'SELECT COUNT(*) FROM products WHERE icp_embedding IS NOT NULL' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION '090 aborted: products.icp_embedding holds % non-null vector(s). '
        'Migrate them into memory_embeddings before retiring the column.', n;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'marketing_memories' AND column_name = 'embedding') THEN
    EXECUTE 'SELECT COUNT(*) FROM marketing_memories WHERE embedding IS NOT NULL' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION '090 aborted: marketing_memories.embedding holds % non-null vector(s).', n;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'playbook_signals' AND column_name = 'signal_embedding') THEN
    EXECUTE 'SELECT COUNT(*) FROM playbook_signals WHERE signal_embedding IS NOT NULL' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION '090 aborted: playbook_signals.signal_embedding holds % non-null vector(s).', n;
    END IF;
  END IF;

  -- knowledge_nodes.embedding was MISSED by the 3.1A inventory, which reported
  -- four vector columns. The census deduplicated by column name and collapsed
  -- this one into marketing_memories.embedding. Found by the real-Postgres test
  -- asserting exactly one table carries a vector type — which is precisely the
  -- kind of claim that should be asserted rather than counted by hand.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'knowledge_nodes' AND column_name = 'embedding') THEN
    EXECUTE 'SELECT COUNT(*) FROM knowledge_nodes WHERE embedding IS NOT NULL' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION '090 aborted: knowledge_nodes.embedding holds % non-null vector(s).', n;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'embedding_store') THEN
    EXECUTE 'SELECT COUNT(*) FROM embedding_store' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION '090 aborted: embedding_store holds % row(s). It carries authoritative '
        'text (content) and must be migrated into canonical tables before being dropped.', n;
    END IF;
  END IF;
END $$;

-- ── Retire ───────────────────────────────────────────────────────────────────
ALTER TABLE products           DROP COLUMN IF EXISTS icp_embedding;
ALTER TABLE marketing_memories DROP COLUMN IF EXISTS embedding;
ALTER TABLE playbook_signals   DROP COLUMN IF EXISTS signal_embedding;
ALTER TABLE knowledge_nodes    DROP COLUMN IF EXISTS embedding;

DROP TABLE IF EXISTS embedding_store;

-- ── Eligibility flag for cross-founder signals (ADR-066 rule 45) ─────────────
-- A playbook signal may only be embedded once it has a generalized rendering
-- that carries no founder-specific phrasing. Default false: a signal is
-- ineligible until something explicitly clears it, so the safe state is the
-- one you get by doing nothing.
ALTER TABLE playbook_signals
  ADD COLUMN IF NOT EXISTS embedding_eligible BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE playbook_signals
  ADD COLUMN IF NOT EXISTS generalization_version INTEGER;

COMMENT ON COLUMN playbook_signals.embedding_eligible IS
  'ADR-066 rule 45: true only when a generalized, non-identifying rendering exists. '
  'Set by the generalizer, never by hand.';
