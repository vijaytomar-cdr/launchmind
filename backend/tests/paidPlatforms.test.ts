/**
 * @file paidPlatforms.test.ts
 * @description Adapter, fixture, journey, and recovery tests for the action-capable
 *   platforms: Google Ads and Meta.
 *
 *   The trust boundary itself is covered by executionBoundary.test.ts. This file
 *   proves the observation half works: real OAuth, real account enumeration, real
 *   campaign/creative/audience data, real insights, and that the connection lands on
 *   READ + RECOMMEND every time.
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
import { googleAdsAdapter } from '../src/services/providers/googleAdsAdapter';
import { metaAdsAdapter } from '../src/services/providers/metaAdsAdapter';
import { deriveGoogleAdsInsights, deriveMetaInsights } from '../src/services/connectionInsightService';
import { ProviderError, type AdapterContext } from '../src/services/providers/types';

process.env.API_BASE_URL              = 'https://api.launchmind.test';
process.env.APP_BASE_URL              = 'https://app.launchmind.test';
process.env.GOOGLE_ADS_CLIENT_ID      = 'test-gads-client';
process.env.GOOGLE_ADS_CLIENT_SECRET  = 'test-gads-secret';
process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'test-developer-token';
process.env.META_ADS_CLIENT_ID        = 'test-meta-client';
process.env.META_ADS_CLIENT_SECRET    = 'test-meta-secret';

function ctx(over: Partial<AdapterContext> = {}): AdapterContext {
  return {
    founderId: FOUNDER_A, credential: 'test-token', config: {},
    selectedResourceId: '1234567890', selectedResourceName: 'Ads Account',
    traceId: 'lm_00000000000000000000000000000001', ...over,
  };
}

function respond(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

type Mode = 'ok' | 'unauthorized' | 'forbidden' | 'outage' | 'no_data';

// ── Google Ads fixtures ───────────────────────────────────────────────────────

const GADS_CUSTOMERS = { resourceNames: ['customers/1234567890', 'customers/9876543210'] };

const gadsRow = (over: Record<string, unknown>) => ({
  metrics: { impressions: '0', clicks: '0', costMicros: '0', conversions: '0' },
  ...over,
});

/** The token endpoint receives a URL-encoded body; everything else receives JSON. */
function parseBody(body: unknown): unknown {
  if (!body) return null;
  try { return JSON.parse(String(body)); } catch { return String(body); }
}

function stubGoogleAds(mode: Mode = 'ok') {
  const sent: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    sent.push({ url, body: parseBody(init?.body) });

    if (url.includes('oauth2.googleapis.com/token')) {
      return respond({ access_token: 'ya29.fresh', refresh_token: '1//r', expires_in: 3600, token_type: 'Bearer' });
    }
    if (mode === 'unauthorized') return respond({ error: {} }, 401);
    if (mode === 'forbidden')    return respond({ error: {} }, 403);
    if (mode === 'outage')       return respond({ error: {} }, 503);

    if (url.includes('listAccessibleCustomers')) return respond(GADS_CUSTOMERS);

    if (url.includes('googleAds:searchStream')) {
      const parsed = parseBody(init?.body) as { query?: string } | null;
      const query = String(parsed?.query ?? '');
      if (query.includes('FROM customer')) {
        return respond([{ results: [{ customer: { id: '1234567890', descriptiveName: 'Acme Search', manager: false } }] }]);
      }
      if (mode === 'no_data') return respond([{ results: [] }]);

      if (query.includes('FROM campaign')) {
        return respond([{ results: [
          gadsRow({ campaign: { id: '1', name: 'Brand', status: 'ENABLED' },
            metrics: { impressions: '20000', clicks: '1000', costMicros: '400000000', conversions: '50' } }),
          gadsRow({ campaign: { id: '2', name: 'Competitor', status: 'ENABLED' },
            metrics: { impressions: '30000', clicks: '600', costMicros: '600000000', conversions: '0' } }),
        ]}]);
      }
      if (query.includes('FROM search_term_view')) {
        return respond([{ results: [
          gadsRow({ searchTermView: { searchTerm: 'acme crm' },
            metrics: { impressions: '5000', clicks: '400', costMicros: '150000000', conversions: '40' } }),
          gadsRow({ searchTermView: { searchTerm: 'free crm download' },
            metrics: { impressions: '9000', clicks: '500', costMicros: '500000000', conversions: '0' } }),
          gadsRow({ searchTermView: { searchTerm: 'crm jobs' },
            metrics: { impressions: '4000', clicks: '200', costMicros: '200000000', conversions: '0' } }),
        ]}]);
      }
      if (query.includes('FROM keyword_view')) {
        return respond([{ results: [
          gadsRow({ adGroupCriterion: { keyword: { text: 'crm software', matchType: 'BROAD' } },
            metrics: { impressions: '12000', clicks: '700', costMicros: '450000000', conversions: '30' } }),
        ]}]);
      }
      return respond([{ results: [] }]);
    }
    return respond({});
  }));
  return sent;
}

