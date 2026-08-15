/**
 * @file ingestionSchema.test.ts
 * @description Schema-drift and error-surfacing guards for shadow ingestion —
 *   3.1G remediation §5–§6.
 *
 *   THE DEFECT THIS PREVENTS RECURRING. `runShadowIngestion` selected a column
 *   named `insight_type`. The real column (migration 084) is `insight_key`.
 *   PostgREST returned an error, the code destructured only `data`, `data` was
 *   null, and the function reported zero candidates. Shadow ingestion could never
 *   have worked, and nothing anywhere said so — a broken column name was
 *   indistinguishable from "this workspace has no insights yet".
 *
 *   Two independent guards, because either alone can be defeated:
 *
 *   1. SCHEMA — every column the builder selects is checked against the actual
 *      migration DDL. This catches a rename or a typo at test time rather than
 *      at runtime in a workspace nobody is watching.
 *   2. ERROR SURFACING — a query failure must throw or record, never degrade to
 *      an empty result. "Zero because it failed" and "zero because there are
 *      none" are different facts and must not share a representation.
 *
 * @security No network, no database. Reads source and migration files.
 * @dependencies claimCandidateBuilder, migrations/*084*, helpers/memoryDb
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const MIGRATIONS = join(ROOT, 'migrations');
const BUILDER = join(ROOT, 'src', 'services', 'memory', 'claimCandidateBuilder.ts');

const source = readFileSync(BUILDER, 'utf-8');
/** Comments name the old column deliberately; strip them before matching code. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Every column mentioned in any DDL touching connection_insights. */
function connectionInsightColumns(): Set<string> {
  const cols = new Set<string>();
  for (const f of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql'))) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf-8');
    const create = sql.match(/CREATE TABLE[^;]*?connection_insights\s*\(([\s\S]*?)\n\);/i);
    if (create) {
      for (const line of create[1].split('\n')) {
        const m = line.match(/^\s{2}([a-z_][a-z0-9_]*)\s+[A-Z]/);
        if (m) cols.add(m[1]);
      }
    }
    for (const m of sql.matchAll(/ALTER TABLE\s+connection_insights\s+ADD COLUMN(?:\s+IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)/gi)) {
      cols.add(m[1]);
    }
  }
  return cols;
}

describe('§5 ingestion reads the real schema', () => {
  it('the migration defines insight_key and NOT insight_type', () => {
    const cols = connectionInsightColumns();
    expect(cols.size, 'failed to parse connection_insights DDL').toBeGreaterThan(5);
    expect(cols.has('insight_key')).toBe(true);
    expect(cols.has('insight_type'), 'insight_type does not exist and must not be expected').toBe(false);
  });

  it('the builder selects insight_key', () => {
    expect(code).toContain('insight_key');
  });

  it('the builder never references the non-existent insight_type', () => {
    expect(code, 'insight_type is not a real column').not.toContain('insight_type');
  });

  it('EVERY column the builder selects from connection_insights exists in the DDL', () => {
    // The general guard. A future edit that adds `insight_category` or renames a
    // field fails here instead of silently returning zero candidates forever.
    const select = code.match(/from\('connection_insights'\)\s*\n?\s*\.select\(\s*'([^']+)'/);
    expect(select, 'could not locate the connection_insights select').not.toBeNull();

    const selected = select![1].split(',').map(s => s.trim()).filter(Boolean);
    const cols = connectionInsightColumns();
    const missing = selected.filter(c => !cols.has(c));
    expect(missing, `selected columns absent from the schema: ${missing.join(', ')}`).toEqual([]);
  });

  it('the InsightRow interface matches what is selected', () => {
    // A drift between the select list and the TypeScript shape produces
    // `undefined` at runtime rather than a compile error, because the row is cast.
    const iface = source.match(/interface InsightRow \{([\s\S]*?)\n\}/);
    expect(iface).not.toBeNull();
    expect(iface![1]).toContain('insight_key');
    expect(iface![1]).not.toMatch(/^\s*insight_type/m);
  });
});

