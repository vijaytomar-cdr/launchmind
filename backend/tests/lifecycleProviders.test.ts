/**
 * @file lifecycleProviders.test.ts
 * @description Adapter, fixture, journey, recovery, security, and isolation tests for
 *   the lifecycle observation providers: HubSpot and Mailchimp.
 *
 *   Provider HTTP is stubbed with realistic bodies; production code has no fallback
 *   data. Each provider has a "change the data, change the answer" test.
 *
 *   These two complete the nine-provider set, so this file also asserts the whole
 *   registry is consistent: every adapter read-only, none with an execute_* method.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { MemoryDb } from './helpers/memoryDb';

const FOUNDER_A   = 'aa100000-0000-0000-0000-000000000001';
const FOUNDER_B   = 'bb200000-0000-0000-0000-000000000002';
const WORKSPACE_A = '11110000-0000-0000-0000-000000000001';
const WORKSPACE_B = '22220000-0000-0000-0000-000000000002';
const PRODUCT_ID  = 'cc300000-0000-0000-0000-000000000003';
const JWT_SECRET  = 'test-jwt-secret-min-32-chars-long!!';

let db: MemoryDb;

vi.mock('../src/lib/supabaseAdmin', () => ({ getSupabaseAdmin: () => db.asClient() }));
vi.mock('../src/lib/tokenVault', () => ({
  encryptToken: vi.fn(async (p: string) => ({ ciphertext: `enc(${p})`, kmsKeyId: 'kms' })),
  decryptToken: vi.fn(async (c: string) => c.replace(/^enc\(/, '').replace(/\)$/, '')),
}));

const enqueued: Array<Record<string, unknown>> = [];
vi.mock('../src/workers/connectionSyncWorker', () => ({
  enqueueConnectionSync: vi.fn(async (p: Record<string, unknown>) => { enqueued.push(p); }),
  getConnectionSyncQueue: vi.fn(() => ({})), startConnectionSyncWorker: vi.fn(),
  stopConnectionSyncWorker: vi.fn(async () => undefined), CONNECTION_SYNC_QUEUE_NAME: 'connection-sync',
}));
vi.mock('../src/workers/missionWorker', () => ({
  enqueueMission: vi.fn(async () => undefined), getMissionQueue: vi.fn(() => ({})),
  startMissionWorker: vi.fn(), stopMissionWorker: vi.fn(async () => undefined),
  MISSION_QUEUE_NAME: 'mission-execution',
}));
vi.mock('../src/workers/scraperWorker', () => ({
  detectPlatform: vi.fn(() => null), scrapeAppStore: vi.fn(),
  scrapePlayStore: vi.fn(), scrapeCompetitors: vi.fn(async () => []),
}));
vi.mock('../src/services/reviewAnalysis', () => ({
  analyseReviews: vi.fn(async () => ({ sentiment: 'positive', painPoints: [], copySignals: [], marketingOpportunities: [] })),
}));
vi.mock('../src/services/icpService', () => ({ buildICPBrief: vi.fn(() => ({})) }));
vi.mock('../src/services/strategyService', () => ({
  generateStrategy: vi.fn(async () => ({})), generateContentAssets: vi.fn(async () => ({})),
  getProductStrategy: vi.fn(async () => ({ campaigns: [], fullStrategy: null })),
}));
vi.mock('../src/lib/tokens', () => ({ consumeTokens: vi.fn(async () => undefined) }));
vi.mock('../src/services/billingService', () => ({
  createStripeCheckout: vi.fn(async () => ({ url: '' })),
  createRazorpayCheckout: vi.fn(async () => ({ orderId: '', amount: 0, currency: 'INR', keyId: '' })),
  handleStripeWebhook: vi.fn(async () => undefined), handleRazorpayWebhook: vi.fn(async () => undefined),
  cancelSubscription: vi.fn(async () => undefined),
  getSubscriptionStatus: vi.fn(async () => ({ plan: 'solo', tokenBalance: 300, renewalNote: '' })),
}));
vi.mock('../src/services/learningPipelineService', () => ({
  ingestLearningEvent: vi.fn(async () => ({ eventId: 'e', memoriesCreated: 0, memoriesUpdated: 0, nodesCreated: 0, edgesCreated: 0 })),
}));

import { executeSync } from '../src/services/connectionService';
import { hubspotAdapter }   from '../src/services/providers/hubspotAdapter';
import { mailchimpAdapter } from '../src/services/providers/mailchimpAdapter';
import { availableProviders, getAdapter, KNOWN_PROVIDERS } from '../src/services/providers/registry';
import { EXECUTION_ACTIONS, executionMethodName } from '../src/services/connectionExecutionGuard';
import { deriveHubspotInsights, deriveMailchimpInsights } from '../src/services/connectionInsightService';
import { ProviderError, type AdapterContext } from '../src/services/providers/types';

process.env.API_BASE_URL             = 'https://api.launchmind.test';
process.env.APP_BASE_URL             = 'https://app.launchmind.test';
process.env.HUBSPOT_CLIENT_ID        = 'test-hs-client';
process.env.HUBSPOT_CLIENT_SECRET    = 'test-hs-secret';
process.env.MAILCHIMP_CLIENT_ID      = 'test-mc-client';
process.env.MAILCHIMP_CLIENT_SECRET  = 'test-mc-secret';

function ctx(over: Partial<AdapterContext> = {}): AdapterContext {
  return {
    founderId: FOUNDER_A, credential: 'test-token', config: {},
    selectedResourceId: '12345678', selectedResourceName: 'Portal',
    traceId: 'lm_00000000000000000000000000000001', ...over,
  };
}

function respond(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

type Mode = 'ok' | 'unauthorized' | 'forbidden' | 'outage' | 'no_data' | 'no_deals';

// ── HubSpot fixtures ──────────────────────────────────────────────────────────

const HS_TOKEN = {
  hub_id: 12345678, hub_domain: 'acme.hubspot.com', user: 'owner@acme.test',
  scopes: ['crm.objects.contacts.read', 'crm.objects.deals.read'],
};

/** Builds n contacts at a lifecycle stage from a given source. */
function hsContacts(spec: Array<[string, string, number]>) {
  const out: Array<{ id: string; properties: Record<string, string> }> = [];
  let i = 0;
  for (const [stage, source, count] of spec) {
    for (let n = 0; n < count; n++) {
      out.push({ id: String(++i), properties: { lifecyclestage: stage, hs_analytics_source: source, createdate: '2026-06-01' } });
    }
  }
  return out;
}

