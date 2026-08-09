/**
 * @file connections.test.ts
 * @description Route-level tests for workspace connections.
 *
 *   Runs against MemoryDb, which honours query predicates, so a route that forgets
 *   its workspace filter fails here rather than silently passing.
 *
 *   Covers:
 *     - No provider reaches AUTHORIZED without a real adapter accepting the credential
 *     - A missing adapter yields 501, never a fabricated success
 *     - Connect and sync are queue-only; no provider work on the request thread
 *     - Responses carry no invented insight, metric, or credential material
 *     - Workspace tenancy on every route
 *     - Permission routes: least privilege, escalation gating, audit trail
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { MemoryDb } from './helpers/memoryDb';

const FOUNDER_ID    = 'aa100000-0000-0000-0000-000000000001';
const FOUNDER_B_ID  = 'ff600000-0000-0000-0000-000000000006';
const WORKSPACE_ID  = '11110000-0000-0000-0000-000000000001';
const WORKSPACE_B   = '22220000-0000-0000-0000-000000000002';
const PRODUCT_ID    = 'bb200000-0000-0000-0000-000000000002';
const CONNECTION_ID = 'cc300000-0000-0000-0000-000000000003';
const SYNC_RUN_ID   = 'dd400000-0000-0000-0000-000000000004';
const JWT_SECRET    = 'test-jwt-secret-min-32-chars-long!!';

function makeTokenForFounder(founderId: string): string {
  return jwt.sign(
    { sub: founderId, role: 'authenticated', email: `${founderId}@example.com` },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}
function makeToken(): string { return makeTokenForFounder(FOUNDER_ID); }

let db: MemoryDb;

vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => db.asClient(),
}));

vi.mock('../src/lib/tokenVault', () => ({
  encryptToken: vi.fn(async (p: string) => ({ ciphertext: `enc(${p})`, kmsKeyId: 'kms-test' })),
  decryptToken: vi.fn(async (c: string) => c.replace(/^enc\(/, '').replace(/\)$/, '')),
}));

// ── Worker mocks (prevent Redis connections) ──────────────────────────────────

const enqueueSpy = vi.fn(async () => undefined);
vi.mock('../src/workers/connectionSyncWorker', () => ({
  enqueueConnectionSync:      enqueueSpy,
  getConnectionSyncQueue:     vi.fn(() => ({})),
  startConnectionSyncWorker:  vi.fn(),
  stopConnectionSyncWorker:   vi.fn(async () => undefined),
  CONNECTION_SYNC_QUEUE_NAME: 'connection-sync',
}));

vi.mock('../src/workers/missionWorker', () => ({
  enqueueMission:     vi.fn(async () => undefined),
  getMissionQueue:    vi.fn(() => ({})),
  startMissionWorker: vi.fn(),
  stopMissionWorker:  vi.fn(async () => undefined),
  MISSION_QUEUE_NAME: 'mission-execution',
}));

// ── Shared service mocks required by server.ts routes ─────────────────────────

vi.mock('../src/workers/scraperWorker', () => ({
  detectPlatform:    vi.fn(() => null),
  scrapeAppStore:    vi.fn(),
  scrapePlayStore:   vi.fn(),
  scrapeCompetitors: vi.fn(async () => []),
}));
vi.mock('../src/services/reviewAnalysis', () => ({
  analyseReviews: vi.fn(async () => ({
    sentiment: 'positive', painPoints: [], copySignals: [], marketingOpportunities: [],
  })),
}));
vi.mock('../src/services/icpService', () => ({ buildICPBrief: vi.fn(() => ({})) }));
vi.mock('../src/services/strategyService', () => ({
  generateStrategy:      vi.fn(async () => ({})),
  generateContentAssets: vi.fn(async () => ({})),
  getProductStrategy:    vi.fn(async () => ({ campaigns: [], fullStrategy: null })),
}));
vi.mock('../src/lib/tokens', () => ({ consumeTokens: vi.fn(async () => undefined) }));
vi.mock('../src/services/billingService', () => ({
  createStripeCheckout:   vi.fn(async () => ({ url: 'https://checkout.stripe.com/test' })),
  createRazorpayCheckout: vi.fn(async () => ({ orderId: 'o', amount: 1, currency: 'INR', keyId: 'k' })),
  handleStripeWebhook:    vi.fn(async () => undefined),
  handleRazorpayWebhook:  vi.fn(async () => undefined),
  cancelSubscription:     vi.fn(async () => undefined),
  getSubscriptionStatus:  vi.fn(async () => ({ plan: 'solo', tokenBalance: 300, renewalNote: '' })),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * Connection fixture. `status` is set per test because the state machine rejects
 * illegal transitions. Account names are generic — no real or fictional company.
 */
