-- ============================================================================
-- 099 — Governed memory class, persisted authority, governed scope
--
-- Phase 3.2A. Implements ADR-067 C3 (four-class taxonomy), C4 (persisted
-- versioned authority), C10 (governed scope), C11 (legacy quarantine),
-- C13 (scoped exceptions), C2 (domain linkage), C21 (evidence lifecycle shape).
--
-- THE LEGACY DISCRIMINATOR. `memory_class IS NULL` marks a row that predates
-- this migration. Every governed guard below is written as
-- "legacy OR governed-and-complete", which lets the 33 existing rows survive
-- untouched while making it impossible to create a NEW row without class,
-- authority, authority policy version and a scope key. Without that
-- discriminator these would have to be nullable-and-unchecked forever, and the
-- invariants would live only in review comments.
--
-- SCOPE KEY IS APPLICATION-COMPUTED, NOT GENERATED. A generated column would
-- need an IMMUTABLE expression, and this codebase has already been bitten by
-- assuming a function is immutable when it is only stable (`concat_ws`, 096).
-- More importantly ADR-067 C10 requires ONE canonical normalizer
-- (`scopePolicy.ts`); reimplementing it in SQL would guarantee the two drift.
-- The column is therefore plain TEXT with a shape CHECK, written by the one
-- module allowed to compute it.
--
-- Additive and idempotent. No column is dropped, renamed or retyped. No
-- existing row is modified.
-- ============================================================================

-- ── Marketing memory: governed class ─────────────────────────────────────────
ALTER TABLE marketing_memories
  ADD COLUMN IF NOT EXISTS memory_class TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_memories_class_governed') THEN
    ALTER TABLE marketing_memories
      ADD CONSTRAINT marketing_memories_class_governed CHECK (
        memory_class IS NULL OR memory_class IN (
          'DIRECTIVE',   -- what LaunchMind may / must / must not do. Never decays.
          'FACT',        -- a state of the world that is true or false.
          'LEARNING',    -- a causal or comparative claim from evidence. Decays.
          'DECISION'     -- a choice with a stated horizon. Expires.
        ));
  END IF;
END $$;

COMMENT ON COLUMN marketing_memories.memory_class IS
  'ADR-067 C3. Governed behavioural class. NULL marks a pre-3.2A legacy row, '
  'which is quarantined by C11 until audited. Policy branches on this and on '
  'authority_tier, never on memory_type.';

-- ── Marketing memory: persisted authority (C4) ───────────────────────────────
ALTER TABLE marketing_memories
  ADD COLUMN IF NOT EXISTS authority_tier            TEXT,
  ADD COLUMN IF NOT EXISTS authority_policy_version  INTEGER;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_memories_authority_governed') THEN
    ALTER TABLE marketing_memories
      ADD CONSTRAINT marketing_memories_authority_governed CHECK (
        authority_tier IS NULL OR authority_tier IN (
          'FOUNDER_ASSERTED',
          'FOUNDER_CONFIRMED',
          'EXPERIMENT_CONTROLLED',
          'OBSERVED_FIRST_PARTY',
          'VERIFIED_EXTERNAL',      -- RESERVED (C4): no producer exists today
          'DERIVED_INFERENCE',
          'ANONYMIZED_PLAYBOOK'
        ));
  END IF;
END $$;

COMMENT ON COLUMN marketing_memories.authority_tier IS
  'ADR-067 C4. The STRONGEST tier among supporting evidence — the memory''s '
  'standing. Recomputed when evidence changes. Historical authority is NOT read '
  'from here; it is read from the version row, which is immutable.';

