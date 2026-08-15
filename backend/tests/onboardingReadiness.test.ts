/**
 * @file onboardingReadiness.test.ts
 * @description The completion screen must state only what is true.
 *
 *   THE DEFECT THIS REPLACES: "18% → 96%" were string literals and the six
 *   completion cards were a hardcoded array, so a pre-launch product with no
 *   public presence was told "Public facts and evidence recorded" and "Founder
 *   corrections saved" while holding zero evidence and zero claims — identical
 *   to a live product with a store listing, a website and seven competitors.
 *
 *   The load-bearing property is that the two real businesses must render
 *   MATERIALLY DIFFERENT evidence state. Everything else follows from it.
 *
 * @security Reads one session's own workspace/product; no founder-wide reads.
 * @dependencies onboardingReadinessService, MemoryDb
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryDb } from './helpers/memoryDb';

const FOUNDER = '11111111-1111-4111-8111-111111111111';

// Scenario A — AllignX-like: live product, public evidence, reviewed claims.
const A = { session: 'aaaa1111-1111-4111-8111-aaaaaaaaaaaa',
            ws: 'aaaa2222-1111-4111-8111-aaaaaaaaaaaa',
            prod: 'aaaa3333-1111-4111-8111-aaaaaaaaaaaa' };
// Scenario B — LaunchMind-like: pre-launch, no public source, no claims.
const B = { session: 'bbbb1111-2222-4222-8222-bbbbbbbbbbbb',
            ws: 'bbbb2222-2222-4222-8222-bbbbbbbbbbbb',
            prod: 'bbbb3333-2222-4222-8222-bbbbbbbbbbbb' };

let db: MemoryDb;
vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => (globalThis as { __db: MemoryDb }).__db.asClient(),
}));

const FULL_CONTEXT = (session: string, ws: string) => ({
  id: `fc-${session}`, session_id: session, workspace_id: ws, founder_id: FOUNDER,
  audience_confirmed: 'Busy households', positioning: 'Local marketplace',
  value_proposition: 'Fast, vetted pros', primary_customer_problem: 'Finding a reliable trade',
  markets: [{ type: 'country', value: 'usa', label: 'United States' }],
  context_delta: 'Expanding next quarter',
  current_channels: [{ channel: 'google_ads', status: 'using' }],
  confirmed_fields: ['positioning', 'markets'],
});

function seed() {
  return new MemoryDb({
    onboarding_sessions: [
      { id: A.session, founder_id: FOUNDER, workspace_id: A.ws, product_id: A.prod, product_maturity: 'growing' },
      { id: B.session, founder_id: FOUNDER, workspace_id: B.ws, product_id: B.prod, product_maturity: 'pre_launch' },
    ],
    products: [
      { id: A.prod, name: 'AllignX', maturity: 'growing', scraped_meta: {
        name: 'AllignX', platform: 'app_store',
        stores: [{ platform: 'app_store', data: {} }, { platform: 'play_store', data: {} }],
        websiteMeta: { title: 'AllignX', description: 'x' },
        reviews: [{ text: 'great', rating: 5 }],
      } },
      { id: B.prod, name: 'LaunchMind', maturity: 'pre_launch', scraped_meta: {
        preLaunch: true, ownerDescription: 'An AI CMO for founders.',
        stores: [], websiteMeta: {}, storeFailures: [],
      } },
    ],
    founder_context: [FULL_CONTEXT(A.session, A.ws), FULL_CONTEXT(B.session, B.ws)],
    product_claims: [
      { id: 'c1', session_id: A.session, status: 'CONFIRMED' },
      { id: 'c2', session_id: A.session, status: 'CORRECTED' },
      { id: 'c3', session_id: A.session, status: 'CORRECTED' },
      { id: 'c4', session_id: A.session, status: 'UNREVIEWED' },
      // B has NONE — pre-launch produces no claims.
    ],
    business_goals: [
      { id: 'g1', product_id: A.prod, goal_type: 'custom', target_value: 20,
        baseline_value: 7, time_horizon_days: 90, target_unknown: false },
      { id: 'g2', product_id: B.prod, goal_type: 'custom', target_value: 100,
        baseline_value: 0, time_horizon_days: 90, target_unknown: false },
    ],
    strategy_directions: [
      { id: 's1', product_id: A.prod, headline: 'Fix the contact gap, then drive bookings', week_1: {}, created_at: '2026-08-01' },
      { id: 's2', product_id: B.prod, headline: 'Ship a waitlist-worthy MVP in 30 days', week_1: {}, created_at: '2026-08-12' },
    ],
    approval_boundary_policies: [
      { id: 'b1', session_id: A.session, working_style: 'hands_on', explicit_capabilities: { SPEND: 'approval_required' } },
      { id: 'b2', session_id: B.session, working_style: 'hands_on', explicit_capabilities: { SPEND: 'approval_required' } },
    ],
    competitor_relationships: [{ id: 'k1', product_id: A.prod }],
    workspace_connections: [], intelligence_signals: [],
  });
}

beforeEach(() => {
  db = seed();
  (globalThis as { __db: MemoryDb }).__db = db;
});

const load = async (sessionId: string) => {
  const { getOnboardingReadiness } = await import('../src/services/onboardingReadinessService');
  return getOnboardingReadiness(sessionId, FOUNDER);
};

// ── §8 · the two businesses must differ ─────────────────────────────────────
describe('§8 AllignX and LaunchMind render materially different evidence', () => {
  it('the live product reports PUBLIC evidence with its real sources', async () => {
    const r = await load(A.session);
    expect(r.observedEvidence.level).toBe('public');
    expect(r.observedEvidence.label).toBe('Public sources available');
    expect(r.observedEvidence.sources).toEqual(
      ['App Store', 'Google Play', 'Website', 'Public reviews']);
  });

  it('the pre-launch product reports NO observed evidence', async () => {
    const r = await load(B.session);
    expect(r.observedEvidence.level).toBe('none');
    expect(r.observedEvidence.label).toBe('No observed sources yet');
    expect(r.observedEvidence.sources).toEqual([]);
  });

  it('their summaries are NOT the same sentence', async () => {
    const a = await load(A.session);
    const b = await load(B.session);
    expect(a.summary).not.toBe(b.summary);
    expect(a.summary).toMatch(/public product evidence/i);
    expect(b.summary).toMatch(/not yet observed/i);
  });

  it('both have complete founder context — the dimensions are independent', async () => {
    // The point of separating them: identical founder context, different
    // evidence. One number could never express that.
    expect((await load(A.session)).founderContext.status).toBe('complete');
    expect((await load(B.session)).founderContext.status).toBe('complete');
  });

  it('no percentage is returned anywhere', async () => {
    const blob = JSON.stringify(await load(B.session));
    expect(blob).not.toMatch(/\b96\b|\b18\b%?/);
    expect(blob).not.toMatch(/confidence/i);
  });
});

// ── §5 · cards assert only what exists ──────────────────────────────────────
describe('§5 completion cards are derived, not hardcoded', () => {
  const card = (r: Awaited<ReturnType<typeof load>>, key: string) =>
    r.cards.find(c => c.key === key)!;

  it('never claims public evidence for a pre-launch product', async () => {
    const c = card(await load(B.session), 'product');
    expect(c.detail).toBe('Learned from your description — no public sources yet.');
    expect(c.detail).not.toMatch(/public (facts|sources) reviewed/i);
  });

  it('names the real public sources for a live product', async () => {
    const c = card(await load(A.session), 'product');
    expect(c.detail).toContain('App Store');
    expect(c.detail).toContain('Website');
  });

  it('never claims corrections were saved when there are zero claims', async () => {
    const c = card(await load(B.session), 'assumptions');
    expect(c.title).toBe('Your context recorded');
    expect(c.detail).toMatch(/no public assumptions to review/i);
    expect(c.detail).not.toMatch(/corrections saved|you corrected/i);
  });

  it('reports the real correction count when claims were reviewed', async () => {
    const c = card(await load(A.session), 'assumptions');
    expect(c.title).toBe('Assumptions reviewed');
    expect(c.detail).toBe("You corrected 2 of LaunchMind's 4 assumptions.");
  });

  it('uses the ACTUAL direction headline, never "supply-first sequence"', async () => {
    const a = card(await load(A.session), 'direction');
    const b = card(await load(B.session), 'direction');
    expect(a.detail).toBe('Fix the contact gap, then drive bookings');
    expect(b.detail).toBe('Ship a waitlist-worthy MVP in 30 days');
    expect(`${a.detail}${b.detail}`).not.toMatch(/supply-first/i);
  });

  it('states the real timeframe on the success card', async () => {
    expect(card(await load(A.session), 'success').detail)
      .toBe('Baseline, target and a 90-day timeframe are set.');
  });
});

// ── absent state is reported honestly, never as a ✓ ─────────────────────────
describe('missing state is not claimed', () => {
  it('a session with no Context Delta does not claim future context', async () => {
    db.setRows('founder_context', [{ ...FULL_CONTEXT(B.session, B.ws), context_delta: null }]);
    const c = (await load(B.session)).cards.find(x => x.key === 'future')!;
    expect(c.present).toBe(false);
    expect(c.title).toBe('Future context not set');
  });

  it('an unconfirmed target is not called measurable', async () => {
    db.setRows('business_goals', [{ id: 'g2', product_id: B.prod, goal_type: 'custom',
      target_value: 0, time_horizon_days: 90, target_unknown: true }]);
    const c = (await load(B.session)).cards.find(x => x.key === 'success')!;
    expect(c.present).toBe(false);
    expect(c.detail).toMatch(/still to be confirmed/i);
  });

  it('absent boundaries are not claimed as confirmed', async () => {
    db.setRows('approval_boundary_policies', []);
    const c = (await load(B.session)).cards.find(x => x.key === 'boundaries')!;
    expect(c.present).toBe(false);
    expect(c.title).toBe('Boundaries not set');
  });

  it('a missing direction says pending rather than delivered', async () => {
    db.setRows('strategy_directions', []);
    const c = (await load(B.session)).cards.find(x => x.key === 'direction')!;
    expect(c.present).toBe(false);
    expect(c.title).toBe('Direction pending');
  });

  it('incomplete founder context is reported as such, with what is missing', async () => {
    db.setRows('founder_context', [{
      id: 'fc', session_id: B.session, workspace_id: B.ws, founder_id: FOUNDER,
      audience_confirmed: 'Someone',
    }]);
    db.setRows('business_goals', []);
    db.setRows('approval_boundary_policies', []);
    const r = await load(B.session);
    expect(r.founderContext.status).not.toBe('complete');
    expect(r.founderContext.missing).toContain('Positioning');
    expect(r.founderContext.missing).toContain('Goal');
  });
});

// ── connected providers are a third, higher level ───────────────────────────
describe('connected performance sources', () => {
  it('counts as CONNECTED only when a healthy connection has produced signals', async () => {
    db.setRows('workspace_connections', [{ id: 'w1', workspace_id: B.ws, status: 'HEALTHY' }]);
    // Healthy but no signals yet — Phase 2's rule, not re-derived here.
    expect((await load(B.session)).observedEvidence.level).toBe('none');

    db.setRows('intelligence_signals', [{ id: 's1', workspace_id: B.ws }]);
    const r = await load(B.session);
    expect(r.observedEvidence.level).toBe('connected');
    expect(r.observedEvidence.label).toBe('Performance sources connected');
    expect(r.summary).toMatch(/observing real performance data/i);
  });
});

// ── tenancy ─────────────────────────────────────────────────────────────────
describe('tenancy', () => {
  it('another founder cannot read this readiness', async () => {
    await expect(load.call(null, A.session) && (async () => {
      const { getOnboardingReadiness } = await import('../src/services/onboardingReadinessService');
      return getOnboardingReadiness(A.session, '99999999-9999-4999-8999-999999999999');
    })()).rejects.toThrow(/not found/i);
  });

  it('reads only the session\'s own product — never the other business', async () => {
    const b = await load(B.session);
    // AllignX's sources must not appear on LaunchMind's summary.
    expect(b.observedEvidence.sources).not.toContain('App Store');
    expect(b.cards.find(c => c.key === 'direction')!.detail)
      .not.toContain('Fix the contact gap');
  });
});
