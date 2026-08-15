/**
 * @file opportunityBadgeConsistency.test.ts
 * @description Proves the sidebar Opportunities badge and the Opportunities "All"
 *   list cannot describe different populations for the same active business.
 *
 *   WHY THIS TEST IS SHAPED THIS WAY:
 *     Asserting "both return 2" against today's fixture would pass even if the two
 *     endpoints went back to using different state predicates, because the current
 *     data happens to contain no row where those predicates disagree. So the test
 *     seeds a row in EVERY state the product can produce — including `converted`,
 *     the state that made the two silently diverge — and asserts the count equals
 *     the list length. It also runs a MUTATION check: reintroducing the old
 *     `.in('state',['active','saved'])` semantics must break it.
 *
 * @security Exercises the real routes through server.inject so route-layer active
 *   business scoping is included, not bypassed.
 * @dependencies owner.route, opportunityBacklog, MemoryDb
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { MemoryDb } from './helpers/memoryDb';
import { applyBacklogFilter, isBacklogState } from '../src/services/opportunityBacklog';

const FOUNDER    = '8a292044-5b22-42e5-90d0-65e6cc3d7321';
const JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';
const token = () => jwt.sign({ sub: FOUNDER, role: 'authenticated', email: 'o@example.test' },
  JWT_SECRET, { expiresIn: '1h' });
const WS_A      = 'aaaaaaaa-0000-4000-8000-000000000001';
const WS_B      = 'bbbbbbbb-0000-4000-8000-000000000002';
const PROD_A    = 'aaaaaaaa-1111-4000-8000-000000000001';
const PROD_B    = 'bbbbbbbb-1111-4000-8000-000000000002';

/** Every state a saved_opportunity can hold. */
const ALL_STATES = ['active', 'saved', 'converted', 'dismissed'] as const;

const db = new MemoryDb();

vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => db.asClient(),
}));
vi.mock('../src/lib/aiPlatform', () => ({
  callSonnet: vi.fn(async () => JSON.stringify({ summary: '', recommendedAction: '' })),
}));
vi.mock('../src/lib/context/contextEngineAdapter', () => ({
  buildContextForPrompt: vi.fn(async () => ''),
}));

/** Seeds two businesses; the ACTIVE one gets one opportunity per state. */
function seed(activeWorkspace: string) {
  ['saved_opportunities','campaigns','missions','mission_approvals','notifications',
   'founders','workspaces','products','workspace_members'].forEach(t => db.setRows(t, []));
  db.setRows('founders', [{
    id: FOUNDER, email: 'o@example.com', plan: 'solo',
    active_workspace_id: activeWorkspace, active_product_id: null,
  }]);
  db.setRows('workspaces', [
    { id: WS_A, founder_id: FOUNDER, name: 'Business A', created_at: '2026-01-01T00:00:00Z' },
    { id: WS_B, founder_id: FOUNDER, name: 'Business B', created_at: '2026-02-01T00:00:00Z' },
  ]);
  db.setRows('products', [
    { id: PROD_A, founder_id: FOUNDER, workspace_id: WS_A, name: 'Product A',
      platform: 'app_store', markets: ['usa'], archived_at: null, created_at: '2026-01-02T00:00:00Z' },
    { id: PROD_B, founder_id: FOUNDER, workspace_id: WS_B, name: 'Product B',
      platform: 'play_store', markets: ['usa'], archived_at: null, created_at: '2026-02-02T00:00:00Z' },
  ]);

  const rows: Array<Record<string, unknown>> = [];
  ALL_STATES.forEach((state, i) => {
    // One row per state in BOTH businesses, so a leak would also be visible.
    rows.push({ id: `aaaaaaaa-2222-4000-8000-00000000000${i}`, founder_id: FOUNDER,
      product_id: PROD_A, title: `A ${state}`, state, confidence: 0.5,
      evidence: [], created_at: `2026-03-0${i + 1}T00:00:00Z` });
    rows.push({ id: `bbbbbbbb-2222-4000-8000-00000000000${i}`, founder_id: FOUNDER,
      product_id: PROD_B, title: `B ${state}`, state, confidence: 0.5,
      evidence: [], created_at: `2026-03-0${i + 1}T00:00:00Z` });
  });
  db.setRows('saved_opportunities', rows);

}

