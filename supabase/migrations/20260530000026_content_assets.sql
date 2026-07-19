/**
 * @migration 20260530_000026_content_assets
 * @description Stores all generated content assets per product per week.
 *   Each asset is a separate row — enables per-asset approval, regeneration,
 *   performance tracking, and learning loop.
 */

CREATE TABLE IF NOT EXISTS content_assets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  founder_id      UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  brief_id        UUID REFERENCES weekly_briefs(id) ON DELETE SET NULL,
  campaign_id     UUID REFERENCES campaigns(id) ON DELETE SET NULL,

  asset_type      TEXT NOT NULL CHECK (asset_type IN (
    'whatsapp_broadcast', 'whatsapp_voice_note',
    'meta_headline', 'meta_body', 'meta_image_brief',
    'google_uac_variants', 'aso_subtitle', 'aso_description', 'aso_keywords',
    'email_day1', 'email_day5', 'email_day14',
    'linkedin_founder_story', 'linkedin_data_post',
    'video_reels_30s', 'video_shorts_60s', 'video_app_preview',
    'carousel_brief', 'community_whatsapp_group', 'community_facebook',
    'community_indiehackers', 'community_twitter_thread',
    'social_proof_case_study', 'social_proof_testimonial',
    'social_proof_review_response', 'social_proof_producthunt'
  )),
  channel         TEXT NOT NULL,
  market          TEXT CHECK (market IN ('usa','india','both')),
  language        TEXT DEFAULT 'english',

  text_content    TEXT,
  structured_data JSONB,
  media_url       TEXT,
  media_type      TEXT CHECK (media_type IN ('mp4','mp3','jpg','png') OR media_type IS NULL),
  duration_seconds INTEGER,
  thumbnail_url   TEXT,

  model_used      TEXT,
  quality_score   NUMERIC(3,2),
  quality_flags   JSONB,
  generation_week INTEGER,
  hook_angle      TEXT,
  tokens_consumed INTEGER DEFAULT 0,

  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected','auto_approved','held')),
  approved_at     TIMESTAMPTZ,
  auto_approved   BOOLEAN DEFAULT false,

  regen_count     INTEGER DEFAULT 0,
  regen_reasons   JSONB,
  parent_asset_id UUID REFERENCES content_assets(id),

  installs        INTEGER,
  impressions     INTEGER,
  cpi             NUMERIC(10,4),
  ctr             NUMERIC(6,4),
  performed_at    TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE content_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "assets_owner" ON content_assets;
CREATE POLICY "assets_owner" ON content_assets
  USING (founder_id = auth.uid());

CREATE INDEX IF NOT EXISTS content_assets_product_week ON content_assets(product_id, generation_week);
CREATE INDEX IF NOT EXISTS content_assets_type_status ON content_assets(asset_type, status);
CREATE INDEX IF NOT EXISTS content_assets_brief ON content_assets(brief_id);
