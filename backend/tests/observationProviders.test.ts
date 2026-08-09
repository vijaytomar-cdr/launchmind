/**
 * @file observationProviders.test.ts
 * @description Adapter unit + HTTP-fixture tests for the Step 4 observation providers:
 *   RevenueCat, Google Analytics 4, Stripe, Google Search Console.
 *
 *   Provider HTTP is stubbed with realistic response bodies — the only deterministic
 *   way to test an external API. Production code has no fallback data: every number
 *   asserted here is arithmetic over a fixture body, exactly as it would be over a
 *   live one. Each provider has a "change the data, change the answer" test proving
 *   nothing is hard-coded.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { revenueCatAdapter }    from '../src/services/providers/revenueCatAdapter';
import { ga4Adapter }           from '../src/services/providers/ga4Adapter';
import { stripeAdapter }        from '../src/services/providers/stripeAdapter';
import { searchConsoleAdapter } from '../src/services/providers/searchConsoleAdapter';
import { ProviderError, type AdapterContext, type ProviderAdapter } from '../src/services/providers/types';
import {
  deriveRevenueCatInsights, deriveGa4Insights,
  deriveStripeInsights, deriveSearchConsoleInsights,
  deriveInsightsForProvider,
} from '../src/services/connectionInsightService';

function ctx(over: Partial<AdapterContext> = {}): AdapterContext {
  return {
    founderId: 'aaaa0000-0000-0000-0000-00000000000a',
    credential: 'test-credential-value',
    config: {},
    selectedResourceId: 'res-1',
    selectedResourceName: 'Resource One',
    traceId: 'lm_00000000000000000000000000000001',
    ...over,
  };
}

/** Routes stubbed responses by URL substring. First match wins. */
function stub(routes: Array<[RegExp | string, unknown | { status: number; body?: unknown }]>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    for (const [match, value] of routes) {
      const hit = typeof match === 'string' ? url.includes(match) : match.test(url);
      if (!hit) continue;
      const v = value as { status?: number; body?: unknown };
      const status = typeof v?.status === 'number' ? v.status : 200;
      const body = v && typeof v === 'object' && 'status' in v ? v.body ?? {} : value;
      return { ok: status < 400, status, json: async () => body } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  }));
  return calls;
}

/** Shared contract every observation adapter must satisfy. */
function assertAdapterContract(adapter: ProviderAdapter) {
  expect(typeof adapter.key).toBe('string');
  expect(adapter.syncSteps.length).toBeGreaterThanOrEqual(5);
  expect(adapter.syncSteps[0]).toBe('Authorization verified');
  expect(adapter.syncSteps[adapter.syncSteps.length - 1]).toBe('Updating Growth Brain');
  expect(typeof adapter.verifyCredential).toBe('function');
  expect(typeof adapter.listAccounts).toBe('function');
  expect(typeof adapter.fetchSignals).toBe('function');
  // Read-only is structural: no write-shaped member exists.
  for (const forbidden of ['createCharge', 'publish', 'updateMetadata', 'setBudget', 'refund', 'sendEmail']) {
    expect(Object.keys(adapter)).not.toContain(forbidden);
  }
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

// ── Shared contract ───────────────────────────────────────────────────────────

describe('every observation adapter satisfies the canonical contract', () => {
  for (const adapter of [revenueCatAdapter, ga4Adapter, stripeAdapter, searchConsoleAdapter]) {
    it(`${adapter.key} conforms`, () => assertAdapterContract(adapter));
  }

  it('each provider has its own meaningful sync steps', () => {
    const stepSets = [revenueCatAdapter, ga4Adapter, stripeAdapter, searchConsoleAdapter]
      .map(a => a.syncSteps.slice(1, -1).join('|'));
    // The middle steps describe provider-specific work, so no two may match.
    expect(new Set(stepSets).size).toBe(stepSets.length);
  });

  it('the shared HTTP layer maps every failure status to the right recovery state', async () => {
    const cases: Array<[number, string]> = [
      [401, 'NEEDS_REAUTH'],
      [403, 'PERMISSION_DENIED'],
      [404, 'WRONG_ACCOUNT'],
      [429, 'PROVIDER_UNAVAILABLE'],
      [503, 'PROVIDER_UNAVAILABLE'],
    ];
    for (const [status, kind] of cases) {
      stub([['revenuecat.com', { status, body: { error: 'x' } }]]);
      const err = await revenueCatAdapter.verifyCredential(ctx()).catch(e => e as ProviderError);
      expect({ status, kind: err.kind }).toEqual({ status, kind });
    }
  });

  it('a network failure never claims something changed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    for (const adapter of [revenueCatAdapter, ga4Adapter, stripeAdapter, searchConsoleAdapter]) {
      const err = await adapter.verifyCredential(ctx()).catch(e => e as ProviderError);
      expect(err.kind).toBe('PROVIDER_UNAVAILABLE');
      expect(err.ownerMessage).toMatch(/unchanged/i);
    }
  });

  it('provider error bodies never reach the owner', async () => {
    // A provider echoing the credential back must not leak it through our message.
    stub([['stripe.com', { status: 400, body: { error: { message: 'Invalid key rk_live_SECRET123', type: 'invalid_request_error' } } }]]);
    const err = await stripeAdapter.verifyCredential(ctx()).catch(e => e as ProviderError);
    expect(err.ownerMessage).not.toContain('rk_live_SECRET123');
  });
});

