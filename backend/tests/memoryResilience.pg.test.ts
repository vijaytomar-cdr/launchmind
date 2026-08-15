/**
 * @file memoryResilience.pg.test.ts
 * @description Model-migration and queue/process failure drills — Phase 3.1G §5 and §7.
 *
 *   Deliberately narrow. `embeddingProvider.test.ts` already proves per-failure-kind
 *   HTTP mapping, `embeddingPipeline.test.ts` proves job idempotency and retry
 *   classification, and `embeddingOutbox.pg.test.ts` proves atomic enqueue. Re-testing
 *   those here would pad a count without adding certainty.
 *
 *   What NOTHING covered before this file:
 *
 *   §5 MODEL MIGRATION. Changing the embedding model is the single most dangerous
 *   routine operation in this design, because vectors from two models are not
 *   comparable and nothing in Postgres stops you comparing them. The column is
 *   deliberately dimension-less, so a 1024-d and a 512-d vector coexist happily
 *   and a careless query either raises `different vector dimensions` mid-request
 *   or — far worse, if widths happen to match — returns confidently wrong
 *   neighbours. These tests prove the model/version/dimension triple is a hard
 *   filter, not a hint.
 *
 *   §7 CRASH AND REPLAY. A worker that dies holding a claimed job must not strand
 *   that job forever, and a job redelivered after a crash must not produce a
 *   second vector. The lease (visibility timeout) is the mechanism; nothing
 *   asserted it.
 *
 *   Real Postgres, because every mechanism under test is a trigger, a lease, or a
 *   partial index. A mocked client would assert the mock.
 *
 * @security Disposable database, synthetic vectors, no provider calls, no founder data.
 * @dependencies migrations 088-097
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import { setupMemoryTestDb, postgresAvailable } from './helpers/pgTestDb';

const F = '22222222-2222-4222-8222-222222222222';
const W = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const P = 'dddddddd-2222-4222-8222-dddddddddddd';

let db: Client | null = null;
let available = false;

/** Unit-norm deterministic vector of the requested width. */
function vec(seed: number, dims: number): string {
  const v: number[] = [];
  for (let i = 0; i < dims; i++) v.push(Math.sin(seed * 0.31 + i * 0.77));
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return `[${v.map(x => (x / n).toFixed(6)).join(',')}]`;
}

beforeAll(async () => {
  available = await postgresAvailable();
  if (!available) return;
  db = await setupMemoryTestDb('resilience');
  await db.query(`INSERT INTO founders (id,email) VALUES ($1,'res@t.local')`, [F]);
  await db.query(`INSERT INTO workspaces (id,founder_id,name) VALUES ($1,$2,'Res')`, [W, F]);
  await db.query(`INSERT INTO products (id,founder_id,workspace_id,name) VALUES ($1,$2,$3,'R')`, [P, F, W]);
}, 180_000);

afterAll(async () => { await db?.end(); });

const maybe = (n: string, f: () => Promise<void>, t = 120_000) =>
  it(n, async () => { if (!available) return; await f(); }, t);

/** 64 lowercase hex chars — the shape the content_hash CHECK requires. */
function hash(seed: number, model: string): string {
  let h = '';
  const src = `${model}:${seed}`;
  for (let i = 0; i < 64; i++) h += '0123456789abcdef'[(src.charCodeAt(i % src.length) + i * 7) % 16];
  return h;
}

/**
 * @param clearOutbox Set false when the test is ABOUT the outbox — the enqueue
 *   trigger fires on insert, and clearing it would delete the row under test.
 */
async function newMemory(title: string, clearOutbox = true): Promise<string> {
  const { rows } = await db!.query(
    `INSERT INTO marketing_memories (founder_id, workspace_id, product_id, memory_type, title, content,
       source, confidence, status, version)
     VALUES ($1,$2,$3,'campaign',$4,$5::jsonb,'campaign_performance',0.7,'active',1) RETURNING id`,
    [F, W, P, title, JSON.stringify({ claim: title })]);
  if (clearOutbox) await db!.query(`DELETE FROM embedding_outbox`);
  return rows[0].id;
}