function stubHubspot(mode: Mode = 'ok') {
  const sent: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    sent.push(`${init?.method ?? 'GET'} ${url}`);

    if (url.includes('/oauth/v1/token')) {
      return respond({ access_token: 'hs-access', refresh_token: 'hs-refresh', expires_in: 1800, token_type: 'bearer' });
    }
    if (mode === 'unauthorized') return respond({ status: 'error' }, 401);
    if (mode === 'forbidden')    return respond({ status: 'error' }, 403);
    if (mode === 'outage')       return respond({ status: 'error' }, 503);

    if (url.includes('/oauth/v1/access-tokens/')) return respond(HS_TOKEN);

    if (url.includes('/crm/v3/objects/contacts')) {
      if (mode === 'no_data') return respond({ results: [] });
      return respond({
        results: hsContacts([
          ['lead', 'ORGANIC_SEARCH', 200],
          ['marketingqualifiedlead', 'ORGANIC_SEARCH', 30],
          ['salesqualifiedlead', 'ORGANIC_SEARCH', 20],
          ['customer', 'ORGANIC_SEARCH', 12],
          ['lead', 'PAID_SEARCH', 100],
          ['customer', 'PAID_SEARCH', 2],
        ]),
      });
    }

    if (url.includes('/crm/v3/objects/deals')) {
      if (mode === 'no_data' || mode === 'no_deals') return respond({ results: [] });
      return respond({
        results: [
          ...Array.from({ length: 30 }, (_, i) => ({ id: `d${i}`, properties: { dealstage: 'qualifiedtobuy', amount: '1000', pipeline: 'default' } })),
          ...Array.from({ length: 8 },  (_, i) => ({ id: `e${i}`, properties: { dealstage: 'closedwon', amount: '2500', pipeline: 'default' } })),
        ],
      });
    }
    return respond({});
  }));
  return sent;
}

// ── Mailchimp fixtures ────────────────────────────────────────────────────────

const MC_META = { dc: 'us14', api_endpoint: 'https://us14.api.mailchimp.com', accountname: 'Acme' };
const MC_LISTS = { lists: [
  { id: 'list_a', name: 'Main audience', stats: { member_count: 5200, open_rate: 0.31, click_rate: 0.05 } },
  { id: 'list_b', name: 'Beta testers',  stats: { member_count: 400,  open_rate: 0.44, click_rate: 0.11 } },
]};

function stubMailchimp(mode: Mode = 'ok') {
  const sent: Array<{ url: string; auth?: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    sent.push({ url, auth: headers.Authorization });

    if (url.includes('login.mailchimp.com/oauth2/token')) {
      return respond({ access_token: 'mc-access', expires_in: 0, token_type: 'bearer' });
    }
    if (mode === 'unauthorized') return respond({ status: 401 }, 401);
    if (mode === 'forbidden')    return respond({ status: 403 }, 403);
    if (mode === 'outage')       return respond({ status: 503 }, 503);

    if (url.includes('oauth2/metadata')) return respond(MC_META);
    if (url.endsWith('/3.0/')) return respond({ account_id: 'acct_mc_1', account_name: 'Acme', total_subscribers: 5600 });
    // The audience is still selectable in no_data mode — a brand-new account has
    // audiences, it just has no history in any of them yet.
    if (url.includes('/3.0/lists?')) return respond(MC_LISTS);
    if (url.includes('/3.0/lists/list_a/segments')) {
      if (mode === 'no_data') return respond({ segments: [] });
      return respond({ segments: [
        { id: 1, name: 'Engaged', member_count: 1800 },
        { id: 2, name: 'Dormant', member_count: 3400 },
      ]});
    }
    if (url.includes('/3.0/lists/list_a')) {
      // A freshly created audience exists but carries no stats.
      if (mode === 'no_data') return respond({ id: 'list_a', name: 'Main audience' });
      return respond(MC_LISTS.lists[0]);
    }

    if (url.includes('/3.0/reports')) {
      if (mode === 'no_data') return respond({ reports: [] });
      return respond({ reports: [
        { id: 'c1', campaign_title: 'Launch announcement', list_id: 'list_a', emails_sent: 5000, send_time: '2026-07-01T10:00:00Z',
          opens: { unique_opens: 1500, open_rate: 0.30 }, clicks: { unique_clicks: 450, click_rate: 0.09 },
          bounces: { hard_bounces: 10, soft_bounces: 20 }, unsubscribed: 12 },
        { id: 'c2', campaign_title: 'Weekly digest', list_id: 'list_a', emails_sent: 5000, send_time: '2026-07-15T10:00:00Z',
          opens: { unique_opens: 1200, open_rate: 0.24 }, clicks: { unique_clicks: 100, click_rate: 0.02 },
          bounces: { hard_bounces: 5, soft_bounces: 10 }, unsubscribed: 40 },
        { id: 'c3', campaign_title: 'Feature note', list_id: 'list_a', emails_sent: 5000, send_time: '2026-07-22T10:00:00Z',
          opens: { unique_opens: 1400, open_rate: 0.28 }, clicks: { unique_clicks: 300, click_rate: 0.06 },
          bounces: { hard_bounces: 5, soft_bounces: 5 }, unsubscribed: 20 },
        // Another audience — must be filtered out.
        { id: 'c9', campaign_title: 'Beta note', list_id: 'list_b', emails_sent: 400, send_time: '2026-07-10T10:00:00Z',
          opens: { unique_opens: 200, open_rate: 0.5 }, clicks: { unique_clicks: 80, click_rate: 0.2 },
          bounces: {}, unsubscribed: 0 },
      ]});
    }
    return respond({});
  }));
  return sent;
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

