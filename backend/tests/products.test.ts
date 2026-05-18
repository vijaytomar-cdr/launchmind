/**
 * @file products.test.ts
 * @description Unit tests for the products routes.
 *   Uses Fastify inject() — no real network calls.
 *   Supabase admin client is mocked to avoid DB dependency.
 *   scraperWorker and reviewAnalysis are mocked to isolate route logic.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';

const FOUNDER_ID = 'f1000000-0000-0000-0000-000000000001';
const PRODUCT_ID = 'b2000000-0000-0000-0000-000000000002';
const JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';

function makeToken(sub: string = FOUNDER_ID): string {
  return jwt.sign({ sub, role: 'authenticated' }, JWT_SECRET, { expiresIn: '1h' });
}

const mockScraped = {
  name: 'TestApp',
  developer: 'Test Dev',
  description: 'A productivity app to help you get things done',
  category: 'Productivity',
  rating: 4.2,
  ratingCount: 1200,
  priceTier: 'free',
  screenshots: ['https://example.com/img1.png'],
  reviews: [{ rating: 5, text: 'Great app!', date: '2024-01-01' }],
  platform: 'play_store' as const,
  storeUrl: 'https://play.google.com/store/apps/details?id=com.test.app',
};

const mockICP = {
  targetUser: 'Professionals seeking efficiency',
  geography: ['usa', 'india'],
  priceTier: 'free',
  painPoints: ['Too much manual work', 'Hard to track tasks'],
  competitorGaps: ['Better offline support'],
  suggestedMarkets: ['usa', 'india'] as ['usa', 'india'],
};

vi.mock('../src/workers/scraperWorker', () => ({
  detectPlatform: vi.fn(() => 'play_store'),
  scrapePlayStore: vi.fn(async () => mockScraped),
  scrapeAppStore: vi.fn(async () => mockScraped),
  scrapeCompetitors: vi.fn(async () => []),
}));

vi.mock('../src/services/reviewAnalysis', () => ({
  analyseReviews: vi.fn(async () => ({
    sentiment: 'positive',
    painPoints: ['Too much manual work'],
    copySignals: ['get things done'],
    marketingOpportunities: ['Better offline support'],
  })),
}));

vi.mock('../src/services/icpService', () => ({
  buildICPBrief: vi.fn(() => mockICP),
}));

vi.mock('../src/lib/tokens', () => ({
  consumeTokens: vi.fn(async () => undefined),
}));

const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockFrom = vi.fn();

vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: mockFrom,
  }),
}));

import { buildServer } from '../src/server';

describe('Products routes', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();

    const chainable = {
      insert: mockInsert,
      select: mockSelect,
      eq: mockEq,
      single: mockSingle,
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    };

    mockInsert.mockReturnValue({
      select: () => ({
        single: () =>
          Promise.resolve({
            data: { id: PRODUCT_ID, founder_id: FOUNDER_ID, name: 'TestApp', platform: 'play_store' },
            error: null,
          }),
      }),
    });

    mockSelect.mockReturnValue({
      eq: (field: string) => ({
        eq: (field2: string) => ({
          single: () =>
            field === 'id'
              ? Promise.resolve({
                  data: { id: PRODUCT_ID, founder_id: FOUNDER_ID, name: 'TestApp' },
                  error: null,
                })
              : Promise.resolve({ data: null, error: { message: 'not found' } }),
          order: () => Promise.resolve({ data: [{ id: PRODUCT_ID, name: 'TestApp' }], error: null }),
        }),
        single: () =>
          Promise.resolve({ data: { plan: 'free' }, error: null }),
        count: 0,
        head: true,
        order: () => Promise.resolve({ data: [], error: null }),
      }),
    });

    mockEq.mockReturnThis();
    mockSingle.mockResolvedValue({ data: { plan: 'free' }, error: null });

    mockFrom.mockReturnValue({
      insert: mockInsert,
      select: mockSelect,
      eq: mockEq,
      single: mockSingle,
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    });
  });

  describe('POST /products/scrape — no auth', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/products/scrape',
        payload: { url: 'https://play.google.com/store/apps/details?id=com.test.app' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /products/scrape — with auth', () => {
    it('returns 422 for non-store URL', async () => {
      const { detectPlatform } = await import('../src/workers/scraperWorker');
      vi.mocked(detectPlatform).mockReturnValueOnce(null);

      const res = await server.inject({
        method: 'POST',
        url: '/products/scrape',
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: { url: 'https://example.com/not-a-store' },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ error: expect.stringContaining('App Store or Play Store') });
    });

    it('returns scraped data + ICP brief on success', async () => {
      mockFrom.mockReturnValue({
        insert: () => Promise.resolve({ data: {}, error: null }),
        select: mockSelect,
        eq: mockEq,
        single: mockSingle,
      });

      const res = await server.inject({
        method: 'POST',
        url: '/products/scrape',
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: { url: 'https://play.google.com/store/apps/details?id=com.test.app' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ scraped: unknown; icpBrief: unknown; competitors: unknown }>();
      expect(body).toHaveProperty('scraped');
      expect(body).toHaveProperty('icpBrief');
      expect(body).toHaveProperty('competitors');
    });
  });

  describe('GET /products — with auth', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({ method: 'GET', url: '/products' });
      expect(res.statusCode).toBe(401);
    });

    it('returns array for authenticated founder', async () => {
      mockFrom.mockReturnValue({
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: [{ id: PRODUCT_ID, name: 'TestApp' }], error: null }),
          }),
        }),
      });

      const res = await server.inject({
        method: 'GET',
        url: '/products',
        headers: { authorization: `Bearer ${makeToken()}` },
      });

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
    });
  });

  describe('GET /products/:id', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({ method: 'GET', url: `/products/${PRODUCT_ID}` });
      expect(res.statusCode).toBe(401);
    });

    it('returns 400 for invalid UUID', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/products/not-a-uuid',
        headers: { authorization: `Bearer ${makeToken()}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 if product not found for this founder', async () => {
      mockFrom.mockReturnValue({
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: null, error: { message: 'not found' } }),
            }),
          }),
        }),
      });

      const res = await server.inject({
        method: 'GET',
        url: `/products/${PRODUCT_ID}`,
        headers: { authorization: `Bearer ${makeToken()}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns product for the authenticated founder', async () => {
      mockFrom.mockReturnValue({
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({ data: { id: PRODUCT_ID, name: 'TestApp' }, error: null }),
            }),
          }),
        }),
      });

      const res = await server.inject({
        method: 'GET',
        url: `/products/${PRODUCT_ID}`,
        headers: { authorization: `Bearer ${makeToken()}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: PRODUCT_ID });
    });
  });

  describe('POST /products/confirm — plan limits', () => {
    const validBody = {
      url: 'https://play.google.com/store/apps/details?id=com.test.app',
      platform: 'play_store',
      scraped: mockScraped,
      icpBrief: mockICP,
      competitors: [],
    };

    it('returns 422 when free founder already has 1 product', async () => {
      mockFrom.mockReturnValue({
        select: (col: string) => ({
          eq: () => ({
            single: () => Promise.resolve({ data: { plan: 'free' }, error: null }),
            count: undefined,
            head: undefined,
          }),
          count: 'exact',
          head: true,
        }),
        insert: mockInsert,
      });

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            select: () => ({
              eq: () => ({
                single: () => Promise.resolve({ data: { plan: 'free' }, error: null }),
              }),
            }),
          };
        }
        return {
          select: (_col: string, opts: { count: string }) =>
            opts?.count === 'exact'
              ? { eq: () => Promise.resolve({ count: 1, error: null }) }
              : { eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) },
          insert: () => Promise.resolve({ data: null, error: null }),
        };
      });

      const res = await server.inject({
        method: 'POST',
        url: '/products/confirm',
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: validBody,
      });

      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
    });
  });
});
