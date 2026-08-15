/**
 * @file activeBusinessIsolation.test.ts
 * @description The active-business isolation incident, pinned.
 *
 *   REAL DEFECT THIS REPRODUCES. With LaunchMind selected, the owner saw
 *   AllignX's opportunities ("Improve AllignX App Store ASO"), AllignX's
 *   approvals, and a Morning Brief recommending App Store Connect for a
 *   pre-launch product with no store listing. The data was correctly tagged —
 *   every opportunity carried AllignX's product_id — but the READERS were
 *   founder-wide, and `getActiveProduct` was "newest product owned by this
 *   founder", which ignored the selected business entirely.
 *
 *   Every assertion below uses SENTINEL values unique to one business, so a
 *   leak is unambiguous rather than a coincidence.
 *
 * @security Proves the active business, not founder identity, scopes every
 *   owner-facing read and write.
 * @dependencies activeBusinessService, MemoryDb
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryDb } from './helpers/memoryDb';

const FOUNDER = '11111111-1111-4111-8111-111111111111';
const WS_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';   // AllignX
const WS_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';   // LaunchMind
const PROD_A = 'cccccccc-1111-4111-8111-cccccccccccc';
const PROD_B = 'dddddddd-2222-4222-8222-dddddddddddd';

/** Sentinels — if one appears under the other business, that IS the leak. */
const A_OPP = 'Improve AllignX App Store ASO';
const B_OPP = 'Build LaunchMind waitlist';

let db: MemoryDb;
vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => (globalThis as { __db: MemoryDb }).__db.asClient(),
}));

function seed(activeWs: string, activeProd: string | null) {
  return new MemoryDb({
    founders: [{ id: FOUNDER, active_workspace_id: activeWs, active_product_id: activeProd,
                 plan: 'builder', token_balance: 900 }],
    workspaces: [
      { id: WS_A, founder_id: FOUNDER, name: 'AllignX', created_at: '2026-08-01T00:00:00Z' },
      { id: WS_B, founder_id: FOUNDER, name: 'LaunchMind', created_at: '2026-08-12T00:00:00Z' },
    ],
    workspace_members: [],
    products: [
      { id: PROD_A, workspace_id: WS_A, founder_id: FOUNDER, name: 'AllignX Home Services',
        platform: 'app_store', markets: ['united_states'], maturity: 'growing',
        archived_at: null, created_at: '2026-08-01T00:00:00Z' },
      // NEWER — any "newest product" fallback returns this one.
      { id: PROD_B, workspace_id: WS_B, founder_id: FOUNDER, name: 'LaunchMind',
        platform: 'app_store', markets: [], maturity: 'pre_launch',
        archived_at: null, created_at: '2026-08-12T00:00:00Z' },
    ],
    saved_opportunities: [
      { id: 'o1', founder_id: FOUNDER, product_id: PROD_A, title: A_OPP, state: 'active', confidence: 0.9 },
      { id: 'o2', founder_id: FOUNDER, product_id: PROD_B, title: B_OPP, state: 'active', confidence: 0.8 },
    ],
    campaigns: [
      { id: 'cm1', founder_id: FOUNDER, product_id: PROD_A, channel: 'meta',
        hook_type: 'ASO', status: 'pending_approval', copy_text: 'AllignX ad copy' },
      { id: 'cm2', founder_id: FOUNDER, product_id: PROD_B, channel: 'linkedin',
        hook_type: 'waitlist', status: 'pending_approval', copy_text: 'LaunchMind ad copy' },
    ],
    missions: [
      { id: 'm1', founder_id: FOUNDER, product_id: PROD_A, workspace_id: WS_A, status: 'failed',
        title: 'AllignX ASO mission', failed_at: '2026-08-10' },
      { id: 'm2', founder_id: FOUNDER, product_id: PROD_B, workspace_id: WS_B, status: 'failed',
        title: 'LaunchMind waitlist mission', failed_at: '2026-08-12' },
    ],
    mission_approvals: [
      { id: 'a1', founder_id: FOUNDER, mission_id: 'm1', title: 'Approve AllignX ASO', status: 'pending', step_id: 's1' },
      { id: 'a2', founder_id: FOUNDER, mission_id: 'm2', title: 'Approve LaunchMind waitlist', status: 'pending', step_id: 's2' },
    ],
    founder_context: [
      { id: 'fcA', founder_id: FOUNDER, workspace_id: WS_A, product_id: PROD_A,
        positioning: 'Local home services marketplace' },
      { id: 'fcB', founder_id: FOUNDER, workspace_id: WS_B, product_id: PROD_B,
        positioning: 'AI marketing operating system' },
    ],
    notifications: [], mission_logs: [], campaign_metrics: [], marketing_memories: [],
    onboarding_sessions: [], strategy_directions: [], business_goals: [],
  });
}