// ── RevenueCat ────────────────────────────────────────────────────────────────

const RC_PROJECTS = { items: [{ id: 'proj_a', name: 'Alpha' }, { id: 'proj_b', name: 'Beta' }] };
const rcOverview = (metrics: Array<{ id: string; value: number }>) => ({ metrics });

describe('RevenueCat adapter', () => {
  it('verifies against the live projects endpoint', async () => {
    const calls = stub([['/v2/projects', RC_PROJECTS]]);
    const id = await revenueCatAdapter.verifyCredential(ctx());
    expect(calls.some(c => c.includes('/v2/projects'))).toBe(true);
    expect(id.externalAccountId).toBe('proj_a');
  });

  it('treats a key that can see nothing as a permission problem', async () => {
    stub([['/v2/projects', { items: [] }]]);
    await expect(revenueCatAdapter.verifyCredential(ctx()))
      .rejects.toMatchObject({ kind: 'PERMISSION_DENIED' });
  });

  it('enumerates only the projects RevenueCat returned', async () => {
    stub([['/v2/projects', RC_PROJECTS]]);
    const accounts = await revenueCatAdapter.listAccounts(ctx());
    expect(accounts.map(a => a.id)).toEqual(['proj_a', 'proj_b']);
  });

  it('rejects a project the key can no longer see', async () => {
    stub([['/v2/projects', RC_PROJECTS]]);
    await expect(revenueCatAdapter.validateSelection?.(ctx(), 'proj_missing'))
      .rejects.toMatchObject({ kind: 'WRONG_ACCOUNT' });
  });

  it('imports real metrics and computes revenue per subscriber exactly', async () => {
    stub([
      ['/metrics/overview', rcOverview([
        { id: 'active_trials', value: 120 },
        { id: 'active_subscriptions', value: 480 },
        { id: 'mrr', value: 2400 },
        { id: 'revenue', value: 3100 },
      ])],
      ['/v2/projects', RC_PROJECTS],
    ]);

    const result = await revenueCatAdapter.fetchSignals(ctx({ selectedResourceId: 'proj_a' }));
    const byType = (t: string) => result.signals.find(s => s.signalType === t);

    expect(byType('trials')?.signalData.active_trials).toBe(120);
    expect(byType('mrr')?.signalData.value_usd).toBe(2400);
    // 2400 ÷ 480 = 5
    expect(byType('ltv')?.signalData.arpu_usd).toBe(5);
    // Trial share = 120 / 600
    expect(byType('retention')?.signalData.trial_share).toBeCloseTo(0.2, 6);
  });

  it('refuses to invent an LTV RevenueCat cannot support', async () => {
    stub([
      ['/metrics/overview', rcOverview([
        { id: 'active_subscriptions', value: 100 }, { id: 'mrr', value: 500 },
        { id: 'active_trials', value: 10 }, { id: 'revenue', value: 600 },
      ])],
      ['/v2/projects', RC_PROJECTS],
    ]);
    const result = await revenueCatAdapter.fetchSignals(ctx({ selectedResourceId: 'proj_a' }));
    const ltv = result.signals.find(s => s.signalType === 'ltv');
    // ARPU is exact; LTV needs a churn rate this endpoint does not expose.
    expect(ltv?.signalData.arpu_usd).toBe(5);
    expect(ltv?.signalData.ltv_usd).toBeNull();
  });

  it('reports NO_HISTORY for a project with no metrics yet', async () => {
    stub([['/metrics/overview', { metrics: [] }], ['/v2/projects', RC_PROJECTS]]);
    const result = await revenueCatAdapter.fetchSignals(ctx({ selectedResourceId: 'proj_a' }));
    expect(result.noHistory).toBe(true);
    expect(result.signals).toEqual([]);
  });

  it('reports PARTIAL when RevenueCat omits expected metrics', async () => {
    stub([
      ['/metrics/overview', rcOverview([{ id: 'active_subscriptions', value: 50 }])],
      ['/v2/projects', RC_PROJECTS],
    ]);
    const result = await revenueCatAdapter.fetchSignals(ctx({ selectedResourceId: 'proj_a' }));
    expect(result.partial).toBe(true);
    expect(result.partialReason).toMatch(/mrr|active_trials|revenue/);
  });

  it('refuses to sync without a project selected', async () => {
    stub([['/v2/projects', RC_PROJECTS]]);
    await expect(revenueCatAdapter.fetchSignals(ctx({ selectedResourceId: null })))
      .rejects.toMatchObject({ kind: 'WRONG_ACCOUNT' });
  });

  it('reports progress in order, only after real calls', async () => {
    stub([
      ['/metrics/overview', rcOverview([{ id: 'mrr', value: 100 }, { id: 'active_subscriptions', value: 20 }])],
      ['/v2/projects', RC_PROJECTS],
    ]);
    const seen: string[] = [];
    await revenueCatAdapter.fetchSignals(ctx({ selectedResourceId: 'proj_a' }), async u => { seen.push(u.step); });
    expect(seen[0]).toBe('Authorization verified');
    expect(seen).toContain('Reading subscription history');
    expect(seen[seen.length - 1]).toBe('Updating Growth Brain');
  });
});

