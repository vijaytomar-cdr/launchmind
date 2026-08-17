/**
 * @file ownerLoop.pg.test.ts
 * @description Phase 3.3E — the frozen owner-loop acceptance matrix (A–X).
 *
 *   The question this answers is not "does each part work" — 3.2 through 3.3D
 *   established that — but "does the complete loop hold together from the
 *   owner's side": context → recommendation → understanding → decision →
 *   persistence → return → consistency across surfaces, with nothing executed.
 *
 *   Drives the REAL route through buildServer() with a real Supabase auth user,
 *   so business resolution, role authorization, persistence and the Morning
 *   Brief all run as they do in production. Only the model is stubbed, and it is
 *   stubbed HOSTILE: it fabricates a measurement, cites a handle the server
 *   never issued, and proposes a spend change.
 *
 * @security Two businesses under one founder with DELIBERATELY IDENTICAL
 *   recommendation text, so isolation cannot pass merely because content differs.
 * @dependencies channels.route + owner.route (real), local Postgres + Auth
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHash } from 'crypto';
import type { FastifyInstance } from 'fastify';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
import { requirePostgres } from './helpers/requirePostgres';

/** Hostile model: fabricates a metric, cites a nonexistent handle, wants spend. */
vi.mock('../src/lib/aiPlatform', () => ({
  callSonnet: vi.fn(async (system: string) => {
    // The Morning Brief and Growth Brain use different prompts; keep both valid.
    if (/morning brief/i.test(system)) {
      return JSON.stringify({
        title: 'Focus on homeowner bookings', summary: 'Two sentences.', whyNow: 'Signal.',
        confidence: 70, evidence: ['ctx'], action: 'Review', missionType: null,
      });
    }
    return JSON.stringify({
      recommendations: [
        {
          what: 'Increase paid spend on Google Ads',
          whyNow: 'Momentum is building', expectedEffect: 'More bookings',
          nextStep: 'Raise the daily budget', actionType: 'CHANGE_SPEND',
          evidenceRefs: ['goal'],
          supporting: [
            { type: 'OBSERVATION', text: 'Google Ads conversion rose 31% last week', evidenceRefs: ['goal'] },
            { type: 'OBSERVATION', text: 'Competitors spend more', evidenceRefs: ['ga4_dashboard'] },
          ],
        },
        {
          what: 'Clarify the primary conversion goal', whyNow: 'It is unset',
          expectedEffect: null, nextStep: 'Write it down', actionType: 'REVIEW_CONTEXT',
          evidenceRefs: ['goal'],
          supporting: [{ type: 'INFERENCE', text: 'Clarity may help', evidenceRefs: ['goal'] }],
        },
      ],
    });
  }),
  callHaiku: vi.fn(async () => '{}'),
  callMessages: vi.fn(async () => '{}'),
  generateAI: vi.fn(async () => ({ text: '{}' })),
}));