function connectionRow(status = 'HEALTHY') {
  return {
    id: CONNECTION_ID, workspace_id: WORKSPACE_ID, founder_id: FOUNDER_ID,
    product_id: PRODUCT_ID, provider: 'app_store_connect', status,
    external_account_id: 'acct_test_0001', external_account_name: 'Test Account',
    selected_resource_id: 'res_test_0001', selected_resource_name: 'Test Resource',
    freshness_status: 'fresh', last_synced_at: '2026-08-07T10:00:00Z',
    credential_reference: null, connection_config: {},
    permissions_granted: ['READ', 'RECOMMEND'], error_detail: null, last_trace_id: null,
    created_at: '2026-08-07T09:00:00Z', updated_at: '2026-08-07T10:00:00Z',
  };
}

function seed(connectionStatus = 'HEALTHY'): MemoryDb {
  return new MemoryDb({
    founders: [
      { id: FOUNDER_ID,   active_workspace_id: WORKSPACE_ID },
      { id: FOUNDER_B_ID, active_workspace_id: WORKSPACE_B },
    ],
    workspaces: [
      { id: WORKSPACE_ID, founder_id: FOUNDER_ID,   created_at: '2026-01-01' },
      { id: WORKSPACE_B,  founder_id: FOUNDER_B_ID, created_at: '2026-01-02' },
    ],
    workspace_members: [],
    workspace_connections: [connectionRow(connectionStatus)],
    connection_sync_runs: [{
      id: SYNC_RUN_ID, connection_id: CONNECTION_ID, workspace_id: WORKSPACE_ID,
      founder_id: FOUNDER_ID, status: 'completed', progress: 100,
      current_step: 'Complete', steps_completed: [], signals_imported: 3,
      error_message: null, trace_id: null,
      started_at: '2026-08-07T09:55:00Z', completed_at: '2026-08-07T09:56:00Z',
      created_at: '2026-08-07T09:55:00Z',
    }],
    intelligence_signals: [
      { id: 's1', workspace_id: WORKSPACE_ID, founder_id: FOUNDER_ID, provider: 'app_store_connect', signal_type: 'downloads' },
    ],
    connection_credentials: [],
    connection_permission_history: [],
    oauth_authorization_requests: [],
    audit_logs: [],
    products: [{ id: PRODUCT_ID, founder_id: FOUNDER_ID, workspace_id: WORKSPACE_ID }],
  });
}

/** Re-seeds with the connection in a specific state. */
function withStatus(status: string): void {
  db = seed(status);
}

beforeEach(() => {
  db = seed('HEALTHY');
  enqueueSpy.mockClear();
});

let server: FastifyInstance;

beforeAll(async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  const { buildServer } = await import('../src/server');
  server = await buildServer();
});

afterAll(async () => { await server?.close(); });

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

// ── Listing ───────────────────────────────────────────────────────────────────

describe('GET /connections', () => {
  it('returns 401 without token', async () => {
    const res = await server.inject({ method: 'GET', url: '/connections' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with the workspace connections', async () => {
    const res = await server.inject({ method: 'GET', url: '/connections', headers: auth(makeToken()) });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.workspaceId).toBe(WORKSPACE_ID);
  });

  it('does not return another workspace connections', async () => {
    const res = await server.inject({ method: 'GET', url: '/connections', headers: auth(makeTokenForFounder(FOUNDER_B_ID)) });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data).toEqual([]);
  });

  it('rejects a workspace hint the caller is not a member of', async () => {
    // The client asks for workspace A while authenticated as founder B.
    const res = await server.inject({
      method: 'GET', url: '/connections',
      headers: { ...auth(makeTokenForFounder(FOUNDER_B_ID)), 'x-launchmind-workspace-id': WORKSPACE_ID },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).code).toBe('WORKSPACE_NOT_FOUND');
  });
});

// ── Connect ───────────────────────────────────────────────────────────────────

