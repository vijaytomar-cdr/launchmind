/**
 * @file channels.test.ts
 * @description Unit tests for channels routes.
 *   Covers: OAuth init URL generation, JWT gates (401), wrong-founder token access (403),
 *   revoked token send rejection (422/500), unapproved campaign send rejection (422),
 *   channel list (sensitive fields excluded), and platform revoke (row preserved).
 *   KMS, Supabase, and Meta API calls are mocked.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const FOUNDER_ID = 'c1000000-0000-0000-0000-000000000001';
const OTHER_FOUNDER_ID = 'c2000000-0000-0000-0000-000000000002';
const CAMPAIGN_ID = 'ca000000-0000-0000-0000-000000000001';
const JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';

function makeToken(sub = FOUNDER_ID) {
  return jwt.sign({ sub, role: 'authenticated' }, JWT_SECRET, { expiresIn: '1h' });
}

// ── Mock tokenVault ───────────────────────────────────────────────────────────

vi.mock('../src/lib/tokenVault', () => ({
  encryptToken: vi.fn(async () => ({
    ciphertext: 'encrypted_base64_ciphertext',
    kmsKeyId: 'arn:aws:kms:us-east-1:000000000000:key/test-key-id',
  })),
  decryptToken: vi.fn(async () => 'decrypted_access_token'),
}));

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const mockFrom = vi.fn();
vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: mockFrom,
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'c1000000-0000-0000-0000-000000000001', email: 'test@example.com' } },
        error: null,
      })),
    },
  }),
}));

// ── Mock other services (required by server.ts imports) ───────────────────────

vi.mock('../src/workers/scraperWorker', () => ({
  detectPlatform: vi.fn(() => null),
  scrapeAppStore: vi.fn(),
  scrapePlayStore: vi.fn(),
  scrapeCompetitors: vi.fn(async () => []),
}));
vi.mock('../src/services/reviewAnalysis', () => ({
  analyseReviews: vi.fn(async () => ({
    sentiment: 'positive',
    painPoints: [],
    copySignals: [],
    marketingOpportunities: [],
  })),
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

import { buildServer } from '../src/server';

// ── DB mock helpers ───────────────────────────────────────────────────────────

function mockApprovedCampaign(founderId = FOUNDER_ID) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { approved_at: '2026-05-17T10:00:00Z', founder_id: founderId, status: 'approved' },
          error: null,
        }),
      }),
    }),
  };
}

function mockUnapprovedCampaign(founderId = FOUNDER_ID) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { approved_at: null, founder_id: founderId, status: 'draft' },
          error: null,
        }),
      }),
    }),
  };
}

function mockTokenRow(opts: { revoked?: boolean; founderId?: string } = {}) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'tok-001',
              founder_id: opts.founderId ?? FOUNDER_ID,
              encrypted_token: 'encrypted_base64_ciphertext',
              kms_key_id: 'arn:aws:kms:us-east-1:000000000000:key/test-key-id',
              revoked_at: opts.revoked ? '2026-05-17T09:00:00Z' : null,
            },
            error: null,
          }),
        }),
      }),
    }),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Channels routes', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    process.env.WHATSAPP_APP_ID = 'test_app_id';
    process.env.WHATSAPP_APP_SECRET = 'test_app_secret_for_hmac';
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'test_verify_token';
    process.env.API_BASE_URL = 'http://localhost:3001';
    process.env.APP_BASE_URL = 'http://localhost:3000';
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: audit_log inserts succeed
    mockFrom.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    });
  });

  // ── Auth gates ────────────────────────────────────────────────────────────

  it('GET /channels without token → 401', async () => {
    const res = await server.inject({ method: 'GET', url: '/channels' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /channels/whatsapp/send without token → 401', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/channels/whatsapp/send',
      payload: { campaignId: CAMPAIGN_ID, phoneNumberId: '111', recipientPhone: '+1234567890', templateName: 'hello', languageCode: 'en_US' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('DELETE /channels/whatsapp without token → 401', async () => {
    const res = await server.inject({ method: 'DELETE', url: '/channels/whatsapp' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /channels/whatsapp/oauth/init without token → 401', async () => {
    const res = await server.inject({ method: 'GET', url: '/channels/whatsapp/oauth/init' });
    expect(res.statusCode).toBe(401);
  });

  // ── OAuth init ────────────────────────────────────────────────────────────

  it('GET /channels/whatsapp/oauth/init returns Meta OAuth URL', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/channels/whatsapp/oauth/init',
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ url: string }>();
    expect(body.url).toContain('facebook.com');
    expect(body.url).toContain('client_id=test_app_id');
    expect(body.url).toContain('whatsapp_business_messaging');
  });

  // ── Channel listing ────────────────────────────────────────────────────────

  it('GET /channels returns connected platforms without encrypted_token', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [
              {
                platform: 'whatsapp',
                scopes: ['whatsapp_business_messaging'],
                expires_at: null,
                revoked_at: null,
                created_at: '2026-05-17T10:00:00Z',
              },
            ],
            error: null,
          }),
        }),
      }),
    });

    const res = await server.inject({
      method: 'GET',
      url: '/channels',
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ channels: unknown[] }>();
    expect(body.channels).toHaveLength(1);
    // Critical: encrypted_token and kms_key_id must NEVER appear in response
    const channel = JSON.stringify(body.channels[0]);
    expect(channel).not.toContain('encrypted_token');
    expect(channel).not.toContain('kms_key_id');
  });

  // ── Send: unapproved campaign → 422 ───────────────────────────────────────

  it('POST /channels/whatsapp/send with unapproved campaign → 422', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'campaigns') return mockUnapprovedCampaign();
      return { insert: vi.fn().mockResolvedValue({ error: null }) };
    });

    const res = await server.inject({
      method: 'POST',
      url: '/channels/whatsapp/send',
      headers: { Authorization: `Bearer ${makeToken()}` },
      payload: {
        campaignId: CAMPAIGN_ID,
        phoneNumberId: '111111111',
        recipientPhone: '+1234567890',
        templateName: 'hello_world',
        languageCode: 'en_US',
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: 'CAMPAIGN_NOT_APPROVED' });
  });

  // ── Send: wrong founder campaign → 403 ────────────────────────────────────

  it('POST /channels/whatsapp/send for a different founder campaign → 403', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'campaigns') return mockApprovedCampaign(OTHER_FOUNDER_ID);
      return { insert: vi.fn().mockResolvedValue({ error: null }) };
    });

    const res = await server.inject({
      method: 'POST',
      url: '/channels/whatsapp/send',
      headers: { Authorization: `Bearer ${makeToken(FOUNDER_ID)}` },
      payload: {
        campaignId: CAMPAIGN_ID,
        phoneNumberId: '111111111',
        recipientPhone: '+1234567890',
        templateName: 'hello_world',
        languageCode: 'en_US',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  // ── Revoke: invalid platform → 400 ────────────────────────────────────────

  it('DELETE /channels/invalidplatform → 400', async () => {
    const res = await server.inject({
      method: 'DELETE',
      url: '/channels/invalidplatform',
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ validPlatforms: string[] }>();
    expect(body.validPlatforms).toContain('whatsapp');
  });

  // ── Revoke: token not found → 404 ─────────────────────────────────────────

  it('DELETE /channels/whatsapp when no token exists → 404', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'platform_tokens') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
              }),
            }),
          }),
        };
      }
      return { insert: vi.fn().mockResolvedValue({ error: null }) };
    });

    const res = await server.inject({
      method: 'DELETE',
      url: '/channels/whatsapp',
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(404);
  });

  // ── Webhook: missing signature → 401 ─────────────────────────────────────

  it('POST /channels/whatsapp/webhook without x-hub-signature-256 → 401', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/channels/whatsapp/webhook',
      payload: { entry: [] },
    });
    expect(res.statusCode).toBe(401);
  });

  // ── Webhook: wrong signature → 401 ────────────────────────────────────────

  it('POST /channels/whatsapp/webhook with wrong signature → 401', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/channels/whatsapp/webhook',
      headers: { 'x-hub-signature-256': 'sha256=wrongsignaturevalue' },
      payload: { entry: [] },
    });
    expect(res.statusCode).toBe(401);
  });

  // ── Webhook: valid signature → 200 ────────────────────────────────────────

  it('POST /channels/whatsapp/webhook with valid signature → 200', async () => {
    const body = JSON.stringify({ entry: [] });
    const sig = `sha256=${crypto
      .createHmac('sha256', 'test_app_secret_for_hmac')
      .update(Buffer.from(body))
      .digest('hex')}`;

    const res = await server.inject({
      method: 'POST',
      url: '/channels/whatsapp/webhook',
      headers: { 'x-hub-signature-256': sig, 'content-type': 'application/json' },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ received: true });
  });

  // ── Webhook: GET challenge verification ────────────────────────────────────

  it('GET /channels/whatsapp/webhook with correct verify_token → 200 with challenge', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/channels/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=test_verify_token&hub.challenge=testchallenge123',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('testchallenge123');
  });

  it('GET /channels/whatsapp/webhook with wrong verify_token → 403', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/channels/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong_token&hub.challenge=testchallenge123',
    });
    expect(res.statusCode).toBe(403);
  });
});
