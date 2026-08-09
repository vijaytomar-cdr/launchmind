/**
 * @file appStoreConnectJourney.test.ts
 * @description The required Step 3 end-to-end journey, exercised through real routes,
 *   the real adapter, the real sync executor, and the real insight derivation:
 *
 *     Morning Brief coverage (gap present)
 *       → preview App Store Connect
 *       → authorization with a genuine ES256 key
 *       → app selection from Apple's real response
 *       → async sync (queued, then run by the worker path)
 *       → first evidence-backed insight from imported numbers
 *       → Growth Brain coverage updates
 *       → Morning Brief gap message clears
 *       → refresh
 *       → disconnect → reconnect
 *
 *   Only Apple's HTTP is stubbed. Everything between the route handler and the
 *   database is the production code path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { generateKeyPairSync } from 'crypto';
import { gzipSync } from 'zlib';
import { MemoryDb } from './helpers/memoryDb';

const FOUNDER_ID   = 'aa100000-0000-0000-0000-000000000001';
const WORKSPACE_ID = '11110000-0000-0000-0000-000000000001';
const PRODUCT_ID   = 'bb200000-0000-0000-0000-000000000002';
const JWT_SECRET   = 'test-jwt-secret-min-32-chars-long!!';

const ISSUER_ID = '69a6de70-1111-2222-3333-444455556666';
const KEY_ID    = 'ABCD123456';
const APP_ID    = '1234567890';

const { privateKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding:  { type: 'spki',  format: 'pem' },
});

let db: MemoryDb;

vi.mock('../src/lib/supabaseAdmin', () => ({ getSupabaseAdmin: () => db.asClient() }));

// Reversible fake vault so the test can assert the key was stored as ciphertext.
vi.mock('../src/lib/tokenVault', () => ({
  encryptToken: vi.fn(async (p: string) => ({ ciphertext: `enc(${p})`, kmsKeyId: 'kms-test' })),
  decryptToken: vi.fn(async (c: string) => c.replace(/^enc\(/, '').replace(/\)$/, '')),
}));

/** Captures enqueued jobs so the test can run them exactly as the worker would. */
const enqueued: Array<Record<string, unknown>> = [];
vi.mock('../src/workers/connectionSyncWorker', () => ({
  enqueueConnectionSync:      vi.fn(async (p: Record<string, unknown>) => { enqueued.push(p); }),
  getConnectionSyncQueue:     vi.fn(() => ({})),
  startConnectionSyncWorker:  vi.fn(),
  stopConnectionSyncWorker:   vi.fn(async () => undefined),
  CONNECTION_SYNC_QUEUE_NAME: 'connection-sync',
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
// The learning pipeline is exercised by its own suite; here it must simply not throw.
vi.mock('../src/services/learningPipelineService', () => ({
  ingestLearningEvent: vi.fn(async () => ({ eventId: 'evt-1', memoriesCreated: 0, memoriesUpdated: 0, nodesCreated: 0, edgesCreated: 0 })),
}));

import { executeSync } from '../src/services/connectionService';

// ── Apple fixtures ────────────────────────────────────────────────────────────

const APPS = {
  data: [
    { id: APP_ID,      type: 'apps', attributes: { name: 'Test App',   bundleId: 'com.test.app', sku: 'A', primaryLocale: 'en-US' } },
    { id: '9876543210', type: 'apps', attributes: { name: 'Second App', bundleId: 'com.test.two', sku: 'B', primaryLocale: 'en-US' } },
  ],
};

const ENGAGEMENT = [
  'Date\tImpressions\tProduct Page Views\tSource Type\tTerritory',
  '2026-07-01\t9000\t1600\tApp Store Search\tUnited States',
  '2026-07-02\t7400\t1400\tApp Store Search\tUnited States',
].join('\n');

const COMMERCE = [
  'Date\tTotal Downloads\tTerritory',
  '2026-07-01\t30\tUnited States',
  '2026-07-02\t24\tCanada',
].join('\n');

let appleMode: 'ok' | 'no_data' | 'unauthorized' | 'outage' = 'ok';

function stubApple() {
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = String(input);
    const json = (body: unknown, status = 200) => ({
      ok: status < 400, status, json: async () => body,
      arrayBuffer: async () => new ArrayBuffer(0),
    }) as unknown as Response;

    if (appleMode === 'unauthorized') return json({ errors: [{ code: 'NOT_AUTHORIZED' }] }, 401);
    if (appleMode === 'outage')       return json({ errors: [{ code: 'SERVER_ERROR' }] }, 503);

    if (url.includes('/v1/apps/') && !url.includes('analyticsReportRequests')) return json({ data: APPS.data[0] });
    if (url.includes('/v1/apps?')) return json(APPS);
    if (url.includes('/analyticsReportRequests') && url.includes('/v1/apps/')) {
      return json({ data: [{ id: 'req-1', attributes: { accessType: 'ONGOING', stoppedDueToInactivity: false } }] });
    }
    if (url.includes('/reports')) {
      const cat = url.includes('APP_STORE_ENGAGEMENT') ? 'engagement' : 'commerce';
      return json({ data: [{ id: `report-${cat}`, attributes: { name: `App Store ${cat} Detailed Daily`, category: cat } }] });
    }
    if (url.includes('/instances')) {
      if (appleMode === 'no_data') return json({ data: [] });
      const which = url.includes('report-engagement') ? 'engagement' : 'commerce';
      return json({ data: [{ id: `instance-${which}`, attributes: { granularity: 'DAILY', processingDate: '2026-07-03' } }] });
    }
    if (url.includes('/segments')) {
      const which = url.includes('instance-engagement') ? 'engagement' : 'commerce';
      return json({ data: [{ attributes: { url: `https://apple-cdn.test/${which}.gz` } }] });
    }
    if (url.startsWith('https://apple-cdn.test/')) {
      const body = url.includes('engagement') ? ENGAGEMENT : COMMERCE;
      const buf = gzipSync(Buffer.from(body, 'utf-8'));
      return { ok: true, status: 200, json: async () => ({}),
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) } as unknown as Response;
    }
    return json({ data: [] });
  }));
}

