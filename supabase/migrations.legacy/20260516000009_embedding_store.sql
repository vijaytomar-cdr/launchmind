-- @file 20260516_000009_embedding_store.sql
-- @description Creates the embedding_store table with RLS.
--   Stores ICP embeddings, campaign history vectors, and learning log entries.
--   embedding: 1536-dim vector, queried via pgvector cosine distance (<=>).
--   type CHECK ensures only known embedding types are stored.
--   Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS embedding_store (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id  UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id  UUID REFERENCES products(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('icp','campaign_history','learning_log')),
  content     TEXT NOT NULL,
  embedding   VECTOR(1536),
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE embedding_store ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "embeddings_owner" ON embedding_store;
CREATE POLICY "embeddings_owner" ON embedding_store USING (founder_id = auth.uid());

CREATE INDEX IF NOT EXISTS embedding_store_type_idx ON embedding_store(founder_id, type);
