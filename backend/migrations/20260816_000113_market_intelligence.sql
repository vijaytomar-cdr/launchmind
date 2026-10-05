-- ============================================================================
-- 113 — Market Intelligence: global source records + product resolutions
--       Phase 3.4B, implementing the ADR-069 frozen contract. SHADOW ONLY.
--
-- TWO TABLES, AND THE SPLIT IS THE POINT.
--
--   market_intelligence_source_records   GLOBAL. One external fact, stored once.
--   market_intelligence_resolutions      PRODUCT-SCOPED. Whether that fact
--                                        applies HERE, and why.
--
-- The global table has NO workspace_id and NO founder_id columns AT ALL. That
-- is the enforcement of the ADR-069 global-source invariant: a column that does
-- not exist cannot hold workspace reasoning, founder direction, owner
-- annotations, applicability decisions, decision state, memory or recommendation
-- state. Reviewing the invariant is reading the column list.
--
-- WHY authority_tier IS CHECK-CONSTRAINED HERE.
--   The single most dangerous failure available to this subsystem is external
--   text acquiring founder authority. Application code already refuses it
--   (authorityForCandidate returns from the founder branch only for an
--   authenticated founder actor). This CHECK makes it unrepresentable: no row in
--   this table can carry FOUNDER_ASSERTED, FOUNDER_CONFIRMED,
--   OBSERVED_FIRST_PARTY or EXPERIMENT_CONTROLLED, whatever a page says about
--   itself and whatever a future code path forgets.
--
-- WHY THERE IS NO `freshness_state` COLUMN.
--   ADR-069 named one. Storing it would repeat a defect this codebase already
--   measured and fixed once (Improve Intelligence Step 7): a freshness value
--   written at ingestion still reads "fresh" a year later. What is stored here
--   is `freshness_state_at_ingestion`, named so it cannot be mistaken for the
--   current answer, and current freshness is DERIVED at resolution time from
--   freshness_reference_date. The contract is satisfied; the field is renamed to
--   tell the truth.
--
-- ADDITIVE. Two new tables, no change to any existing table. Idempotent.
-- @security Both tables are server-only for writes. The global table is not
--   client-readable at all; the resolution table is readable by workspace
--   members through lm_is_workspace_member (migration 080).
-- @dependencies workspaces, products, context_packages, lm_is_workspace_member
-- ============================================================================

-- LEGAL ERASURE IS THE ONE EXCEPTION to observation immutability, and it is
-- narrow: the trigger below permits claim_text/excerpt to change ONLY on a
-- transition to lifecycle_state = 'ERASED'. The reference, provenance, dates and
-- audit trail survive, so a historical recommendation remains explicable even
-- after the source content is gone.

BEGIN;

