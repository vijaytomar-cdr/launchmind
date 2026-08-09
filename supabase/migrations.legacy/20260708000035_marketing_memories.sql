-- Migration: 20260708_000035_marketing_memories
-- Creates the marketing_memories table — the single source of truth for all
-- learned knowledge in LaunchMind. Versioned, confidence-scored, searchable.
-- Idempotent: safe to run twice.

CREATE TABLE IF NOT EXISTS marketing_memories (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id   UUID        NOT NULL REFERENCES founders(id)  ON DELETE CASCADE,
  product_id   UUID                    REFERENCES products(id) ON DELETE CASCADE,
  memory_type  TEXT        NOT NULL
               CHECK (memory_type IN (
                 'founder','brand','product','customer','campaign',
                 'creative','review','competitor','experiment','market','seasonality'
               )),
  title        TEXT        NOT NULL,
  content      JSONB       NOT NULL DEFAULT '{}',
  source       TEXT        NOT NULL
               CHECK (source IN (
                 'intake','growth_brain','campaign_performance','review',
                 'analytics','founder_feedback','ai_conversation','experiment'
               )),
  confidence   NUMERIC(3,2) NOT NULL DEFAULT 0.50
               CHECK (confidence >= 0.00 AND confidence <= 1.00),
  evidence_ids UUID[]       NOT NULL DEFAULT '{}',
  status       TEXT        NOT NULL DEFAULT 'active'
               CHECK (status IN ('draft','active','archived')),
  version      INTEGER     NOT NULL DEFAULT 1,
  embedding    VECTOR(1536),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at  TIMESTAMPTZ
);

ALTER TABLE marketing_memories ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'marketing_memories' AND policyname = 'memories_owner'
  ) THEN
    DROP POLICY IF EXISTS "memories_owner" ON marketing_memories;
CREATE POLICY "memories_owner" ON marketing_memories
      USING (founder_id = auth.uid());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS memories_product_type
  ON marketing_memories(product_id, memory_type)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS memories_founder_type
  ON marketing_memories(founder_id, memory_type)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS memories_status
  ON marketing_memories(founder_id, status);
