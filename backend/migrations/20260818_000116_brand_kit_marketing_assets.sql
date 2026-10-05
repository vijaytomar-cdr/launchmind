-- ============================================================================
-- 116 — Brand Kit + Marketing Asset governance. Phase 3.5B1, ADR-071 §6/§18.
--
-- CLOSES THE LIVE RIGHTS GAP (ADR-071 T11).
--
-- Traced before writing this: `collectMarketingImages` downloads App Store /
-- Play Store screenshots, website hero imagery AND **Google Custom Search image
-- results** into Storage, and `contentService.generateImageFromBrief` reads
-- `scraped_meta.marketingImages[0]` and uses it DIRECTLY as ad creative when
-- style='mockup'. The array is ordered screenshots → hero → web-search, so a
-- product whose store screenshots failed to download can have an arbitrary
-- web-search image become its advertisement. Nothing recorded where any of it
-- came from or whether it could lawfully be used.
--
-- THE DISTINCTION THIS MIGRATION MAKES STRUCTURAL:
--   OBSERVED_EXTERNAL    we saw it. It informs reasoning and product context.
--   AUTHORIZED_MARKETING the owner may publish it as their marketing.
--
-- Three things are deliberately UNREPRESENTABLE rather than merely discouraged:
--   * an authorized asset with no authorizing actor and no rights basis
--   * an authorized asset sourced from web search
--   * an authorized asset whose subject is a competitor or unknown third party
-- A CHECK constraint cannot be forgotten by a future code path; a convention can.
--
-- BRAND: provenance is PER FIELD, not per kit. Confirming a logo does not
-- confirm a tagline, and an inferred colour never becomes founder truth.
-- This is BRAND REPRESENTATION precedence — it is NOT evidence authority and
-- deliberately does not touch authorityPolicy or the memory tier hierarchy.
--
-- ADDITIVE ONLY. Idempotent. No existing row changes meaning.
-- @security The CHECKs are the structural half of asset rights; the resolver
--   (marketingAssetService) is the procedural half. Neither alone is sufficient.
-- @dependencies products(id, workspace_id), workspaces, founders
-- ============================================================================

BEGIN;

