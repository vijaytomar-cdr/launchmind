/**
 * @migration 20260708_000052_experiments
 * @description Experiment framework — A/B tests for content, copy, channel, and creative.
 *   Each experiment has two variants (a and b), each linked to a content asset.
 *   Append-only result recording — winner selection creates learning records in Marketing Memory.
 * @security RLS founder-scoped on both tables.
 */

CREATE TABLE IF NOT EXISTS experiments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id           UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  founder_id           UUID NOT NULL REFERENCES founders(id),
  campaign_id          UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  mission_id           UUID REFERENCES missions(id) ON DELETE SET NULL,

  title                TEXT NOT NULL,
  hypothesis           TEXT NOT NULL,
  experiment_type      TEXT NOT NULL CHECK (experiment_type IN (
                         'copy', 'creative', 'channel', 'aso', 'audience'
                       )),
  goal                 TEXT NOT NULL,
  metric               TEXT NOT NULL,

  status               TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN (
                         'draft', 'ready', 'running', 'waiting_for_data',
                         'completed', 'inconclusive', 'failed', 'archived'
                       )),

  market               TEXT CHECK (market IN ('usa', 'india', 'both')),
  start_date           DATE,
  end_date             DATE,

  expected_outcome     TEXT,
  confidence           NUMERIC(4,3),

  winner               TEXT CHECK (winner IN ('a', 'b', 'inconclusive') OR winner IS NULL),
  winner_confidence    NUMERIC(4,3),
  learning             TEXT,
  learning_summary     TEXT,

  growth_brain_version INTEGER DEFAULT 1,
  memory_id            UUID,

  archived_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE experiments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "experiments_owner" ON experiments;
CREATE POLICY "experiments_owner" ON experiments USING (founder_id = auth.uid());

CREATE INDEX IF NOT EXISTS experiments_product ON experiments(product_id, status);
CREATE INDEX IF NOT EXISTS experiments_founder ON experiments(founder_id, created_at DESC);

-- ── Experiment Variants ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS experiment_variants (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id    UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  founder_id       UUID NOT NULL REFERENCES founders(id),
  variant          TEXT NOT NULL CHECK (variant IN ('a', 'b')),
  asset_id         UUID REFERENCES content_assets(id) ON DELETE SET NULL,
  label            TEXT,
  description      TEXT,
  config           JSONB,

  -- Results (founder-entered or API-synced)
  impressions      INTEGER DEFAULT 0,
  clicks           INTEGER DEFAULT 0,
  conversions      INTEGER DEFAULT 0,
  metric_value     NUMERIC(10,4),

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(experiment_id, variant)
);

ALTER TABLE experiment_variants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "experiment_variants_owner" ON experiment_variants;
CREATE POLICY "experiment_variants_owner" ON experiment_variants USING (founder_id = auth.uid());

CREATE INDEX IF NOT EXISTS experiment_variants_experiment ON experiment_variants(experiment_id);
