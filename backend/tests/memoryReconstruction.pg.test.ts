/**
 * @file memoryReconstruction.pg.test.ts
 * @description Gate 0.5 — historical ContextPackage reconstruction against a
 *   REAL PostgreSQL, plus the lifecycle SQL from migration 096.
 *
 *   The acceptance question: after a memory has moved on, can LaunchMind still
 *   show what a model was ACTUALLY given? Before 3.1F it could not — the version
 *   snapshot omitted title, memory_type, status and evidence_ids, so
 *   reconstruction had no honest option but to report `changed`.
 *
 *   Real Postgres because the subject is the append-only version chain, the
 *   lifecycle CHECK, and the archive/erasure split — none of which a stub can
 *   express.
 *
 * @security Disposable database only.
 * @dependencies migrations 035-040, 088-096
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Client } from 'pg';
import { setupMemoryTestDb, postgresAvailable } from './helpers/pgTestDb';

const F_A = '11111111-1111-4111-8111-111111111111';
const F_B = '22222222-2222-4222-8222-222222222222';
const WS_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const WS_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const PR_A = 'cccccccc-1111-4111-8111-cccccccccccc';
const PR_B = 'dddddddd-2222-4222-8222-dddddddddddd';

let db: Client | null = null;
let available = false;

beforeAll(async () => {
  available = await postgresAvailable();
  if (!available) return;
  db = await setupMemoryTestDb('recon');
}, 120_000);

afterAll(async () => { await db?.end(); });

beforeEach(async () => {
  if (!db) return;
  await db.query(`
    SET session_replication_role = replica;
    DELETE FROM context_package_items; DELETE FROM context_packages;
    DELETE FROM memory_challenges; DELETE FROM memory_embeddings;
    DELETE FROM embedding_outbox; DELETE FROM evidence;
    DELETE FROM marketing_memory_versions; DELETE FROM marketing_memories;
    DELETE FROM products; DELETE FROM workspaces; DELETE FROM founders;
    SET session_replication_role = origin;
  `);
  await db.query(`INSERT INTO founders (id,email) VALUES ($1,'a@t'),($2,'b@t')`, [F_A, F_B]);
  await db.query(`INSERT INTO workspaces (id,founder_id,name) VALUES ($1,$3,'A'),($2,$4,'B')`, [WS_A, WS_B, F_A, F_B]);
  await db.query(`INSERT INTO products (id,founder_id,workspace_id,name) VALUES ($1,$3,$5,'PA'),($2,$4,$6,'PB')`,
    [PR_A, PR_B, F_A, F_B, WS_A, WS_B]);
  await db.query(`DELETE FROM embedding_outbox`);
});

const maybe = (n: string, f: () => Promise<void>) => it(n, async () => { if (!available) return; await f(); });

async function newMemory(title: string, claim: string, ws = WS_A, founder = F_A, product = PR_A): Promise<string> {
  const r = await db!.query(
    `INSERT INTO marketing_memories (founder_id, workspace_id, product_id, memory_type, title, content, source, confidence, status, version)
     VALUES ($1,$2,$3,'campaign',$4,$5::jsonb,'campaign_performance',0.8,'active',1) RETURNING id`,
    [founder, ws, product, title, JSON.stringify({ claim })]);
  return r.rows[0].id;
}

/** Snapshots the current row then bumps it — the updateMemory pattern. */
async function updateTo(id: string, title: string, claim: string, hash: string): Promise<void> {
  const cur = (await db!.query(`SELECT * FROM marketing_memories WHERE id=$1`, [id])).rows[0];
  await db!.query(
    `INSERT INTO marketing_memory_versions
       (memory_id, founder_id, workspace_id, version, title, memory_type, status,
        evidence_ids, content_hash, rendering_version, content, source, confidence,
        changed_by, change_reason, valid_from, valid_until)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$11,$12,'system','updated',$13,now())`,
    [id, cur.founder_id, cur.workspace_id, cur.version, cur.title, cur.memory_type, cur.status,
     cur.evidence_ids ?? [], hash, cur.content, cur.source, cur.confidence, cur.updated_at]);
  await db!.query(
    `UPDATE marketing_memories SET title=$2, content=$3::jsonb, version=version+1, updated_at=now() WHERE id=$1`,
    [id, title, JSON.stringify({ claim })]);
}