-- ── 1. Brand Kit — one per product ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brand_kits (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
  founder_id   UUID NOT NULL REFERENCES founders(id)   ON DELETE CASCADE,
  -- Bumped on ANY field change. An artifact records the version it was made
  -- with, so a later rebrand cannot retroactively rewrite what was created.
  version      INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, product_id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_kits_product_in_workspace') THEN
    ALTER TABLE brand_kits
      ADD CONSTRAINT brand_kits_product_in_workspace
      FOREIGN KEY (product_id, workspace_id) REFERENCES products(id, workspace_id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── 2. Brand fields — provenance per field ──────────────────────────────────
CREATE TABLE IF NOT EXISTS brand_kit_fields (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_kit_id  UUID NOT NULL REFERENCES brand_kits(id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES products(id)   ON DELETE CASCADE,

  field_key     TEXT NOT NULL,
  value         JSONB NOT NULL,

  provenance    TEXT NOT NULL
                CHECK (provenance IN ('SCRAPED', 'INFERRED', 'OWNER_CONFIRMED')),
  -- Owner-safe descriptor, e.g. 'your website' / 'your App Store listing'.
  -- Never a URL with credentials, never an internal id.
  source_label  TEXT,

  confirmed_by  UUID REFERENCES founders(id),
  confirmed_at  TIMESTAMPTZ,

  kit_version   INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (brand_kit_id, field_key)
);

-- OWNER_CONFIRMED without an actor is a claim about a person that nobody made.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_field_confirmed_has_actor') THEN
    ALTER TABLE brand_kit_fields
      ADD CONSTRAINT brand_field_confirmed_has_actor
      CHECK (provenance <> 'OWNER_CONFIRMED'
             OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS brand_kit_fields_scope
  ON brand_kit_fields(workspace_id, product_id, field_key);

-- ── 3. Field history — append-only ──────────────────────────────────────────
-- A rebrand must not erase what a past artifact was made with.
CREATE TABLE IF NOT EXISTS brand_kit_field_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_kit_id  UUID NOT NULL REFERENCES brand_kits(id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
  field_key     TEXT NOT NULL,
  prior_value   JSONB,
  prior_provenance TEXT,
  new_value     JSONB NOT NULL,
  new_provenance   TEXT NOT NULL,
  kit_version   INTEGER NOT NULL,
  changed_by    UUID REFERENCES founders(id),
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
REVOKE UPDATE, DELETE ON brand_kit_field_history FROM authenticated, anon;
CREATE INDEX IF NOT EXISTS brand_kit_field_history_scope
  ON brand_kit_field_history(workspace_id, product_id, changed_at DESC);

-- ── 4. Marketing assets ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_assets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
  founder_id   UUID NOT NULL REFERENCES founders(id)   ON DELETE CASCADE,

  asset_type   TEXT NOT NULL
               CHECK (asset_type IN ('LOGO','APP_ICON','SCREENSHOT','HERO_IMAGE',
                                     'PRODUCT_IMAGE','VIDEO','OTHER')),
  -- WHERE it came from. Not a rights statement.
  source       TEXT NOT NULL
               CHECK (source IN ('APP_STORE','PLAY_STORE','WEBSITE','WEB_SEARCH',
                                 'OWNER_UPLOAD','OWNER_URL','GENERATED')),
  -- WHOSE it depicts. A competitor screenshot is intelligence, never creative.
  subject_relation TEXT NOT NULL DEFAULT 'UNKNOWN'
               CHECK (subject_relation IN ('OWN_PRODUCT','COMPETITOR','THIRD_PARTY','UNKNOWN')),

  storage_path TEXT,
  external_url TEXT,

  authorization_state TEXT NOT NULL DEFAULT 'OBSERVED_EXTERNAL'
               CHECK (authorization_state IN ('OBSERVED_EXTERNAL','AUTHORIZED_MARKETING')),
  authorized_by UUID REFERENCES founders(id),
  authorized_at TIMESTAMPTZ,
  -- Why the owner may publish it. Free text the owner asserted; never inferred.
  rights_basis  TEXT,

  -- Conservative default: an image whose contents nobody examined may contain a
  -- face, a customer name or account data. Unknown is not the same as absent.
  may_contain_pii BOOLEAN NOT NULL DEFAULT true,

  observed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_assets_product_in_workspace') THEN
    ALTER TABLE marketing_assets
      ADD CONSTRAINT marketing_assets_product_in_workspace
      FOREIGN KEY (product_id, workspace_id) REFERENCES products(id, workspace_id) ON DELETE CASCADE;
  END IF;

  -- (a) authorization needs an actor AND a stated basis
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_asset_authorized_has_actor') THEN
    ALTER TABLE marketing_assets
      ADD CONSTRAINT marketing_asset_authorized_has_actor
      CHECK (authorization_state <> 'AUTHORIZED_MARKETING'
             OR (authorized_by IS NOT NULL AND authorized_at IS NOT NULL
                 AND rights_basis IS NOT NULL AND length(btrim(rights_basis)) > 0));
  END IF;

  -- (b) a web-search result can never be authorized. There is no rights basis
  --     an owner could truthfully assert for an image found by search.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_asset_web_search_never_authorized') THEN
    ALTER TABLE marketing_assets
      ADD CONSTRAINT marketing_asset_web_search_never_authorized
      CHECK (NOT (source = 'WEB_SEARCH' AND authorization_state = 'AUTHORIZED_MARKETING'));
  END IF;

  -- (c) only the owner's OWN product may be authorized creative
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_asset_subject_must_be_own') THEN
    ALTER TABLE marketing_assets
      ADD CONSTRAINT marketing_asset_subject_must_be_own
      CHECK (authorization_state <> 'AUTHORIZED_MARKETING' OR subject_relation = 'OWN_PRODUCT');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS marketing_assets_scope
  ON marketing_assets(workspace_id, product_id, authorization_state)
  WHERE archived_at IS NULL;

COMMENT ON COLUMN marketing_assets.authorization_state IS
  'OBSERVED_EXTERNAL: we saw it; usable for reasoning and product context only. '
  'AUTHORIZED_MARKETING: the owner asserted a rights basis and it may appear in '
  'generated marketing. Downloading, storing or knowing a path grants neither.';
COMMENT ON COLUMN marketing_assets.may_contain_pii IS
  'Defaults TRUE. Unknown is not absent — an unexamined image may contain a '
  'face, a customer name or account data.';

-- ── 5. Artifacts record the brand version they were built with ──────────────
ALTER TABLE content_assets
  ADD COLUMN IF NOT EXISTS brand_kit_version INTEGER;

-- ── 6. RLS — server-derived, member-readable ────────────────────────────────
ALTER TABLE brand_kits            ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_kit_fields      ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_kit_field_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_assets      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brand_kits_member_read ON brand_kits;
CREATE POLICY brand_kits_member_read ON brand_kits
  FOR SELECT USING (lm_is_workspace_member(workspace_id));
DROP POLICY IF EXISTS brand_kit_fields_member_read ON brand_kit_fields;
CREATE POLICY brand_kit_fields_member_read ON brand_kit_fields
  FOR SELECT USING (lm_is_workspace_member(workspace_id));
DROP POLICY IF EXISTS brand_kit_field_history_member_read ON brand_kit_field_history;
CREATE POLICY brand_kit_field_history_member_read ON brand_kit_field_history
  FOR SELECT USING (lm_is_workspace_member(workspace_id));
DROP POLICY IF EXISTS marketing_assets_member_read ON marketing_assets;
CREATE POLICY marketing_assets_member_read ON marketing_assets
  FOR SELECT USING (lm_is_workspace_member(workspace_id));

REVOKE INSERT, UPDATE, DELETE ON brand_kits, brand_kit_fields,
  brand_kit_field_history, marketing_assets FROM authenticated, anon;
GRANT SELECT ON brand_kits, brand_kit_fields, brand_kit_field_history,
  marketing_assets TO authenticated;

COMMIT;
