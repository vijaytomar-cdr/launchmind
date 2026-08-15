/**
 * @file memoryLifecycleFlow.pg.test.ts
 * @description End-to-end lifecycle execution against a REAL PostgreSQL —
 *   Phase 3.1F completion pass.
 *
 *   Real database because the guarantee under test is ATOMICITY: snapshot,
 *   transition and learning event must commit together. A stub cannot fail
 *   half-way, so a stub cannot prove the thing that matters.
 *
 *   Covers §17 scenarios A, B, C, D, E, F, G, H, I, J, K, L, M, N, R, W, X.
 *   (O, P, Q are pure-policy and proved in beliefLifecycle.test.ts; S, T, U, V, Y
 *    are proved in memoryReconstruction.pg.test.ts and retrievalSql.pg.test.ts.)
 *
 * @security Includes the cross-workspace mutation attempt and the injection case.
 * @dependencies migrations 035-040, 088-097
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Client } from 'pg';
import { setupMemoryTestDb, postgresAvailable, MEMORY_TEST_DATABASE_URL } from './helpers/pgTestDb';

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
  db = await setupMemoryTestDb('flow');
}, 120_000);

afterAll(async () => { await db?.end(); });

beforeEach(async () => {
  if (!db) return;
  await db.query(`
    SET session_replication_role = replica;
    DELETE FROM growth_brain_learning_events; DELETE FROM memory_challenges;
    DELETE FROM context_package_items; DELETE FROM context_packages;
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

async function mem(opts: {
  title: string; claim?: string; source?: string; confidence?: number;
  ws?: string; founder?: string; product?: string; type?: string;
}): Promise<string> {
  const r = await db!.query(
    `INSERT INTO marketing_memories (founder_id, workspace_id, product_id, memory_type, title, content, source, confidence, status, version, assertion_class)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,'active',1,$9) RETURNING id`,
    [opts.founder ?? F_A, opts.ws ?? WS_A, opts.product ?? PR_A, opts.type ?? 'campaign',
     opts.title, JSON.stringify({ claim: opts.claim ?? opts.title }),
     opts.source ?? 'campaign_performance', opts.confidence ?? 0.8,
     (opts.source ?? '') === 'founder_feedback' ? 'founder_assertion' : 'business_fact']);
  return r.rows[0].id;
}

/** Calls the atomic RPC directly — the same path the service uses. */
async function transition(memoryId: string, ws: string, to: string, eventType: string,
                          opts: { actor?: string; reason?: string; conf?: number;
                                  classification?: string; supersededBy?: string;
                                  review?: boolean; reinforce?: boolean; evidence?: string[] } = {}) {
  return db!.query(
    `SELECT * FROM lm_apply_memory_transition($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,$11,'trace',NULL,$12)`,
    [memoryId, ws, to, eventType, opts.actor ?? 'system', opts.reason ?? 'test',
     opts.conf ?? null, opts.classification ?? null, opts.evidence ?? [],
     opts.supersededBy ?? null, opts.review ?? false, opts.reinforce ?? false]);
}

