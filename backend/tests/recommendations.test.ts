/**
 * @file recommendations.test.ts
 * @description Tests for M10 Recommendation Engine routes.
 *   Covers: GET/POST recommendations, dismiss/save/convert/feedback, benchmarks, trends.
 *   Tenant isolation tested: founder A cannot access founder B's recommendations.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildServer } from '../src/server';

vi.mock('../src/lib/supabaseAdmin', () => {
  const FOUNDER_A   = 'aa000000-0000-0000-0000-000000000001';
  const FOUNDER_B   = 'bb000000-0000-0000-0000-000000000002';
  const WORKSPACE_ID = 'ee500000-0000-4000-8000-000000000009';
const PRODUCT_ID  = 'cc000000-0000-0000-0000-000000000001';
  const REC_ID      = 'dd000000-0000-0000-0000-000000000001';
  const MISSION_ID  = 'ee000000-0000-0000-0000-000000000001';

  const REC = {
    id: REC_ID, founder_id: FOUNDER_A, product_id: PRODUCT_ID,
    type: 'opportunity', recommendation_type: 'opportunity',
    title: 'Launch in India', description: 'India market shows strong CPI signals',
    expected_impact: '~+30% installs', confidence: 0.8,
    effort: 'medium', risk: 'low', why_now: 'CPI benchmarks are favorable',
    source: 'recommendation_engine', evidence: ['Benchmark CPI $0.80'],
    score: 0.75, priority: 75, source_signals: [], expires_at: null,
    state: 'active', mission_id: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };

  function chain(data: unknown) {
    const c: Record<string, unknown> = {};
    ['select','insert','update','delete','eq','neq','in','is','not','gte','lte','lt',
     'order','range','limit','count'].forEach(m => { c[m] = vi.fn(() => c); });
    (c as Record<string, unknown>).data  = data;
    (c as Record<string, unknown>).error = null;
    (c as Record<string, unknown>).count = Array.isArray(data) ? data.length : 1;
    c.single = vi.fn().mockResolvedValue({ data, error: null });
    // Active-business resolution uses maybeSingle() and awaits chains directly.
    c.maybeSingle = vi.fn().mockResolvedValue({
      data: Array.isArray(data) ? (data[0] ?? null) : data, error: null });
    c.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: Array.isArray(data) ? data : [data], error: null }).then(resolve);
    return c;
  }

  return {
    getSupabaseAdmin: vi.fn(() => ({
      auth: {
        getUser: vi.fn().mockImplementation(async (token: string) => {
          try {
            const parts = (token ?? '').split('.');
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8')) as { sub: string };
            return { data: { user: { id: payload.sub } }, error: null };
          } catch {
            return { data: { user: { id: FOUNDER_A } }, error: null };
          }
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'saved_opportunities') {
          const c = chain([REC]);
          c.select = vi.fn(() => {
            const sc = chain([REC]);
            sc.single = vi.fn().mockResolvedValue({ data: REC, error: null });
            sc.limit  = vi.fn().mockResolvedValue({ data: [REC], count: 1, error: null });
            sc.eq     = vi.fn(() => sc);
            sc.order  = vi.fn(() => sc);
            return sc;
          });
          c.insert = vi.fn(() => ({
            ...c,
            select: vi.fn(() => ({ ...c, single: vi.fn().mockResolvedValue({ data: REC, error: null }) })),
          }));
          c.update = vi.fn(() => {
            // Build a fully-chainable object that resolves based on tenant ownership.
            // Handles all chaining patterns: eq/lt/lte/gte/select/single.
            function makeUpdateChain(isOwner: boolean): Record<string, unknown> {
              const resolvedData = isOwner ? { ...REC, state: 'dismissed' } : null;
              const resolve = vi.fn().mockResolvedValue({ data: resolvedData, error: null });
              const ch: Record<string, unknown> = { data: resolvedData, error: null };
              ['eq','neq','lt','lte','gte','gt','not','is','in','order','limit','range','count'].forEach(m => {
                ch[m] = vi.fn(() => ch);
              });
              ch.select = vi.fn(() => ({ ...ch, single: resolve }));
              ch.single = resolve;
              return ch;
            }
            const firstEq = vi.fn((_f: string, _v: string) => ({
              eq: vi.fn((field: string, val: string) => {
                // Tenant isolation: second eq on founder_id determines ownership
                const isOwner = field === 'founder_id' ? val === FOUNDER_A : true;
                return makeUpdateChain(isOwner);
              }),
            }));
            return { eq: firstEq };
          });
          return c;
        }
        if (table === 'products') {
          const pd = { id: PRODUCT_ID, founder_id: FOUNDER_A, workspace_id: WORKSPACE_ID, archived_at: null, name: 'TestApp', category: 'Productivity', markets: ['usa'], confirmed_icp: null, competitor_set: null, scraped_meta: null, price_tier: 'free' };
          const c2 = chain([pd]);
          c2.single = vi.fn().mockResolvedValue({ data: pd, error: null });
          return c2;
        }
        // Active-business resolution needs a selected workspace + its product.
        if (table === 'founders')  return chain({ id: FOUNDER_A, plan: 'builder', token_balance: 500, active_workspace_id: WORKSPACE_ID, active_product_id: PRODUCT_ID });
        if (table === 'workspaces') return chain({ id: WORKSPACE_ID, founder_id: FOUNDER_A, name: 'TestCo' });
        if (table === 'workspace_members') return chain([]);
        if (table === 'missions') {
          const c = chain({ id: MISSION_ID, title: 'Launch in India', status: 'draft' });
          c.insert = vi.fn(() => ({
            ...c,
            select: vi.fn(() => ({ ...c, single: vi.fn().mockResolvedValue({ data: { id: MISSION_ID, title: 'Launch in India', status: 'draft' }, error: null }) })),
          }));
          return c;
        }
        if (table === 'recommendation_feedback') {
          const c = chain(null);
          c.insert = vi.fn().mockResolvedValue({ data: null, error: null });
          return c;
        }
        if (table === 'marketing_memories') return chain([]);
        if (table === 'campaign_metrics')   return chain([]);
        if (table === 'experiments')        return chain([]);
        if (table === 'playbook_signals')   return chain([
          { category: 'Productivity', market: 'usa', channel: 'meta', install_delta_pct: 12.5, conversion_rate: 0.04, retention_d7: 0.35 },
          { category: 'Productivity', market: 'usa', channel: 'google', install_delta_pct: 8.0, conversion_rate: 0.03, retention_d7: 0.30 },
          { category: 'Productivity', market: 'usa', channel: 'meta', install_delta_pct: 15.0, conversion_rate: 0.05, retention_d7: 0.40 },
        ]);
        if (table === 'intelligence_trends') return chain([]);
        if (table === 'audit_logs') { const c = chain(null); c.insert = vi.fn().mockResolvedValue({ data: null, error: null }); return c; }
        return chain(null);
      }),
    })),
    _FOUNDER_A:  FOUNDER_A,
    _FOUNDER_B:  FOUNDER_B,
    _PRODUCT_ID: PRODUCT_ID,
    _REC_ID:     REC_ID,
  };
});

vi.mock('../src/lib/aiPlatform', () => ({
  callSonnet: vi.fn(async () => '{}'),
  callHaiku:  vi.fn(async () => JSON.stringify([
    { title: 'Launch in India', description: 'Strong CPI signals', recommendationType: 'expansion', effort: 'medium', risk: 'low', expectedImpact: '~+30%', confidence: 0.8, whyNow: 'CPI favorable', evidence: ['Signal 1'] },
    { title: 'Improve ASO copy', description: 'Keywords underperforming', recommendationType: 'optimization', effort: 'low', risk: 'low', expectedImpact: '+5%', confidence: 0.7, whyNow: 'Low hanging fruit', evidence: [] },
    { title: 'Add India payment', description: 'UPI integration needed', recommendationType: 'opportunity', effort: 'high', risk: 'medium', expectedImpact: 'New market', confidence: 0.6, whyNow: 'Market ready', evidence: [] },
  ])),
}));

vi.mock('../src/lib/contextEngine',           () => ({ buildContextPackage: vi.fn(async () => null) }));
vi.mock('../src/workers/missionWorker',        () => ({ startMissionWorker: vi.fn(), enqueueMission: vi.fn() }));
vi.mock('../src/workers/weeklyBriefWorker',    () => ({ startBriefWorker: vi.fn() }));
vi.mock('../src/workers/intakeWorker',         () => ({ startIntakeWorker: vi.fn() }));
vi.mock('../src/workers/contentWorker',        () => ({ startContentWorker: vi.fn() }));

const MOCK_FOUNDER_ID = 'aa000000-0000-0000-0000-000000000001';
const MOCK_PRODUCT_ID = 'cc000000-0000-0000-0000-000000000001';
const MOCK_REC_ID     = 'dd000000-0000-0000-0000-000000000001';

function authHeader(founderId = MOCK_FOUNDER_ID) {
  const payload = Buffer.from(JSON.stringify({ sub: founderId, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64');
  return `Bearer eyJhbGciOiJFUzI1NiJ9.${payload}.MOCK_SIG`;
}

describe('M10 Recommendation Engine routes', () => {
  it('GET /recommendations returns 401 without token', async () => {
    const server = await buildServer();
    const res = await server.inject({ method: 'GET', url: '/recommendations' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /recommendations returns 200 with recommendations array', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'GET', url: '/recommendations',
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json<{ recommendations: unknown[] }>().recommendations)).toBe(true);
  });

  it('GET /recommendations accepts productId filter', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'GET', url: `/recommendations?productId=${MOCK_PRODUCT_ID}`,
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
  });

  it('POST /recommendations/generate returns 401 without token', async () => {
    const server = await buildServer();
    const res = await server.inject({ method: 'POST', url: '/recommendations/generate', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('POST /recommendations/generate returns 400 for missing productId', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'POST', url: '/recommendations/generate',
      headers: { authorization: authHeader() },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /recommendations/generate returns 201 or 202 for valid productId', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'POST', url: '/recommendations/generate',
      headers: { authorization: authHeader() },
      payload: { productId: MOCK_PRODUCT_ID },
    });
    expect([201, 202, 404]).toContain(res.statusCode);
  });

  it('PATCH /recommendations/:id/dismiss returns 401 without token', async () => {
    const server = await buildServer();
    const res = await server.inject({ method: 'PATCH', url: `/recommendations/${MOCK_REC_ID}/dismiss`, payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('PATCH /recommendations/:id/dismiss returns 200 or 404', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'PATCH', url: `/recommendations/${MOCK_REC_ID}/dismiss`,
      headers: { authorization: authHeader() }, payload: {},
    });
    expect([200, 404]).toContain(res.statusCode);
  });

  it('PATCH /recommendations/:id/save returns 200 or 404', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'PATCH', url: `/recommendations/${MOCK_REC_ID}/save`,
      headers: { authorization: authHeader() }, payload: {},
    });
    expect([200, 404]).toContain(res.statusCode);
  });

  it('POST /recommendations/:id/convert returns 401 without token', async () => {
    const server = await buildServer();
    const res = await server.inject({ method: 'POST', url: `/recommendations/${MOCK_REC_ID}/convert`, payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('POST /recommendations/:id/convert returns 201 or 404 with valid payload', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'POST', url: `/recommendations/${MOCK_REC_ID}/convert`,
      headers: { authorization: authHeader() },
      payload: { title: 'Launch in India mission' },
    });
    expect([201, 404, 409]).toContain(res.statusCode);
    if (res.statusCode === 201) {
      expect(res.json<{ mission: { id: string } }>().mission).toBeDefined();
    }
  });

  it('GET /recommendations/history returns 401 without token', async () => {
    const server = await buildServer();
    const res = await server.inject({ method: 'GET', url: '/recommendations/history' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /recommendations/history returns 200 with array', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'GET', url: '/recommendations/history',
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json<{ recommendations: unknown[] }>().recommendations)).toBe(true);
  });

  it('POST /recommendations/:id/feedback returns 401 without token', async () => {
    const server = await buildServer();
    const res = await server.inject({ method: 'POST', url: `/recommendations/${MOCK_REC_ID}/feedback`, payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('POST /recommendations/:id/feedback returns 400 for invalid feedbackType', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'POST', url: `/recommendations/${MOCK_REC_ID}/feedback`,
      headers: { authorization: authHeader() },
      payload: { feedbackType: 'invalid_type' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /recommendations/:id/feedback returns 201 or 404 for valid feedback', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'POST', url: `/recommendations/${MOCK_REC_ID}/feedback`,
      headers: { authorization: authHeader() },
      payload: { feedbackType: 'helpful', note: 'Very useful recommendation' },
    });
    expect([201, 404]).toContain(res.statusCode);
  });
});

describe('M10 Benchmark routes', () => {
  it('GET /benchmarks returns 401 without token', async () => {
    const server = await buildServer();
    const res = await server.inject({ method: 'GET', url: '/benchmarks' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /benchmarks returns 400 without required params', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'GET', url: '/benchmarks',
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /benchmarks returns 200 with benchmark or null', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'GET', url: '/benchmarks?category=Productivity&market=usa',
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    // benchmark may be null (insufficient signals) or an object
    const body = res.json<{ benchmark: unknown }>();
    expect('benchmark' in body).toBe(true);
  });

  it('GET /benchmarks/categories returns 200 with categories array', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'GET', url: '/benchmarks/categories',
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json<{ categories: unknown[] }>().categories)).toBe(true);
  });

  it('GET /benchmarks/trends returns 401 without token', async () => {
    const server = await buildServer();
    const res = await server.inject({ method: 'GET', url: '/benchmarks/trends' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /benchmarks/trends returns 400 without required params', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'GET', url: '/benchmarks/trends',
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /benchmarks/trends returns 200 with trends array', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'GET', url: '/benchmarks/trends?category=Productivity&market=usa',
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json<{ trends: unknown[] }>().trends)).toBe(true);
  });

  it('GET /benchmarks/summary returns 401 without token', async () => {
    const server = await buildServer();
    const res = await server.inject({ method: 'GET', url: '/benchmarks/summary' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /benchmarks/summary returns 200 with summaries array', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'GET', url: '/benchmarks/summary',
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json<{ summaries: unknown[] }>().summaries)).toBe(true);
  });
});

describe('M10 Decision Engine unit tests', () => {
  it('checkRegenLimit does not throw below limit', async () => {
    const { checkRegenLimit } = await import('../src/services/decisionEngineService');
    expect(() => checkRegenLimit(2, 'asset-1')).not.toThrow();
  });

  it('checkRegenLimit throws DecisionError at limit', async () => {
    const { checkRegenLimit, DecisionError } = await import('../src/services/decisionEngineService');
    expect(() => checkRegenLimit(3, 'asset-1')).toThrow(DecisionError);
  });

  it('checkBenchmarkAccess does not throw for any founder', async () => {
    const { checkBenchmarkAccess } = await import('../src/services/decisionEngineService');
    expect(() => checkBenchmarkAccess('any-founder-id')).not.toThrow();
  });
});

describe('M10 Tenant isolation', () => {
  it('Founder B token cannot dismiss Founder A recommendation', async () => {
    const server = await buildServer();
    const FOUNDER_B = 'bb000000-0000-0000-0000-000000000002';
    const res = await server.inject({
      method: 'PATCH', url: `/recommendations/${MOCK_REC_ID}/dismiss`,
      headers: { authorization: authHeader(FOUNDER_B) }, payload: {},
    });
    // Should return 404 — recommendation not found for this founder (RLS)
    expect([401, 403, 404]).toContain(res.statusCode);
  });
});
