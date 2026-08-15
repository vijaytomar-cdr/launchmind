/**
 * @file embeddingOutbox.pg.test.ts
 * @description Proves the transactional outbox (migration 093) against a REAL
 *   PostgreSQL.
 *
 *   The subject here is the ATOMICITY GUARANTEE, and it cannot be tested any
 *   other way. A mock can be made to show a memory and a job appearing together;
 *   only a real database can show that they appear together because they are in
 *   the same transaction, and that a rolled-back memory takes its job with it.
 *
 * @security Disposable database only (pgTestDb refuses anything hosted).
 * @dependencies migrations 035-040 + 088-093
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Client } from 'pg';
import { setupMemoryTestDb, postgresAvailable } from './helpers/pgTestDb';

const FOUNDER_A = '11111111-1111-4111-8111-111111111111';
const FOUNDER_B = '22222222-2222-4222-8222-222222222222';
const WS_A      = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const WS_B      = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const PROD_A    = 'cccccccc-1111-4111-8111-cccccccccccc';
const SHA       = 'a'.repeat(64);

let db: Client | null = null;
let available = false;

beforeAll(async () => {
  available = await postgresAvailable();
  if (!available) return;
  db = await setupMemoryTestDb('outbox');
  // 093 ships with generation OFF. These tests exercise the durable intent
  // layer, which must work regardless of whether a provider is configured.
  await db.query(`UPDATE embedding_contract SET provider='test', model='m1', dimensions=8 WHERE id=1`);
}, 120_000);

afterAll(async () => { await db?.end(); });

beforeEach(async () => {
  if (!db) return;
  await db.query(`
    SET session_replication_role = replica;
    DELETE FROM embedding_outbox; DELETE FROM memory_embeddings;
    DELETE FROM evidence; DELETE FROM marketing_memory_versions;
    DELETE FROM marketing_memories; DELETE FROM playbook_signals;
    DELETE FROM products; DELETE FROM workspaces; DELETE FROM founders;
    SET session_replication_role = origin;
  `);
  await db.query(`INSERT INTO founders (id,email) VALUES ($1,'a@t'),($2,'b@t')`, [FOUNDER_A, FOUNDER_B]);
  await db.query(`INSERT INTO workspaces (id,founder_id,name) VALUES ($1,$3,'A'),($2,$4,'B')`, [WS_A, WS_B, FOUNDER_A, FOUNDER_B]);
  await db.query(`INSERT INTO products (id,founder_id,workspace_id,name) VALUES ($1,$2,$3,'P')`, [PROD_A, FOUNDER_A, WS_A]);
  // The product insert fires its own enqueue trigger; clear so each test starts clean.
  await db.query(`DELETE FROM embedding_outbox`);
});

const maybe = (n: string, f: () => Promise<void>) => it(n, async () => { if (!available) return; await f(); });

async function addMemory(title = 'm', ws = WS_A, founder = FOUNDER_A): Promise<string> {
  const r = await db!.query(
    `INSERT INTO marketing_memories (founder_id, workspace_id, product_id, memory_type, title, content, source)
     VALUES ($1,$2,$3,'campaign',$4,'{}','campaign_performance') RETURNING id`,
    [founder, ws, PROD_A, title]);
  return r.rows[0].id;
}

describe('093 — atomic enqueue', () => {
  maybe('a canonical INSERT creates outbox work in the same transaction', async () => {
    const id = await addMemory();
    const { rows } = await db!.query(
      `SELECT source_type, source_id, workspace_id, status, reason FROM embedding_outbox`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source_type: 'marketing_memory', source_id: id, workspace_id: WS_A,
      status: 'pending', reason: 'created',
    });
  });

  maybe('a ROLLED BACK memory leaves NO job — the guarantee, both ways', async () => {
    // This is the assertion that distinguishes a real transaction from two writes
    // that merely happen to run next to each other.
    await db!.query('BEGIN');
    await db!.query(
      `INSERT INTO marketing_memories (founder_id, workspace_id, product_id, memory_type, title, content, source)
       VALUES ($1,$2,$3,'campaign','doomed','{}','intake')`, [FOUNDER_A, WS_A, PROD_A]);
    const during = await db!.query(`SELECT count(*)::int n FROM embedding_outbox`);
    expect(during.rows[0].n).toBe(1);
    await db!.query('ROLLBACK');

    const after = await db!.query(`SELECT count(*)::int n FROM embedding_outbox`);
    expect(after.rows[0].n).toBe(0);
  });

  maybe('the trigger cannot be bypassed by a direct SQL insert', async () => {
    // The reason a trigger was chosen over an RPC: a caller that knows nothing
    // about the outbox still produces work.
    await db!.query(
      `INSERT INTO marketing_memories (founder_id, workspace_id, product_id, memory_type, title, content, source)
       VALUES ($1,$2,$3,'brand','direct sql','{}','intake')`, [FOUNDER_A, WS_A, PROD_A]);
    const { rows } = await db!.query(`SELECT count(*)::int n FROM embedding_outbox`);
    expect(rows[0].n).toBe(1);
  });

  maybe('ten rapid edits COALESCE into one open job', async () => {
    const id = await addMemory('v0');
    for (let i = 1; i <= 10; i++) {
      await db!.query(`UPDATE marketing_memories SET title=$2 WHERE id=$1`, [id, `v${i}`]);
    }
    const { rows } = await db!.query(
      `SELECT count(*)::int n, max(reason) r FROM embedding_outbox WHERE status='pending'`);
    expect(rows[0].n).toBe(1);
    expect(rows[0].r).toBe('updated');
  });

  maybe('an UPDATE marks the existing vector STALE (conservative)', async () => {
    const id = await addMemory();
    await db!.query(
      `INSERT INTO memory_embeddings (workspace_id, source_type, source_id, embedding_provider,
         embedding_model, dimensions, rendering_version, content_hash, embedding, status)
       VALUES ($1,'marketing_memory',$2,'test','m1',3,1,$3,'[1,2,3]','current')`, [WS_A, id, SHA]);

    await db!.query(`UPDATE marketing_memories SET title='changed' WHERE id=$1`, [id]);

    const { rows } = await db!.query(`SELECT status FROM memory_embeddings WHERE source_id=$1`, [id]);
    expect(rows[0].status).toBe('stale');
  });

  maybe('an INELIGIBLE playbook signal produces NO work', async () => {
    await db!.query(`INSERT INTO playbook_signals (category, market, channel) VALUES ('x','usa','meta')`);
    const { rows } = await db!.query(`SELECT count(*)::int n FROM embedding_outbox WHERE source_type='playbook_signal'`);
    expect(rows[0].n).toBe(0);   // embedding_eligible defaults false — rule 45
  });

  maybe('an ELIGIBLE playbook signal enqueues GLOBAL work with no workspace', async () => {
    await db!.query(
      `INSERT INTO playbook_signals (category, market, channel, embedding_eligible)
       VALUES ('x','usa','meta',true)`);
    const { rows } = await db!.query(
      `SELECT workspace_id, source_type FROM embedding_outbox WHERE source_type='playbook_signal'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].workspace_id).toBeNull();
  });

  maybe('a tenant job may not carry a NULL workspace, nor a global job a workspace', async () => {
    await expect(db!.query(
      `INSERT INTO embedding_outbox (source_type, source_id, requested_provider, requested_model, requested_dimensions)
       VALUES ('marketing_memory', gen_random_uuid(), 'p','m',8)`),
    ).rejects.toThrow(/embedding_outbox_tenancy_shape/);

    await expect(db!.query(
      `INSERT INTO embedding_outbox (workspace_id, source_type, source_id, requested_provider, requested_model, requested_dimensions)
       VALUES ($1,'playbook_signal', gen_random_uuid(), 'p','m',8)`, [WS_A]),
    ).rejects.toThrow(/embedding_outbox_tenancy_shape/);
  });
});

describe('093 — deletion and race safety', () => {
  maybe('deleting the source CANCELS its open job', async () => {
    const id = await addMemory();
    await db!.query(`DELETE FROM marketing_memories WHERE id=$1`, [id]);
    const { rows } = await db!.query(`SELECT status, last_error_code FROM embedding_outbox WHERE source_id=$1`, [id]);
    expect(rows[0]).toMatchObject({ status: 'cancelled', last_error_code: 'SOURCE_DELETED' });
  });

  maybe('deleting the workspace removes its jobs', async () => {
    await addMemory();
    // NOT under session_replication_role=replica: that mode disables FK cascade
    // triggers too, so the workspace delete would not propagate and the test
    // would pass for the wrong reason.
    await db!.query(`DELETE FROM workspaces WHERE id=$1`, [WS_A]);
    const { rows } = await db!.query(`SELECT count(*)::int n FROM embedding_outbox`);
    expect(rows[0].n).toBe(0);
  });

  maybe('a completed job does not block new work for the same source', async () => {
    const id = await addMemory();
    await db!.query(`UPDATE embedding_outbox SET status='completed', completed_at=now() WHERE source_id=$1`, [id]);
    await db!.query(`UPDATE marketing_memories SET title='again' WHERE id=$1`, [id]);
    const { rows } = await db!.query(
      `SELECT count(*)::int n FROM embedding_outbox WHERE source_id=$1 AND status='pending'`, [id]);
    expect(rows[0].n).toBe(1);
  });
});

describe('093 — claiming', () => {
  maybe('claim marks processing, stamps the worker, and increments attempts', async () => {
    await addMemory();
    const { rows } = await db!.query(`SELECT * FROM lm_claim_embedding_work('w1', 10, 300)`);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('processing');
    expect(rows[0].locked_by).toBe('w1');
    expect(rows[0].attempt_count).toBe(1);
  });

  maybe('a second claim does NOT return an already-claimed job', async () => {
    await addMemory();
    await db!.query(`SELECT * FROM lm_claim_embedding_work('w1', 10, 300)`);
    const second = await db!.query(`SELECT * FROM lm_claim_embedding_work('w2', 10, 300)`);
    expect(second.rows).toHaveLength(0);
  });

  maybe('a job whose worker died becomes claimable after the visibility timeout', async () => {
    await addMemory();
    await db!.query(`SELECT * FROM lm_claim_embedding_work('dead-worker', 10, 300)`);
    // Simulate the timeout elapsing rather than sleeping for it.
    await db!.query(`UPDATE embedding_outbox SET status='pending', available_at = now() - interval '1 second'`);
    const again = await db!.query(`SELECT * FROM lm_claim_embedding_work('w2', 10, 300)`);
    expect(again.rows).toHaveLength(1);
    expect(again.rows[0].attempt_count).toBe(2);   // attempts accumulate across crashes
  });

  maybe('claim respects its limit', async () => {
    for (let i = 0; i < 5; i++) await addMemory(`m${i}`);
    const { rows } = await db!.query(`SELECT * FROM lm_claim_embedding_work('w1', 2, 300)`);
    expect(rows).toHaveLength(2);
  });
});

describe('093 — isolation and observability', () => {
  maybe('workspace A cannot SELECT workspace B jobs', async () => {
    await addMemory('A-job', WS_A, FOUNDER_A);
    await db!.query(`INSERT INTO products (id,founder_id,workspace_id,name) VALUES ($1,$2,$3,'PB')`,
      ['dddddddd-2222-4222-8222-dddddddddddd', FOUNDER_B, WS_B]);
    await db!.query(
      `INSERT INTO marketing_memories (founder_id, workspace_id, product_id, memory_type, title, content, source)
       VALUES ($1,$2,$3,'campaign','B-job','{}','intake')`,
      [FOUNDER_B, WS_B, 'dddddddd-2222-4222-8222-dddddddddddd']);

    await db!.query(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $fn$ SELECT '${FOUNDER_A}'::uuid $fn$`);
    await db!.query(`SET ROLE authenticated`);
    const { rows } = await db!.query(`SELECT workspace_id FROM embedding_outbox`);
    await db!.query(`RESET ROLE`);

    expect(rows.map(r => r.workspace_id)).toEqual([WS_A]);
  });

  maybe('a client cannot INSERT outbox work at all', async () => {
    await db!.query(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $fn$ SELECT '${FOUNDER_A}'::uuid $fn$`);
    await db!.query(`SET ROLE authenticated`);
    await expect(db!.query(
      `INSERT INTO embedding_outbox (workspace_id, source_type, source_id, requested_provider, requested_model, requested_dimensions)
       VALUES ($1,'marketing_memory',gen_random_uuid(),'p','m',8)`, [WS_A]),
    ).rejects.toThrow(/permission denied|row-level security/i);
    await db!.query(`RESET ROLE`);
  });

  maybe('the stats view reports backlog and queue age', async () => {
    await addMemory('one');
    await addMemory('two');
    const { rows } = await db!.query(`SELECT * FROM embedding_pipeline_stats`);
    expect(Number(rows[0].pending_jobs)).toBe(2);
    expect(Number(rows[0].queue_age_seconds)).toBeGreaterThanOrEqual(0);
    expect(Number(rows[0].current_embeddings)).toBe(0);
  });
});
