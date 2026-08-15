/**
 * @file studio.test.ts
 * @description Tests for Content Studio routes — /studio/generate, /studio/assets,
 *   /studio/assets/:id (CRUD, transform, archive, restore, publish, versions),
 *   and /studio/stats.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';

const FOUNDER_ID = 'aa500000-0000-0000-0000-000000000501';
const WORKSPACE_ID = 'ee500000-0000-4000-8000-00000000000a';
const PRODUCT_ID = 'bb500000-0000-0000-0000-000000000502';
const ASSET_ID   = 'cc500000-0000-0000-0000-000000000503';
const JWT_SECRET  = 'test-jwt-secret-min-32-chars-long!!';

function makeToken(): string {
  return jwt.sign(
    { sub: FOUNDER_ID, role: 'authenticated', email: 'studio-test@example.com' },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

// ── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_ASSET = {
  id: ASSET_ID,
  product_id: PRODUCT_ID,
  founder_id: FOUNDER_ID,
  asset_type: 'whatsapp_broadcast',
  channel: 'whatsapp',
  market: 'india',
  language: 'english',
  text_content: 'Try our app today! Limited offer.',
  structured_data: null,
  media_url: null,
  status: 'pending',
  approved_at: null,
  auto_approved: false,
  regen_count: 0,
  regen_reasons: null,
  quality_score: null,
  quality_flags: null,
  hook_angle: null,
  generation_week: null,
  model_used: 'claude-haiku-4-5',
  tokens_consumed: 120,
  tags: null,
  mission_id: null,
  growth_brain_version: 1,
  archived_at: null,
  published_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const MOCK_APPROVED_ASSET = { ...MOCK_ASSET, id: 'cc500000-0000-0000-0000-000000000509', status: 'approved', approved_at: new Date().toISOString() };

// ── Supabase mock ─────────────────────────────────────────────────────────────

vi.mock('../src/lib/supabaseAdmin', () => {
  const makeQ = (table: string) => {
    const rows: Record<string, unknown[]> = {
      workspaces:        [{ id: WORKSPACE_ID, founder_id: FOUNDER_ID, name: 'StudioCo' }],
      workspace_members: [],
      products:          [{ id: PRODUCT_ID, founder_id: FOUNDER_ID, workspace_id: WORKSPACE_ID, archived_at: null, name: 'StudioApp', confirmed_icp: { targetAudience: 'indie devs' }, brand_voice_profile: { tone: 'friendly' } }],
      founders:          [{ id: FOUNDER_ID, plan: 'builder', name: 'Studio User', token_balance: 500, active_workspace_id: WORKSPACE_ID, active_product_id: PRODUCT_ID }],
      content_assets:    [MOCK_ASSET, MOCK_APPROVED_ASSET],
      content_versions:  [],
      publishing_targets:[],
    };
    const data = rows[table] ?? [];

    const q: Record<string, unknown> = {};
    let _filters: Record<string, unknown> = {};
    let _insert_data: unknown = null;

    const chain = () => q;

    q.select   = () => q;
    q.eq       = (_col: string, val: unknown) => { if (_col === 'id' || _col === 'asset_id') _filters['id'] = val; return q; };
    q.in       = chain;
    q.not      = chain;
    q.is       = chain;
    q.overlaps = chain;
    q.ilike    = chain;
    q.order    = chain;
    q.limit    = chain;
    q.range    = chain;

    q.insert = (insertData: unknown) => {
      _insert_data = insertData;
      const inserted = { ...((insertData as Record<string, unknown>) ?? {}), id: `new-${table}-${Date.now()}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      return {
        select: () => ({
          single: () => Promise.resolve({ data: inserted, error: null }),
        }),
      };
    };

    q.update = (updateData: unknown) => {
      return {
        eq: () => ({
          eq: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: { ...MOCK_ASSET, ...((updateData as Record<string, unknown>) ?? {}), id: _filters['id'] ?? ASSET_ID }, error: null }),
            }),
            is: () => ({
              select: () => ({
                single: () => Promise.resolve({ data: { ...MOCK_ASSET, ...((updateData as Record<string, unknown>) ?? {}) }, error: null }),
              }),
            }),
            not: () => ({
              select: () => ({
                single: () => Promise.resolve({ data: { ...MOCK_ASSET, ...((updateData as Record<string, unknown>) ?? {}) }, error: null }),
              }),
            }),
          }),
          is: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: { ...MOCK_ASSET, ...((updateData as Record<string, unknown>) ?? {}) }, error: null }),
            }),
          }),
        }),
      };
    };

    q.single = () => {
      const found = data.find((r: unknown) => {
        if (!_filters['id']) return true;
        return (r as Record<string, unknown>).id === _filters['id'];
      });
      return Promise.resolve({ data: found ?? null, error: found ? null : { code: 'PGRST116' } });
    };

    q.maybeSingle = () => Promise.resolve({ data: null, error: null });

    q.then = (resolve: (v: { data: unknown[]; error: null; count: number }) => void) =>
      Promise.resolve({ data, error: null, count: data.length }).then(resolve);

    return q;
  };

  return {
    getSupabaseAdmin: () => ({
      from: (t: string) => makeQ(t),
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: FOUNDER_ID, email: 'studio-test@example.com' } },
          error: null,
        })),
      },
    }),
  };
});

// ── Worker mocks (prevent Redis connection) ───────────────────────────────────

vi.mock('../src/workers/missionWorker', () => ({
  enqueueMission:      vi.fn(async () => undefined),
  getMissionQueue:     vi.fn(() => ({})),
  startMissionWorker:  vi.fn(),
  stopMissionWorker:   vi.fn(async () => undefined),
  MISSION_QUEUE_NAME:  'mission-execution',
}));

vi.mock('../src/workers/weeklyBriefWorker',  () => ({ startBriefWorker:   vi.fn() }));
vi.mock('../src/workers/intakeWorker',        () => ({ startIntakeWorker:  vi.fn() }));
vi.mock('../src/workers/contentWorker',       () => ({ startContentWorker: vi.fn() }));

// ── AI mocks ──────────────────────────────────────────────────────────────────

vi.mock('../src/lib/aiPlatform', () => ({
  callSonnet: vi.fn(async () => JSON.stringify({ title: 'Blog Post Title', body: 'Body content here.', metaDescription: 'Meta desc' })),
  callHaiku:  vi.fn(async () => 'Rewritten content for the app with great features.'),
  callMessages: vi.fn(async () => '{}'),
  generateAI: vi.fn(async () => ({ text: '{}', model: 'haiku', tokensIn: 50, tokensOut: 80, cost: 0.001, latencyMs: 200, promptId: 'test', retries: 0 })),
}));

// ── Server setup ──────────────────────────────────────────────────────────────

let server: FastifyInstance;

beforeAll(async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key';

  const { buildServer } = await import('../src/server');
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  await server.close();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Content Studio — authentication', () => {
  it('GET /studio/assets returns 401 without token', async () => {
    const res = await server.inject({ method: 'GET', url: '/studio/assets' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /studio/stats returns 401 without token', async () => {
    const res = await server.inject({ method: 'GET', url: '/studio/stats' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /studio/generate returns 401 without token', async () => {
    const res = await server.inject({ method: 'POST', url: '/studio/generate', payload: {} });
    expect(res.statusCode).toBe(401);
  });
});

describe('Content Studio — asset library', () => {
  it('GET /studio/assets returns 200 with assets array', async () => {
    const res = await server.inject({
      method: 'GET', url: '/studio/assets',
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('assets');
    expect(Array.isArray(body.assets)).toBe(true);
    expect(body).toHaveProperty('total');
  });

  it('GET /studio/assets accepts filter params', async () => {
    const res = await server.inject({
      method: 'GET', url: '/studio/assets?status=pending&limit=10',
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('limit', 10);
  });

  it('GET /studio/stats returns 200 with aggregated stats', async () => {
    const res = await server.inject({
      method: 'GET', url: '/studio/stats',
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('totalAssets');
    expect(body).toHaveProperty('byType');
    expect(body).toHaveProperty('byStatus');
    expect(body).toHaveProperty('totalTokens');
    expect(body).toHaveProperty('publishedCount');
  });
});

describe('Content Studio — single asset', () => {
  it('GET /studio/assets/:id returns 200 with asset + versionCount', async () => {
    const res = await server.inject({
      method: 'GET', url: `/studio/assets/${ASSET_ID}`,
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('asset');
    expect(body).toHaveProperty('versionCount');
    expect(body).toHaveProperty('publishTargets');
  });

  it('GET /studio/assets/:id returns 404 for unknown id', async () => {
    const res = await server.inject({
      method: 'GET', url: `/studio/assets/00000000-0000-0000-0000-000000000000`,
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /studio/assets/:id/versions returns 200 with versions array', async () => {
    const res = await server.inject({
      method: 'GET', url: `/studio/assets/${ASSET_ID}/versions`,
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('versions');
    expect(Array.isArray(body.versions)).toBe(true);
  });
});

describe('Content Studio — generation', () => {
  it('POST /studio/generate returns 400 for invalid body', async () => {
    const res = await server.inject({
      method: 'POST', url: '/studio/generate',
      headers: { Authorization: `Bearer ${makeToken()}`, 'Content-Type': 'application/json' },
      payload: { assetType: 'meta_headline' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /studio/generate returns 201 with created asset', async () => {
    const res = await server.inject({
      method: 'POST', url: '/studio/generate',
      headers: { Authorization: `Bearer ${makeToken()}`, 'Content-Type': 'application/json' },
      payload: {
        productId: PRODUCT_ID,
        assetType: 'whatsapp_broadcast',
        channel: 'whatsapp',
        market: 'india',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('asset');
    expect(body.asset).toHaveProperty('id');
    expect(body.asset.asset_type).toBe('whatsapp_broadcast');
  });

  it('POST /studio/generate works for new M08 type blog_post', async () => {
    const res = await server.inject({
      method: 'POST', url: '/studio/generate',
      headers: { Authorization: `Bearer ${makeToken()}`, 'Content-Type': 'application/json' },
      payload: {
        productId: PRODUCT_ID,
        assetType: 'blog_post',
        channel: 'web',
        market: 'usa',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.asset.asset_type).toBe('blog_post');
  });
});

describe('Content Studio — editing', () => {
  it('PUT /studio/assets/:id returns 200 and creates version', async () => {
    const res = await server.inject({
      method: 'PUT', url: `/studio/assets/${ASSET_ID}`,
      headers: { Authorization: `Bearer ${makeToken()}`, 'Content-Type': 'application/json' },
      payload: { textContent: 'Updated copy for the app.', changeSummary: 'Shortened the message' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('asset');
    expect(body).toHaveProperty('versionCreated');
    expect(typeof body.versionCreated).toBe('number');
  });

  it('PUT /studio/assets/:id supports tag updates', async () => {
    const res = await server.inject({
      method: 'PUT', url: `/studio/assets/${ASSET_ID}`,
      headers: { Authorization: `Bearer ${makeToken()}`, 'Content-Type': 'application/json' },
      payload: { tags: ['india-launch', 'q3'] },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('Content Studio — AI transforms', () => {
  it('POST /studio/assets/:id/transform returns 400 for invalid transformType', async () => {
    const res = await server.inject({
      method: 'POST', url: `/studio/assets/${ASSET_ID}/transform`,
      headers: { Authorization: `Bearer ${makeToken()}`, 'Content-Type': 'application/json' },
      payload: { transformType: 'unknown_type' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /studio/assets/:id/transform rewrite returns 200 with new text', async () => {
    const res = await server.inject({
      method: 'POST', url: `/studio/assets/${ASSET_ID}/transform`,
      headers: { Authorization: `Bearer ${makeToken()}`, 'Content-Type': 'application/json' },
      payload: { transformType: 'rewrite' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('asset');
    expect(body).toHaveProperty('transformType', 'rewrite');
    expect(body).toHaveProperty('versionCreated');
  });

  it('POST /studio/assets/:id/transform tone returns 200', async () => {
    const res = await server.inject({
      method: 'POST', url: `/studio/assets/${ASSET_ID}/transform`,
      headers: { Authorization: `Bearer ${makeToken()}`, 'Content-Type': 'application/json' },
      payload: { transformType: 'tone', targetTone: 'professional' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.transformType).toBe('tone');
  });
});

describe('Content Studio — archive and restore', () => {
  it('POST /studio/assets/:id/archive returns 200', async () => {
    const res = await server.inject({
      method: 'POST', url: `/studio/assets/${ASSET_ID}/archive`,
      headers: { Authorization: `Bearer ${makeToken()}`, 'Content-Type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('id');
  });

  it('POST /studio/assets/:id/restore returns 200', async () => {
    const res = await server.inject({
      method: 'POST', url: `/studio/assets/${ASSET_ID}/restore`,
      headers: { Authorization: `Bearer ${makeToken()}`, 'Content-Type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('restored', true);
  });
});

describe('Content Studio — publishing', () => {
  it('POST /studio/assets/:id/publish returns 422 for unapproved asset', async () => {
    const res = await server.inject({
      method: 'POST', url: `/studio/assets/${ASSET_ID}/publish`,
      headers: { Authorization: `Bearer ${makeToken()}`, 'Content-Type': 'application/json' },
      payload: { channel: 'whatsapp' },
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('approved');
  });

  it('POST /studio/assets/:id/publish returns 400 for invalid channel', async () => {
    const res = await server.inject({
      method: 'POST', url: `/studio/assets/${MOCK_APPROVED_ASSET.id}/publish`,
      headers: { Authorization: `Bearer ${makeToken()}`, 'Content-Type': 'application/json' },
      payload: { channel: 'invalid_channel' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /studio/assets/:id/publish returns 201 for approved asset with valid channel', async () => {
    const res = await server.inject({
      method: 'POST', url: `/studio/assets/${MOCK_APPROVED_ASSET.id}/publish`,
      headers: { Authorization: `Bearer ${makeToken()}`, 'Content-Type': 'application/json' },
      payload: { channel: 'whatsapp' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('publishTarget');
    expect(body.publishTarget.channel).toBe('whatsapp');
  });
});
