-- Migration: 20260530_000029_product_archive
-- Adds soft-delete (archive) support to products.
-- archived_at NULL = active; non-null = archived.
-- archive_reason distinguishes owner-initiated archive from permanent-delete staging.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS archived_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archive_reason  TEXT
    CHECK (archive_reason IN ('owner_archived', 'owner_deleted') OR archive_reason IS NULL);

-- Partial index for fast active-product queries (the common path)
CREATE INDEX IF NOT EXISTS idx_products_active
  ON products (founder_id)
  WHERE archived_at IS NULL;

-- Partial index for archive-list queries (sorted by archived date)
CREATE INDEX IF NOT EXISTS idx_products_archived
  ON products (founder_id, archived_at DESC)
  WHERE archived_at IS NOT NULL;
