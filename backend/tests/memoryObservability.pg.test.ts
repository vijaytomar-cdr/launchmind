/**
 * @file memoryObservability.pg.test.ts
 * @description Observability counters and end-to-end traceability — Phase 3.1G §8.
 *
 *   A counter that is never observed to MOVE is not observability. Every
 *   assertion here triggers a real event and then proves the corresponding
 *   number changed, rather than checking that a field exists.
 *
 *   The trace-chain test is the one that matters operationally. When an owner
 *   asks "why is this belief not being retrieved?", the answer has to be
 *   reachable by following identifiers from the canonical row to the queued
 *   work to the vector. If any link is unqueryable, that question can only be
 *   answered by guessing.
 *
 * @security Disposable database, synthetic data, no provider calls.
 * @dependencies migrations 088-098
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import { setupMemoryTestDb, postgresAvailable } from './helpers/pgTestDb';

const F = '44444444-4444-4444-8444-444444444444';
const W = 'dddddddd-4444-4444-8444-dddddddddddd';
const P = 'ffffffff-4444-4444-8444-ffffffffffff';

let db: Client | null = null;
let available = false;

beforeAll(async () => {
  available = await postgresAvailable();
  if (!available) return;
  db = await setupMemoryTestDb('observability');
  await db.query(`INSERT INTO founders (id,email) VALUES ($1,'obs@t.local')`, [F]);
  await db.query(`INSERT INTO workspaces (id,founder_id,name) VALUES ($1,$2,'Obs')`, [W, F]);
  await db.query(`INSERT INTO products (id,founder_id,workspace_id,name) VALUES ($1,$2,$3,'O')`, [P, F, W]);
}, 180_000);

afterAll(async () => { await db?.end(); });

const maybe = (n: string, f: () => Promise<void>, t = 120_000) =>
  it(n, async () => { if (!available) return; await f(); }, t);

async function stats(): Promise<Record<string, number>> {
  const { rows } = await db!.query(`SELECT * FROM embedding_pipeline_stats`);
  return Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, Number(v)]));
}

async function stuck(): Promise<Record<string, number>> {
  const { rows } = await db!.query(`SELECT * FROM embedding_stuck_jobs`);
  return Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, Number(v)]));
}

async function newMemory(title: string): Promise<string> {
  const { rows } = await db!.query(
    `INSERT INTO marketing_memories (founder_id, workspace_id, product_id, memory_type, title, content,
       source, confidence, status, version)
     VALUES ($1,$2,$3,'campaign',$4,$5::jsonb,'campaign_performance',0.7,'active',1) RETURNING id`,
    [F, W, P, title, JSON.stringify({ claim: title })]);
  return rows[0].id;
}

function hex(seed: string): string {
  let h = '';
  for (let i = 0; i < 64; i++) h += '0123456789abcdef'[(seed.charCodeAt(i % seed.length) + i * 5) % 16];
  return h;
}

function vec(seed: number, dims = 64): string {
  const v: number[] = [];
  for (let i = 0; i < dims; i++) v.push(Math.sin(seed * 0.29 + i * 0.91));
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return `[${v.map(x => (x / n).toFixed(6)).join(',')}]`;
}

describe('§8 counters move on real events', () => {
  maybe('creating a belief increments pending work', async () => {
    await db!.query(`DELETE FROM embedding_outbox`);
    const before = await stats();
    await newMemory('Counter subject one');
    const after = await stats();
    expect(after.pending_jobs).toBe(before.pending_jobs + 1);
  });

  maybe('claiming moves the job from pending to processing', async () => {
    await db!.query(`DELETE FROM embedding_outbox`);
    await newMemory('Counter subject two');
    const before = await stats();
    await db!.query(`SELECT * FROM lm_claim_embedding_work('obs-worker', 10, 300)`);
    const after = await stats();
    expect(after.pending_jobs).toBe(before.pending_jobs - 1);
    expect(after.processing_jobs).toBe(before.processing_jobs + 1);
  });

  maybe('a failed job is counted as failed, not silently dropped', async () => {
    await db!.query(`DELETE FROM embedding_outbox`);
    await newMemory('Counter subject three');
    const claimed = await db!.query(`SELECT * FROM lm_claim_embedding_work('obs-worker', 1, 300)`);
    await db!.query(`UPDATE embedding_outbox SET status='failed' WHERE id=$1`, [claimed.rows[0].id]);
    const after = await stats();
    expect(after.failed_jobs).toBe(1);
    // The distinction that matters: a dropped job leaves every counter at zero
    // and looks exactly like an idle pipeline.
    expect(after.pending_jobs + after.processing_jobs).toBe(0);
  });

  maybe('vector counts move when a vector is written and when it goes stale', async () => {
    const m = await newMemory('Counter subject four');
    const before = await stats();
    await db!.query(
      `INSERT INTO memory_embeddings (workspace_id, source_type, source_id, embedding_provider,
         embedding_model, dimensions, embedding_version, rendering_version, content_hash, embedding, status)
       VALUES ($1,'marketing_memory',$2,'test','m',64,1,1,$3,$4::vector,'current')`,
      [W, m, hex('four'), vec(4)]);
    const mid = await stats();
    expect(mid.current_embeddings).toBe(before.current_embeddings + 1);

    await db!.query(`UPDATE memory_embeddings SET status='stale' WHERE source_id=$1`, [m]);
    const after = await stats();
    expect(after.stale_embeddings).toBe(mid.stale_embeddings + 1);
    expect(after.current_embeddings).toBe(mid.current_embeddings - 1);
  });

  maybe('queue age reports the OLDEST waiting job, not the average', async () => {
    // An average hides one stuck job behind many fast ones, which is the exact
    // case an operator needs to see.
    await db!.query(`DELETE FROM embedding_outbox`);
    await newMemory('Old job');
    await db!.query(`UPDATE embedding_outbox SET created_at = now() - interval '2 hours'`);
    await newMemory('New job');

    const s = await stats();
    expect(s.queue_age_seconds).toBeGreaterThan(3_600);   // sees the 2-hour-old one
    expect(s.pending_jobs).toBe(2);
  });

  maybe('a crashed worker becomes visible as reclaimable, distinct from healthy in-flight work', async () => {
    await db!.query(`DELETE FROM embedding_outbox`);
    await newMemory('Crash visibility subject');
    await db!.query(`SELECT * FROM lm_claim_embedding_work('doomed', 10, 1)`);

    const inFlight = await stuck();
    expect(inFlight.in_flight_jobs).toBe(1);
    expect(inFlight.reclaimable_jobs).toBe(0);

    await new Promise(r => setTimeout(r, 1_200));

    const expired = await stuck();
    expect(expired.reclaimable_jobs).toBe(1);
    expect(expired.in_flight_jobs).toBe(0);
  });

  maybe('a job retried after a crash is distinguishable from a first attempt', async () => {
    await db!.query(`DELETE FROM embedding_outbox`);
    await newMemory('Retry visibility subject');
    await db!.query(`SELECT * FROM lm_claim_embedding_work('doomed', 10, 1)`);
    await new Promise(r => setTimeout(r, 1_200));
    await db!.query(`SELECT * FROM lm_claim_embedding_work('rescuer', 10, 300)`);

    const s = await stuck();
    expect(s.retried_after_crash).toBe(1);
    expect(s.max_attempts_in_flight).toBe(2);
  });
});

describe('§8 end-to-end trace chain', () => {
  maybe('one belief is followable from canonical row to queued work to vector', async () => {
    await db!.query(`DELETE FROM embedding_outbox`);
    const id = await newMemory('Traceable belief about search performance');

    // 1. canonical
    const canonical = await db!.query(
      `SELECT id, workspace_id, title, version, status FROM marketing_memories WHERE id=$1`, [id]);
    expect(canonical.rows).toHaveLength(1);

    // 2. queued work, linked by the SAME id — not by a title match, which would
    //    break the moment two beliefs share wording.
    const job = await db!.query(
      `SELECT id, source_type, source_id, workspace_id, status, requested_model, requested_dimensions
         FROM embedding_outbox WHERE source_id=$1`, [id]);
    expect(job.rows).toHaveLength(1);
    expect(job.rows[0].source_type).toBe('marketing_memory');
    expect(job.rows[0].workspace_id).toBe(canonical.rows[0].workspace_id);

    // 3. the vector the job produces, carrying its own provenance
    await db!.query(
      `INSERT INTO memory_embeddings (workspace_id, source_type, source_id, embedding_provider,
         embedding_model, dimensions, embedding_version, rendering_version, content_hash, embedding, status)
       VALUES ($1,'marketing_memory',$2,'test',$3,$4,1,1,$5,$6::vector,'current')`,
      [W, id, job.rows[0].requested_model, job.rows[0].requested_dimensions, hex('trace'),
       vec(7, Number(job.rows[0].requested_dimensions))]);

    const vector = await db!.query(
      `SELECT source_id, embedding_model, dimensions, content_hash, status
         FROM memory_embeddings WHERE source_id=$1`, [id]);
    expect(vector.rows).toHaveLength(1);
    // The vector was built to the contract the job asked for. A mismatch here is
    // how a model migration silently half-completes.
    expect(vector.rows[0].embedding_model).toBe(job.rows[0].requested_model);
    expect(Number(vector.rows[0].dimensions)).toBe(Number(job.rows[0].requested_dimensions));

    // 4. and the whole chain resolves in ONE query, which is what makes the
    //    operational question answerable rather than investigable.
    const chain = await db!.query(
      `SELECT m.id AS memory_id, m.title, m.version,
              o.status AS job_status, o.attempt_count,
              e.embedding_model, e.status AS vector_status, e.content_hash
         FROM marketing_memories m
         LEFT JOIN embedding_outbox   o ON o.source_id = m.id AND o.source_type = 'marketing_memory'
         LEFT JOIN memory_embeddings  e ON e.source_id = m.id AND e.source_type = 'marketing_memory'
        WHERE m.id = $1`, [id]);
    expect(chain.rows).toHaveLength(1);
    expect(chain.rows[0].memory_id).toBe(id);
    expect(chain.rows[0].job_status).toBe('pending');
    expect(chain.rows[0].vector_status).toBe('current');
  });

  maybe('a belief with NO vector is identifiable — the silent failure is queryable', async () => {
    // This is the state that degrades retrieval invisibly: the belief exists,
    // answers lexically, and never appears in a semantic result.
    const orphan = await newMemory('Belief that never got embedded');
    const { rows } = await db!.query(
      `SELECT m.id FROM marketing_memories m
        WHERE m.workspace_id=$1 AND m.status='active'
          AND NOT EXISTS (SELECT 1 FROM memory_embeddings e
                           WHERE e.source_id=m.id AND e.source_type='marketing_memory'
                             AND e.status='current')`, [W]);
    expect(rows.map(r => r.id)).toContain(orphan);
  });
});

describe('§8/§9 no leakage through observability surfaces', () => {
  maybe('the stats view exposes counts only — no titles, claims, vectors or hashes', async () => {
    await newMemory('Extremely secret positioning claim about pricing');
    const { rows, fields } = await db!.query(`SELECT * FROM embedding_pipeline_stats`);
    const names = fields.map(f => f.name);
    // `stale_embeddings` / `current_embeddings` are COUNTS of embeddings, which is
    // exactly what this surface should expose. The check is that no column
    // carries text or a vector, not that the word never appears.
    for (const forbidden of ['title', 'content', 'claim', 'content_hash', 'text', 'query']) {
      expect(names.join(','), `stats must not expose ${forbidden}`).not.toContain(forbidden);
    }
    expect(names.every(n => /_jobs$|_seconds$|_embeddings$/.test(n)),
      `every stats column must be a count or an age, got: ${names.join(',')}`).toBe(true);
    // Every value is a number: prose cannot hide in a count.
    for (const v of Object.values(rows[0])) expect(Number.isNaN(Number(v))).toBe(false);
  });

  maybe('the stuck-jobs view is counts only as well', async () => {
    const { rows, fields } = await db!.query(`SELECT * FROM embedding_stuck_jobs`);
    expect(fields.every(f => /jobs|attempts|crash/.test(f.name))).toBe(true);
    for (const v of Object.values(rows[0])) expect(Number.isNaN(Number(v))).toBe(false);
  });

  maybe('the outbox itself never stores the text it is queueing', async () => {
    // The job names a record; it does not carry the record. Otherwise every
    // queue dump, log line and error report becomes a copy of the corpus.
    await db!.query(`DELETE FROM embedding_outbox`);
    const secret = 'Founder said the acquisition price is confidential';
    await newMemory(secret);
    const { rows, fields } = await db!.query(`SELECT * FROM embedding_outbox`);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('acquisition price');
    expect(fields.map(f => f.name)).not.toContain('content');
  });
});