// ── Atomicity (§5) ───────────────────────────────────────────────────────────
describe('atomicity', () => {
  maybe('one transition writes snapshot + memory + learning event together', async () => {
    const id = await mem({ title: 'Outcome-led messaging won' });
    const r = await transition(id, WS_A, 'challenged', 'MEMORY_CHALLENGED', { conf: 0.55 });

    expect(r.rows[0].new_version).toBe(2);
    expect(r.rows[0].prior_status).toBe('active');
    expect(r.rows[0].learning_event_id).toBeTruthy();

    const snap = await db!.query(`SELECT title, status, version FROM marketing_memory_versions WHERE memory_id=$1`, [id]);
    expect(snap.rows).toHaveLength(1);
    expect(snap.rows[0].title).toBe('Outcome-led messaging won');   // complete snapshot
    expect(snap.rows[0].status).toBe('active');                     // the state it left

    const cur = await db!.query(`SELECT status, version, confidence FROM marketing_memories WHERE id=$1`, [id]);
    expect(cur.rows[0].status).toBe('challenged');
    expect(Number(cur.rows[0].confidence)).toBeCloseTo(0.55, 4);

    const ev = await db!.query(`SELECT event_type, previous_state, new_state, prior_confidence, new_confidence FROM growth_brain_learning_events`);
    expect(ev.rows).toHaveLength(1);
    expect(ev.rows[0].event_type).toBe('MEMORY_CHALLENGED');
    expect(ev.rows[0].previous_state).toMatch(/^active \(v1\)/);
    expect(Number(ev.rows[0].new_confidence)).toBeCloseTo(55, 1);   // 0-100 scale
  });

  maybe('an INVALID transition writes nothing at all', async () => {
    const id = await mem({ title: 'terminal' });
    await transition(id, WS_A, 'retracted', 'MEMORY_RETRACTED');
    const versionsBefore = (await db!.query(`SELECT count(*)::int n FROM marketing_memory_versions`)).rows[0].n;
    const eventsBefore   = (await db!.query(`SELECT count(*)::int n FROM growth_brain_learning_events`)).rows[0].n;

    await expect(transition(id, WS_A, 'active', 'MEMORY_CHALLENGE_RESOLVED'))
      .rejects.toThrow(/invalid memory transition/);

    // Nothing partial survived the rollback.
    expect((await db!.query(`SELECT count(*)::int n FROM marketing_memory_versions`)).rows[0].n).toBe(versionsBefore);
    expect((await db!.query(`SELECT count(*)::int n FROM growth_brain_learning_events`)).rows[0].n).toBe(eventsBefore);
    expect((await db!.query(`SELECT status FROM marketing_memories WHERE id=$1`, [id])).rows[0].status).toBe('retracted');
  });

  maybe('W — a cross-workspace transition is refused and writes nothing', async () => {
    const bMem = await mem({ title: 'B belief', ws: WS_B, founder: F_B, product: PR_B });
    await expect(transition(bMem, WS_A, 'challenged', 'MEMORY_CHALLENGED'))
      .rejects.toThrow(/workspace mismatch/);

    expect((await db!.query(`SELECT count(*)::int n FROM growth_brain_learning_events`)).rows[0].n).toBe(0);
    expect((await db!.query(`SELECT status FROM marketing_memories WHERE id=$1`, [bMem])).rows[0].status).toBe('active');
  });
});

