-- Migration 042: AI Requests Audit Table
-- Immutable audit trail for all AI Platform calls.
-- Mirrors audit_logs pattern: INSERT only for service_role; founders read their own rows.

CREATE TABLE IF NOT EXISTS ai_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id      UUID REFERENCES founders(id),
  product_id      UUID REFERENCES products(id),
  prompt_id       TEXT NOT NULL,
  prompt_version  INTEGER NOT NULL DEFAULT 1,
  model           TEXT NOT NULL,
  action          TEXT NOT NULL,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  total_tokens    INTEGER,
  cost_usd        NUMERIC(10,6),
  latency_ms      INTEGER,
  retries         INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'success'
                  CHECK (status IN ('success','failed','retried','timeout')),
  error           TEXT,
  context_sources TEXT[],
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ai_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_requests_owner_read" ON ai_requests;
CREATE POLICY "ai_requests_owner_read" ON ai_requests
  FOR SELECT USING (founder_id = auth.uid());

-- Immutable: no UPDATE or DELETE for any non-superuser role
REVOKE UPDATE, DELETE ON ai_requests FROM authenticated, anon;

CREATE INDEX IF NOT EXISTS ai_requests_founder_created
  ON ai_requests(founder_id, created_at DESC)
  WHERE founder_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_requests_prompt_id
  ON ai_requests(prompt_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_requests_status
  ON ai_requests(status, created_at DESC);
