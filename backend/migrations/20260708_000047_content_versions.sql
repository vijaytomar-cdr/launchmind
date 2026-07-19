/**
 * @migration 20260708_000047_content_versions
 * @description Append-only version history for content_assets.
 *   Every edit (editor save, AI transform, regeneration) creates a version row
 *   before overwriting the live content_assets row.
 *   INSERT only — UPDATE and DELETE revoked from authenticated users.
 * @security RLS founder-scoped via changed_by. Append-only enforced at DB level.
 */

CREATE TABLE IF NOT EXISTS content_versions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id             UUID NOT NULL REFERENCES content_assets(id) ON DELETE CASCADE,
  version_number       INTEGER NOT NULL,
  text_content         TEXT,
  structured_data      JSONB,
  media_url            TEXT,
  prompt_version       INTEGER,
  growth_brain_version INTEGER,
  change_type          TEXT NOT NULL CHECK (change_type IN (
                         'editor_save', 'ai_regen', 'ai_transform', 'bulk_approve'
                       )),
  change_summary       TEXT,
  changed_by           UUID NOT NULL REFERENCES founders(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(asset_id, version_number)
);

ALTER TABLE content_versions ENABLE ROW LEVEL SECURITY;

-- Founders can read versions for assets they own (joined through content_assets)
DROP POLICY IF EXISTS "content_versions_owner_read" ON content_versions;
CREATE POLICY "content_versions_owner_read" ON content_versions
  FOR SELECT
  USING (changed_by = auth.uid());

DROP POLICY IF EXISTS "content_versions_owner_insert" ON content_versions;
CREATE POLICY "content_versions_owner_insert" ON content_versions
  FOR INSERT
  WITH CHECK (changed_by = auth.uid());

-- Prevent any authenticated user from modifying or deleting version history
REVOKE UPDATE, DELETE ON content_versions FROM authenticated;

CREATE INDEX IF NOT EXISTS content_versions_asset ON content_versions(asset_id, version_number DESC);
CREATE INDEX IF NOT EXISTS content_versions_changed_by ON content_versions(changed_by, created_at DESC);
