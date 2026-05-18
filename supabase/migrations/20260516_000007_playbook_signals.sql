-- @file 20260516_000007_playbook_signals.sql
-- @description Creates the playbook_signals table — anonymised, no PII.
--   No founder_id / product_id — this is aggregate signal data used to train recommendations.
--   authenticated role: SELECT only. service_role: INSERT only (via backend worker).
--   signal_embedding: 1536-dim vector for semantic similarity matching during strategy gen.
--   Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS playbook_signals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category          TEXT NOT NULL,
  market            TEXT NOT NULL CHECK (market IN ('usa','india')),
  channel           TEXT NOT NULL,
  hook_type         TEXT,
  price_tier        TEXT,
  install_delta_pct NUMERIC(8,2),
  conversion_rate   NUMERIC(6,4),
  retention_d7      NUMERIC(6,4),
  week_number       INTEGER,
  signal_embedding  VECTOR(1536),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON playbook_signals TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON playbook_signals FROM authenticated;
