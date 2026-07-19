/**
 * @migration 20260708_000050_content_assets_extend
 * @description Additive extension of content_assets for Milestone 08 — Content Studio.
 *   Adds: tags, mission_id, growth_brain_version, archived_at, published_at
 *   Extends asset_type CHECK to include 5 new types:
 *     blog_post, landing_page_copy, push_notification, release_notes, press_release
 *   Idempotent — ADD COLUMN IF NOT EXISTS, constraint replaced only if needed.
 * @security No RLS changes — existing "assets_owner" policy covers new columns.
 */

-- New columns (additive only)
ALTER TABLE content_assets
  ADD COLUMN IF NOT EXISTS tags                TEXT[],
  ADD COLUMN IF NOT EXISTS mission_id          UUID REFERENCES missions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS growth_brain_version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS archived_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_at        TIMESTAMPTZ;

-- Extend asset_type CHECK to include 5 new types.
-- Drop old constraint, add new one with the expanded list.
-- This is safe — existing rows all satisfy the new (superset) constraint.
ALTER TABLE content_assets
  DROP CONSTRAINT IF EXISTS content_assets_asset_type_check;

ALTER TABLE content_assets
  ADD CONSTRAINT content_assets_asset_type_check CHECK (asset_type IN (
    -- original 26 types
    'whatsapp_broadcast', 'whatsapp_voice_note',
    'meta_headline', 'meta_body', 'meta_image_brief',
    'google_uac_variants', 'aso_subtitle', 'aso_description', 'aso_keywords',
    'email_day1', 'email_day5', 'email_day14',
    'linkedin_founder_story', 'linkedin_data_post',
    'video_reels_30s', 'video_shorts_60s', 'video_app_preview',
    'carousel_brief', 'community_whatsapp_group', 'community_facebook',
    'community_indiehackers', 'community_twitter_thread',
    'social_proof_case_study', 'social_proof_testimonial',
    'social_proof_review_response', 'social_proof_producthunt',
    -- new M08 types
    'blog_post', 'landing_page_copy', 'push_notification', 'release_notes', 'press_release'
  ));

-- Indexes for new columns
CREATE INDEX IF NOT EXISTS content_assets_mission ON content_assets(mission_id)
  WHERE mission_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS content_assets_archived ON content_assets(founder_id, archived_at)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS content_assets_tags ON content_assets USING GIN(tags)
  WHERE tags IS NOT NULL;
