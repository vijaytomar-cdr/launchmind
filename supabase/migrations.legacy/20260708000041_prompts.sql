-- Migration 041: Prompt Registry
-- Stores versioned prompt metadata for the AI Platform.
-- Prompts are registered by prompt_id + version. Only one version is 'active' per prompt_id.
-- Service-role write only; no RLS needed (system table, not founder-scoped).

CREATE TABLE IF NOT EXISTS prompts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id       TEXT NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1,
  purpose         TEXT NOT NULL,
  owner           TEXT NOT NULL DEFAULT 'system',
  model           TEXT NOT NULL CHECK (model IN ('sonnet','haiku')),
  system_template TEXT,
  user_template   TEXT NOT NULL DEFAULT '',
  input_schema    JSONB,
  output_schema   JSONB,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('draft','active','archived')),
  token_cost      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(prompt_id, version)
);

CREATE INDEX IF NOT EXISTS prompts_prompt_id_status ON prompts(prompt_id, status);

-- No RLS — only service_role reads/writes this table
-- No INSERT/UPDATE/DELETE for authenticated role (controlled via service_role in aiPlatform)