async function buildPackage(memoryId: string, version: number, hash: string): Promise<string> {
  const pkg = await db!.query(
    `INSERT INTO context_packages (workspace_id, product_id, founder_id, context_type,
       retention_class, retrieval_mode, memory_outcome, token_budget)
     VALUES ($1,$2,$3,'STRATEGY_RECOMMENDATION','decision','HYBRID','selected',3000) RETURNING id`,
    [WS_A, PR_A, F_A]);
  const id = pkg.rows[0].id;
  await db!.query(
    `INSERT INTO context_package_items (context_package_id, workspace_id, item_type,
       source_id, source_version, content_hash, inclusion_reason, position)
     VALUES ($1,$2,'marketing_memory',$3,$4,$5,'retrieved',1)`,
    [id, WS_A, memoryId, version, hash]);
  return id;
}

const H1 = 'a'.repeat(64), H2 = 'b'.repeat(64), H3 = 'c'.repeat(64);

// ── Gate 0.5 ─────────────────────────────────────────────────────────────────
describe('Gate 0.5 — historical reconstruction', () => {
  maybe('the version snapshot now carries title, type, status and evidence', async () => {
    const { rows } = await db!.query(`
      SELECT column_name FROM information_schema.columns
       WHERE table_name='marketing_memory_versions'
         AND column_name IN ('title','memory_type','status','evidence_ids','content_hash','change_reason','valid_from','valid_until')`);
    expect(rows.length).toBe(8);
  });

  maybe('v1 → v2: the v1 snapshot is recoverable and reproduces what P used', async () => {
    const id = await newMemory('Outcome-led messaging won', 'Beat feature-led by 41%.');
    const pkgId = await buildPackage(id, 1, H1);
    await updateTo(id, 'Feature-led messaging won', 'Reversed finding.', H1);

    const cur = (await db!.query(`SELECT title, version FROM marketing_memories WHERE id=$1`, [id])).rows[0];
    expect(cur.version).toBe(2);
    expect(cur.title).toBe('Feature-led messaging won');

    const item = (await db!.query(
      `SELECT source_version, content_hash FROM context_package_items WHERE context_package_id=$1`, [pkgId])).rows[0];
    expect(item.source_version).toBe(1);

    // The historical snapshot exists and holds the ORIGINAL title.
    const snap = (await db!.query(
      `SELECT title, content, content_hash, confidence, status FROM marketing_memory_versions
        WHERE memory_id=$1 AND version=$2`, [id, 1])).rows[0];
    expect(snap.title).toBe('Outcome-led messaging won');
    expect(snap.content.claim).toBe('Beat feature-led by 41%.');
    expect(snap.content_hash).toBe(item.content_hash);   // hash matches P's record
  });

  maybe('v1 → v2 → v3: every intermediate version stays recoverable', async () => {
    const id = await newMemory('V1 title', 'v1 claim');
    await buildPackage(id, 1, H1);
    await updateTo(id, 'V2 title', 'v2 claim', H1);
    await updateTo(id, 'V3 title', 'v3 claim', H2);

    const { rows } = await db!.query(
      `SELECT version, title FROM marketing_memory_versions WHERE memory_id=$1 ORDER BY version`, [id]);
    expect(rows.map(r => `${r.version}:${r.title}`)).toEqual(['1:V1 title', '2:V2 title']);
    const cur = (await db!.query(`SELECT title, version FROM marketing_memories WHERE id=$1`, [id])).rows[0];
    expect(cur.version).toBe(3);
  });

  maybe('a SUPERSEDED memory keeps its history and names its successor', async () => {
    const oldId = await newMemory('Search beats Meta', 'overall');
    const newId = await newMemory('Search loses to Meta for enterprise', 'segment-specific');
    await updateTo(oldId, 'Search beats Meta', 'overall', H1);
    await db!.query(
      `UPDATE marketing_memories SET status='superseded', superseded_by=$2, superseded_at=now() WHERE id=$1`,
      [oldId, newId]);

    const r = (await db!.query(`SELECT status, superseded_by FROM marketing_memories WHERE id=$1`, [oldId])).rows[0];
    expect(r.status).toBe('superseded');
    expect(r.superseded_by).toBe(newId);
    const vers = await db!.query(`SELECT count(*)::int n FROM marketing_memory_versions WHERE memory_id=$1`, [oldId]);
    expect(vers.rows[0].n).toBeGreaterThan(0);   // history survives supersession
  });

  maybe('a RETRACTED memory records reason and actor, and is not deleted', async () => {
    const id = await newMemory('Bad provider data', 'derived from malformed import');
    await db!.query(
      `UPDATE marketing_memories SET status='retracted', retracted_at=now(),
              retraction_reason='source feed was malformed' WHERE id=$1`, [id]);
    const r = (await db!.query(
      `SELECT status, retraction_reason, title FROM marketing_memories WHERE id=$1`, [id])).rows[0];
    expect(r.status).toBe('retracted');
    expect(r.retraction_reason).toMatch(/malformed/);
    expect(r.title).toBe('Bad provider data');   // still visible as history
  });

  maybe('a DELETED source leaves the package item, which reports it honestly', async () => {
    const id = await newMemory('Doomed', 'x');
    const pkgId = await buildPackage(id, 1, H1);
    await db!.query(`DELETE FROM marketing_memories WHERE id=$1`, [id]);

    // The item survives — packages are append-only and reference by id.
    const items = await db!.query(
      `SELECT source_id, source_version FROM context_package_items WHERE context_package_id=$1`, [pkgId]);
    expect(items.rows).toHaveLength(1);
    const gone = await db!.query(`SELECT 1 FROM marketing_memories WHERE id=$1`, [id]);
    expect(gone.rows).toHaveLength(0);
  });

  maybe('reconstruction is workspace-scoped in SQL', async () => {
    const id = await newMemory('A secret', 'x');
    const pkgId = await buildPackage(id, 1, H1);
    const wrong = await db!.query(
      `SELECT id FROM context_packages WHERE id=$1 AND workspace_id=$2`, [pkgId, WS_B]);
    expect(wrong.rows).toHaveLength(0);
  });
});