async function addVector(memoryId: string, model: string, version: number, dims: number,
                         seed: number, status = 'current'): Promise<void> {
  await db!.query(
    `INSERT INTO memory_embeddings (workspace_id, source_type, source_id, embedding_provider,
       embedding_model, dimensions, embedding_version, rendering_version, content_hash, embedding, status)
     VALUES ($1,'marketing_memory',$2,'test',$3,$4,$5,1,$6,$7::vector,$8)`,
    [W, memoryId, model, dims, version, hash(seed, model), vec(seed, dims), status]);
}

// ── §5 Model migration ───────────────────────────────────────────────────────
describe('§5 embedding model migration', () => {
  maybe('two models coexist without corrupting each other, and search returns ONLY the asked-for model', async () => {
    const m = await newMemory('Search converts better than Meta');
    await addVector(m, 'model-old', 1, 64, 11);
    await addVector(m, 'model-new', 2, 128, 22);

    const oldHits = await db!.query(
      `SELECT * FROM lm_search_memory_embeddings($1,$2::vector,'model-old',1,64,10)`, [W, vec(11, 64)]);
    const newHits = await db!.query(
      `SELECT * FROM lm_search_memory_embeddings($1,$2::vector,'model-new',2,128,10)`, [W, vec(22, 128)]);

    expect(oldHits.rows).toHaveLength(1);
    expect(newHits.rows).toHaveLength(1);
    // Distances near zero: each query found its OWN model's vector, not the other's.
    expect(Number(oldHits.rows[0].distance)).toBeLessThan(0.01);
    expect(Number(newHits.rows[0].distance)).toBeLessThan(0.01);
  });

  maybe('a query for a model that has no vectors returns nothing rather than falling back', async () => {
    // The dangerous alternative is a search that quietly drops the model filter
    // and answers from whatever vectors exist. Empty is the correct answer.
    const { rows } = await db!.query(
      `SELECT * FROM lm_search_memory_embeddings($1,$2::vector,'model-absent',9,64,10)`, [W, vec(11, 64)]);
    expect(rows).toEqual([]);
  });

  maybe('a width that disagrees with the stored vectors returns nothing — the comparison never happens', async () => {
    // PREDICTION CORRECTED BY MEASUREMENT. I expected pgvector to raise
    // `different vector dimensions`, because an unfiltered distance between a
    // 64-d and a 128-d vector does exactly that. It does not, and the reason is
    // better than the prediction: `p_dimensions` is applied as a filter BEFORE
    // any distance is computed, so mismatched rows are excluded rather than
    // compared. Empty is the correct and safer outcome — no error to swallow and
    // no meaningless neighbour to rank.
    const { rows } = await db!.query(
      `SELECT * FROM lm_search_memory_embeddings($1,$2::vector,'model-old',1,128,10)`, [W, vec(11, 128)]);
    expect(rows).toEqual([]);

    // The raw danger is real when the filter is bypassed, which is why it exists:
    await expect(
      db!.query(`SELECT embedding <=> $1::vector FROM memory_embeddings
                  WHERE source_type='marketing_memory' AND embedding_model='model-old' AND dimensions=64`,
                [vec(11, 128)]),
    ).rejects.toThrow(/different vector dimensions/i);
  });

  maybe('the version discriminates two generations of the SAME model name', async () => {
    // A provider can change a model's behaviour without changing its name. The
    // version column is what makes that survivable.
    const m = await newMemory('Paid social produces lower-quality signups');
    await addVector(m, 'same-name', 1, 64, 31);
    await addVector(m, 'same-name', 2, 64, 77);

    const v1 = await db!.query(`SELECT * FROM lm_search_memory_embeddings($1,$2::vector,'same-name',1,64,10)`, [W, vec(31, 64)]);
    const v2 = await db!.query(`SELECT * FROM lm_search_memory_embeddings($1,$2::vector,'same-name',2,64,10)`, [W, vec(31, 64)]);
    expect(v1.rows).toHaveLength(1);
    expect(Number(v1.rows[0].distance)).toBeLessThan(0.01);
    // Same query vector, other generation: found, but NOT a near-duplicate.
    expect(Number(v2.rows[0].distance)).toBeGreaterThan(0.1);
  });

  maybe('migration never touches canonical memory — vectors are derived (ADR-066 invariant 2)', async () => {
    const m = await newMemory('Outcome-led messaging increased conversion');
    const before = await db!.query(
      `SELECT title, content, version, confidence, status, updated_at FROM marketing_memories WHERE id=$1`, [m]);

    await addVector(m, 'migrate-a', 1, 64, 41);
    await db!.query(`DELETE FROM memory_embeddings WHERE source_id=$1 AND embedding_model='migrate-a'`, [m]);
    await addVector(m, 'migrate-b', 1, 128, 42);

    const after = await db!.query(
      `SELECT title, content, version, confidence, status, updated_at FROM marketing_memories WHERE id=$1`, [m]);
    expect(after.rows[0]).toEqual(before.rows[0]);

    // And the belief survived the vector being deleted entirely — which is the
    // point of "Postgres is authoritative".
    expect(after.rows[0].title).toBe('Outcome-led messaging increased conversion');
  });

  maybe('deleting the canonical record removes its derived vectors, not the other way round', async () => {
    const m = await newMemory('Temporary belief for cascade check');
    await addVector(m, 'cascade', 1, 64, 51);
    await db!.query(`DELETE FROM marketing_memories WHERE id=$1`, [m]);
    const { rows } = await db!.query(`SELECT id FROM memory_embeddings WHERE source_id=$1`, [m]);
    expect(rows).toEqual([]);
  });

  maybe('a half-finished migration is resumable — un-migrated records are identifiable', async () => {
    // The operational question during a migration is "what is left?". If that
    // cannot be answered by query, the migration cannot be safely resumed.
    const a = await newMemory('Migration target A');
    const b = await newMemory('Migration target B');
    await addVector(a, 'target-model', 3, 64, 61);
    // b intentionally left un-migrated.

    const { rows } = await db!.query(
      `SELECT m.id FROM marketing_memories m
        WHERE m.workspace_id = $1
          AND m.id IN ($2,$3)
          AND NOT EXISTS (
            SELECT 1 FROM memory_embeddings e
             WHERE e.source_id = m.id AND e.source_type = 'marketing_memory'
               AND e.embedding_model = 'target-model' AND e.embedding_version = 3
               AND e.status = 'current')`, [W, a, b]);
    expect(rows.map(r => r.id)).toEqual([b]);
  });
});