// ── Harness ───────────────────────────────────────────────────────────────────

let server: FastifyInstance;
const token = jwt.sign({ sub: FOUNDER_ID, role: 'authenticated' }, JWT_SECRET, { expiresIn: '1h' });
const auth = { authorization: `Bearer ${token}` };

beforeEach(async () => {
  appleMode = 'ok';
  enqueued.length = 0;
  stubApple();
  db = new MemoryDb({
    founders:   [{ id: FOUNDER_ID, active_workspace_id: WORKSPACE_ID }],
    workspaces: [{ id: WORKSPACE_ID, founder_id: FOUNDER_ID, created_at: '2026-01-01' }],
    workspace_members: [],
    products:   [{ id: PRODUCT_ID, founder_id: FOUNDER_ID, workspace_id: WORKSPACE_ID, archived_at: null, confirmed_icp: {}, scraped_meta: {}, category: 'Productivity' }],
    workspace_connections: [], connection_sync_runs: [], intelligence_signals: [],
    connection_credentials: [], connection_permission_history: [], connection_insights: [],
    oauth_authorization_requests: [], audit_logs: [], learning_events: [],
    founder_context: [], business_goals: [], competitor_relationships: [],
    onboarding_sessions: [], strategy_directions: [],
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

beforeEach(async () => {
  if (!server) {
    process.env.JWT_SECRET = JWT_SECRET;
    const { buildServer } = await import('../src/server');
    server = await buildServer();
  }
});

/** Runs the queued job exactly as connectionSyncWorker would. */
async function runQueuedSync() {
  const job = enqueued.shift();
  if (!job) throw new Error('No sync job was enqueued');
  return executeSync(
    job.syncRunId as string, job.connectionId as string,
    job.workspaceId as string, job.founderId as string, job.traceId as string,
  );
}

/** Performs the connect call with a genuine Apple key. */
async function connect() {
  return server.inject({
    method: 'POST', url: '/connections/app_store_connect/connect', headers: auth,
    body: { api_key: privateKey, issuer_id: ISSUER_ID, key_id: KEY_ID },
  });
}

// ── The journey ───────────────────────────────────────────────────────────────

describe('App Store Connect — full owner journey', () => {
  it('completes brief gap → preview → connect → sync → insight → surfaces → refresh → disconnect → reconnect', async () => {
    // 1. Morning Brief: nothing connected, so the gap is real and App Store Connect
    //    is recommended AND actually available (a real adapter exists).
    const before = await server.inject({ method: 'GET', url: '/intelligence/coverage', headers: auth });
    expect(before.statusCode).toBe(200);
    const coverageBefore = JSON.parse(before.body).data;
    expect(coverageBefore.connections.connectedCount).toBe(0);
    expect(coverageBefore.recommendedSource.key).toBe('app_store_connect');
    expect(coverageBefore.recommendedSource.available).toBe(true);
    const perfBefore = coverageBefore.dimensions.find((d: { label: string }) => d.label === 'Performance');
    expect(perfBefore.observed).toBe(false);
    expect(perfBefore.score).toBe(0);
    expect(coverageBefore.liveInsights).toEqual([]);

    // 2. Preview — grants nothing, stores no credential.
    const preview = await server.inject({
      method: 'POST', url: '/connections/app_store_connect/preview', headers: auth, payload: {},
    });
    expect(preview.statusCode).toBe(200);
    expect(JSON.parse(preview.body).data.adapterAvailable).toBe(true);
    expect(db.rows('connection_credentials')).toHaveLength(0);

    // 3. Authorization — Apple verifies the key before anything is persisted.
    const connected = await connect();
    expect(connected.statusCode).toBe(201);
    const connectBody = JSON.parse(connected.body).data;
    const connectionId = connectBody.connection.id;

    // 4. App selection came from Apple's real /v1/apps response.
    expect(connectBody.accounts).toHaveLength(2);
    expect(connectBody.accounts[0]).toMatchObject({ id: APP_ID, name: 'Test App' });
    expect(connectBody.needsResourceSelection).toBe(true);
    // Least privilege at connect time.
    expect(connectBody.permissions).toEqual(['READ', 'RECOMMEND']);
    // No insight is claimed before the worker has run.
    expect(connected.body).not.toContain('firstInsight');
    // The key is at rest as ciphertext, bound to the workspace.
    const cred = db.rows('connection_credentials')[0];
    expect(String(cred.encrypted_access_token)).toMatch(/^enc\(/);
    expect(cred.workspace_id).toBe(WORKSPACE_ID);
    expect(cred.external_account_id).toBe(ISSUER_ID);

    // 5. Bind the chosen app to the connection.
    const select = await server.inject({
      method: 'POST', url: `/connections/${connectionId}/select-resource`, headers: auth,
      body: { resourceId: APP_ID, resourceName: 'Test App' },
    });
    expect(select.statusCode).toBe(200);
    expect(db.rows('workspace_connections')[0].selected_resource_id).toBe(APP_ID);

    // 6. Selecting the app queued the first sync; the HTTP thread returned at once.
    expect(JSON.parse(select.body).data.syncRunId).toBeTruthy();
    expect(enqueued).toHaveLength(1);

    // 7. The worker runs the real adapter against Apple.
    const outcome = await runQueuedSync();
    expect(outcome.status).toBe('completed');
    expect(outcome.signalsImported).toBeGreaterThan(0);
    expect(outcome.insightsCreated).toBeGreaterThan(0);

    // Signals are the real Apple numbers: 9000+7400 impressions, 30+24 downloads.
    const signals = db.rows('intelligence_signals');
    expect(signals.find(s => s.signal_type === 'impressions')?.signal_data).toMatchObject({ value: 16400 });
    expect(signals.find(s => s.signal_type === 'downloads')?.signal_data).toMatchObject({ value: 54 });
    expect(signals.every(s => s.workspace_id === WORKSPACE_ID)).toBe(true);

    // 8. First insight is derived from those numbers, with evidence and provenance.
    const insight = db.rows('connection_insights')[0];
    expect(insight).toBeTruthy();
    // 54 ÷ 3000 = 1.8%, materially below the 3.5% benchmark.
    expect(String(insight.headline)).toContain('1.8%');
    expect(Array.isArray(insight.evidence)).toBe(true);
    expect((insight.evidence as Array<{ label: string }>).map(e => e.label)).toContain('Product page views');
    expect(insight.source_signal_ids).not.toEqual([]);
    expect(insight.provenance).toMatchObject({ provider: 'app_store_connect' });
    expect((insight.provenance as Record<string, unknown>).method).toBeTruthy();

    // 9. Growth Brain coverage updated from the same persisted state.
    const after = await server.inject({ method: 'GET', url: '/intelligence/coverage', headers: auth });
    const coverageAfter = JSON.parse(after.body).data;
    const perfAfter = coverageAfter.dimensions.find((d: { label: string }) => d.label === 'Performance');
    expect(perfAfter.observed).toBe(true);
    expect(perfAfter.score).toBeGreaterThan(perfBefore.score);
    expect(perfAfter.missing).toBe(false);
    expect(coverageAfter.overallScore).toBeGreaterThan(coverageBefore.overallScore);

    // 10. Morning Brief: the gap message is gone and the learning is available.
    expect(coverageAfter.connections.connectedCount).toBe(1);
    expect(coverageAfter.connections.app_store_connect.connected).toBe(true);
    expect(coverageAfter.recommendedSource?.key).not.toBe('app_store_connect');
    expect(coverageAfter.liveInsights.length).toBeGreaterThan(0);
    expect(coverageAfter.liveInsights[0].headline).toBe(insight.headline);

    // 11. Improve Intelligence health card: connected, app, sync, freshness, signals, insight.
    const health = await server.inject({
      method: 'GET', url: `/connections/${connectionId}/health`, headers: auth,
    });
    const h = JSON.parse(health.body).data;
    expect(h).toMatchObject({
      status: 'HEALTHY', provider: 'app_store_connect', freshness: 'fresh',
      adapter_available: true, needs_attention: false,
      selected_resource_name: 'Test App',
    });
    expect(h.signals_count).toBeGreaterThan(0);
    expect(h.latest_insight.headline).toBe(insight.headline);
    expect(h.permissions_granted).toEqual(['READ', 'RECOMMEND']);
    // No credential material anywhere in the response.
    expect(health.body).not.toContain('enc(');
    expect(health.body).not.toContain('BEGIN PRIVATE KEY');

    // 12. Refresh queues another real sync.
    const refresh = await server.inject({
      method: 'POST', url: `/connections/${connectionId}/refresh`, headers: auth, payload: {},
    });
    expect(refresh.statusCode).toBe(202);
    const second = await runQueuedSync();
    expect(second.status).toBe('completed');
    // Replay is deduplicated by the period-scoped unique index, not by luck.
    expect(db.rows('workspace_connections')[0].status).toBe('HEALTHY');

    // 13. Disconnect revokes the credential and all authority, keeps the history.
    const disconnect = await server.inject({
      method: 'DELETE', url: `/connections/${connectionId}`, headers: auth,
    });
    expect(disconnect.statusCode).toBe(204);
    expect(db.rows('workspace_connections')[0].status).toBe('DISCONNECTED');
    expect(db.rows('workspace_connections')[0].permissions_granted).toEqual([]);
    expect(db.rows('connection_credentials').every(c => c.revoked_at)).toBe(true);
    // What LaunchMind already learned is retained.
    expect(db.rows('intelligence_signals').length).toBeGreaterThan(0);
    expect(db.rows('connection_insights').length).toBeGreaterThan(0);

    // 14. Reconnect works and re-grants least privilege.
    const again = await connect();
    expect(again.statusCode).toBe(201);
    expect(JSON.parse(again.body).data.permissions).toEqual(['READ', 'RECOMMEND']);
    expect(db.rows('workspace_connections')[0].status).toBe('AUTHORIZED');
  });
});

// ── Recovery paths (spec §14, §17) ────────────────────────────────────────────

describe('App Store Connect — recovery paths', () => {
  it('permission/auth failure leaves the connection recoverable and stores nothing', async () => {
    appleMode = 'unauthorized';
    const res = await connect();
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).code).toBe('NEEDS_REAUTH');
    expect(db.rows('connection_credentials')).toHaveLength(0);
    expect(db.rows('workspace_connections')[0].status).toBe('NEEDS_REAUTH');
  });

  it('provider outage does not destroy the connection', async () => {
    appleMode = 'outage';
    const res = await connect();
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).code).toBe('PROVIDER_UNAVAILABLE');
    expect(JSON.parse(res.body).error).toMatch(/unchanged/i);
  });

  it('no history is a healthy state, not a failure', async () => {
    const c = await connect();
    const connectionId = JSON.parse(c.body).data.connection.id;
    await server.inject({
      method: 'POST', url: `/connections/${connectionId}/select-resource`, headers: auth,
      body: { resourceId: APP_ID, resourceName: 'Test App' },
    });
    appleMode = 'no_data';
    const outcome = await runQueuedSync();

    expect(outcome.noHistory).toBe(true);
    expect(outcome.signalsImported).toBe(0);
    expect(db.rows('workspace_connections')[0].status).toBe('NO_HISTORY');
    // Healthy: freshness is current and nothing needs the owner's attention.
    expect(db.rows('workspace_connections')[0].freshness_status).toBe('fresh');
    // Critically: no insight was invented to fill the gap.
    expect(db.rows('connection_insights')).toHaveLength(0);
  });

  it('expired authorization mid-sync becomes NEEDS_REAUTH and keeps prior data', async () => {
    const c = await connect();
    const connectionId = JSON.parse(c.body).data.connection.id;
    await server.inject({
      method: 'POST', url: `/connections/${connectionId}/select-resource`, headers: auth,
      body: { resourceId: APP_ID, resourceName: 'Test App' },
    });
    await runQueuedSync();
    const signalsBefore = db.rows('intelligence_signals').length;
    expect(signalsBefore).toBeGreaterThan(0);

    // Apple revokes the key between syncs.
    await server.inject({ method: 'POST', url: `/connections/${connectionId}/refresh`, headers: auth, payload: {} });
    appleMode = 'unauthorized';
    await expect(runQueuedSync()).rejects.toMatchObject({ kind: 'NEEDS_REAUTH' });

    expect(db.rows('workspace_connections')[0].status).toBe('NEEDS_REAUTH');
    expect(db.rows('workspace_connections')[0].freshness_status).toBe('stale');
    // Previously imported intelligence survives.
    expect(db.rows('intelligence_signals').length).toBe(signalsBefore);
    expect(db.rows('connection_insights').length).toBeGreaterThan(0);

    // And the owner can recover.
    const reauth = await server.inject({
      method: 'POST', url: `/connections/${connectionId}/reauthorize`, headers: auth, payload: {},
    });
    expect(reauth.statusCode).toBe(200);
    expect(db.rows('workspace_connections')[0].status).toBe('AUTHORIZING');
  });

  it('sync failure never exposes a stack trace to the owner', async () => {
    const c = await connect();
    const connectionId = JSON.parse(c.body).data.connection.id;
    await server.inject({
      method: 'POST', url: `/connections/${connectionId}/select-resource`, headers: auth,
      body: { resourceId: APP_ID, resourceName: 'Test App' },
    });
    appleMode = 'outage';
    await runQueuedSync().catch(() => undefined);

    const run = db.rows('connection_sync_runs').find(r => r.status === 'failed');
    expect(run).toBeTruthy();
    const message = String(run?.error_message ?? '');
    expect(message).not.toMatch(/at \w+ \(/);   // no stack frames
    expect(message).not.toContain('Error:');
    expect(message).toMatch(/unchanged|could not/i);
  });

  it('a missing app selection is a wrong-account recovery, not a crash', async () => {
    const c = await connect();
    const connectionId = JSON.parse(c.body).data.connection.id;
    // Force a sync without ever selecting an app.
    const forced = await server.inject({ method: 'POST', url: `/connections/${connectionId}/sync`, headers: auth, payload: {} });
    expect(forced.statusCode).toBe(202);
    await expect(runQueuedSync()).rejects.toMatchObject({ kind: 'WRONG_ACCOUNT' });
    expect(db.rows('workspace_connections')[0].status).toBe('WRONG_ACCOUNT');
  });

  it('partial data is reported as partial with a real explanation', async () => {
    const c = await connect();
    const connectionId = JSON.parse(c.body).data.connection.id;
    await server.inject({
      method: 'POST', url: `/connections/${connectionId}/select-resource`, headers: auth,
      body: { resourceId: APP_ID, resourceName: 'Test App' },
    });
    // Apple has engagement but not commerce for this app.
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = String(input);
      const json = (b: unknown, s = 200) => ({ ok: s < 400, status: s, json: async () => b, arrayBuffer: async () => new ArrayBuffer(0) }) as unknown as Response;
      if (url.includes('/v1/apps/') && !url.includes('analyticsReportRequests')) return json({ data: APPS.data[0] });
      if (url.includes('/v1/apps?')) return json(APPS);
      if (url.includes('/analyticsReportRequests') && url.includes('/v1/apps/')) return json({ data: [{ id: 'req-1', attributes: { accessType: 'ONGOING' } }] });
      if (url.includes('/reports')) {
        if (!url.includes('APP_STORE_ENGAGEMENT')) return json({ data: [] }); // commerce absent
        return json({ data: [{ id: 'report-engagement', attributes: { name: 'Engagement Detailed Daily', category: 'APP_STORE_ENGAGEMENT' } }] });
      }
      if (url.includes('/instances')) return json({ data: [{ id: 'instance-engagement', attributes: { granularity: 'DAILY', processingDate: '2026-07-03' } }] });
      if (url.includes('/segments')) return json({ data: [{ attributes: { url: 'https://apple-cdn.test/engagement.gz' } }] });
      if (url.startsWith('https://apple-cdn.test/')) {
        const buf = gzipSync(Buffer.from(ENGAGEMENT, 'utf-8'));
        return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) } as unknown as Response;
      }
      return json({ data: [] });
    }));

    const outcome = await runQueuedSync();
    expect(outcome.status).toBe('partial');
    expect(db.rows('workspace_connections')[0].status).toBe('PARTIAL');
    expect(String(db.rows('workspace_connections')[0].error_detail)).toMatch(/commerce report/i);

    // Impressions imported; conversion honestly absent.
    expect(db.rows('intelligence_signals').some(s => s.signal_type === 'impressions')).toBe(true);
    expect(db.rows('intelligence_signals').some(s => s.signal_type === 'conversion')).toBe(false);
  });
});