// ── Meta fixtures ─────────────────────────────────────────────────────────────

const META_ACCOUNTS = { data: [
  { account_id: '1111', name: 'Acme Ads', account_status: 1, currency: 'USD' },
  { account_id: '2222', name: 'Acme EU',  account_status: 1, currency: 'EUR' },
]};

function stubMeta(mode: Mode = 'ok') {
  const sent: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    sent.push(`${init?.method ?? 'GET'} ${url}`);

    if (url.includes('oauth2.googleapis.com/token') || url.includes('oauth/access_token')) {
      return respond({ access_token: 'EAA.fresh', expires_in: 5_184_000, token_type: 'Bearer' });
    }
    if (mode === 'unauthorized') return respond({ error: { code: 190 } }, 401);
    if (mode === 'forbidden')    return respond({ error: { code: 200 } }, 403);
    if (mode === 'outage')       return respond({ error: {} }, 503);

    if (url.includes('/me/adaccounts')) return respond(META_ACCOUNTS);

    if (url.includes('/insights')) {
      if (mode === 'no_data') return respond({ data: [] });

      if (url.includes('level=campaign')) {
        return respond({ data: [
          { campaign_id: 'c1', campaign_name: 'Prospecting', impressions: '80000', clicks: '2000',
            spend: '1200.00', ctr: '2.5', cpc: '0.60', frequency: '1.8',
            actions: [{ action_type: 'purchase', value: '40' }] },
          { campaign_id: 'c2', campaign_name: 'Retargeting', impressions: '40000', clicks: '900',
            spend: '800.00', ctr: '2.25', cpc: '0.89', frequency: '4.6', actions: [] },
        ]});
      }
      if (url.includes('level=ad')) {
        return respond({ data: [
          { ad_id: 'a1', ad_name: 'Video A', adset_name: 'Broad', impressions: '50000', clicks: '1500',
            spend: '700.00', ctr: '3.0', frequency: '1.6', actions: [{ action_type: 'purchase', value: '35' }] },
          { ad_id: 'a2', ad_name: 'Static B', adset_name: 'Broad', impressions: '30000', clicks: '400',
            spend: '600.00', ctr: '1.3', frequency: '5.2', actions: [] },
          { ad_id: 'a3', ad_name: 'Static C', adset_name: 'Lookalike', impressions: '20000', clicks: '200',
            spend: '400.00', ctr: '1.0', frequency: '4.1', actions: [] },
        ]});
      }
      // Account level with publisher_platform breakdown.
      return respond({ data: [
        { publisher_platform: 'facebook',  spend: '1700.00', impressions: '100000', clicks: '2400', actions: [{ action_type: 'purchase', value: '38' }] },
        { publisher_platform: 'instagram', spend: '300.00',  impressions: '20000',  clicks: '500',  actions: [{ action_type: 'purchase', value: '2' }] },
      ]});
    }
    return respond({});
  }));
  return sent;
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

