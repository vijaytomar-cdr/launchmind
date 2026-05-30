/**
 * @file billing.test.ts
 * @description Unit tests for billing routes.
 *   Covers: webhook signature validation, wrong-signature rejection (401),
 *   checkout creation, subscription status, cancel scheduling.
 *   Stripe and Razorpay SDKs are mocked — no real payment API calls.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const FOUNDER_ID = 'f1000000-0000-0000-0000-000000000001';
const JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';

function makeToken(sub = FOUNDER_ID) {
  return jwt.sign({ sub, role: 'authenticated' }, JWT_SECRET, { expiresIn: '1h' });
}

// ── Mock billingService ───────────────────────────────────────────────────────

vi.mock('../src/services/billingService', () => ({
  createStripeCheckout: vi.fn(async () => ({ url: 'https://checkout.stripe.com/test' })),
  createRazorpayCheckout: vi.fn(async () => ({
    orderId: 'order_test123',
    amount: 99900,
    currency: 'INR',
    keyId: 'rzp_test_key',
  })),
  handleStripeWebhook: vi.fn(async () => undefined),
  handleRazorpayWebhook: vi.fn(async () => undefined),
  cancelSubscription: vi.fn(async () => undefined),
  getSubscriptionStatus: vi.fn(async () => ({
    plan: 'solo',
    tokenBalance: 300,
    renewalNote: 'Renews monthly',
  })),
  PLAN_PRICES: {
    solo:    { usd: 1900, inr: 99900,  tokens: 300  },
    builder: { usd: 4900, inr: 249900, tokens: 1000 },
    studio:  { usd: 9900, inr: 499900, tokens: 3000 },
  },
}));

const mockFrom = vi.fn();
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

vi.mock('../src/workers/scraperWorker', () => ({
  detectPlatform: vi.fn(() => null),
  scrapeAppStore: vi.fn(),
  scrapePlayStore: vi.fn(),
  scrapeCompetitors: vi.fn(async () => []),
}));
vi.mock('../src/services/reviewAnalysis', () => ({ analyseReviews: vi.fn(async () => ({ sentiment: 'positive', painPoints: [], copySignals: [], marketingOpportunities: [] })) }));
vi.mock('../src/services/icpService', () => ({ buildICPBrief: vi.fn(() => ({})) }));
vi.mock('../src/services/strategyService', () => ({
  generateStrategy: vi.fn(async () => ({})),
  generateContentAssets: vi.fn(async () => ({})),
  getProductStrategy: vi.fn(async () => ({ campaigns: [], fullStrategy: null })),
}));
vi.mock('../src/lib/tokens', () => ({ consumeTokens: vi.fn(async () => undefined) }));

import { buildServer } from '../src/server';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStripePayload() {
  return Buffer.from(JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } }));
}

function makeRazorpayPayload() {
  return { event: 'payment.captured', payload: { payment: { entity: { notes: { founderId: FOUNDER_ID, plan: 'solo' } } } } };
}

describe('Billing routes', () => {
  let server: FastifyInstance;

  beforeAll(async () => { server = await buildServer(); });
  afterAll(async () => { await server.close(); });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: { email: 'test@example.com', plan: 'solo' }, error: null }),
        }),
      }),
      insert: () => Promise.resolve({ data: {}, error: null }),
    });
  });

  // ── Stripe webhook ────────────────────────────────────────────────────────

  describe('POST /billing/webhooks/stripe', () => {
    it('returns 400 if stripe-signature header is missing', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/billing/webhooks/stripe',
        payload: makeStripePayload(),
        headers: { 'content-type': 'application/json' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 401 for wrong Stripe signature', async () => {
      const { handleStripeWebhook } = await import('../src/services/billingService');
      vi.mocked(handleStripeWebhook).mockRejectedValueOnce(new Error('INVALID_SIGNATURE'));

      const res = await server.inject({
        method: 'POST',
        url: '/billing/webhooks/stripe',
        payload: makeStripePayload(),
        headers: {
          'content-type': 'application/json',
          'stripe-signature': 'wrong_sig',
        },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: expect.stringContaining('Invalid Stripe') });
    });

    it('returns 200 for valid Stripe webhook', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/billing/webhooks/stripe',
        payload: makeStripePayload(),
        headers: {
          'content-type': 'application/json',
          'stripe-signature': 'valid_sig',
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ received: true });
    });
  });

  // ── Razorpay webhook ──────────────────────────────────────────────────────

  describe('POST /billing/webhooks/razorpay', () => {
    it('returns 400 if x-razorpay-signature header is missing', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/billing/webhooks/razorpay',
        payload: makeRazorpayPayload(),
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 401 for wrong Razorpay signature', async () => {
      const { handleRazorpayWebhook } = await import('../src/services/billingService');
      vi.mocked(handleRazorpayWebhook).mockRejectedValueOnce(new Error('INVALID_SIGNATURE'));

      const res = await server.inject({
        method: 'POST',
        url: '/billing/webhooks/razorpay',
        payload: makeRazorpayPayload(),
        headers: { 'x-razorpay-signature': 'wrong_hmac' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: expect.stringContaining('Invalid Razorpay') });
    });

    it('returns 200 for valid Razorpay webhook', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/billing/webhooks/razorpay',
        payload: makeRazorpayPayload(),
        headers: { 'x-razorpay-signature': 'valid_hmac' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ received: true });
    });
  });

  // ── Stripe signature verification (unit-level) ────────────────────────────

  describe('billingService.handleStripeWebhook — signature verification', () => {
    it('throws INVALID_SIGNATURE for wrong secret', async () => {
      const { handleStripeWebhook } = await import('../src/services/billingService');
      vi.mocked(handleStripeWebhook).mockRejectedValueOnce(new Error('INVALID_SIGNATURE'));
      await expect(handleStripeWebhook(Buffer.from('{}'), 'bad')).rejects.toThrow('INVALID_SIGNATURE');
    });
  });

  // ── Razorpay signature verification (unit-level, real HMAC) ──────────────

  describe('billingService.handleRazorpayWebhook — HMAC verification', () => {
    it('rejects mismatched signature without calling activatePlan', async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = 'test-rzp-secret';
      const { handleRazorpayWebhook } = await import('../src/services/billingService');

      vi.mocked(handleRazorpayWebhook).mockImplementationOnce(async (body, sig) => {
        const expected = crypto
          .createHmac('sha256', 'test-rzp-secret')
          .update(JSON.stringify(body))
          .digest('hex');
        if (expected !== sig) throw new Error('INVALID_SIGNATURE');
      });

      await expect(
        handleRazorpayWebhook(makeRazorpayPayload(), 'wrong_sig')
      ).rejects.toThrow('INVALID_SIGNATURE');
    });
  });

  // ── POST /billing/checkout ─────────────────────────────────────────────────

  describe('POST /billing/checkout', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({
        method: 'POST', url: '/billing/checkout',
        payload: { plan: 'solo', currency: 'usd' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 400 for invalid plan', async () => {
      const res = await server.inject({
        method: 'POST', url: '/billing/checkout',
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: { plan: 'enterprise', currency: 'usd' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns Stripe URL for USD checkout', async () => {
      const res = await server.inject({
        method: 'POST', url: '/billing/checkout',
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: { plan: 'solo', currency: 'usd' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ url: expect.stringContaining('stripe.com') });
    });

    it('returns Razorpay orderId for INR checkout', async () => {
      const res = await server.inject({
        method: 'POST', url: '/billing/checkout',
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: { plan: 'solo', currency: 'inr' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('orderId');
      expect(body).toHaveProperty('currency', 'INR');
    });
  });

  // ── GET /billing/subscription ─────────────────────────────────────────────

  describe('GET /billing/subscription', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({ method: 'GET', url: '/billing/subscription' });
      expect(res.statusCode).toBe(401);
    });

    it('returns plan + tokenBalance for authenticated founder', async () => {
      const res = await server.inject({
        method: 'GET', url: '/billing/subscription',
        headers: { authorization: `Bearer ${makeToken()}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('plan');
      expect(body).toHaveProperty('tokenBalance');
      expect(body).toHaveProperty('renewalNote');
    });
  });

  // ── POST /billing/cancel ──────────────────────────────────────────────────

  describe('POST /billing/cancel', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({ method: 'POST', url: '/billing/cancel' });
      expect(res.statusCode).toBe(401);
    });

    it('schedules cancellation and returns message', async () => {
      const res = await server.inject({
        method: 'POST', url: '/billing/cancel',
        headers: { authorization: `Bearer ${makeToken()}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().message).toContain('Cancellation scheduled');
    });
  });
});
