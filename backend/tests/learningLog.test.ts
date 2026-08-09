/**
 * @file learningLog.test.ts
 * @description Tests the Growth Brain learning log (spec §4.3) — the explainability
 *   surface an owner reads to decide whether to trust LaunchMind's conclusions.
 *
 *   The assertions that matter most are the negative ones:
 *     - a confidence movement is NEVER recorded from one measured side
 *     - a referenced recommendation or mission from another tenant is not rendered
 *     - the route is workspace-scoped, and MemoryDb honours the predicate, so a
 *       forgotten filter fails here rather than passing silently
 *
 *   Also covers freshness, which used to be a column written once at sync time and
 *   therefore reported "fresh" indefinitely.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { MemoryDb } from './helpers/memoryDb';

const FOUNDER_ID   = 'aa100000-0000-0000-0000-000000000001';
const FOUNDER_B_ID = 'ff600000-0000-0000-0000-000000000006';
const WORKSPACE_ID = '11110000-0000-0000-0000-000000000001';
const WORKSPACE_B  = '22220000-0000-0000-0000-000000000002';
const PRODUCT_ID   = 'bb200000-0000-0000-0000-000000000002';
const CONNECTION_ID = 'cc300000-0000-0000-0000-000000000003';
const REC_ID       = 'ee500000-0000-0000-0000-000000000005';
const REC_OTHER_ID = 'ee500000-0000-0000-0000-00000000ffff';
const MISSION_ID   = 'aa900000-0000-0000-0000-000000000009';
const JWT_SECRET   = 'test-jwt-secret-min-32-chars-long!!';

function tokenFor(founderId: string): string {
  return jwt.sign({ sub: founderId, role: 'authenticated', email: `${founderId}@example.com` }, JWT_SECRET, { expiresIn: '1h' });
}

let db: MemoryDb;

vi.mock('../src/lib/supabaseAdmin', () => ({ getSupabaseAdmin: () => db.asClient() }));
vi.mock('../src/lib/tokenVault', () => ({
  encryptToken: vi.fn(async (p: string) => ({ ciphertext: `enc(${p})`, kmsKeyId: 'kms-test' })),
  decryptToken: vi.fn(async (c: string) => c),
}));
vi.mock('../src/workers/connectionSyncWorker', () => ({
  enqueueConnectionSync: vi.fn(async () => undefined),
  getConnectionSyncQueue: vi.fn(() => ({})),
  startConnectionSyncWorker: vi.fn(),
  stopConnectionSyncWorker: vi.fn(async () => undefined),
  CONNECTION_SYNC_QUEUE_NAME: 'connection-sync',
}));
vi.mock('../src/workers/missionWorker', () => ({
  enqueueMission: vi.fn(async () => undefined),
  getMissionQueue: vi.fn(() => ({})),
  startMissionWorker: vi.fn(),
  stopMissionWorker: vi.fn(async () => undefined),
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
  createStripeCheckout: vi.fn(async () => ({ url: 'https://checkout.stripe.com/test' })),
  createRazorpayCheckout: vi.fn(async () => ({ orderId: 'o', amount: 1, currency: 'INR', keyId: 'k' })),
  handleStripeWebhook: vi.fn(async () => undefined),
  handleRazorpayWebhook: vi.fn(async () => undefined),
  cancelSubscription: vi.fn(async () => undefined),
  getSubscriptionStatus: vi.fn(async () => ({ plan: 'solo', tokenBalance: 300, renewalNote: '' })),
}));

function entry(over: Record<string, unknown> = {}) {
  return {
    id: `gb-${Math.random().toString(16).slice(2, 10)}`,
    workspace_id: WORKSPACE_ID,
    founder_id: FOUNDER_ID,
    product_id: PRODUCT_ID,
    event_type: 'source_synced',
    trigger: 'App Store Connect reported 5 signals',
    provider: 'app_store_connect',
    connection_id: CONNECTION_ID,
    sync_run_id: null,
    trigger_signal_id: null,
    trace_id: 'lm_abc',
    evidence: [{ label: 'Downloads', value: 73 }],
    previous_state: 'No observed data from this source',
    new_state: 'Store conversion is 3.65%',
    prior_confidence: 58,
    new_confidence: 66,
    recommendation_ids_affected: [],
    mission_ids_affected: [],
    created_by_type: 'system',
    created_by: null,
    created_at: '2026-08-08T10:00:00Z',
    ...over,
  };
}

function seed(events: Array<Record<string, unknown>> = [entry()]): MemoryDb {
  return new MemoryDb({
    founders: [
      { id: FOUNDER_ID, active_workspace_id: WORKSPACE_ID },
      { id: FOUNDER_B_ID, active_workspace_id: WORKSPACE_B },
    ],
    workspaces: [
      { id: WORKSPACE_ID, founder_id: FOUNDER_ID, created_at: '2026-01-01' },
      { id: WORKSPACE_B, founder_id: FOUNDER_B_ID, created_at: '2026-01-02' },
    ],
    workspace_members: [],
    growth_brain_learning_events: events,
    saved_opportunities: [
      { id: REC_ID, founder_id: FOUNDER_ID, title: 'Fix store conversion' },
      // Belongs to the other tenant. Must never surface, even if referenced.
      { id: REC_OTHER_ID, founder_id: FOUNDER_B_ID, title: 'Another tenant private plan' },
    ],
    missions: [{ id: MISSION_ID, founder_id: FOUNDER_ID, title: 'Improve product page' }],
    workspace_connections: [],
    intelligence_signals: [],
    connection_credentials: [],
    connection_permission_history: [],
    oauth_authorization_requests: [],
    audit_logs: [],
    products: [{ id: PRODUCT_ID, founder_id: FOUNDER_ID, workspace_id: WORKSPACE_ID }],
    learning_events: [],
  });
}

let server: FastifyInstance;

beforeEach(() => { db = seed(); });

beforeAll(async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  const { buildServer } = await import('../src/server');
  server = await buildServer();
});
afterAll(async () => { await server?.close(); });

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

// ── Route ─────────────────────────────────────────────────────────────────────

describe('GET /intelligence/learning-log', () => {
  it('returns 401 without a token', async () => {
    const res = await server.inject({ method: 'GET', url: '/intelligence/learning-log' });
    expect(res.statusCode).toBe(401);
  });

  it('returns the full history, not only the latest entry', async () => {
    db = seed([
      entry({ id: 'e1', created_at: '2026-08-08T12:00:00Z', trigger: 'newest' }),
      entry({ id: 'e2', created_at: '2026-08-08T11:00:00Z', trigger: 'middle' }),
      entry({ id: 'e3', created_at: '2026-08-08T10:00:00Z', trigger: 'oldest' }),
    ]);

    const res = await server.inject({
      method: 'GET', url: '/intelligence/learning-log', headers: auth(tokenFor(FOUNDER_ID)),
    });

    expect(res.statusCode).toBe(200);
    const { entries } = res.json().data;
    expect(entries).toHaveLength(3);
    expect(entries.map((e: { trigger: string }) => e.trigger)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('carries every field the spec requires for an entry', async () => {
    db = seed([entry({
      recommendation_ids_affected: [REC_ID],
      mission_ids_affected: [MISSION_ID],
    })]);

    const res = await server.inject({
      method: 'GET', url: '/intelligence/learning-log', headers: auth(tokenFor(FOUNDER_ID)),
    });
    const e = res.json().data.entries[0];

    expect(e.createdAt).toBeTruthy();                       // timestamp
    expect(e.trigger).toContain('App Store Connect');       // trigger
    expect(e.providerLabel).toBe('App Store Connect');      // source
    expect(e.evidence).toEqual([{ label: 'Downloads', value: 73 }]); // evidence
    expect(e.previousState).toBeTruthy();                   // prior state
    expect(e.newState).toBeTruthy();                        // updated state
    expect(e.priorConfidence).toBe(58);                     // confidence before
    expect(e.newConfidence).toBe(66);                       // confidence after
    expect(e.confidenceDelta).toBe(8);
    expect(e.changeOrigin).toBe('automatic');               // automatic vs founder
    expect(e.connectionId).toBe(CONNECTION_ID);             // linked connection
    expect(e.affectedRecommendations).toEqual([{ id: REC_ID, title: 'Fix store conversion' }]);
    expect(e.affectedMissions).toEqual([{ id: MISSION_ID, title: 'Improve product page' }]);
  });

  it('marks a founder-entered change as founder-confirmed, not automatic', async () => {
    db = seed([entry({ created_by_type: 'founder', created_by: FOUNDER_ID, event_type: 'context_delta_updated' })]);
    const res = await server.inject({
      method: 'GET', url: '/intelligence/learning-log', headers: auth(tokenFor(FOUNDER_ID)),
    });
    expect(res.json().data.entries[0].changeOrigin).toBe('founder_confirmed');
  });

  it('reports no confidence delta when only one side was measured', async () => {
    // This is the failure mode the whole surface exists to prevent: a one-sided
    // number renders as a movement from zero.
    db = seed([entry({ prior_confidence: null, new_confidence: 71 })]);
    const res = await server.inject({
      method: 'GET', url: '/intelligence/learning-log', headers: auth(tokenFor(FOUNDER_ID)),
    });
    const e = res.json().data.entries[0];
    expect(e.confidenceDelta).toBeNull();
    expect(e.priorConfidence).toBeNull();
  });

  it('does not render a reference that belongs to another tenant', async () => {
    db = seed([entry({ recommendation_ids_affected: [REC_ID, REC_OTHER_ID] })]);
    const res = await server.inject({
      method: 'GET', url: '/intelligence/learning-log', headers: auth(tokenFor(FOUNDER_ID)),
    });
    const e = res.json().data.entries[0];
    expect(e.affectedRecommendations).toEqual([{ id: REC_ID, title: 'Fix store conversion' }]);
    expect(JSON.stringify(e)).not.toContain('Another tenant private plan');
  });

  it('returns nothing for a workspace the caller is not a member of', async () => {
    // FOUNDER_B has their own empty workspace; FOUNDER_A's entries must not appear.
    const res = await server.inject({
      method: 'GET', url: '/intelligence/learning-log', headers: auth(tokenFor(FOUNDER_B_ID)),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.entries).toEqual([]);
  });

  it('rejects a workspace hint the caller does not belong to', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/intelligence/learning-log',
      headers: { ...auth(tokenFor(FOUNDER_B_ID)), 'x-launchmind-workspace-id': WORKSPACE_ID },
    });
    expect(res.statusCode).toBe(404);
  });

  it('paginates and returns a cursor', async () => {
    db = seed(Array.from({ length: 4 }, (_, i) =>
      entry({ id: `p${i}`, created_at: `2026-08-0${8 - i}T10:00:00Z`, trigger: `t${i}` })));

    const first = await server.inject({
      method: 'GET', url: '/intelligence/learning-log?limit=2', headers: auth(tokenFor(FOUNDER_ID)),
    });
    const page1 = first.json().data;
    expect(page1.entries).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();

    const second = await server.inject({
      method: 'GET',
      url: `/intelligence/learning-log?limit=2&before=${encodeURIComponent(page1.nextCursor)}`,
      headers: auth(tokenFor(FOUNDER_ID)),
    });
    const page2 = second.json().data;
    expect(page2.entries).toHaveLength(2);
    expect(page2.entries[0].trigger).not.toBe(page1.entries[0].trigger);
  });

  it('rejects a malformed cursor instead of silently returning page one', async () => {
    const res = await server.inject({
      method: 'GET', url: '/intelligence/learning-log?before=yesterday', headers: auth(tokenFor(FOUNDER_ID)),
    });
    expect(res.statusCode).toBe(400);
  });

  it('caps limit rather than letting a caller pull the whole table', async () => {
    const res = await server.inject({
      method: 'GET', url: '/intelligence/learning-log?limit=5000', headers: auth(tokenFor(FOUNDER_ID)),
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── Write path ────────────────────────────────────────────────────────────────

describe('recordLearningEvent', () => {
  it('drops a one-sided confidence rather than storing it', async () => {
    const { recordLearningEvent } = await import('../src/services/growthBrainLearningService');

    await recordLearningEvent({
      workspaceId: WORKSPACE_ID, founderId: FOUNDER_ID,
      eventType: 'source_disconnected', trigger: 'Disconnected',
      newConfidence: 40,           // prior unknown
      createdByType: 'founder',
    });

    const rows = db.rows('growth_brain_learning_events');
    const written = rows[rows.length - 1] as { prior_confidence: number | null; new_confidence: number | null };
    expect(written.prior_confidence).toBeNull();
    expect(written.new_confidence).toBeNull();
  });

  it('never throws — a log failure must not roll back the owner\'s work', async () => {
    const { recordLearningEvent } = await import('../src/services/growthBrainLearningService');
    const broken = {
      from: () => ({ insert: () => ({ select: () => ({ single: async () => { throw new Error('db down'); } }) }) }),
    };
    const original = db.asClient;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).asClient = () => broken;
    try {
      await expect(recordLearningEvent({
        workspaceId: WORKSPACE_ID, founderId: FOUNDER_ID,
        eventType: 'context_updated', trigger: 'x', createdByType: 'founder',
      })).resolves.toBeNull();
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any).asClient = original;
    }
  });
});

// ── Freshness ─────────────────────────────────────────────────────────────────

describe('computeFreshness', () => {
  it('is derived from elapsed time, not from a column written once at sync', async () => {
    const { computeFreshness } = await import('../src/services/connectionService');
    const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

    expect(computeFreshness(ago(1))).toBe('fresh');
    expect(computeFreshness(ago(40))).toBe('recent');
    expect(computeFreshness(ago(24 * 5))).toBe('stale');
    expect(computeFreshness(ago(24 * 40))).toBe('outdated');
  });

  it('reports unknown when nothing has ever synced', async () => {
    const { computeFreshness } = await import('../src/services/connectionService');
    expect(computeFreshness(null)).toBe('unknown');
  });

  it('is never "fresh" for a connection that needs attention', async () => {
    const { computeFreshness } = await import('../src/services/connectionService');
    const justNow = new Date().toISOString();
    // It synced a minute ago, but the authorization has since expired — the data
    // it holds is not current, whatever the clock says.
    expect(computeFreshness(justNow, 'NEEDS_REAUTH')).toBe('stale');
    expect(computeFreshness(justNow, 'HEALTHY')).toBe('fresh');
  });

  it('has an owner-facing label for every level', async () => {
    const { FRESHNESS_LABELS } = await import('../src/services/connectionService');
    for (const level of ['fresh', 'recent', 'stale', 'outdated', 'unknown'] as const) {
      expect(FRESHNESS_LABELS[level]).toMatch(/[a-z]/i);
      // Never leak the machine value into the UI string.
      expect(FRESHNESS_LABELS[level]).not.toBe(level);
    }
  });
});