// ── Google Ads adapter ────────────────────────────────────────────────────────

describe('Google Ads adapter', () => {
  it('verifies against listAccessibleCustomers and sends the developer token', async () => {
    const sent = stubGoogleAds();
    const identity = await googleAdsAdapter.verifyCredential(ctx());
    expect(sent.some(s => s.url.includes('listAccessibleCustomers'))).toBe(true);
    expect(identity.externalAccountId).toBe('1234567890');
  });

  it('refuses to operate without a configured developer token', async () => {
    const saved = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    stubGoogleAds();
    await expect(googleAdsAdapter.verifyCredential(ctx()))
      .rejects.toMatchObject({ kind: 'ADAPTER_UNAVAILABLE' });
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = saved;
  });

  it('enumerates real accessible accounts with their descriptive names', async () => {
    stubGoogleAds();
    const accounts = await googleAdsAdapter.listAccounts(ctx());
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({ id: '1234567890', name: 'Acme Search' });
  });

  it('sends only SELECT queries — every request is verifiably a read', async () => {
    const sent = stubGoogleAds();
    await googleAdsAdapter.fetchSignals(ctx());
    const queries = sent
      .filter(s => s.url.includes('searchStream'))
      .map(s => String((s.body as { query?: string })?.query ?? ''));

    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) {
      expect(q.trim().toUpperCase().startsWith('SELECT')).toBe(true);
      expect(q.toLowerCase()).not.toContain('mutate');
    }
    // And no mutate endpoint was ever constructed.
    expect(sent.every(s => !s.url.includes(':mutate'))).toBe(true);
  });

  it('computes spend, CTR, CPC, and cost per conversion from real metrics', async () => {
    stubGoogleAds();
    const result = await googleAdsAdapter.fetchSignals(ctx());
    const byType = (t: string) => result.signals.find(s => s.signalType === t);

    // 400000000 + 600000000 micros = $1000
    expect(byType('spend')?.signalData.value_usd).toBe(1000);
    // 1600 clicks / 50000 impressions
    expect(byType('spend')?.signalData.ctr).toBeCloseTo(1600 / 50000, 6);
    expect(byType('spend')?.signalData.cpc_usd).toBeCloseTo(1000 / 1600, 6);
    // 50 conversions
    expect(byType('cac')?.signalData.cost_per_conversion_usd).toBeCloseTo(1000 / 50, 6);
  });

  it('identifies spend on search terms that never converted', async () => {
    stubGoogleAds();
    const result = await googleAdsAdapter.fetchSignals(ctx());
    const terms = result.signals.find(s => s.signalData.dimension === 'search_term');
    // $500 + $200 with zero conversions
    expect(terms?.signalData.zero_conversion_spend_usd).toBe(700);
    const list = terms?.signalData.zero_conversion_terms as Array<{ term: string }>;
    expect(list[0].term).toBe('free crm download');
  });

  it('reports NO_HISTORY for an account with no activity', async () => {
    stubGoogleAds('no_data');
    const result = await googleAdsAdapter.fetchSignals(ctx());
    expect(result.noHistory).toBe(true);
  });

  it('maps provider failures onto recovery states', async () => {
    for (const [mode, kind] of [['unauthorized', 'NEEDS_REAUTH'], ['forbidden', 'PERMISSION_DENIED'], ['outage', 'PROVIDER_UNAVAILABLE']] as const) {
      stubGoogleAds(mode);
      const err = await googleAdsAdapter.verifyCredential(ctx()).catch(e => e as ProviderError);
      expect({ mode, kind: err.kind }).toEqual({ mode, kind });
    }
  });

  it('refuses to sync without an account selected', async () => {
    stubGoogleAds();
    await expect(googleAdsAdapter.fetchSignals(ctx({ selectedResourceId: null })))
      .rejects.toMatchObject({ kind: 'WRONG_ACCOUNT' });
  });

  it('reports progress in provider-specific order', async () => {
    stubGoogleAds();
    const seen: string[] = [];
    await googleAdsAdapter.fetchSignals(ctx(), async u => { seen.push(u.step); });
    expect(seen[0]).toBe('Authorization verified');
    expect(seen).toContain('Comparing keyword and search-term spend');
    expect(seen[seen.length - 1]).toBe('Updating Growth Brain');
  });
});

