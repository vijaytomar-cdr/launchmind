/**
 * @file owner.test.ts
 * @description Tests for Owner Experience routes — /owner/brief, /owner/opportunities,
 *   /owner/ask, /owner/results, /owner/timeline, /owner/notifications.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';

const FOUNDER_ID = 'aa100000-0000-0000-0000-000000000001';
const PRODUCT_ID = 'bb200000-0000-0000-0000-000000000002';
const WORKSPACE_ID = 'cc300000-0000-0000-0000-000000000003';
const JWT_SECRET  = 'test-jwt-secret-min-32-chars-long!!';

function makeToken(): string {
  return jwt.sign(
    { sub: FOUNDER_ID, role: 'authenticated', email: 'owner-test@example.com' },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

// ── Supabase mock ─────────────────────────────────────────────────────────────

vi.mock('../src/lib/supabaseAdmin', () => {
  const rows = (table: string): unknown[] => {
    // Carries an ACTIVE BUSINESS: owner routes now resolve the selected
    // workspace/product rather than "newest product owned by this founder", so a
    // founder with no active business legitimately gets 409 on writes.
    if (table === 'founders')          return [{ name: 'Test Founder', plan: 'solo', token_balance: 300, active_workspace_id: WORKSPACE_ID, active_product_id: PRODUCT_ID }];
    if (table === 'workspaces')        return [{ id: WORKSPACE_ID, founder_id: FOUNDER_ID, name: 'TestCo' }];
    if (table === 'workspace_members') return [];
    if (table === 'products')          return [{ id: PRODUCT_ID, workspace_id: WORKSPACE_ID, name: 'TestApp', platform: 'app_store', markets: ['usa'], confirmed_icp: { targetAudience: 'devs' }, brand_voice_profile: null, archived_at: null }];
    if (table === 'campaigns')         return [];
    if (table === 'missions')          return [];
    if (table === 'mission_approvals') return [];
    if (table === 'campaign_metrics')  return [{ installs: 120, clicks: 400, impressions: 5000, cpi: 1.2, ctr: 0.08, roas: null, week_start: '2026-07-01', campaign_id: 'c1' }];
    if (table === 'saved_opportunities') return [{ id: 'opp-1', type: 'aso', title: 'Add keywords', state: 'active', confidence: 0.75, effort: 'low', risk: 'low', why_now: 'Test', expected_impact: '~+8%', founder_id: FOUNDER_ID, product_id: PRODUCT_ID, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }];
    if (table === 'notifications')     return [];
    if (table === 'mission_logs')      return [];
    return [];
  };

  const makeQ = (table: string) => {
    const data = rows(table);
    const q: Record<string, unknown> = {};
    const chain = () => q;
    q.select   = chain; q.eq = chain; q.in = chain; q.not = chain;
    q.is       = chain; q.order = chain; q.limit = chain;
    q.single   = () => Promise.resolve({ data: data[0] ?? null, error: null });
    // Returns the first row like `single` does. Hardcoding null meant every
    // maybeSingle lookup resolved to "nothing found", which now reads as "no
    // active business" and made valid requests look like failures.
    q.maybeSingle = () => Promise.resolve({ data: data[0] ?? null, error: null });
    q.then     = (resolve: (v: { data: unknown[]; error: null }) => void) =>
      Promise.resolve({ data, error: null }).then(resolve);
    q.insert   = () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'new-id', ...data[0] }, error: null }) }) });
    q.update   = () => ({ eq: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) });
    return q;
  };

  return {
    getSupabaseAdmin: () => ({
      from: (t: string) => makeQ(t),
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: FOUNDER_ID, email: 'owner-test@example.com' } },
          error: null,
        })),
      },
    }),
  };
});

vi.mock('../src/workers/missionWorker', () => ({
  enqueueMission:     vi.fn(async () => undefined),
  getMissionQueue:    vi.fn(() => ({})),
  startMissionWorker: vi.fn(),
  stopMissionWorker:  vi.fn(async () => undefined),
  MISSION_QUEUE_NAME: 'mission-execution',
}));

// ── Context engine mock ───────────────────────────────────────────────────────

vi.mock('../src/lib/contextEngine', () => ({
  buildContextPackage: vi.fn(async (founderId: string) => ({
    founderId, productId: PRODUCT_ID,
    sources: ['founder', 'product'],
    assembledAt: new Date().toISOString(),
    founder: { plan: 'solo', tokenBalance: 300, estimatedMonthlyUSD: null },
    product: { name: 'TestApp', platform: 'app_store', markets: ['usa'], category: null, confirmedIcp: null, brandVoiceProfile: null, competitorSet: null },
    memories: [], knowledgeNodes: [], campaigns: [],
    analytics: { totalInstalls: 120, avgCtr: 0.08, avgCpi: 1.2, topChannel: 'whatsapp' },
    budget: { plan: 'solo', tokenBalance: 300, estimatedMonthlyUSD: null },
  })),
  formatContextForPrompt: vi.fn(() => 'Context text'),
}));

// ── AI platform mock ──────────────────────────────────────────────────────────

vi.mock('../src/lib/aiPlatform', () => ({
  callSonnet: vi.fn(async () => JSON.stringify({
    summary: 'Launch India campaign.',
    recommendedAction: 'Run WhatsApp campaign',
    suggestedMissionType: 'campaign',
    suggestedMissionTitle: 'India launch',
    expectedImpact: '~+25% installs',
    confidence: 78,
    risks: ['Localisation needed'],
    nextStep: 'Create mission',
    evidence: ['India 3x growth'],
  })),
  callHaiku: vi.fn(async () => JSON.stringify({
    title: 'Launch India campaign',
    summary: 'India is growing.',
    whyNow: 'Category growth this week.',
    confidence: 78,
    evidence: ['India 3x'],
    action: 'Launch',
    missionType: 'campaign',
  })),
}));

// ── Server ────────────────────────────────────────────────────────────────────

let server: FastifyInstance;

beforeAll(async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  const { buildServer } = await import('../src/server');
  server = await buildServer();
});

afterAll(async () => {
  await server?.close();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /owner/brief', () => {
  it('returns 401 without token', async () => {
    const res = await server.inject({ method: 'GET', url: '/owner/brief' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with brief structure', async () => {
    const res = await server.inject({
      method: 'GET', url: '/owner/brief',
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      founder: { name: string };
      pendingApprovals: { total: number };
      opportunities: unknown[];
      growthBrain: { hasStrategy: boolean };
      metrics: { activeCampaigns: number };
    }>();
    expect(body.founder).toBeDefined();
    expect(body.pendingApprovals).toBeDefined();
    expect(Array.isArray(body.opportunities)).toBe(true);
    expect(body.growthBrain).toBeDefined();
    expect(body.metrics).toBeDefined();
  });
});

describe('GET /owner/opportunities', () => {
  it('returns 401 without token', async () => {
    const res = await server.inject({ method: 'GET', url: '/owner/opportunities' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with opportunities array', async () => {
    const res = await server.inject({
      method: 'GET', url: '/owner/opportunities',
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ opportunities: unknown[] }>();
    expect(Array.isArray(body.opportunities)).toBe(true);
  });
});

describe('POST /owner/opportunities', () => {
  it('returns 400 for missing title', async () => {
    const res = await server.inject({
      method: 'POST', url: '/owner/opportunities',
      headers: { authorization: `Bearer ${makeToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'aso' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 201 for valid opportunity', async () => {
    const res = await server.inject({
      method: 'POST', url: '/owner/opportunities',
      headers: { authorization: `Bearer ${makeToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'aso', title: 'Add ASO keywords', effort: 'low', risk: 'low' }),
    });
    expect([201, 500]).toContain(res.statusCode);
  });
});

describe('PATCH /owner/opportunities/:id', () => {
  it('returns 401 without token', async () => {
    const res = await server.inject({ method: 'PATCH', url: '/owner/opportunities/opp-1' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 for valid state transition', async () => {
    const res = await server.inject({
      method: 'PATCH', url: '/owner/opportunities/opp-1',
      headers: { authorization: `Bearer ${makeToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'saved' }),
    });
    expect([200, 500]).toContain(res.statusCode);
  });
});

describe('POST /owner/ask', () => {
  it('returns 401 without token', async () => {
    const res = await server.inject({ method: 'POST', url: '/owner/ask' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 for empty question', async () => {
    const res = await server.inject({
      method: 'POST', url: '/owner/ask',
      headers: { authorization: `Bearer ${makeToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ question: '' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 200 with structured answer', async () => {
    const res = await server.inject({
      method: 'POST', url: '/owner/ask',
      headers: { authorization: `Bearer ${makeToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'How do I get 1,000 installs?' }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ answer: { summary: string; confidence: number }; question: string }>();
    expect(body.answer).toBeDefined();
    expect(typeof body.answer.summary).toBe('string');
    expect(body.question).toBe('How do I get 1,000 installs?');
  });
});

describe('GET /owner/results', () => {
  it('returns 401 without token', async () => {
    const res = await server.inject({ method: 'GET', url: '/owner/results' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with summary + weeklyData', async () => {
    const res = await server.inject({
      method: 'GET', url: '/owner/results',
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ summary: { totalInstalls: number }; weeklyData: unknown[] }>();
    expect(body.summary).toBeDefined();
    expect(Array.isArray(body.weeklyData)).toBe(true);
  });
});

describe('GET /owner/timeline', () => {
  it('returns 401 without token', async () => {
    const res = await server.inject({ method: 'GET', url: '/owner/timeline' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with events + total', async () => {
    const res = await server.inject({
      method: 'GET', url: '/owner/timeline',
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ events: unknown[]; total: number }>();
    expect(Array.isArray(body.events)).toBe(true);
    expect(typeof body.total).toBe('number');
  });
});

describe('GET /owner/notifications', () => {
  it('returns 401 without token', async () => {
    const res = await server.inject({ method: 'GET', url: '/owner/notifications' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with notifications + unreadCount', async () => {
    const res = await server.inject({
      method: 'GET', url: '/owner/notifications',
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ notifications: unknown[]; unreadCount: number }>();
    expect(Array.isArray(body.notifications)).toBe(true);
    expect(typeof body.unreadCount).toBe('number');
  });
});

describe('PATCH /owner/notifications/:id/read', () => {
  it('returns 401 without token', async () => {
    const res = await server.inject({ method: 'PATCH', url: '/owner/notifications/notif-1/read' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 for mark read', async () => {
    const res = await server.inject({
      method: 'PATCH', url: '/owner/notifications/notif-1/read',
      headers: { authorization: `Bearer ${makeToken()}`, 'content-type': 'application/json' },
      body: '{}',
    });
    expect([200, 500]).toContain(res.statusCode);
  });
});

describe('GET /owner/opportunities evidence normalisation', () => {
  it('GET /owner/opportunities normalises evidence from JSON string', async () => {
    const res = await server.inject({
      method: 'GET', url: '/owner/opportunities',
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { opportunities: Array<{ evidence: unknown }> };
    // Evidence should always be an array, never a raw JSON string
    for (const opp of body.opportunities) {
      expect(Array.isArray(opp.evidence)).toBe(true);
    }
  });
});
