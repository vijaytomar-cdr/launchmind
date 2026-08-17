/**
 * @file multiProductContextIsolation.test.ts
 * @description The same-founder / two-business proof at the SERVICE layer.
 *
 *   tenancyIsolation.pg.test.ts proves the schema holds the line. This proves
 *   the code does — that ContextPackage V2, the Morning Brief's context read and
 *   IntelligenceService each return one business's state and never the other's.
 *   Those two proofs are not redundant: every defect in this remediation was a
 *   correct schema read through a wrong filter, which a constraint cannot catch.
 *
 *   Runs on MemoryDb because it HONOURS .eq/.in predicates. The older chain stub
 *   returned `this` from .eq() and ignored the argument, so an isolation test
 *   passed even when the service had no workspace filter at all — the exact
 *   trap this file exists to avoid.
 *
 * @security Proves founder identity alone is not authorization for another
 *   business's positioning, goals, competitors, strategy or boundaries.
 * @dependencies contextPackageV2, intelligenceService, MemoryDb
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryDb } from './helpers/memoryDb';

// One founder. Two businesses. Every value below is contradictory across them,
// so a leak can never be mistaken for a coincidence.
const FOUNDER = '11111111-1111-4111-8111-111111111111';
const WS_A    = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';   // AllignX-like
const WS_B    = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';   // LaunchMind-like
const PROD_A  = 'cccccccc-1111-4111-8111-cccccccccccc';
const PROD_B  = 'dddddddd-2222-4222-8222-dddddddddddd';

let db: MemoryDb;
vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => (globalThis as { __db: MemoryDb }).__db.asClient(),
}));
vi.mock('../src/services/memory/workspaceResolver', () => ({
  resolveMemoryWorkspace: vi.fn(async () => WS_A),
  WorkspaceUnresolvedError: class extends Error {},
}));

function seed(): MemoryDb {
  return new MemoryDb({
    founders: [{ id: FOUNDER, plan: 'builder', token_balance: 900 }],
    products: [
      { id: PROD_A, workspace_id: WS_A, founder_id: FOUNDER, name: 'AllignX',
        category: 'Lifestyle', markets: ['phoenix'], archived_at: null,
        confirmed_icp: { audience: 'Phoenix homeowners' } },
      { id: PROD_B, workspace_id: WS_B, founder_id: FOUNDER, name: 'LaunchMind',
        category: 'Business', markets: ['usa'], archived_at: null,
        confirmed_icp: { audience: 'SaaS founders' } },
    ],
    founder_context: [
      { id: 'fcA', founder_id: FOUNDER, workspace_id: WS_A, product_id: PROD_A,
        audience_confirmed: 'Phoenix homeowners needing trades',
        positioning: 'Local home services marketplace',
        context_delta: 'Expanding to Tucson next quarter',
        working_style: 'hands_on', primary_goal: null, next_initiative: null,
        target_window: null, updated_at: '2026-08-02T00:00:00Z' },
      { id: 'fcB', founder_id: FOUNDER, workspace_id: WS_B, product_id: PROD_B,
        audience_confirmed: 'Early-stage SaaS founders',
        positioning: 'AI marketing operating system',
        context_delta: 'Pre-launch, no paid spend yet',
        working_style: 'autonomous', primary_goal: null, next_initiative: null,
        target_window: null, updated_at: '2026-08-03T00:00:00Z' },  // NEWER
    ],
    business_goals: [
      { id: 'gA', founder_id: FOUNDER, product_id: PROD_A, goal_type: 'installs',
        target_value: 500, unit: 'service bookings/week', time_horizon_days: 30,
        updated_at: '2026-08-02T00:00:00Z' },
      { id: 'gB', founder_id: FOUNDER, product_id: PROD_B, goal_type: 'revenue',
        target_value: 40, unit: 'SaaS customers/month', time_horizon_days: 90,
        updated_at: '2026-08-03T00:00:00Z' },                        // NEWER
    ],
    competitor_relationships: [
      { id: 'cA', founder_id: FOUNDER, product_id: PROD_A, name: 'Thumbtack',
        relationship: 'CONFIRMED', key_differentiator: 'local-first' },
      { id: 'cB', founder_id: FOUNDER, product_id: PROD_B, name: 'HubSpot',
        relationship: 'CONFIRMED', key_differentiator: 'founder-led' },
    ],
    strategy_directions: [
      { id: 'sA', founder_id: FOUNDER, product_id: PROD_A,
        headline: 'Own Phoenix home-services search', created_at: '2026-08-02T00:00:00Z' },
      { id: 'sB', founder_id: FOUNDER, product_id: PROD_B,
        headline: 'Win founder-led SaaS acquisition', created_at: '2026-08-03T00:00:00Z' },
    ],
    campaigns: [
      { id: 'cmA', founder_id: FOUNDER, product_id: PROD_A, channel: 'meta',
        market: 'usa', status: 'launched' },
      { id: 'cmB', founder_id: FOUNDER, product_id: PROD_B, channel: 'linkedin',
        market: 'usa', status: 'launched' },
    ],
    campaign_metrics: [
      { id: 'mA', founder_id: FOUNDER, campaign_id: 'cmA', installs: 10, cpi: 1.5,
        week_start: '2026-08-01', collected_at: '2026-08-02T00:00:00Z' },
      { id: 'mB', founder_id: FOUNDER, campaign_id: 'cmB', installs: 999, cpi: 9.9,
        week_start: '2026-08-01', collected_at: '2026-08-03T00:00:00Z' },
    ],
    knowledge_nodes: [], marketing_memories: [], memory_embeddings: [],
    context_packages: [], context_package_items: [],
    context_retention_classes: [
      { context_type: 'MORNING_BRIEF', retention_days: 90 },
      { context_type: 'OWNER_QUESTION', retention_days: 90 },
    ],
    embedding_contract: [{ id: 1, model: 'voyage-4', embedding_version: 1,
                           dimensions: 8, generation_enabled: true }],
    workspace_connections: [
      { id: 'wcA', workspace_id: WS_A, founder_id: FOUNDER, provider: 'ga4',
        status: 'HEALTHY', product_id: PROD_A },
      { id: 'wcB', workspace_id: WS_B, founder_id: FOUNDER, provider: 'stripe',
        status: 'HEALTHY', product_id: PROD_B },
    ],
    onboarding_sessions: [], learning_events: [], growth_brain_learning_events: [],
    connection_insights: [], intelligence_signals: [],
  });
}

beforeEach(() => {
  db = seed();
  (globalThis as { __db: MemoryDb }).__db = db;
  vi.clearAllMocks();
});

// ── ContextPackage V2 ────────────────────────────────────────────────────────
describe('ContextPackage V2 isolation', () => {
  async function build(workspaceId: string, productId: string) {
    const { buildContextPackageV2 } = await import('../src/lib/context/contextPackageV2');
    return buildContextPackageV2({
      workspaceId, founderId: FOUNDER, productId,
      intent: 'MORNING_BRIEF', query: 'what next', persist: false,
    });
  }

  it('Product A package contains A values only', async () => {
    const pkg = await build(WS_A, PROD_A);
    const blob = JSON.stringify(pkg);
    expect(pkg.founderContext.audienceConfirmed).toBe('Phoenix homeowners needing trades');
    expect(blob).toContain('Phoenix');
    // B is NEWER on every table, so an unscoped "newest wins" read returns B.
    // Its absence is the whole proof.
    expect(pkg.founderContext.audienceConfirmed).not.toContain('SaaS');
    expect(blob).not.toContain('LaunchMind');
    expect(blob).not.toContain('HubSpot');
    expect(blob).not.toContain('SaaS customers/month');
  });

  it('Product B package contains B values only', async () => {
    const pkg = await build(WS_B, PROD_B);
    const blob = JSON.stringify(pkg);
    expect(pkg.founderContext.audienceConfirmed).toBe('Early-stage SaaS founders');
    expect(blob).not.toContain('Thumbtack');
    expect(blob).not.toContain('service bookings/week');
    expect(blob).not.toContain('Phoenix');
  });

  it('goals do not cross', async () => {
    const a = await build(WS_A, PROD_A);
    const b = await build(WS_B, PROD_B);
    expect(a.founderContext.primaryGoal).toContain('service bookings/week');
    expect(b.founderContext.primaryGoal).toContain('SaaS customers/month');
  });

  it('competitors do not cross', async () => {
    const a = await build(WS_A, PROD_A);
    const b = await build(WS_B, PROD_B);
    const names = (p: Awaited<ReturnType<typeof build>>) =>
      JSON.stringify(p.operational ?? {}) + JSON.stringify(p);
    expect(names(a)).toContain('Thumbtack');
    expect(names(a)).not.toContain('HubSpot');
    expect(names(b)).toContain('HubSpot');
    expect(names(b)).not.toContain('Thumbtack');
  });

  it('strategy does not cross', async () => {
    const a = await build(WS_A, PROD_A);
    const b = await build(WS_B, PROD_B);
    expect(JSON.stringify(a)).not.toContain('Win founder-led SaaS acquisition');
    expect(JSON.stringify(b)).not.toContain('Own Phoenix home-services search');
  });

  it('campaigns and their metrics do not cross', async () => {
    // campaign_metrics has neither product_id nor workspace_id, so its only
    // scope is the campaign list. A founder-wide read would put B's 999
    // installs on A's package.
    const a = await build(WS_A, PROD_A);
    expect(a.operational.activeCampaigns.map(c => c.channel)).toEqual(['meta']);
    expect(JSON.stringify(a.operational.recentMetrics)).not.toContain('999');
    const b = await build(WS_B, PROD_B);
    expect(b.operational.activeCampaigns.map(c => c.channel)).toEqual(['linkedin']);
    expect(JSON.stringify(b.operational.recentMetrics)).not.toContain('"installs":10');
  });

  it('returns no business context rather than the wrong one when no product is in scope', async () => {
    const { buildContextPackageV2 } = await import('../src/lib/context/contextPackageV2');
    const pkg = await buildContextPackageV2({
      workspaceId: WS_A, founderId: FOUNDER, productId: null,
      intent: 'OWNER_QUESTION', query: 'anything', persist: false,
    });
    // Silence is the safe answer. Guessing is what produced the defect.
    expect(pkg.founderContext.primaryGoal).toBeNull();
    expect(JSON.stringify(pkg)).not.toContain('HubSpot');
    expect(JSON.stringify(pkg)).not.toContain('Thumbtack');
  });
});

// ── IntelligenceService ──────────────────────────────────────────────────────
describe('IntelligenceService does not merge A + B founder context', () => {
  async function coverage(workspaceId: string) {
    const { getGrowthBrainCoverage } = await import('../src/services/intelligenceService');
    return getGrowthBrainCoverage({
      actorId: FOUNDER, workspaceId, role: 'owner', isOwner: true,
    });
  }

  it('merges rows WITHIN a business but never across two', async () => {
    // The merge exists to recover a delta written by the session-less editor.
    // Scoped, it fixes a bug; unscoped, it blends two businesses into context
    // belonging to neither — same query, one filter, opposite meaning.
    const a = JSON.stringify(await coverage(WS_A));
    expect(a).toContain('Tucson');                    // A's own delta survives
    expect(a).not.toContain('Pre-launch, no paid spend yet');
    expect(a).not.toContain('SaaS');

    const b = JSON.stringify(await coverage(WS_B));
    expect(b).toContain('Pre-launch, no paid spend yet');
    expect(b).not.toContain('Tucson');
  });

  it('counts only this workspace\'s competitors', async () => {
    // Asserted through the SCORE the count feeds, not by searching the payload
    // for 'HubSpot'. That read is `head: true, count: exact`, so no name ever
    // appears and a string search passes however badly the query leaks — the
    // mutation check caught exactly that assertion passing against reverted
    // code. The number IS the leak detector.
    //
    // 3.3B removed the invented 35-point floor from this dimension (it made an
    // empty workspace report "35%" with no evidence). The score is now
    // earned/possible over the SAME per-term weights:
    //   min(20, competitors × 7) + category 10 + scraped_meta 9, out of 39.
    // One competitor  → (7 + 10) / 39 = 44%
    // Two competitors → (14 + 10) / 39 = 62%
    // The 18-point gap keeps this a leak detector; only the constants moved.
    const market = (c: Awaited<ReturnType<typeof coverage>>) =>
      c.dimensions.find(d => d.label === 'Market intelligence')!.score;
    const a = market(await coverage(WS_A));
    const b = market(await coverage(WS_B));
    const ONE_COMPETITOR = Math.round(((7 + 10) / 39) * 100);   // 44
    const TWO_COMPETITORS = Math.round(((14 + 10) / 39) * 100); // 62
    expect(ONE_COMPETITOR).not.toBe(TWO_COMPETITORS);           // still discriminating
    expect(a).toBe(ONE_COMPETITOR);   // one competitor, not two
    expect(b).toBe(ONE_COMPETITOR);
  });

  it('an empty workspace inherits nothing from the founder\'s other business', async () => {
    // The riskiest shape: `.in()` over an empty product list. A reader that
    // degrades to unfiltered here would hand a brand-new workspace the other
    // business's entire history.
    const empty = JSON.stringify(await coverage('eeeeeeee-3333-4333-8333-eeeeeeeeeeee'));
    expect(empty).not.toContain('Thumbtack');
    expect(empty).not.toContain('HubSpot');
    expect(empty).not.toContain('Tucson');
    expect(empty).not.toContain('service bookings/week');
  });
});

// ── Connections ──────────────────────────────────────────────────────────────
describe('workspace connections do not cross', () => {
  it('each business sees only its own providers', async () => {
    const rowsA = await db.asClient().from('workspace_connections')
      .select('provider').eq('workspace_id', WS_A);
    const rowsB = await db.asClient().from('workspace_connections')
      .select('provider').eq('workspace_id', WS_B);
    expect((rowsA.data as Array<{ provider: string }>).map(r => r.provider)).toEqual(['ga4']);
    expect((rowsB.data as Array<{ provider: string }>).map(r => r.provider)).toEqual(['stripe']);
  });
});

// ── The writers (the half that was missing) ─────────────────────────────────
// Scoping the readers without tenanting the writers is the worse of the two
// half-states: every read fails closed and business context silently vanishes,
// with nothing in the logs. These prove the columns are actually populated.
describe('alignment writes carry tenancy', () => {
  const SESSION = 'ffffffff-1111-4111-8111-ffffffffffff';

  function withSession(extra: Record<string, unknown>) {
    db = seed();
    db.setRows('onboarding_sessions', [{
      id: SESSION, founder_id: FOUNDER, current_state: 'ALIGNMENT_AUDIENCE',
      lock_version: 0, step_completed: 5, ...extra,
    }]);
    (globalThis as { __db: MemoryDb }).__db = db;
  }

  it('stamps workspace_id and product_id onto founder_context', async () => {
    withSession({ workspace_id: WS_A, product_id: PROD_A });
    const { saveAudience } = await import('../src/services/onboardingService');
    await saveAudience(SESSION, FOUNDER, { audienceConfirmed: 'Phoenix homeowners' });

    const written = db.rows('founder_context')
      .find(r => r.session_id === SESSION) as Record<string, unknown> | undefined;
    expect(written).toBeDefined();
    expect(written!.workspace_id).toBe(WS_A);
    expect(written!.product_id).toBe(PROD_A);
  });

  it('REFUSES to store business context that has no owner', async () => {
    // A session with no workspace cannot have its context placed anywhere
    // truthful. Writing it untenanted would make it readable by every business
    // the founder owns — the defect, recreated in permanent form.
    withSession({ workspace_id: null, product_id: null });
    const { saveAudience } = await import('../src/services/onboardingService');
    await expect(saveAudience(SESSION, FOUNDER, { audienceConfirmed: 'anyone' }))
      .rejects.toThrow(/no workspace/i);
    expect(db.rows('founder_context').find(r => r.session_id === SESSION)).toBeUndefined();
  });

  it('stamps tenancy onto approval boundaries too', async () => {
    withSession({ workspace_id: WS_B, product_id: PROD_B, current_state: 'BOUNDARIES_SETUP' });
    const { saveBoundaries } = await import('../src/services/onboardingService');
    await saveBoundaries(SESSION, FOUNDER, {
      workingStyle: 'hands_on', notificationCadence: 'weekly',
      weeklySpendCapUsd: 0, weeklySpendCapInr: 0,
      explicitCapabilities: { SPEND: 'never' },
      founderAcknowledged: true,
    });
    const policy = db.rows('approval_boundary_policies')
      .find(r => r.session_id === SESSION) as Record<string, unknown> | undefined;
    expect(policy).toBeDefined();
    expect(policy!.workspace_id).toBe(WS_B);
    expect(policy!.product_id).toBe(PROD_B);
    // And SPEND=never stayed never — it did not degrade into "ask me first".
    expect((policy!.explicit_capabilities as Record<string, string>).SPEND).toBe('never');
    expect(policy!.autonomous_permitted).not.toContain('SPEND');
    expect(policy!.approval_required).not.toContain('SPEND');
  });
});

// ── Duplicate product identity (BLOCKER 3, §18) ─────────────────────────────
describe('canonical identity prevents a second onboarding creating a duplicate', () => {
  it('every URL variant of one app maps to ONE identity', async () => {
    const { canonicalIdentityFromUrl } = await import('../src/services/productIdentity');
    const variants = [
      'https://apps.apple.com/us/app/allignx/id1234567890',
      'https://apps.apple.com/in/app/allignx-home-services/id1234567890?mt=8',
      'https://www.apps.apple.com/us/app/x/id1234567890/',
      'https://apps.apple.com/us/app/completely-different-slug/id1234567890?utm_source=x',
    ];
    const ids = new Set(variants.map(canonicalIdentityFromUrl));
    // A name comparison would have split these — two of the three real AllignX
    // rows differ only by slug and suffix.
    expect(ids.size).toBe(1);
    expect([...ids][0]).toBe('apple:1234567890');
  });

  it('two genuinely different apps stay different', async () => {
    const { canonicalIdentityFromUrl } = await import('../src/services/productIdentity');
    expect(canonicalIdentityFromUrl('https://apps.apple.com/us/app/a/id111'))
      .not.toBe(canonicalIdentityFromUrl('https://apps.apple.com/us/app/a/id222222222'));
  });
});