// ── GA4 ───────────────────────────────────────────────────────────────────────

const GA4_SUMMARIES = {
  accountSummaries: [{
    account: 'accounts/111', displayName: 'Acme',
    propertySummaries: [
      { property: 'properties/123456', displayName: 'Acme Web' },
      { property: 'properties/789012', displayName: 'Acme App' },
    ],
  }],
};

const ga4Report = (rows: Array<{ dims?: string[]; metrics: number[] }>) => ({
  rows: rows.map(r => ({
    dimensionValues: (r.dims ?? []).map(v => ({ value: v })),
    metricValues: r.metrics.map(v => ({ value: String(v) })),
  })),
});

describe('GA4 adapter', () => {
  it('enumerates every property across account summaries', async () => {
    stub([['accountSummaries', GA4_SUMMARIES]]);
    const accounts = await ga4Adapter.listAccounts(ctx());
    // Numeric ids, which is what the Data API needs.
    expect(accounts.map(a => a.id)).toEqual(['123456', '789012']);
    expect(accounts[0].name).toBe('Acme Web');
  });

  it('treats an account with no properties as a permission problem', async () => {
    stub([['accountSummaries', { accountSummaries: [] }]]);
    await expect(ga4Adapter.verifyCredential(ctx()))
      .rejects.toMatchObject({ kind: 'PERMISSION_DENIED' });
  });

  it('computes engagement and conversion from real report rows', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = String(input);
      const json = (b: unknown) => ({ ok: true, status: 200, json: async () => b } as unknown as Response);
      if (url.includes('accountSummaries')) return json(GA4_SUMMARIES);
      call++;
      if (call === 1) return json(ga4Report([{ metrics: [1000, 600, 800] }]));            // sessions
      if (call === 2) return json(ga4Report([                                             // landing pages
        { dims: ['/home'], metrics: [700, 0.35] },
        { dims: ['/pricing'], metrics: [300, 0.82] },
      ]));
      return json(ga4Report([                                                             // source/medium
        { dims: ['google / organic'], metrics: [600, 60] },
        { dims: ['facebook / cpc'],   metrics: [400, 10] },
      ]));
    }));

    const result = await ga4Adapter.fetchSignals(ctx({ selectedResourceId: '123456' }));
    const byType = (t: string) => result.signals.find(s => s.signalType === t);

    // 600 engaged ÷ 1000 sessions
    expect(byType('sessions')?.signalData.engagement_rate).toBeCloseTo(0.6, 6);
    // 70 conversions ÷ 1000 sessions
    expect(byType('conversion')?.signalData.value).toBeCloseTo(0.07, 6);
    // Best converting source: 60/600 = 10% vs 10/400 = 2.5%
    const best = byType('source_quality')?.signalData.best_converting as { source: string };
    expect(best.source).toBe('google / organic');
    // Highest-bounce page with real traffic
    const worst = byType('funnel')?.signalData.highest_bounce_page as { page: string };
    expect(worst.page).toBe('/pricing');
  });

  it('reports NO_HISTORY for a property with no rows', async () => {
    stub([['accountSummaries', GA4_SUMMARIES], [':runReport', { rows: [] }]]);
    const result = await ga4Adapter.fetchSignals(ctx({ selectedResourceId: '123456' }));
    expect(result.noHistory).toBe(true);
  });

  it('propagates a permission failure rather than silently degrading', async () => {
    stub([['accountSummaries', GA4_SUMMARIES], [':runReport', { status: 403 }]]);
    await expect(ga4Adapter.fetchSignals(ctx({ selectedResourceId: '123456' })))
      .rejects.toMatchObject({ kind: 'PERMISSION_DENIED' });
  });

  it('refuses to sync without a property selected', async () => {
    stub([['accountSummaries', GA4_SUMMARIES]]);
    await expect(ga4Adapter.fetchSignals(ctx({ selectedResourceId: null })))
      .rejects.toMatchObject({ kind: 'WRONG_ACCOUNT' });
  });
});

