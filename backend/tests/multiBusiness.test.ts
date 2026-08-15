/**
 * @file multiBusiness.test.ts
 * @description Same founder, two businesses — the Phase 3.2A validation case.
 *
 *   The switcher makes `active_workspace_id` the authoritative context for every
 *   dashboard read, so two properties have to hold or the whole feature is a
 *   cross-tenant leak with a nice dropdown:
 *
 *     1. Changing the active business is AUTHORIZED, not merely recorded. It
 *        previously wrote whatever id the caller sent, with no membership check.
 *     2. Resolution is EXPLICIT. No "first product", no "newest", no founder-wide
 *        fallback — those are what blended two businesses before.
 *
 *   Values are deliberately contradictory between A and B, so a leak reads as a
 *   wrong answer rather than a plausible one.
 *
 * @security Proves a client-supplied workspace id is context, never authority.
 * @dependencies activeBusinessService, workspaceService, MemoryDb
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryDb } from './helpers/memoryDb';

const FOUNDER   = '11111111-1111-4111-8111-111111111111';
const OUTSIDER  = '99999999-9999-4999-8999-999999999999';
const WS_A      = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';   // AllignX
const WS_B      = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';   // LaunchMind
const WS_FOREIGN = 'ffffffff-3333-4333-8333-ffffffffffff';  // someone else's
const PROD_A    = 'cccccccc-1111-4111-8111-cccccccccccc';
const PROD_B    = 'dddddddd-2222-4222-8222-dddddddddddd';

let db: MemoryDb;
vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => (globalThis as { __db: MemoryDb }).__db.asClient(),
}));

function seed(activeWs: string | null = WS_A) {
  return new MemoryDb({
    founders: [
      { id: FOUNDER, active_workspace_id: activeWs, active_product_id: null },
      { id: OUTSIDER, active_workspace_id: null, active_product_id: null },
    ],
    workspaces: [
      { id: WS_A, founder_id: FOUNDER, name: 'AllignX', created_at: '2026-08-01T00:00:00Z' },
      { id: WS_B, founder_id: FOUNDER, name: 'LaunchMind', created_at: '2026-08-12T00:00:00Z' },
      { id: WS_FOREIGN, founder_id: OUTSIDER, name: 'Someone Else', created_at: '2026-07-01T00:00:00Z' },
    ],
    workspace_members: [],
    products: [
      { id: PROD_A, workspace_id: WS_A, founder_id: FOUNDER, name: 'Home Services App',
        platform: 'app_store', markets: ['united_states'], maturity: 'growing',
        archived_at: null, created_at: '2026-08-01T00:00:00Z' },
      // NEWER than A on purpose: any "newest product" fallback would pick this.
      { id: PROD_B, workspace_id: WS_B, founder_id: FOUNDER, name: 'AI Growth Operating System',
        platform: 'app_store', markets: [], maturity: 'pre_launch',
        archived_at: null, created_at: '2026-08-12T00:00:00Z' },
    ],
  });
}

beforeEach(() => {
  db = seed();
  (globalThis as { __db: MemoryDb }).__db = db;
});

// ── switching is authorized, not merely recorded ────────────────────────────
describe('changing the active business is authorized', () => {
  it('refuses a workspace the founder does not belong to', async () => {
    const { setActiveWorkspace } = await import('../src/services/workspaceService');
    // The exact attack the old code allowed: point my active business at yours.
    await expect(setActiveWorkspace(FOUNDER, WS_FOREIGN)).rejects.toThrow(/not found|denied/i);

    const founder = db.rows('founders').find(f => f.id === FOUNDER)!;
    expect(founder.active_workspace_id).toBe(WS_A);   // unchanged
  });

  it('the refusal is 404-shaped so it cannot enumerate other tenants', async () => {
    const { setActiveWorkspace } = await import('../src/services/workspaceService');
    // A workspace that exists but is not mine, and one that does not exist at
    // all, must be indistinguishable.
    const a = await setActiveWorkspace(FOUNDER, WS_FOREIGN).catch(e => e);
    const b = await setActiveWorkspace(FOUNDER, '00000000-0000-4000-8000-000000000000').catch(e => e);
    expect(a.statusCode).toBe(404);
    expect(b.statusCode).toBe(404);
    expect(a.message).toBe(b.message);
  });

  it('allows a workspace the founder owns', async () => {
    const { setActiveWorkspace } = await import('../src/services/workspaceService');
    await setActiveWorkspace(FOUNDER, WS_B);
    expect(db.rows('founders').find(f => f.id === FOUNDER)!.active_workspace_id).toBe(WS_B);
  });

  it('refuses a product from a DIFFERENT business than the one being activated', async () => {
    // Would produce the split-brain state the switcher exists to prevent:
    // header showing LaunchMind, content scoped to AllignX.
    const { setActiveWorkspace } = await import('../src/services/workspaceService');
    await expect(setActiveWorkspace(FOUNDER, WS_B, PROD_A)).rejects.toThrow(/not found/i);
    expect(db.rows('founders').find(f => f.id === FOUNDER)!.active_workspace_id).toBe(WS_A);
  });
});

// ── resolution is explicit and fails closed ─────────────────────────────────
describe('active business resolution is explicit', () => {
  it('resolves the SELECTED business, not the newest product', async () => {
    const { getActiveBusiness } = await import('../src/services/activeBusinessService');
    const active = await getActiveBusiness(FOUNDER);
    expect(active?.workspaceId).toBe(WS_A);
    expect(active?.name).toBe('AllignX');
    // PROD_B is newer. A `products.find(...)` / "newest" fallback returns it.
    expect(active?.productName).toBe('Home Services App');
  });

  it('returns null when nothing is selected — never a guess', async () => {
    db = seed(null);
    (globalThis as { __db: MemoryDb }).__db = db;
    const { getActiveBusiness } = await import('../src/services/activeBusinessService');
    expect(await getActiveBusiness(FOUNDER)).toBeNull();
  });

  it('returns null for a stale pointer to a workspace no longer usable', async () => {
    db = seed(WS_FOREIGN);   // pointer set to a workspace the founder cannot use
    (globalThis as { __db: MemoryDb }).__db = db;
    const { getActiveBusiness } = await import('../src/services/activeBusinessService');
    // Fails closed rather than falling back to an owned workspace.
    expect(await getActiveBusiness(FOUNDER)).toBeNull();
  });

  it('scopes the product to the resolved workspace', async () => {
    const { setActiveWorkspace } = await import('../src/services/workspaceService');
    const { getActiveBusiness } = await import('../src/services/activeBusinessService');
    await setActiveWorkspace(FOUNDER, WS_B);
    const active = await getActiveBusiness(FOUNDER);
    expect(active?.productName).toBe('AI Growth Operating System');
    expect(active?.maturity).toBe('pre_launch');
    // A's confirmed market must not appear on B, which has none confirmed.
    expect(active?.markets).toEqual([]);
  });
});

// ── the switcher list ───────────────────────────────────────────────────────
describe('business list', () => {
  it('lists both businesses with exactly one active', async () => {
    const { listBusinesses } = await import('../src/services/activeBusinessService');
    const list = await listBusinesses(FOUNDER);
    expect(list.map(b => b.name).sort()).toEqual(['AllignX', 'LaunchMind']);
    expect(list.filter(b => b.isActive).map(b => b.name)).toEqual(['AllignX']);
  });

  it('pairs each business with its OWN product', async () => {
    const { listBusinesses } = await import('../src/services/activeBusinessService');
    const list = await listBusinesses(FOUNDER);
    const byName = Object.fromEntries(list.map(b => [b.name, b]));
    expect(byName.AllignX.productName).toBe('Home Services App');
    expect(byName.LaunchMind.productName).toBe('AI Growth Operating System');
    expect(byName.AllignX.workspaceId).not.toBe(byName.LaunchMind.workspaceId);
  });

  it('never lists another founder\'s business', async () => {
    const { listBusinesses } = await import('../src/services/activeBusinessService');
    const list = await listBusinesses(FOUNDER);
    expect(list.map(b => b.workspaceId)).not.toContain(WS_FOREIGN);
    // And the outsider sees only their own.
    expect((await listBusinesses(OUTSIDER)).map(b => b.name)).toEqual(['Someone Else']);
  });

  it('switching does not alter what the founder is allowed to see', async () => {
    const { setActiveWorkspace } = await import('../src/services/workspaceService');
    const { listBusinesses } = await import('../src/services/activeBusinessService');
    const before = (await listBusinesses(FOUNDER)).map(b => b.workspaceId).sort();
    await setActiveWorkspace(FOUNDER, WS_B);
    const after = (await listBusinesses(FOUNDER)).map(b => b.workspaceId).sort();
    // Authorization is membership, not selection. Switching changes context only.
    expect(after).toEqual(before);
  });
});

// ── business-scoped data never crosses ──────────────────────────────────────
describe('contradictory A/B state never crosses', () => {
  beforeEach(() => {
    db.setRows('founder_context', [
      { id: 'fcA', founder_id: FOUNDER, workspace_id: WS_A, product_id: PROD_A,
        positioning: 'Local home services marketplace', context_delta: 'Expanding to Tucson' },
      { id: 'fcB', founder_id: FOUNDER, workspace_id: WS_B, product_id: PROD_B,
        positioning: 'AI marketing operating system', context_delta: 'Pre-launch, no spend' },
    ]);
    db.setRows('approval_boundary_policies', [
      { id: 'abA', founder_id: FOUNDER, workspace_id: WS_A, product_id: PROD_A,
        explicit_capabilities: { SPEND: 'never' } },
      { id: 'abB', founder_id: FOUNDER, workspace_id: WS_B, product_id: PROD_B,
        explicit_capabilities: { SPEND: 'approval_required' } },
    ]);
    db.setRows('business_goals', [
      { id: 'gA', founder_id: FOUNDER, product_id: PROD_A, unit: 'bookings/week' },
      { id: 'gB', founder_id: FOUNDER, product_id: PROD_B, unit: 'SaaS customers/month' },
    ]);
  });

  it('context, boundaries and goals each resolve to one business only', async () => {
    const client = db.asClient();
    for (const [ws, prod, positioning, spend, unit] of [
      [WS_A, PROD_A, 'Local home services marketplace', 'never', 'bookings/week'],
      [WS_B, PROD_B, 'AI marketing operating system', 'approval_required', 'SaaS customers/month'],
    ] as const) {
      const ctx = await client.from('founder_context').select('positioning').eq('workspace_id', ws);
      expect((ctx.data as Array<{ positioning: string }>).map(r => r.positioning)).toEqual([positioning]);

      const ab = await client.from('approval_boundary_policies')
        .select('explicit_capabilities').eq('workspace_id', ws);
      expect((ab.data as Array<{ explicit_capabilities: { SPEND: string } }>)[0]
        .explicit_capabilities.SPEND).toBe(spend);

      const goal = await client.from('business_goals').select('unit').eq('product_id', prod);
      expect((goal.data as Array<{ unit: string }>).map(r => r.unit)).toEqual([unit]);
    }
  });

  it('SPEND=never on AllignX is never widened by LaunchMind\'s laxer policy', async () => {
    const client = db.asClient();
    const a = await client.from('approval_boundary_policies')
      .select('explicit_capabilities').eq('workspace_id', WS_A);
    expect((a.data as Array<{ explicit_capabilities: { SPEND: string } }>)[0]
      .explicit_capabilities.SPEND).not.toBe('approval_required');
  });
});