-- ── 1. GLOBAL SOURCE RECORDS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_intelligence_source_records (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── WHERE IT CAME FROM ────────────────────────────────────────────────────
  -- source_type is the ADR-069 frozen source class. 3.4B admits exactly one.
  source_type       TEXT NOT NULL
                    CHECK (source_type IN ('STORE_LISTING')),
  source_provider   TEXT NOT NULL
                    CHECK (source_provider IN ('app_store', 'play_store')),
  -- Resolvable reference. Never a full page.
  source_ref        TEXT NOT NULL,

  -- ── WHAT IT IS ABOUT ──────────────────────────────────────────────────────
  -- Entity-neutral by design. Whether an entity is "the owner's product" or "a
  -- competitor" is a PER-PRODUCT fact and lives on the resolution row, because
  -- one listing is the owner's product in one workspace and a competitor in
  -- another. Encoding it here would make a global record workspace-relative.
  subject_type      TEXT NOT NULL
                    CHECK (subject_type IN
                      ('STORE_APP_ENTITY', 'CATEGORY', 'CHANNEL', 'GEOGRAPHY')),
  -- Stable provider identifier, never a display name.
  -- e.g. 'app_store:us:id6448311069' | 'play_store:us:com.example.app'
  subject_key       TEXT NOT NULL,
  -- Human label for audit only. NEVER used for identity or matching.
  subject_label     TEXT,
  -- Conservative cross-store link. NULL unless a deterministic basis existed.
  entity_group_key  TEXT,
  entity_link_basis TEXT,

  category_key      TEXT,
  geography         TEXT,

  -- ── THE OBSERVATION ───────────────────────────────────────────────────────
  observation_type  TEXT NOT NULL
                    CHECK (observation_type IN (
                      'LISTING_POSITIONING', 'LISTING_RATING',
                      'LISTING_RATING_COUNT', 'LISTING_PRICE_TIER',
                      'LISTING_CATEGORY', 'LISTING_UPDATE_RECENCY')),
  claim_text        TEXT NOT NULL CHECK (char_length(claim_text) <= 500),
  -- Both or neither. A number without a unit is not a measurement.
  structured_value  NUMERIC,
  unit              TEXT,
  CONSTRAINT mi_value_unit_together
    CHECK ((structured_value IS NULL) = (unit IS NULL)),
  -- Minimal attributed excerpt, only where the wording IS the fact.
  excerpt           TEXT CHECK (excerpt IS NULL OR char_length(excerpt) <= 400),

  -- ── TIME ──────────────────────────────────────────────────────────────────
  observed_at       TIMESTAMPTZ,   -- when the fact was true of the world
  published_at      TIMESTAMPTZ,   -- when the source stated it
  retrieved_at      TIMESTAMPTZ NOT NULL,  -- when WE fetched it. Provenance only.
  period_start      TIMESTAMPTZ,
  period_end        TIMESTAMPTZ,

  -- observed_at ?? published_at ?? NULL. GENERATED so it cannot drift from its
  -- inputs and so `retrieved_at` can never be substituted by a code path.
  freshness_reference_date TIMESTAMPTZ
                    GENERATED ALWAYS AS (COALESCE(observed_at, published_at)) STORED,
  -- Snapshot ONLY. Current freshness is derived at resolution. See header.
  freshness_state_at_ingestion TEXT NOT NULL
                    CHECK (freshness_state_at_ingestion IN
                      ('CURRENT', 'AGING', 'STALE', 'UNKNOWN_DATE')),

  -- ── TRUST ─────────────────────────────────────────────────────────────────
  -- Founder and first-party tiers are UNREPRESENTABLE here. See header.
  authority_tier    TEXT NOT NULL
                    CHECK (authority_tier IN
                      ('VERIFIED_EXTERNAL', 'DERIVED_INFERENCE', 'ANONYMIZED_PLAYBOOK')),
  authority_policy_version INTEGER NOT NULL,
  -- { provider, fetch_method, publisher_of_record, retrieved_at, ingestion_version }
  provenance        JSONB NOT NULL,
  CONSTRAINT mi_provenance_present
    CHECK (jsonb_typeof(provenance) = 'object' AND provenance ? 'publisher_of_record'),

  -- Two rows sharing this are the SAME statement, not two confirmations.
  -- Derived from publisher-of-record + statement identity, NOT from the URL.
  independence_key  TEXT NOT NULL,

  -- ── LIFECYCLE ─────────────────────────────────────────────────────────────
  lifecycle_state   TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK (lifecycle_state IN
                      ('ACTIVE','SUPERSEDED','CORRECTED','RETRACTED','UNAVAILABLE','ERASED')),
  lifecycle_reason  TEXT,
  superseded_by     UUID REFERENCES market_intelligence_source_records(id) ON DELETE SET NULL,

  content_hash      TEXT NOT NULL,
  ingestion_mode    TEXT NOT NULL DEFAULT 'SHADOW'
                    CHECK (ingestion_mode IN ('SHADOW','ACTIVE')),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Global dedup. Re-ingesting an unchanged listing resolves to the SAME row
-- rather than manufacturing a second "independent" observation.
CREATE UNIQUE INDEX IF NOT EXISTS mi_source_records_content_hash
  ON market_intelligence_source_records(content_hash);

CREATE INDEX IF NOT EXISTS mi_source_records_subject
  ON market_intelligence_source_records(subject_key, observation_type, lifecycle_state);

CREATE INDEX IF NOT EXISTS mi_source_records_independence
  ON market_intelligence_source_records(independence_key);

-- ── 2. Observation immutability ─────────────────────────────────────────────
-- A correction is a NEW record that supersedes the old one. Editing an
-- observation in place would silently rewrite what LaunchMind once observed,
-- which is the same failure the recommendation snapshot trigger prevents.
-- Only lifecycle columns may move.
CREATE OR REPLACE FUNCTION lm_mi_source_record_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Legal erasure: content may be removed, and ONLY removed, and ONLY as part of
  -- the transition to ERASED. Everything identifying and evidential still holds.
  IF NEW.lifecycle_state = 'ERASED' AND OLD.lifecycle_state IS DISTINCT FROM 'ERASED' THEN
    IF NEW.claim_text <> '[erased]' OR NEW.excerpt IS NOT NULL THEN
      RAISE EXCEPTION
        'market_intelligence_source_records: erasure must blank claim_text and excerpt, not rewrite them'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.source_type       IS DISTINCT FROM OLD.source_type
  OR NEW.source_provider   IS DISTINCT FROM OLD.source_provider
  OR NEW.source_ref        IS DISTINCT FROM OLD.source_ref
  OR NEW.subject_type      IS DISTINCT FROM OLD.subject_type
  OR NEW.subject_key       IS DISTINCT FROM OLD.subject_key
  OR NEW.observation_type  IS DISTINCT FROM OLD.observation_type
  OR NEW.claim_text        IS DISTINCT FROM OLD.claim_text
  OR NEW.structured_value  IS DISTINCT FROM OLD.structured_value
  OR NEW.unit              IS DISTINCT FROM OLD.unit
  OR NEW.excerpt           IS DISTINCT FROM OLD.excerpt
  OR NEW.observed_at       IS DISTINCT FROM OLD.observed_at
  OR NEW.published_at      IS DISTINCT FROM OLD.published_at
  OR NEW.retrieved_at      IS DISTINCT FROM OLD.retrieved_at
  OR NEW.authority_tier    IS DISTINCT FROM OLD.authority_tier
  OR NEW.authority_policy_version IS DISTINCT FROM OLD.authority_policy_version
  OR NEW.provenance        IS DISTINCT FROM OLD.provenance
  OR NEW.independence_key  IS DISTINCT FROM OLD.independence_key
  OR NEW.content_hash      IS DISTINCT FROM OLD.content_hash
  OR NEW.created_at        IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION
      'market_intelligence_source_records: the observation is immutable; a correction is a new record that supersedes this one'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mi_source_record_immutable ON market_intelligence_source_records;
CREATE TRIGGER mi_source_record_immutable
  BEFORE UPDATE ON market_intelligence_source_records
  FOR EACH ROW EXECUTE FUNCTION lm_mi_source_record_immutable();

REVOKE ALL ON FUNCTION lm_mi_source_record_immutable() FROM PUBLIC;

-- RLS with NO permissive policy: server-only, in both directions. Owners reach
-- market evidence through a resolution, never through the global table.
ALTER TABLE market_intelligence_source_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON market_intelligence_source_records FROM authenticated, anon;

COMMENT ON TABLE market_intelligence_source_records IS
  'ADR-069. GLOBAL external source facts. Carries no workspace_id or founder_id '
  'by design: applicability, owner reasoning and decision state live only on '
  'market_intelligence_resolutions.';

-- ── 3. PRODUCT / REQUEST RESOLUTIONS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_intelligence_resolutions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  source_record_id  UUID NOT NULL
                    REFERENCES market_intelligence_source_records(id) ON DELETE CASCADE,

  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id        UUID          REFERENCES products(id)   ON DELETE CASCADE,
  context_package_id UUID,

  -- What this entity IS to THIS product. Workspace-relative, so it cannot live
  -- on the global record.
  subject_relation  TEXT NOT NULL DEFAULT 'UNRELATED'
                    CHECK (subject_relation IN
                      ('OWN_PRODUCT','CONFIRMED_COMPETITOR','CATEGORY_CONTEXT','UNRELATED')),

  applicability     TEXT NOT NULL
                    CHECK (applicability IN
                      ('APPLICABLE','NOT_APPLICABLE','INSUFFICIENT_CONTEXT')),
  -- Never null. A verdict without a reason is not auditable.
  reason            TEXT NOT NULL,
  -- Which dimensions were compared, matched, or unknown.
  dimensions        JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- DERIVED at resolution time, not copied from the source row.
  freshness_at_resolution TEXT NOT NULL
                    CHECK (freshness_at_resolution IN
                      ('CURRENT','AGING','STALE','UNKNOWN_DATE')),

  evidence_handle_eligible BOOLEAN NOT NULL DEFAULT false,
  -- Present when eligibility was refused despite APPLICABLE (e.g. STALE).
  ineligible_reason TEXT,

  mode              TEXT NOT NULL DEFAULT 'SHADOW'
                    CHECK (mode IN ('OFF','SHADOW','ACTIVE')),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A product cannot exist outside its workspace on this row either.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mi_resolutions_product_in_workspace'
  ) THEN
    ALTER TABLE market_intelligence_resolutions
      ADD CONSTRAINT mi_resolutions_product_in_workspace
      FOREIGN KEY (product_id, workspace_id)
      REFERENCES products(id, workspace_id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- Eligibility requires BOTH applicability and a usable date, at the table level.
ALTER TABLE market_intelligence_resolutions
  DROP CONSTRAINT IF EXISTS mi_resolutions_eligibility_requires_applicable;
ALTER TABLE market_intelligence_resolutions
  ADD CONSTRAINT mi_resolutions_eligibility_requires_applicable
  CHECK (
    evidence_handle_eligible = false
    OR (applicability = 'APPLICABLE'
        AND freshness_at_resolution IN ('CURRENT','AGING'))
  );

CREATE INDEX IF NOT EXISTS mi_resolutions_scope
  ON market_intelligence_resolutions(workspace_id, product_id, applicability);

CREATE INDEX IF NOT EXISTS mi_resolutions_source
  ON market_intelligence_resolutions(source_record_id);

ALTER TABLE market_intelligence_resolutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mi_resolutions_member_read ON market_intelligence_resolutions;
CREATE POLICY mi_resolutions_member_read
  ON market_intelligence_resolutions FOR SELECT
  USING (lm_is_workspace_member(workspace_id));

-- Resolutions are derived by the server. A client has no reason to write one.
REVOKE INSERT, UPDATE, DELETE ON market_intelligence_resolutions FROM authenticated, anon;
GRANT SELECT ON market_intelligence_resolutions TO authenticated;

COMMENT ON TABLE market_intelligence_resolutions IS
  'ADR-069. Per-product applicability of a GLOBAL source record. Global storage '
  'never implies global applicability; this table is where that separation lives.';

COMMIT;
