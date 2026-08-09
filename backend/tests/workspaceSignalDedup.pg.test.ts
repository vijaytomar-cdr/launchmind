/**
 * @file workspaceSignalDedup.pg.test.ts
 * @description Proves, against a REAL PostgreSQL, that intelligence-signal
 *   de-duplication is scoped to the workspace and not to the founder
 *   (Step 8 finding L4, migration 087).
 *
 *   This suite exists because MemoryDb cannot enforce a unique index. Every
 *   assertion below would pass against MemoryDb whether the index were keyed on
 *   workspace_id, founder_id, or nothing at all — which is precisely why the defect
 *   shipped with a green suite. The subject here IS the constraint, so the test runs
 *   the real migration SQL against a real database.
 *
 *   It also asserts the ON CONFLICT target used by connectionService matches the
 *   index. A conflict target that does not match any index is a runtime error in
 *   Postgres, so the two must be kept in step; asserting it here means a future edit
 *   to one without the other fails loudly.
 *
 * @security Runs only against a disposable local/CI database; pgTestDb refuses
 *   anything that looks hosted.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import { setupTestDb, uniqueIndexes, postgresAvailable, TEST_DATABASE_URL } from './helpers/pgTestDb';

const FOUNDER   = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const WORKSPACE_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

/** The exact conflict target connectionService.executeSync uses. */
const CONFLICT_TARGET = '(workspace_id, provider, signal_type, period_start, period_end)';

let db: Client | null = null;
let available = false;

beforeAll(async () => {
  available = await postgresAvailable();
  if (!available) return;
  db = await setupTestDb();

  await db.query(`INSERT INTO founders (id, email) VALUES ($1, $2)`, [FOUNDER, 'dedup@test.local']);
  await db.query(
    `INSERT INTO workspaces (id, founder_id, name) VALUES ($1,$3,'Workspace A'), ($2,$3,'Workspace B')`,
    [WORKSPACE_A, WORKSPACE_B, FOUNDER],
  );
}, 60_000);

afterAll(async () => { await db?.end(); });

/**
 * Imports one signal exactly the way executeSync does, including the conflict
 * target and ignore-duplicates behaviour.
 *
 * @returns Number of rows actually inserted (0 when the upsert was a no-op)
 */
async function importSignal(workspaceId: string, opts: {
  signalType?: string; periodStart?: string; periodEnd?: string; value?: number;
} = {}): Promise<number> {
  const {
    signalType = 'downloads',
    periodStart = '2026-08-01',
    periodEnd = '2026-08-07',
    value = 100,
  } = opts;

  const res = await db!.query(
    `INSERT INTO intelligence_signals
       (workspace_id, founder_id, provider, signal_type, signal_data, period_start, period_end, trace_id)
     VALUES ($1, $2, 'app_store_connect', $3, $4, $5, $6, 'lm_test')
     ON CONFLICT ${CONFLICT_TARGET} DO NOTHING
     RETURNING id`,
    [workspaceId, FOUNDER, signalType, JSON.stringify({ value }), periodStart, periodEnd],
  );
  return res.rowCount ?? 0;
}

/** @returns How many signals a workspace currently holds. */
async function countFor(workspaceId: string, signalType = 'downloads'): Promise<number> {
  const { rows } = await db!.query(
    `SELECT COUNT(*)::int AS n FROM intelligence_signals WHERE workspace_id = $1 AND signal_type = $2`,
    [workspaceId, signalType],
  );
  return rows[0].n;
}

const maybe = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!available) {
      // Reported loudly rather than silently green: a skipped constraint test is
      // not evidence of a working constraint.
      console.warn(`[SKIPPED — no Postgres at ${TEST_DATABASE_URL}] ${name}`);
      return;
    }
    await fn();
  }, 30_000);

