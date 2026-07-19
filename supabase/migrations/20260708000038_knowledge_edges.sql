-- Migration: 20260708_000038_knowledge_edges
-- Directed edges between knowledge graph nodes.
-- Relationships: targets, competes_with, belongs_to, influenced_by,
--   validated_by, generated_from, has_feature, serves_persona,
--   appears_in, measured_by, leads_to, blocks.
-- Idempotent: safe to run twice.

CREATE TABLE IF NOT EXISTS knowledge_edges (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id   UUID        NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  source_id    UUID        NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  target_id    UUID        NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  relationship TEXT        NOT NULL
               CHECK (relationship IN (
                 'targets','competes_with','belongs_to','influenced_by',
                 'validated_by','generated_from','has_feature','serves_persona',
                 'appears_in','measured_by','leads_to','blocks'
               )),
  weight       NUMERIC(3,2) NOT NULL DEFAULT 0.50
               CHECK (weight >= 0.00 AND weight <= 1.00),
  properties   JSONB        NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id, target_id, relationship)
);

ALTER TABLE knowledge_edges ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'knowledge_edges' AND policyname = 'edges_owner'
  ) THEN
    DROP POLICY IF EXISTS "edges_owner" ON knowledge_edges;
CREATE POLICY "edges_owner" ON knowledge_edges
      USING (founder_id = auth.uid());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS edges_source ON knowledge_edges(source_id);
CREATE INDEX IF NOT EXISTS edges_target ON knowledge_edges(target_id);
CREATE INDEX IF NOT EXISTS edges_founder ON knowledge_edges(founder_id);
