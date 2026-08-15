/**
 * @file memoryScale.pg.test.ts
 * @description Scale and performance validation — Phase 3.1G §16.
 *
 *   Everything measured so far ran against 33 memories, which tells you almost
 *   nothing about whether the design holds. ADR-066 rule 13 mandates an EXACT
 *   vector scan and rule 14 sets an ANN review trigger; both are claims about
 *   behaviour at size, and neither can be settled at 33 rows.
 *
 *   Synthetic data in a disposable database. No production founder data is used
 *   or copied.
 *
 *   The number that matters is p95 SEMANTIC retrieval, because that is the arm
 *   whose cost grows linearly with corpus size under an exact scan. Lexical is
 *   GIN-indexed and should stay flat.
 *
 * @security Disposable database only; synthetic vectors, no provider calls.
 * @dependencies migrations 035-040, 088-097
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import { setupMemoryTestDb, postgresAvailable } from './helpers/pgTestDb';
import { ANN_REVIEW_THRESHOLDS } from '../src/services/memory/retrievalTypes';

const F = '11111111-1111-4111-8111-111111111111';
const W = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const P = 'cccccccc-1111-4111-8111-cccccccccccc';

/** Narrower than production (1024) to keep the fixture build tractable. */
const DIMS = 64;
const SIZES = [100, 1_000, 5_000, 10_000, 25_000];

let db: Client | null = null;
let available = false;
const results: Array<{ size: number; ftsP50: number; ftsP95: number; vecP50: number; vecP95: number }> = [];

beforeAll(async () => {
  available = await postgresAvailable();
  if (!available) return;
  db = await setupMemoryTestDb('scale');
  await db.query(`INSERT INTO founders (id,email) VALUES ($1,'scale@t.local')`, [F]);
  await db.query(`INSERT INTO workspaces (id,founder_id,name) VALUES ($1,$2,'Scale')`, [W, F]);
  await db.query(`INSERT INTO products (id,founder_id,workspace_id,name) VALUES ($1,$2,$3,'S')`, [P, F, W]);
  await db.query(`DELETE FROM embedding_outbox`);
}, 180_000);

afterAll(async () => {
  if (results.length > 0) {
    // Printed because this is the evidence for the ANN verdict, and a number
    // that only exists inside an assertion is a number nobody can act on.
    process.stdout.write('\n  memories   fts p50   fts p95   vector p50   vector p95\n');
    process.stdout.write('  ' + '-'.repeat(58) + '\n');
    for (const r of results) {
      process.stdout.write(
        `  ${String(r.size).padStart(8)}  ${r.ftsP50.toFixed(1).padStart(8)}  ${r.ftsP95.toFixed(1).padStart(8)}` +
        `  ${r.vecP50.toFixed(1).padStart(11)}  ${r.vecP95.toFixed(1).padStart(11)}\n`);
    }
    process.stdout.write('\n');
  }
  await db?.end();
});

const maybe = (n: string, f: () => Promise<void>, t = 300_000) =>
  it(n, async () => { if (!available) return; await f(); }, t);

function pct(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.max(0, Math.ceil(p / 100 * s.length) - 1)] : 0;
}

/** A deterministic pseudo-vector; no provider involved. */
function vec(seed: number): string {
  const v: number[] = [];
  for (let i = 0; i < DIMS; i++) v.push(Math.sin(seed * 0.37 + i * 1.13));
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return `[${v.map(x => (x / norm).toFixed(6)).join(',')}]`;
}

const CHANNELS = ['search', 'meta', 'email', 'organic'];
const SEGMENTS = ['smb', 'enterprise', 'consumer'];

/** Grows the corpus to `target` rows, with vectors, in batches. */
async function growTo(target: number): Promise<void> {
  const current = Number((await db!.query(`SELECT count(*)::int n FROM marketing_memories`)).rows[0].n);
  if (current >= target) return;

  const BATCH = 500;
  for (let start = current; start < target; start += BATCH) {
    const n = Math.min(BATCH, target - start);
    const memValues: string[] = [];
    const params: unknown[] = [];
    let p = 0;
    for (let i = 0; i < n; i++) {
      const idx = start + i;
      const title = `Memory ${idx}: ${CHANNELS[idx % 4]} conversion ${idx % 2 ? 'increased' : 'decreased'} for ${SEGMENTS[idx % 3]}`;
      memValues.push(`($${++p},$${++p},$${++p},'campaign',$${++p},$${++p}::jsonb,'campaign_performance',0.7,'active',1)`);
      params.push(F, W, P, title, JSON.stringify({
        claim: `Observed ${CHANNELS[idx % 4]} performance change in period ${idx % 12}.`,
        channel: CHANNELS[idx % 4], segment: SEGMENTS[idx % 3],
      }));
    }
    const inserted = await db!.query(
      `INSERT INTO marketing_memories (founder_id, workspace_id, product_id, memory_type, title, content, source, confidence, status, version)
       VALUES ${memValues.join(',')} RETURNING id`, params);

    const embValues: string[] = [];
    const embParams: unknown[] = [];
    let q = 0;
    inserted.rows.forEach((row, i) => {
      embValues.push(`($${++q},'marketing_memory',$${++q},'test','m1',${DIMS},1,1,$${++q},$${++q}::vector,'current')`);
      embParams.push(W, row.id, 'a'.repeat(64), vec(start + i));
    });
    await db!.query(
      `INSERT INTO memory_embeddings (workspace_id, source_type, source_id, embedding_provider,
         embedding_model, dimensions, embedding_version, rendering_version, content_hash, embedding, status)
       VALUES ${embValues.join(',')}`, embParams);
  }
  // The enqueue trigger fires per row; clear so the outbox does not dominate.
  await db!.query(`DELETE FROM embedding_outbox`);
}

