-- ============================================================================
-- Migration 121 — Short-form video creative production (Phase 3.5B6B)
--
-- EXTENDS the B6A creative tables rather than adding a parallel video pipeline.
-- One render-job table answers "what did LaunchMind ask a provider to make, for
-- which copy, and what came back" for images, audio and video alike. A second
-- table would let the two drift, and video is where drift is dangerous: a video
-- carries a spoken claim, a face and a voice at once.
--
-- WHAT THIS SCHEMA REFUSES TO REPRESENT:
--
--   1. A SYNTHETIC PRESENTER IS NEVER A PERSON WITH A ROLE. avatar_selection
--      stores a provider id and an owner-safe label. There is no column for
--      "customer", "employee", "founder" or "expert", so an avatar cannot be
--      recorded as one, and nothing downstream can read it as endorsement.
--
--   2. A VOICE IS NEVER CLONED WITHOUT CONSENT. voice_selection carries a
--      CHECK restricting it to PROVIDER_STOCK. The repository has no consent or
--      rights model for a real person's voice — products.voice_clone_id exists
--      with no actor, no basis and no record of permission — so OWNER_AUTHORIZED
--      is deliberately absent until such a contract exists.
--
--   3. RENDERING IS STILL NOT EXECUTION. The status CHECK is unchanged and
--      still rejects PUBLISHED / LAUNCHED / EXECUTED / SPEND_APPROVED.
--
-- Additive and idempotent. No column dropped, renamed or retyped.
-- ============================================================================

DO $$
BEGIN
  -- ── capability: audio and video capabilities join the image ones ─────────
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creative_render_jobs_capability_check') THEN
    ALTER TABLE creative_render_jobs DROP CONSTRAINT creative_render_jobs_capability_check;
  END IF;
  ALTER TABLE creative_render_jobs
    ADD CONSTRAINT creative_render_jobs_capability_check
    CHECK (capability IN ('IMAGE_GENERATION','IMAGE_EDITING',
                          'IMAGE_TO_VIDEO','TEXT_TO_VIDEO',
                          'AVATAR_VIDEO','LIPSYNC','VOICE'));

  -- ── creative_kind: one video kind, plus the audio track it may need ──────
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creative_render_jobs_creative_kind_check') THEN
    ALTER TABLE creative_render_jobs DROP CONSTRAINT creative_render_jobs_creative_kind_check;
  END IF;
  ALTER TABLE creative_render_jobs
    ADD CONSTRAINT creative_render_jobs_creative_kind_check
    CHECK (creative_kind IN ('META_AD_VISUAL','SOCIAL_POST_VISUAL',
                             'LANDING_PAGE_HERO','PRODUCT_VISUAL',
                             'SHORT_FORM_VIDEO','VOICEOVER_AUDIO'));

  -- ── provider: HeyGen and ElevenLabs join Replicate ──────────────────────
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creative_render_jobs_provider_check') THEN
    ALTER TABLE creative_render_jobs DROP CONSTRAINT creative_render_jobs_provider_check;
  END IF;
  ALTER TABLE creative_render_jobs
    ADD CONSTRAINT creative_render_jobs_provider_check
    CHECK (provider IN ('REPLICATE','HEYGEN','ELEVENLABS'));
END $$;

-- ── video-specific columns on the shared job table ─────────────────────────
ALTER TABLE creative_render_jobs ADD COLUMN IF NOT EXISTS video_mode TEXT;
-- Owner selections, recorded AT RENDER TIME. A later change of presenter or
-- voice produces a new render; it never rewrites what an old one used.
ALTER TABLE creative_render_jobs ADD COLUMN IF NOT EXISTS avatar_selection JSONB;
ALTER TABLE creative_render_jobs ADD COLUMN IF NOT EXISTS voice_selection JSONB;
-- Links a final video back to the audio track rendered for it.
ALTER TABLE creative_render_jobs ADD COLUMN IF NOT EXISTS parent_render_job_id UUID
  REFERENCES creative_render_jobs(id) ON DELETE SET NULL;
