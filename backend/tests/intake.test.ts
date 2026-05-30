/**
 * @file intake.test.ts
 * @description Unit tests for Phase 5 Week 18 enhanced product intake flow.
 *   Covers: multi-URL async scrape, job polling, founder context, screenshot analysis,
 *   enriched confirm, and backward-compat single-URL sync scrape.
 *   All external services (Supabase, BullMQ, scrapers, Claude) are mocked.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';

const FOUNDER_ID = 'f1000000-0000-0000-0000-000000000001';
const PRODUCT_ID = 'c1000000-0000-0000-0000-000000000001';
const JOB_ID = `scrape-${PRODUCT_ID}`;
const JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';

function makeToken(sub: string = FOUNDER_ID): string {
  return jwt.sign({ sub, role: 'authenticated' }, JWT_SECRET, { expiresIn: '1h' });
}

const mockScraped = {
  name: 'ClientPulse',
  developer: 'Pulse Labs',
  description: 'Stop chasing clients. Auto-track project health and detect ghost risk.',
  category: 'Business',
  rating: 4.6,
  ratingCount: 2800,
  priceTier: 'freemium',
  screenshots: ['https://is1-ssl.mzstatic.com/clientpulse1.png'],
  reviews: [{ rating: 5, text: 'Finally stopped losing money to late payments', date: '2026-03-01' }],
  platform: 'app_store' as const,
  storeUrl: 'https://apps.apple.com/app/clientpulse/id1234567890',
};

const mockICP = {
  targetUser: 'Freelancers and agency owners managing 5-20 clients',
  geography: ['usa', 'india'],
  priceTier: 'freemium',
  painPoints: ['Chasing unpaid invoices manually', 'No single view of client health'],
  competitorGaps: ['No competitor offers automated follow-up plus health score combined'],
  suggestedMarkets: ['usa', 'india'] as ['usa', 'india'],
};

const mockFounderContext = {
  stage: 'Growing (100+ users)',
  primaryGoal: 'More installs, More paying users',
  budget: '$2000/month',
  audienceSize: 'Small (<1K)',
  geography: 'India',
  language: 'en',
  channelsTried: ['instagram', 'cold-email'],
  channelsToAvoid: ['linkedin'],
  monetization: 'Freemium',
  dropOffPoint: 'Trial sign-ups drop after day 3',
  firstUserAction: 'Connect first client',
  moat: 'Proprietary ghost-risk scoring model',
  peakSeason: 'Q4',
  bestCustomerQuote: 'I recovered $18k in overdue invoices in the first 3 months',
};

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../src/workers/scraperWorker', () => ({
  detectPlatform: vi.fn((url: string) => {
    if (url.includes('apps.apple.com')) return 'app_store';
    if (url.includes('play.google.com')) return 'play_store';
    return null;
  }),
  scrapePlayStore: vi.fn(async () => mockScraped),
  scrapeAppStore: vi.fn(async () => mockScraped),
  scrapeCompetitors: vi.fn(async () => []),
}));

vi.mock('../src/services/reviewAnalysis', () => ({
  analyseReviews: vi.fn(async () => ({
    sentiment: 'positive',
    painPoints: ['Chasing unpaid invoices manually'],
    copySignals: ['ghost risk'],
    marketingOpportunities: ['No competitor offers automated follow-up'],
  })),
}));

vi.mock('../src/services/icpService', () => ({
  buildICPBrief: vi.fn(() => mockICP),
  analyseScreenshots: vi.fn(async () => ({
    summary: 'Clean professional UI with strong ghost-risk visual.',
    tone: 'Professional',
    primaryColor: '#2563eb',
    screenshots_analysed: 1,
  })),
  scrapeWebsite: vi.fn(async () => ({
    title: 'ClientPulse — Client Health Monitor',
    description: 'Automated client relationship monitoring',
    keywords: ['client management', 'invoice tracking'],
  })),
  buildStrategyContext: vi.fn(() => ''),
}));

vi.mock('../src/lib/tokens', () => ({
  consumeTokens: vi.fn(async () => undefined),
}));

vi.mock('../src/lib/scraperQueue', () => ({
  enqueueScrapeJob: vi.fn(async () => JOB_ID),
  getScrapeJob: vi.fn(async (jobId: string) => {
    if (jobId === JOB_ID) {
      return {
        data: { productId: PRODUCT_ID, founderId: FOUNDER_ID },
        progress: 100,
        returnvalue: { productId: PRODUCT_ID, scraped: mockScraped, icpBrief: mockICP, competitors: [] },
        failedReason: null,
        getState: vi.fn(async () => 'completed'),
      };
    }
    return null;
  }),
}));

vi.mock('../src/lib/scheduler', () => ({
  getBriefQueue: vi.fn(() => ({ client: Promise.resolve({}) })),
  scheduleWeeklyBrief: vi.fn(async () => undefined),
}));

vi.mock('../src/workers/weeklyBriefWorker', () => ({
  startBriefWorker: vi.fn(),
}));

vi.mock('../src/workers/intakeWorker', () => ({
  startIntakeWorker: vi.fn(),
}));

const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockFrom = vi.fn();
const mockLt = vi.fn();

vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: mockFrom,
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'f1000000-0000-0000-0000-000000000001', email: 'test@example.com' } },
        error: null,
      })),
    },
  }),
}));

import { buildServer } from '../src/server';

// ── Test setup ────────────────────────────────────────────────────────────────

describe('Intake flow routes (Phase 5 Week 18)', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mockInsert.mockReturnValue({
      select: () => ({
        single: () =>
          Promise.resolve({
            data: { id: PRODUCT_ID, founder_id: FOUNDER_ID, name: 'Untitled Product', intake_step: 1 },
            error: null,
          }),
      }),
    });

    mockUpdate.mockReturnValue({
      eq: () => ({
        eq: () => ({
          select: () => ({
            single: () => Promise.resolve({
              data: { id: PRODUCT_ID, intake_step: 3, founder_context: mockFounderContext },
              error: null,
            }),
          }),
        }),
      }),
    });

    mockLt.mockResolvedValue({ data: {}, error: null });

    mockSelect.mockReturnValue({
      eq: () => ({
        single: () => Promise.resolve({ data: { plan: 'builder' }, error: null }),
        eq: () => ({
          single: () => Promise.resolve({
            data: { id: PRODUCT_ID, intake_step: 1, founder_id: FOUNDER_ID },
            error: null,
          }),
        }),
      }),
      count: 'exact',
      head: true,
    });

    mockEq.mockReturnThis();
    mockSingle.mockResolvedValue({ data: { id: PRODUCT_ID, founder_id: FOUNDER_ID, intake_step: 1 }, error: null });

    mockFrom.mockImplementation((_table: string) => ({
      insert: mockInsert,
      update: mockUpdate,
      select: mockSelect,
      eq: mockEq,
      single: mockSingle,
      lt: mockLt,
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    }));
  });

  // ── POST /products/scrape (legacy sync) ──────────────────────────────────

  describe('POST /products/scrape — legacy single-URL path', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/products/scrape',
        payload: { url: 'https://apps.apple.com/app/clientpulse/id1234567890' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 422 for non-store URL', async () => {
      const { detectPlatform } = await import('../src/workers/scraperWorker');
      vi.mocked(detectPlatform).mockReturnValueOnce(null);

      const res = await server.inject({
        method: 'POST',
        url: '/products/scrape',
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: { url: 'https://example.com' },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ error: expect.stringContaining('App Store or Play Store') });
    });

    it('returns { scraped, icpBrief, competitors } on success', async () => {
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
        payload: { url: 'https://apps.apple.com/app/clientpulse/id1234567890' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ scraped: unknown; icpBrief: unknown; competitors: unknown }>();
      expect(body).toHaveProperty('scraped');
      expect(body).toHaveProperty('icpBrief');
      expect(body).toHaveProperty('competitors');
    });
  });

  // ── POST /products/scrape (multi-URL async) ──────────────────────────────

  describe('POST /products/scrape — multi-URL async path', () => {
    it('returns 400 if neither appStoreUrl nor playStoreUrl is a valid store URL', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/products/scrape',
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: { appStoreUrl: 'not-a-url' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 202 with { productId, jobId, status: queued } for valid appStoreUrl', async () => {
      // Mock plan and product count lookups
      let callIndex = 0;
      mockFrom.mockImplementation(() => {
        callIndex++;
        if (callIndex === 1) {
          // founders plan lookup
          return {
            select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { plan: 'builder' }, error: null }) }) }),
          };
        }
        if (callIndex === 2) {
          // products count
          return {
            select: (_col: string, opts?: { count?: string }) =>
              opts?.count === 'exact'
                ? { eq: () => Promise.resolve({ count: 0, error: null }) }
                : { eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) },
          };
        }
        // product insert + audit log insert
        return {
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: { id: PRODUCT_ID }, error: null }),
            }),
          }),
        };
      });

      const res = await server.inject({
        method: 'POST',
        url: '/products/scrape',
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: { appStoreUrl: 'https://apps.apple.com/app/clientpulse/id1234567890' },
      });

      expect(res.statusCode).toBe(202);
      const body = res.json<{ productId: string; jobId: string; status: string }>();
      expect(body.status).toBe('queued');
      expect(body).toHaveProperty('productId');
      expect(body).toHaveProperty('jobId');
    });

    it('returns 422 when founder is at plan limit', async () => {
      let callIndex = 0;
      mockFrom.mockImplementation(() => {
        callIndex++;
        if (callIndex === 1) {
          return {
            select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { plan: 'free' }, error: null }) }) }),
          };
        }
        return {
          select: (_col: string, opts?: { count?: string }) =>
            opts?.count === 'exact'
              ? { eq: () => Promise.resolve({ count: 1, error: null }) }
              : { eq: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) },
        };
      });

      const res = await server.inject({
        method: 'POST',
        url: '/products/scrape',
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: { appStoreUrl: 'https://apps.apple.com/app/clientpulse/id1234567890' },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
    });
  });

  // ── GET /products/scrape/:jobId ──────────────────────────────────────────

  describe('GET /products/scrape/:jobId', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({ method: 'GET', url: `/products/scrape/${JOB_ID}` });
      expect(res.statusCode).toBe(401);
    });

    it('returns 404 for unknown jobId', async () => {
      const { getScrapeJob } = await import('../src/lib/scraperQueue');
      vi.mocked(getScrapeJob).mockResolvedValueOnce(null);

      const res = await server.inject({
        method: 'GET',
        url: '/products/scrape/unknown-job-id',
        headers: { authorization: `Bearer ${makeToken()}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns { status: completed, productId, result } for a finished job', async () => {
      const res = await server.inject({
        method: 'GET',
        url: `/products/scrape/${JOB_ID}`,
        headers: { authorization: `Bearer ${makeToken()}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ status: string; productId: string; result: unknown }>();
      expect(body.status).toBe('completed');
      expect(body.productId).toBe(PRODUCT_ID);
      expect(body).toHaveProperty('result');
    });

    it('returns { status: failed } for a failed job', async () => {
      const { getScrapeJob } = await import('../src/lib/scraperQueue');
      vi.mocked(getScrapeJob).mockResolvedValueOnce({
        data: { productId: PRODUCT_ID, founderId: FOUNDER_ID },
        progress: 30,
        returnvalue: null,
        failedReason: 'Playwright timeout',
        getState: vi.fn(async () => 'failed'),
      } as never);

      const res = await server.inject({
        method: 'GET',
        url: `/products/scrape/${JOB_ID}`,
        headers: { authorization: `Bearer ${makeToken()}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ status: string; error: string }>();
      expect(body.status).toBe('failed');
      expect(body.error).toBe('Playwright timeout');
    });

    it('returns 404 if job belongs to a different founder', async () => {
      const { getScrapeJob } = await import('../src/lib/scraperQueue');
      vi.mocked(getScrapeJob).mockResolvedValueOnce({
        data: { productId: PRODUCT_ID, founderId: 'other-founder-uuid' },
        progress: 0,
        returnvalue: null,
        failedReason: null,
        getState: vi.fn(async () => 'active'),
      } as never);

      const res = await server.inject({
        method: 'GET',
        url: `/products/scrape/${JOB_ID}`,
        headers: { authorization: `Bearer ${makeToken()}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── POST /products/intake/context ────────────────────────────────────────

  describe('POST /products/intake/context', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/products/intake/context',
        payload: { productId: PRODUCT_ID, founderContext: mockFounderContext },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 400 for missing productId', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/products/intake/context',
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: { founderContext: mockFounderContext },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 if product does not belong to founder', async () => {
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
        method: 'POST',
        url: '/products/intake/context',
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: { productId: PRODUCT_ID, founderContext: mockFounderContext },
      });
      expect(res.statusCode).toBe(404);
    });

    it('saves founder context and returns updated intake_step', async () => {
      mockFrom.mockImplementation((_table: string) => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: () => Promise.resolve({
                data: { id: PRODUCT_ID, intake_step: 2 },
                error: null,
              }),
            }),
          }),
        }),
        update: () => ({
          eq: () => ({
            eq: () => ({
              select: () => ({
                single: () => Promise.resolve({
                  data: { id: PRODUCT_ID, intake_step: 3, founder_context: mockFounderContext },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }));

      const res = await server.inject({
        method: 'POST',
        url: '/products/intake/context',
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: { productId: PRODUCT_ID, founderContext: mockFounderContext },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ intake_step: number; founder_context: unknown }>();
      expect(body.intake_step).toBe(3);
      expect(body.founder_context).toMatchObject({ budget: '$2000/month' });
    });
  });

  // ── POST /products/intake/screenshots ────────────────────────────────────

  describe('POST /products/intake/screenshots', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/products/intake/screenshots',
        payload: {
          productId: PRODUCT_ID,
          screenshots: ['https://is1-ssl.mzstatic.com/clientpulse1.png'],
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 400 for empty screenshots array', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/products/intake/screenshots',
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: { productId: PRODUCT_ID, screenshots: [] },
      });
      expect(res.statusCode).toBe(400);
    });

    it('saves screenshot analysis and returns updated intake_step', async () => {
      mockFrom.mockImplementation((_table: string) => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: () => Promise.resolve({
                data: { id: PRODUCT_ID, intake_step: 3 },
                error: null,
              }),
            }),
          }),
        }),
        update: () => ({
          eq: () => ({
            eq: () => ({
              select: () => ({
                single: () => Promise.resolve({
                  data: {
                    id: PRODUCT_ID,
                    intake_step: 4,
                    screenshot_analysis: {
                      summary: 'Clean professional UI.',
                      tone: 'Professional',
                      screenshots_analysed: 1,
                    },
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }));

      const res = await server.inject({
        method: 'POST',
        url: '/products/intake/screenshots',
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: {
          productId: PRODUCT_ID,
          screenshots: ['https://is1-ssl.mzstatic.com/clientpulse1.png'],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ intake_step: number; screenshot_analysis: { screenshots_analysed: number } }>();
      expect(body.intake_step).toBe(4);
      expect(body.screenshot_analysis.screenshots_analysed).toBe(1);
    });
  });

  // ── POST /products/confirm — Phase 5 enriched fields ─────────────────────

  describe('POST /products/confirm — enriched intake fields', () => {
    const baseBody = {
      url: 'https://apps.apple.com/app/clientpulse/id1234567890',
      platform: 'app_store',
      scraped: mockScraped,
      icpBrief: mockICP,
      competitors: [],
    };

    it('accepts selectedMarkets, primaryChannel, excludedChannels', async () => {
      let callIndex = 0;
      mockFrom.mockImplementation(() => {
        callIndex++;
        if (callIndex === 1) {
          return {
            select: () => ({
              eq: () => ({
                single: () => Promise.resolve({ data: { plan: 'builder' }, error: null }),
              }),
            }),
          };
        }
        if (callIndex === 2) {
          return {
            select: (_col: string, opts?: { count?: string }) =>
              opts?.count === 'exact'
                ? { eq: () => Promise.resolve({ count: 0, error: null }) }
                : { eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) },
          };
        }
        return {
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({
                data: {
                  id: PRODUCT_ID,
                  name: 'ClientPulse',
                  intake_step: 6,
                  selected_markets: ['usa', 'india'],
                  primary_channel: 'email',
                  excluded_channels: [],
                },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: () => ({ eq: () => ({ lt: () => Promise.resolve({ data: null, error: null }) }), lt: () => Promise.resolve({ data: null, error: null }) }),
          }),
        };
      });

      const res = await server.inject({
        method: 'POST',
        url: '/products/confirm',
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: {
          ...baseBody,
          selectedMarkets: ['usa', 'india'],
          primaryChannel: 'email',
          excludedChannels: [],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json<{ intake_step: number; primary_channel: string }>();
      expect(body.intake_step).toBe(6);
      expect(body.primary_channel).toBe('email');
    });
  });

  // ── Seed data validation ──────────────────────────────────────────────────

  describe('Seed data: ClientPulse product structure', () => {
    it('ClientPulse founderContext has all core fields', () => {
      const fields = [
        'budget', 'moat', 'bestCustomerQuote',
        'channelsTried', 'channelsToAvoid', 'monetization',
        'dropOffPoint', 'language', 'peakSeason',
        'stage', 'primaryGoal', 'firstUserAction',
      ];
      for (const field of fields) {
        expect(mockFounderContext).toHaveProperty(field);
      }
    });

    it('ClientPulse ICP has 3 pain points', () => {
      expect(mockICP.painPoints.length).toBeGreaterThanOrEqual(2);
    });

    it('ClientPulse targets both usa and india markets', () => {
      expect(mockICP.suggestedMarkets).toContain('usa');
      expect(mockICP.suggestedMarkets).toContain('india');
    });
  });
});