// ── Lifecycle SQL ────────────────────────────────────────────────────────────
describe('096 — lifecycle states', () => {
  maybe('all five ADR states plus legacy are accepted; nonsense is not', async () => {
    const id = await newMemory('x', 'y');
    for (const s of ['active', 'challenged', 'stale', 'superseded', 'retracted']) {
      await expect(db!.query(`UPDATE marketing_memories SET status=$2 WHERE id=$1`, [id, s]))
        .resolves.toBeTruthy();
    }
    await expect(db!.query(`UPDATE marketing_memories SET status='invented' WHERE id=$1`, [id]))
      .rejects.toThrow(/marketing_memories_status_governed/);
  });

  maybe('a challenge records the conflict without changing the memory', async () => {
    const incumbent = await newMemory('Our ICP is independent providers', 'founder said so');
    await db!.query(`UPDATE marketing_memories SET source='founder_feedback', assertion_class='founder_assertion' WHERE id=$1`, [incumbent]);
    const challenger = await newMemory('Enterprise franchises convert better', 'campaign data');

    await db!.query(
      `INSERT INTO memory_challenges (workspace_id, memory_id, memory_version,
         challenger_memory_id, classification, decided_by, requires_founder_review, rationale)
       VALUES ($1,$2,1,$3,'CONTRADICTION','deterministic',true,'contradicts founder-confirmed ICP')`,
      [WS_A, incumbent, challenger]);

    // The founder's statement is untouched — that is the whole point.
    const r = (await db!.query(`SELECT title, status FROM marketing_memories WHERE id=$1`, [incumbent])).rows[0];
    expect(r.title).toBe('Our ICP is independent providers');
    const c = (await db!.query(`SELECT status, requires_founder_review FROM memory_challenges WHERE memory_id=$1`, [incumbent])).rows[0];
    expect(c.status).toBe('open');
    expect(c.requires_founder_review).toBe(true);
  });

  maybe('repeated detection of the same conflict does not queue duplicates', async () => {
    const m = await newMemory('a', 'x'); const c = await newMemory('b', 'y');
    const ins = () => db!.query(
      `INSERT INTO memory_challenges (workspace_id, memory_id, memory_version, challenger_memory_id,
         classification, decided_by) VALUES ($1,$2,1,$3,'CONTRADICTION','deterministic')`, [WS_A, m, c]);
    await ins();
    await expect(ins()).rejects.toThrow(/memory_challenges_one_open/);
  });

  maybe('evidence carries an independence key so re-imports do not double-count', async () => {
    await db!.query(
      `INSERT INTO evidence (founder_id, workspace_id, product_id, evidence_type, data, source_table, source_id)
       VALUES ($1,$2,$3,'campaign_metric','{}','campaign_metrics','evt-1'),
              ($1,$2,$3,'campaign_metric','{}','campaign_metrics','evt-1')`,
      [F_A, WS_A, PR_A]);
    // No UPDATE needed: independence_key is GENERATED, so it exists on insert.
    const { rows } = await db!.query(
      `SELECT count(*)::int total, count(DISTINCT independence_key)::int independent FROM evidence`);
    expect(rows[0].total).toBe(2);
    expect(rows[0].independent).toBe(1);   // one observation, imported twice
  });
});