ALTER TABLE creative_render_jobs ADD COLUMN IF NOT EXISTS duration_ms INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creative_job_video_mode_check') THEN
    ALTER TABLE creative_render_jobs
      ADD CONSTRAINT creative_job_video_mode_check
      CHECK (video_mode IS NULL OR video_mode IN
             ('PRODUCT_MOTION','AVATAR_SPOKESPERSON','VOICEOVER_CREATIVE'));
  END IF;

  -- A video render must say which mode produced it. Without this an avatar
  -- video and a product-motion video are indistinguishable after the fact,
  -- and only one of them involved a synthetic presenter.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creative_job_video_has_mode') THEN
    ALTER TABLE creative_render_jobs
      ADD CONSTRAINT creative_job_video_has_mode
      CHECK (creative_kind <> 'SHORT_FORM_VIDEO' OR video_mode IS NOT NULL);
  END IF;

  -- An avatar render must record WHICH avatar the owner chose. A render with a
  -- presenter and no recorded selection is one nobody can be shown to have picked.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creative_job_avatar_mode_has_selection') THEN
    ALTER TABLE creative_render_jobs
      ADD CONSTRAINT creative_job_avatar_mode_has_selection
      CHECK (video_mode IS DISTINCT FROM 'AVATAR_SPOKESPERSON' OR avatar_selection IS NOT NULL);
  END IF;

  -- ONLY provider stock voices. OWNER_AUTHORIZED is absent on purpose: no
  -- consent record exists anywhere in this schema, and possessing an audio
  -- file is not permission to reproduce someone's voice.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creative_job_voice_is_stock_only') THEN
    ALTER TABLE creative_render_jobs
      ADD CONSTRAINT creative_job_voice_is_stock_only
      CHECK (voice_selection IS NULL
             OR voice_selection->>'kind' = 'PROVIDER_STOCK');
  END IF;

  -- A synthetic presenter has no role. Recording one would make it endorsement.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creative_job_avatar_has_no_role') THEN
    ALTER TABLE creative_render_jobs
      ADD CONSTRAINT creative_job_avatar_has_no_role
      CHECK (avatar_selection IS NULL
             OR (avatar_selection ? 'providerAvatarId'
                 AND avatar_selection->>'presenterKind' = 'SYNTHETIC_PRESENTER'
                 AND NOT (avatar_selection ? 'role')));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS creative_render_jobs_video
  ON creative_render_jobs(content_asset_id, video_mode, created_at DESC)
  WHERE creative_kind = 'SHORT_FORM_VIDEO';

-- ── generated media: duration for audio and video ──────────────────────────
ALTER TABLE marketing_assets ADD COLUMN IF NOT EXISTS duration_ms INTEGER;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_assets_asset_type_check') THEN
    ALTER TABLE marketing_assets DROP CONSTRAINT marketing_assets_asset_type_check;
  END IF;
  ALTER TABLE marketing_assets
    ADD CONSTRAINT marketing_assets_asset_type_check
    CHECK (asset_type IN ('LOGO','APP_ICON','SCREENSHOT','HERO_IMAGE',
                          'PRODUCT_IMAGE','VIDEO','AUDIO','OTHER'));
END $$;

-- ── creative approval binds the presenter and voice that were used ─────────
ALTER TABLE creative_approvals ADD COLUMN IF NOT EXISTS avatar_selection JSONB;
ALTER TABLE creative_approvals ADD COLUMN IF NOT EXISTS voice_selection JSONB;
ALTER TABLE creative_approvals ADD COLUMN IF NOT EXISTS video_mode TEXT;

COMMENT ON COLUMN creative_render_jobs.avatar_selection IS
  'Owner-chosen synthetic presenter, recorded at render time. Carries a provider '
  'id and an owner-safe label only. A CHECK forbids a "role" key: an avatar is '
  'never a customer, employee, founder or expert.';
COMMENT ON COLUMN creative_render_jobs.voice_selection IS
  'PROVIDER_STOCK only. Cloning a real person needs a consent contract this '
  'schema does not have, so OWNER_AUTHORIZED is deliberately unrepresentable.';
COMMENT ON COLUMN creative_render_jobs.video_mode IS
  'PRODUCT_MOTION | AVATAR_SPOKESPERSON | VOICEOVER_CREATIVE. Rendering '
  'metadata. Not authorization, not endorsement, not truth.';
