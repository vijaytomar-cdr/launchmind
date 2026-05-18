/**
 * @file strategy.test.ts
 * @description Unit tests for the 3 strategy routes on productsRoutes.
 *   strategyService and playbookService mocked — no real Claude API calls.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';

const FOUNDER_ID = 'f1000000-0000-0000-0000-000000000001';
const PRODUCT_ID = 'b2000000-0000-0000-0000-000000000002';
const JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';

function makeToken(sub = FOUNDER_ID) {
  return jwt.sign({ sub, role: 'authenticated' }, JWT_SECRET, { expiresIn: '1h' });
}

const mockStrategy = {
  thirtyDay: [
    {
      channel: 'meta',
      rationale: 'Broadest reach',
      projectedPerformance: 'high',
      suggestedWeeklySpendUSD: 200,
      suggestedWeeklySpendINR: 16000,
      hookType: 'pain_first',
      primaryKPI: 'installs',
    },
  ],
  sixtyDay: [],
  ninetyDay: [],
  usa: {
    positioning: 'Save 2 hours/day',
    primaryChannels: ['meta', 'email'],
    messagingAngle: 'productivity',
    pricingAngle: 'free trial',
    topObjection: 'switching cost',
    objectiveFocus: 'installs',
  },
  india: {
    positioning: '10,000+ professionals use it',
    primaryChannels: ['whatsapp'],
    messagingAngle: 'social proof',
    pricingAngle: 'free',
    topObjection: 'trust',
    objectiveFocus: 'installs',
  },
  executiveSummary: 'Focus on Meta first.',
  generatedAt: new Date().toISOString(),
};

const mockAssets = {
  channel: 'whatsapp',
  market: 'india',
  whatsapp: [
    { hookType: 'pain_first', headline: 'Stop losing leads', body: 'Track everything.', cta: 'Try free' },
  ],
  generatedAt: new Date().toISOString(),
};

vi.mock('../src/services/strategyService', () => ({
  generateStrategy: vi.fn(async () => mockStrategy),
  generateContentAssets: vi.fn(async () => mockAssets),
  getProductStrategy: vi.fn(async () => ({ campaigns: [], fullStrategy: null })),
}));

vi.mock('../src/services/playbookService', () => ({
  buildPlaybookContext: vi.fn(async () => 'No signals found.'),
  getRelevantSignals: vi.fn(async () => []),
  getSimilarSignals: vi.fn(async () => []),
}));

vi.mock('../src/lib/tokens', () => ({ consumeTokens: vi.fn(async () => undefined) }));

const mockFrom = vi.fn();
vi.mock('../src/lib/supabaseAdmin', () => ({ getSupabaseAdmin: () => ({ from: mockFrom }) }));

vi.mock('../src/workers/scraperWorker', () => ({
  detectPlatform: vi.fn(() => null),
  scrapeAppStore: vi.fn(),
  scrapePlayStore: vi.fn(),
  scrapeCompetitors: vi.fn(async () => []),
}));
vi.mock('../src/services/reviewAnalysis', () => ({ analyseReviews: vi.fn(async () => ({ sentiment: 'positive', painPoints: [], copySignals: [], marketingOpportunities: [] })) }));
vi.mock('../src/services/icpService', () => ({ buildICPBrief: vi.fn(() => ({})) }));

import { buildServer } from '../src/server';

describe('Strategy routes', () => {
  let server: FastifyInstance;

  beforeAll(async () => { server = await buildServer(); });
  afterAll(async () => { await server.close(); });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { plan: 'solo' }, error: null }) }) }),
      insert: () => Promise.resolve({ data: {}, error: null }),
    });
  });

  // ── POST /products/:id/strategy ───────────────────────────────────────────

  describe('POST /products/:id/strategy', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({ method: 'POST', url: `/products/${PRODUCT_ID}/strategy` });
      expect(res.statusCode).toBe(401);
    });

    it('returns 400 for invalid UUID', async () => {
      const res = await server.inject({
        method: 'POST', url: '/products/not-a-uuid/strategy',
        headers: { authorization: `Bearer ${makeToken()}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 403 for free-tier founder (plan gate)', async () => {
      mockFrom.mockReturnValue({
        select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { plan: 'free' }, error: null }) }) }),
        insert: () => Promise.resolve({ data: {}, error: null }),
      });

      const res = await server.inject({
        method: 'POST', url: `/products/${PRODUCT_ID}/strategy`,
        headers: { authorization: `Bearer ${makeToken()}` },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ code: 'PLAN_FEATURE_RESTRICTED', requiredPlan: 'solo' });
    });

    it('returns 201 with strategy for solo founder', async () => {
      const res = await server.inject({
        method: 'POST', url: `/products/${PRODUCT_ID}/strategy`,
        headers: { authorization: `Bearer ${makeToken()}` },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toHaveProperty('thirtyDay');
      expect(body).toHaveProperty('usa');
      expect(body).toHaveProperty('india');
      expect(body).toHaveProperty('executiveSummary');
    });

    it('returns 404 when strategy service throws not found', async () => {
      const { generateStrategy } = await import('../src/services/strategyService');
      vi.mocked(generateStrategy).mockRejectedValueOnce(new Error('Product not found or access denied'));

      const res = await server.inject({
        method: 'POST', url: `/products/${PRODUCT_ID}/strategy`,
        headers: { authorization: `Bearer ${makeToken()}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── POST /products/:id/strategy/assets ───────────────────────────────────

  describe('POST /products/:id/strategy/assets', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({
        method: 'POST', url: `/products/${PRODUCT_ID}/strategy/assets`,
        payload: { channel: 'whatsapp', market: 'india' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 403 for solo founder (builder+ required)', async () => {
      // beforeEach sets plan: 'solo' — solo cannot generate content assets
      const res = await server.inject({
        method: 'POST', url: `/products/${PRODUCT_ID}/strategy/assets`,
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: { channel: 'whatsapp', market: 'india' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ code: 'PLAN_FEATURE_RESTRICTED', requiredPlan: 'builder' });
    });

    it('returns 400 for invalid channel (builder plan)', async () => {
      mockFrom.mockReturnValue({
        select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { plan: 'builder' }, error: null }) }) }),
        insert: () => Promise.resolve({ data: {}, error: null }),
      });
      const res = await server.inject({
        method: 'POST', url: `/products/${PRODUCT_ID}/strategy/assets`,
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: { channel: 'tiktok', market: 'usa' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 201 with assets for builder founder + valid channel + market', async () => {
      mockFrom.mockReturnValue({
        select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { plan: 'builder' }, error: null }) }) }),
        insert: () => Promise.resolve({ data: {}, error: null }),
      });
      const res = await server.inject({
        method: 'POST', url: `/products/${PRODUCT_ID}/strategy/assets`,
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: { channel: 'whatsapp', market: 'india' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toHaveProperty('channel', 'whatsapp');
      expect(body).toHaveProperty('market', 'india');
    });
  });

  // ── GET /products/:id/strategy ────────────────────────────────────────────

  describe('GET /products/:id/strategy', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({ method: 'GET', url: `/products/${PRODUCT_ID}/strategy` });
      expect(res.statusCode).toBe(401);
    });

    it('returns campaigns array for authenticated founder', async () => {
      const res = await server.inject({
        method: 'GET', url: `/products/${PRODUCT_ID}/strategy`,
        headers: { authorization: `Bearer ${makeToken()}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('campaigns');
      expect(Array.isArray(body.campaigns)).toBe(true);
    });

    it('omits fullStrategy for free founder', async () => {
      mockFrom.mockReturnValue({
        select: () => ({
          eq: () => ({ single: () => Promise.resolve({ data: { plan: 'free' }, error: null }) }),
        }),
        insert: () => Promise.resolve({ data: {}, error: null }),
      });

      const res = await server.inject({
        method: 'GET', url: `/products/${PRODUCT_ID}/strategy`,
        headers: { authorization: `Bearer ${makeToken()}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).not.toHaveProperty('fullStrategy');
    });
  });
});
