-- @file 20260516_000002_products.sql
-- @description Creates the products table with pgvector support and RLS.
--   icp_embedding: 1536-dim vector for semantic similarity search via pgvector.
--   confirmed_icp / competitor_set / scraped_meta: JSONB for flexible schema evolution.
--   Idempotent: safe to run multiple times.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS products (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id          UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  store_url           TEXT NOT NULL,
  platform            TEXT NOT NULL CHECK (platform IN ('app_store','play_store')),
  category            TEXT,
  markets             TEXT[] DEFAULT ARRAY['usa'],
  price_tier          TEXT,
  confirmed_icp       JSONB,
  competitor_set      JSONB,
  scraped_meta        JSONB,
  brand_voice_profile JSONB,
  last_scraped_at     TIMESTAMPTZ,
  icp_embedding       VECTOR(1536),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_owner" ON products;
CREATE POLICY "products_owner" ON products USING (founder_id = auth.uid());

DROP TRIGGER IF EXISTS set_products_updated_at ON products;
CREATE TRIGGER set_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