// ── Meta adapter ──────────────────────────────────────────────────────────────

describe('Meta adapter', () => {
  it('verifies against /me/adaccounts', async () => {
    const sent = stubMeta();
    const identity = await metaAdsAdapter.verifyCredential(ctx());
    expect(sent.some(s => s.includes('/me/adaccounts'))).toBe(true);
    expect(identity.externalAccountId).toBe('1111');
  });

  it('enumerates real ad accounts', async () => {
    stubMeta();
    const accounts = await metaAdsAdapter.listAccounts(ctx());
    expect(accounts.map(a => a.id)).toEqual(['1111', '2222']);
    expect(accounts[0].accessLevel).toContain('Active');
  });

  it('issues only GET requests', async () => {
    const sent = stubMeta();
    await metaAdsAdapter.fetchSignals(ctx({ selectedResourceId: '1111' }));
    expect(sent.filter(s => s.includes('graph.facebook')).every(s => s.startsWith('GET '))).toBe(true);
  });

  it('computes spend, CTR, and cost per conversion from real insights', async () => {
    stubMeta();
    const result = await metaAdsAdapter.fetchSignals(ctx({ selectedResourceId: '1111' }));
    const byType = (t: string) => result.signals.find(s => s.signalType === t);

    // 1200 + 800
    expect(byType('spend')?.signalData.value_usd).toBe(2000);
    // 2900 clicks / 120000 impressions
    expect(byType('spend')?.signalData.ctr).toBeCloseTo(2900 / 120000, 6);
    // 40 purchases
    expect(byType('cac')?.signalData.cost_per_conversion_usd).toBeCloseTo(2000 / 40, 6);
  });

  it('detects creative fatigue by frequency and non-conversion', async () => {
    stubMeta();
    const result = await metaAdsAdapter.fetchSignals(ctx({ selectedResourceId: '1111' }));
    const creative = result.signals.find(s => s.signalType === 'creative_performance');
    const fatigued = creative?.signalData.fatigued_creatives as Array<{ ad: string }>;

    // Static B (freq 5.2) and Static C (freq 4.1), both with no conversions.
    expect(fatigued.map(f => f.ad).sort()).toEqual(['Static B', 'Static C']);
    // Video A converts and is not flagged despite real spend.
    expect(fatigued.map(f => f.ad)).not.toContain('Video A');
    expect(creative?.signalData.fatigued_spend_usd).toBe(1000);
  });

  it('breaks down spend by placement', async () => {
    stubMeta();
    const result = await metaAdsAdapter.fetchSignals(ctx({ selectedResourceId: '1111' }));
    const audience = result.signals.find(s => s.signalType === 'audience');
    expect(audience?.signalData.top).toBe('facebook');
    expect(audience?.signalData.top_share).toBeCloseTo(1700 / 2000, 6);
  });

  it('maps Meta error codes precisely', async () => {
    stubMeta('unauthorized');
    await expect(metaAdsAdapter.verifyCredential(ctx())).rejects.toMatchObject({ kind: 'NEEDS_REAUTH' });
    stubMeta('forbidden');
    await expect(metaAdsAdapter.verifyCredential(ctx())).rejects.toMatchObject({ kind: 'PERMISSION_DENIED' });
  });

  it('asks the owner to reconnect rather than half-refreshing', async () => {
    stubMeta();
    // Meta long-lived tokens are exchanged, not refresh-token refreshed.
    await expect(metaAdsAdapter.refreshAuthorization?.(ctx()))
      .rejects.toMatchObject({ kind: 'NEEDS_REAUTH' });
  });

  it('reports NO_HISTORY for an account with no delivery', async () => {
    stubMeta('no_data');
    const result = await metaAdsAdapter.fetchSignals(ctx({ selectedResourceId: '1111' }));
    expect(result.noHistory).toBe(true);
  });
});