describe('POST /connections/:provider/connect', () => {
  it('returns 401 without token', async () => {
    const res = await server.inject({
      method: 'POST', url: '/connections/app_store_connect/connect', body: { api_key: 'test-key-12345' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when no credential is supplied (no mock-credential fallback)', async () => {
    const res = await server.inject({
      method: 'POST', url: '/connections/app_store_connect/connect',
      headers: auth(makeToken()), body: { issuer_id: 'iss', key_id: 'KID' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 on an empty api_key', async () => {
    const res = await server.inject({
      method: 'POST', url: '/connections/app_store_connect/connect',
      headers: auth(makeToken()), body: { api_key: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a provider slug LaunchMind does not model, without storing anything', async () => {
    // Every modelled provider now has an adapter, so the remaining unavailable case
    // is an unknown slug. (Registry-level ADAPTER_UNAVAILABLE is covered directly in
    // lifecycleProviders.test.ts, which resets the registry to assert it.)
    const res = await server.inject({
      method: 'POST', url: '/connections/salesforce/connect',
      headers: auth(makeToken()),
      body: { api_key: 'some-credential-value' },
    });
    expect(res.statusCode).toBe(400);
    expect(db.rows('connection_credentials')).toHaveLength(0);
    expect(db.rows('workspace_connections').every(c => c.status !== 'AUTHORIZED')).toBe(true);
  });

  it('rejects an App Store Connect connect that omits the Issuer ID or Key ID', async () => {
    withStatus('NOT_CONNECTED');
    const res = await server.inject({
      method: 'POST', url: '/connections/app_store_connect/connect',
      headers: auth(makeToken()),
      body: { api_key: 'AuthKey_testkey123456' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('MISSING_APPLE_KEY_FIELDS');
  });

  it('returns 400 for a provider LaunchMind does not model', async () => {
    const res = await server.inject({
      method: 'POST', url: '/connections/not_a_provider/connect',
      headers: auth(makeToken()), body: { api_key: 'AuthKey_testkey123' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /connections/providers', () => {
  it('reports exactly the providers with a real adapter', async () => {
    const res = await server.inject({ method: 'GET', url: '/connections/providers', headers: auth(makeToken()) });
    expect(res.statusCode).toBe(200);
    const { available } = JSON.parse(res.body).data;
    // All nine modelled providers are implemented as of Step 6.
    for (const ready of [
      'app_store_connect', 'revenue_cat', 'ga4', 'stripe', 'search_console',
      'google_ads', 'meta_ads', 'hubspot', 'mailchimp',
    ]) {
      expect(available).toContain(ready);
    }
    expect(available).toHaveLength(9);
    // And nothing LaunchMind does not model leaks into the list.
    expect(available).not.toContain('salesforce');
  });
});

// ── Single connection ─────────────────────────────────────────────────────────

describe('GET /connections/:id', () => {
  it('returns 401 without token', async () => {
    const res = await server.inject({ method: 'GET', url: `/connections/${CONNECTION_ID}` });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 for a connection in the caller workspace', async () => {
    const res = await server.inject({ method: 'GET', url: `/connections/${CONNECTION_ID}`, headers: auth(makeToken()) });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.id).toBe(CONNECTION_ID);
    expect(body.data.provider).toBe('app_store_connect');
  });

  it('returns 400 for a malformed id', async () => {
    const res = await server.inject({ method: 'GET', url: '/connections/not-a-uuid', headers: auth(makeToken()) });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /connections/:id/accounts', () => {
  it('returns 401 without token', async () => {
    const res = await server.inject({ method: 'GET', url: `/connections/${CONNECTION_ID}/accounts` });
    expect(res.statusCode).toBe(401);
  });

  it('never returns a synthesized account list', async () => {
    // The old build returned a made-up "default_account" here, which the owner would
    // have read as a real, provider-authorized account. Now the call either reaches
    // Apple or fails — it never invents an entry. (No credential is stored on this
    // fixture, so the real adapter correctly reports that reconnection is needed.)
    const res = await server.inject({
      method: 'GET', url: `/connections/${CONNECTION_ID}/accounts`, headers: auth(makeToken()),
    });
    expect(res.statusCode).not.toBe(200);
    expect(res.body).not.toContain('default_account');
  });
});

describe('POST /connections/:id/select-resource', () => {
  it('returns 200 from an AUTHORIZED connection', async () => {
    withStatus('AUTHORIZED');
    const res = await server.inject({
      method: 'POST', url: `/connections/${CONNECTION_ID}/select-resource`, headers: auth(makeToken()),
      body: { resourceId: 'res_test_0001', resourceName: 'Test Resource' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
  });

  it('returns 409 when the connection is not in a selectable state', async () => {
    withStatus('NOT_CONNECTED');
    const res = await server.inject({
      method: 'POST', url: `/connections/${CONNECTION_ID}/select-resource`, headers: auth(makeToken()),
      body: { resourceId: 'res_test_0001', resourceName: 'Test Resource' },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe('INVALID_STATE_TRANSITION');
  });
});

// ── Sync ──────────────────────────────────────────────────────────────────────

describe('POST /connections/:id/sync', () => {
  it('returns 202 immediately and enqueues with the workspace bound', async () => {
    withStatus('HEALTHY');
    const res = await server.inject({
      method: 'POST', url: `/connections/${CONNECTION_ID}/sync`, headers: auth(makeToken()), payload: {},
    });
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.data.status).toBe('queued');
    expect(body.data.traceId).toMatch(/^lm_[0-9a-f]{32}$/);
    // No result is claimed — the worker has not run.
    expect(body.data.firstInsight).toBeUndefined();
    expect(body.data.syncCompleted).toBeUndefined();
    // The job carries the tenant so the worker can re-verify it.
    expect(enqueueSpy).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: WORKSPACE_ID }));
  });

  it('returns 409 when the connection cannot be synced from its current state', async () => {
    withStatus('NEEDS_REAUTH');
    const res = await server.inject({
      method: 'POST', url: `/connections/${CONNECTION_ID}/sync`, headers: auth(makeToken()), payload: {},
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('GET /connections/:id/sync-runs', () => {
  it('returns 401 without token', async () => {
    const res = await server.inject({ method: 'GET', url: `/connections/${CONNECTION_ID}/sync-runs` });
    expect(res.statusCode).toBe(401);
  });

  it('returns the workspace sync runs', async () => {
    const res = await server.inject({
      method: 'GET', url: `/connections/${CONNECTION_ID}/sync-runs`, headers: auth(makeToken()),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data).toHaveLength(1);
  });
});

// ── Reauthorize / preview ─────────────────────────────────────────────────────

describe('POST /connections/:id/reauthorize', () => {
  it('moves a NEEDS_REAUTH connection back into authorization', async () => {
    withStatus('NEEDS_REAUTH');
    const res = await server.inject({
      method: 'POST', url: `/connections/${CONNECTION_ID}/reauthorize`, headers: auth(makeToken()), payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(db.rows('workspace_connections')[0].status).toBe('AUTHORIZING');
  });

  it('rejects reauthorization from a healthy connection', async () => {
    withStatus('HEALTHY');
    const res = await server.inject({
      method: 'POST', url: `/connections/${CONNECTION_ID}/reauthorize`, headers: auth(makeToken()), payload: {},
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('POST /connections/:provider/preview', () => {
  it('records interest without granting access or storing a credential', async () => {
    withStatus('NOT_CONNECTED');
    const res = await server.inject({
      method: 'POST', url: '/connections/app_store_connect/preview', headers: auth(makeToken()), payload: {},
    });
    expect(res.statusCode).toBe(200);
    // App Store Connect has a real adapter, so preview reports that honestly.
    expect(JSON.parse(res.body).data.adapterAvailable).toBe(true);
    // Previewing still grants nothing and stores no credential.
    expect(db.rows('connection_credentials')).toHaveLength(0);
    expect(db.rows('workspace_connections')[0].status).toBe('PREVIEWING');
  });
});

// ── Health ────────────────────────────────────────────────────────────────────

describe('GET /connections/:id/health', () => {
  it('returns 401 without token', async () => {
    const res = await server.inject({ method: 'GET', url: `/connections/${CONNECTION_ID}/health` });
    expect(res.statusCode).toBe(401);
  });

  it('returns health with granted permissions and no credential material', async () => {
    const res = await server.inject({
      method: 'GET', url: `/connections/${CONNECTION_ID}/health`, headers: auth(makeToken()),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toMatchObject({ provider: 'app_store_connect', adapter_available: true });
    expect(body.data.permissions_granted).toEqual(['READ', 'RECOMMEND']);
    // Nothing token-shaped may appear in an API response.
    for (const secret of ['encrypted', 'kms', 'enc(', 'access_token', 'refresh_token']) {
      expect(res.body.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });
});

// ── Permissions ───────────────────────────────────────────────────────────────

describe('connection permission routes', () => {
  it('returns the grant and the canonical ladder', async () => {
    const res = await server.inject({
      method: 'GET', url: `/connections/${CONNECTION_ID}/permissions`, headers: auth(makeToken()),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.granted).toEqual(['READ', 'RECOMMEND']);
    expect(body.data.levels).toEqual(['READ', 'RECOMMEND', 'DRAFT', 'CHANGE', 'PUBLISH', 'SPEND']);
    expect(body.data.executionLevels).toEqual(['CHANGE', 'PUBLISH', 'SPEND']);
  });

  it('records an upgrade request without granting it', async () => {
    const res = await server.inject({
      method: 'POST', url: `/connections/${CONNECTION_ID}/permissions/request-upgrade`,
      headers: auth(makeToken()),
      body: { levels: ['SPEND'], reason: 'Owner wants paid campaign execution' },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.affectsSpend).toBe(true);
    // Grant unchanged.
    expect(db.rows('workspace_connections')[0].permissions_granted).toEqual(['READ', 'RECOMMEND']);
  });

  it('rejects an upgrade with no stated reason', async () => {
    const res = await server.inject({
      method: 'POST', url: `/connections/${CONNECTION_ID}/permissions/approve-upgrade`,
      headers: auth(makeToken()), body: { levels: ['SPEND'], reason: 'no' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('grants execution authority only through explicit approval', async () => {
    const res = await server.inject({
      method: 'POST', url: `/connections/${CONNECTION_ID}/permissions/approve-upgrade`,
      headers: auth(makeToken()),
      body: { levels: ['CHANGE'], reason: 'Owner approved campaign edits after review' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.granted).toEqual(['READ', 'RECOMMEND', 'CHANGE']);
    expect(db.rows('connection_permission_history').some(h => h.action === 'upgrade_approved')).toBe(true);
  });

  it('refuses escalation on a connection in another workspace', async () => {
    const res = await server.inject({
      method: 'POST', url: `/connections/${CONNECTION_ID}/permissions/approve-upgrade`,
      headers: auth(makeTokenForFounder(FOUNDER_B_ID)),
      body: { levels: ['SPEND'], reason: 'Cross tenant escalation attempt' },
    });
    expect(res.statusCode).toBe(404);
    expect(db.rows('workspace_connections')[0].permissions_granted).toEqual(['READ', 'RECOMMEND']);
  });
});

// ── Disconnect ────────────────────────────────────────────────────────────────

describe('DELETE /connections/:id', () => {
  it('returns 401 without token', async () => {
    const res = await server.inject({ method: 'DELETE', url: `/connections/${CONNECTION_ID}` });
    expect(res.statusCode).toBe(401);
  });

  it('returns 204, revokes authority, and keeps imported intelligence', async () => {
    const res = await server.inject({
      method: 'DELETE', url: `/connections/${CONNECTION_ID}`, headers: auth(makeToken()),
    });
    expect(res.statusCode).toBe(204);
    expect(db.rows('workspace_connections')[0].status).toBe('DISCONNECTED');
    expect(db.rows('workspace_connections')[0].permissions_granted).toEqual([]);
    // Signals already learned from are retained.
    expect(db.rows('intelligence_signals')).toHaveLength(1);
    expect(db.rows('connection_permission_history').some(h => h.action === 'revoked')).toBe(true);
  });
});

// ── Tenant isolation at the route layer ───────────────────────────────────────

describe('tenant isolation: founder B cannot reach founder A connections', () => {
  it('GET → 404', async () => {
    const res = await server.inject({
      method: 'GET', url: `/connections/${CONNECTION_ID}`, headers: auth(makeTokenForFounder(FOUNDER_B_ID)),
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE → 404 and the connection survives', async () => {
    const res = await server.inject({
      method: 'DELETE', url: `/connections/${CONNECTION_ID}`, headers: auth(makeTokenForFounder(FOUNDER_B_ID)),
    });
    expect(res.statusCode).toBe(404);
    expect(db.rows('workspace_connections')[0].status).toBe('HEALTHY');
  });

  it('health → 404', async () => {
    const res = await server.inject({
      method: 'GET', url: `/connections/${CONNECTION_ID}/health`, headers: auth(makeTokenForFounder(FOUNDER_B_ID)),
    });
    expect(res.statusCode).toBe(404);
  });

  it('sync-runs → empty, never another workspace runs', async () => {
    const res = await server.inject({
      method: 'GET', url: `/connections/${CONNECTION_ID}/sync-runs`, headers: auth(makeTokenForFounder(FOUNDER_B_ID)),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data).toEqual([]);
  });

  it('sync → 404 and nothing is enqueued', async () => {
    const res = await server.inject({
      method: 'POST', url: `/connections/${CONNECTION_ID}/sync`,
      headers: auth(makeTokenForFounder(FOUNDER_B_ID)), payload: {},
    });
    expect(res.statusCode).toBe(404);
    expect(enqueueSpy).not.toHaveBeenCalled();
  });
});