let server: FastifyInstance;

beforeAll(async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  const { buildServer } = await import('../src/server');
  server = await buildServer();
});
afterAll(async () => { await server?.close(); });

async function badgeCount(): Promise<number> {
  const res = await server.inject({ method: 'GET', url: '/owner/counts',
    headers: { authorization: `Bearer ${token()}` } });
  return (res.json() as { opportunities: number }).opportunities;
}

async function allTab(): Promise<Array<{ title: string; state: string }>> {
  const res = await server.inject({ method: 'GET', url: '/owner/opportunities?state=all',
    headers: { authorization: `Bearer ${token()}` } });
  return (res.json() as { opportunities: Array<{ title: string; state: string }> }).opportunities;
}

describe('opportunity badge / page consistency', () => {
  it('badge equals the All population for the active business', async () => {
    seed(WS_A);
    const badge = await badgeCount();
    const page  = await allTab();

    expect(badge).toBe(page.length);
    // And it is the RIGHT population, not merely an equal wrong one.
    expect(page.every(o => isBacklogState(o.state))).toBe(true);
    expect(page.some(o => o.state === 'dismissed')).toBe(false);
  });

  it('counts `converted` identically on both sides (the state that diverged)', async () => {
    seed(WS_A);
    const page = await allTab();
    // The page deliberately still lists converted rows; the badge must agree.
    expect(page.some(o => o.state === 'converted')).toBe(true);
    expect(await badgeCount()).toBe(page.length);
  });

  it('recomputes independently per active business (A -> B -> A)', async () => {
    for (const [ws, prefix] of [[WS_A, 'A'], [WS_B, 'B'], [WS_A, 'A']] as const) {
      seed(ws);
        const page = await allTab();
      expect(await badgeCount()).toBe(page.length);
      // No row from the other business on either side.
      expect(page.every(o => o.title.startsWith(prefix))).toBe(true);
      }
  });

  it('stays equal after a dismiss and after a create', async () => {
    seed(WS_A);
    const before = await badgeCount();

    // Dismiss one active row through the real route.
    const target = db.rows('saved_opportunities')
      .find(r => r.product_id === PROD_A && r.state === 'active')!;
    const patched = await server.inject({ method: 'PATCH', url: `/owner/opportunities/${target.id}`,
      headers: { authorization: `Bearer ${token()}` }, payload: { state: 'dismissed' } });
    // Asserted so an auth or routing failure cannot make the counts "agree"
    // simply because nothing changed — that is how this test first passed.
    expect(patched.statusCode).toBe(200);
    expect(db.rows('saved_opportunities').find(r => r.id === target.id)!.state).toBe('dismissed');

    expect(await badgeCount()).toBe((await allTab()).length);
    expect(await badgeCount()).toBe(before - 1);

    // Create one through the real route.
    const created = await server.inject({ method: 'POST', url: '/owner/opportunities',
      headers: { authorization: `Bearer ${token()}` },
      payload: { type: 'seo_content', title: 'Newly created', description: 'd' } });
    expect(created.statusCode).toBe(201);

    expect(await badgeCount()).toBe((await allTab()).length);
  });

  it('MUTATION: the old .in(active,saved) badge semantics must fail this suite', async () => {
    seed(WS_A);
    const page = await allTab();

    // Reproduce the pre-fix badge query verbatim against the same data.
    const legacy = db.asClient().from('saved_opportunities')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', PROD_A)
      .in('state', ['active', 'saved']);
    const legacyCount = (await legacy).count ?? 0;

    // If this ever becomes equal, the fixture stopped covering the divergence and
    // the rest of this suite would be vacuous.
    expect(legacyCount).not.toBe(page.length);
    expect(await badgeCount()).toBe(page.length);
  });

  it('applyBacklogFilter only ever narrows a query', async () => {
    seed(WS_A);
    const scoped = db.asClient().from('saved_opportunities').select('*').eq('product_id', PROD_A);
    const all = (await scoped).data ?? [];
    const filtered = (await applyBacklogFilter(
      db.asClient().from('saved_opportunities').select('*').eq('product_id', PROD_A),
    )).data ?? [];
    expect(filtered.length).toBeLessThanOrEqual(all.length);
    expect(filtered.every((r: { state: string }) => isBacklogState(r.state))).toBe(true);
  });
});
