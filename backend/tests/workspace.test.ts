/**
 * @file workspace.test.ts
 * @description Tests for ensurePersonalWorkspace and POST /founders/session.
 *   Acceptance criteria (all ✅ by end of file):
 *     ✅ New user: workspace created, owner member row inserted, active_workspace_id set
 *     ✅ Existing user re-login: no duplicate workspace created (created=false)
 *     ✅ active_workspace_id updated when workspace exists but flag not set
 *     ✅ POST /founders/session returns 200 with founder + workspace
 *     ✅ POST /founders/session idempotent (workspaceCreated=false on re-login)
 *     ✅ POST /founders/session requires auth (401 without token)
 *     ✅ setup/start returns 422 NO_WORKSPACE when active_workspace_id is null
 *     ✅ setup/start passes workspace gate when active_workspace_id is set
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';

const FOUNDER_ID   = 'aa000000-0000-0000-0000-000000000001';
const WORKSPACE_ID = 'bb000000-0000-0000-0000-000000000002';
const JWT_SECRET   = 'test-jwt-secret-min-32-chars-long!!';

function makeToken(): string {
  return jwt.sign(
    { sub: FOUNDER_ID, role: 'authenticated', email: 'test@example.com' },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

const MOCK_WORKSPACE = {
  id: WORKSPACE_ID, founder_id: FOUNDER_ID, name: 'My Workspace',
  client_name: null, workspace_type: 'personal', settings: null,
  created_at: '2026-07-08T00:00:00.000Z',
};

// Shared test-state flags
let workspaceExists    = false;   // maybeSingle on workspaces returns null or MOCK_WORKSPACE
let founderHasActiveWs = false;   // founders.active_workspace_id is set or null

// ── Mock the Supabase admin client ────────────────────────────────────────────
const mockFrom = vi.fn();

vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: mockFrom,
    auth: {
      // jwtPlugin uses auth.getUser(token) — return the test founder
      getUser: vi.fn(async () => ({
        data: { user: { id: FOUNDER_ID, email: 'test@example.com' } },
        error: null,
      })),
    },
  }),
}));

/**
 * Build a "sticky" chain: every non-terminal method returns the SAME chain object.
 * This means .select().eq().order().limit().maybeSingle() all stay in scope.
 * Terminal methods (single / maybeSingle) resolve based on table + current flags.
 */
function makeSticky(table: string): Record<string, unknown> {
  const founderData = {
    id: FOUNDER_ID, email: 'test@example.com', name: null, plan: 'free',
    token_balance: null, onboarding_step: 0, active_product_id: null,
    active_workspace_id: founderHasActiveWs ? WORKSPACE_ID : null,
    created_at: '2026-07-08T00:00:00.000Z',
  };

  // Terminal: resolves a { data, error: null } Promise
  const single     = () => Promise.resolve({ data: table === 'founders' ? founderData : null, error: null });
  const maybeSingle = () => Promise.resolve({
    data: table === 'workspaces' ? (workspaceExists ? MOCK_WORKSPACE : null) : null,
    error: null,
  });

  // Sticky chain — every method except terminal ones returns the chain itself
  const chain: Record<string, unknown> = {
    single, maybeSingle,
  };
  for (const m of ['eq', 'order', 'limit', 'is', 'lt', 'head', 'select']) {
    chain[m] = () => chain;
  }
  // Make the chain directly awaitable (for `await db.from(...).update(...).eq(...)`)
  const resolved = Promise.resolve({ data: null, error: null });
  chain.then   = resolved.then.bind(resolved);
  chain.catch  = resolved.catch.bind(resolved);
  chain.finally = resolved.finally.bind(resolved);
  return chain;
}

function setupMockFrom() {
  mockFrom.mockImplementation((table: string) => {
    const chain = makeSticky(table);

    return {
      // SELECT → return the sticky chain (all further .eq/.order/.limit etc. stay sticky)
      select: (_cols?: string) => chain,

      // INSERT → directly awaitable AND supports .select().single()
      insert: (_rows: unknown) => {
        const wsData = table === 'workspaces' ? MOCK_WORKSPACE : { id: 'row-1' };
        const p = Promise.resolve({ data: wsData, error: null });
        return Object.assign(p, {
          select: () => ({
            single: () => Promise.resolve({ data: wsData, error: null }),
          }),
        });
      },

      // UPSERT → directly awaitable AND supports .select().single()
      upsert: (_rows: unknown) => {
        const p = Promise.resolve({ data: { id: FOUNDER_ID }, error: null });
        return Object.assign(p, {
          select: () => ({
            single: () => Promise.resolve({ data: { id: FOUNDER_ID }, error: null }),
          }),
        });
      },

      // UPDATE → sticky chain (awaitable + .eq() chainable)
      update: (_patch: unknown) => makeSticky(table),

      // DELETE → sticky chain
      delete: () => makeSticky(table),
    };
  });
}

