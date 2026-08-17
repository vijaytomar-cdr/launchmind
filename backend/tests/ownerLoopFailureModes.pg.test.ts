/**
 * @file ownerLoopFailureModes.pg.test.ts
 * @description Phase 3.3E §13 — the owner loop must FAIL CLOSED.
 *
 *   The principle under test: a provider, model or database failure may reduce
 *   what LaunchMind can say, but it must never manufacture a recommendation,
 *   a decision, provenance, confidence or execution state — and it must never
 *   silently overwrite server truth the owner already established.
 *
 *   The model is stubbed per-case to fail in a specific way. Everything else is
 *   the real route and the real database.
 *
 * @security Case "decision on a stale id" proves a failed mutation leaves the
 *   previously persisted decision intact.
 * @dependencies channels.route (real), local Postgres
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHash } from 'crypto';
import type { FastifyInstance } from 'fastify';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
import { requirePostgres } from './helpers/requirePostgres';

/** Behaviour is switched per test; the default is a total provider outage. */
const modelMode = { mode: 'outage' as 'outage' | 'malformed' | 'norefs' | 'badrefs' };

vi.mock('../src/lib/aiPlatform', () => ({
  callSonnet: vi.fn(async () => {
    switch (modelMode.mode) {
      case 'outage':    throw new Error('provider unavailable');
      case 'malformed': return 'this is not json at all {{{';
      case 'norefs':    return JSON.stringify({ recommendations: [{
        what: 'Do something uncited', whyNow: 'because', expectedEffect: null,
        nextStep: 'act', actionType: 'RESEARCH', supporting: [] }] });
      case 'badrefs':   return JSON.stringify({ recommendations: [{
        what: 'Cites imaginary evidence', whyNow: 'because', expectedEffect: null,
        nextStep: 'act', actionType: 'RESEARCH', evidenceRefs: ['ga4', 'stripe'],
        supporting: [{ type: 'OBSERVATION', text: 'Revenue grew 40%', evidenceRefs: ['ga4'] }] }] });
    }
  }),
  callHaiku: vi.fn(async () => '{}'),
  callMessages: vi.fn(async () => '{}'),
  generateAI: vi.fn(async () => ({ text: '{}' })),
}));

