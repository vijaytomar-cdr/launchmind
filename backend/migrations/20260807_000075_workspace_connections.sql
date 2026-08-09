-- Migration 075: workspace_connections
-- Full connection lifecycle model for Improve Intelligence feature.
-- Replaces ad-hoc platform_tokens for Phase 2 provider connections.

CREATE TABLE IF NOT EXISTS workspace_connections (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id             UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  product_id             UUID REFERENCES products(id) ON DELETE SET NULL,
  provider               TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'NOT_CONNECTED'
                         CHECK (status IN (
                           'NOT_CONNECTED','PREVIEWING','AUTHORIZING','AUTHORIZED',
                           'SELECTING_SOURCE','SYNC_QUEUED','SYNCING','PARTIAL','HEALTHY',
                           'NO_HISTORY','NEEDS_REAUTH','PERMISSION_DENIED','WRONG_ACCOUNT',
                           'PROVIDER_UNAVAILABLE','SYNC_FAILED','DISCONNECTED'
                         )),
  external_account_id    TEXT,
  external_account_name  TEXT,
  selected_resource_id   TEXT,
  selected_resource_name TEXT,
  freshness_status       TEXT DEFAULT 'unknown' CHECK (freshness_status IN ('fresh','stale','unknown')),
  last_synced_at         TIMESTAMPTZ,
  credential_reference   TEXT,
  connection_config      JSONB DEFAULT '{}',
  permissions_granted    TEXT[] DEFAULT '{}',
  error_detail           TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(founder_id, provider)
);
ALTER TABLE workspace_connections ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "connections_owner" ON workspace_connections USING (founder_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS workspace_connections_founder ON workspace_connections(founder_id);
CREATE INDEX IF NOT EXISTS workspace_connections_status ON workspace_connections(founder_id, status);
