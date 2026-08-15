/**
 * @file retrievalSql.pg.test.ts
 * @description The retrieval SQL from migration 094, against a REAL PostgreSQL.
 *
 *   These are the guarantees MemoryDb cannot express: that the tsvector column
 *   really stems English, that the GIN index really exists, and — most
 *   importantly — that the vector scan applies its model/version/dimension/
 *   status/workspace filters BEFORE the distance operator. That ordering is not
 *   an optimisation; a dimension-less vector column raises a hard error when
 *   widths are mixed, so getting it wrong is a runtime failure rather than a
 *   ranking wobble.
 *
 * @security Disposable database only.
 * @dependencies migrations 035-040, 088-094
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
const SHA  = 'a'.repeat(64);

let db: Client | null = null;
let available = false;

beforeAll(async () => {
  available = await postgresAvailable();
  if (!available) return;
  db = await setupMemoryTestDb('retrieval');
}, 120_000);

afterAll(async () => { await db?.end(); });

beforeEach(async () => {
  if (!db) return;
  await db.query(`
    SET session_replication_role = replica;
    DELETE FROM memory_embeddings; DELETE FROM embedding_outbox;
    DELETE FROM evidence; DELETE FROM marketing_memory_versions;
    DELETE FROM marketing_memories; DELETE FROM products;
    DELETE FROM workspaces; DELETE FROM founders;
    SET session_replication_role = origin;
  `);
  await db.query(`INSERT INTO founders (id,email) VALUES ($1,'a@t'),($2,'b@t')`, [F_A, F_B]);
  await db.query(`INSERT INTO workspaces (id,founder_id,name) VALUES ($1,$3,'A'),($2,$4,'B')`, [WS_A, WS_B, F_A, F_B]);
  await db.query(`INSERT INTO products (id,founder_id,workspace_id,name) VALUES ($1,$3,$5,'PA'),($2,$4,$6,'PB')`,
    [PR_A, PR_B, F_A, F_B, WS_A, WS_B]);
  await db.query(`DELETE FROM embedding_outbox`);
});

const maybe = (n: string, f: () => Promise<void>) => it(n, async () => { if (!available) return; await f(); });

async function addMemory(opts: {
  ws?: string; founder?: string; product?: string;
  title: string; claim?: string; segment?: string; type?: string; source?: string; confidence?: number;
}): Promise<string> {
  const content: Record<string, unknown> = {};
  if (opts.claim) content.claim = opts.claim;
  if (opts.segment) content.segment = opts.segment;
  const r = await db!.query(
    `INSERT INTO marketing_memories (founder_id, workspace_id, product_id, memory_type, title, content, source, confidence)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING id`,
    [opts.founder ?? F_A, opts.ws ?? WS_A, opts.product ?? PR_A, opts.type ?? 'campaign',
     opts.title, JSON.stringify(content), opts.source ?? 'campaign_performance', opts.confidence ?? 0.8]);
  return r.rows[0].id;
}

// ── Full text ────────────────────────────────────────────────────────────────
describe('094 — full-text arm', () => {
  maybe('search_tsv is a GENERATED column with a GIN index', async () => {
    const col = await db!.query(`
      SELECT is_generated FROM information_schema.columns
       WHERE table_name='marketing_memories' AND column_name='search_tsv'`);
    expect(col.rows[0].is_generated).toBe('ALWAYS');

    const idx = await db!.query(`
      SELECT indexdef FROM pg_indexes WHERE indexname='marketing_memories_fts'`);
    expect(idx.rows[0].indexdef).toMatch(/USING gin/i);
  });

  maybe('STEMS English — inflections of the same word match', async () => {
    // The 3.1A failure ILIKE could not handle: a different inflection.
    await addMemory({ title: 'Reliability is the core brand promise',
                      claim: 'Reliability is emphasised because reviews show late appointments.' });
    const r = await db!.query(
      `SELECT * FROM lm_search_memory_fulltext($1, $2, NULL, NULL, ARRAY['active'], 10)`,
      [WS_A, 'why do reviews mention reliability']);
    expect(r.rows.length).toBeGreaterThan(0);
  });

  maybe('DOES NOT unify -ise/-ize spellings — a documented FTS limit', async () => {
    // Snowball stems "emphasised"→emphasis but "emphasizing"→emphas, so these
    // do NOT match lexically. Recorded rather than worked around: this is
    // precisely the class of miss the semantic arm exists to cover, and pretending
    // FTS handles it would hide why hybrid is needed.
    await addMemory({ title: 'Brand promise', claim: 'Reliability is emphasised in all copy.' });
    const r = await db!.query(
      `SELECT * FROM lm_search_memory_fulltext($1, 'emphasizing', NULL, NULL, ARRAY['active'], 10)`, [WS_A]);
    expect(r.rows).toHaveLength(0);
  });

  maybe('ANY term matches — a long question is not an AND of every word', async () => {
    // websearch_to_tsquery would require ALL of position & histor & work & best.
    await addMemory({ title: 'Outcome-led positioning won', claim: 'It converted best.' });
    const r = await db!.query(
      `SELECT * FROM lm_search_memory_fulltext($1, $2, NULL, NULL, ARRAY['active'], 10)`,
      [WS_A, 'What positioning has historically worked best?']);
    expect(r.rows.length).toBeGreaterThan(0);
  });

  maybe('matches on TERMS, not on the whole question as one substring', async () => {
    // ILIKE '%What positioning has historically worked best?%' can never match.
    await addMemory({ title: 'Outcome-led messaging increased conversion',
                      claim: 'Outcome-led beat feature-led on install conversion.' });
    const r = await db!.query(
      `SELECT * FROM lm_search_memory_fulltext($1, $2, NULL, NULL, ARRAY['active'], 10)`,
      [WS_A, 'What messaging increased conversion?']);
    expect(r.rows.length).toBeGreaterThan(0);
  });

  maybe('weights a title hit above a scope-qualifier hit', async () => {
    const titled = await addMemory({ title: 'Enterprise segment converts slowly', claim: 'x' });
    await addMemory({ title: 'Unrelated creative note', claim: 'y', segment: 'enterprise' });
    const r = await db!.query(
      `SELECT * FROM lm_search_memory_fulltext($1, 'enterprise', NULL, NULL, ARRAY['active'], 10)`, [WS_A]);
    expect(r.rows[0].id).toBe(titled);
  });

  maybe('survives punctuation that would break to_tsquery', async () => {
    await addMemory({ title: 'Pricing and packaging', claim: 'test' });
    // websearch_to_tsquery accepts raw owner input; to_tsquery would raise here.
    for (const q of ["What's next?", 'pricing & packaging!', '"outcome led" -discount', '((']) {
      const r = await db!.query(
        `SELECT * FROM lm_search_memory_fulltext($1, $2, NULL, NULL, ARRAY['active'], 10)`, [WS_A, q]);
      expect(Array.isArray(r.rows)).toBe(true);
    }
  });

  maybe('never returns another workspace, even for identical wording', async () => {
    await addMemory({ title: 'Outcome-led messaging increased conversion' });
    await addMemory({ ws: WS_B, founder: F_B, product: PR_B,
                      title: 'Outcome-led messaging increased conversion' });
    const r = await db!.query(
      `SELECT m.workspace_id FROM lm_search_memory_fulltext($1,'outcome messaging',NULL,NULL,ARRAY['active'],10) f
         JOIN marketing_memories m ON m.id = f.id`, [WS_A]);
    expect(r.rows.map(x => x.workspace_id)).toEqual([WS_A]);
  });

  maybe('respects product, type and status filters', async () => {
    await addMemory({ title: 'Founder rejected India', type: 'founder', source: 'founder_feedback' });
    await addMemory({ title: 'India campaign performance', type: 'campaign' });
    const r = await db!.query(
      `SELECT * FROM lm_search_memory_fulltext($1,'India',$2,ARRAY['founder'],ARRAY['active'],10)`, [WS_A, PR_A]);
    expect(r.rows).toHaveLength(1);
  });

  maybe('ranking is deterministic across identical runs', async () => {
    for (let i = 0; i < 5; i++) await addMemory({ title: `Conversion note ${i}`, claim: 'conversion' });
    const run = async () => (await db!.query(
      `SELECT id FROM lm_search_memory_fulltext($1,'conversion',NULL,NULL,ARRAY['active'],10)`, [WS_A])).rows.map(r => r.id);
    expect(await run()).toEqual(await run());
  });
});

// ── Exact vector ─────────────────────────────────────────────────────────────
describe('094 — exact semantic arm', () => {
  async function addVector(memId: string, vec: number[], over: Record<string, unknown> = {}) {
    const o = { ws: WS_A, model: 'voyage-4', version: 1, dims: vec.length, status: 'current', ...over };
    await db!.query(
      `INSERT INTO memory_embeddings (workspace_id, source_type, source_id, embedding_provider,
         embedding_model, dimensions, embedding_version, rendering_version, content_hash, embedding, status)
       VALUES ($1,'marketing_memory',$2,'voyage',$3,$4,$5,1,$6,$7::vector,$8)`,
      [o.ws, memId, o.model, o.dims, o.version, SHA, `[${vec.join(',')}]`, o.status]);
  }

  maybe('returns nearest first by cosine distance', async () => {
    const near = await addMemory({ title: 'near' });
    const far  = await addMemory({ title: 'far' });
    await addVector(near, [1, 0, 0]);
    await addVector(far,  [0, 1, 0]);
    const r = await db!.query(
      `SELECT * FROM lm_search_memory_embeddings($1,'[1,0,0]'::vector,'voyage-4',1,3,10)`, [WS_A]);
    expect(r.rows[0].source_id).toBe(near);
    expect(Number(r.rows[0].distance)).toBeCloseTo(0, 6);
  });

  maybe('EXCLUDES stale, failed and pending vectors', async () => {
    const cur = await addMemory({ title: 'current' });
    const st  = await addMemory({ title: 'stale' });
    await addVector(cur, [1, 0, 0]);
    await addVector(st,  [1, 0, 0], { status: 'stale' });
    const r = await db!.query(
      `SELECT * FROM lm_search_memory_embeddings($1,'[1,0,0]'::vector,'voyage-4',1,3,10)`, [WS_A]);
    expect(r.rows.map(x => x.source_id)).toEqual([cur]);
  });

  maybe('filters DIMENSIONS before the distance operator', async () => {
    // Without the pre-filter this raises "different vector dimensions". That it
    // returns cleanly is the proof the filter is applied first.
    const three = await addMemory({ title: 'three' });
    const four  = await addMemory({ title: 'four' });
    await addVector(three, [1, 0, 0]);
    await addVector(four,  [1, 0, 0, 0], { model: 'other-model' });

    const r = await db!.query(
      `SELECT * FROM lm_search_memory_embeddings($1,'[1,0,0]'::vector,'voyage-4',1,3,10)`, [WS_A]);
    expect(r.rows.map(x => x.source_id)).toEqual([three]);
  });

  maybe('a mismatched dimension argument returns nothing rather than erroring', async () => {
    const m = await addMemory({ title: 'x' });
    await addVector(m, [1, 0, 0]);
    const r = await db!.query(
      `SELECT * FROM lm_search_memory_embeddings($1,'[1,0,0,0]'::vector,'voyage-4',1,4,10)`, [WS_A]);
    expect(r.rows).toHaveLength(0);
  });

  maybe('filters MODEL and VERSION — families never mix', async () => {
    const a = await addMemory({ title: 'model a' });
    const b = await addMemory({ title: 'model b' });
    await addVector(a, [1, 0, 0]);
    await addVector(b, [1, 0, 0], { model: 'voyage-3', version: 2 });
    const r = await db!.query(
      `SELECT * FROM lm_search_memory_embeddings($1,'[1,0,0]'::vector,'voyage-4',1,3,10)`, [WS_A]);
    expect(r.rows.map(x => x.source_id)).toEqual([a]);
  });

  maybe('never crosses a workspace, even at distance zero', async () => {
    const mine   = await addMemory({ title: 'mine' });
    const theirs = await addMemory({ ws: WS_B, founder: F_B, product: PR_B, title: 'theirs' });
    await addVector(mine,   [0, 1, 0]);
    await addVector(theirs, [1, 0, 0], { ws: WS_B });   // an exact match for the query
    const r = await db!.query(
      `SELECT * FROM lm_search_memory_embeddings($1,'[1,0,0]'::vector,'voyage-4',1,3,10)`, [WS_A]);
    expect(r.rows.map(x => x.source_id)).toEqual([mine]);
  });

  maybe('still NO ANN index exists (ADR-066 rule 13)', async () => {
    const { rows } = await db!.query(`SELECT indexdef FROM pg_indexes WHERE tablename='memory_embeddings'`);
    expect(rows.filter(r => /USING (hnsw|ivfflat)/i.test(r.indexdef))).toEqual([]);
  });

  maybe('a memory with no vector remains reachable lexically', async () => {
    const m = await addMemory({ title: 'unembedded outcome messaging' });
    const sem = await db!.query(
      `SELECT * FROM lm_search_memory_embeddings($1,'[1,0,0]'::vector,'voyage-4',1,3,10)`, [WS_A]);
    expect(sem.rows).toHaveLength(0);

    const lex = await db!.query(
      `SELECT * FROM lm_search_memory_fulltext($1,'outcome messaging',NULL,NULL,ARRAY['active'],10)`, [WS_A]);
    expect(lex.rows.map(x => x.id)).toContain(m);
  });
});