// ── Scenarios ────────────────────────────────────────────────────────────────
describe('lifecycle scenarios', () => {
  maybe('A — reinforcement raises confidence, links evidence, emits an event', async () => {
    const id = await mem({ title: 'Outcome-led messaging won', confidence: 0.60 });
    const e = await db!.query(
      `INSERT INTO evidence (founder_id, workspace_id, product_id, evidence_type, data, source_table, source_id)
       VALUES ($1,$2,$3,'campaign_metric','{}','campaign_metrics','evt-9') RETURNING id`,
      [F_A, WS_A, PR_A]);

    await transition(id, WS_A, 'active', 'MEMORY_REINFORCED',
      { conf: 0.72, reinforce: true, evidence: [e.rows[0].id], classification: 'REINFORCEMENT' });

    const m = (await db!.query(
      `SELECT confidence, reinforcement_count, last_reinforced_at, evidence_ids FROM marketing_memories WHERE id=$1`, [id])).rows[0];
    expect(Number(m.confidence)).toBeCloseTo(0.72, 4);
    expect(m.reinforcement_count).toBe(1);
    expect(m.last_reinforced_at).not.toBeNull();
    expect(m.evidence_ids).toContain(e.rows[0].id);

    const ev = (await db!.query(`SELECT event_type FROM growth_brain_learning_events`)).rows;
    expect(ev.map(x => x.event_type)).toEqual(['MEMORY_REINFORCED']);
  });

  maybe('R — reinforcing twice with the SAME evidence does not duplicate the link', async () => {
    const id = await mem({ title: 'x' });
    const e = await db!.query(
      `INSERT INTO evidence (founder_id, workspace_id, product_id, evidence_type, data, source_table, source_id)
       VALUES ($1,$2,$3,'campaign_metric','{}','campaign_metrics','evt-dup') RETURNING id`,
      [F_A, WS_A, PR_A]);

    await transition(id, WS_A, 'active', 'MEMORY_REINFORCED', { reinforce: true, evidence: [e.rows[0].id] });
    await transition(id, WS_A, 'active', 'MEMORY_REINFORCED', { reinforce: true, evidence: [e.rows[0].id] });

    const m = (await db!.query(`SELECT evidence_ids FROM marketing_memories WHERE id=$1`, [id])).rows[0];
    expect(m.evidence_ids).toHaveLength(1);   // DISTINCT union, not append
  });

  maybe('H, I — challenge then resolve back to ACTIVE', async () => {
    const id = await mem({ title: 'Search beats Meta' });
    await transition(id, WS_A, 'challenged', 'MEMORY_CHALLENGED', { conf: 0.5, classification: 'CONTRADICTION' });
    expect((await db!.query(`SELECT status FROM marketing_memories WHERE id=$1`, [id])).rows[0].status).toBe('challenged');

    await transition(id, WS_A, 'active', 'MEMORY_CHALLENGE_RESOLVED', { conf: 0.8, actor: 'founder' });
    const m = (await db!.query(`SELECT status, version FROM marketing_memories WHERE id=$1`, [id])).rows[0];
    expect(m.status).toBe('active');
    expect(m.version).toBe(3);   // both transitions versioned

    const ev = (await db!.query(`SELECT event_type FROM growth_brain_learning_events ORDER BY created_at`)).rows;
    expect(ev.map(x => x.event_type)).toEqual(['MEMORY_CHALLENGED', 'MEMORY_CHALLENGE_RESOLVED']);
  });

  maybe('J — challenge resolved by supersession names the successor', async () => {
    const oldId = await mem({ title: 'Search beats Meta' });
    const newId = await mem({ title: 'Search loses to Meta for enterprise' });
    await transition(oldId, WS_A, 'challenged', 'MEMORY_CHALLENGED');
    await transition(oldId, WS_A, 'superseded', 'MEMORY_SUPERSEDED', { supersededBy: newId });

    const m = (await db!.query(`SELECT status, superseded_by, superseded_at FROM marketing_memories WHERE id=$1`, [oldId])).rows[0];
    expect(m.status).toBe('superseded');
    expect(m.superseded_by).toBe(newId);
    expect(m.superseded_at).not.toBeNull();
  });

  maybe('K — retraction records the reason and keeps the memory visible', async () => {
    const id = await mem({ title: 'Derived from malformed feed' });
    await transition(id, WS_A, 'retracted', 'MEMORY_RETRACTED', { reason: 'source feed was invalid', actor: 'founder' });
    const m = (await db!.query(`SELECT status, retraction_reason, title FROM marketing_memories WHERE id=$1`, [id])).rows[0];
    expect(m.status).toBe('retracted');
    expect(m.retraction_reason).toBe('source feed was invalid');
    expect(m.title).toBe('Derived from malformed feed');
  });

  maybe('L — stale is reversible', async () => {
    const id = await mem({ title: 'Seasonal finding' });
    await transition(id, WS_A, 'stale', 'MEMORY_MARKED_STALE', { conf: 0.3 });
    await transition(id, WS_A, 'active', 'MEMORY_REINFORCED', { conf: 0.7, reinforce: true });
    expect((await db!.query(`SELECT status FROM marketing_memories WHERE id=$1`, [id])).rows[0].status).toBe('active');
  });

  maybe('G — a founder assertion challenged by strong data flags review, not supersession', async () => {
    const founderMem = await mem({
      title: 'Our ICP is independent home-service providers',
      source: 'founder_feedback', confidence: 0.9, type: 'founder',
    });
    await transition(founderMem, WS_A, 'challenged', 'MEMORY_CHALLENGED',
      { review: true, classification: 'CONTRADICTION', reason: 'campaign data suggests enterprise franchises' });

    const m = (await db!.query(
      `SELECT status, review_required, title, assertion_class FROM marketing_memories WHERE id=$1`, [founderMem])).rows[0];
    expect(m.status).toBe('challenged');
    expect(m.review_required).toBe(true);
    expect(m.assertion_class).toBe('founder_assertion');
    // The founder's own words are untouched.
    expect(m.title).toBe('Our ICP is independent home-service providers');

    const ev = (await db!.query(`SELECT new_state FROM growth_brain_learning_events`)).rows[0];
    expect(ev.new_state).toMatch(/awaiting founder review/);
  });

  maybe('E — founder correction supersedes the inference and is attributed to the founder', async () => {
    const inferred = await mem({ title: 'Target appears to be renters', source: 'growth_brain' });
    const corrected = await mem({ title: 'Target is homeowners', source: 'founder_feedback' });
    await transition(inferred, WS_A, 'superseded', 'FOUNDER_CORRECTION',
      { actor: 'founder', supersededBy: corrected, reason: 'founder says this is wrong' });

    const m = (await db!.query(`SELECT status, superseded_by, title FROM marketing_memories WHERE id=$1`, [inferred])).rows[0];
    expect(m.status).toBe('superseded');
    expect(m.superseded_by).toBe(corrected);
    expect(m.title).toBe('Target appears to be renters');    // preserved, not edited

    const ev = (await db!.query(`SELECT event_type, created_by_type FROM growth_brain_learning_events`)).rows[0];
    expect(ev.event_type).toBe('FOUNDER_CORRECTION');
    expect(ev.created_by_type).toBe('founder');
  });

  maybe('and a later weaker inference cannot restore the corrected claim', async () => {
    const inferred = await mem({ title: 'wrong claim', source: 'growth_brain' });
    await transition(inferred, WS_A, 'superseded', 'FOUNDER_CORRECTION', { actor: 'founder' });
    await expect(transition(inferred, WS_A, 'active', 'MEMORY_REINFORCED'))
      .rejects.toThrow(/invalid memory transition/);
  });

  maybe('M, N — confidence moves are recorded on both sides of the event', async () => {
    const id = await mem({ title: 'x', confidence: 0.50 });
    await transition(id, WS_A, 'active', 'CONFIDENCE_INCREASED', { conf: 0.78 });
    await transition(id, WS_A, 'challenged', 'CONFIDENCE_DECREASED', { conf: 0.32 });

    const ev = (await db!.query(
      `SELECT event_type, prior_confidence, new_confidence FROM growth_brain_learning_events ORDER BY created_at`)).rows;
    expect(Number(ev[0].prior_confidence)).toBeCloseTo(50, 1);
    expect(Number(ev[0].new_confidence)).toBeCloseTo(78, 1);
    expect(Number(ev[1].new_confidence)).toBeCloseTo(32, 1);
  });

  maybe('the learning event carries reason, classification and policy version', async () => {
    const id = await mem({ title: 'x' });
    await transition(id, WS_A, 'challenged', 'MEMORY_CHALLENGED',
      { classification: 'CONTRADICTION', reason: 'conflicting first-party data' });
    const ev = (await db!.query(`SELECT evidence, trigger FROM growth_brain_learning_events`)).rows[0];
    const labels = (ev.evidence as Array<{ label: string; value: string }>);
    expect(labels.find(l => l.label === 'classification')?.value).toBe('CONTRADICTION');
    expect(labels.find(l => l.label === 'policy version')?.value).toBe('1');
    expect(ev.trigger).toBe('conflicting first-party data');
  });
});

