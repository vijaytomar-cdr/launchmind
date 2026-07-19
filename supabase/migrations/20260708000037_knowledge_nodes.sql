-- Migration: 20260708_000037_knowledge_nodes
-- Knowledge graph nodes representing marketing entities.
-- Covered entity types: Product, Feature, Persona, ICP, Competitor,
-- Campaign, Creative, Channel, Review, Market, Goal, Opportunity, Risk.
-- Idempotent: safe to run twice.

CREATE TABLE IF NOT EXISTS knowledge_nodes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id  UUID        NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id  UUID                    REFERENCES products(id) ON DELETE CASCADE,
  node_type   TEXT        NOT NULL
              CHECK (node_type IN (
                'product','feature','persona','icp','competitor','campaign',
                'creative','channel','review','market','goal','opportunity','risk'
              )),
  label       TEXT        NOT NULL,
  properties  JSONB       NOT NULL DEFAULT '{}',
  source_id   TEXT,
  source_type TEXT,
  confidence  NUMERIC(3,2) NOT NULL DEFAULT 0.50
              CHECK (confidence >= 0.00 AND confidence <= 1.00),
  embedding   VECTOR(1536),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE knowledge_nodes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'knowledge_nodes' AND policyname = 'nodes_owner'
  ) THEN
    DROP POLICY IF EXISTS "nodes_owner" ON knowledge_nodes;
CREATE POLICY "nodes_owner" ON knowledge_nodes
      USING (founder_id = auth.uid());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS nodes_product_type
  ON knowledge_nodes(product_id, node_type);

CREATE INDEX IF NOT EXISTS nodes_founder_type
  ON knowledge_nodes(founder_id, node_type);

-- Unique per-product entity to prevent duplicate nodes during graph build
CREATE UNIQUE INDEX IF NOT EXISTS nodes_product_type_label
  ON knowledge_nodes(founder_id, product_id, node_type, label)
  WHERE product_id IS NOT NULL;