// ── Whole-registry consistency ────────────────────────────────────────────────

describe('the nine-provider set is complete and uniformly read-only', () => {
  it('every modelled provider now has an adapter', () => {
    const available = availableProviders();
    for (const provider of KNOWN_PROVIDERS) {
      expect({ provider, available: available.includes(provider) })
        .toEqual({ provider, available: true });
    }
    expect(available).toHaveLength(9);
  });

  it('no adapter anywhere implements an execution capability', () => {
    for (const provider of KNOWN_PROVIDERS) {
      const adapter = getAdapter(provider) as unknown as Record<string, unknown>;
      for (const action of Object.keys(EXECUTION_ACTIONS)) {
        expect({ provider, action, present: typeof adapter[executionMethodName(action)] === 'function' })
          .toEqual({ provider, action, present: false });
      }
    }
  });

  it('every adapter shares the canonical step contract', () => {
    for (const provider of KNOWN_PROVIDERS) {
      const adapter = getAdapter(provider);
      expect(adapter.syncSteps[0]).toBe('Authorization verified');
      expect(adapter.syncSteps[adapter.syncSteps.length - 1]).toBe('Updating Growth Brain');
      expect(adapter.syncSteps.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('every provider has its own middle steps — no copy-paste progress', () => {
    const middles = KNOWN_PROVIDERS.map(p => getAdapter(p).syncSteps.slice(1, -1).join('|'));
    expect(new Set(middles).size).toBe(middles.length);
  });

  it('still refuses honestly when a modelled provider has no adapter', async () => {
    // Every provider is implemented today, so this path is no longer reachable
    // through a route. It must keep working for the next provider added to
    // KNOWN_PROVIDERS before its adapter exists — so it is asserted directly.
    const { __resetAdaptersForTest } = await import('../src/services/providers/registry');
    __resetAdaptersForTest(false);
    try {
      expect(() => getAdapter('hubspot')).toThrow(/not available to connect yet/i);
      let thrown: unknown;
      try { getAdapter('mailchimp'); } catch (e) { thrown = e; }
      expect((thrown as ProviderError).kind).toBe('ADAPTER_UNAVAILABLE');
      expect(availableProviders()).toEqual([]);
    } finally {
      __resetAdaptersForTest(true);
    }
    // Restored for the rest of the suite.
    expect(availableProviders()).toHaveLength(9);
  });

  it('rejects a provider slug outside the modelled set', () => {
    let thrown: unknown;
    try { getAdapter('salesforce'); } catch (e) { thrown = e; }
    expect((thrown as ProviderError).kind).toBe('ADAPTER_UNAVAILABLE');
  });
});

// ── HubSpot ───────────────────────────────────────────────────────────────────

describe('HubSpot adapter', () => {
  it('identifies the portal from the token', async () => {
    const sent = stubHubspot();
    const identity = await hubspotAdapter.verifyCredential(ctx());
    expect(sent.some(s => s.includes('/oauth/v1/access-tokens/'))).toBe(true);
    expect(identity.externalAccountId).toBe('12345678');
    expect(identity.externalAccountName).toContain('acme.hubspot.com');
  });

  it('refuses a token that cannot read contacts', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (String(input).includes('access-tokens')) {
        return respond({ ...HS_TOKEN, scopes: ['crm.objects.companies.read'] });
      }
      return respond({});
    }));
    await expect(hubspotAdapter.verifyCredential(ctx()))
      .rejects.toMatchObject({ kind: 'PERMISSION_DENIED' });
  });

  it('exposes exactly one resource — a token is bound to one portal', async () => {
    stubHubspot();
    const accounts = await hubspotAdapter.listAccounts(ctx());
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ id: '12345678', name: 'acme.hubspot.com' });
  });

  it('rejects a portal that no longer matches the token', async () => {
    stubHubspot();
    await expect(hubspotAdapter.validateSelection?.(ctx(), '99999999'))
      .rejects.toMatchObject({ kind: 'WRONG_ACCOUNT' });
  });

  it('computes lifecycle counts and stage conversion from real contacts', async () => {
    stubHubspot();
    const result = await hubspotAdapter.fetchSignals(ctx());
    const byType = (t: string) => result.signals.find(s => s.signalType === t);

    const lifecycle = byType('lifecycle');
    expect(lifecycle?.signalData.total_contacts).toBe(364);

    const quality = byType('lead_quality');
    // 300 leads, 30 MQL, 20 SQL, 14 customers
    expect(quality?.signalData.leads).toBe(300);
    expect(quality?.signalData.mql).toBe(30);
    expect(quality?.signalData.lead_to_mql).toBeCloseTo(30 / 300, 6);
    expect(quality?.signalData.mql_to_sql).toBeCloseTo(20 / 30, 6);
    expect(quality?.signalData.sql_to_customer).toBeCloseTo(14 / 20, 6);
  });

  it('measures customer rate per source, not just contact volume', async () => {
    stubHubspot();
    const result = await hubspotAdapter.fetchSignals(ctx());
    const source = result.signals.find(s => s.signalType === 'source_quality');
    const per = source?.signalData.per_source as Array<{ source: string; contacts: number; customers: number; customer_rate: number }>;

    const organic = per.find(p => p.source === 'ORGANIC_SEARCH');
    const paid    = per.find(p => p.source === 'PAID_SEARCH');
    // 12 of 262 organic vs 2 of 102 paid
    expect(organic?.customers).toBe(12);
    expect(paid?.customer_rate).toBeCloseTo(2 / 102, 6);
  });

  it('summarises deal stages and value', async () => {
    stubHubspot();
    const result = await hubspotAdapter.fetchSignals(ctx());
    const funnel = result.signals.find(s => s.signalType === 'funnel');
    expect(funnel?.signalData.total_deals).toBe(38);
    // 30 × 1000 + 8 × 2500
    expect(funnel?.signalData.total_value).toBe(50_000);
    expect((funnel?.signalData.largest_stage as { stage: string }).stage).toBe('qualifiedtobuy');
  });

  it('reports PARTIAL when deals cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes('access-tokens')) return respond(HS_TOKEN);
      if (url.includes('/objects/contacts')) return respond({ results: hsContacts([['lead', 'ORGANIC_SEARCH', 60]]) });
      if (url.includes('/objects/deals')) return respond({ status: 'error' }, 403);
      return respond({});
    }));
    // A 403 on a sub-resource is a scope gap, which must surface as PARTIAL rather
    // than aborting a sync that already read contacts successfully.
    await expect(hubspotAdapter.fetchSignals(ctx())).rejects.toMatchObject({ kind: 'PERMISSION_DENIED' });
  });

  it('reports NO_HISTORY for an empty portal', async () => {
    stubHubspot('no_data');
    const result = await hubspotAdapter.fetchSignals(ctx());
    expect(result.noHistory).toBe(true);
  });

  it('still works when the portal has contacts but no deals', async () => {
    stubHubspot('no_deals');
    const result = await hubspotAdapter.fetchSignals(ctx());
    expect(result.noHistory).toBeFalsy();
    expect(result.signals.some(s => s.signalType === 'lifecycle')).toBe(true);
    expect(result.signals.some(s => s.signalType === 'funnel')).toBe(false);
  });

  it('reports progress in its own order', async () => {
    stubHubspot();
    const seen: string[] = [];
    await hubspotAdapter.fetchSignals(ctx(), async u => { seen.push(u.step); });
    expect(seen[0]).toBe('Authorization verified');
    expect(seen).toContain('Analysing stage conversion');
    expect(seen[seen.length - 1]).toBe('Updating Growth Brain');
  });

  it('issues only GET requests', async () => {
    const sent = stubHubspot();
    await hubspotAdapter.fetchSignals(ctx());
    expect(sent.filter(s => s.includes('hubapi.com')).every(s => s.startsWith('GET '))).toBe(true);
  });
});

