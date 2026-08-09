/**
 * @file onboarding.test.ts
 * @description Tests for Phase 1 onboarding routes — full 16-step flow.
 *   Covers session management, discovery, report, beliefs, alignment, boundaries, direction.
 * @security All routes require JWT. Service enforces founder_id on every query.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';

const FOUNDER_ID  = 'f0000000-0000-0000-0000-000000000001';
const SESSION_ID  = 'se000000-0000-0000-0000-000000000001';
const DIRECTION_ID = 'd0000000-0000-0000-0000-000000000001';
const CLAIM_ID    = 'c0000000-0000-0000-0000-000000000001';
const JWT_SECRET  = 'test-jwt-secret-min-32-chars-long!!';

function makeToken(): string {
  return jwt.sign({ sub: FOUNDER_ID, role: 'authenticated' }, JWT_SECRET, { expiresIn: '1h' });
}

const MOCK_SESSION = {
  id: SESSION_ID,
  founder_id: FOUNDER_ID,
  workspace_id: null,
  product_id: null,
  current_state: 'WORKSPACE_SETUP',
  lock_version: 0,
  step_completed: 0,
  workspace_name: null,
  urls_submitted: null,
  private_description: null,
  completed_at: null,
  created_at: '2026-07-26T00:00:00Z',
  updated_at: '2026-07-26T00:00:00Z',
};

const MOCK_JOB = {
  id: 'job-001',
  session_id: SESSION_ID,
  founder_id: FOUNDER_ID,
  queue_job_id: null,
  status: 'queued',
  progress: 0,
  progress_stage: 0,
  progress_message: null,
  urls_submitted: ['https://apps.apple.com/app/test/id123'],
  private_description: null,
  detected_platform: null,
  store_url: null,
  website_url: null,
  candidate_matches: null,
  selected_match_id: null,
  app_metadata: null,
  icp_data: null,
  competitor_data: null,
  website_meta: null,
  report_data: null,
  report_acknowledged: false,
  error_code: null,
  error_message: null,
  retry_count: 0,
  max_retries: 3,
  last_attempted_at: null,
  ai_tokens_consumed: 0,
  created_at: '2026-07-26T00:00:00Z',
  updated_at: '2026-07-26T00:00:00Z',
};

const MOCK_CLAIM = {
  id: CLAIM_ID,
  session_id: SESSION_ID,
  founder_id: FOUNDER_ID,
  product_id: null,
  claim_type: 'INFERENCE',
  category: 'icp',
  title: 'Primary users are freelancers',
  body: 'Inferred from reviews',
  confidence: 0.8,
  evidence_sources: [{ type: 'review_analysis', count: 5, excerpt: 'sample' }],
  status: 'UNREVIEWED',
  original_value: null,
  corrected_value: null,
  founder_note: null,
  display_order: 0,
  created_at: '2026-07-26T00:00:00Z',
  updated_at: '2026-07-26T00:00:00Z',
};

const MOCK_DIRECTION = {
  id: DIRECTION_ID,
  session_id: SESSION_ID,
  founder_id: FOUNDER_ID,
  product_id: null,
  prompt_version: '1',
  input_snapshot: null,
  ai_model: 'claude-sonnet-4-6',
  headline: 'Focus on WhatsApp-first user activation',
  rationale: 'Your app excels at client management...',
  primary_channel: 'whatsapp',
  primary_market: 'india',
  week_1: { focus: 'Setup', tasks: ['Create WhatsApp Business account'], expectedOutcome: '50 new messages' },
  week_2: null, week_3: null, week_4: null,
  evidence_claim_ids: [],
  key_assumptions: ['Users prefer WhatsApp over email'],
  risk_flags: ['WhatsApp business API approval may take 2 weeks'],
  acknowledged_at: null,
  edited_at: null,
  edit_notes: null,
  ai_tokens_consumed: 50,
  status: 'ready',
  created_at: '2026-07-26T00:00:00Z',
  updated_at: '2026-07-26T00:00:00Z',
};

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../src/workers/discoveryWorker', () => ({
  enqueueDiscovery: vi.fn(async () => 'queue-job-id-001'),
  startDiscoveryWorker: vi.fn(),
}));

vi.mock('../src/lib/aiPlatform', () => ({
  callSonnet: vi.fn(async () => JSON.stringify({
    headline: 'Focus on WhatsApp-first user activation',
    rationale: 'Your app excels at client management.',
    primaryChannel: 'whatsapp',
    primaryMarket: 'india',
    week1: { focus: 'Setup', tasks: ['Create account'], expectedOutcome: '50 messages' },
    week2: { focus: 'Grow', tasks: ['Run campaign'], expectedOutcome: '100 messages' },
    week3: { focus: 'Retain', tasks: ['Follow up'], expectedOutcome: '70% retention' },
    week4: { focus: 'Optimize', tasks: ['A/B test'], expectedOutcome: 'Lower CPL' },
    keyAssumptions: ['Users prefer WhatsApp'],
    riskFlags: ['API approval delay'],
  })),
  callHaiku: vi.fn(async () => JSON.stringify({
    headline: 'Quick growth insight',
    summary: 'Solid opportunity in India market.',
    topInsights: ['Strong review sentiment'],
    opportunities: [{ title: 'WhatsApp', description: 'High engagement', confidence: 0.85 }],
    risks: [{ title: 'Competition', description: 'Three direct competitors' }],
  })),
}));

vi.mock('../src/lib/tokens', () => ({
  consumeTokens: vi.fn(async () => undefined),
}));

vi.mock('../src/workers/weeklyBriefWorker', () => ({
  startBriefWorker: vi.fn(),
}));

vi.mock('../src/workers/intakeWorker', () => ({
  startIntakeWorker: vi.fn(),
}));

vi.mock('../src/lib/scheduler', () => ({
  getBriefQueue: vi.fn(() => ({ client: Promise.resolve({}) })),
  scheduleWeeklyBrief: vi.fn(async () => undefined),
}));

// Supabase mock
const mockFrom = vi.fn();

vi.mock('../src/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: mockFrom,
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: FOUNDER_ID, email: 'test@example.com' } },
        error: null,
      })),
    },
  }),
}));

// ── Build server ──────────────────────────────────────────────────────────────

import { buildServer } from '../src/server';

describe('Phase 1 Onboarding routes', () => {
  let server: FastifyInstance;
  const token = makeToken();

  beforeAll(async () => {
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
  });

  // Helper: chain builder for Supabase mock
  function makeChain(data: unknown, error: null | { message: string } = null) {
    const terminal = () => Promise.resolve({ data, error });
    const chain: Record<string, unknown> = {};
    const methods = ['select','insert','update','upsert','delete','eq','neq','order','limit','is','not','single','maybeSingle'];
    for (const m of methods) {
      chain[m] = m === 'single' || m === 'maybeSingle' ? terminal : () => chain;
    }
    chain['single'] = terminal;
    chain['maybeSingle'] = terminal;
    return chain;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: return mock session for all table queries
    mockFrom.mockImplementation((table: string) => {
      if (table === 'onboarding_sessions') return makeChain(MOCK_SESSION);
      if (table === 'discovery_jobs') return makeChain(MOCK_JOB);
      if (table === 'product_claims') return makeChain([MOCK_CLAIM]);
      if (table === 'strategy_directions') return makeChain(MOCK_DIRECTION);
      if (table === 'workspaces') return makeChain({ id: 'ws-001', founder_id: FOUNDER_ID, name: 'Test WS' });
      if (table === 'founder_context') return makeChain({});
      if (table === 'business_goals') return makeChain({});
      if (table === 'competitor_relationships') return makeChain([]);
      if (table === 'approval_boundary_policies') return makeChain({});
      return makeChain(null);
    });
  });

  // ── Session ─────────────────────────────────────────────────────────────────

  describe('GET /onboarding/session', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({ method: 'GET', url: '/onboarding/session' });
      expect(res.statusCode).toBe(401);
    });

    it('returns 200 with session and nextRoute', async () => {
      const res = await server.inject({
        method: 'GET', url: '/onboarding/session',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: { session: unknown; nextRoute: string } }>();
      expect(body.data).toHaveProperty('session');
      expect(body.data).toHaveProperty('nextRoute');
    });
  });

  describe('GET /onboarding/sessions/:sessionId', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({ method: 'GET', url: `/onboarding/sessions/${SESSION_ID}` });
      expect(res.statusCode).toBe(401);
    });

    it('returns 200 with session', async () => {
      const res = await server.inject({
        method: 'GET', url: `/onboarding/sessions/${SESSION_ID}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: { session: { id: string } } }>();
      expect(body.data.session.id).toBe(SESSION_ID);
    });

    it('returns 404 when session not owned by founder', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'onboarding_sessions') return makeChain(null, { message: 'not found' });
        return makeChain(null);
      });
      const res = await server.inject({
        method: 'GET', url: `/onboarding/sessions/other-session-id`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Workspace ────────────────────────────────────────────────────────────────

  describe('POST /onboarding/sessions/:sessionId/workspace', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({
        method: 'POST', url: `/onboarding/sessions/${SESSION_ID}/workspace`,
        payload: { workspaceName: 'Test WS' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 400 for missing workspaceName', async () => {
      const res = await server.inject({
        method: 'POST', url: `/onboarding/sessions/${SESSION_ID}/workspace`,
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for short workspaceName', async () => {
      const res = await server.inject({
        method: 'POST', url: `/onboarding/sessions/${SESSION_ID}/workspace`,
        headers: { authorization: `Bearer ${token}` },
        payload: { workspaceName: 'X' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 200 with updated session on success', async () => {
      // transitionState: first call = getSession (needs WORKSPACE_SETUP), second = update result
      const updatedSession = { ...MOCK_SESSION, current_state: 'DISCOVERY_PENDING', workspace_name: 'Test WS', lock_version: 1 };
      const sessionCalls = [MOCK_SESSION, updatedSession];
      let sessionIdx = 0;
      mockFrom.mockImplementation((table: string) => {
        if (table === 'workspaces') return makeChain({ id: 'ws-001' });
        if (table === 'onboarding_sessions') return makeChain(sessionCalls[Math.min(sessionIdx++, 1)]);
        return makeChain(null);
      });

      const res = await server.inject({
        method: 'POST', url: `/onboarding/sessions/${SESSION_ID}/workspace`,
        headers: { authorization: `Bearer ${token}` },
        payload: { workspaceName: 'Test WS' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: { session: { current_state: string } } }>();
      expect(body.data.session.current_state).toBe('DISCOVERY_PENDING');
    });
  });

  // ── Discovery ────────────────────────────────────────────────────────────────

  describe('POST /onboarding/sessions/:sessionId/discovery', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({
        method: 'POST', url: `/onboarding/sessions/${SESSION_ID}/discovery`,
        payload: { urls: ['https://apps.apple.com/app/test/id123'] },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 400 for empty urls array', async () => {
      const res = await server.inject({
        method: 'POST', url: `/onboarding/sessions/${SESSION_ID}/discovery`,
        headers: { authorization: `Bearer ${token}` },
        payload: { urls: [] },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 422 for SSRF URL (localhost)', async () => {
      const res = await server.inject({
        method: 'POST', url: `/onboarding/sessions/${SESSION_ID}/discovery`,
        headers: { authorization: `Bearer ${token}` },
        payload: { urls: ['http://localhost:8080/evil'] },
      });
      expect(res.statusCode).toBe(422);
    });

    it('returns 201 with queued job for valid App Store URL', async () => {
      const discoverySessions = [
        { ...MOCK_SESSION, current_state: 'DISCOVERY_PENDING' },
        { ...MOCK_SESSION, current_state: 'DISCOVERY_IN_PROGRESS', lock_version: 1 },
      ];
      let sessionCallIdx = 0;

      mockFrom.mockImplementation((table: string) => {
        if (table === 'discovery_jobs') return makeChain(MOCK_JOB);
        if (table === 'onboarding_sessions') {
          const s = discoverySessions[sessionCallIdx] ?? discoverySessions[1];
          sessionCallIdx++;
          return makeChain(s);
        }
        return makeChain(null);
      });

      const res = await server.inject({
        method: 'POST', url: `/onboarding/sessions/${SESSION_ID}/discovery`,
        headers: { authorization: `Bearer ${token}` },
        payload: { urls: ['https://apps.apple.com/app/test/id123'] },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ data: { job: { status: string } } }>();
      expect(body.data.job.status).toBe('queued');
    });
  });

  describe('GET /onboarding/sessions/:sessionId/discovery', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({ method: 'GET', url: `/onboarding/sessions/${SESSION_ID}/discovery` });
      expect(res.statusCode).toBe(401);
    });

    it('returns 200 with job and sessionState', async () => {
      const res = await server.inject({
        method: 'GET', url: `/onboarding/sessions/${SESSION_ID}/discovery`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: { job: { id: string }; sessionState: string } }>();
      expect(body.data).toHaveProperty('job');
      expect(body.data).toHaveProperty('sessionState');
    });

    it('returns 404 when no discovery job exists', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'discovery_jobs') return makeChain(null, { message: 'not found' });
        if (table === 'onboarding_sessions') return makeChain(MOCK_SESSION);
        return makeChain(null);
      });
      const res = await server.inject({
        method: 'GET', url: `/onboarding/sessions/${SESSION_ID}/discovery`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Report ───────────────────────────────────────────────────────────────────

  describe('GET /onboarding/sessions/:sessionId/report', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({ method: 'GET', url: `/onboarding/sessions/${SESSION_ID}/report` });
      expect(res.statusCode).toBe(401);
    });

    it('returns 200 with report_data and acknowledged flag', async () => {
      const jobWithReport = {
        ...MOCK_JOB,
        report_data: {
          headline: 'Big growth opportunity',
          summary: 'Strong ICP signal detected.',
          topInsights: ['Insight 1'],
          opportunities: [{ title: 'WhatsApp', description: '...', confidence: 0.9 }],
          risks: [],
        },
        report_acknowledged: false,
      };
      mockFrom.mockImplementation((table: string) => {
        if (table === 'discovery_jobs') return makeChain(jobWithReport);
        if (table === 'onboarding_sessions') return makeChain(MOCK_SESSION);
        return makeChain(null);
      });

      const res = await server.inject({
        method: 'GET', url: `/onboarding/sessions/${SESSION_ID}/report`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: { report: { headline: string }; acknowledged: boolean } }>();
      expect(body.data.report.headline).toBe('Big growth opportunity');
      expect(body.data.acknowledged).toBe(false);
    });
  });

  describe('POST /onboarding/sessions/:sessionId/report/acknowledge', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({
        method: 'POST', url: `/onboarding/sessions/${SESSION_ID}/report/acknowledge`,
        payload: { acknowledged: true },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 400 if acknowledged is not true', async () => {
      const res = await server.inject({
        method: 'POST', url: `/onboarding/sessions/${SESSION_ID}/report/acknowledge`,
        headers: { authorization: `Bearer ${token}` },
        payload: { acknowledged: false },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 200 with acknowledged: true', async () => {
      // acknowledgeReport: getDiscoveryJob (discovery_jobs), discovery_jobs.update,
      // idempotency getSession (C1), transitionState: getSession (C2) + update (C3)
      const sessionPreReport = { ...MOCK_SESSION, current_state: 'PRELIMINARY_REPORT', lock_version: 0 };
      const sessionBelief    = { ...MOCK_SESSION, current_state: 'BELIEF_REVIEW', lock_version: 1 };
      const sessionCalls = [sessionPreReport, sessionPreReport, sessionBelief];
      let sessionIdx = 0;

      mockFrom.mockImplementation((table: string) => {
        if (table === 'discovery_jobs') return makeChain(MOCK_JOB);
        if (table === 'onboarding_sessions') return makeChain(sessionCalls[Math.min(sessionIdx++, 2)]);
        return makeChain(null);
      });

      const res = await server.inject({
        method: 'POST', url: `/onboarding/sessions/${SESSION_ID}/report/acknowledge`,
        headers: { authorization: `Bearer ${token}` },
        payload: { acknowledged: true },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: { acknowledged: boolean } }>();
      expect(body.data.acknowledged).toBe(true);
    });
  });

  // ── Claims ───────────────────────────────────────────────────────────────────

  describe('GET /onboarding/sessions/:sessionId/claims', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({ method: 'GET', url: `/onboarding/sessions/${SESSION_ID}/claims` });
      expect(res.statusCode).toBe(401);
    });

    it('returns 200 with claims array', async () => {
      const res = await server.inject({
        method: 'GET', url: `/onboarding/sessions/${SESSION_ID}/claims`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: { claims: unknown[] } }>();
      expect(Array.isArray(body.data.claims)).toBe(true);
    });
  });

  describe('PATCH /onboarding/sessions/:sessionId/claims/:claimId', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({
        method: 'PATCH', url: `/onboarding/sessions/${SESSION_ID}/claims/${CLAIM_ID}`,
        payload: { status: 'CONFIRMED' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 400 for invalid status', async () => {
      const res = await server.inject({
        method: 'PATCH', url: `/onboarding/sessions/${SESSION_ID}/claims/${CLAIM_ID}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { status: 'INVALID_STATUS' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 200 with updated claim on CONFIRMED', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'product_claims') return makeChain({ ...MOCK_CLAIM, status: 'CONFIRMED' });
        if (table === 'onboarding_sessions') return makeChain(MOCK_SESSION);
        return makeChain(null);
      });

      const res = await server.inject({
        method: 'PATCH', url: `/onboarding/sessions/${SESSION_ID}/claims/${CLAIM_ID}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { status: 'CONFIRMED' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: { claim: { status: string } } }>();
      expect(body.data.claim.status).toBe('CONFIRMED');
    });

    it('returns 200 with updated claim on CORRECTED with correctedValue', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'product_claims') return makeChain({ ...MOCK_CLAIM, status: 'CORRECTED', corrected_value: 'New value' });
        return makeChain(null);
      });

      const res = await server.inject({
        method: 'PATCH', url: `/onboarding/sessions/${SESSION_ID}/claims/${CLAIM_ID}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { status: 'CORRECTED', correctedValue: 'New value' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: { claim: { status: string; corrected_value: string } } }>();
      expect(body.data.claim.corrected_value).toBe('New value');
    });
  });

  describe('POST /onboarding/sessions/:sessionId/claims/complete', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({ method: 'POST', url: `/onboarding/sessions/${SESSION_ID}/claims/complete` });
      expect(res.statusCode).toBe(401);
    });

    it('returns 200 transitioning to ALIGNMENT_AUDIENCE', async () => {
      // completeBeliefReview: idempotency getSession (C1), transitionState: getSession (C2) + update (C3)
      const sessionBelief = { ...MOCK_SESSION, current_state: 'BELIEF_REVIEW', lock_version: 0 };
      const sessionNext   = { ...MOCK_SESSION, current_state: 'ALIGNMENT_AUDIENCE', lock_version: 1 };
      const sessionCalls  = [sessionBelief, sessionBelief, sessionNext];
      let idx = 0;

      mockFrom.mockImplementation((table: string) => {
        if (table === 'onboarding_sessions') return makeChain(sessionCalls[Math.min(idx++, 2)]);
        return makeChain(null);
      });

      const res = await server.inject({
        method: 'POST', url: `/onboarding/sessions/${SESSION_ID}/claims/complete`,
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: { nextState: string } }>();
      expect(body.data.nextState).toBe('ALIGNMENT_AUDIENCE');
    });
  });

  // ── Alignment steps ───────────────────────────────────────────────────────────

  describe('PUT /onboarding/sessions/:sessionId/audience', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({ method: 'PUT', url: `/onboarding/sessions/${SESSION_ID}/audience`, payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it('returns 400 for missing audienceConfirmed', async () => {
      const res = await server.inject({
        method: 'PUT', url: `/onboarding/sessions/${SESSION_ID}/audience`,
        headers: { authorization: `Bearer ${token}` },
        payload: { audienceAdditions: 'Just some notes' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 200 and transitions to ALIGNMENT_CONTEXT', async () => {
      // saveAudience: upsert founder_context, idempotency getSession (C1),
      // transitionState: getSession (C2) + update (C3)
      const sessionAudience = { ...MOCK_SESSION, current_state: 'ALIGNMENT_AUDIENCE', lock_version: 0 };
      const sessionNext     = { ...MOCK_SESSION, current_state: 'ALIGNMENT_CONTEXT', lock_version: 1 };
      const sessionCalls    = [sessionAudience, sessionAudience, sessionNext];
      let idx = 0;

      mockFrom.mockImplementation((table: string) => {
        if (table === 'onboarding_sessions') return makeChain(sessionCalls[Math.min(idx++, 2)]);
        if (table === 'founder_context') return makeChain({});
        return makeChain(null);
      });

      const res = await server.inject({
        method: 'PUT', url: `/onboarding/sessions/${SESSION_ID}/audience`,
        headers: { authorization: `Bearer ${token}` },
        payload: { audienceConfirmed: 'Freelancers and small agency owners managing 5-20 clients' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: { saved: boolean; nextState: string } }>();
      expect(body.data.saved).toBe(true);
      expect(body.data.nextState).toBe('ALIGNMENT_CONTEXT');
    });
  });

  describe('PUT /onboarding/sessions/:sessionId/context-delta', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({ method: 'PUT', url: `/onboarding/sessions/${SESSION_ID}/context-delta`, payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it('returns 400 for short contextDelta', async () => {
      const res = await server.inject({
        method: 'PUT', url: `/onboarding/sessions/${SESSION_ID}/context-delta`,
        headers: { authorization: `Bearer ${token}` },
        payload: { contextDelta: 'Short' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 200 on valid contextDelta', async () => {
      // saveContextDelta: upsert founder_context, idempotency getSession (C1),
      // transitionState: getSession (C2) + update (C3)
      const sessionCtx = { ...MOCK_SESSION, current_state: 'ALIGNMENT_CONTEXT', lock_version: 0 };
      const sessionNext = { ...MOCK_SESSION, current_state: 'ALIGNMENT_GOAL', lock_version: 1 };
      let idx = 0;

      mockFrom.mockImplementation((table: string) => {
        if (table === 'onboarding_sessions') { idx++; return makeChain(idx <= 2 ? sessionCtx : sessionNext); }
        if (table === 'founder_context') return makeChain({});
        return makeChain(null);
      });

      const res = await server.inject({
        method: 'PUT', url: `/onboarding/sessions/${SESSION_ID}/context-delta`,
        headers: { authorization: `Bearer ${token}` },
        payload: { contextDelta: 'We have a strong community of 2000 power users who evangelize the product organically.' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: { saved: boolean } }>();
      expect(body.data.saved).toBe(true);
    });
  });

  describe('PUT /onboarding/sessions/:sessionId/goal', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({ method: 'PUT', url: `/onboarding/sessions/${SESSION_ID}/goal`, payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it('returns 400 for missing targetValue', async () => {
      const res = await server.inject({
        method: 'PUT', url: `/onboarding/sessions/${SESSION_ID}/goal`,
        headers: { authorization: `Bearer ${token}` },
        payload: { goalType: 'installs', unit: 'installs/month' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 200 on valid goal', async () => {
      // saveGoal: explicit getSession (C1), business_goals.upsert, transitionState (getSession C2 + update C3)
      const sessionGoal = { ...MOCK_SESSION, current_state: 'ALIGNMENT_GOAL', lock_version: 0 };
      const sessionNext = { ...MOCK_SESSION, current_state: 'ALIGNMENT_COMPETITORS', lock_version: 1 };
      const sessionCalls = [sessionGoal, sessionGoal, sessionNext];
      let idx = 0;

      mockFrom.mockImplementation((table: string) => {
        if (table === 'onboarding_sessions') return makeChain(sessionCalls[Math.min(idx++, 2)]);
        if (table === 'business_goals') return makeChain({});
        return makeChain(null);
      });

      const res = await server.inject({
        method: 'PUT', url: `/onboarding/sessions/${SESSION_ID}/goal`,
        headers: { authorization: `Bearer ${token}` },
        payload: { goalType: 'installs', targetValue: 1000, unit: 'installs/month', timeHorizonDays: 30 },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: { saved: boolean } }>();
      expect(body.data.saved).toBe(true);
    });
  });

  describe('PUT /onboarding/sessions/:sessionId/competitors', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({ method: 'PUT', url: `/onboarding/sessions/${SESSION_ID}/competitors`, payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it('returns 200 with empty competitors array (no competitors)', async () => {
      // saveCompetitors: explicit getSession (C1), delete/insert, transitionState (getSession C2 + update C3)
      const sessionComp = { ...MOCK_SESSION, current_state: 'ALIGNMENT_COMPETITORS', lock_version: 0 };
      const sessionNext = { ...MOCK_SESSION, current_state: 'BOUNDARIES_SETUP', lock_version: 1 };
      const sessionCalls = [sessionComp, sessionComp, sessionNext];
      let idx = 0;

      mockFrom.mockImplementation((table: string) => {
        if (table === 'onboarding_sessions') return makeChain(sessionCalls[Math.min(idx++, 2)]);
        if (table === 'competitor_relationships') return makeChain([]);
        return makeChain(null);
      });

      const res = await server.inject({
        method: 'PUT', url: `/onboarding/sessions/${SESSION_ID}/competitors`,
        headers: { authorization: `Bearer ${token}` },
        payload: { competitors: [] },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: { nextState: string } }>();
      expect(body.data.nextState).toBe('BOUNDARIES_SETUP');
    });
  });

  // ── Boundaries ────────────────────────────────────────────────────────────────

  describe('PUT /onboarding/sessions/:sessionId/boundaries', () => {
    const validBoundaries = {
      workingStyle: 'balanced',
      notificationCadence: 'weekly',
      weeklySpendCapUsd: 200,
      weeklySpendCapInr: 10000,
      founderAcknowledged: true,
    };

    it('returns 401 without token', async () => {
      const res = await server.inject({ method: 'PUT', url: `/onboarding/sessions/${SESSION_ID}/boundaries`, payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it('returns 400 if founderAcknowledged is false (§1.5 gate)', async () => {
      const res = await server.inject({
        method: 'PUT', url: `/onboarding/sessions/${SESSION_ID}/boundaries`,
        headers: { authorization: `Bearer ${token}` },
        payload: { ...validBoundaries, founderAcknowledged: false },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 200 with nextState FINAL_REVIEW when acknowledged', async () => {
      // saveBoundaries: idempotency getSession (C1), upsert founder_context,
      // insert approval_boundary_policies, transitionState: getSession (C2) + update (C3)
      const sessionBound = { ...MOCK_SESSION, current_state: 'BOUNDARIES_SETUP', lock_version: 0 };
      const sessionNext = { ...MOCK_SESSION, current_state: 'FINAL_REVIEW', lock_version: 1 };
      let idx = 0;

      mockFrom.mockImplementation((table: string) => {
        if (table === 'onboarding_sessions') { idx++; return makeChain(idx <= 2 ? sessionBound : sessionNext); }
        if (table === 'founder_context') return makeChain({});
        if (table === 'approval_boundary_policies') return makeChain({});
        return makeChain(null);
      });

      const res = await server.inject({
        method: 'PUT', url: `/onboarding/sessions/${SESSION_ID}/boundaries`,
        headers: { authorization: `Bearer ${token}` },
        payload: validBoundaries,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: { nextState: string } }>();
      expect(body.data.nextState).toBe('FINAL_REVIEW');
    });
  });

  // ── Direction ─────────────────────────────────────────────────────────────────

  describe('POST /onboarding/sessions/:sessionId/direction', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({ method: 'POST', url: `/onboarding/sessions/${SESSION_ID}/direction` });
      expect(res.statusCode).toBe(401);
    });

    it('returns 202 with generating status', async () => {
      // POST /direction always returns 202 immediately; generation runs in setImmediate background.
      // prepareDirection: getSession (C1), transitionState DIRECTION_GENERATING: getSession (C2) + update (C3)
      const sessionFinal      = { ...MOCK_SESSION, current_state: 'FINAL_REVIEW',          lock_version: 0 };
      const sessionGenerating = { ...MOCK_SESSION, current_state: 'DIRECTION_GENERATING',   lock_version: 1 };
      const sessionComplete   = { ...MOCK_SESSION, current_state: 'DIRECTION_COMPLETE',     lock_version: 2 };
      const sessionCalls = [sessionFinal, sessionFinal, sessionGenerating, sessionGenerating, sessionComplete];
      let idx = 0;

      mockFrom.mockImplementation((table: string) => {
        if (table === 'onboarding_sessions') return makeChain(sessionCalls[Math.min(idx++, 4)]);
        if (table === 'discovery_jobs') return makeChain({ ...MOCK_JOB, app_metadata: { name: 'TestApp' } });
        if (table === 'product_claims') return makeChain([]);
        if (table === 'founder_context') return makeChain({ working_style: 'balanced', context_delta: 'Strong community' });
        if (table === 'business_goals') return makeChain({ goal_type: 'installs', target_value: 1000, unit: 'installs', time_horizon_days: 30 });
        if (table === 'competitor_relationships') return makeChain([]);
        if (table === 'strategy_directions') return makeChain(MOCK_DIRECTION);
        return makeChain(null);
      });

      const res = await server.inject({
        method: 'POST', url: `/onboarding/sessions/${SESSION_ID}/direction`,
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });
      expect(res.statusCode).toBe(202);
      const body = res.json<{ data: { status: string } }>();
      expect(body.data.status).toBe('generating');
    });
  });

  describe('GET /onboarding/sessions/:sessionId/direction', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({ method: 'GET', url: `/onboarding/sessions/${SESSION_ID}/direction` });
      expect(res.statusCode).toBe(401);
    });

    it('returns 200 with direction', async () => {
      const res = await server.inject({
        method: 'GET', url: `/onboarding/sessions/${SESSION_ID}/direction`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: { direction: { id: string } | null } }>();
      expect(body.data).toHaveProperty('direction');
    });
  });

  // ── Complete Phase 1 ──────────────────────────────────────────────────────────

  describe('POST /onboarding/sessions/:sessionId/complete', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({
        method: 'POST', url: `/onboarding/sessions/${SESSION_ID}/complete`,
        payload: { directionId: DIRECTION_ID, acknowledgedDirection: true },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 400 for missing directionId', async () => {
      const res = await server.inject({
        method: 'POST', url: `/onboarding/sessions/${SESSION_ID}/complete`,
        headers: { authorization: `Bearer ${token}` },
        payload: { acknowledgedDirection: true },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 if acknowledgedDirection is not true', async () => {
      const res = await server.inject({
        method: 'POST', url: `/onboarding/sessions/${SESSION_ID}/complete`,
        headers: { authorization: `Bearer ${token}` },
        payload: { directionId: DIRECTION_ID, acknowledgedDirection: false },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 200 with nextRoute /dashboard/brief on completion', async () => {
      const sessionDirComplete = { ...MOCK_SESSION, current_state: 'DIRECTION_COMPLETE', lock_version: 0 };
      const sessionPhase1 = { ...MOCK_SESSION, current_state: 'PHASE_1_COMPLETE', lock_version: 1 };
      let idx = 0;

      mockFrom.mockImplementation((table: string) => {
        if (table === 'onboarding_sessions') { idx++; return makeChain(idx === 1 ? sessionDirComplete : sessionPhase1); }
        if (table === 'strategy_directions') return makeChain({});
        return makeChain(null);
      });

      const res = await server.inject({
        method: 'POST', url: `/onboarding/sessions/${SESSION_ID}/complete`,
        headers: { authorization: `Bearer ${token}` },
        payload: { directionId: DIRECTION_ID, acknowledgedDirection: true },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: { nextRoute: string } }>();
      expect(body.data.nextRoute).toBe('/dashboard/brief');
    });
  });

  // ── Discovery retry and select ────────────────────────────────────────────────

  describe('POST /onboarding/sessions/:sessionId/discovery/retry', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({ method: 'POST', url: `/onboarding/sessions/${SESSION_ID}/discovery/retry` });
      expect(res.statusCode).toBe(401);
    });

    it('returns 409 when job is not in failed state', async () => {
      const res = await server.inject({
        method: 'POST', url: `/onboarding/sessions/${SESSION_ID}/discovery/retry`,
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });
      expect(res.statusCode).toBe(409);
    });
  });

  describe('POST /onboarding/sessions/:sessionId/discovery/select', () => {
    it('returns 401 without token', async () => {
      const res = await server.inject({
        method: 'POST', url: `/onboarding/sessions/${SESSION_ID}/discovery/select`,
        payload: { matchId: 'match-001' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 400 for missing matchId', async () => {
      const res = await server.inject({
        method: 'POST', url: `/onboarding/sessions/${SESSION_ID}/discovery/select`,
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
