/**
 * @file brief.test.ts
 * @description Unit tests for Week 6: anonymizationService, briefService, admin routes.
 *   Covers:
 *     - anonymize() strips PII fields and keeps only allowlisted fields
 *     - auditForPII() throws PIIDetectedError on PII field names
 *     - auditForPII() throws PIIDetectedError on UUID/email/URL values
 *     - auditForPII() passes for clean aggregate data
 *     - anonymizeAndAudit() pipeline
 *     - POST /admin/trigger-brief — missing secret → 401
 *     - POST /admin/trigger-brief — wrong secret → 401
 *     - POST /admin/trigger-brief — bad body → 400
 *     - POST /admin/trigger-brief — valid secret + body → 200 with jobId
 *     - POST /admin/schedule-brief — valid secret → 200
 *     - GET /admin/health — valid secret → 200
 *     - GET /admin/health — no secret → 401
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { anonymize, auditForPII, anonymizeAndAudit, PIIDetectedError } from '../src/services/anonymizationService';

const ADMIN_SECRET = 'test-admin-secret-min-32-characters-long!!';
const PRODUCT_ID = 'ba000000-0000-0000-0000-000000000001';
const FOUNDER_ID = 'ba100000-0000-0000-0000-000000000001';
const JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';

function makeToken(sub = FOUNDER_ID) {
  return jwt.sign({ sub, role: 'authenticated' }, JWT_SECRET, { expiresIn: '1h' });
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../src/lib/scheduler', () => ({
  triggerBriefNow: vi.fn(async () => ({ jobId: 'test-job-id-123' })),
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

vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({ from: vi.fn() }),
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
vi.mock('../src/services/billingService', () => ({
  createStripeCheckout: vi.fn(async () => ({ url: 'https://checkout.stripe.com/test' })),
  createRazorpayCheckout: vi.fn(async () => ({ orderId: 'order_test', amount: 99900, currency: 'INR', keyId: 'rzp_test' })),
  handleStripeWebhook: vi.fn(async () => undefined),
  handleRazorpayWebhook: vi.fn(async () => undefined),
  cancelSubscription: vi.fn(async () => undefined),
  getSubscriptionStatus: vi.fn(async () => ({ plan: 'solo', tokenBalance: 300, renewalNote: 'Renews monthly' })),
}));

import { buildServer } from '../src/server';

// ══════════════════════════════════════════════════════════════════════════════
//  anonymizationService tests
// ══════════════════════════════════════════════════════════════════════════════

describe('anonymizationService — anonymize()', () => {
  it('keeps only allowlisted fields', () => {
    const raw = {
      category: 'Productivity',
      market: 'usa',
      channel: 'meta',
      hook_type: 'pain_first',
      founder_id: 'some-uuid',
      product_id: 'another-uuid',
      email: 'user@example.com',
      store_url: 'https://apps.apple.com/app/foo/id123',
    };
    const safe = anonymize(raw);
    expect(safe).toEqual({ category: 'Productivity', market: 'usa', channel: 'meta', hook_type: 'pain_first' });
    expect(safe).not.toHaveProperty('founder_id');
    expect(safe).not.toHaveProperty('product_id');
    expect(safe).not.toHaveProperty('email');
    expect(safe).not.toHaveProperty('store_url');
  });

  it('returns empty object when all fields are PII', () => {
    const safe = anonymize({ founder_id: 'abc', email: 'x@y.com', ip: '1.2.3.4' });
    expect(safe).toEqual({});
  });

  it('keeps numeric aggregate fields', () => {
    const safe = anonymize({
      install_delta_pct: 12.5,
      conversion_rate: 0.032,
      retention_d7: 0.45,
      week_number: 20,
      founder_id: 'strip-this',
    });
    expect(safe).toMatchObject({
      install_delta_pct: 12.5,
      conversion_rate: 0.032,
      retention_d7: 0.45,
      week_number: 20,
    });
    expect(safe).not.toHaveProperty('founder_id');
  });
});

describe('anonymizationService — auditForPII()', () => {
  it('passes for clean aggregate data', () => {
    expect(() =>
      auditForPII({ category: 'Productivity', market: 'india', channel: 'whatsapp', hook_type: 'pain_first', install_delta_pct: 5.2, week_number: 20 })
    ).not.toThrow();
  });

  it('throws PIIDetectedError on founder_id field name', () => {
    expect(() =>
      auditForPII({ founder_id: 'some-uuid', category: 'Productivity' })
    ).toThrow(PIIDetectedError);
  });

  it('throws PIIDetectedError on email field name', () => {
    expect(() =>
      auditForPII({ email: 'user@example.com', category: 'Productivity' })
    ).toThrow(PIIDetectedError);
  });

  it('throws PIIDetectedError on UUID value in allowed field', () => {
    // category is an allowed field but a UUID value is suspicious
    expect(() =>
      auditForPII({ category: '11110000-0000-0000-0000-000000000001' })
    ).toThrow(PIIDetectedError);
  });

  it('throws PIIDetectedError on email value', () => {
    expect(() =>
      auditForPII({ category: 'user@example.com' })
    ).toThrow(PIIDetectedError);
  });

  it('throws PIIDetectedError on URL value (store URL)', () => {
    expect(() =>
      auditForPII({ category: 'https://apps.apple.com/app/foo/id123' })
    ).toThrow(PIIDetectedError);
  });

  it('throws PIIDetectedError on non-allowlisted field name', () => {
    expect(() =>
      auditForPII({ randomCustomField: 'Productivity' })
    ).toThrow(PIIDetectedError);
  });
});

describe('anonymizationService — anonymizeAndAudit()', () => {
  it('returns safe record for clean raw data', () => {
    const result = anonymizeAndAudit({
      category: 'Productivity',
      market: 'usa',
      channel: 'meta',
      hook_type: 'pain_first',
      founder_id: 'strip-me',
      email: 'strip@me.com',
      install_delta_pct: 8.0,
    });
    expect(result).toMatchObject({ category: 'Productivity', market: 'usa', channel: 'meta' });
    expect(result).not.toHaveProperty('founder_id');
    expect(result).not.toHaveProperty('email');
  });

  it('throws if anonymized result still contains PII', () => {
    // Simulate a case where the allowlist itself has a UUID value (shouldn't happen normally)
    expect(() =>
      auditForPII({ category: '11110000-0000-0000-0000-000000000001' })
    ).toThrow(PIIDetectedError);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  Admin routes tests
// ══════════════════════════════════════════════════════════════════════════════

describe('Admin routes', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    process.env.ADMIN_SECRET = ADMIN_SECRET;
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
    delete process.env.ADMIN_SECRET;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Auth gate ───────────────────────────────────────────────────────────────

  it('POST /admin/trigger-brief without X-Admin-Secret → 401', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/admin/trigger-brief',
      payload: { productId: PRODUCT_ID, founderId: FOUNDER_ID },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /admin/trigger-brief with wrong secret → 401', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/admin/trigger-brief',
      headers: { 'x-admin-secret': 'wrong-secret' },
      payload: { productId: PRODUCT_ID, founderId: FOUNDER_ID },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'Invalid admin secret' });
  });

  it('GET /admin/health without X-Admin-Secret → 401', async () => {
    const res = await server.inject({ method: 'GET', url: '/admin/health' });
    expect(res.statusCode).toBe(401);
  });

  // ── Valid secret ────────────────────────────────────────────────────────────

  it('GET /admin/health with correct secret → 200', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/admin/health',
      headers: { 'x-admin-secret': ADMIN_SECRET },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  it('POST /admin/trigger-brief with invalid body → 400', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/admin/trigger-brief',
      headers: { 'x-admin-secret': ADMIN_SECRET },
      payload: { productId: 'not-a-uuid', founderId: FOUNDER_ID },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /admin/trigger-brief with valid secret + body → 200 + jobId', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/admin/trigger-brief',
      headers: { 'x-admin-secret': ADMIN_SECRET },
      payload: { productId: PRODUCT_ID, founderId: FOUNDER_ID },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ jobId: string; queued: boolean }>();
    expect(body.queued).toBe(true);
    expect(body.jobId).toBe('test-job-id-123');
  });

  it('POST /admin/schedule-brief with valid secret → 200', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/admin/schedule-brief',
      headers: { 'x-admin-secret': ADMIN_SECRET },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ scheduled: boolean; cron: string }>();
    expect(body.scheduled).toBe(true);
    expect(body.cron).toContain('0 17 * * 0');
  });

  // ── Unconfigured admin secret ───────────────────────────────────────────────

  it('POST /admin/trigger-brief when ADMIN_SECRET not set → 503', async () => {
    const original = process.env.ADMIN_SECRET;
    delete process.env.ADMIN_SECRET;
    const res = await server.inject({
      method: 'POST',
      url: '/admin/trigger-brief',
      headers: { 'x-admin-secret': ADMIN_SECRET },
      payload: { productId: PRODUCT_ID, founderId: FOUNDER_ID },
    });
    expect(res.statusCode).toBe(503);
    process.env.ADMIN_SECRET = original;
  });
});