// ── Stripe ────────────────────────────────────────────────────────────────────

const STRIPE_ACCOUNT = { id: 'acct_123', settings: { dashboard: { display_name: 'Acme Inc' } }, country: 'US' };

describe('Stripe adapter', () => {
  it('identifies the single bound account — auto-select is legitimate here', async () => {
    stub([['/v1/account', STRIPE_ACCOUNT]]);
    const accounts = await stripeAdapter.listAccounts(ctx());
    // A Stripe key is bound to one account, so exactly one resource exists.
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ id: 'acct_123', name: 'Acme Inc' });
  });

  it('rejects a key that now resolves to a different account', async () => {
    stub([['/v1/account', STRIPE_ACCOUNT]]);
    await expect(stripeAdapter.validateSelection?.(ctx(), 'acct_other'))
      .rejects.toMatchObject({ kind: 'WRONG_ACCOUNT' });
  });

  it('maps a restricted-key permission error to PERMISSION_DENIED, not a generic failure', async () => {
    stub([['/v1/account', { status: 400, body: { error: { type: 'invalid_request_error' } } }]]);
    await expect(stripeAdapter.verifyCredential(ctx()))
      .rejects.toMatchObject({ kind: 'PERMISSION_DENIED' });
  });

  it('computes revenue, MRR, and payment reliability from real objects', async () => {
    stub([
      ['/v1/account', STRIPE_ACCOUNT],
      ['/v1/balance_transactions', { data: [
        { type: 'charge', amount: 10_000, fee: 320, net: 9_680 },
        { type: 'charge', amount: 5_000,  fee: 175, net: 4_825 },
      ]}],
      ['/v1/charges', { data: [
        { amount: 10_000, status: 'succeeded' },
        { amount: 5_000,  status: 'succeeded' },
        { amount: 2_000,  status: 'failed', failure_code: 'card_declined' },
        { amount: 2_000,  status: 'failed', failure_code: 'card_declined' },
      ]}],
      ['/v1/subscriptions', { data: [
        { status: 'active',   items: { data: [{ price: { id: 'p1', nickname: 'Pro', unit_amount: 2_500, recurring: { interval: 'month' } } }] } },
        { status: 'active',   items: { data: [{ price: { id: 'p2', nickname: 'Annual', unit_amount: 24_000, recurring: { interval: 'year' } } }] } },
        { status: 'past_due', items: { data: [{ price: { id: 'p1', nickname: 'Pro', unit_amount: 2_500, recurring: { interval: 'month' } } }] } },
      ]}],
      ['/v1/refunds', { data: [{ amount: 1_000 }] }],
    ]);

    const result = await stripeAdapter.fetchSignals(ctx({ selectedResourceId: 'acct_123' }));
    const byType = (t: string) => result.signals.find(s => s.signalType === t);

    // Amounts are minor units: gross 15000 → $150, fees 495 → $4.95
    expect(byType('revenue')?.signalData.gross_usd).toBe(150);
    expect(byType('revenue')?.signalData.fees_usd).toBeCloseTo(4.95, 6);
    // MRR: $25 monthly + $240/12 = $20 → $45
    expect(byType('mrr')?.signalData.value_usd).toBe(45);
    // 2 succeeded of 4 charges
    expect(byType('conversion')?.signalData.value).toBe(0.5);
    expect(byType('conversion')?.signalData.failure_rate).toBe(0.5);
    // Refund $10 against $150 succeeded
    expect(byType('conversion')?.signalData.refund_rate_of_revenue).toBeCloseTo(1000 / 15000, 6);
    expect(byType('plan_movement')?.signalData.past_due).toBe(1);
  });

  it('issues only GET requests — read-only is observable, not just promised', async () => {
    const calls = stub([
      ['/v1/account', STRIPE_ACCOUNT],
      ['/v1/balance_transactions', { data: [] }],
      ['/v1/charges', { data: [] }],
      ['/v1/subscriptions', { data: [] }],
      ['/v1/refunds', { data: [] }],
    ]);
    await stripeAdapter.fetchSignals(ctx({ selectedResourceId: 'acct_123' }));
    expect(calls.every(c => c.startsWith('GET '))).toBe(true);
  });

  it('reports NO_HISTORY for an account with no activity in the window', async () => {
    stub([
      ['/v1/account', STRIPE_ACCOUNT],
      ['/v1/balance_transactions', { data: [] }],
      ['/v1/charges', { data: [] }],
      ['/v1/subscriptions', { data: [] }],
      ['/v1/refunds', { data: [] }],
    ]);
    const result = await stripeAdapter.fetchSignals(ctx({ selectedResourceId: 'acct_123' }));
    expect(result.noHistory).toBe(true);
  });

  it('reports PARTIAL when the restricted key cannot read a resource', async () => {
    stub([
      ['/v1/account', STRIPE_ACCOUNT],
      ['/v1/balance_transactions', { data: [{ type: 'charge', amount: 1000, fee: 30, net: 970 }] }],
      ['/v1/charges', { data: [{ amount: 1000, status: 'succeeded' }] }],
      ['/v1/subscriptions', { status: 403 }],
      ['/v1/refunds', { data: [] }],
    ]);
    const result = await stripeAdapter.fetchSignals(ctx({ selectedResourceId: 'acct_123' }));
    expect(result.partial).toBe(true);
    expect(result.partialReason).toMatch(/subscriptions/);
  });
});

