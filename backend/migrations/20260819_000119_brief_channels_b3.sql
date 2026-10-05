-- ============================================================================
-- 119 — content_briefs.content_channel: allow the five B3 channels.
--
-- FOUND BY RUNNING THE PIPELINE, not by reading it. Migration 114 created
-- `content_briefs` with CHECK (content_channel IN
--   ('google_ads_rsa','meta_ads','landing_page'))
-- because those were the only channels ADR-070 had at the time. B3 added
-- LINKEDIN_POST and SHORT_FORM_VIDEO_SCRIPT and named the existing three
-- GOOGLE_RSA / META_AD / LANDING_PAGE, so persisting a brief for any of the
-- five failed with 23514 the first time a real package was generated.
--
-- The old three values are RETAINED, not renamed: existing rows keep their
-- meaning and no consumer changes. This only widens what is representable.
--
-- ADDITIVE. Idempotent.
-- @security No authority, approval or execution semantics are involved — this
--   is a vocabulary widening on a planning table.
-- @dependencies content_briefs (114)
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_briefs_content_channel_check') THEN
    ALTER TABLE content_briefs DROP CONSTRAINT content_briefs_content_channel_check;
  END IF;

  ALTER TABLE content_briefs
    ADD CONSTRAINT content_briefs_content_channel_check
    CHECK (content_channel IN (
      -- retained from migration 114
      'google_ads_rsa', 'meta_ads', 'landing_page',
      -- the five B3 channel names
      'google_rsa', 'meta_ad', 'linkedin_post', 'short_form_video_script'
    ));
END $$;

COMMENT ON COLUMN content_briefs.content_channel IS
  'Channel this brief targets. Accepts both the original migration-114 names '
  'and the B3 channel names; the old values are retained so existing rows and '
  'consumers are unaffected.';

COMMIT;