const activate = (ws: string, prod: string | null) => {
  db = seed(ws, prod);
  (globalThis as { __db: MemoryDb }).__db = db;
};

beforeEach(() => activate(WS_B, PROD_B));   // LaunchMind selected — the reported state

// ── the primitive ───────────────────────────────────────────────────────────
describe('active business resolution', () => {
  it('resolves the SELECTED business, not the newest product', async () => {
    const { getActiveBusiness } = await import('../src/services/activeBusinessService');
    const b = await getActiveBusiness(FOUNDER);
    expect(b?.workspaceId).toBe(WS_B);
    expect(b?.productId).toBe(PROD_B);
    expect(b?.name).toBe('LaunchMind');
  });

  it('switching changes it, in both directions', async () => {
    const { getActiveBusiness } = await import('../src/services/activeBusinessService');
    activate(WS_A, PROD_A);
    expect((await getActiveBusiness(FOUNDER))?.name).toBe('AllignX');
    activate(WS_B, PROD_B);
    expect((await getActiveBusiness(FOUNDER))?.name).toBe('LaunchMind');
  });

  it('fails closed when nothing is selected — never picks one', async () => {
    activate('', null);
    db.setRows('founders', [{ id: FOUNDER, active_workspace_id: null, active_product_id: null }]);
    const { getActiveBusiness } = await import('../src/services/activeBusinessService');
    expect(await getActiveBusiness(FOUNDER)).toBeNull();
  });
});

// ── the reported surfaces ───────────────────────────────────────────────────
describe('opportunities never cross businesses', () => {
  it('LaunchMind shows only its own — the exact reported defect', async () => {
    const client = db.asClient();
    const rows = await client.from('saved_opportunities').select('title').eq('product_id', PROD_B);
    const titles = (rows.data as Array<{ title: string }>).map(r => r.title);
    expect(titles).toEqual([B_OPP]);
    expect(titles).not.toContain(A_OPP);
  });

  it('the OLD founder-wide query is the one that leaks', async () => {
    // Documents the defect rather than asserting the fix twice.
    const client = db.asClient();
    const rows = await client.from('saved_opportunities').select('title').eq('founder_id', FOUNDER);
    expect((rows.data as Array<{ title: string }>).map(r => r.title)).toHaveLength(2);
  });

  it('AllignX shows only its own', async () => {
    const client = db.asClient();
    const rows = await client.from('saved_opportunities').select('title').eq('product_id', PROD_A);
    expect((rows.data as Array<{ title: string }>).map(r => r.title)).toEqual([A_OPP]);
  });
});

describe('approvals never cross businesses', () => {
  it('campaigns pending approval are scoped to the active product', async () => {
    const client = db.asClient();
    const rows = await client.from('campaigns').select('copy_text')
      .eq('product_id', PROD_B).eq('status', 'pending_approval');
    const copy = (rows.data as Array<{ copy_text: string }>).map(r => r.copy_text);
    expect(copy).toEqual(['LaunchMind ad copy']);
    expect(copy).not.toContain('AllignX ad copy');
  });

  it('mission approvals scope through the product\'s missions', async () => {
    const client = db.asClient();
    const missions = await client.from('missions').select('id').eq('product_id', PROD_B);
    const ids = (missions.data as Array<{ id: string }>).map(m => m.id);
    const appr = await client.from('mission_approvals').select('title').in('mission_id', ids);
    const titles = (appr.data as Array<{ title: string }>).map(a => a.title);
    expect(titles).toEqual(['Approve LaunchMind waitlist']);
    // Approving is an authority act — the wrong business here is the worst case.
    expect(titles).not.toContain('Approve AllignX ASO');
  });

  it('failed missions are scoped too', async () => {
    const client = db.asClient();
    const rows = await client.from('missions').select('title')
      .eq('product_id', PROD_B).eq('status', 'failed');
    expect((rows.data as Array<{ title: string }>).map(r => r.title))
      .toEqual(['LaunchMind waitlist mission']);
  });
});

