/**
 * @file growthBrainDecisionAuthz.pg.test.ts
 * @description P0 GATE — who may decide (Phase 3.3D hardening §4).
 *
 *   MEASURED DEFECT (independent review): the decision route resolved a
 *   workspace context and then wrote with service_role. Any MEMBER — including
 *   a viewer — could therefore reach the mutation path. An owner decision is
 *   not a generic workspace edit: it authorises future action on the business.
 *
 *   FROZEN RULE: only OWNER and ADMIN may decide. EDITOR and VIEWER read only.
 *
 *   This drives the REAL route through buildServer() with a real Supabase auth
 *   user, because the guard lives on the route — the service-level suite calls
 *   the service directly and would not notice the guard disappearing.
 *
 * @security Enforcement happens BEFORE any service-role write.
 * @dependencies channels.route (real, via buildServer), local Postgres + Auth
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'crypto';
import type { FastifyInstance } from 'fastify';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
import { requirePostgres } from './helpers/requirePostgres';
import { persistRecommendations } from '../src/services/growthBrainDecisionService';
import type { GrowthBrainRecommendation } from '../src/services/growthBrainRecommendationService';

const uuidFrom = (s: string) => {
  const h = createHash('sha256').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/** One workspace per role, so a single signed-in user exercises all four. */
const ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;
type Role = typeof ROLES[number];
const WS: Record<Role, string> = {
  owner:  uuidFrom('gba-ws-owner'),  admin:  uuidFrom('gba-ws-admin'),
  editor: uuidFrom('gba-ws-editor'), viewer: uuidFrom('gba-ws-viewer'),
};
const PROD: Record<Role, string> = {
  owner:  uuidFrom('gba-p-owner'),  admin:  uuidFrom('gba-p-admin'),
  editor: uuidFrom('gba-p-editor'), viewer: uuidFrom('gba-p-viewer'),
};
/** Owns the non-owner workspaces, so the actor is a member rather than owner. */
const HOST = uuidFrom('gba-host-founder');
const EMAIL = `gba-lab-${Date.now()}-${process.pid}@lab.invalid`;
const PASSWORD = 'gba-lab-password-123!';

const db = () => getSupabaseAdmin();
const pg = requirePostgres();
const d = pg.available ? describe : describe.skip;

let server: FastifyInstance;
let actorId = '';
let token = '';
const recId: Partial<Record<Role, string>> = {};

async function must(label: string, p: PromiseLike<{ error: unknown }>) {
  const { error } = await p;
  if (error) throw new Error(`seed ${label}: ${(error as { message?: string }).message ?? String(error)}`);
}

const rec = (what: string): GrowthBrainRecommendation => ({
  type: 'RECOMMENDATION', actionType: 'RESEARCH', what,
  whyNow: 'because', nextStep: 'look into it',
  supportedBy: [{ kind: 'PRODUCT_CONTEXT', label: 'Your product profile', authority: null, memoryClass: null, evidenceCount: null, detail: null }],
  supporting: [], founderConflict: null, requiresFounderReview: false,
  expectedEffect: null, requiresApproval: false,
  evidenceStrength: 'limited evidence', confidence: null,
} as GrowthBrainRecommendation);

async function decide(role: Role) {
  return server.inject({
    method: 'POST',
    url: `/intelligence/recommendations/${recId[role]}/decision`,
    headers: { authorization: `Bearer ${token}`, 'x-launchmind-workspace-id': WS[role] },
    payload: { action: 'APPROVE' },
  });
}