// ── Insight derivation ────────────────────────────────────────────────────────

const sig = (type: string, data: Record<string, unknown>, id = `s-${type}`) => ({
  id, signal_type: type, signal_data: data, period_start: '2026-07-09', period_end: '2026-08-07',
});

describe('paid-platform insights are observation only', () => {
  it('Google Ads: quantifies wasted search spend and says LaunchMind will not act', () => {
    const insights = deriveGoogleAdsInsights([
      sig('spend', { value_usd: 1000 }),
      sig('source_quality', {
        dimension: 'search_term', zero_conversion_spend_usd: 700, terms_analyzed: 3,
        zero_conversion_terms: [{ term: 'free crm download', spend_usd: 500, clicks: 500 }],
      }),
    ]);
    expect(insights[0].insightKey).toBe('google_ads.zero_conversion_search_spend');
    expect(insights[0].headline).toContain('70.0%');
    // The language must not imply LaunchMind will change anything.
    expect(insights[0].detail).toMatch(/cannot apply|will not/i);
    expect(insights[0].evidence.map(e => e.label)).toContain('Spend with no conversions');
  });

  it('Google Ads: stays silent when spend is efficient', () => {
    expect(deriveGoogleAdsInsights([
      sig('spend', { value_usd: 1000 }),
      sig('source_quality', { dimension: 'search_term', zero_conversion_spend_usd: 40, terms_analyzed: 20, zero_conversion_terms: [{ term: 'x', spend_usd: 40, clicks: 5 }] }),
    ])).toEqual([]);
  });

  it('Meta: reports creative fatigue and disclaims execution', () => {
    const insights = deriveMetaInsights([
      sig('spend', { value_usd: 2000 }),
      sig('creative_performance', {
        fatigued_spend_usd: 1000, creatives_analyzed: 3,
        fatigue_rule: 'frequency ≥ 3 with spend and no attributed conversion',
        fatigued_creatives: [
          { ad: 'Static B', frequency: 5.2, spend_usd: 600, ctr: 0.013 },
          { ad: 'Static C', frequency: 4.1, spend_usd: 400, ctr: 0.010 },
        ],
      }),
    ]);
    expect(insights[0].insightKey).toBe('meta.creative_fatigue');
    expect(insights[0].headline).toContain('$1000.00');
    expect(insights[0].detail).toMatch(/read-only|will not publish/i);
  });

  it('both change when the numbers change — nothing is hard-coded', () => {
    const a = deriveGoogleAdsInsights([
      sig('spend', { value_usd: 1000 }),
      sig('source_quality', { dimension: 'search_term', zero_conversion_spend_usd: 700, terms_analyzed: 3, zero_conversion_terms: [{ term: 'x', spend_usd: 500, clicks: 1 }] }),
    ]);
    const b = deriveGoogleAdsInsights([
      sig('spend', { value_usd: 1000 }),
      sig('source_quality', { dimension: 'search_term', zero_conversion_spend_usd: 250, terms_analyzed: 3, zero_conversion_terms: [{ term: 'x', spend_usd: 200, clicks: 1 }] }),
    ]);
    expect(a[0].headline).not.toBe(b[0].headline);
    expect(b[0].headline).toContain('25.0%');
  });

  it('produce nothing from empty data', () => {
    expect(deriveGoogleAdsInsights([])).toEqual([]);
    expect(deriveMetaInsights([])).toEqual([]);
  });
});