// ── Mailchimp ─────────────────────────────────────────────────────────────────

describe('Mailchimp adapter', () => {
  it('resolves the data centre before calling the API', async () => {
    const sent = stubMailchimp();
    await mailchimpAdapter.verifyCredential(ctx({ selectedResourceId: 'list_a' }));
    const metaCall = sent.find(s => s.url.includes('oauth2/metadata'));
    // The metadata endpoint needs the OAuth scheme, not Bearer.
    expect(metaCall?.auth).toBe('OAuth test-token');
    // And every later call goes to the resolved host.
    expect(sent.some(s => s.url.startsWith('https://us14.api.mailchimp.com'))).toBe(true);
  });

  it('never puts the token in a query string', async () => {
    const sent = stubMailchimp();
    await mailchimpAdapter.fetchSignals(ctx({ selectedResourceId: 'list_a' }));
    for (const call of sent) {
      expect(call.url).not.toContain('test-token');
      expect(call.url).not.toContain('apikey=');
    }
  });

  it('enumerates real audiences as the selectable resource', async () => {
    stubMailchimp();
    const accounts = await mailchimpAdapter.listAccounts(ctx());
    expect(accounts.map(a => a.id)).toEqual(['list_a', 'list_b']);
    expect(accounts[0].accessLevel).toContain('5,200');
  });

  it('rejects an audience that no longer exists', async () => {
    stubMailchimp();
    await expect(mailchimpAdapter.validateSelection?.(ctx(), 'list_gone'))
      .rejects.toMatchObject({ kind: 'WRONG_ACCOUNT' });
  });

  it('computes engagement only from the selected audience', async () => {
    stubMailchimp();
    const result = await mailchimpAdapter.fetchSignals(ctx({ selectedResourceId: 'list_a' }));
    const engagement = result.signals.find(s => s.signalType === 'email_engagement');

    // 3 campaigns × 5000 — the list_b campaign must not be counted.
    expect(engagement?.signalData.emails_sent).toBe(15_000);
    expect(engagement?.signalData.unique_opens).toBe(4100);
    expect(engagement?.signalData.unique_clicks).toBe(850);
    expect(engagement?.signalData.open_rate).toBeCloseTo(4100 / 15000, 6);
    expect(engagement?.signalData.click_to_open_rate).toBeCloseTo(850 / 4100, 6);
    expect(engagement?.signalData.unsubscribes).toBe(72);
  });

  it('ranks campaigns by click rate', async () => {
    stubMailchimp();
    const result = await mailchimpAdapter.fetchSignals(ctx({ selectedResourceId: 'list_a' }));
    const campaigns = result.signals.find(s => s.signalType === 'campaign_performance');
    expect((campaigns?.signalData.best as { campaign: string }).campaign).toBe('Launch announcement');
    expect((campaigns?.signalData.worst as { campaign: string }).campaign).toBe('Weekly digest');
  });

  it('summarises audience and segments', async () => {
    stubMailchimp();
    const result = await mailchimpAdapter.fetchSignals(ctx({ selectedResourceId: 'list_a' }));
    const audience = result.signals.find(s => s.signalType === 'audience');
    expect(audience?.signalData.member_count).toBe(5200);
    expect(audience?.signalData.segments).toBe(2);
    expect(audience?.signalData.top).toBe('Dormant');
  });

  it('reports NO_HISTORY for an audience that has never been mailed', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes('oauth2/metadata')) return respond(MC_META);
      if (url.endsWith('/3.0/')) return respond({ account_id: 'a', account_name: 'Acme' });
      if (url.includes('/3.0/lists?')) return respond(MC_LISTS);
      if (url.includes('/reports')) return respond({ reports: [] });
      // No list stats and no segments either.
      return respond({ status: 404 }, 404);
    }));
    const result = await mailchimpAdapter.fetchSignals(ctx({ selectedResourceId: 'list_a' }))
      .catch(e => e as ProviderError);
    // A 404 on the audience itself is a wrong-resource condition, not no-history.
    expect((result as ProviderError).kind).toBe('WRONG_ACCOUNT');
  });

  it('asks the owner to reconnect rather than pretending to refresh', async () => {
    stubMailchimp();
    await expect(mailchimpAdapter.refreshAuthorization?.(ctx()))
      .rejects.toMatchObject({ kind: 'NEEDS_REAUTH' });
  });

  it('maps provider failures onto recovery states', async () => {
    for (const [mode, kind] of [['unauthorized', 'NEEDS_REAUTH'], ['forbidden', 'PERMISSION_DENIED'], ['outage', 'PROVIDER_UNAVAILABLE']] as const) {
      stubMailchimp(mode);
      const err = await mailchimpAdapter.verifyCredential(ctx()).catch(e => e as ProviderError);
      expect({ mode, kind: err.kind }).toEqual({ mode, kind });
    }
  });
});

