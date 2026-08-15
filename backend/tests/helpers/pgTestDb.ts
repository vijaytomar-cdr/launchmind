/**
 * @file pgTestDb.ts
 * @description Real-PostgreSQL harness for tests that must exercise database
 *   constraints rather than service logic.
 *
 *   MemoryDb (tests/helpers/memoryDb.ts) honours query predicates, which makes
 *   tenancy assertions meaningful, but it cannot enforce a UNIQUE INDEX. Any test
 *   whose subject IS the constraint — dedup, replay protection, conflict targets —
 *   is vacuous against MemoryDb: it would pass whether or not the index exists, and
 *   whether or not the index is keyed on the right columns. That is exactly how the
 *   founder-scoped dedup defect (Step 8 finding L4) survived a green suite.
 *
 *   This harness applies the REAL migration files, so a test failure here means the
 *   shipped SQL is wrong, not that a fixture drifted.
 *
 * @security Connects only to a throwaway database named by TEST_DATABASE_URL. It
 *   refuses to run against anything that looks like a hosted Supabase instance, so a
 *   misconfigured environment cannot point the schema-dropping setup at production.
 * @dependencies pg (devDependency), backend/migrations/*.sql
 */

import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

/** Where the migration files live, resolved from THIS file, never from cwd. */
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

/**
 * Connection string for the disposable test database.
 *
 * Default matches the container documented in AGENTS.md:
 *   docker run -d --name lm-pg-test -e POSTGRES_PASSWORD=postgres \
 *     -e POSTGRES_DB=launchmind_test -p 55432:5432 postgres:16-alpine
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:55432/launchmind_test';

/**
 * Guards against ever pointing this at a real database.
 *
 * The setup path drops and recreates a schema. That is safe on a throwaway
 * container and catastrophic anywhere else, so the check is a hard refusal rather
 * than a warning.
 */
function assertDisposable(url: string): void {
  const lowered = url.toLowerCase();
  const looksHosted =
    lowered.includes('supabase.co') ||
    lowered.includes('supabase.com') ||
    lowered.includes('amazonaws.com') ||
    lowered.includes('rds.') ||
    lowered.includes('neon.tech') ||
    lowered.includes('render.com');

  const looksLocal =
    lowered.includes('localhost') ||
    lowered.includes('127.0.0.1') ||
    lowered.includes('@postgres') ||   // docker-compose service name, used in CI
    lowered.includes('@db:');

  if (looksHosted || !looksLocal) {
    throw new Error(
      'pgTestDb refuses to run against a non-local database. ' +
      'TEST_DATABASE_URL must point at a disposable local/CI Postgres.',
    );
  }
}

