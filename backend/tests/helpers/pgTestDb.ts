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
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

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