d('Phase 3.3D — only OWNER and ADMIN may decide', () => {
  beforeAll(async () => {
    const { data: created, error } = await db().auth.admin.createUser({
      email: EMAIL, password: PASSWORD, email_confirm: true,
    });
    if (error || !created?.user) throw new Error(`auth user: ${error?.message}`);
    actorId = created.user.id;

    const res = await fetch(`${pg.url}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: pg.anonKey },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const body = await res.json() as { access_token?: string };
    if (!body.access_token) throw new Error('sign in failed');
    token = body.access_token;

    await must('founders(actor)', db().from('founders').upsert(
      { id: actorId, email: EMAIL, name: 'GBA ACTOR', plan: 'studio' }, { onConflict: 'id' }));
    await must('founders(host)', db().from('founders').upsert(
      { id: HOST, email: `gba-host-${Date.now()}@lab.invalid`, name: 'GBA HOST', plan: 'studio' }, { onConflict: 'id' }));

    for (const role of ROLES) {
      // The actor OWNS only the owner workspace; elsewhere they are a member
      // with the role under test.
      const ownerId = role === 'owner' ? actorId : HOST;
      await must('workspaces', db().from('workspaces').upsert(
        { id: WS[role], founder_id: ownerId, name: `GBA ${role}` }, { onConflict: 'id' }));
      await must('products', db().from('products').upsert({
        id: PROD[role], founder_id: ownerId, workspace_id: WS[role], name: `GBA ${role}`,
        store_url: 'https://gba.invalid', platform: 'app_store',
      }, { onConflict: 'id' }));
      await must('workspace_members', db().from('workspace_members').upsert({
        id: uuidFrom(`gba-mem-${role}`), workspace_id: WS[role], founder_id: actorId,
        role, accepted_at: new Date().toISOString(),
      }, { onConflict: 'id' }));

      const [row] = await persistRecommendations(
        { workspaceId: WS[role], founderId: ownerId, productId: PROD[role] },
        [rec(`GBA ${role} recommendation`)]);
      recId[role] = row.id;
    }

    const { buildServer } = await import('../src/server');
    server = await buildServer();
    await server.ready();
  }, 300_000);

  afterAll(async () => {
    await server?.close();
    await db().from('growth_brain_recommendations').delete().in('workspace_id', Object.values(WS));
    await db().from('workspace_members').delete().eq('founder_id', actorId);
    await db().from('products').delete().in('id', Object.values(PROD));
    await db().from('workspaces').delete().in('id', Object.values(WS));
    await db().from('founders').delete().in('id', [actorId, HOST]);
    if (actorId) await db().auth.admin.deleteUser(actorId).catch(() => {});
  });

  it('OWNER may decide', async () => {
    const res = await decide('owner');
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    expect(res.json().data.decisionStatus).toBe('APPROVED');
  }, 300_000);

  it('ADMIN may decide', async () => {
    const res = await decide('admin');
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    expect(res.json().data.decisionStatus).toBe('APPROVED');
  }, 300_000);

  it('EDITOR may NOT decide', async () => {
    const res = await decide('editor');
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('INSUFFICIENT_ROLE');
  }, 300_000);

  it('VIEWER may NOT decide', async () => {
    const res = await decide('viewer');
    expect(res.statusCode).toBe(403);
  }, 300_000);

  it('a refused decision leaves the row untouched', async () => {
    for (const role of ['editor', 'viewer'] as const) {
      const { data } = await db().from('growth_brain_recommendations')
        .select('decision_status').eq('id', recId[role]!).maybeSingle();
      expect((data as { decision_status: string }).decision_status).toBe('RECOMMENDED');
    }
  }, 300_000);

  it('DISMISS and DEFER follow the same authority policy', async () => {
    for (const action of ['DISMISS', 'DEFER'] as const) {
      const res = await server.inject({
        method: 'POST',
        url: `/intelligence/recommendations/${recId.viewer}/decision`,
        headers: { authorization: `Bearer ${token}`, 'x-launchmind-workspace-id': WS.viewer },
        payload: { action },
      });
      expect(res.statusCode, `${action} was allowed for a viewer`).toBe(403);
    }
  }, 300_000);

  it('a NON-MEMBER cannot reach another workspace at all', async () => {
    const stranger = uuidFrom('gba-stranger-ws');
    await must('workspaces', db().from('workspaces').upsert(
      { id: stranger, founder_id: HOST, name: 'GBA STRANGER' }, { onConflict: 'id' }));
    const res = await server.inject({
      method: 'POST',
      url: `/intelligence/recommendations/${recId.owner}/decision`,
      headers: { authorization: `Bearer ${token}`, 'x-launchmind-workspace-id': stranger },
      payload: { action: 'APPROVE' },
    });
    // 404, not 403: a non-member must not learn the workspace exists.
    expect(res.statusCode).toBe(404);
    await db().from('workspaces').delete().eq('id', stranger);
  }, 300_000);
});