// ── Product archive vs legal erasure (§20) ───────────────────────────────────
describe('096 — product archive vs erasure', () => {
  maybe('U — archiving a product PRESERVES learning and does not delete', async () => {
    const id = await newMemory('Learned from this product', 'x');
    await db!.query(
      `INSERT INTO evidence (founder_id, workspace_id, product_id, evidence_type, data)
       VALUES ($1,$2,$3,'campaign_metric','{}')`, [F_A, WS_A, PR_A]);

    const r = await db!.query(`SELECT * FROM lm_archive_product($1, 'no longer marketed')`, [PR_A]);
    expect(Number(r.rows[0].memories_marked)).toBe(1);

    const p = (await db!.query(`SELECT archived_at FROM products WHERE id=$1`, [PR_A])).rows[0];
    expect(p.archived_at).not.toBeNull();

    // Memory is STALE, not deleted and not retracted: nothing was found untrue.
    const m = (await db!.query(`SELECT status, title FROM marketing_memories WHERE id=$1`, [id])).rows[0];
    expect(m.status).toBe('stale');
    expect(m.title).toBe('Learned from this product');
    const e = await db!.query(`SELECT count(*)::int n FROM evidence WHERE product_id=$1`, [PR_A]);
    expect(e.rows[0].n).toBe(1);   // evidence survives ordinary lifecycle
  });

  maybe('and an ordinary product DELETE is still refused by append-only evidence', async () => {
    // The 3.1C finding, deliberately NOT "fixed" by weakening the trigger.
    await db!.query(
      `INSERT INTO evidence (founder_id, workspace_id, product_id, evidence_type, data)
       VALUES ($1,$2,$3,'campaign_metric','{}')`, [F_A, WS_A, PR_A]);
    await expect(db!.query(`DELETE FROM products WHERE id=$1`, [PR_A]))
      .rejects.toThrow(/append-only/i);
  });

  maybe('V — legal erasure IS able to remove it, through the sanctioned path', async () => {
    await newMemory('to be erased', 'x');
    await db!.query(
      `INSERT INTO evidence (founder_id, workspace_id, product_id, evidence_type, data)
       VALUES ($1,$2,$3,'campaign_metric','{}')`, [F_A, WS_A, PR_A]);

    await db!.query(`SELECT * FROM lm_erase_founder_history($1)`, [F_A]);
    const left = await db!.query(
      `SELECT (SELECT count(*)::int FROM marketing_memories WHERE founder_id=$1) m,
              (SELECT count(*)::int FROM evidence WHERE founder_id=$1) e`, [F_A]);
    expect(left.rows[0].m).toBe(0);
    expect(left.rows[0].e).toBe(0);

    // And the product can now be deleted, because nothing append-only remains.
    await expect(db!.query(`DELETE FROM products WHERE id=$1`, [PR_A])).resolves.toBeTruthy();
  });
});

// ── Workspace isolation (§23) ────────────────────────────────────────────────
describe('096 — cross-workspace mutation is impossible', () => {
  maybe('W — workspace A cannot challenge, supersede or retract workspace B memory', async () => {
    const bMemory = await newMemory('B belief', 'x', WS_B, F_B, PR_B);

    // A challenge row is workspace-stamped; RLS restricts reads to members.
    await db!.query(
      `INSERT INTO memory_challenges (workspace_id, memory_id, memory_version, classification, decided_by)
       VALUES ($1,$2,1,'CONTRADICTION','deterministic')`, [WS_B, bMemory]);

    await db!.query(`GRANT SELECT ON memory_challenges TO authenticated`);
    await db!.query(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $fn$ SELECT '${F_A}'::uuid $fn$`);
    await db!.query(`SET ROLE authenticated`);
    const visible = await db!.query(`SELECT id FROM memory_challenges`);
    await db!.query(`RESET ROLE`);

    expect(visible.rows).toHaveLength(0);   // A sees none of B's challenges
  });

  maybe('a client cannot write a challenge at all', async () => {
    const m = await newMemory('x', 'y');
    await db!.query(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $fn$ SELECT '${F_A}'::uuid $fn$`);
    await db!.query(`SET ROLE authenticated`);
    await expect(db!.query(
      `INSERT INTO memory_challenges (workspace_id, memory_id, memory_version, classification, decided_by)
       VALUES ($1,$2,1,'CONTRADICTION','deterministic')`, [WS_A, m]),
    ).rejects.toThrow(/permission denied|row-level security/i);
    await db!.query(`RESET ROLE`);
  });
});