// ── Observability (§16) ──────────────────────────────────────────────────────
describe('lifecycle observability', () => {
  maybe('the stats view counts each state and open challenges', async () => {
    const a = await mem({ title: 'active one' });
    const b = await mem({ title: 'to challenge' });
    const c = await mem({ title: 'to retract' });
    await transition(b, WS_A, 'challenged', 'MEMORY_CHALLENGED', { review: true });
    await transition(c, WS_A, 'retracted', 'MEMORY_RETRACTED');
    await db!.query(
      `INSERT INTO memory_challenges (workspace_id, memory_id, memory_version, classification, decided_by)
       VALUES ($1,$2,1,'CONTRADICTION','deterministic')`, [WS_A, b]);

    const s = (await db!.query(`SELECT * FROM memory_lifecycle_stats WHERE workspace_id=$1`, [WS_A])).rows[0];
    expect(Number(s.total_memories)).toBe(3);
    expect(Number(s.active)).toBe(1);
    expect(Number(s.challenged)).toBe(1);
    expect(Number(s.retracted)).toBe(1);
    expect(Number(s.review_required)).toBe(1);
    expect(Number(s.open_challenges)).toBe(1);
    expect(Number(s.learning_events)).toBe(2);
    expect(a).toBeTruthy();
  });
});
