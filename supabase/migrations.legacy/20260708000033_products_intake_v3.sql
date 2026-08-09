-- @file 20260708_000033_products_intake_v3.sql
-- @description Extends products table for the 5-step direct-input intake wizard (ADR-012).
--   New columns map to wizard steps: basics, business, audience, brand, connections.
--   All columns nullable — existing rows unaffected.
--   intake_v3_step tracks wizard progress; intake_v3_complete_at gates Growth Brain.

BEGIN;

ALTER TABLE products
  -- Step 1: Product Basics
  ADD COLUMN IF NOT EXISTS stage             TEXT,     -- 'idea' | 'beta' | 'launched' | 'scaling'
  ADD COLUMN IF NOT EXISTS primary_language  TEXT,     -- e.g. 'en', 'hi', 'hinglish'
  ADD COLUMN IF NOT EXISTS country           TEXT,     -- primary country of operation

  -- Step 2: Business (stored in founder_context JSONB, but also dedicated columns for indexing)
  ADD COLUMN IF NOT EXISTS revenue_model     TEXT,     -- 'subscription' | 'one_time' | 'freemium' | 'ads' | 'marketplace'
  ADD COLUMN IF NOT EXISTS monthly_budget    INTEGER,  -- USD marketing budget

  -- Step 4: Brand (dedicated columns — brand_voice_profile JSONB extended for brand_values/colors)
  ADD COLUMN IF NOT EXISTS brand_values      TEXT[],   -- e.g. ['trustworthy', 'simple', 'bold']
  ADD COLUMN IF NOT EXISTS color_preferences JSONB,   -- { primary: '#hex', secondary: '#hex', accent: '#hex' }

  -- Intake v3 progress tracking
  ADD COLUMN IF NOT EXISTS intake_v3_step          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS intake_v3_complete_at   TIMESTAMPTZ;

-- Allow store_url to be nullable for products created via setup wizard (no store URL yet)
ALTER TABLE products
  ALTER COLUMN store_url DROP NOT NULL,
  ALTER COLUMN platform  DROP NOT NULL;

-- Index for quick lookup of incomplete v3 intakes
CREATE INDEX IF NOT EXISTS idx_products_intake_v3
  ON products(founder_id, intake_v3_step)
  WHERE intake_v3_complete_at IS NULL;

COMMIT;