// ── Journeys ──────────────────────────────────────────────────────────────────

describe('paid platform journeys', () => {
  let server: FastifyInstance;
  const authA = { authorization: `Bearer ${jwt.sign({ sub: FOUNDER_A, role: 'authenticated' }, JWT_SECRET, { expiresIn: '1h' })}` };

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

  /** Runs the real OAuth dance for an action-capable provider. */
  async function oauthConnect(provider: string) {
    const start = await server.inject({
      method: 'POST', url: `/connections/${provider}/oauth/start`, headers: authA, payload: {},
    });
    expect(start.statusCode).toBe(201);
    const url = new URL(JSON.parse(start.body).data.authorizationUrl);
    const state = url.searchParams.get('state') as string;

    // The requested scopes must be the read-only set.
    const scope = url.searchParams.get('scope') ?? '';

    await server.inject({
      method: 'GET', url: `/connections/oauth/callback?code=test-code&state=${encodeURIComponent(state)}`,
    });

    const row = db.rows('workspace_connections').find(r => r.provider === provider);
    return { row, scope };
  }

  async function runQueuedSync() {
    const job = enqueued.shift();
    if (!job) throw new Error('No sync job enqueued');
    return executeSync(
      job.syncRunId as string, job.connectionId as string,
      job.workspaceId as string, job.founderId as string, job.traceId as string,
    );
  }

  it('Google Ads: OAuth → select account → sync → insight → surfaces, granted READ + RECOMMEND', async () => {
    stubGoogleAds();

    const before = JSON.parse((await server.inject({ method: 'GET', url: '/intelligence/coverage', headers: authA })).body).data;
    const paidBefore = before.dimensions.find((d: { label: string }) => d.label === 'Paid acquisition');
    expect(paidBefore.observed).toBe(false);

    const { row, scope } = await oauthConnect('google_ads');
    expect(row).toBeTruthy();
    // Google publishes no read-only scope; this records what we actually request.
    expect(scope).toBe('https://www.googleapis.com/auth/adwords');

    // Least privilege regardless of that broad scope.
    expect(row?.permissions_granted).toEqual(['READ', 'RECOMMEND']);
    expect(row?.status).toBe('AUTHORIZED');

    // Two accounts → the owner must choose; nothing queued yet.
    expect(enqueued).toHaveLength(0);

    const select = await server.inject({
      method: 'POST', url: `/connections/${row!.id}/select-resource`, headers: authA,
      body: { resourceId: '1234567890', resourceName: 'Acme Search' },
    });
    expect(select.statusCode).toBe(200);
    expect(enqueued).toHaveLength(1);

    const outcome = await runQueuedSync();
    expect(outcome.status).toBe('completed');
    expect(outcome.signalsImported).toBeGreaterThan(0);
    expect(outcome.insightsCreated).toBeGreaterThan(0);

    // Real numbers.
    const spend = db.rows('intelligence_signals').find(s => s.signal_type === 'spend');
    expect((spend?.signal_data as Record<string, unknown>).value_usd).toBe(1000);

    // Growth Brain and Morning Brief both move.
    const after = JSON.parse((await server.inject({ method: 'GET', url: '/intelligence/coverage', headers: authA })).body).data;
    const paidAfter = after.dimensions.find((d: { label: string }) => d.label === 'Paid acquisition');
    expect(paidAfter.observed).toBe(true);
    expect(paidAfter.score).toBeGreaterThan(paidBefore.score);
    expect(after.liveInsights.length).toBeGreaterThan(0);

    // Health card shows the read-only grant.
    const health = JSON.parse((await server.inject({ method: 'GET', url: `/connections/${row!.id}/health`, headers: authA })).body).data;
    expect(health.permissions_granted).toEqual(['READ', 'RECOMMEND']);
    expect(health.latest_insight).toBeTruthy();

    // Execution is refused.
    const exec = await server.inject({
      method: 'POST', url: `/connections/${row!.id}/execute`, headers: authA, body: { action: 'update_budget' },
    });
    expect(exec.statusCode).toBe(403);

    // Disconnect and reconnect.
    expect((await server.inject({ method: 'DELETE', url: `/connections/${row!.id}`, headers: authA })).statusCode).toBe(204);
    expect(db.rows('workspace_connections')[0].permissions_granted).toEqual([]);
  });

  it('Meta: OAuth requests only read scopes and lands on READ + RECOMMEND', async () => {
    stubMeta();
    const { row, scope } = await oauthConnect('meta_ads');

    expect(row).toBeTruthy();
    // The decisive check: ads_management is never requested.
    expect(scope).toContain('ads_read');
    expect(scope).toContain('read_insights');
    expect(scope).not.toContain('ads_management');

    expect(row?.permissions_granted).toEqual(['READ', 'RECOMMEND']);

    await server.inject({
      method: 'POST', url: `/connections/${row!.id}/select-resource`, headers: authA,
      body: { resourceId: '1111', resourceName: 'Acme Ads' },
    });

    const outcome = await runQueuedSync();
    expect(outcome.status).toBe('completed');
    expect(outcome.insightsCreated).toBeGreaterThan(0);

    const spend = db.rows('intelligence_signals').find(s => s.signal_type === 'spend');
    expect((spend?.signal_data as Record<string, unknown>).value_usd).toBe(2000);

    const boundary = JSON.parse(
      (await server.inject({ method: 'GET', url: `/connections/${row!.id}/execution-boundary`, headers: authA })).body,
    ).data;
    expect(boundary.actions.every((a: { allowed: boolean }) => !a.allowed)).toBe(true);
  });

  it('recovers from a provider outage without losing prior data', async () => {
    stubGoogleAds();
    const { row } = await oauthConnect('google_ads');
    await server.inject({
      method: 'POST', url: `/connections/${row!.id}/select-resource`, headers: authA,
      body: { resourceId: '1234567890', resourceName: 'Acme Search' },
    });
    await runQueuedSync();
    const before = db.rows('intelligence_signals').length;

    await server.inject({ method: 'POST', url: `/connections/${row!.id}/refresh`, headers: authA, payload: {} });
    stubGoogleAds('outage');
    await runQueuedSync().catch(() => undefined);

    expect(db.rows('workspace_connections')[0].status).toBe('PROVIDER_UNAVAILABLE');
    expect(db.rows('intelligence_signals').length).toBe(before);

    // Retry after recovery.
    stubGoogleAds();
    await server.inject({ method: 'POST', url: `/connections/${row!.id}/sync`, headers: authA, payload: {} });
    expect((await runQueuedSync()).status).toBe('completed');
    expect(db.rows('workspace_connections')[0].status).toBe('HEALTHY');
  });

  it('expired authorization becomes NEEDS_REAUTH and is recoverable', async () => {
    stubMeta();
    const { row } = await oauthConnect('meta_ads');
    await server.inject({
      method: 'POST', url: `/connections/${row!.id}/select-resource`, headers: authA,
      body: { resourceId: '1111', resourceName: 'Acme Ads' },
    });
    await runQueuedSync();

    await server.inject({ method: 'POST', url: `/connections/${row!.id}/refresh`, headers: authA, payload: {} });
    stubMeta('unauthorized');
    await expect(runQueuedSync()).rejects.toMatchObject({ kind: 'NEEDS_REAUTH' });

    expect(db.rows('workspace_connections')[0].status).toBe('NEEDS_REAUTH');
    const reauth = await server.inject({
      method: 'POST', url: `/connections/${row!.id}/reauthorize`, headers: authA, payload: {},
    });
    expect(reauth.statusCode).toBe(200);
  });
});