describe('migration 087 — the index itself', () => {
  maybe('replaces the founder-scoped dedup index with a workspace-scoped one', async () => {
    const idx = await uniqueIndexes(db!, 'intelligence_signals');
    expect(idx).toContain('intelligence_signals_workspace_dedup');
    // The old rule must be gone, not merely shadowed: leaving it in place would keep
    // enforcing the cross-workspace collision this migration removes.
    expect(idx).not.toContain('intelligence_signals_dedup');
  });

  maybe('keys the index on workspace_id, not founder_id', async () => {
    const { rows } = await db!.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'intelligence_signals_workspace_dedup'`,
    );
    const def = rows[0].indexdef as string;
    expect(def).toMatch(/workspace_id/);
    expect(def).not.toMatch(/founder_id/);
    // Deliberately NOT partial: Postgres cannot infer a partial index as the
    // ON CONFLICT arbiter, which is what broke the upsert against 078.
    expect(def).not.toMatch(/WHERE/i);
  });

  maybe('is idempotent — re-running the migration changes nothing', async () => {
    const before = await uniqueIndexes(db!, 'intelligence_signals');
    const { readFileSync, readdirSync } = await import('fs');
    const { join } = await import('path');
    const dir = join(__dirname, '..', 'migrations');
    const file = readdirSync(dir).find(f => f.includes('_000087_'))!;
    await db!.query(readFileSync(join(dir, file), 'utf-8'));
    expect(await uniqueIndexes(db!, 'intelligence_signals')).toEqual(before);
  });
});

describe('the same founder, the same provider, two workspaces', () => {
  maybe('keeps BOTH workspaces\' signals — the L4 regression test', async () => {
    // Identical provider, signal_type, period, and founder. Under the old
    // founder-scoped index the second insert was silently swallowed.
    const insertedA = await importSignal(WORKSPACE_A, { value: 111 });
    const insertedB = await importSignal(WORKSPACE_B, { value: 222 });

    expect(insertedA).toBe(1);
    expect(insertedB).toBe(1);

    expect(await countFor(WORKSPACE_A)).toBe(1);
    expect(await countFor(WORKSPACE_B)).toBe(1);

    // And each workspace kept its OWN value, not the other's.
    const { rows } = await db!.query(
      `SELECT workspace_id, signal_data->>'value' AS v FROM intelligence_signals
        WHERE signal_type = 'downloads' ORDER BY workspace_id`,
    );
    const byWorkspace = Object.fromEntries(rows.map((r: { workspace_id: string; v: string }) => [r.workspace_id, r.v]));
    expect(byWorkspace[WORKSPACE_A]).toBe('111');
    expect(byWorkspace[WORKSPACE_B]).toBe('222');
  });

  maybe('retrying workspace A does not duplicate workspace A', async () => {
    const again = await importSignal(WORKSPACE_A, { value: 111 });
    expect(again).toBe(0);                    // upsert was a genuine no-op
    expect(await countFor(WORKSPACE_A)).toBe(1);
    expect(await countFor(WORKSPACE_B)).toBe(1); // and did not disturb B
  });

  maybe('retrying workspace B does not duplicate workspace B', async () => {
    const again = await importSignal(WORKSPACE_B, { value: 222 });
    expect(again).toBe(0);
    expect(await countFor(WORKSPACE_B)).toBe(1);
    expect(await countFor(WORKSPACE_A)).toBe(1);
  });

  maybe('a replay with changed data still does not duplicate the period', async () => {
    // Replay protection is about the period, not the payload: a provider restating
    // the same window must not create a second row.
    const res = await importSignal(WORKSPACE_A, { value: 999 });
    expect(res).toBe(0);
    expect(await countFor(WORKSPACE_A)).toBe(1);
  });

  maybe('a different period is a genuinely new signal', async () => {
    const res = await importSignal(WORKSPACE_A, { periodStart: '2026-08-08', periodEnd: '2026-08-14' });
    expect(res).toBe(1);
    expect(await countFor(WORKSPACE_A)).toBe(2);
  });

  maybe('a different signal_type in the same period is a new signal', async () => {
    const res = await importSignal(WORKSPACE_A, { signalType: 'impressions' });
    expect(res).toBe(1);
    expect(await countFor(WORKSPACE_A, 'impressions')).toBe(1);
  });

  maybe('period-less signals are not deduped (partial index)', async () => {
    for (let i = 0; i < 2; i++) {
      await db!.query(
        `INSERT INTO intelligence_signals
           (workspace_id, founder_id, provider, signal_type, signal_data, period_start, period_end)
         VALUES ($1,$2,'app_store_connect','territory','{}'::jsonb, NULL, NULL)`,
        [WORKSPACE_A, FOUNDER],
      );
    }
    expect(await countFor(WORKSPACE_A, 'territory')).toBe(2);
  });
});

describe('the service and the schema agree', () => {
  maybe('connectionService uses exactly this conflict target', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(join(__dirname, '..', 'src', 'services', 'connectionService.ts'), 'utf-8');

    // A conflict target that names no unique index is a runtime error in Postgres,
    // so drift between these two is a production outage, not a style issue.
    expect(src).toContain("onConflict: 'workspace_id,provider,signal_type,period_start,period_end'");
    expect(src).not.toContain("onConflict: 'founder_id,provider,signal_type,period_start,period_end'");
  });

  maybe('the conflict target the service names is actually enforceable', async () => {
    // Proves Postgres accepts it — i.e. a matching unique index exists.
    await expect(
      db!.query(
        `INSERT INTO intelligence_signals
           (workspace_id, founder_id, provider, signal_type, signal_data, period_start, period_end)
         VALUES ($1,$2,'app_store_connect','conversion','{}'::jsonb,'2026-09-01','2026-09-07')
         ON CONFLICT ${CONFLICT_TARGET} DO NOTHING`,
        [WORKSPACE_A, FOUNDER],
      ),
    ).resolves.toBeTruthy();
  });

  maybe('the OLD founder-scoped conflict target is now rejected by Postgres', async () => {
    // The strongest possible evidence the swap happened: the previous target no
    // longer resolves to any index.
    await expect(
      db!.query(
        `INSERT INTO intelligence_signals
           (workspace_id, founder_id, provider, signal_type, signal_data, period_start, period_end)
         VALUES ($1,$2,'app_store_connect','cac','{}'::jsonb,'2026-09-01','2026-09-07')
         ON CONFLICT (founder_id, provider, signal_type, period_start, period_end) DO NOTHING`,
        [WORKSPACE_A, FOUNDER],
      ),
    ).rejects.toThrow(/no unique or exclusion constraint matching/i);
  });
});