-- ── Marketing memory: governed scope (C10) ───────────────────────────────────
ALTER TABLE marketing_memories
  ADD COLUMN IF NOT EXISTS scope              JSONB   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS scope_key          TEXT,
  ADD COLUMN IF NOT EXISTS scope_specificity  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scope_completeness TEXT    NOT NULL DEFAULT 'unknown';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_memories_scope_completeness_ck') THEN
    ALTER TABLE marketing_memories
      ADD CONSTRAINT marketing_memories_scope_completeness_ck
        CHECK (scope_completeness IN ('explicit', 'partial', 'unknown'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_memories_scope_key_shape_ck') THEN
    ALTER TABLE marketing_memories
      ADD CONSTRAINT marketing_memories_scope_key_shape_ck
        CHECK (scope_key IS NULL OR scope_key ~ '^[a-f0-9]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_memories_scope_specificity_ck') THEN
    ALTER TABLE marketing_memories
      ADD CONSTRAINT marketing_memories_scope_specificity_ck
        CHECK (scope_specificity >= 0 AND scope_specificity <= 6);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_memories_scope_is_object_ck') THEN
    ALTER TABLE marketing_memories
      ADD CONSTRAINT marketing_memories_scope_is_object_ck
        CHECK (jsonb_typeof(scope) = 'object');
  END IF;
END $$;

COMMENT ON COLUMN marketing_memories.scope IS
  'ADR-067 C10. Governed dimensions: product, channel, audience_segment, '
  'geography, funnel_stage, timeframe. THREE states per dimension: key ABSENT '
  '= ANY (applies regardless); explicit value = BOUND; "__UNKNOWN__" = we do '
  'not know (legacy only). Absent and unknown must never be conflated — '
  'treating an unstated dimension as "applies to everything" is how a '
  'segment-specific finding gets applied to every customer.';

-- ── The governed-completeness guard (C11) ────────────────────────────────────
-- A NEW row (memory_class NOT NULL) must carry class, authority, authority
-- policy version and a scope key, and must not be `unknown` scope. A LEGACY row
-- (memory_class NULL) is exempt and stays exactly as it is.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_memories_governed_completeness_ck') THEN
    ALTER TABLE marketing_memories
      ADD CONSTRAINT marketing_memories_governed_completeness_ck CHECK (
        memory_class IS NULL
        OR (authority_tier IS NOT NULL
            AND authority_policy_version IS NOT NULL
            AND scope_key IS NOT NULL
            AND scope_completeness <> 'unknown')
      );
  END IF;
END $$;

-- ── Scoped exceptions (C13) and domain linkage (C2) ──────────────────────────
ALTER TABLE marketing_memories
  ADD COLUMN IF NOT EXISTS exception_to UUID REFERENCES marketing_memories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS domain_ref   JSONB;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_memories_exception_not_self_ck') THEN
    ALTER TABLE marketing_memories
      ADD CONSTRAINT marketing_memories_exception_not_self_ck
        CHECK (exception_to IS NULL OR exception_to <> id);
  END IF;
END $$;

COMMENT ON COLUMN marketing_memories.exception_to IS
  'ADR-067 C13. Points at the GENERAL memory this one is a scoped exception to. '
  'Both remain active; the exception binds strictly more dimensions.';
COMMENT ON COLUMN marketing_memories.domain_ref IS
  'ADR-067 C2. {table,row_id,column?,observed_value_hash,observed_at}. The memory '
  'REFERENCES authoritative domain state; it never mirrors the current value. '
  'observed_value_hash makes drift detectable without the memory pretending to '
  'be current.';

-- ── Version rows carry the authority IN FORCE at decision time (C4, C19) ─────
ALTER TABLE marketing_memory_versions
  ADD COLUMN IF NOT EXISTS authority_tier            TEXT,
  ADD COLUMN IF NOT EXISTS authority_policy_version  INTEGER,
  ADD COLUMN IF NOT EXISTS promotion_policy_version  INTEGER,
  ADD COLUMN IF NOT EXISTS scope_policy_version      INTEGER,
  ADD COLUMN IF NOT EXISTS memory_class              TEXT,
  ADD COLUMN IF NOT EXISTS scope                     JSONB,
  ADD COLUMN IF NOT EXISTS scope_key                 TEXT;

COMMENT ON COLUMN marketing_memory_versions.authority_tier IS
  'ADR-067 C4/I4. The tier that WAS IN FORCE when this transition was decided. '
  'Immutable. Historical authority is read from here and is never re-derived by '
  'calling today''s source→tier mapping.';

-- ── Evidence: authority + lifecycle shape (C4, C21) ──────────────────────────
ALTER TABLE evidence
  ADD COLUMN IF NOT EXISTS authority_tier      TEXT,
  ADD COLUMN IF NOT EXISTS status              TEXT NOT NULL DEFAULT 'valid',
  ADD COLUMN IF NOT EXISTS invalidated_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invalidation_reason TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evidence_status_ck') THEN
    ALTER TABLE evidence
      ADD CONSTRAINT evidence_status_ck
        CHECK (status IN ('valid', 'superseded', 'invalid', 'deleted'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evidence_authority_ck') THEN
    ALTER TABLE evidence
      ADD CONSTRAINT evidence_authority_ck CHECK (
        authority_tier IS NULL OR authority_tier IN (
          'FOUNDER_ASSERTED','FOUNDER_CONFIRMED','EXPERIMENT_CONTROLLED',
          'OBSERVED_FIRST_PARTY','VERIFIED_EXTERNAL','DERIVED_INFERENCE',
          'ANONYMIZED_PLAYBOOK'));
  END IF;
END $$;

COMMENT ON COLUMN evidence.status IS
  'ADR-067 C21. Evidence lifecycle SHAPE only — the invalidation cascade is '
  'Design B. Present now so today''s schema cannot make it impossible.';

-- ── Indexes ──────────────────────────────────────────────────────────────────
-- Scope must be FILTERABLE by retrieval, which is the whole point of C10.
CREATE INDEX IF NOT EXISTS marketing_memories_scope_gin
  ON marketing_memories USING GIN (scope jsonb_path_ops);

CREATE INDEX IF NOT EXISTS marketing_memories_scope_key
  ON marketing_memories (workspace_id, scope_key)
  WHERE scope_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS marketing_memories_class_status
  ON marketing_memories (workspace_id, memory_class, status)
  WHERE memory_class IS NOT NULL;

-- Legacy quarantine (C11) has to be a cheap lookup: every promotion decision
-- asks "is this incumbent governed?" before it is allowed to be a contradiction
-- target.
CREATE INDEX IF NOT EXISTS marketing_memories_legacy_unscoped
  ON marketing_memories (workspace_id)
  WHERE memory_class IS NULL;

CREATE INDEX IF NOT EXISTS marketing_memories_exception_to
  ON marketing_memories (exception_to)
  WHERE exception_to IS NOT NULL;