async function measure(size: number): Promise<void> {
  const QUERIES = ['search conversion increased', 'meta performance enterprise',
                   'email conversion smb', 'organic decreased consumer'];
  const fts: number[] = [], sem: number[] = [];

  for (let i = 0; i < 20; i++) {
    const q = QUERIES[i % QUERIES.length];
    let t = Date.now();
    await db!.query(`SELECT * FROM lm_search_memory_fulltext($1,$2,NULL,NULL,ARRAY['active'],25)`, [W, q]);
    fts.push(Date.now() - t);

    t = Date.now();
    await db!.query(
      `SELECT * FROM lm_search_memory_embeddings($1,$2::vector,'m1',1,${DIMS},25)`, [W, vec(i * 977)]);
    sem.push(Date.now() - t);
  }

  results.push({ size, ftsP50: pct(fts, 50), ftsP95: pct(fts, 95), vecP50: pct(sem, 50), vecP95: pct(sem, 95) });
}

describe('scale — retrieval at workspace sizes', () => {
  for (const size of SIZES) {
    maybe(`${size.toLocaleString()} memories`, async () => {
      await growTo(size);
      const n = Number((await db!.query(`SELECT count(*)::int n FROM marketing_memories`)).rows[0].n);
      expect(n).toBeGreaterThanOrEqual(size);
      await measure(size);
      const r = results[results.length - 1];
      // Not an assertion on speed — the point is to RECORD it. A hard latency
      // assertion here would fail on a loaded CI box and tell nobody anything.
      expect(r.vecP95).toBeGreaterThanOrEqual(0);
    }, 600_000);
  }

  maybe('ANN review threshold verdict (ADR-066 rule 14)', async () => {
    const { rows } = await db!.query(
      `SELECT count(*)::int n FROM memory_embeddings WHERE workspace_id=$1 AND status='current'`, [W]);
    const vectors = rows[0].n;
    const worst = results.length ? results[results.length - 1] : { vecP95: 0, size: 0 };

    // Amendment 3: volume is informational, LATENCY is the trigger.
    const volumeWarn = vectors > ANN_REVIEW_THRESHOLDS.vectorRowsWarnOnly;
    const byLatency  = worst.vecP95 > ANN_REVIEW_THRESHOLDS.semanticP95Ms;

    process.stdout.write(
      `\n  ANN REVIEW: vectors=${vectors} (informational warn >${ANN_REVIEW_THRESHOLDS.vectorRowsWarnOnly}? ${volumeWarn})` +
      `  semantic p95=${worst.vecP95}ms (TRIGGER >${ANN_REVIEW_THRESHOLDS.semanticP95Ms}ms? ${byLatency})` +
      `\n  VERDICT: ${byLatency ? 'ANN_REVIEW_REQUIRED' : 'exact scan adequate — no ANN needed'}\n\n`);
    expect(byLatency, 'exact scan should remain well under the latency trigger').toBe(false);

    // The threshold is SURFACED, never acted on — no index is created here.
    const ann = await db!.query(
      `SELECT indexdef FROM pg_indexes WHERE tablename='memory_embeddings'`);
    expect(ann.rows.filter(r => /USING (hnsw|ivfflat)/i.test(r.indexdef))).toEqual([]);
    expect(typeof volumeWarn).toBe('boolean');
  }, 120_000);

  maybe('lexical retrieval stays flat as the corpus grows (GIN index working)', async () => {
    // If FTS p95 grew linearly with corpus size the index would not be in use,
    // which is the failure this catches.
    if (results.length < 2) return;
    const first = results[0], last = results[results.length - 1];
    const sizeRatio = last.size / first.size;
    const latencyRatio = last.ftsP95 / Math.max(first.ftsP95, 1);
    process.stdout.write(`\n  FTS scaling: ${sizeRatio}× data → ${latencyRatio.toFixed(1)}× p95 latency\n`);
    expect(latencyRatio).toBeLessThan(sizeRatio);   // sublinear
  });
});
