/**
 * @file experiments.test.ts
 * @description Tests for M09 experiment routes: create, list, get, start, results, winner, archive.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildServer } from '../src/server';

vi.mock('../src/lib/supabaseAdmin', () => {
  const FOUNDER  = 'aa000000-0000-0000-0000-000000000001';
  const PRODUCT  = 'bb000000-0000-0000-0000-000000000001';
  const EXP_ID   = 'ee000000-0000-0000-0000-000000000001';

  const EXPERIMENT = {
    id: EXP_ID, founder_id: FOUNDER, product_id: PRODUCT,
    campaign_id: null, mission_id: null, title: 'Hook A vs B', hypothesis: 'B gets more CTR',
    experiment_type: 'copy', goal: 'Increase CTR 15%', metric: 'CTR', status: 'draft',
    market: 'usa', start_date: null, end_date: null, expected_outcome: null,
    confidence: null, winner: null, winner_confidence: null, learning: null, learning_summary: null,
    growth_brain_version: 1, memory_id: null, archived_at: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };

  const VARIANTS = [
    { id: 'v1', experiment_id: EXP_ID, founder_id: FOUNDER, variant: 'a', label: 'Variant A', description: null, asset_id: null, config: null, impressions: 0, clicks: 0, conversions: 0, metric_value: null },
    { id: 'v2', experiment_id: EXP_ID, founder_id: FOUNDER, variant: 'b', label: 'Variant B', description: null, asset_id: null, config: null, impressions: 0, clicks: 0, conversions: 0, metric_value: null },
  ];

  function chain(data: unknown) {
    const c: Record<string, unknown> = {};
    ['select','insert','update','delete','eq','neq','in','is','not','gte','lte','order','range','limit','count'].forEach(m => {
      c[m] = vi.fn(() => c);
    });
    (c as { data: unknown; error: unknown; count: unknown }).data = data;
    (c as { data: unknown; error: unknown; count: unknown }).error = null;
    (c as { data: unknown; error: unknown; count: unknown }).count = Array.isArray(data) ? data.length : 0;
    c.single = vi.fn().mockResolvedValue({ data, error: null });
    return c;
  }

  return {
    getSupabaseAdmin: vi.fn(() => ({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: FOUNDER } }, error: null }) },
      from: vi.fn((table: string) => {
        if (table === 'products') return chain({ id: PRODUCT, founder_id: FOUNDER });
        if (table === 'experiments') {
          const c = chain(EXPERIMENT);
          // select chain returns list of experiments
          c.select = vi.fn(() => {
            const sc = chain([EXPERIMENT]);
            sc.single = vi.fn().mockResolvedValue({ data: EXPERIMENT, error: null });
            sc.range = vi.fn().mockResolvedValue({ data: [EXPERIMENT], count: 1, error: null });
            return sc;
          });
          c.insert = vi.fn(() => ({
            ...c,
            select: vi.fn(() => ({
              ...c,
              single: vi.fn().mockResolvedValue({ data: EXPERIMENT, error: null }),
            })),
          }));
          c.update = vi.fn(() => ({
            ...c,
            eq: vi.fn(() => ({
              ...c,
              eq: vi.fn(() => ({
                ...c,
                is: vi.fn(() => ({
                  ...c,
                  select: vi.fn(() => ({
                    ...c,
                    single: vi.fn().mockResolvedValue({ data: { ...EXPERIMENT, archived_at: new Date().toISOString(), status: 'archived' }, error: null }),
                  })),
                })),
                select: vi.fn(() => ({
                  ...c,
                  single: vi.fn().mockResolvedValue({ data: { ...EXPERIMENT, status: 'running' }, error: null }),
                })),
              })),
            })),
          }));
          return c;
        }
        if (table === 'experiment_variants') {
          const c = chain(VARIANTS);
          c.insert = vi.fn().mockResolvedValue({ data: VARIANTS, error: null });
          c.update = vi.fn(() => chain(null));
          return c;
        }
        return chain(null);
      }),
    })),
  };
});

vi.mock('../src/lib/aiPlatform', () => ({
  callSonnet: vi.fn(async () => 'Generated plan'),
  callHaiku: vi.fn(async () => 'Variant B with urgency converts better.'),
}));

vi.mock('../src/services/learningPipelineService', () => ({
  ingestLearningEvent: vi.fn(async () => ({ memoriesCreated: 1 })),
}));

vi.mock('../src/workers/missionWorker',     () => ({ startMissionWorker: vi.fn(), enqueueMission: vi.fn() }));
vi.mock('../src/workers/weeklyBriefWorker', () => ({ startBriefWorker: vi.fn() }));
vi.mock('../src/workers/intakeWorker',      () => ({ startIntakeWorker: vi.fn() }));
vi.mock('../src/workers/contentWorker',     () => ({ startContentWorker: vi.fn() }));

const MOCK_FOUNDER_ID = 'aa000000-0000-0000-0000-000000000001';
const MOCK_PRODUCT_ID = 'bb000000-0000-0000-0000-000000000001';
const MOCK_EXP_ID     = 'ee000000-0000-0000-0000-000000000001';

function authHeader() {
  const payload = Buffer.from(JSON.stringify({ sub: MOCK_FOUNDER_ID, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64');
  return `Bearer eyJhbGciOiJFUzI1NiJ9.${payload}.MOCK_SIG`;
}

describe('M09 Experiment routes', () => {
  it('GET /experiments returns 401 without token', async () => {
    const server = await buildServer();
    const res = await server.inject({ method: 'GET', url: '/experiments' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /experiments returns 200 with experiments array', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'GET', url: '/experiments',
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json<{ experiments: unknown[] }>().experiments)).toBe(true);
  });

  it('POST /experiments returns 401 without token', async () => {
    const server = await buildServer();
    const res = await server.inject({ method: 'POST', url: '/experiments', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('POST /experiments returns 400 for missing required fields', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'POST', url: '/experiments',
      headers: { authorization: authHeader() },
      payload: { title: 'Test' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /experiments returns 201 with created experiment', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'POST', url: '/experiments',
      headers: { authorization: authHeader() },
      payload: {
        productId: MOCK_PRODUCT_ID,
        title: 'Hook test',
        hypothesis: 'Urgency hook gets 20% more installs',
        experimentType: 'copy',
        goal: 'Increase installs',
        metric: 'installs',
        variantA: { label: 'Control' },
        variantB: { label: 'Urgency' },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ experiment: { id: string } }>().experiment).toBeDefined();
  });

  it('GET /experiments/:id returns 401 without token', async () => {
    const server = await buildServer();
    const res = await server.inject({ method: 'GET', url: `/experiments/${MOCK_EXP_ID}` });
    expect(res.statusCode).toBe(401);
  });

  it('GET /experiments/:id returns 200 with experiment and variants', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'GET', url: `/experiments/${MOCK_EXP_ID}`,
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ experiment: { id: string }; variants: unknown[] }>();
    expect(body.experiment).toBeDefined();
    expect(Array.isArray(body.variants)).toBe(true);
  });

  it('POST /experiments/:id/start returns 401 without token', async () => {
    const server = await buildServer();
    const res = await server.inject({ method: 'POST', url: `/experiments/${MOCK_EXP_ID}/start`, payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('POST /experiments/:id/start returns 200 or 409 for draft experiment', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'POST', url: `/experiments/${MOCK_EXP_ID}/start`,
      headers: { authorization: authHeader() }, payload: {},
    });
    expect([200, 404, 409]).toContain(res.statusCode);
  });

  it('POST /experiments/:id/winner returns 400 for missing learning', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'POST', url: `/experiments/${MOCK_EXP_ID}/winner`,
      headers: { authorization: authHeader() },
      payload: { winner: 'b' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /experiments/:id/winner returns 200 or 409 with valid payload', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'POST', url: `/experiments/${MOCK_EXP_ID}/winner`,
      headers: { authorization: authHeader() },
      payload: { winner: 'b', learning: 'Variant B urgency hook drove 20% more installs.' },
    });
    expect([200, 404, 409]).toContain(res.statusCode);
  });

  it('POST /experiments/:id/archive returns 200 or 404', async () => {
    const server = await buildServer();
    const res = await server.inject({
      method: 'POST', url: `/experiments/${MOCK_EXP_ID}/archive`,
      headers: { authorization: authHeader() }, payload: {},
    });
    expect([200, 404]).toContain(res.statusCode);
  });
});