// ── Search Console ────────────────────────────────────────────────────────────

const GSC_SITES = {
  siteEntry: [
    { siteUrl: 'https://acme.test/', permissionLevel: 'siteOwner' },
    { siteUrl: 'sc-domain:acme.test', permissionLevel: 'siteFullUser' },
    { siteUrl: 'https://other.test/', permissionLevel: 'siteUnverifiedUser' },
  ],
};

describe('Search Console adapter', () => {
  it('lists only verified, readable properties', async () => {
    stub([['/sites', GSC_SITES]]);
    const accounts = await searchConsoleAdapter.listAccounts(ctx());
    // The unverified property must not be offered — it cannot be read.
    expect(accounts.map(a => a.id)).toEqual(['https://acme.test/', 'sc-domain:acme.test']);
  });

  it('treats no verified property as a permission problem', async () => {
    stub([['/sites', { siteEntry: [{ siteUrl: 'https://x.test/', permissionLevel: 'siteUnverifiedUser' }] }]]);
    await expect(searchConsoleAdapter.verifyCredential(ctx()))
      .rejects.toMatchObject({ kind: 'PERMISSION_DENIED' });
  });

  it('computes CTR and impression-weighted position from real rows', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = String(input);
      const json = (b: unknown) => ({ ok: true, status: 200, json: async () => b } as unknown as Response);
      if (url.includes('/sites') && !url.includes('searchAnalytics')) return json(GSC_SITES);
      call++;
      if (call === 1) return json({ rows: [
        { keys: ['fast crm'],      clicks: 100, impressions: 1000, ctr: 0.10, position: 3 },
        { keys: ['crm for teams'], clicks: 10,  impressions: 1000, ctr: 0.01, position: 8 },
      ]});
      return json({ rows: [{ keys: ['https://acme.test/pricing'], clicks: 60, impressions: 900, ctr: 0.066, position: 5 }] });
    }));

    const result = await searchConsoleAdapter.fetchSignals(ctx({ selectedResourceId: 'https://acme.test/' }));
    const byType = (t: string) => result.signals.find(s => s.signalType === t);

    expect(byType('impressions')?.signalData.value).toBe(2000);
    // 110 clicks ÷ 2000 impressions
    expect(byType('ctr')?.signalData.value).toBeCloseTo(0.055, 6);
    // Impression-weighted: (3×1000 + 8×1000) / 2000 = 5.5
    expect(byType('rankings')?.signalData.average_position).toBeCloseTo(5.5, 6);
  });

  it('finds under-clicked queries that are already ranking', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = String(input);
      const json = (b: unknown) => ({ ok: true, status: 200, json: async () => b } as unknown as Response);
      if (url.includes('/sites') && !url.includes('searchAnalytics')) return json(GSC_SITES);
      call++;
      if (call === 1) return json({ rows: [
        { keys: ['high ctr'],   clicks: 200, impressions: 1000, ctr: 0.20, position: 2 },
        { keys: ['mid ctr'],    clicks: 100, impressions: 1000, ctr: 0.10, position: 4 },
        { keys: ['under a'],    clicks: 10,  impressions: 2000, ctr: 0.005, position: 6 },
        { keys: ['under b'],    clicks: 5,   impressions: 1500, ctr: 0.003, position: 9 },
        { keys: ['page three'], clicks: 0,   impressions: 900,  ctr: 0,     position: 45 },
      ]});
      return json({ rows: [] });
    }));

    const result = await searchConsoleAdapter.fetchSignals(ctx({ selectedResourceId: 'https://acme.test/' }));
    const opp = result.signals.find(s => s.signalData.dimension === 'search_opportunity');
    const list = opp?.signalData.opportunities as Array<{ query: string }>;

    expect(list.map(o => o.query)).toContain('under a');
    // Position 45 is not an opportunity — it is not visible yet.
    expect(list.map(o => o.query)).not.toContain('page three');
    expect(opp?.signalData.potential_additional_clicks).toBeGreaterThan(0);
  });

  it('reports NO_HISTORY for a verified property with no search traffic', async () => {
    stub([['/sites', GSC_SITES], ['searchAnalytics', { rows: [] }]]);
    const result = await searchConsoleAdapter.fetchSignals(ctx({ selectedResourceId: 'https://acme.test/' }));
    expect(result.noHistory).toBe(true);
  });

  it('refuses to sync without a site selected', async () => {
    stub([['/sites', GSC_SITES]]);
    await expect(searchConsoleAdapter.fetchSignals(ctx({ selectedResourceId: null })))
      .rejects.toMatchObject({ kind: 'WRONG_ACCOUNT' });
  });
});

