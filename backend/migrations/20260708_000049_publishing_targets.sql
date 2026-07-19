/**
 * @migration 20260708_000049_publishing_targets
 * @description Records where and when content assets are published to live channels.
 *   Each row represents one publish event — the same asset can be published multiple
 *   times (e.g. republished after editing). Status tracks whether the post is
 *   still live on the platform.
 * @security RLS founder-scoped.
 */

CREATE TABLE IF NOT EXISTS publishing_targets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id        UUID NOT NULL REFERENCES content_assets(id) ON DELETE CASCADE,
  founder_id      UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL CHECK (channel IN (
                    'meta', 'google', 'whatsapp', 'email', 'linkedin',
                    'web', 'app_store', 'play_store'
                  )),
  platform_url    TEXT,
  external_id     TEXT,
  published_by    UUID NOT NULL REFERENCES founders(id),
  published_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  status          TEXT NOT NULL DEFAULT 'live'
                  CHECK (status IN ('scheduled', 'live', 'removed', 'error')),
  error_message   TEXT,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE publishing_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "publishing_targets_owner" ON publishing_targets;
CREATE POLICY "publishing_targets_owner" ON publishing_targets
  USING (founder_id = auth.uid());

CREATE INDEX IF NOT EXISTS publishing_targets_asset ON publishing_targets(asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS publishing_targets_founder_channel ON publishing_targets(founder_id, channel, status);
