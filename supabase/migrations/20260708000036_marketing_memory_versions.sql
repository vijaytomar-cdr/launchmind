-- Migration: 20260708_000036_marketing_memory_versions
-- Audit trail for every change to a marketing_memory.
-- Content is stored before the update so full history is recoverable.
-- Idempotent: safe to run twice.

CREATE TABLE IF NOT EXISTS marketing_memory_versions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id   UUID        NOT NULL REFERENCES marketing_memories(id) ON DELETE CASCADE,
  founder_id  UUID        NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  version     INTEGER     NOT NULL,
  content     JSONB       NOT NULL DEFAULT '{}',
  source      TEXT        NOT NULL,
  confidence  NUMERIC(3,2) NOT NULL DEFAULT 0.50,
  changed_by  TEXT        NOT NULL
              CHECK (changed_by IN ('ai','founder','system')),
  change_note TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE marketing_memory_versions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'marketing_memory_versions' AND policyname = 'memory_versions_owner'
  ) THEN
    DROP POLICY IF EXISTS "memory_versions_owner" ON marketing_memory_versions;
CREATE POLICY "memory_versions_owner" ON marketing_memory_versions
      USING (founder_id = auth.uid());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS memory_versions_memory_id
  ON marketing_memory_versions(memory_id, version DESC);
