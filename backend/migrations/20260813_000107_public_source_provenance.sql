-- 107_public_source_provenance
--
-- Makes externally-sourced public evidence REPRESENTABLE in Marketing Memory.
--
-- WHY: `marketing_memories.source` was a closed set with no external value, so a
-- Canva-class public fact had to borrow `growth_brain`. BeliefPolicy reads
-- `source` for precedence, so borrowing distorted the very semantics the
-- provenance was meant to record.
--
-- ADDITIVE ONLY (CLAUDE.md §1.2): the CHECK is widened, never narrowed. No
-- existing value is renamed, retyped or removed, so every existing row remains
-- valid and no backfill is required. Idempotent.
--
--   public_official   an official primary source (company newsroom, product page,
--                     help centre, filing, or a press release issued by them)
--   public_reputable  established secondary reporting or an encyclopedic reference
--
-- NEITHER grants founder authority. Authority is decided by the authenticated
-- actor in authorityPolicy.authorityForCandidate(); a `system` actor can never
-- reach a FOUNDER_* tier regardless of how good its source is.

DO $$
DECLARE
  con_name TEXT;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'marketing_memories'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%source%'
    AND pg_get_constraintdef(oid) ILIKE '%intake%'
  LIMIT 1;

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE marketing_memories DROP CONSTRAINT %I', con_name);
  END IF;

  ALTER TABLE marketing_memories
    ADD CONSTRAINT marketing_memories_source_check
    CHECK (source IN (
      'intake','growth_brain','campaign_performance','review',
      'analytics','founder_feedback','ai_conversation','experiment',
      -- added by 107
      'public_official','public_reputable','founder_bootstrap'
    ));
END $$;

COMMENT ON COLUMN marketing_memories.source IS
  'Provenance of the claim. public_official / public_reputable denote external '
  'public sources and never imply founder authority. founder_bootstrap denotes '
  'governed onboarding admission (migration 108).';