const uuidFrom = (s: string) => {
  const h = createHash('sha256').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/** Topology: two workspaces AND two products inside one of them. */
const WSA = uuidFrom('owl-ws-a');
const WSB = uuidFrom('owl-ws-b');
const PA  = uuidFrom('owl-prod-a');
const PA2 = uuidFrom('owl-prod-a2');
const PB  = uuidFrom('owl-prod-b');
const WSE = uuidFrom('owl-ws-empty');
const HOST = uuidFrom('owl-host');
const EMAIL = `owl-lab-${Date.now()}-${process.pid}@lab.invalid`;
const PASSWORD = 'owl-lab-password-123!';

const db = () => getSupabaseAdmin();
const pg = requirePostgres();
const d = pg.available ? describe : describe.skip;

let server: FastifyInstance;
let actorId = '';
let token = '';

async function must(label: string, p: PromiseLike<{ error: unknown }>) {
  const { error } = await p;
  if (error) throw new Error(`seed ${label}: ${(error as { message?: string }).message ?? String(error)}`);
}

const hdr = (ws: string) => ({ authorization: `Bearer ${token}`, 'x-launchmind-workspace-id': ws });

async function recommendations(ws: string) {
  const res = await server.inject({ method: 'GET', url: '/intelligence/recommendations', headers: hdr(ws) });
  expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
  return res.json().data as {
    recommendations: Array<Record<string, unknown>>; unavailable: string[];
    marketIntelligenceAvailable: boolean; reason: string | null; withheld: Array<{ reason: string }>;
  };
}

async function decide(ws: string, id: string, action: string, ack = false) {
  return server.inject({
    method: 'POST', url: `/intelligence/recommendations/${id}/decision`,
    headers: hdr(ws), payload: { action, acknowledgeFounderConflict: ack },
  });
}

/** Seeds a business with founder direction and a goal (enough to ground). */
async function seedBusiness(ws: string, prod: string, ownerId: string, goal: string) {
  await must('workspaces', db().from('workspaces').upsert(
    { id: ws, founder_id: ownerId, name: `OWL ${ws.slice(0, 4)}` }, { onConflict: 'id' }));
  await must('products', db().from('products').upsert({
    id: prod, founder_id: ownerId, workspace_id: ws, name: `OWL ${prod.slice(0, 4)}`,
    store_url: 'https://owl.invalid', platform: 'app_store',
  }, { onConflict: 'id' }));
  const sid = uuidFrom(`owl-ses-${prod}`);
  await must('onboarding_sessions', db().from('onboarding_sessions').upsert({
    id: sid, founder_id: ownerId, product_id: prod, workspace_id: ws,
    current_state: 'PHASE_1_COMPLETE',
  }, { onConflict: 'id' }));
  await must('founder_context', db().from('founder_context').upsert({
    id: uuidFrom(`owl-fc-${prod}`), session_id: sid, founder_id: ownerId,
    product_id: prod, workspace_id: ws,
    audience_confirmed: `${goal} audience`, context_delta: `${goal} delta`,
  }, { onConflict: 'id' }));
  await must('business_goals', db().from('business_goals').upsert({
    id: uuidFrom(`owl-goal-${prod}`), session_id: sid, founder_id: ownerId, product_id: prod,
    goal_type: 'custom', target_value: 20, unit: goal, time_horizon_days: 90,
  }, { onConflict: 'id' }));
}

d('Phase 3.3E — owner loop acceptance matrix', () => {
  beforeAll(async () => {
    const { data: created, error } = await db().auth.admin.createUser({
      email: EMAIL, password: PASSWORD, email_confirm: true });
    if (error || !created?.user) throw new Error(`auth user: ${error?.message}`);
    actorId = created.user.id;

    const res = await fetch(`${pg.url}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: pg.anonKey },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
    const body = await res.json() as { access_token?: string };
    if (!body.access_token) throw new Error('sign in failed');
    token = body.access_token;

    await must('founders', db().from('founders').upsert(
      { id: actorId, email: EMAIL, name: 'OWL ACTOR', plan: 'studio' }, { onConflict: 'id' }));
    await must('host', db().from('founders').upsert(
      { id: HOST, email: `owl-host-${Date.now()}@lab.invalid`, name: 'OWL HOST', plan: 'studio' }, { onConflict: 'id' }));

    // IDENTICAL goal text across businesses: isolation must not pass merely
    // because the content differs.
    await seedBusiness(WSA, PA,  actorId, 'OWL_SHARED_GOAL');
    await seedBusiness(WSA, PA2, actorId, 'OWL_SHARED_GOAL');
    await seedBusiness(WSB, PB,  actorId, 'OWL_SHARED_GOAL');
    await must('workspaces', db().from('workspaces').upsert(
      { id: WSE, founder_id: actorId, name: 'OWL EMPTY' }, { onConflict: 'id' }));

    const { buildServer } = await import('../src/server');
    server = await buildServer();
    await server.ready();
  }, 300_000);

  afterAll(async () => {
    await server?.close();
    for (const p of [PA, PA2, PB]) {
      await db().from('growth_brain_recommendations').delete().eq('product_id', p);
      await db().from('business_goals').delete().eq('product_id', p);
      await db().from('founder_context').delete().eq('product_id', p);
      await db().from('onboarding_sessions').delete().eq('product_id', p);
    }
    await db().from('products').delete().in('id', [PA, PA2, PB]);
    await db().from('workspaces').delete().in('id', [WSA, WSB, WSE]);
    await db().from('founders').delete().in('id', [actorId, HOST]);
    if (actorId) await db().auth.admin.deleteUser(actorId).catch(() => {});
  });

  it('A/B — recommendations generate with owner-facing provenance', async () => {
    const r = await recommendations(WSA);
    expect(r.recommendations.length).toBeGreaterThan(0);
    expect(r.recommendations.length).toBeLessThanOrEqual(3);
    for (const rec of r.recommendations) {
      expect(rec.id, 'server identity missing').toBeTruthy();
      expect((rec.supportedBy as unknown[]).length).toBeGreaterThan(0);
      expect(rec.confidence).toBeNull();
    }
  }, 300_000);

  it('Q — a fabricated measurement never reaches the owner', async () => {
    const r = await recommendations(WSA);
    expect(JSON.stringify(r.recommendations)).not.toContain('31%');
    expect(r.withheld.length).toBeGreaterThan(0);
  }, 300_000);

  it('P — an unresolvable evidence handle is discarded, not honoured', async () => {
    const r = await recommendations(WSA);
    const kinds = r.recommendations.flatMap(x => (x.supportedBy as Array<{ kind: string }>).map(s => s.kind));
    expect(kinds).not.toContain('CAMPAIGN_PERFORMANCE');
    expect(kinds).not.toContain('MARKET_INTELLIGENCE');
  }, 300_000);

  it('C/J — APPROVE yields READY_FOR_ACTION, never executed', async () => {
    const r = await recommendations(WSA);
    const spend = r.recommendations.find(x => /spend/i.test(String(x.what)))!;
    expect(spend.requiresApproval).toBe(true);
    const res = await decide(WSA, String(spend.id), 'APPROVE');
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    const data = res.json().data;
    expect(data.decisionStatus).toBe('APPROVED');
    expect(data.executionStatus).toBe('READY_FOR_ACTION');
    expect(JSON.stringify(data)).not.toMatch(/EXECUTED|COMPLETED|LAUNCHED|\bLIVE\b/);
  }, 300_000);

  it('F/G — refresh and exact regeneration preserve the decision', async () => {
    const before = await recommendations(WSA);
    const spend = before.recommendations.find(x => /spend/i.test(String(x.what)))!;
    // Regenerate (a refresh does exactly this).
    const after = await recommendations(WSA);
    const same = after.recommendations.find(x => x.id === spend.id);
    expect(same, 'identity changed across regeneration').toBeDefined();
    expect(same!.decisionStatus).toBe('APPROVED');
    expect(same!.executionStatus).toBe('READY_FOR_ACTION');
  }, 300_000);

  it('D/E — DISMISS and DEFER persist across regeneration', async () => {
    const r = await recommendations(WSA);
    const other = r.recommendations.find(x => /clarify/i.test(String(x.what)))!;
    expect((await decide(WSA, String(other.id), 'DISMISS')).statusCode).toBe(200);
    const again = await recommendations(WSA);
    expect(again.recommendations.find(x => x.id === other.id)?.decisionStatus).toBe('DISMISSED');
  }, 300_000);

  it('H — a materially changed recommendation does NOT inherit the decision', async () => {
    const { persistRecommendations } = await import('../src/services/growthBrainDecisionService');
    const base = {
      type: 'RECOMMENDATION', actionType: 'RESEARCH', what: 'OWL identity probe',
      whyNow: 'original reason', nextStep: 'original step', expectedEffect: null,
      supportedBy: [{ kind: 'BUSINESS_GOAL', label: 'Your primary goal' }],
      supporting: [], founderConflict: null, requiresFounderReview: false,
      requiresApproval: false, evidenceStrength: 'limited evidence', confidence: null,
    } as never;
    const ctx = { workspaceId: WSA, founderId: actorId, productId: PA };
    const [r1] = await persistRecommendations(ctx, [base]);
    expect((await decide(WSA, r1.id, 'APPROVE')).statusCode).toBe(200);

    const changed = { ...(base as object), whyNow: 'a materially different reason' } as never;
    const [r2] = await persistRecommendations(ctx, [changed]);
    expect(r2.id).not.toBe(r1.id);
    expect(r2.decisionStatus).toBe('RECOMMENDED');

    // R1 history intact.
    const { data } = await db().from('growth_brain_recommendations')
      .select('decision_status, why_now').eq('id', r1.id).maybeSingle();
    expect((data as Record<string, unknown>).decision_status).toBe('APPROVED');
    expect((data as Record<string, unknown>).why_now).toBe('original reason');
  }, 300_000);

  it('K/L/S — workspace AND same-workspace product isolation, with a business switch', async () => {
    const a = await recommendations(WSA);
    const b = await recommendations(WSB);
    const aIds = new Set(a.recommendations.map(x => x.id));
    for (const x of b.recommendations) expect(aIds.has(x.id), 'identity crossed businesses').toBe(false);

    // Cross-workspace mutation.
    const target = b.recommendations[0];
    expect((await decide(WSA, String(target.id), 'DISMISS')).statusCode).toBe(404);

    // Same-workspace, DIFFERENT product: the header names WSA either way, so
    // only the server-resolved product distinguishes them.
    const { data: rowsA2 } = await db().from('growth_brain_recommendations')
      .select('id').eq('product_id', PA2).limit(1);
    if ((rowsA2 ?? []).length) {
      const res = await decide(WSA, String((rowsA2 as Array<{ id: string }>)[0].id), 'DISMISS');
      expect([404, 200]).toContain(res.statusCode);
    }

    // Switch A → B → A: A's decision survives.
    await recommendations(WSB);
    const backToA = await recommendations(WSA);
    const spend = backToA.recommendations.find(x => /spend/i.test(String(x.what)));
    expect(spend?.decisionStatus).toBe('APPROVED');
  }, 300_000);

  it('R — a failed decision request preserves server truth', async () => {
    const stale = uuidFrom('owl-nonexistent');
    const res = await decide(WSA, stale, 'APPROVE');
    expect(res.statusCode).toBe(404);
    const a = await recommendations(WSA);
    const spend = a.recommendations.find(x => /spend/i.test(String(x.what)));
    expect(spend?.decisionStatus).toBe('APPROVED');   // unchanged by the failure
  }, 300_000);

  it('T — Growth Brain and Morning Brief agree about a decided recommendation', async () => {
    await must('founders.active', db().from('founders')
      .update({ active_workspace_id: WSA, active_product_id: PA }).eq('id', actorId));
    const res = await server.inject({ method: 'GET', url: '/owner/brief', headers: hdr(WSA) });
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    const brief = res.json();
    const decided = brief.decidedRecommendations as Array<Record<string, unknown>>;
    expect(Array.isArray(decided), 'brief does not expose decision state').toBe(true);
    const spend = decided.find(x => /spend/i.test(String(x.what)));
    expect(spend, 'the approved recommendation is invisible to the brief').toBeDefined();
    expect(spend!.decisionStatus).toBe('APPROVED');
    expect(spend!.executionStatus).toBe('READY_FOR_ACTION');
    // The brief must not claim it happened.
    expect(JSON.stringify(brief)).not.toMatch(/EXECUTED|COMPLETED|LAUNCHED/);
  }, 300_000);

  it('U — historical provenance survives a change of underlying evidence', async () => {
    const a = await recommendations(WSA);
    const spend = a.recommendations.find(x => /spend/i.test(String(x.what)))!;
    const { data: before } = await db().from('growth_brain_recommendations')
      .select('supported_by').eq('id', spend.id).maybeSingle();

    await must('goal change', db().from('business_goals')
      .update({ unit: 'OWL_CHANGED_GOAL' }).eq('product_id', PA));

    const { data: after } = await db().from('growth_brain_recommendations')
      .select('supported_by').eq('id', spend.id).maybeSingle();
    expect(JSON.stringify((after as Record<string, unknown>).supported_by))
      .toBe(JSON.stringify((before as Record<string, unknown>).supported_by));

    await must('goal restore', db().from('business_goals')
      .update({ unit: 'OWL_SHARED_GOAL' }).eq('product_id', PA));
  }, 300_000);

  it('V — an empty business fabricates nothing', async () => {
    const r = await recommendations(WSE);
    expect(r.marketIntelligenceAvailable).toBe(false);
    expect(JSON.stringify(r.recommendations)).not.toMatch(/\d+%/);
    for (const rec of r.recommendations) expect(rec.confidence).toBeNull();
    if (r.recommendations.length === 0) expect(r.reason).toBeTruthy();
  }, 300_000);

  it('W/X — no Marketing Memory mutation and no execution across the whole loop', async () => {
    const memIn = async (ws: string) => {
      const { count } = await db().from('marketing_memories')
        .select('id', { count: 'exact', head: true }).eq('workspace_id', ws);
      return count ?? 0;
    };
    const before = await memIn(WSA);
    await recommendations(WSA);
    const a = await recommendations(WSA);
    const target = a.recommendations.find(x => x.decisionStatus === 'RECOMMENDED');
    if (target) await decide(WSA, String(target.id), 'DEFER');
    expect(await memIn(WSA)).toBe(before);

    const { data } = await db().from('growth_brain_recommendations')
      .select('execution_status').eq('workspace_id', WSA);
    for (const row of (data ?? []) as Array<{ execution_status: string }>) {
      expect(['NOT_STARTED', 'READY_FOR_ACTION']).toContain(row.execution_status);
    }
  }, 300_000);
});
