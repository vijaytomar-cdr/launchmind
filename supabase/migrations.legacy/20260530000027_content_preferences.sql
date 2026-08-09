/**
 * @migration 20260530_000027_content_preferences
 * @description Adds content type preferences, voice clone config, and approval mode
 *   to products and founders tables.
 */

ALTER TABLE products ADD COLUMN IF NOT EXISTS content_preferences JSONB DEFAULT '{
  "text": {
    "whatsappBroadcast": true,
    "email": true,
    "adCopy": true,
    "linkedin": true
  },
  "video": {
    "reels30s": false,
    "shorts60s": false,
    "appStorePreview": false,
    "whatsappVoiceNote": false
  },
  "visual": {
    "metaImageBrief": false,
    "carouselBrief": false
  },
  "community": {
    "whatsappGroupPost": false,
    "facebookGroupPost": false,
    "indieHackersPost": false,
    "twitterThread": false
  },
  "socialProof": {
    "caseStudy": true,
    "testimonialBrief": false,
    "reviewResponseTemplates": true
  }
}'::jsonb;

ALTER TABLE products ADD COLUMN IF NOT EXISTS voice_clone_id TEXT;

ALTER TABLE products ADD COLUMN IF NOT EXISTS approval_mode TEXT
  NOT NULL DEFAULT 'manual'
  CHECK (approval_mode IN ('manual','one_tap','auto'));

ALTER TABLE products ADD COLUMN IF NOT EXISTS approval_weeks_count INTEGER DEFAULT 0;

ALTER TABLE founders ADD COLUMN IF NOT EXISTS voice_clone_id TEXT;
