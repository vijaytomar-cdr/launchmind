/**
 * @file waitlist.test.ts
 * @description Unit tests for Week 8: waitlist routes, errorCodes, health/detailed.
 *   Covers:
 *     - errorBody() returns correct shape with code field
 *     - POST /waitlist with invalid email → 400 + INVALID_BODY code
 *     - POST /waitlist with valid email → 201 + message
 *     - POST /waitlist with duplicate email → 409 + ALREADY_ON_WAITLIST code
 *     - GET /waitlist/count → 200 + count field
 *     - GET /health → 200 (basic check)
 *     - GET /health/detailed → 200 or 503 with status + checks shape
 *     - POST /waitlist email is normalised to lowercase
 *     - POST /waitlist with name and source → 201
 *     - GET /waitlist/count returns numeric count
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { errorBody, ErrorCodes } from '../src/lib/errorCodes';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../src/lib/scheduler', () => ({
  triggerBriefNow: vi.fn(async () => ({ jobId: 'test-job-id' })),
  scheduleWeeklyBrief: vi.fn(async () => undefined),
  getBriefQueue: vi.fn(() => ({ client: Promise.resolve(true) })),
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

// Supabase mock — simulates waitlist insert + count
let emailStore: Set<string> = new Set();

const mockWaitlistFrom = vi.fn((table: string) => {
  if (table === 'waitlist') {
    return {
      insert: vi.fn((row: { email: string }) => {
        if (emailStore.has(row.email)) {
          return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate' } });
        }
        emailStore.add(row.email);
        return Promise.resolve({ data: { id: 'uuid-1', ...row }, error: null });
      }),
      select: vi.fn(() => ({
        count: emailStore.size,
        error: null,
      })),
    };
  }
  // For health/detailed Supabase probe
  return {
    select: vi.fn(() => Promise.resolve({ count: 0, error: null })),
  };
});

vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({ from: mockWaitlistFrom }),
}));

import { buildServer } from '../src/server';

// ══════════════════════════════════════════════════════════════════════════════
//  errorCodes unit tests
// ══════════════════════════════════════════════════════════════════════════════

describe('errorCodes — errorBody()', () => {
  it('returns object with error, code fields', () => {
    const body = errorBody(ErrorCodes.UNAUTHORIZED, 'Not authorised');
    expect(body).toMatchObject({ error: 'Not authorised', code: 'UNAUTHORIZED' });
    expect(body).not.toHaveProperty('detail');
  });

  it('includes detail when provided', () => {
    const body = errorBody(ErrorCodes.INVALID_BODY, 'Bad input', 'email is required');
    expect(body).toMatchObject({ code: 'INVALID_BODY', detail: 'email is required' });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  Waitlist routes
// ══════════════════════════════════════════════════════════════════════════════

describe('Waitlist routes', () => {
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
    emailStore = new Set();
    vi.clearAllMocks();
    mockWaitlistFrom.mockImplementation((table: string) => {
      if (table === 'waitlist') {
        return {
          insert: vi.fn((row: { email: string }) => {
            if (emailStore.has(row.email)) {
              return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate' } });
            }
            emailStore.add(row.email);
            return Promise.resolve({ data: { id: 'uuid-1', ...row }, error: null });
          }),
          select: vi.fn(() => ({
            count: emailStore.size,
            error: null,
          })),
        };
      }
      return {
        select: vi.fn(() => Promise.resolve({ count: 0, error: null })),
      };
    });
  });

  it('POST /waitlist with invalid email → 400 + INVALID_BODY', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/waitlist',
      payload: { email: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe(ErrorCodes.INVALID_BODY);
  });

  it('POST /waitlist with valid email → 201 + message', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/waitlist',
      payload: { email: 'founder@example.com' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ message: string }>();
    expect(body.message).toContain("You're on the list");
  });

  it('POST /waitlist email is normalised to lowercase', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/waitlist',
      payload: { email: 'Founder@Example.COM' },
    });
    expect(res.statusCode).toBe(201);
    // Second call with same email (lowercase) → 409
    const res2 = await server.inject({
      method: 'POST',
      url: '/waitlist',
      payload: { email: 'founder@example.com' },
    });
    expect(res2.statusCode).toBe(409);
  });

  it('POST /waitlist with duplicate email → 409 + ALREADY_ON_WAITLIST', async () => {
    await server.inject({
      method: 'POST',
      url: '/waitlist',
      payload: { email: 'dupe@example.com' },
    });
    const res = await server.inject({
      method: 'POST',
      url: '/waitlist',
      payload: { email: 'dupe@example.com' },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe(ErrorCodes.ALREADY_ON_WAITLIST);
  });

  it('POST /waitlist with name and source → 201', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/waitlist',
      payload: { email: 'named@example.com', name: 'Jane Founder', source: 'twitter' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('GET /waitlist/count → 200 + count field', async () => {
    const res = await server.inject({ method: 'GET', url: '/waitlist/count' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ count: number }>();
    expect(typeof body.count).toBe('number');
    expect(body.count).toBeGreaterThanOrEqual(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  Health routes
// ══════════════════════════════════════════════════════════════════════════════

describe('Health routes', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    process.env.ADMIN_SECRET = 'test-admin-secret-min-32-characters-long!!';
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
    delete process.env.ADMIN_SECRET;
  });

  it('GET /health → 200 with status and timestamp', async () => {
    const res = await server.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string; timestamp: string }>();
    expect(body.status).toBe('ok');
    expect(typeof body.timestamp).toBe('string');
  });

  it('GET /health/detailed → 200 or 503 with status + checks shape', async () => {
    const res = await server.inject({ method: 'GET', url: '/health/detailed' });
    expect([200, 503]).toContain(res.statusCode);
    const body = res.json<{ status: string; checks: Record<string, string>; timestamp: string }>();
    expect(['ok', 'degraded']).toContain(body.status);
    expect(typeof body.checks).toBe('object');
    expect(typeof body.timestamp).toBe('string');
  });
});