describe('§5 PostgREST errors are surfaced, never read as empty', () => {
  it('a failed insights query THROWS rather than reporting zero candidates', async () => {
    vi.resetModules();
    vi.doMock('../src/lib/supabaseAdmin', () => ({
      getSupabaseAdmin: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({
                  data: null,
                  error: { message: "column connection_insights.nope does not exist", code: '42703' },
                }),
              }),
            }),
          }),
        }),
      }),
    }));
    const { runShadowIngestion } = await import('../src/services/memory/claimCandidateBuilder');
    await expect(runShadowIngestion('11111111-1111-4111-8111-111111111111', { allowModel: false }))
      .rejects.toThrow(/connection_insights unreadable/i);
    vi.doUnmock('../src/lib/supabaseAdmin');
    vi.resetModules();
  });

  it('the read does not destructure data alone — the error is bound and checked', () => {
    // Structural backstop: `const { data } = await db.from('connection_insights')`
    // is the exact shape that caused the defect.
    const read = code.slice(code.indexOf("from('connection_insights')") - 200,
                            code.indexOf("from('connection_insights')"));
    expect(read).toContain('error');
    expect(code).toMatch(/if \(insightError\)/);
  });
});

describe('§6 zero-candidate runs cannot report success by default', () => {
  let db: Record<string, unknown[]>;

  beforeEach(() => { vi.resetModules(); });

  /** Builds a stub whose insights query succeeds and returns `rows`. */
  function stub(rows: unknown[], memories: unknown[] = []) {
    db = { connection_insights: rows, marketing_memories: memories };
    vi.doMock('../src/lib/supabaseAdmin', () => ({
      getSupabaseAdmin: () => ({
        from: (t: string) => ({
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: db[t] ?? [], error: null }),
              order: () => ({ limit: async () => ({ data: db[t] ?? [], error: null }) }),
              then: undefined,
            }),
          }),
        }),
      }),
    }));
  }

  it('distinguishes "no eligible insights" from "query failed" (A vs B)', async () => {
    // A: the query succeeded and there is genuinely nothing.
    stub([]);
    const { runShadowIngestion } = await import('../src/services/memory/claimCandidateBuilder');
    const report = await runShadowIngestion('11111111-1111-4111-8111-111111111111', { allowModel: false });
    expect(report.candidatesBuilt).toBe(0);
    expect(report.decisions).toEqual([]);
    // It returns cleanly — the caller, not the library, decides that zero is a
    // failed validation. Case B throws (proved above), so the two are distinct.
    vi.doUnmock('../src/lib/supabaseAdmin');
  });

  it('distinguishes "builder rejected all input" (D) from "nothing to read" (A)', async () => {
    // D: rows exist but none can form a defensible claim — a headline too short
    // to assert anything.
    stub([{ id: 'i1', workspace_id: '11111111-1111-4111-8111-111111111111', product_id: null,
            provider: 'meta', insight_key: 'meta.x', headline: 'short', detail: 'd',
            evidence: [], source_signal_ids: [], provenance: {}, confidence: 0.5,
            created_at: '2026-01-01' }]);
    const { runShadowIngestion } = await import('../src/services/memory/claimCandidateBuilder');
    const report = await runShadowIngestion('11111111-1111-4111-8111-111111111111', { allowModel: false });
    expect(report.candidatesBuilt).toBe(0);
    vi.doUnmock('../src/lib/supabaseAdmin');
  });

  it('the validation SCRIPT refuses to report on a zero-candidate run', () => {
    // The guard lives in the script, so it is asserted where it lives. Without
    // it, every safety check passes vacuously and prints PASS — which is what the
    // first run of that script actually did.
    const script = readFileSync(join(ROOT, 'scripts', 'shadowValidation.ts'), 'utf-8');
    expect(script).toMatch(/candidatesBuilt === 0/);
    expect(script).toMatch(/process\.exit\(2\)/);
    expect(script).toMatch(/pass vacuously|not a validation result/i);
  });

  it('the validation SCRIPT throws on a failed seed (C)', () => {
    const script = readFileSync(join(ROOT, 'scripts', 'shadowValidation.ts'), 'utf-8');
    expect(script).toMatch(/insertOrThrow/);
    expect(script).toMatch(/seed failed on/);
    expect(script).toMatch(/seed verification failed/);
  });
});
