-- Database generation marker — P1-45.
--
-- NOT a migration, deliberately. Migrations are replayed on BOTH disposable
-- databases, so a migration-created marker would claim the same generation in
-- both places and answer nothing. This is applied once, by the bootstrap command
-- for the generation you intend, with :generation supplied by that command.
--
-- Usage:  psql ... -v generation=PG_INTEGRATION -f scripts/db-generation-marker.sql
--         psql ... -v generation=BROWSER_CERT   -f scripts/db-generation-marker.sql

CREATE TABLE IF NOT EXISTS lm_database_generation (
  generation TEXT PRIMARY KEY
             CHECK (generation IN ('PG_INTEGRATION', 'BROWSER_CERT')),
  marked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Exactly one row, enforced rather than assumed: two markers would let a
  -- guard read whichever it happened to see first.
  only_one   BOOLEAN NOT NULL DEFAULT true UNIQUE CHECK (only_one)
);

INSERT INTO lm_database_generation (generation)
VALUES (:'generation')
ON CONFLICT (only_one) DO UPDATE SET generation = EXCLUDED.generation;

-- Readable by the guards (which use service_role) and by nobody else: this is
-- infrastructure metadata, not application data.
ALTER TABLE lm_database_generation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON lm_database_generation FROM authenticated, anon;