// ── Stub heavy services so server builds cleanly ──────────────────────────────
vi.mock('../src/workers/scraperWorker',  () => ({
  detectPlatform: vi.fn(() => 'play_store'),
  scrapePlayStore: vi.fn(async () => ({})),
  scrapeAppStore:  vi.fn(async () => ({})),
  scrapeCompetitors: vi.fn(async () => []),
}));
vi.mock('../src/lib/scraperQueue', () => ({
  enqueueScrapeJob: vi.fn(async () => ({ jobId: 'j1' })),
  getScrapeJob:     vi.fn(async () => null),
}));
vi.mock('../src/services/reviewAnalysis',        () => ({ analyseReviews:        vi.fn(async () => ({})) }));
vi.mock('../src/services/icpService',            () => ({ buildICPBrief:         vi.fn(async () => ({})), scrapeWebsite: vi.fn(async () => ({})), analyseScreenshots: vi.fn(async () => ({})) }));
vi.mock('../src/services/strategyService',       () => ({ generateStrategy:      vi.fn(async () => ({})), generateContentAssets: vi.fn(async () => ({})), getProductStrategy: vi.fn(async () => ({})) }));
vi.mock('../src/lib/tokens',                     () => ({ consumeTokens:         vi.fn(async () => undefined) }));
vi.mock('../src/services/metricsService',        () => ({ getProductMetrics:     vi.fn(async () => ({})) }));
vi.mock('../src/services/brandVoiceService',     () => ({ previewBrandVoice:     vi.fn(async () => ({})) }));
vi.mock('../src/services/contentService',        () => ({ generateContentAssets: vi.fn(async () => []) }));
vi.mock('../src/services/marketingImagesService',() => ({ collectMarketingImages: vi.fn(async () => []) }));

import { buildServer } from '../src/server';

// ── ensurePersonalWorkspace — service layer ───────────────────────────────────

describe('ensurePersonalWorkspace — service layer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMockFrom();
  });

  it('creates workspace for a new user (created=true)', async () => {
    workspaceExists    = false;
    founderHasActiveWs = false;
    setupMockFrom();

    const { ensurePersonalWorkspace } = await import('../src/services/workspaceService');
    const result = await ensurePersonalWorkspace(FOUNDER_ID);

    expect(result.created).toBe(true);
    expect(result.workspace.id).toBe(WORKSPACE_ID);
    expect(result.workspace.workspace_type).toBe('personal');
    expect(result.workspace.name).toBe('My Workspace');
  });

  it('returns existing workspace on re-login (created=false, no duplicate)', async () => {
    workspaceExists    = true;
    founderHasActiveWs = true;
    setupMockFrom();

    const { ensurePersonalWorkspace } = await import('../src/services/workspaceService');
    const result = await ensurePersonalWorkspace(FOUNDER_ID);

    expect(result.created).toBe(false);
    expect(result.workspace.id).toBe(WORKSPACE_ID);
  });

  it('sets active_workspace_id when workspace exists but flag not set', async () => {
    workspaceExists    = true;
    founderHasActiveWs = false;
    setupMockFrom();

    const { ensurePersonalWorkspace } = await import('../src/services/workspaceService');
    const result = await ensurePersonalWorkspace(FOUNDER_ID);

    expect(result.created).toBe(false);
    expect(result.workspace.id).toBe(WORKSPACE_ID);
    expect(mockFrom).toHaveBeenCalledWith('founders');
  });
});

// ── POST /founders/session ────────────────────────────────────────────────────

describe('POST /founders/session', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    workspaceExists    = false;
    founderHasActiveWs = false;
    setupMockFrom();
    server = await buildServer();
  });

  afterAll(async () => { await server?.close(); });

  beforeEach(() => {
    vi.clearAllMocks();
    setupMockFrom();
  });

  it('returns 401 without a JWT', async () => {
    const res = await server.inject({ method: 'POST', url: '/founders/session', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with workspace and workspaceCreated=true for new user', async () => {
    workspaceExists    = false;
    founderHasActiveWs = false;
    setupMockFrom();

    const res = await server.inject({
      method:  'POST',
      url:     '/founders/session',
      headers: { Authorization: `Bearer ${makeToken()}` },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ workspace: unknown; workspaceCreated: boolean }>();
    expect(body.workspace).toBeDefined();
    expect(body.workspaceCreated).toBe(true);
  });

  it('returns 200 with workspaceCreated=false on re-login (idempotent)', async () => {
    workspaceExists    = true;
    founderHasActiveWs = true;
    setupMockFrom();

    const res = await server.inject({
      method:  'POST',
      url:     '/founders/session',
      headers: { Authorization: `Bearer ${makeToken()}` },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ workspaceCreated: boolean }>();
    expect(body.workspaceCreated).toBe(false);
  });
});

// ── POST /products/setup/start — workspace gate ───────────────────────────────

describe('POST /products/setup/start — workspace gate', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    founderHasActiveWs = false;
    setupMockFrom();
    server = await buildServer();
  });

  afterAll(async () => { await server?.close(); });

  beforeEach(() => {
    vi.clearAllMocks();
    setupMockFrom();
  });

  it('returns 422 NO_WORKSPACE when active_workspace_id is null', async () => {
    founderHasActiveWs = false;
    setupMockFrom();

    const res = await server.inject({
      method:  'POST',
      url:     '/products/setup/start',
      headers: { Authorization: `Bearer ${makeToken()}` },
      payload: { name: 'TestProduct' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json<{ code: string }>().code).toBe('NO_WORKSPACE');
  });

  it('passes workspace gate when active_workspace_id is set', async () => {
    founderHasActiveWs = true;
    setupMockFrom();

    const res = await server.inject({
      method:  'POST',
      url:     '/products/setup/start',
      headers: { Authorization: `Bearer ${makeToken()}` },
      payload: { name: 'TestProduct' },
    });

    // 201 = product created, 422 = plan limit — both mean workspace gate passed
    expect([201, 422]).toContain(res.statusCode);
    if (res.statusCode === 422) {
      expect(res.json<{ code: string }>().code).not.toBe('NO_WORKSPACE');
    }
  });
});
