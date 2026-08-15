/**
 * @file memoryWorkspaceScope.pg.test.ts
 * @description Proves the Phase 3.1B migrations (088-092) against a REAL
 *   PostgreSQL with pgvector.
 *
 *   These tests cannot run against MemoryDb, and not merely as a matter of
 *   fidelity: the SUBJECTS here are constraints, triggers, RLS policies and
 *   guarded DDL. MemoryDb has no concept of any of them, so every assertion
 *   below would pass against it no matter what the migrations actually did —
 *   which is exactly how the founder-scoped dedup defect shipped green in
 *   Step 8.
 *
 * @security Runs only against the disposable database named by
 *   TEST_DATABASE_URL; pgTestDb refuses anything that looks hosted.
 * @dependencies pgTestDb helper, migrations 035-040 + 088-092
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Client } from 'pg';
import { setupMemoryTestDb, postgresAvailable } from './helpers/pgTestDb';

const FOUNDER_A = '11111111-1111-4111-8111-111111111111';
const FOUNDER_B = '22222222-2222-4222-8222-222222222222';
const WS_A      = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const WS_B      = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const PROD_A    = 'cccccccc-1111-4111-8111-cccccccccccc';
const PROD_B    = 'dddddddd-2222-4222-8222-dddddddddddd';

const SHA = 'a'.repeat(64);

let db: Client | null = null;
let available = false;

beforeAll(async () => {
  available = await postgresAvailable();
  if (!available) return;
  db = await setupMemoryTestDb('scope');
}, 120_000);

afterAll(async () => { await db?.end(); });

beforeEach(async () => {
  if (!db) return;
  await db.query(`SET LOCAL lm.allow_history_mutation = 'off'`);
  await db.query(`
    SET session_replication_role = replica;   -- bypass append-only triggers for fixture reset
    DELETE FROM memory_embeddings;
    DELETE FROM marketing_memory_versions;
    DELETE FROM evidence;
    DELETE FROM learning_events;
    DELETE FROM knowledge_edges;
    DELETE FROM knowledge_nodes;
    DELETE FROM marketing_memories;
    DELETE FROM playbook_signals;
    DELETE FROM products;
    DELETE FROM workspaces;
    DELETE FROM founders;
    SET session_replication_role = origin;
  `);
  await db.query(`INSERT INTO founders (id, email) VALUES ($1,'a@t.local'), ($2,'b@t.local')`, [FOUNDER_A, FOUNDER_B]);
  await db.query(`INSERT INTO workspaces (id, founder_id, name) VALUES ($1,$3,'A'), ($2,$4,'B')`, [WS_A, WS_B, FOUNDER_A, FOUNDER_B]);
  await db.query(`INSERT INTO products (id, founder_id, workspace_id, name) VALUES ($1,$3,$5,'PA'), ($2,$4,$6,'PB')`,
    [PROD_A, PROD_B, FOUNDER_A, FOUNDER_B, WS_A, WS_B]);
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async () => { if (!available) return; await fn(); });

async function insertMemory(ws: string, founder: string, product: string, title = 'm'): Promise<string> {
  const r = await db!.query(
    `INSERT INTO marketing_memories (founder_id, workspace_id, product_id, memory_type, title, content, source)
     VALUES ($1,$2,$3,'campaign',$4,'{}','campaign_performance') RETURNING id`,
    [founder, ws, product, title]);
  return r.rows[0].id;
}

// ── 088: workspace scope ─────────────────────────────────────────────────────
describe('088 — workspace tenancy', () => {
  maybe('workspace_id exists and is NOT NULL on every scoped table', async () => {
    const { rows } = await db!.query(`
      SELECT table_name, is_nullable FROM information_schema.columns
       WHERE column_name = 'workspace_id'
         AND table_name IN ('marketing_memories','marketing_memory_versions','evidence',
                            'learning_events','knowledge_nodes','knowledge_edges')
       ORDER BY table_name`);
    expect(rows.length).toBe(6);
    // The migration promotes NOT NULL only when a table is fully mapped. On a
    // fresh database every table is empty, so all six must be promoted — if one
    // is not, the guarded promotion has a bug.
    for (const r of rows) expect(`${r.table_name}:${r.is_nullable}`).toBe(`${r.table_name}:NO`);
  });

  maybe('founder_id is RETAINED for attribution (tenancy ≠ attribution)', async () => {
    const { rows } = await db!.query(`
      SELECT table_name FROM information_schema.columns
       WHERE column_name = 'founder_id'
         AND table_name IN ('marketing_memories','marketing_memory_versions','evidence',
                            'learning_events','knowledge_nodes','knowledge_edges')`);
    expect(rows.length).toBe(6);
  });

  maybe('a write without workspace_id is rejected', async () => {
    await expect(db!.query(
      `INSERT INTO marketing_memories (founder_id, product_id, memory_type, title, content, source)
       VALUES ($1,$2,'campaign','no ws','{}','intake')`, [FOUNDER_A, PROD_A]),
    ).rejects.toThrow(/null value in column "workspace_id"/i);
  });

  maybe('playbook_signals is NOT workspace-scoped (class B, global)', async () => {
    const { rows } = await db!.query(`
      SELECT 1 FROM information_schema.columns
       WHERE table_name='playbook_signals' AND column_name='workspace_id'`);
    expect(rows.length).toBe(0);
  });

  maybe('the backfill audit table exists and constrains its reasons', async () => {
    await expect(db!.query(
      `INSERT INTO memory_workspace_backfill_audit (source_table, source_id, reason)
       VALUES ('marketing_memories', gen_random_uuid(), 'because_i_said_so')`),
    ).rejects.toThrow(/violates check constraint/i);
  });
});

// ── 088 backfill correctness ─────────────────────────────────────────────────
describe('088 — backfill never guesses', () => {
  maybe('a founder with TWO workspaces is audited, not assigned', async () => {
    // Rebuild a pre-migration shape: nullable column, one unmapped row.
    await db!.query(`ALTER TABLE marketing_memories ALTER COLUMN workspace_id DROP NOT NULL`);
    const second = 'eeeeeeee-1111-4111-8111-eeeeeeeeeeee';
    await db!.query(`INSERT INTO workspaces (id, founder_id, name) VALUES ($1,$2,'A2')`, [second, FOUNDER_A]);
    const orphanProduct = 'ffffffff-1111-4111-8111-ffffffffffff';
    await db!.query(`INSERT INTO products (id, founder_id, name) VALUES ($1,$2,'no-ws')`, [orphanProduct, FOUNDER_A]);
    const r = await db!.query(
      `INSERT INTO marketing_memories (founder_id, product_id, memory_type, title, content, source)
       VALUES ($1,$2,'campaign','ambiguous','{}','intake') RETURNING id`, [FOUNDER_A, orphanProduct]);
    const memId = r.rows[0].id;

    // Re-run the migration's rule-3 backfill: it must NOT touch this row.
    await db!.query(`
      UPDATE marketing_memories x SET workspace_id = sole.id
        FROM (SELECT founder_id, (array_agg(id))[1] AS id FROM workspaces GROUP BY founder_id HAVING COUNT(*) = 1) sole
       WHERE x.founder_id = sole.founder_id AND x.workspace_id IS NULL`);

    const after = await db!.query(`SELECT workspace_id FROM marketing_memories WHERE id=$1`, [memId]);
    expect(after.rows[0].workspace_id).toBeNull();

    await db!.query(`DELETE FROM marketing_memories WHERE id=$1`, [memId]);
    await db!.query(`ALTER TABLE marketing_memories ALTER COLUMN workspace_id SET NOT NULL`);
  });
});

// ── 089: canonical embeddings ────────────────────────────────────────────────
describe('089 — canonical embedding store', () => {
  maybe('accepts vectors of DIFFERENT dimensions in one table', async () => {
    const m = await insertMemory(WS_A, FOUNDER_A, PROD_A);
    for (const [model, dims, vec] of [['small', 3, '[1,2,3]'], ['big', 4, '[1,2,3,4]']] as const) {
      await db!.query(
        `INSERT INTO memory_embeddings (workspace_id, source_type, source_id, embedding_provider,
           embedding_model, dimensions, rendering_version, content_hash, embedding, status)
         VALUES ($1,'marketing_memory',$2,'test',$3,$4,1,$5,$6::vector,'current')`,
        [WS_A, m, model, dims, SHA, vec]);
    }
    const { rows } = await db!.query(`SELECT COUNT(*)::int n FROM memory_embeddings`);
    expect(rows[0].n).toBe(2);
  });

  maybe('a distance query across mixed dimensions ERRORS unless filtered', async () => {
    const m = await insertMemory(WS_A, FOUNDER_A, PROD_A);
    await db!.query(
      `INSERT INTO memory_embeddings (workspace_id, source_type, source_id, embedding_provider,
         embedding_model, dimensions, rendering_version, content_hash, embedding, status)
       VALUES ($1,'marketing_memory',$2,'test','small',3,1,$3,'[1,2,3]','current'),
              ($1,'marketing_memory',$2,'test','big',4,1,$3,'[1,2,3,4]','current')`,
      [WS_A, m, SHA]);

    // Unfiltered — the failure is loud, which is the point of the design.
    await expect(db!.query(`SELECT embedding <=> '[1,2,3]' FROM memory_embeddings`))
      .rejects.toThrow(/different vector dimensions/i);

    // Filtered by the mandatory triple — correct and exact.
    const ok = await db!.query(
      `SELECT (embedding <=> '[1,2,3]')::float d FROM memory_embeddings
        WHERE embedding_model='small' AND embedding_version=1 AND dimensions=3`);
    expect(ok.rows[0].d).toBeCloseTo(0, 6);
  });

  maybe('recorded dimensions must match the stored vector', async () => {
    const m = await insertMemory(WS_A, FOUNDER_A, PROD_A);
    await expect(db!.query(
      `INSERT INTO memory_embeddings (workspace_id, source_type, source_id, embedding_provider,
         embedding_model, dimensions, rendering_version, content_hash, embedding, status)
       VALUES ($1,'marketing_memory',$2,'test','m',99,1,$3,'[1,2,3]','current')`,
      [WS_A, m, SHA]),
    ).rejects.toThrow(/memory_embeddings_dimension_match/);
  });

  maybe('tenant sources REQUIRE a workspace; global sources REFUSE one', async () => {
    const m = await insertMemory(WS_A, FOUNDER_A, PROD_A);
    await expect(db!.query(
      `INSERT INTO memory_embeddings (source_type, source_id, embedding_provider, embedding_model,
         dimensions, rendering_version, content_hash, status)
       VALUES ('marketing_memory',$1,'t','m',3,1,$2,'pending')`, [m, SHA]),
    ).rejects.toThrow(/memory_embeddings_tenancy_shape/);

    await expect(db!.query(
      `INSERT INTO memory_embeddings (workspace_id, source_type, source_id, embedding_provider,
         embedding_model, dimensions, rendering_version, content_hash, status)
       VALUES ($1,'playbook_signal',gen_random_uuid(),'t','m',3,1,$2,'pending')`, [WS_A, SHA]),
    ).rejects.toThrow(/memory_embeddings_tenancy_shape/);
  });

  maybe('a row claiming to be current must actually carry a vector', async () => {
    const m = await insertMemory(WS_A, FOUNDER_A, PROD_A);
    await expect(db!.query(
      `INSERT INTO memory_embeddings (workspace_id, source_type, source_id, embedding_provider,
         embedding_model, dimensions, rendering_version, content_hash, status)
       VALUES ($1,'marketing_memory',$2,'t','m',3,1,$3,'current')`, [WS_A, m, SHA]),
    ).rejects.toThrow(/memory_embeddings_vector_presence/);
  });

  maybe('content_hash must be a sha256 hex digest', async () => {
    const m = await insertMemory(WS_A, FOUNDER_A, PROD_A);
    await expect(db!.query(
      `INSERT INTO memory_embeddings (workspace_id, source_type, source_id, embedding_provider,
         embedding_model, dimensions, rendering_version, content_hash, status)
       VALUES ($1,'marketing_memory',$2,'t','m',3,1,'not-a-hash','pending')`, [WS_A, m]),
    ).rejects.toThrow(/violates check constraint/i);
  });

  maybe('re-embedding the same source+model replaces rather than accumulates', async () => {
    const m = await insertMemory(WS_A, FOUNDER_A, PROD_A);
    const ins = () => db!.query(
      `INSERT INTO memory_embeddings (workspace_id, source_type, source_id, embedding_provider,
         embedding_model, dimensions, rendering_version, content_hash, status)
       VALUES ($1,'marketing_memory',$2,'t','m',3,1,$3,'pending')`, [WS_A, m, SHA]);
    await ins();
    await expect(ins()).rejects.toThrow(/memory_embeddings_identity/);
  });

  maybe('NO ANN index exists (ADR-066 rule 13)', async () => {
    const { rows } = await db!.query(`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'memory_embeddings'`);
    const ann = rows.filter(r => /USING (hnsw|ivfflat)/i.test(r.indexdef));
    expect(ann).toEqual([]);
  });
});

// ── 090: retirement ──────────────────────────────────────────────────────────
describe('090 — legacy vector storage retired', () => {
  maybe('exactly ONE table carries a vector column', async () => {
    const { rows } = await db!.query(`
      SELECT c.relname AS table_name
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_type t ON t.oid = a.atttypid
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND t.typname = 'vector' AND a.attnum > 0 AND NOT a.attisdropped
       ORDER BY 1`);
    expect(rows.map(r => r.table_name)).toEqual(['memory_embeddings']);
  });

  maybe('embedding_store is gone', async () => {
    const { rows } = await db!.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='embedding_store'`);
    expect(rows.length).toBe(0);
  });

  maybe('playbook signals are ineligible for embedding by default', async () => {
    const r = await db!.query(
      `INSERT INTO playbook_signals (category, market, channel) VALUES ('x','usa','meta')
       RETURNING embedding_eligible`);
    expect(r.rows[0].embedding_eligible).toBe(false);
  });
});

// ── 091: append-only ─────────────────────────────────────────────────────────
describe('091 — append-only history', () => {
  async function insertVersion(): Promise<string> {
    const m = await insertMemory(WS_A, FOUNDER_A, PROD_A);
    const r = await db!.query(
      `INSERT INTO marketing_memory_versions (memory_id, founder_id, workspace_id, version, content, source, changed_by)
       VALUES ($1,$2,$3,1,'{}','intake','founder') RETURNING id`, [m, FOUNDER_A, WS_A]);
    return r.rows[0].id;
  }

  maybe('a version row cannot be UPDATED, even as the application role', async () => {
    const id = await insertVersion();
    await expect(db!.query(`UPDATE marketing_memory_versions SET confidence = 0.9 WHERE id=$1`, [id]))
      .rejects.toThrow(/append-only/i);
  });

  maybe('a version row cannot be DELETED without the erasure flag', async () => {
    const id = await insertVersion();
    await expect(db!.query(`DELETE FROM marketing_memory_versions WHERE id=$1`, [id]))
      .rejects.toThrow(/append-only/i);
  });

  maybe('evidence is immutable too', async () => {
    const r = await db!.query(
      `INSERT INTO evidence (founder_id, workspace_id, product_id, evidence_type, data)
       VALUES ($1,$2,$3,'campaign_metric','{}') RETURNING id`, [FOUNDER_A, WS_A, PROD_A]);
    await expect(db!.query(`UPDATE evidence SET data='{"x":1}' WHERE id=$1`, [r.rows[0].id]))
      .rejects.toThrow(/append-only/i);
  });

  maybe('learning_events allows the LIFECYCLE to move', async () => {
    const r = await db!.query(
      `INSERT INTO learning_events (founder_id, workspace_id, event_type, payload, status)
       VALUES ($1,$2,'campaign_result','{"a":1}','processing') RETURNING id`, [FOUNDER_A, WS_A]);
    await expect(db!.query(
      `UPDATE learning_events SET status='completed', memories_created=2 WHERE id=$1`, [r.rows[0].id]),
    ).resolves.toBeTruthy();
  });

  maybe('learning_events FREEZES its audit content', async () => {
    const r = await db!.query(
      `INSERT INTO learning_events (founder_id, workspace_id, event_type, payload, status)
       VALUES ($1,$2,'campaign_result','{"a":1}','processing') RETURNING id`, [FOUNDER_A, WS_A]);
    await expect(db!.query(`UPDATE learning_events SET payload='{"a":2}' WHERE id=$1`, [r.rows[0].id]))
      .rejects.toThrow(/immutable/i);
    await expect(db!.query(`UPDATE learning_events SET event_type='review_ingested' WHERE id=$1`, [r.rows[0].id]))
      .rejects.toThrow(/immutable/i);
  });

  maybe('the controlled erasure path CAN delete history', async () => {
    await insertVersion();
    const before = await db!.query(`SELECT COUNT(*)::int n FROM marketing_memory_versions`);
    expect(before.rows[0].n).toBe(1);

    const res = await db!.query(`SELECT * FROM lm_erase_founder_history($1)`, [FOUNDER_A]);
    expect(res.rows[0].versions_deleted).toBe('1');

    const after = await db!.query(`SELECT COUNT(*)::int n FROM marketing_memory_versions`);
    expect(after.rows[0].n).toBe(0);
  });

  maybe('the erasure flag does NOT leak past its transaction', async () => {
    await db!.query(`SELECT * FROM lm_erase_founder_history($1)`, [FOUNDER_A]);
    const id = await insertVersion();
    // A later statement must be refused again — otherwise a pooled connection
    // would carry erasure rights into unrelated requests.
    await expect(db!.query(`DELETE FROM marketing_memory_versions WHERE id=$1`, [id]))
      .rejects.toThrow(/append-only/i);
  });

  maybe('memory_type is governed by a named CHECK', async () => {
    await expect(db!.query(
      `INSERT INTO marketing_memories (founder_id, workspace_id, product_id, memory_type, title, content, source)
       VALUES ($1,$2,$3,'not_a_real_type','t','{}','intake')`, [FOUNDER_A, WS_A, PROD_A]),
    ).rejects.toThrow(/marketing_memories_memory_type_governed/);
  });
});

// ── 092: derived deletion ────────────────────────────────────────────────────
describe('092 — derived vectors follow their source', () => {
  async function embeddingFor(memId: string, ws: string): Promise<void> {
    await db!.query(
      `INSERT INTO memory_embeddings (workspace_id, source_type, source_id, embedding_provider,
         embedding_model, dimensions, rendering_version, content_hash, embedding, status)
       VALUES ($1,'marketing_memory',$2,'t','m',3,1,$3,'[1,2,3]','current')`, [ws, memId, SHA]);
  }

  maybe('deleting a source removes its embedding and leaves others alone', async () => {
    const keep = await insertMemory(WS_A, FOUNDER_A, PROD_A, 'keep');
    const drop = await insertMemory(WS_A, FOUNDER_A, PROD_A, 'drop');
    await embeddingFor(keep, WS_A);
    await embeddingFor(drop, WS_A);

    await db!.query(`DELETE FROM marketing_memories WHERE id=$1`, [drop]);

    const { rows } = await db!.query(`SELECT source_id FROM memory_embeddings`);
    expect(rows.map(r => r.source_id)).toEqual([keep]);
  });

  maybe('a same-UUID source of a DIFFERENT type does not delete the wrong vector', async () => {
    // The reason each trigger names its own source_type rather than matching on
    // source_id alone.
    const m = await insertMemory(WS_A, FOUNDER_A, PROD_A);
    await embeddingFor(m, WS_A);
    // A product sharing the memory's UUID. products is not append-only, so this
    // isolates the source_type question from the immutability question.
    await db!.query(
      `INSERT INTO products (id, founder_id, workspace_id, name) VALUES ($1,$2,$3,'twin')`,
      [m, FOUNDER_A, WS_A]);

    await db!.query(`DELETE FROM products WHERE id=$1`, [m]);

    const { rows } = await db!.query(`SELECT COUNT(*)::int n FROM memory_embeddings WHERE source_id=$1`, [m]);
    expect(rows[0].n).toBe(1);   // the marketing_memory vector survives
  });

  maybe('deleting a workspace removes its embeddings', async () => {
    const m = await insertMemory(WS_A, FOUNDER_A, PROD_A);
    await embeddingFor(m, WS_A);
    await db!.query(`DELETE FROM workspaces WHERE id=$1`, [WS_A]);
    const { rows } = await db!.query(`SELECT COUNT(*)::int n FROM memory_embeddings`);
    expect(rows[0].n).toBe(0);
  });
});

// ── RLS: adversarial cross-workspace ─────────────────────────────────────────
describe('RLS — cross-workspace isolation', () => {
  /** Runs as a non-superuser with auth.uid() bound to one founder. */
  async function asFounder<T>(founder: string, fn: () => Promise<T>): Promise<T> {
    await db!.query(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $fn$ SELECT '${founder}'::uuid $fn$`);
    await db!.query(`SET ROLE authenticated`);
    try { return await fn(); }
    finally { await db!.query(`RESET ROLE`); }
  }

  maybe('workspace A cannot SELECT workspace B memories', async () => {
    await insertMemory(WS_A, FOUNDER_A, PROD_A, 'A-secret');
    await insertMemory(WS_B, FOUNDER_B, PROD_B, 'B-secret');
    await db!.query(`GRANT SELECT ON marketing_memories TO authenticated`);

    const titles = await asFounder(FOUNDER_A, async () => {
      const r = await db!.query(`SELECT title FROM marketing_memories`);
      return r.rows.map(x => x.title);
    });
    expect(titles).toEqual(['A-secret']);
  });

  maybe('workspace A cannot SELECT workspace B embeddings', async () => {
    const a = await insertMemory(WS_A, FOUNDER_A, PROD_A);
    const b = await insertMemory(WS_B, FOUNDER_B, PROD_B);
    for (const [ws, m] of [[WS_A, a], [WS_B, b]] as const) {
      await db!.query(
        `INSERT INTO memory_embeddings (workspace_id, source_type, source_id, embedding_provider,
           embedding_model, dimensions, rendering_version, content_hash, embedding, status)
         VALUES ($1,'marketing_memory',$2,'t','m',3,1,$3,'[1,2,3]','current')`, [ws, m, SHA]);
    }
    const seen = await asFounder(FOUNDER_A, async () => {
      const r = await db!.query(`SELECT workspace_id FROM memory_embeddings`);
      return r.rows.map(x => x.workspace_id);
    });
    expect(seen).toEqual([WS_A]);
  });

  maybe('workspace A cannot INSERT, UPDATE or DELETE workspace B embeddings', async () => {
    const b = await insertMemory(WS_B, FOUNDER_B, PROD_B);
    await db!.query(
      `INSERT INTO memory_embeddings (workspace_id, source_type, source_id, embedding_provider,
         embedding_model, dimensions, rendering_version, content_hash, embedding, status)
       VALUES ($1,'marketing_memory',$2,'t','m',3,1,$3,'[1,2,3]','current')`, [WS_B, b, SHA]);

    // Writes are revoked from `authenticated` outright (089), so each attempt is
    // refused by grants before RLS is even consulted — defence in depth.
    await asFounder(FOUNDER_A, async () => {
      await expect(db!.query(
        `INSERT INTO memory_embeddings (workspace_id, source_type, source_id, embedding_provider,
           embedding_model, dimensions, rendering_version, content_hash, status)
         VALUES ($1,'marketing_memory',$2,'t','other-model',3,1,$3,'pending')`, [WS_B, b, SHA]),
      ).rejects.toThrow(/permission denied|violates row-level security/i);

      await expect(db!.query(`UPDATE memory_embeddings SET status='stale' WHERE workspace_id=$1`, [WS_B]))
        .rejects.toThrow(/permission denied|violates row-level security/i);

      await expect(db!.query(`DELETE FROM memory_embeddings WHERE workspace_id=$1`, [WS_B]))
        .rejects.toThrow(/permission denied|violates row-level security/i);
    });

    const { rows } = await db!.query(`SELECT COUNT(*)::int n FROM memory_embeddings WHERE workspace_id=$1`, [WS_B]);
    expect(rows[0].n).toBe(1);
  });

  maybe('global playbook embeddings are readable but never look tenant-owned', async () => {
    await db!.query(
      `INSERT INTO memory_embeddings (source_type, source_id, embedding_provider, embedding_model,
         dimensions, rendering_version, content_hash, embedding, status)
       VALUES ('playbook_signal',gen_random_uuid(),'t','m',3,1,$1,'[1,2,3]','current')`, [SHA]);

    const rows = await asFounder(FOUNDER_A, async () => {
      const r = await db!.query(`SELECT workspace_id, source_type FROM memory_embeddings`);
      return r.rows;
    });
    // Visible, and unmistakably global: workspace_id is NULL, so it can never be
    // mistaken for the founder's own memory (ADR-066 rule 45).
    expect(rows).toEqual([{ workspace_id: null, source_type: 'playbook_signal' }]);
  });
});