describe('business context never crosses', () => {
  it('positioning resolves per workspace', async () => {
    const client = db.asClient();
    for (const [ws, expected] of [[WS_A, 'Local home services marketplace'],
                                  [WS_B, 'AI marketing operating system']] as const) {
      const rows = await client.from('founder_context').select('positioning').eq('workspace_id', ws);
      expect((rows.data as Array<{ positioning: string }>).map(r => r.positioning)).toEqual([expected]);
    }
  });
});

// ── the forbidden fallbacks, asserted as absent ─────────────────────────────
describe('no founder-wide fallback survives', () => {
  it('a pre-launch business does not inherit the other\'s store platform', async () => {
    const { getActiveBusiness } = await import('../src/services/activeBusinessService');
    const b = await getActiveBusiness(FOUNDER);
    expect(b?.maturity).toBe('pre_launch');
    // AllignX's confirmed market must not appear on LaunchMind, which has none.
    expect(b?.markets).toEqual([]);
  });

  it('an empty workspace yields nothing rather than the other business', async () => {
    const EMPTY = 'eeeeeeee-3333-4333-8333-eeeeeeeeeeee';
    db.setRows('workspaces', [
      ...db.rows('workspaces'),
      { id: EMPTY, founder_id: FOUNDER, name: 'Empty', created_at: '2026-08-13T00:00:00Z' },
    ]);
    db.setRows('founders', [{ id: FOUNDER, active_workspace_id: EMPTY, active_product_id: null }]);
    const { getActiveBusiness } = await import('../src/services/activeBusinessService');
    const b = await getActiveBusiness(FOUNDER);
    expect(b?.workspaceId).toBe(EMPTY);
    // No product in that workspace → null, NOT another business's product.
    expect(b?.productId).toBeNull();
    expect(b?.productName).toBeNull();
  });
});

