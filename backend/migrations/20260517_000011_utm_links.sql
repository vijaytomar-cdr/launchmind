-- Migration: 20260517_000011_utm_links
-- Week 7: UTM tracking links for campaign attribution.
-- Idempotent: safe to run twice.

CREATE TABLE IF NOT EXISTS utm_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  founder_id   UUID NOT NULL REFERENCES founders(id),
  base_url     TEXT NOT NULL,
  utm_source   TEXT NOT NULL,
  utm_medium   TEXT NOT NULL,
  utm_campaign TEXT NOT NULL,
  utm_content  TEXT,
  utm_term     TEXT,
  short_code   TEXT NOT NULL UNIQUE,
  click_count  INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE utm_links ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'utm_links' AND policyname = 'utm_links_owner'
  ) THEN
    CREATE POLICY "utm_links_owner" ON utm_links USING (founder_id = auth.uid());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS utm_links_campaign_id ON utm_links(campaign_id);
CREATE INDEX IF NOT EXISTS utm_links_short_code ON utm_links(short_code);