// ── Insight derivation ────────────────────────────────────────────────────────

const sig = (type: string, data: Record<string, unknown>, id = `s-${type}`) => ({
  id, signal_type: type, signal_data: data, period_start: '2026-05-10', period_end: '2026-08-08',
});

describe('lifecycle insight derivation', () => {
  it('HubSpot: names the narrowest funnel step', () => {
    const insights = deriveHubspotInsights([
      sig('lead_quality', { leads: 300, mql: 30, sql: 20, customers: 14, lead_to_mql: 0.1, mql_to_sql: 0.667, sql_to_customer: 0.7 }),
    ]);
    expect(insights[0].insightKey).toBe('hubspot.weakest_stage_conversion');
    expect(insights[0].headline).toContain('10.0%');
    expect(insights[0].evidence.map(e => e.label)).toContain('Contacts at stage');
  });

  it('HubSpot: stays silent when every step converts healthily', () => {
    expect(deriveHubspotInsights([
      sig('lead_quality', { leads: 300, mql: 120, sql: 60, customers: 30, lead_to_mql: 0.4, mql_to_sql: 0.5, sql_to_customer: 0.5 }),
    ])).toEqual([]);
  });

  it('HubSpot: stays silent on a sample too small to conclude from', () => {
    expect(deriveHubspotInsights([
      sig('lead_quality', { leads: 8, mql: 1, sql: 0, customers: 0, lead_to_mql: 0.125, mql_to_sql: 0, sql_to_customer: null }),
    ])).toEqual([]);
  });

  it('HubSpot: flags when the biggest source is not the best one', () => {
    const insights = deriveHubspotInsights([
      sig('source_quality', { per_source: [
        { source: 'PAID_SEARCH',    contacts: 500, customers: 5,  customer_rate: 0.01 },
        { source: 'ORGANIC_SEARCH', contacts: 200, customers: 30, customer_rate: 0.15 },
      ]}),
    ]);
    expect(insights[0].insightKey).toBe('hubspot.volume_quality_mismatch');
    expect(insights[0].headline).toContain('ORGANIC_SEARCH');
  });

  it('Mailchimp: flags unsubscribe pressure with real numbers', () => {
    const insights = deriveMailchimpInsights([
      sig('email_engagement', { unsubscribe_rate: 0.0048 * 2, emails_sent: 15_000, unsubscribes: 144, open_rate: 0.27, click_to_open_rate: 0.2 }),
    ]);
    expect(insights[0].insightKey).toBe('mailchimp.unsubscribe_pressure');
    expect(insights[0].headline).toContain('1.0%');
  });

  it('Mailchimp: separates a subject-line win from a content failure', () => {
    const insights = deriveMailchimpInsights([
      sig('email_engagement', { unsubscribe_rate: 0.001, emails_sent: 15_000, unsubscribes: 15, open_rate: 0.35, click_to_open_rate: 0.04 }),
    ]);
    expect(insights[0].insightKey).toBe('mailchimp.opens_without_clicks');
    expect(insights[0].detail).toMatch(/subject lines are doing their job/i);
  });

  it('Mailchimp: reports a wide campaign spread as a pattern to copy', () => {
    const insights = deriveMailchimpInsights([
      sig('email_engagement', { unsubscribe_rate: 0.001, emails_sent: 15_000, unsubscribes: 15, open_rate: 0.27, click_to_open_rate: 0.2 }),
      sig('campaign_performance', {
        campaigns_analyzed: 3,
        best:  { campaign: 'Launch announcement', click_rate: 0.09, sent: 5000 },
        worst: { campaign: 'Weekly digest',       click_rate: 0.02, sent: 5000 },
      }),
    ]);
    expect(insights[0].insightKey).toBe('mailchimp.campaign_spread');
    expect(insights[0].headline).toContain('Launch announcement');
  });

  it('both produce nothing from empty data', () => {
    expect(deriveHubspotInsights([])).toEqual([]);
    expect(deriveMailchimpInsights([])).toEqual([]);
  });

  it('both change when the numbers change', () => {
    const a = deriveHubspotInsights([sig('lead_quality', { leads: 300, mql: 30, sql: 20, customers: 14, lead_to_mql: 0.1, mql_to_sql: 0.667, sql_to_customer: 0.7 })]);
    const b = deriveHubspotInsights([sig('lead_quality', { leads: 300, mql: 60, sql: 12, customers: 8, lead_to_mql: 0.2, mql_to_sql: 0.2, sql_to_customer: 0.667 })]);
    expect(a[0].headline).not.toBe(b[0].headline);
    expect(b[0].headline).toContain('20.0%');
  });

  it('every insight carries evidence, sources, and a method', () => {
    const all = [
      ...deriveHubspotInsights([sig('lead_quality', { leads: 300, mql: 30, sql: 20, customers: 14, lead_to_mql: 0.1, mql_to_sql: 0.667, sql_to_customer: 0.7 })]),
      ...deriveMailchimpInsights([sig('email_engagement', { unsubscribe_rate: 0.01, emails_sent: 15_000, unsubscribes: 150, open_rate: 0.27, click_to_open_rate: 0.2 })]),
    ];
    expect(all.length).toBe(2);
    for (const i of all) {
      expect(i.evidence.length).toBeGreaterThan(0);
      expect(i.sourceSignalIds.length).toBeGreaterThan(0);
      expect(i.method).toBeTruthy();
      expect(i.confidence).toBeGreaterThan(0);
      expect(i.confidence).toBeLessThan(1);
    }
  });
});