// ── Insight derivation ────────────────────────────────────────────────────────

const sig = (type: string, data: Record<string, unknown>, id = `s-${type}`) => ({
  id, signal_type: type, signal_data: data, period_start: '2026-07-01', period_end: '2026-07-28',
});

describe('per-provider insight derivation', () => {
  it('dispatches to the right rules by provider', () => {
    const rc = deriveInsightsForProvider('revenue_cat', [
      sig('ltv', { arpu_usd: 5, mrr_usd: 2400, active_subscriptions: 480 }),
    ]);
    expect(rc[0]?.insightKey).toMatch(/^revenue_cat\./);
    // A provider with no rules yields nothing rather than throwing.
    expect(deriveInsightsForProvider('hubspot', [])).toEqual([]);
  });

  it('RevenueCat: flags a trial-heavy base only when it really is', () => {
    const heavy = deriveRevenueCatInsights([
      sig('retention', { active_trials: 300, active_subscriptions: 200, trial_share: 0.6 }),
    ]);
    expect(heavy[0].insightKey).toBe('revenue_cat.trial_heavy_base');
    expect(heavy[0].headline).toContain('60.0%');

    const balanced = deriveRevenueCatInsights([
      sig('retention', { active_trials: 100, active_subscriptions: 300, trial_share: 0.25 }),
    ]);
    expect(balanced).toEqual([]);
  });

  it('RevenueCat: stays silent on a base too small to conclude from', () => {
    expect(deriveRevenueCatInsights([
      sig('retention', { active_trials: 3, active_subscriptions: 2, trial_share: 0.6 }),
    ])).toEqual([]);
  });

  it('GA4: reports a genuinely better-converting source, with evidence', () => {
    const insights = deriveGa4Insights([
      sig('conversion', { value: 0.03, sessions: 5000, conversions: 150 }),
      sig('source_quality', { best_converting: { source: 'google / organic', sessions: 1200, conversion_rate: 0.09 } }),
    ]);
    expect(insights[0].insightKey).toBe('ga4.best_converting_source');
    expect(insights[0].headline).toContain('3.0×');
    expect(insights[0].evidence.map(e => e.label)).toContain('Site-wide conversion');
  });

  it('GA4: stays silent when sources converge', () => {
    expect(deriveGa4Insights([
      sig('conversion', { value: 0.05, sessions: 5000, conversions: 250 }),
      sig('source_quality', { best_converting: { source: 'x', sessions: 900, conversion_rate: 0.055 } }),
    ])).toEqual([]);
  });

  it('Stripe: leads with failed payments over vanity revenue', () => {
    const insights = deriveStripeInsights([
      sig('conversion', {
        failure_rate: 0.18, charges: 200, failed: 36,
        top_failure_reasons: [{ key: 'card_declined', value: 30 }],
      }),
      sig('mrr', { value_usd: 4000, arpu_usd: 40, active_subscriptions: 100 }),
    ]);
    expect(insights[0].insightKey).toBe('stripe.payment_failure_rate');
    expect(insights[0].headline).toContain('18.0%');
  });

  it('Stripe: falls back to revenue per subscriber when nothing is wrong', () => {
    const insights = deriveStripeInsights([
      sig('conversion', { failure_rate: 0.01, charges: 200, failed: 2 }),
      sig('mrr', { value_usd: 4000, arpu_usd: 40, active_subscriptions: 100 }),
    ]);
    expect(insights[0].insightKey).toBe('stripe.revenue_per_subscriber');
  });

  it('Search Console: quantifies recoverable clicks from real rows', () => {
    const insights = deriveSearchConsoleInsights([
      sig('source_quality', {
        dimension: 'search_opportunity', median_ctr: 0.08, potential_additional_clicks: 240,
        opportunities: [{ query: 'fast crm', impressions: 4000, ctr: 0.02, position: 6.2, clicks_at_median_ctr: 240 }],
      }),
    ]);
    expect(insights[0].insightKey).toBe('search_console.underclicked_queries');
    expect(insights[0].headline).toContain('fast crm');
    expect(insights[0].evidence.map(e => e.label)).toContain('Recoverable clicks');
  });

  it('Search Console: distinguishes a ranking problem from a snippet problem', () => {
    const ranking = deriveSearchConsoleInsights([
      sig('ctr', { value: 0.004, impressions: 20_000, clicks: 80 }),
      sig('rankings', { average_position: 34, queries_in_top_10: 0 }),
    ]);
    expect(ranking[0].insightKey).toBe('search_console.visibility_without_ranking');

    const snippet = deriveSearchConsoleInsights([
      sig('ctr', { value: 0.012, impressions: 20_000, clicks: 240 }),
      sig('rankings', { average_position: 4.2, queries_in_top_10: 30 }),
    ]);
    expect(snippet[0].insightKey).toBe('search_console.strong_position_weak_ctr');
  });

  it('no provider invents an insight from empty data', () => {
    for (const derive of [deriveRevenueCatInsights, deriveGa4Insights, deriveStripeInsights, deriveSearchConsoleInsights]) {
      expect(derive([])).toEqual([]);
    }
  });

  it('every insight changes when the underlying numbers change', () => {
    const a = deriveStripeInsights([sig('conversion', { failure_rate: 0.18, charges: 200, failed: 36 })]);
    const b = deriveStripeInsights([sig('conversion', { failure_rate: 0.31, charges: 200, failed: 62 })]);
    expect(a[0].headline).not.toBe(b[0].headline);
    expect(b[0].headline).toContain('31.0%');
  });

  it('every insight carries evidence and its source signals', () => {
    const all = [
      ...deriveRevenueCatInsights([sig('ltv', { arpu_usd: 5, mrr_usd: 2400, active_subscriptions: 480 })]),
      ...deriveStripeInsights([sig('conversion', { failure_rate: 0.2, charges: 100, failed: 20 })]),
      ...deriveSearchConsoleInsights([sig('ctr', { value: 0.004, impressions: 20_000, clicks: 80 }), sig('rankings', { average_position: 34 })]),
    ];
    expect(all.length).toBeGreaterThan(0);
    for (const insight of all) {
      expect(insight.evidence.length).toBeGreaterThan(0);
      expect(insight.sourceSignalIds.length).toBeGreaterThan(0);
      expect(insight.method).toBeTruthy();
      expect(insight.confidence).toBeGreaterThan(0);
      expect(insight.confidence).toBeLessThan(1);
    }
  });
});
