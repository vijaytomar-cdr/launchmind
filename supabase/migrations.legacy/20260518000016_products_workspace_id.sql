-- Migration: 20260518_000016_products_workspace_id.sql
-- Adds workspace_id to products for multi-client workspace scoping.
-- NULL means the product is unassigned (personal workspace).
-- Idempotent: safe to run twice.

BEGIN;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS products_workspace_id_idx
  ON products(workspace_id) WHERE workspace_id IS NOT NULL;

COMMIT;
