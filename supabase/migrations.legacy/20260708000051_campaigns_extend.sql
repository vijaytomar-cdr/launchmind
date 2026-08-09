/**
 * @migration 20260708_000051_campaigns_extend
 * @description Additive extension of campaigns table for Milestone 09.
 *   Adds: type, mission_id, growth_brain_version, scheduled_at, cancelled_at,
 *   archived_at, failed_at, failure_reason.
 *   Extends status CHECK (adds scheduled/publishing/failed/cancelled/archived).
 *   Extends channel CHECK (adds app_store/play_store/push/twitter/tiktok/blog/product_hunt).
 *   Idempotent — ADD COLUMN IF NOT EXISTS, constraints replaced only when safe.
 * @security No RLS changes — existing "campaigns_owner" policy covers new columns.
 */

-- New columns (additive only)
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS type              TEXT,
  ADD COLUMN IF NOT EXISTS mission_id        UUID REFERENCES missions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS growth_brain_version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS scheduled_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failure_reason    TEXT;

-- Add CHECK constraint for campaign type
ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_type_check CHECK (type IS NULL OR type IN (
    'app_install', 'aso_improvement', 'review_generation', 'email',
    'push_notification', 'social', 'paid_ad', 'product_hunt',
    'india_launch', 'holiday', 'retention', 'win_back'
  ));

-- Extend status CHECK to include new M09 status values
ALTER TABLE campaigns
  DROP CONSTRAINT IF EXISTS campaigns_status_check;

ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_status_check CHECK (status IN (
    -- original values
    'draft', 'pending_approval', 'approved', 'launched', 'paused', 'completed',
    -- new M09 values
    'scheduled', 'publishing', 'failed', 'cancelled', 'archived'
  ));

-- Extend channel CHECK for new publishing channels
ALTER TABLE campaigns
  DROP CONSTRAINT IF EXISTS campaigns_channel_check;

ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_channel_check CHECK (channel IN (
    -- original values
    'meta', 'google', 'whatsapp', 'linkedin', 'email',
    -- new M09 channels
    'app_store', 'play_store', 'push', 'twitter', 'tiktok', 'blog', 'product_hunt',
    -- existing from prior migration
    'aso_rewrite'
  ));

-- Indexes for new columns
CREATE INDEX IF NOT EXISTS campaigns_mission ON campaigns(mission_id)
  WHERE mission_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS campaigns_scheduled ON campaigns(founder_id, scheduled_at)
  WHERE scheduled_at IS NOT NULL AND status = 'scheduled';

CREATE INDEX IF NOT EXISTS campaigns_type ON campaigns(founder_id, type)
  WHERE type IS NOT NULL;