/** @returns True when a real Postgres is reachable, so suites can skip cleanly. */
export async function postgresAvailable(): Promise<boolean> {
  try {
    assertDisposable(TEST_DATABASE_URL);
  } catch {
    return false;
  }
  const client = new Client({ connectionString: TEST_DATABASE_URL, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

/** Reads one migration by its numeric id, e.g. 74 → 20260807_000074_*.sql */
function migrationSql(id: number): string {
  const { readdirSync } = require('fs') as typeof import('fs');
  const padded = String(id).padStart(6, '0');
  const file = readdirSync(MIGRATIONS_DIR).find((f: string) => f.includes(`_${padded}_`));
  if (!file) throw new Error(`Migration ${id} not found in ${MIGRATIONS_DIR}`);
  return readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
}

/**
 * Minimal ancestry for the tables under test.
 *
 * Deliberately hand-written rather than replaying all 87 migrations: those depend on
 * Supabase-only objects (auth.uid(), the authenticated/anon roles, RLS helpers) that
 * a bare Postgres does not have. What matters for a constraint test is that the
 * COLUMNS and the INDEXES come from the real migration files, which they do below.
 */
const BOOTSTRAP = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- products carries a vector column in the real schema until migration 090 drops it.
CREATE EXTENSION IF NOT EXISTS vector;

-- Supabase roles referenced by GRANT/REVOKE in the real migrations.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')          THEN CREATE ROLE anon;          END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  THEN CREATE ROLE service_role;  END IF;
END $$;

-- Stand-in for Supabase's auth.uid(), so RLS policies in the real migrations parse.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

CREATE TABLE IF NOT EXISTS founders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  name TEXT,
  category TEXT,
  confirmed_icp JSONB,
  icp_embedding vector(1536),
  archived_at TIMESTAMPTZ,
  archive_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  founder_id UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer',
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

/**
 * Applies the memory-domain ancestry (035-040) plus the Phase 3.1B migrations.
 *
 * Unlike setupTestDb, this needs pgvector: migration 035 declares a VECTOR
 * column and 089 creates the canonical store. The test image must therefore be
 * pgvector/pgvector:pg16 — see `npm run db:test:up`.
 *
 * @returns A connected client the caller must end()
 */
export const MEMORY_TEST_DATABASE_URL =
  process.env.MEMORY_TEST_DATABASE_URL ??
  TEST_DATABASE_URL.replace(/\/[^/]+$/, '/launchmind_memory_test');

/**
 * Applies the memory-domain ancestry plus the Phase 3.1B-D migrations.
 *
 * @param suffix Distinct per test FILE. Vitest runs files in parallel and each
 *   suite DROPs schema public, so two suites sharing a database race and one
 *   fails with "schema public already exists" — intermittently, which is the
 *   worst way for a test to fail. One database per suite removes the race
 *   entirely rather than serialising the whole run.
 */
export async function setupMemoryTestDb(suffix = ''): Promise<Client> {
  const dbUrl = suffix
    ? MEMORY_TEST_DATABASE_URL.replace(/\/[^/]+$/, `/launchmind_memory_test_${suffix}`)
    : MEMORY_TEST_DATABASE_URL;
  assertDisposable(dbUrl);

  // Its OWN database, not just its own schema: this suite and the signal-dedup
  // suite both DROP SCHEMA public, and Vitest runs test files in parallel. On a
  // shared database they race and one fails with "schema public already exists"
  // — intermittently, which is the worst way for a test to fail.
  const admin = new Client({ connectionString: TEST_DATABASE_URL });
  await admin.connect();
  const dbName = dbUrl.split('/').pop()!;
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.query('DROP SCHEMA IF EXISTS auth CASCADE');
  await client.query('CREATE EXTENSION IF NOT EXISTS vector');
  await client.query(BOOTSTRAP);

  // Workspace helpers come from migration 080, which also rewrites connection
  // RLS against tables this schema does not have. Only the helper functions are
  // relevant here, and they are created with 080's exact definitions so the
  // policies under test are the real ones.
  await client.query(`
    CREATE OR REPLACE FUNCTION lm_is_workspace_member(ws UUID) RETURNS BOOLEAN
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
      SELECT ws IS NOT NULL AND (
        EXISTS (SELECT 1 FROM workspaces w WHERE w.id = ws AND w.founder_id = auth.uid())
        OR EXISTS (SELECT 1 FROM workspace_members m
                    WHERE m.workspace_id = ws AND m.founder_id = auth.uid()
                      AND m.accepted_at IS NOT NULL)
      );
    $fn$;

    CREATE OR REPLACE FUNCTION lm_workspace_role(ws UUID) RETURNS TEXT
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
      SELECT CASE
        WHEN EXISTS (SELECT 1 FROM workspaces w WHERE w.id = ws AND w.founder_id = auth.uid())
          THEN 'owner'
        ELSE (SELECT m.role FROM workspace_members m
               WHERE m.workspace_id = ws AND m.founder_id = auth.uid()
                 AND m.accepted_at IS NOT NULL LIMIT 1)
      END;
    $fn$;

    CREATE OR REPLACE FUNCTION lm_can_write_workspace(ws UUID) RETURNS BOOLEAN
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
      SELECT lm_workspace_role(ws) IN ('owner','admin','editor');
    $fn$;
  `);

  // playbook_signals ancestry (migration 007) — needed by 090 and 092.
  await client.query(`
    CREATE TABLE IF NOT EXISTS playbook_signals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      category TEXT NOT NULL,
      market TEXT NOT NULL,
      channel TEXT NOT NULL,
      hook_type TEXT,
      price_tier TEXT,
      install_delta_pct NUMERIC(8,2),
      conversion_rate NUMERIC(6,4),
      retention_d7 NUMERIC(6,4),
      signal_embedding vector(1536),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS embedding_store (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      founder_id UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
      product_id UUID REFERENCES products(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding vector(1536),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // ai_requests ancestry (migration 042). Migration 095 ALTERs it to add
  // context_package_id, so the column it attaches to must exist. Only the
  // columns 095 touches are needed here.
  await client.query(`
    CREATE TABLE IF NOT EXISTS ai_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      founder_id UUID REFERENCES founders(id),
      product_id UUID REFERENCES products(id),
      prompt_id TEXT NOT NULL,
      model TEXT NOT NULL,
      action TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'success',
      context_sources TEXT[],
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // growth_brain_learning_events ancestry (migration 085). Migration 097 writes
  // to it and widens its event_type CHECK, so it must exist first. Only the
  // columns 097 touches are reproduced here; the real 085 also carries
  // connection-domain foreign keys to tables this schema does not have.
  await client.query(`
    CREATE TABLE IF NOT EXISTS growth_brain_learning_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      founder_id UUID NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
      product_id UUID REFERENCES products(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL CHECK (event_type IN (
        'source_connected','source_synced','source_disconnected','source_reauthorized',
        'context_updated','context_delta_updated','recommendation_updated','authority_changed')),
      trigger TEXT NOT NULL,
      provider TEXT,
      trace_id TEXT,
      evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
      previous_state TEXT,
      new_state TEXT,
      prior_confidence NUMERIC(5,2),
      new_confidence NUMERIC(5,2),
      recommendation_ids_affected UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
      mission_ids_affected UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
      created_by_type TEXT NOT NULL DEFAULT 'system' CHECK (created_by_type IN ('system','founder')),
      created_by UUID REFERENCES founders(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    REVOKE UPDATE, DELETE ON growth_brain_learning_events FROM authenticated, anon;
  `);

  // The real memory-domain migrations.
  for (const id of [35, 36, 37, 38, 39, 40]) await client.query(migrationSql(id));
  // Phase 3.1B.
  for (const id of [88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101]) await client.query(migrationSql(id));

  // Supabase grants these to `authenticated` by default; a bare Postgres does
  // not. Without them an RLS test fails with "relation does not exist" and looks
  // like a missing table rather than a missing grant — which would hide whether
  // the policy actually works.
  await client.query(`
    GRANT USAGE ON SCHEMA public TO authenticated, anon;
    GRANT SELECT ON embedding_outbox TO authenticated;
    GRANT SELECT ON marketing_memories, marketing_memory_versions, evidence,
                    learning_events, knowledge_nodes, knowledge_edges TO authenticated;
  `);

  return client;
}

/**
 * Creates a clean schema and applies the real migrations under test.
 *
 * @returns A connected client the caller must end()
 */
export async function setupTestDb(): Promise<Client> {
  assertDisposable(TEST_DATABASE_URL);

  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();

  // Fresh public schema every run: constraint tests must not inherit state.
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.query('DROP SCHEMA IF EXISTS auth CASCADE');

  await client.query(BOOTSTRAP);

  // 074 creates intelligence_signals; 078 adds the ORIGINAL founder-scoped dedup
  // index; 087 replaces it with the workspace-scoped one. Applying all three in
  // order proves 087 actually performs the swap on a database that already had 078.
  await client.query(migrationSql(74));

  // The workspace_id column comes from migration 080, which also rewrites RLS using
  // Supabase-only helpers. Only the column is relevant here, and it is applied with
  // the same definition 080 uses.
  await client.query(`
    ALTER TABLE intelligence_signals
      ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
  `);
  // trace_id comes from migration 079.
  await client.query(`ALTER TABLE intelligence_signals ADD COLUMN IF NOT EXISTS trace_id TEXT;`);

  await client.query(migrationSql(78));
  await client.query(migrationSql(87));

  return client;
}

/** @returns Names of unique indexes currently on a table. */
export async function uniqueIndexes(client: Client, table: string): Promise<string[]> {
  const { rows } = await client.query(
    `SELECT indexname FROM pg_indexes WHERE tablename = $1 AND indexdef ILIKE '%UNIQUE%' ORDER BY indexname`,
    [table],
  );
  return rows.map((r: { indexname: string }) => r.indexname);
}
