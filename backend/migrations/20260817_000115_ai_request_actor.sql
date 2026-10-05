-- ============================================================================
-- 115 — AI request actor identity. Closes P1-43.
--
-- MEASURED DEFECT. Every system-initiated model call wrote
-- `founder_id: 'system'` into a UUID column, Postgres rejected it with 22P02,
-- and aiPlatform's catch swallowed the error and returned null. The model call
-- succeeded, the owner got the answer, and NO AUDIT ROW EXISTED. Roughly 207
-- calls in the previous pass produced zero rows. ADR-027's "every AI request is
-- auditable" has therefore never held for system calls.
--
-- THE FIX IS NOT A FAKE FOUNDER. Minting a synthetic founder UUID would make
-- system calls auditable by making them look like a person's, and every
-- authority surface in LaunchMind keys off founder identity. The two questions
--
--     WHO INITIATED THIS CALL      (provenance about the call)
--     WHOSE AUTHORITY APPLIES      (evidence and decision authority)
--
-- are separate, and this migration keeps them separate: a non-founder actor is
-- required to have NO founder_id at all, enforced by CHECK rather than by
-- convention.
--
-- VOCABULARY IS REUSED, NOT INVENTED. `ActorType = 'founder' | 'system'` already
-- exists in connectionExecutionGuard.ts, where 'system' is the value that is
-- refused before every other execution gate. 'worker' is deliberately NOT added:
-- nothing in the code can currently distinguish a worker from any other system
-- caller, and a value nothing sets would be a distinction the data does not have.
--
-- ADDITIVE ONLY. Idempotent. No historical row changes: actor_type defaults to
-- 'founder', which is what every existing row is.
-- @security The CHECK is the structural half — a system row cannot carry founder
--   identity even if a future caller passes one.
-- @dependencies ai_requests (042), workspaces, founders
-- ============================================================================

BEGIN;

ALTER TABLE ai_requests
  ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'founder';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_requests_actor_type_check') THEN
    ALTER TABLE ai_requests
      ADD CONSTRAINT ai_requests_actor_type_check
      CHECK (actor_type IN ('founder', 'system'));
  END IF;
END $$;

-- THE INVARIANT. A system call may never carry founder identity. Without this,
-- "audit the actor" degrades into "attach whichever founder was nearby", which
-- is how call provenance turns into founder authority.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_requests_system_has_no_founder') THEN
    ALTER TABLE ai_requests
      ADD CONSTRAINT ai_requests_system_has_no_founder
      CHECK (actor_type = 'founder' OR founder_id IS NULL);
  END IF;
END $$;

-- Scope, so a global system call is representable as global rather than being
-- attached to an arbitrary workspace (§9). Nullable BY DESIGN: null means "not
-- scoped to one workspace", which is different from "scope unknown" only in
-- that we refuse to guess.
ALTER TABLE ai_requests
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ai_requests_actor_created
  ON ai_requests(actor_type, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_requests_workspace_created
  ON ai_requests(workspace_id, created_at DESC)
  WHERE workspace_id IS NOT NULL;

COMMENT ON COLUMN ai_requests.actor_type IS
  'WHO initiated this model call. Provenance about the CALL only. Never evidence '
  'authority, never approval, never execution permission. A system row has no '
  'founder_id by CHECK constraint.';
COMMENT ON COLUMN ai_requests.workspace_id IS
  'Workspace this call was made for, when it was made for one. NULL means the '
  'call was not workspace-scoped — not that the scope is unknown.';

-- RLS is UNCHANGED and that is deliberate. The existing policy is
-- `founder_id = auth.uid()`, so system rows (founder_id IS NULL) are invisible
-- to every founder and readable only by service_role. Widening reads to
-- workspace members would be a new disclosure decision, not part of closing
-- P1-43, so it is not made here.

COMMIT;
