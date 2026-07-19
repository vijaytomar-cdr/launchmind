-- Migration: 20260518_000015_workspaces.sql
-- Creates the workspaces table for Studio-tier multi-client workspace management.
-- RLS: founders can only access their own workspaces.
-- Idempotent: safe to run twice.

BEGIN;

CREATE TABLE IF NOT EXISTS workspaces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id  UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  client_name TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspaces_owner" ON workspaces;
CREATE POLICY "workspaces_owner" ON workspaces
  USING (founder_id = auth.uid());

COMMIT;
