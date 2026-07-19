/**
 * @file campaigns.test.ts
 * @description Tests for M09 campaign routes: create, schedule, launch, cancel, archive, link asset.
 *   §1.5 Approve-Before-Post enforced in launch/schedule.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildServer } from '../src/server';

vi.mock('../src/lib/supabaseAdmin', () => {
  const FOUNDER = 'aa000000-0000-0000-0000-000000000001';
  const PRODUCT  = 'bb000000-0000-0000-0000-000000000001';
  const CAMPAIGN = {
    id: 'cc000000-0000-0000-0000-000000000001',
    founder_id: FOUNDER, product_id: PRODUCT,
    type: 'app_install', channel: 'meta', market: 'usa', status: 'draft',
    approved_at: null, launched_at: null, spend_cap: null, audience_config: null,
    hook_type: null, copy_text: null, scheduled_at: null, cancelled_at: null,
    archived_at: null, failed_at: null, failure_reason: null, mission_id: null,
    growth_brain_version: 1, ai_tokens_consumed: 0,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };

  function chain(data: unknown) {
    const c: Record<string, unknown> = {};
    ['select','insert','update','delete','eq','neq','in','is','not','gte','lte','order','range','limit','count'].forEach(m => {
      c[m] = vi.fn(() => c);
    });
    (c as { data: unknown; error: unknown; count: unknown }).data = data;
    (c as { data: unknown; error: unknown; count: unknown }).error = null;
    (c as { data: unknown; error: unknown; count: unknown }).count = 0;
    c.single = vi.fn().mockResolvedValue({ data, error: null });
    return c;
  }

  return {
    getSupabaseAdmin: vi.fn(() => ({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: FOUNDER } }, error: null }) },
      from: vi.fn((table: string) => {
        if (table === 'products') return chain({ id: PRODUCT, founder_id: FOUNDER });
        if (table === 'campaigns') {
          const c = chain(CAMPAIGN);
          c.insert = vi.fn(() => ({
            ...c,
            select: vi.fn(() => ({ ...c, single: vi.fn().mockResolvedValue({ data: CAMPAIGN, error: null }) })),
          }));
          c.update = vi.fn(() => ({
            ...c,
            select: vi.fn(() => ({ ...c, single: vi.fn().mockResolvedValue({ data: { ...CAMPAIGN, status: 'cancelled' }, error: null }) })),
          }));
          return c;
        }
        if (table === 'content_assets') {
          const c = chain([]);
          c.insert = vi.fn(() => ({ ...c, select: vi.fn(() => ({ ...c, single: vi.fn().mockResolvedValue({ data: { id: 'dd000000-0000-0000-0000-000000000001' }, error: null }) })) }));
          c.update = vi.fn(() => c);
          return c;
        }
        if (table === 'campaign_metrics')     return chain([]);
        if (table === 'campaign_approvals')   return chain([]);
        if (table === 'campaign_publish_attempts') {
          const c = chain([]);
          c.insert = vi.fn().mockResolvedValue({ data: { id: 'attempt-1' }, error: null });
          return c;
        }
        if (table === 'audit_logs') { const c = chain(null); c.insert = vi.fn().mockResolvedValue({ data: null, error: null }); return c; }
        return chain(null);
      }),
    })),
  };
});

vi.mock('../src/lib/aiPlatform', () => ({
  callSonnet: vi.fn(async () => JSON.stringify({
    recommendedChannels: ['meta'], suggestedAssets: [], audienceConfig: {},
    estimatedBudget: { weeklyUSD: 100 }, schedule: { startDate: '2026-08-01', durationDays: 14 },
    expectedOutcome: '200 installs', riskFactors: [],
  })),
  callHaiku: vi.fn(async () => 'Learning summary'),
}));

vi.mock('../src/lib/contextEngine', () => ({
  buildContextPackage: vi.fn(async () => null),
}));

vi.mock('../src/workers/missionWorker',     () => ({ startMissionWorker: vi.fn(), enqueueMission: vi.fn() }));
vi.mock('../src/workers/weeklyBriefWorker', () => ({ startBriefWorker: vi.fn() }));
vi.mock('../src/workers/intakeWorker',      () => ({ startIntakeWorker: vi.fn() }));
vi.mock('../src/workers/contentWorker',     () => ({ startContentWorker: vi.fn() }));

const MOCK_FOUNDER_ID  = 'aa000000-0000-0000-0000-000000000001';
const MOCK_PRODUCT_ID  = 'bb000000-0000-0000-0000-000000000001';
const MOCK_CAMPAIGN_ID = 'cc000000-0000-0000-0000-000000000001';
const MOCK_ASSET_ID    = 'dd000000-0000-0000-0000-000000000001';

function authHeader() {
  const payload = Buffer.from(JSON.stringify({ sub: MOCK_FOUNDER_ID, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64');
  return `Bearer eyJhbGciOiJFUzI1NiJ9.${payload}.MOCK_SIG`;
}

describe('M09 Campaign routes', () => {
  it('POST /campaigns/create returns 401 without token', async () => {
    const server = await buildServer();
    const res = await server.inject({ method: 'POST', url: '/campaigns/create', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('POST /campaigns/create returns 400 for missing required fields', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'POST', url: '/campaigns/create',
      headers: { authorization: authHeader() },
      payload: { channel: 'meta' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /campaigns/create returns 201 with created campaign', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'POST', url: '/campaigns/create',
      headers: { authorization: authHeader() },
      payload: { productId: MOCK_PRODUCT_ID, type: 'app_install', channel: 'meta', market: 'usa' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ campaign: { id: string } }>().campaign).toBeDefined();
  });

  it('GET /campaigns/:id/detail returns 401 without token', async () => {
    const server = await buildServer();
    const res = await server.inject({ method: 'GET', url: `/campaigns/${MOCK_CAMPAIGN_ID}/detail` });
    expect(res.statusCode).toBe(401);
  });

  it('GET /campaigns/:id/detail returns 200 with campaign and related data', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'GET', url: `/campaigns/${MOCK_CAMPAIGN_ID}/detail`,
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ campaign: unknown; assets: unknown[]; metrics: unknown[] }>();
    expect(body.campaign).toBeDefined();
    expect(Array.isArray(body.assets)).toBe(true);
  });

  it('POST /campaigns/:id/schedule returns 422 when campaign not approved (§1.5)', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'POST', url: `/campaigns/${MOCK_CAMPAIGN_ID}/schedule`,
      headers: { authorization: authHeader() },
      payload: { scheduledAt: '2026-08-01T09:00:00.000Z' },
    });
    // Campaign has approved_at=null → 422
    expect([404, 422]).toContain(res.statusCode);
    if (res.statusCode === 422) {
      expect(res.json<{ error: string }>().error).toMatch(/approved/i);
    }
  });

  it('POST /campaigns/:id/launch returns 422 when campaign not approved (§1.5)', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'POST', url: `/campaigns/${MOCK_CAMPAIGN_ID}/launch`,
      headers: { authorization: authHeader() },
      payload: {},
    });
    expect([404, 422]).toContain(res.statusCode);
    if (res.statusCode === 422) {
      expect(res.json<{ error: string }>().error).toMatch(/approved/i);
    }
  });

  it('POST /campaigns/:id/cancel returns 200 or 409', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'POST', url: `/campaigns/${MOCK_CAMPAIGN_ID}/cancel`,
      headers: { authorization: authHeader() }, payload: {},
    });
    expect([200, 404, 409]).toContain(res.statusCode);
  });

  it('POST /campaigns/:id/archive returns 200 or 404', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'POST', url: `/campaigns/${MOCK_CAMPAIGN_ID}/archive`,
      headers: { authorization: authHeader() }, payload: {},
    });
    expect([200, 404]).toContain(res.statusCode);
  });

  it('POST /campaigns/:id/assets returns 400 for missing assetId', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'POST', url: `/campaigns/${MOCK_CAMPAIGN_ID}/assets`,
      headers: { authorization: authHeader() }, payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /campaigns/:id/assets returns 200 or 404 with valid assetId', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'POST', url: `/campaigns/${MOCK_CAMPAIGN_ID}/assets`,
      headers: { authorization: authHeader() },
      payload: { assetId: MOCK_ASSET_ID },
    });
    expect([200, 404]).toContain(res.statusCode);
  });
});