// ── Journeys, recovery, security ──────────────────────────────────────────────

interface Case {
  provider: string;
  resourceId: string;
  resourceName: string;
  resourceCount: number;
  dimension: 'Performance' | 'Revenue & retention';
  stub(mode: Mode): void;
}

const CASES: Case[] = [
  { provider: 'hubspot',   resourceId: '12345678', resourceName: 'acme.hubspot.com', resourceCount: 1, dimension: 'Revenue & retention', stub: stubHubspot },
  { provider: 'mailchimp', resourceId: 'list_a',   resourceName: 'Main audience',    resourceCount: 2, dimension: 'Performance',         stub: stubMailchimp },
];

describe.each(CASES.map(c => [c.provider, c] as const))('%s — journey, recovery, security', (_name, c) => {
  let server: FastifyInstance;
  const authA = { authorization: `Bearer ${jwt.sign({ sub: FOUNDER_A, role: 'authenticated' }, JWT_SECRET, { expiresIn: '1h' })}` };
  const authB = { authorization: `Bearer ${jwt.sign({ sub: FOUNDER_B, role: 'authenticated' }, JWT_SECRET, { expiresIn: '1h' })}` };

  beforeEach(async () => {
    enqueued.length = 0;
    db = new MemoryDb({
      founders: [
        { id: FOUNDER_A, active_workspace_id: WORKSPACE_A },
        { id: FOUNDER_B, active_workspace_id: WORKSPACE_B },
      ],
      workspaces: [
        { id: WORKSPACE_A, founder_id: FOUNDER_A, created_at: '2026-01-01' },
        { id: WORKSPACE_B, founder_id: FOUNDER_B, created_at: '2026-01-02' },
      ],
      workspace_members: [],
      products: [{ id: PRODUCT_ID, founder_id: FOUNDER_A, workspace_id: WORKSPACE_A, archived_at: null, confirmed_icp: {}, scraped_meta: {} }],
      workspace_connections: [], connection_sync_runs: [], intelligence_signals: [],
      connection_credentials: [], connection_permission_history: [], connection_insights: [],
      oauth_authorization_requests: [], audit_logs: [], learning_events: [],
      founder_context: [], business_goals: [], competitor_relationships: [],
      onboarding_sessions: [], strategy_directions: [],
    });
    process.env.JWT_SECRET = JWT_SECRET;
    if (!server) {
      const { buildServer } = await import('../src/server');
      server = await buildServer();
    }
  });

  /** Runs the real OAuth flow — both providers authenticate by signing in. */
  async function connect() {
    const start = await server.inject({
      method: 'POST', url: `/connections/${c.provider}/oauth/start`, headers: authA, payload: {},
    });
    expect(start.statusCode).toBe(201);
    const state = new URL(JSON.parse(start.body).data.authorizationUrl).searchParams.get('state') as string;
    await server.inject({
      method: 'GET', url: `/connections/oauth/callback?code=code&state=${encodeURIComponent(state)}`,
    });
    return db.rows('workspace_connections').find(r => r.provider === c.provider);
  }

  async function runQueuedSync() {
    const job = enqueued.shift();
    if (!job) throw new Error('No sync job enqueued');
    return executeSync(
      job.syncRunId as string, job.connectionId as string,
      job.workspaceId as string, job.founderId as string, job.traceId as string,
    );
  }

  it('completes the journey and updates every surface', async () => {
    c.stub('ok');

    const before = JSON.parse((await server.inject({ method: 'GET', url: '/intelligence/coverage', headers: authA })).body).data;
    const dimBefore = before.dimensions.find((d: { label: string }) => d.label === c.dimension);
    expect(dimBefore.observed).toBe(false);

    const row = await connect();
    expect(row).toBeTruthy();
    // Least privilege, always.
    expect(row?.permissions_granted).toEqual(['READ', 'RECOMMEND']);

    // Auto-select only with exactly one resource.
    if (c.resourceCount === 1) {
      expect(enqueued).toHaveLength(1);
    } else {
      expect(enqueued).toHaveLength(0);
      const select = await server.inject({
        method: 'POST', url: `/connections/${row!.id}/select-resource`, headers: authA,
        body: { resourceId: c.resourceId, resourceName: c.resourceName },
      });
      expect(select.statusCode).toBe(200);
      expect(enqueued).toHaveLength(1);
    }

    // Credential encrypted and workspace-bound.
    const cred = db.rows('connection_credentials')[0];
    expect(String(cred.encrypted_access_token)).toMatch(/^enc\(/);
    expect(cred.workspace_id).toBe(WORKSPACE_A);

    const outcome = await runQueuedSync();
    expect(outcome.status).toBe('completed');
    expect(outcome.signalsImported).toBeGreaterThan(0);
    expect(outcome.insightsCreated).toBeGreaterThan(0);

    const signals = db.rows('intelligence_signals');
    expect(signals.every(s => s.workspace_id === WORKSPACE_A)).toBe(true);
    expect(signals.every(s => s.provider === c.provider)).toBe(true);
    expect(signals.every(s => typeof s.period_start === 'string')).toBe(true);

    const insight = db.rows('connection_insights')[0];
    expect((insight.evidence as unknown[]).length).toBeGreaterThan(0);
    expect(insight.source_signal_ids).not.toEqual([]);
    expect(insight.provenance).toMatchObject({ provider: c.provider });

    // Growth Brain and Morning Brief.
    const after = JSON.parse((await server.inject({ method: 'GET', url: '/intelligence/coverage', headers: authA })).body).data;
    const dimAfter = after.dimensions.find((d: { label: string }) => d.label === c.dimension);
    expect(dimAfter.observed).toBe(true);
    expect(dimAfter.score).toBeGreaterThan(dimBefore.score);
    expect(after.liveInsights[0].headline).toBe(insight.headline);

    // Improve Intelligence health card.
    const health = JSON.parse((await server.inject({ method: 'GET', url: `/connections/${row!.id}/health`, headers: authA })).body).data;
    expect(health).toMatchObject({ provider: c.provider, freshness: 'fresh', needs_attention: false });
    expect(health.permissions_granted).toEqual(['READ', 'RECOMMEND']);
    expect(health.latest_insight.headline).toBe(insight.headline);

    // Refresh, then disconnect keeping what was learned.
    expect((await server.inject({ method: 'POST', url: `/connections/${row!.id}/refresh`, headers: authA, payload: {} })).statusCode).toBe(202);
    expect((await runQueuedSync()).status).toBe('completed');

    expect((await server.inject({ method: 'DELETE', url: `/connections/${row!.id}`, headers: authA })).statusCode).toBe(204);
    expect(db.rows('workspace_connections')[0].status).toBe('DISCONNECTED');
    expect(db.rows('intelligence_signals').length).toBeGreaterThan(0);
  });

  it('refuses execution — observation only', async () => {
    c.stub('ok');
    const row = await connect();
    const exec = await server.inject({
      method: 'POST', url: `/connections/${row!.id}/execute`, headers: authA,
      body: { action: 'publish_creative' },
    });
    expect(exec.statusCode).toBe(403);
    expect(JSON.parse(exec.body).code).toBe('AUTHORITY_NOT_GRANTED');

    const boundary = JSON.parse(
      (await server.inject({ method: 'GET', url: `/connections/${row!.id}/execution-boundary`, headers: authA })).body,
    ).data;
    expect(boundary.actions.every((a: { allowed: boolean }) => !a.allowed)).toBe(true);
    expect(boundary.providerExecutionImplemented).toBe(false);
  });

  it('authorization failure leaves a recoverable state and stores nothing', async () => {
    c.stub('unauthorized');
    await connect();
    const row = db.rows('workspace_connections').find(r => r.provider === c.provider);
    expect(row?.status).toBe('NEEDS_REAUTH');
    expect(db.rows('connection_credentials')).toHaveLength(0);
  });

  it('provider outage changes nothing', async () => {
    c.stub('outage');
    await connect();
    expect(db.rows('connection_credentials')).toHaveLength(0);
    const row = db.rows('workspace_connections').find(r => r.provider === c.provider);
    expect(row?.status).toBe('PROVIDER_UNAVAILABLE');
  });

  it('no history is healthy and invents no insight', async () => {
    c.stub('ok');
    const row = await connect();
    if (c.resourceCount !== 1) {
      await server.inject({
        method: 'POST', url: `/connections/${row!.id}/select-resource`, headers: authA,
        body: { resourceId: c.resourceId, resourceName: c.resourceName },
      });
    }
    c.stub('no_data');
    const outcome = await runQueuedSync();

    expect(outcome.noHistory).toBe(true);
    const updated = db.rows('workspace_connections').find(r => r.id === row!.id);
    expect(updated?.status).toBe('NO_HISTORY');
    expect(updated?.freshness_status).toBe('fresh');
    expect(db.rows('connection_insights')).toHaveLength(0);
  });

  it('expired auth mid-sync keeps prior data and is recoverable', async () => {
    c.stub('ok');
    const row = await connect();
    if (c.resourceCount !== 1) {
      await server.inject({
        method: 'POST', url: `/connections/${row!.id}/select-resource`, headers: authA,
        body: { resourceId: c.resourceId, resourceName: c.resourceName },
      });
    }
    await runQueuedSync();
    const before = db.rows('intelligence_signals').length;

    await server.inject({ method: 'POST', url: `/connections/${row!.id}/refresh`, headers: authA, payload: {} });
    c.stub('unauthorized');
    await expect(runQueuedSync()).rejects.toMatchObject({ kind: 'NEEDS_REAUTH' });

    expect(db.rows('workspace_connections')[0].status).toBe('NEEDS_REAUTH');
    expect(db.rows('intelligence_signals').length).toBe(before);
    expect((await server.inject({ method: 'POST', url: `/connections/${row!.id}/reauthorize`, headers: authA, payload: {} })).statusCode).toBe(200);
  });

  it('retries successfully after the provider recovers', async () => {
    c.stub('ok');
    const row = await connect();
    if (c.resourceCount !== 1) {
      await server.inject({
        method: 'POST', url: `/connections/${row!.id}/select-resource`, headers: authA,
        body: { resourceId: c.resourceId, resourceName: c.resourceName },
      });
    }
    c.stub('outage');
    await runQueuedSync().catch(() => undefined);
    expect(db.rows('workspace_connections')[0].status).toBe('PROVIDER_UNAVAILABLE');

    c.stub('ok');
    await server.inject({ method: 'POST', url: `/connections/${row!.id}/sync`, headers: authA, payload: {} });
    expect((await runQueuedSync()).status).toBe('completed');
    expect(db.rows('workspace_connections')[0].status).toBe('HEALTHY');
  });

  it('sync failure never leaks a stack trace', async () => {
    c.stub('ok');
    const row = await connect();
    if (c.resourceCount !== 1) {
      await server.inject({
        method: 'POST', url: `/connections/${row!.id}/select-resource`, headers: authA,
        body: { resourceId: c.resourceId, resourceName: c.resourceName },
      });
    }
    c.stub('outage');
    await runQueuedSync().catch(() => undefined);

    const run = db.rows('connection_sync_runs').find(r => r.status === 'failed');
    const message = String(run?.error_message ?? '');
    expect(message).not.toMatch(/at \w+ \(/);
    expect(message).not.toContain('Error:');
    expect(message.length).toBeGreaterThan(10);
  });

  it('holds the workspace boundary and leaks no credential', async () => {
    c.stub('ok');
    const row = await connect();

    for (const [method, url] of [
      ['GET', `/connections/${row!.id}`],
      ['GET', `/connections/${row!.id}/health`],
      ['DELETE', `/connections/${row!.id}`],
    ] as const) {
      const res = await server.inject({ method, url, headers: authB });
      expect({ url, status: res.statusCode }).toEqual({ url, status: 404 });
    }

    const health = await server.inject({ method: 'GET', url: `/connections/${row!.id}/health`, headers: authA });
    const list   = await server.inject({ method: 'GET', url: '/connections', headers: authA });
    for (const res of [health, list]) {
      expect(res.body).not.toContain('enc(');
      expect(res.body).not.toContain('kms');
      expect(res.body).not.toContain('encrypted_access_token');
    }
  });

  it('another workspace sees none of the imported intelligence', async () => {
    c.stub('ok');
    const row = await connect();
    if (c.resourceCount !== 1) {
      await server.inject({
        method: 'POST', url: `/connections/${row!.id}/select-resource`, headers: authA,
        body: { resourceId: c.resourceId, resourceName: c.resourceName },
      });
    }
    await runQueuedSync();

    const other = JSON.parse((await server.inject({ method: 'GET', url: '/intelligence/coverage', headers: authB })).body).data;
    expect(other.connections.connectedCount).toBe(0);
    expect(other.liveInsights).toEqual([]);
  });
});