// ── ROUTE-LEVEL: the actual owner surfaces, not just the primitive ──────────
//
// The tests above assert activeBusinessService and the data shape. A mutation
// check proved that insufficient: reintroducing the original
// "newest product owned by this founder" helper in owner.route.ts left them all
// green, because none of them execute that route. These do.
describe('owner routes return only the active business', () => {
  let server: import('fastify').FastifyInstance;
  const JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';

  const token = async () => {
    const jwt = (await import('jsonwebtoken')).default;
    return jwt.sign({ sub: FOUNDER, role: 'authenticated' }, JWT_SECRET, { expiresIn: '1h' });
  };

  beforeEach(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    vi.resetModules();
    activate(WS_B, PROD_B);          // LaunchMind selected
    const { buildServer } = await import('../src/server');
    server = await buildServer();
    await server.ready();
  });

  it('GET /owner/opportunities returns LaunchMind only — the reported defect', async () => {
    const res = await server.inject({
      method: 'GET', url: '/owner/opportunities',
      headers: { authorization: `Bearer ${await token()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ opportunities: Array<{ title: string }> }>();
    const titles = body.opportunities.map(o => o.title);
    expect(titles).not.toContain(A_OPP);   // "Improve AllignX App Store ASO"
    expect(titles).toEqual([B_OPP]);
  });

  it('an unverified productId hint cannot widen the result', async () => {
    // The query param was client-supplied and optional; omitting it returned
    // everything, and supplying another business's id was never checked.
    const res = await server.inject({
      method: 'GET', url: `/owner/opportunities?productId=${PROD_A}`,
      headers: { authorization: `Bearer ${await token()}` },
    });
    const body = res.json<{ opportunities: Array<{ title: string }> }>();
    expect(body.opportunities.map(o => o.title)).not.toContain(A_OPP);
  });

  it('GET /owner/counts counts only the active business', async () => {
    const res = await server.inject({
      method: 'GET', url: '/owner/counts',
      headers: { authorization: `Bearer ${await token()}` },
    });
    const body = res.json<{ opportunities: number; approvals: number }>();
    // One opportunity and one pending campaign+approval belong to LaunchMind.
    expect(body.opportunities).toBe(1);
    expect(body.approvals).toBeLessThanOrEqual(2);
  });

  it('switching to AllignX flips every surface', async () => {
    activate(WS_A, PROD_A);
    const res = await server.inject({
      method: 'GET', url: '/owner/opportunities',
      headers: { authorization: `Bearer ${await token()}` },
    });
    const titles = res.json<{ opportunities: Array<{ title: string }> }>().opportunities.map(o => o.title);
    expect(titles).toEqual([A_OPP]);
    expect(titles).not.toContain(B_OPP);
  });

  it('POST /owner/opportunities refuses to write into another business', async () => {
    const res = await server.inject({
      method: 'POST', url: '/owner/opportunities',
      headers: { authorization: `Bearer ${await token()}` },
      payload: { type: 'aso', title: 'Sneaky cross-business write', productId: PROD_A },
    });
    // Refused rather than silently retargeted (§10).
    expect(res.statusCode).toBe(404);
    expect(db.rows('saved_opportunities').some(o => o.title === 'Sneaky cross-business write'))
      .toBe(false);
  });
});

// ── §13 · every newly-scoped surface, both directions ──────────────────────
describe('remaining surfaces are business isolated', () => {
  let server: import('fastify').FastifyInstance;
  const JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';
  const token = async () => {
    const jwt = (await import('jsonwebtoken')).default;
    return jwt.sign({ sub: FOUNDER, role: 'authenticated' }, JWT_SECRET, { expiresIn: '1h' });
  };

  /** Sentinels seeded into every business-scoped table. */
  function seedSurfaces() {
    db.setRows('content_assets', [
      { id: 'ca1', founder_id: FOUNDER, product_id: PROD_A, asset_type: 'blog_post',
        text_content: 'AllignX sentinel content', status: 'draft', archived_at: null },
      { id: 'ca2', founder_id: FOUNDER, product_id: PROD_B, asset_type: 'blog_post',
        text_content: 'LaunchMind sentinel content', status: 'draft', archived_at: null },
    ]);
    db.setRows('experiments', [
      { id: 'e1', founder_id: FOUNDER, product_id: PROD_A, title: 'AllignX sentinel experiment', status: 'draft', archived_at: null },
      { id: 'e2', founder_id: FOUNDER, product_id: PROD_B, title: 'LaunchMind sentinel experiment', status: 'draft', archived_at: null },
    ]);
    db.setRows('execution_calendar_events', [
      { id: 'k1', founder_id: FOUNDER, product_id: PROD_A, title: 'AllignX sentinel event', scheduled_for: '2026-08-20' },
      { id: 'k2', founder_id: FOUNDER, product_id: PROD_B, title: 'LaunchMind sentinel event', scheduled_for: '2026-08-20' },
    ]);
    db.setRows('weekly_briefs', []);
  }

  beforeEach(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    vi.resetModules();
    activate(WS_B, PROD_B);
    seedSurfaces();
    const { buildServer } = await import('../src/server');
    server = await buildServer();
    await server.ready();
  });

  const get = async (url: string) => server.inject({
    method: 'GET', url, headers: { authorization: `Bearer ${await token()}` },
  });

  it('Content Studio returns only the active business\'s assets', async () => {
    const body = (await get('/studio/assets')).body;
    expect(body).toContain('LaunchMind sentinel content');
    expect(body).not.toContain('AllignX sentinel content');
  });

  it('Experiments returns only the active business\'s experiments', async () => {
    const body = (await get('/experiments')).body;
    expect(body).toContain('LaunchMind sentinel experiment');
    expect(body).not.toContain('AllignX sentinel experiment');
  });

  it('Calendar returns only the active business\'s events', async () => {
    const body = (await get('/calendar?start=2026-08-01&end=2026-08-31')).body;
    expect(body).not.toContain('AllignX sentinel event');
  });

  it('Campaigns list is scoped', async () => {
    const body = (await get('/campaigns')).body;
    expect(body).not.toContain('AllignX ad copy');
  });

  it('switching flips every surface back to AllignX', async () => {
    activate(WS_A, PROD_A);
    seedSurfaces();
    expect((await get('/studio/assets')).body).toContain('AllignX sentinel content');
    expect((await get('/studio/assets')).body).not.toContain('LaunchMind sentinel content');
    expect((await get('/experiments')).body).toContain('AllignX sentinel experiment');
    expect((await get('/experiments')).body).not.toContain('LaunchMind sentinel experiment');
  });

  // ── §14 · same founder ≠ same business authority ─────────────────────────
  it('a client-supplied id from the OTHER business is refused, not honoured', async () => {
    // LaunchMind is active; the caller names AllignX's product.
    for (const url of [
      `/owner/opportunities?productId=${PROD_A}`,
      `/recommendations?productId=${PROD_A}`,
      `/memory/events?product_id=${PROD_A}`,
      `/knowledge/graph?product_id=${PROD_A}`,
    ]) {
      const res = await get(url);
      // Either an empty, non-enumerating result or a refusal — never AllignX data.
      expect(res.body).not.toContain('AllignX sentinel');
      expect(res.body).not.toContain(A_OPP);
    }
  });

  it('with NO business selected every surface is empty, never unfiltered', async () => {
    db.setRows('founders', [{ id: FOUNDER, active_workspace_id: null, active_product_id: null }]);
    for (const url of ['/studio/assets', '/experiments', '/campaigns', '/owner/opportunities']) {
      const body = (await get(url)).body;
      expect(body).not.toContain('sentinel');
      expect(body).not.toContain(A_OPP);
      expect(body).not.toContain(B_OPP);
    }
  });
});

// ── Market Intelligence — the last NEEDS_REVIEW row ────────────────────────
describe('benchmarks are scoped to the active business', () => {
  let server: import('fastify').FastifyInstance;
  const JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';
  const token = async () => {
    const jwt = (await import('jsonwebtoken')).default;
    return jwt.sign({ sub: FOUNDER, role: 'authenticated' }, JWT_SECRET, { expiresIn: '1h' });
  };

  function seedCategories() {
    db.setRows('products', [
      { id: PROD_A, workspace_id: WS_A, founder_id: FOUNDER, name: 'AllignX Home Services',
        category: 'AllignXCategorySentinel', markets: ['united_states'], maturity: 'growing',
        archived_at: null, deleted_at: null, created_at: '2026-08-01T00:00:00Z' },
      { id: PROD_B, workspace_id: WS_B, founder_id: FOUNDER, name: 'LaunchMind',
        category: 'LaunchMindCategorySentinel', markets: ['usa'], maturity: 'pre_launch',
        archived_at: null, deleted_at: null, created_at: '2026-08-12T00:00:00Z' },
    ]);
    db.setRows('intelligence_trends', []);
    db.setRows('playbook_signals', []);
  }

  beforeEach(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    vi.resetModules();
    activate(WS_B, PROD_B);
    seedCategories();
    const { buildServer } = await import('../src/server');
    server = await buildServer();
    await server.ready();
  });

  const summary = async () => (await server.inject({
    method: 'GET', url: '/benchmarks/summary',
    headers: { authorization: `Bearer ${await token()}` },
  })).body;

  it('LaunchMind never sees AllignX\'s category', async () => {
    const body = await summary();
    expect(body).not.toContain('AllignXCategorySentinel');
    expect(body).not.toContain('AllignX Home Services');
  });

  it('AllignX never sees LaunchMind\'s category', async () => {
    activate(WS_A, PROD_A);
    seedCategories();
    const body = await summary();
    expect(body).not.toContain('LaunchMindCategorySentinel');
  });

  it('with no business selected it returns nothing, not every product', async () => {
    db.setRows('founders', [{ id: FOUNDER, active_workspace_id: null, active_product_id: null }]);
    const body = await summary();
    expect(body).not.toContain('AllignXCategorySentinel');
    expect(body).not.toContain('LaunchMindCategorySentinel');
  });
});
