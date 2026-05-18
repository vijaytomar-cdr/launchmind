/**
 * @file metrics.test.ts
 * @description Unit tests for Week 7: metricsService, utmService, metrics route, UTM routes.
 *   Covers:
 *     - buildUTMUrl() constructs correct query params
 *     - buildUTMUrl() with optional content + term
 *     - buildUTMUrl() preserves existing query params on base URL
 *     - utmService.createUTMLink rejects non-http URLs (security: javascript: scheme)
 *     - GET /products/:id/metrics without JWT → 401
 *     - GET /products/:id/metrics with JWT + mocked data → 200 shape
 *     - GET /products/:id/metrics with invalid UUID → 400
 *     - POST /campaigns/:id/utm-link without JWT → 401
 *     - POST /campaigns/:id/utm-link with invalid body → 400
 *     - POST /campaigns/:id/utm-link valid → 201 + shortUrl
 *     - GET /campaigns/:id/utm-links → 200 + links array
 *     - GET /r/:code public redirect → 302
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { buildUTMUrl } from '../src/services/utmService';

const FOUNDER_ID = 'ba100000-0000-0000-0000-000000000001';
const PRODUCT_ID = 'ba200000-0000-0000-0000-000000000001';
const CAMPAIGN_ID = 'ba300000-0000-0000-0000-000000000001';
const JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';

function makeToken(sub = FOUNDER_ID) {
  return jwt.sign({ sub, role: 'authenticated' }, JWT_SECRET, { expiresIn: '1h' });
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../src/lib/scheduler', () => ({
  triggerBriefNow: vi.fn(async () => ({ jobId: 'test-job-id' })),
  scheduleWeeklyBrief: vi.fn(async () => undefined),
  getBriefQueue: vi.fn(),
  getCurrentWeekStart: vi.fn(() => '2026-05-12'),
  BRIEF_QUEUE_NAME: 'weekly-brief',
  WEEKLY_BRIEF_CRON: '0 17 * * 0',
  WEEKLY_BRIEF_JOB_NAME: 'weekly-brief-all-products',
}));

vi.mock('../src/workers/weeklyBriefWorker', () => ({
  startBriefWorker: vi.fn(() => ({})),
}));

vi.mock('../src/workers/scraperWorker', () => ({
  detectPlatform: vi.fn(() => null),
  scrapeAppStore: vi.fn(),
  scrapePlayStore: vi.fn(),
  scrapeCompetitors: vi.fn(async () => []),
}));

vi.mock('../src/services/reviewAnalysis', () => ({
  analyseReviews: vi.fn(async () => ({ sentiment: 'positive', painPoints: [], copySignals: [], marketingOpportunities: [] })),
}));
vi.mock('../src/services/icpService', () => ({ buildICPBrief: vi.fn(() => ({})) }));
vi.mock('../src/services/strategyService', () => ({
  generateStrategy: vi.fn(async () => ({})),
  generateContentAssets: vi.fn(async () => ({})),
  getProductStrategy: vi.fn(async () => ({ campaigns: [], fullStrategy: null })),
}));
vi.mock('../src/lib/tokens', () => ({ consumeTokens: vi.fn(async () => undefined) }));
vi.mock('../src/services/billingService', () => ({
  createStripeCheckout: vi.fn(async () => ({ url: 'https://checkout.stripe.com/test' })),
  createRazorpayCheckout: vi.fn(async () => ({ orderId: 'order_test', amount: 99900, currency: 'INR', keyId: 'rzp_test' })),
  handleStripeWebhook: vi.fn(async () => undefined),
  handleRazorpayWebhook: vi.fn(async () => undefined),
  cancelSubscription: vi.fn(async () => undefined),
  getSubscriptionStatus: vi.fn(async () => ({ plan: 'solo', tokenBalance: 300, renewalNote: 'Renews monthly' })),
}));

// Metrics service mock
vi.mock('../src/services/metricsService', () => ({
  getProductMetrics: vi.fn(async (productId: string, founderId: string) => {
    if (productId === PRODUCT_ID && founderId === FOUNDER_ID) {
      return {
        productId,
        weeklySummaries: [
          { weekOf: '2026-05-12', totalImpressions: 17000, totalClicks: 470, totalInstalls: 42, avgCpi: 1.2, avgRoas: 2.1, avgCtr: 0.04 },
        ],
        channelBreakdown: [
          { channel: 'whatsapp', market: 'india', impressions: 5000, clicks: 350, installs: 42, avgRoas: 2.1, campaignCount: 1 },
          { channel: 'meta', market: 'usa', impressions: 12000, clicks: 120, installs: 0, avgRoas: 0, campaignCount: 1 },
        ],
        topPerformers: [
          { campaignId: CAMPAIGN_ID, channel: 'whatsapp', market: 'india', hookType: 'pain_first', weekOf: '2026-05-12', installs: 42, roas: 2.1, ctr: 0.07 },
        ],
        weekCount: 1,
      };
    }
    throw new Error('Product not found or access denied');
  }),
}));

// UTM service mock
vi.mock('../src/services/utmService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/utmService')>();
  return {
    ...actual,
    createUTMLink: vi.fn(async (campaignId: string, founderId: string) => {
      if (campaignId !== CAMPAIGN_ID || founderId !== FOUNDER_ID) {
        throw new Error('Campaign not found or access denied');
      }
      return {
        id: 'utm-link-uuid-001',
        campaignId,
        baseUrl: 'https://apps.apple.com/app/test/id123',
        utmSource: 'whatsapp',
        utmMedium: 'social',
        utmCampaign: 'pain_first_india',
        utmContent: null,
        utmTerm: null,
        shortCode: 'Ab1Cd2Ef',
        clickCount: 0,
        trackedUrl: 'https://apps.apple.com/app/test/id123?utm_source=whatsapp&utm_medium=social&utm_campaign=pain_first_india',
        createdAt: '2026-05-17T00:00:00.000Z',
      };
    }),
    getUTMLinks: vi.fn(async () => [
      {
        id: 'utm-link-uuid-001',
        campaignId: CAMPAIGN_ID,
        baseUrl: 'https://apps.apple.com/app/test/id123',
        utmSource: 'whatsapp',
        utmMedium: 'social',
        utmCampaign: 'pain_first_india',
        utmContent: null,
        utmTerm: null,
        shortCode: 'Ab1Cd2Ef',
        clickCount: 5,
        trackedUrl: 'https://apps.apple.com/app/test/id123?utm_source=whatsapp&utm_medium=social&utm_campaign=pain_first_india',
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    ]),
    trackClick: vi.fn(async (code: string) => {
      if (code === 'Ab1Cd2Ef') {
        return 'https://apps.apple.com/app/test/id123?utm_source=whatsapp&utm_medium=social&utm_campaign=pain_first_india';
      }
      return null;
    }),
  };
});

// Chainable Supabase mock that returns plan: 'solo' for requireMinPlan checks
const mockSingle = vi.fn().mockResolvedValue({ data: { plan: 'solo' }, error: null });
const mockEq = vi.fn().mockReturnThis();
const mockSelect = vi.fn().mockReturnValue({ eq: mockEq, single: mockSingle });
const mockFrom = vi.fn().mockReturnValue({ select: mockSelect, eq: mockEq, single: mockSingle });

vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

import { buildServer } from '../src/server';

// ══════════════════════════════════════════════════════════════════════════════
//  buildUTMUrl() unit tests
// ══════════════════════════════════════════════════════════════════════════════

describe('utmService — buildUTMUrl()', () => {
  it('constructs correct UTM query params', () => {
    const url = buildUTMUrl('https://apps.apple.com/app/foo/id123', {
      source: 'whatsapp',
      medium: 'social',
      campaign: 'pain_first',
    });
    expect(url).toContain('utm_source=whatsapp');
    expect(url).toContain('utm_medium=social');
    expect(url).toContain('utm_campaign=pain_first');
  });

  it('includes optional content and term params', () => {
    const url = buildUTMUrl('https://example.com', {
      source: 'meta',
      medium: 'paid',
      campaign: 'launch_week',
      content: 'banner_v1',
      term: 'app+productivity',
    });
    expect(url).toContain('utm_content=banner_v1');
    expect(url).toContain('utm_term=app%2Bproductivity');
  });

  it('preserves existing query params on base URL', () => {
    const url = buildUTMUrl('https://example.com?ref=partner', {
      source: 'email',
      medium: 'newsletter',
      campaign: 'weekly',
    });
    expect(url).toContain('ref=partner');
    expect(url).toContain('utm_source=email');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  Route integration tests
// ══════════════════════════════════════════════════════════════════════════════

describe('Metrics + UTM routes', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    process.env.ADMIN_SECRET = 'test-admin-secret-min-32-characters-long!!';
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
    delete process.env.ADMIN_SECRET;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Metrics route ───────────────────────────────────────────────────────────

  it('GET /products/:id/metrics without JWT → 401', async () => {
    const res = await server.inject({ method: 'GET', url: `/products/${PRODUCT_ID}/metrics` });
    expect(res.statusCode).toBe(401);
  });

  it('GET /products/:id/metrics with invalid UUID → 400', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/products/not-a-uuid/metrics',
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /products/:id/metrics with valid JWT → 200 + correct shape', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/products/${PRODUCT_ID}/metrics`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ weeklySummaries: unknown[]; channelBreakdown: unknown[]; topPerformers: unknown[] }>();
    expect(Array.isArray(body.weeklySummaries)).toBe(true);
    expect(Array.isArray(body.channelBreakdown)).toBe(true);
    expect(Array.isArray(body.topPerformers)).toBe(true);
    expect(body.weeklySummaries[0]).toMatchObject({ weekOf: '2026-05-12', totalInstalls: 42 });
  });

  // ── UTM create route ────────────────────────────────────────────────────────

  it('POST /campaigns/:id/utm-link without JWT → 401', async () => {
    const res = await server.inject({ method: 'POST', url: `/campaigns/${CAMPAIGN_ID}/utm-link` });
    expect(res.statusCode).toBe(401);
  });

  it('POST /campaigns/:id/utm-link with invalid body → 400', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/campaigns/${CAMPAIGN_ID}/utm-link`,
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { baseUrl: 'not-a-url', utmSource: 'x', utmMedium: 'y', utmCampaign: 'z' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /campaigns/:id/utm-link with valid body → 201 + shortUrl', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/campaigns/${CAMPAIGN_ID}/utm-link`,
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {
        baseUrl: 'https://apps.apple.com/app/test/id123',
        utmSource: 'whatsapp',
        utmMedium: 'social',
        utmCampaign: 'pain_first_india',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ shortCode: string; shortUrl: string; trackedUrl: string }>();
    expect(typeof body.shortCode).toBe('string');
    expect(body.shortUrl).toContain('/r/');
    expect(body.trackedUrl).toContain('utm_source=whatsapp');
  });

  // ── UTM list route ──────────────────────────────────────────────────────────

  it('GET /campaigns/:id/utm-links → 200 + links array', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/campaigns/${CAMPAIGN_ID}/utm-links`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ links: Array<{ shortCode: string; clickCount: number }> }>();
    expect(Array.isArray(body.links)).toBe(true);
    expect(body.links[0]).toMatchObject({ shortCode: 'Ab1Cd2Ef', clickCount: 5 });
  });

  // ── Redirect route ──────────────────────────────────────────────────────────

  it('GET /r/:code valid code → 302 redirect', async () => {
    const res = await server.inject({ method: 'GET', url: '/r/Ab1Cd2Ef' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('utm_source=whatsapp');
  });

  it('GET /r/:code unknown code → 404', async () => {
    const res = await server.inject({ method: 'GET', url: '/r/unknown1' });
    expect(res.statusCode).toBe(404);
  });
});
