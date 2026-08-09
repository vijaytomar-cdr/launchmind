-- Migration: 045 — mission_steps, mission_logs, mission_approvals tables
-- Each mission has ordered steps executed by agents.
-- Logs capture all events for the Mission Timeline UI.
-- Approvals capture human-in-the-loop gates.

-- ── mission_steps ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mission_steps (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id     UUID    NOT NULL REFERENCES missions(id)    ON DELETE CASCADE,
  founder_id     UUID    NOT NULL REFERENCES founders(id),

  step_order     INTEGER NOT NULL,
  step_name      TEXT    NOT NULL,
  agent_type     TEXT    NOT NULL
                 CHECK (agent_type IN (
                   'research','strategy','planning','content','creative',
                   'campaign','publishing','optimization','learning',
                   'reporting','memory','benchmark'
                 )),

  status         TEXT    NOT NULL DEFAULT 'pending'
                 CHECK (status IN (
                   'pending','running','completed','failed',
                   'skipped','waiting_approval'
                 )),

  requires_approval BOOLEAN NOT NULL DEFAULT false,

  input          JSONB,
  output         JSONB,
  error          TEXT,

  retry_count    INTEGER NOT NULL DEFAULT 0,
  max_retries    INTEGER NOT NULL DEFAULT 2,

  -- Links to the AI audit trail
  ai_request_id  UUID    REFERENCES ai_requests(id),

  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE mission_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mission_steps_owner" ON mission_steps;
CREATE POLICY "mission_steps_owner" ON mission_steps USING (founder_id = auth.uid());

CREATE INDEX IF NOT EXISTS mission_steps_mission ON mission_steps(mission_id, step_order);
CREATE INDEX IF NOT EXISTS mission_steps_status  ON mission_steps(mission_id, status);

-- ── mission_logs ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mission_logs (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID        NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  founder_id UUID        NOT NULL REFERENCES founders(id),
  step_id    UUID                 REFERENCES mission_steps(id),
  level      TEXT        NOT NULL DEFAULT 'info'
             CHECK (level IN ('debug','info','warn','error')),
  message    TEXT        NOT NULL,
  metadata   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE mission_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mission_logs_owner" ON mission_logs;
CREATE POLICY "mission_logs_owner" ON mission_logs USING (founder_id = auth.uid());
-- Logs are append-only — no updates or deletes
REVOKE UPDATE, DELETE ON mission_logs FROM authenticated, anon;

CREATE INDEX IF NOT EXISTS mission_logs_mission ON mission_logs(mission_id, created_at);

-- ── mission_approvals ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mission_approvals (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id      UUID        NOT NULL REFERENCES missions(id)       ON DELETE CASCADE,
  step_id         UUID        NOT NULL REFERENCES mission_steps(id)  ON DELETE CASCADE,
  founder_id      UUID        NOT NULL REFERENCES founders(id),
  status          TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected')),
  title           TEXT        NOT NULL,
  description     TEXT,
  preview_data    JSONB,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at    TIMESTAMPTZ,
  response_note   TEXT,
  UNIQUE(step_id)
);

ALTER TABLE mission_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mission_approvals_owner" ON mission_approvals;
CREATE POLICY "mission_approvals_owner" ON mission_approvals USING (founder_id = auth.uid());

CREATE INDEX IF NOT EXISTS mission_approvals_mission ON mission_approvals(mission_id);
CREATE INDEX IF NOT EXISTS mission_approvals_pending ON mission_approvals(founder_id, status)
  WHERE status = 'pending';