const uuidFrom = (s: string) => {
  const h = createHash('sha256').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const WS = uuidFrom('owlf-ws');
const PR = uuidFrom('owlf-prod');
const EMAIL = `owlf-lab-${Date.now()}-${process.pid}@lab.invalid`;
/**
 * Run-unique suffix for fixture CONTENT.
 *
 * Recommendation identity is a hash of the snapshot, so a fixture with fixed
 * text reuses whatever row a PREVIOUS run left behind — including one a failed
 * run left in a decided state, whose cleanup never executed. That is exactly
 * how this test inherited an APPROVED row from an earlier mutation run and then
 * failed for a reason that had nothing to do with the code under test.
 */
const RUN = `${Date.now()}-${process.pid}`;
const PASSWORD = 'owlf-lab-password-123!';

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

const hdr = () => ({ authorization: `Bearer ${token}`, 'x-launchmind-workspace-id': WS });

async function recommendations() {
  const res = await server.inject({ method: 'GET', url: '/intelligence/recommendations', headers: hdr() });
  return { status: res.statusCode, data: res.statusCode === 200 ? res.json().data : null };
}

d('Phase 3.3E — failure modes fail closed', () => {
  beforeAll(async () => {
    const { data: created, error } = await db().auth.admin.createUser({
      email: EMAIL, password: PASSWORD, email_confirm: true });
    if (error || !created?.user) throw new Error(`auth user: ${error?.message}`);
    actorId = created.user.id;
    const r = await fetch(`${pg.url}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: pg.anonKey },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
    token = ((await r.json()) as { access_token?: string }).access_token ?? '';
    if (!token) throw new Error('sign in failed');

    await must('founders', db().from('founders').upsert(
      { id: actorId, email: EMAIL, name: 'OWLF', plan: 'studio' }, { onConflict: 'id' }));
    await must('workspaces', db().from('workspaces').upsert(
      { id: WS, founder_id: actorId, name: 'OWLF WS' }, { onConflict: 'id' }));
    await must('products', db().from('products').upsert({
      id: PR, founder_id: actorId, workspace_id: WS, name: 'OWLF P',
      store_url: 'https://owlf.invalid', platform: 'app_store' }, { onConflict: 'id' }));
    const sid = uuidFrom('owlf-ses');
    await must('onboarding_sessions', db().from('onboarding_sessions').upsert({
      id: sid, founder_id: actorId, product_id: PR, workspace_id: WS,
      current_state: 'PHASE_1_COMPLETE' }, { onConflict: 'id' }));
    await must('founder_context', db().from('founder_context').upsert({
      id: uuidFrom('owlf-fc'), session_id: sid, founder_id: actorId, product_id: PR,
      workspace_id: WS, audience_confirmed: 'OWLF audience', context_delta: 'OWLF delta',
    }, { onConflict: 'id' }));

    const { buildServer } = await import('../src/server');
    server = await buildServer();
    await server.ready();
  }, 300_000);

  afterAll(async () => {
    await server?.close();
    await db().from('growth_brain_recommendations').delete().eq('workspace_id', WS);
    await db().from('founder_context').delete().eq('product_id', PR);
    await db().from('onboarding_sessions').delete().eq('product_id', PR);
    await db().from('products').delete().eq('id', PR);
    await db().from('workspaces').delete().eq('id', WS);
    await db().from('founders').delete().eq('id', actorId);
    if (actorId) await db().auth.admin.deleteUser(actorId).catch(() => {});
  });

  it('A — model outage returns an honest empty state, not a fabricated one', async () => {
    modelMode.mode = 'outage';
    const { status, data } = await recommendations();
    expect(status).toBe(200);                    // the page still loads
    expect(data.recommendations).toHaveLength(0);
    expect(data.reason).toBeTruthy();            // it says why
    expect(JSON.stringify(data)).not.toMatch(/\d+%/);
    expect(data.marketIntelligenceAvailable).toBe(false);
  }, 300_000);

  it('B — malformed model output produces no recommendation', async () => {
    modelMode.mode = 'malformed';
    const { status, data } = await recommendations();
    expect(status).toBe(200);
    expect(data.recommendations).toHaveLength(0);
    expect(data.reason).toBeTruthy();
  }, 300_000);

  it('C — no evidenceRefs at all → withheld, not shown ungrounded (P1-11)', async () => {
    modelMode.mode = 'norefs';
    const { data } = await recommendations();
    expect(data.recommendations).toHaveLength(0);
    expect(data.withheld.length).toBeGreaterThan(0);
    // The owner gets an explanation rather than a blank screen.
    expect(data.reason ?? data.unavailable.join(' ')).toBeTruthy();
  }, 300_000);

  it('D/E — nonexistent handles and a fabricated measurement are both refused', async () => {
    modelMode.mode = 'badrefs';
    const { data } = await recommendations();
    expect(JSON.stringify(data.recommendations)).not.toContain('40%');
    const kinds = (data.recommendations as Array<{ supportedBy: Array<{ kind: string }> }>)
      .flatMap(r => r.supportedBy.map(s => s.kind));
    expect(kinds).not.toContain('CAMPAIGN_PERFORMANCE');
    expect(kinds).not.toContain('MARKET_INTELLIGENCE');
  }, 300_000);

  it('G/H — a failed decision request preserves server truth', async () => {
    // Establish real truth first, with a model that works.
    modelMode.mode = 'badrefs';
    const { persistRecommendations } = await import('../src/services/growthBrainDecisionService');
    const [row] = await persistRecommendations(
      { workspaceId: WS, founderId: actorId, productId: PR },
      [{
        type: 'RECOMMENDATION', actionType: 'RESEARCH', what: `OWLF truth probe ${RUN}`,
        whyNow: 'w', nextStep: 'n', expectedEffect: null,
        supportedBy: [{ kind: 'FOUNDER_DIRECTION', label: 'Your confirmed direction' }],
        supporting: [], founderConflict: null, requiresFounderReview: false,
        requiresApproval: false, evidenceStrength: 'limited evidence', confidence: null,
      } as never]);
    const ok = await server.inject({ method: 'POST',
      url: `/intelligence/recommendations/${row.id}/decision`, headers: hdr(), payload: { action: 'APPROVE' } });
    expect(ok.statusCode).toBe(200);

    // A stale id fails and changes nothing.
    const stale = await server.inject({ method: 'POST',
      url: `/intelligence/recommendations/${uuidFrom('owlf-stale')}/decision`,
      headers: hdr(), payload: { action: 'APPROVE' } });
    expect(stale.statusCode).toBe(404);

    // An invalid verb fails and changes nothing.
    const bad = await server.inject({ method: 'POST',
      url: `/intelligence/recommendations/${row.id}/decision`,
      headers: hdr(), payload: { action: 'EXECUTE' } });
    expect(bad.statusCode).toBe(400);

    const { data } = await db().from('growth_brain_recommendations')
      .select('decision_status, execution_status').eq('id', row.id).maybeSingle();
    const r = data as Record<string, unknown>;
    expect(r.decision_status).toBe('APPROVED');
    expect(r.execution_status).toBe('NOT_STARTED');   // no approval was required
  }, 300_000);

  it('I — an unauthorized role cannot decide even when the model works', async () => {
    // Downgrade the actor to viewer on this workspace by adding a membership row
    // that is NOT ownership; ownership still wins, so use a separate workspace.
    const ws2 = uuidFrom('owlf-ws-viewer');
    const host = uuidFrom('owlf-host');
    await must('host', db().from('founders').upsert(
      { id: host, email: `owlf-host-${Date.now()}@lab.invalid`, name: 'H', plan: 'studio' }, { onConflict: 'id' }));
    await must('ws2', db().from('workspaces').upsert(
      { id: ws2, founder_id: host, name: 'OWLF VIEWER' }, { onConflict: 'id' }));
    const p2 = uuidFrom('owlf-prod2');
    await must('p2', db().from('products').upsert({
      id: p2, founder_id: host, workspace_id: ws2, name: 'P2',
      store_url: 'https://owlf.invalid', platform: 'app_store' }, { onConflict: 'id' }));
    await must('member', db().from('workspace_members').upsert({
      id: uuidFrom('owlf-mem'), workspace_id: ws2, founder_id: actorId,
      role: 'viewer', accepted_at: new Date().toISOString() }, { onConflict: 'id' }));

    const { persistRecommendations } = await import('../src/services/growthBrainDecisionService');
    const [row] = await persistRecommendations(
      { workspaceId: ws2, founderId: host, productId: p2 },
      [{
        type: 'RECOMMENDATION', actionType: 'RESEARCH', what: `OWLF viewer probe ${RUN}`,
        whyNow: 'w', nextStep: 'n', expectedEffect: null,
        supportedBy: [{ kind: 'PRODUCT_CONTEXT', label: 'Your product profile' }],
        supporting: [], founderConflict: null, requiresFounderReview: false,
        requiresApproval: false, evidenceStrength: 'limited evidence', confidence: null,
      } as never]);

    const res = await server.inject({ method: 'POST',
      url: `/intelligence/recommendations/${row.id}/decision`,
      headers: { authorization: `Bearer ${token}`, 'x-launchmind-workspace-id': ws2 },
      payload: { action: 'APPROVE' } });
    expect(res.statusCode).toBe(403);

    const { data } = await db().from('growth_brain_recommendations')
      .select('decision_status').eq('id', row.id).maybeSingle();
    const status = (data as Record<string, unknown>).decision_status;

    // Cleanup BEFORE asserting: a failing assertion must not leave a decided
    // row behind for the next run to inherit.
    await db().from('growth_brain_recommendations').delete().eq('workspace_id', ws2);
    await db().from('workspace_members').delete().eq('workspace_id', ws2);
    await db().from('products').delete().eq('id', p2);
    await db().from('workspaces').delete().eq('id', ws2);
    await db().from('founders').delete().eq('id', host);

    expect(status).toBe('RECOMMENDED');
  }, 300_000);
});
