-- @file 20260808_000082_oauth_authorization_requests.sql
-- @description Server-side store for in-flight OAuth authorization requests.
--   Replaces the previous stateless HMAC `state` parameter used by the legacy
--   channel integrations.
--
--   A stateless state token cannot be revoked, cannot be made single-use, and
--   cannot carry a PKCE verifier. Persisting the request lets the callback prove:
--     - the state was issued by us and has not been used before (replay guard)
--     - it has not expired
--     - the workspace and actor it was issued for still exist and are still valid
--     - the PKCE code_verifier matches the challenge sent to the provider
--
-- @security
--   - `state` is 256 bits of CSPRNG output, UNIQUE, single-use via consumed_at.
--   - `code_verifier` is stored as ciphertext (tokenVault), never plaintext.
--   - redirect_uri is persisted so the callback can assert the exact value sent.
--   - REVOKE ALL from authenticated/anon — this table is backend-only.
--   - Rows are retained after consumption so replay attempts are auditable.
-- @dependencies workspaces, founders

BEGIN;

CREATE TABLE IF NOT EXISTS oauth_authorization_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Opaque CSPRNG value echoed by the provider. Single-use.
  state                 TEXT NOT NULL UNIQUE,
  -- OIDC replay guard; NULL for providers that do not issue an ID token.
  nonce                 TEXT,

  -- PKCE. code_verifier is ciphertext; code_challenge is the public S256 digest.
  encrypted_code_verifier TEXT,
  code_challenge          TEXT,
  code_challenge_method   TEXT CHECK (code_challenge_method IN ('S256', 'plain')),
  kms_key_id              TEXT,

  provider              TEXT NOT NULL,
  -- Tenant this authorization will be bound to. Re-verified at callback time.
  workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Founder who initiated it. Re-verified as a workspace member at callback time.
  actor_id              UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,

  -- Exact redirect URI sent to the provider; must match on exchange.
  redirect_uri          TEXT NOT NULL,
  scopes                TEXT[] NOT NULL DEFAULT '{}',

  -- Set when an existing connection is being re-authorized rather than created.
  connection_id         UUID REFERENCES workspace_connections(id) ON DELETE CASCADE,
  -- 'connect' | 'reauthorize' | 'authority_upgrade'
  intent                TEXT NOT NULL DEFAULT 'connect'
                        CHECK (intent IN ('connect', 'reauthorize', 'authority_upgrade')),

  trace_id              TEXT,
  expires_at            TIMESTAMPTZ NOT NULL,
  consumed_at           TIMESTAMPTZ,
  -- Why a consumption attempt failed, for security auditing.
  rejected_reason       TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oauth_requests_workspace
  ON oauth_authorization_requests (workspace_id, created_at DESC);

-- Supports pruning expired, never-consumed requests.
CREATE INDEX IF NOT EXISTS oauth_requests_expiry
  ON oauth_authorization_requests (expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE oauth_authorization_requests ENABLE ROW LEVEL SECURITY;

-- No permissive policy: backend-only table.
REVOKE ALL ON oauth_authorization_requests FROM authenticated, anon;
GRANT SELECT, INSERT, UPDATE ON oauth_authorization_requests TO service_role;

COMMIT;