// ── §7 Queue and process failure ─────────────────────────────────────────────
describe('§7 queue and process failure', () => {
  maybe('a worker that dies holding a job does not strand it — the lease expires', async () => {
    await db!.query(`DELETE FROM embedding_outbox`);
    await newMemory('Lease expiry subject', false);   // trigger enqueues

    // Claim with a 1-second lease, then never report back: the crash.
    const claimed = await db!.query(`SELECT * FROM lm_claim_embedding_work('worker-that-dies', 10, 1)`);
    expect(claimed.rows).toHaveLength(1);
    expect(claimed.rows[0].status).toBe('processing');

    // Immediately after the crash the job is invisible — no double-processing.
    const during = await db!.query(`SELECT * FROM lm_claim_embedding_work('worker-b', 10, 300)`);
    expect(during.rows).toHaveLength(0);

    await new Promise(r => setTimeout(r, 1_200));

    // After the lease expires another worker may take it: work is not lost.
    const after = await db!.query(`SELECT * FROM lm_claim_embedding_work('worker-b', 10, 300)`);
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0].locked_by).toBe('worker-b');
    // Attempts accumulate across the crash, so a job that keeps killing workers
    // eventually dies instead of cycling forever.
    expect(Number(after.rows[0].attempt_count)).toBe(2);
  });

  maybe('two workers polling concurrently never claim the same job', async () => {
    await db!.query(`DELETE FROM embedding_outbox`);
    for (let i = 0; i < 6; i++) await newMemory(`Concurrency subject ${i}`, false);

    const [a, b] = await Promise.all([
      db!.query(`SELECT * FROM lm_claim_embedding_work('w-a', 6, 300)`),
      db!.query(`SELECT * FROM lm_claim_embedding_work('w-b', 6, 300)`),
    ]);
    const A = a.rows.map(r => r.id), B = b.rows.map(r => r.id);
    expect(A.filter(x => B.includes(x))).toEqual([]);     // disjoint
    expect(A.length + B.length).toBe(6);                   // and complete
  });

  maybe('redelivery after a crash produces ONE vector, not two', async () => {
    // The crash window that matters: the provider answered and the vector was
    // written, but the job was never acknowledged, so it is delivered again.
    const m = await newMemory('Redelivery subject');
    await addVector(m, 'redeliver', 1, 64, 71);

    // Second delivery writes the same (source, model, version, rendering) family.
    await expect(addVector(m, 'redeliver', 1, 64, 71)).rejects.toThrow();

    const { rows } = await db!.query(
      `SELECT count(*)::int n FROM memory_embeddings
        WHERE source_id=$1 AND embedding_model='redeliver' AND status='current'`, [m]);
    expect(rows[0].n).toBe(1);
  });

  maybe('work enqueued while the queue consumer is down survives in Postgres', async () => {
    // Redis being unavailable is indistinguishable here from "no worker is
    // polling". The outbox is the authority; the queue is only a doorbell. If
    // enqueue depended on Redis, this work would be silently lost.
    await db!.query(`DELETE FROM embedding_outbox`);
    const m = await newMemory('Enqueued while consumer down', false);

    const { rows } = await db!.query(
      `SELECT status, source_id FROM embedding_outbox WHERE source_id=$1`, [m]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');

    // And it is still claimable once a consumer returns.
    const claimed = await db!.query(`SELECT * FROM lm_claim_embedding_work('recovered-worker', 10, 300)`);
    expect(claimed.rows.map(r => r.source_id)).toContain(m);
  });

  maybe('the backlog is visible to an operator, not just to the worker', async () => {
    await db!.query(`DELETE FROM embedding_outbox`);
    await newMemory('Backlog visibility subject', false);
    const { rows } = await db!.query(`SELECT * FROM embedding_pipeline_stats`);
    expect(Number(rows[0].pending_jobs)).toBeGreaterThanOrEqual(1);
    // The age of the OLDEST waiting job is what says "the pipeline has stopped";
    // an average would hide one stuck job behind many fast ones.
    expect(rows[0]).toHaveProperty('queue_age_seconds');
  });

  maybe('queued work OUTLIVES its deleted source, and is stopped when processed rather than when queued', async () => {
    // PREDICTION CORRECTED BY MEASUREMENT. I expected migration 092's deletion
    // trigger to clear queued work too. It does not: 092 sweeps derived VECTORS
    // (memory_embeddings), which is what would otherwise be unreachable garbage.
    // The outbox row survives.
    //
    // That is defensible rather than a bug — the job is cancelled with
    // SOURCE_MISSING when a worker picks it up (proved in
    // embeddingPipeline.test.ts) — but it is worth asserting explicitly, because
    // "the queue drains itself on delete" is the natural assumption and it is
    // wrong. A large deletion leaves a matching pile of jobs that resolve to
    // cancelled, which an operator watching pending_jobs should expect.
    await db!.query(`DELETE FROM embedding_outbox`);
    const m = await newMemory('Vanishing subject', false);
    expect((await db!.query(`SELECT id FROM embedding_outbox WHERE source_id=$1`, [m])).rows).toHaveLength(1);

    await db!.query(`DELETE FROM marketing_memories WHERE id=$1`, [m]);

    // Vectors are swept immediately…
    expect((await db!.query(`SELECT id FROM memory_embeddings WHERE source_id=$1`, [m])).rows).toHaveLength(0);
    // …the queued job is not, and remains claimable.
    expect((await db!.query(`SELECT id FROM embedding_outbox WHERE source_id=$1`, [m])).rows).toHaveLength(1);
  });

  maybe('an orphan vector is prevented by the pipeline, NOT by the schema — recorded honestly', async () => {
    // PREDICTION CORRECTED BY MEASUREMENT. I expected a foreign key to refuse a
    // vector whose canonical record is gone. There is no such key and there
    // cannot be: memory_embeddings.source_id is POLYMORPHIC (source_type selects
    // the table), and Postgres has no polymorphic foreign key.
    //
    // So the guarantee is real but it lives one layer up: the pipeline checks
    // the source exists and cancels with SOURCE_MISSING
    // (embeddingPipeline.test.ts), and migration 092's deletion triggers sweep
    // derived vectors. Writing this down matters because someone reading the
    // schema alone would reasonably assume the database enforces it.
    const ghost = '00000000-0000-4000-8000-00000000dead';
    await addVector(ghost, 'orphan-possible', 1, 64, 91);
    const { rows } = await db!.query(
      `SELECT count(*)::int n FROM memory_embeddings WHERE source_id=$1`, [ghost]);
    expect(rows[0].n).toBe(1);      // the schema permits it
    await db!.query(`DELETE FROM memory_embeddings WHERE source_id=$1`, [ghost]);
  });
});
