/**
 * @file analytics.test.ts
 * @description M11 Analytics route tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildServer } from '../src/server';

const FOUNDER_A = 'f1111111-0000-0000-0000-000000000001';
const PRODUCT_A = 'aaaaaaaa-0000-0000-0000-000000000001';

function makeJwt(sub: string = FOUNDER_A) {
  const payload = Buffer.from(JSON.stringify({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64');
  return `Bearer eyJhbGciOiJFUzI1NiJ9.${payload}.MOCK_SIG`;
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../src/services/metricsService', () => ({
  getProductMetrics: vi.fn().mockResolvedValue({
    weeklySummaries: [
      { weekOf: '2026-07-01', totalImpressions: 5000, totalClicks: 250, totalInstalls: 50, avgCpi: 2.00, avgRoas: 1.50, avgCtr: 0.05 },
      { weekOf: '2026-06-24', totalImpressions: 4000, totalClicks: 180, totalInstalls: 36, avgCpi: 2.20, avgRoas: 1.30, avgCtr: 0.045 },
    ],
    channelBreakdown: [
      { channel: 'meta',     market: 'usa',   impressions: 3000, clicks: 150, installs: 30, avgRoas: 1.8 },
      { channel: 'whatsapp', market: 'india', impressions: 2000, clicks: 100, installs: 20, avgRoas: 1.2 },
    ],
    weekCount: 2,
  }),
}));

vi.mock('../src/services/optimizationEngineService', () => ({
  generateInsights:     vi.fn().mockResolvedValue({ created: 2, skipped: 0 }),
  listInsights:         vi.fn().mockResolvedValue([
    { id: 'ins-1', insightType: 'channel_optimization', title: 'Boost Meta', description: 'Meta ROAS exceeds benchmark by 2×.', confidence: 0.85, status: 'pending' },
  ]),
  updateInsightStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/lib/supabaseAdmin', () => {
  function chain(data: unknown) {
    const c: Record<string, unknown> = { data, error: null };
    const methods = ['eq','neq','is','in','not','order','limit','range','gte','lte','single','select'];
    methods.forEach(m => { c[m] = vi.fn(() => c); });
    (c as { then: unknown }).then = undefined;
    return c;
  }

  return {
    getSupabaseAdmin: vi.fn(() => ({
      auth: {
        getUser: vi.fn().mockImplementation(async (token: string) => {
          try {
            const parts   = (token ?? '').split('.');
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8')) as { sub: string };
            return { data: { user: { id: payload.sub } }, error: null };
          } catch {
            return { data: { user: { id: FOUNDER_A } }, error: null };
          }
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'products') {
          const prods = [{ id: PRODUCT_A, name: 'ClientPulse', category: 'crm', markets: ['usa', 'india'] }];
          const c = chain(prods);
          (c.single as ReturnType<typeof vi.fn>) = vi.fn().mockResolvedValue({ data: prods[0], error: null });
          return c;
        }
        if (table === 'campaign_metrics') {
          return chain([]);
        }
        return chain([]);
      }),
    })),
  };
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Analytics routes', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    server = await buildServer();
  });

  // ── Summary ──────────────────────────────────────────────────────────────────

  it('GET /analytics/summary returns 401 without token', async () => {
    const res = await server.inject({ method: 'GET', url: '/analytics/summary' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /analytics/summary returns 200 with summary', async () => {
    const res = await server.inject({
      method: 'GET', url: '/analytics/summary',
      headers: { authorization: makeJwt(FOUNDER_A) },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { founderId: string; products: unknown[]; totals: { totalInstalls: number } } };
    expect(body.data.founderId).toBe(FOUNDER_A);
    expect(Array.isArray(body.data.products)).toBe(true);
    expect(typeof body.data.totals.totalInstalls).toBe('number');
  });

  // ── KPI ───────────────────────────────────────────────────────────────────────

  it('GET /analytics/kpi returns 401 without token', async () => {
    const res = await server.inject({ method: 'GET', url: `/analytics/kpi?productId=${PRODUCT_A}` });
    expect(res.statusCode).toBe(401);
  });

  it('GET /analytics/kpi returns 400 without productId', async () => {
    const res = await server.inject({
      method: 'GET', url: '/analytics/kpi',
      headers: { authorization: makeJwt(FOUNDER_A) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /analytics/kpi returns 200 with weekly data', async () => {
    const res = await server.inject({
      method: 'GET', url: `/analytics/kpi?productId=${PRODUCT_A}`,
      headers: { authorization: makeJwt(FOUNDER_A) },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { productId: string; weeks: unknown[] } };
    expect(body.data.productId).toBe(PRODUCT_A);
    expect(Array.isArray(body.data.weeks)).toBe(true);
    expect(body.data.weeks.length).toBeGreaterThan(0);
  });

  // ── Attribution ───────────────────────────────────────────────────────────────

  it('GET /analytics/attribution returns 401 without token', async () => {
    const res = await server.inject({ method: 'GET', url: `/analytics/attribution?productId=${PRODUCT_A}` });
    expect(res.statusCode).toBe(401);
  });

  it('GET /analytics/attribution returns 200 with byChannel', async () => {
    const res = await server.inject({
      method: 'GET', url: `/analytics/attribution?productId=${PRODUCT_A}`,
      headers: { authorization: makeJwt(FOUNDER_A) },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { totalInstalls: number; byChannel: unknown[] } };
    expect(typeof body.data.totalInstalls).toBe('number');
    expect(Array.isArray(body.data.byChannel)).toBe(true);
  });

  // ── Funnel ────────────────────────────────────────────────────────────────────

  it('GET /analytics/funnel returns 401 without token', async () => {
    const res = await server.inject({ method: 'GET', url: `/analytics/funnel?productId=${PRODUCT_A}` });
    expect(res.statusCode).toBe(401);
  });

  it('GET /analytics/funnel returns 200 with funnel structure', async () => {
    const res = await server.inject({
      method: 'GET', url: `/analytics/funnel?productId=${PRODUCT_A}`,
      headers: { authorization: makeJwt(FOUNDER_A) },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { impressions: number; clicks: number; installs: number; byChannel: unknown[] } };
    expect(typeof body.data.impressions).toBe('number');
    expect(typeof body.data.clicks).toBe('number');
    expect(typeof body.data.installs).toBe('number');
    expect(Array.isArray(body.data.byChannel)).toBe(true);
  });

  // ── ROI ───────────────────────────────────────────────────────────────────────

  it('GET /analytics/roi returns 401 without token', async () => {
    const res = await server.inject({ method: 'GET', url: `/analytics/roi?productId=${PRODUCT_A}` });
    expect(res.statusCode).toBe(401);
  });

  it('GET /analytics/roi returns 200 with roi structure', async () => {
    const res = await server.inject({
      method: 'GET', url: `/analytics/roi?productId=${PRODUCT_A}`,
      headers: { authorization: makeJwt(FOUNDER_A) },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { estimatedSpend: number; estimatedRevenue: number; byChannel: unknown[] } };
    expect(typeof body.data.estimatedSpend).toBe('number');
    expect(typeof body.data.estimatedRevenue).toBe('number');
    expect(Array.isArray(body.data.byChannel)).toBe(true);
  });

  // ── Optimize ──────────────────────────────────────────────────────────────────

  it('POST /analytics/optimize returns 401 without token', async () => {
    const res = await server.inject({
      method: 'POST', url: '/analytics/optimize',
      payload: { productId: PRODUCT_A },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /analytics/optimize returns 201 with created count', async () => {
    const res = await server.inject({
      method: 'POST', url: '/analytics/optimize',
      headers: { authorization: makeJwt(FOUNDER_A) },
      payload: { productId: PRODUCT_A },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { data: { created: number; skipped: number } };
    expect(typeof body.data.created).toBe('number');
  });

  it('POST /analytics/optimize returns 400 without productId', async () => {
    const res = await server.inject({
      method: 'POST', url: '/analytics/optimize',
      headers: { authorization: makeJwt(FOUNDER_A) },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  // ── Insights ─────────────────────────────────────────────────────────────────

  it('GET /analytics/insights returns 401 without token', async () => {
    const res = await server.inject({ method: 'GET', url: `/analytics/insights?productId=${PRODUCT_A}` });
    expect(res.statusCode).toBe(401);
  });

  it('GET /analytics/insights returns 200 with insights array', async () => {
    const res = await server.inject({
      method: 'GET', url: `/analytics/insights?productId=${PRODUCT_A}`,
      headers: { authorization: makeJwt(FOUNDER_A) },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { insights: unknown[] } };
    expect(Array.isArray(body.data.insights)).toBe(true);
  });
});
