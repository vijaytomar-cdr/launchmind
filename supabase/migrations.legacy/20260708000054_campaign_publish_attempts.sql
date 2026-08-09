/**
 * @migration 20260708_000054_campaign_publish_attempts
 * @description Tracks each publish attempt per campaign + channel.
 *   Supports retry tracking, failure recovery, dead-letter queue, and audit.
 *   Error messages are sanitized — no provider tokens or internal stack traces stored.
 * @security RLS founder-scoped.
 */

CREATE TABLE IF NOT EXISTS campaign_publish_attempts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  founder_id       UUID NOT NULL REFERENCES founders(id),
  asset_id         UUID REFERENCES content_assets(id) ON DELETE SET NULL,
  channel          TEXT NOT NULL,
  attempt_number   INTEGER NOT NULL DEFAULT 1,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'success', 'failed', 'retrying', 'skipped')),
  external_id      TEXT,
  error_message    TEXT,
  error_code       TEXT,
  platform_response JSONB,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ,
  next_retry_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE campaign_publish_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "publish_attempts_owner" ON campaign_publish_attempts;
CREATE POLICY "publish_attempts_owner" ON campaign_publish_attempts USING (founder_id = auth.uid());

CREATE INDEX IF NOT EXISTS publish_attempts_campaign ON campaign_publish_attempts(campaign_id, channel, created_at DESC);
CREATE INDEX IF NOT EXISTS publish_attempts_status ON campaign_publish_attempts(status, next_retry_at)
  WHERE status IN ('pending', 'retrying');
