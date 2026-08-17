/**
 * @file morningBriefOnboardingIsolation.pg.test.ts
 * @description P0 GATE — Morning Brief onboarding state is business-specific.
 *
 *   MEASURED DEFECT (independent review of 3.3B): the brief read
 *
 *     onboarding_sessions .eq('founder_id') .in('current_state',
 *       ['PHASE_1_COMPLETE','DIRECTION_COMPLETE']) .limit(1)
 *
 *   founder-wide. ONE completed onboarding anywhere made `phase1Done` true for
 *   EVERY brief, so a second, untouched business reported
 *   `growthBrain.hasStrategy = true` and rendered a `phase1` payload it had
 *   never earned. 3.3B fixed the same table in intelligenceService and missed
 *   this one.
 *
 *   This drives the REAL route — buildServer(), the real jwtPlugin against a
 *   real local Supabase auth user, the real activeBusinessService resolution and
 *   the real handler queries. Nothing about the brief is reimplemented here; a
 *   helper that rebuilt the query would certify the helper, not the route.
 *
 * @security One founder, two businesses. A founder-wide read passes a naive
 *   tenant test, so state is asserted per-business.
 * @dependencies owner.route (real, via buildServer), local Postgres + Auth
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'crypto';
import type { FastifyInstance } from 'fastify';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
import { requirePostgres } from './helpers/requirePostgres';

const uuidFrom = (s: string) => {
  const h = createHash('sha256').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const WSA = uuidFrom('mboi-ws-a');
const WSB = uuidFrom('mboi-ws-b');
const PA  = uuidFrom('mboi-prod-a');
const PB  = uuidFrom('mboi-prod-b');
// Per-RUN email. `handle_new_user` writes a founders row on auth.users insert
// and `founders.email` is UNIQUE, so a stale row from an earlier run makes
// createUser fail with "Database error creating new user". Deleting that row is
// unreliable — it is referenced by several tables — so the collision is avoided
// rather than cleaned up after.
const EMAIL = `mboi-lab-${Date.now()}-${process.pid}@lab.invalid`;
const PASSWORD = 'mboi-lab-password-123!';

const pg = requirePostgres();
const d = pg.available ? describe : describe.skip;

let server: FastifyInstance;
let founderId = '';
let accessToken = '';
// `createClient` direct from supabase-js needs a ws shim on Node 20 here, which
// is why the codebase routes through getSupabaseAdmin. Same client, same env.
let admin: ReturnType<typeof getSupabaseAdmin>;

/** Best-effort removal of this run's lab founder and auth user. */
async function purgeByEmail() {
  const { data: existing } = await admin.from('founders').select('id').eq('email', EMAIL);
  for (const row of (existing ?? []) as Array<{ id: string }>) {
    await admin.from('onboarding_sessions').delete().eq('founder_id', row.id);
    await admin.from('products').delete().eq('founder_id', row.id);
    await admin.from('workspaces').delete().eq('founder_id', row.id);
    await admin.from('founders').delete().eq('id', row.id);
    await admin.auth.admin.deleteUser(row.id).catch(() => {});
  }
}

async function must(label: string, p: PromiseLike<{ error: unknown }>) {
  const { error } = await p;
  if (error) throw new Error(`seed ${label}: ${(error as { message?: string }).message ?? String(error)}`);
}

/** Points the founder's active-business pointer at one workspace/product. */
async function activate(ws: string, prod: string) {
  await must('founders.active', admin.from('founders')
    .update({ active_workspace_id: ws, active_product_id: prod }).eq('id', founderId));
}

/** Sets the onboarding state for ONE product. */
async function setOnboarding(ws: string, prod: string, state: string) {
  await must('onboarding_sessions', admin.from('onboarding_sessions').upsert({
    id: uuidFrom(`mboi-ob-${prod}`), founder_id: founderId,
    product_id: prod, workspace_id: ws, current_state: state,
  }, { onConflict: 'id' }));
}

async function brief(): Promise<Record<string, unknown>> {
  const res = await server.inject({
    method: 'GET', url: '/owner/brief',
    headers: { authorization: `Bearer ${accessToken}` },
  });
  expect(res.statusCode, `brief failed: ${res.body.slice(0, 300)}`).toBe(200);
  return res.json() as Record<string, unknown>;
}

const phase1Rendered = (b: Record<string, unknown>) => b.phase1 !== null && b.phase1 !== undefined;
const hasStrategy = (b: Record<string, unknown>) =>
  (b.growthBrain as { hasStrategy?: boolean } | undefined)?.hasStrategy === true;

d('Morning Brief — onboarding state does not cross businesses', () => {
  beforeAll(async () => {
    admin = getSupabaseAdmin();

    // A REAL auth user: jwtPlugin validates via supabase.auth.getUser, so a
    // hand-signed token would not exercise the real auth path.
    //
    // Cleanup must be BY EMAIL, not by a remembered id. `handle_new_user` fires
    // on auth.users insert and writes a `founders` row; `founders.email` is
    // UNIQUE. A leftover row from an earlier run therefore makes createUser fail
    // with "Database error creating new user" — the fixture worked once and then
    // never again. Clearing both sides by email makes it repeatable.
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email: EMAIL, password: PASSWORD, email_confirm: true,
    });
    if (cErr || !created?.user) throw new Error(`auth user: ${cErr?.message}`);
    founderId = created.user.id;

    // Real password grant against local GoTrue — the token must be one the
    // production jwtPlugin will actually accept via supabase.auth.getUser.
    const tokenRes = await fetch(`${pg.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: pg.anonKey },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const tokenBody = await tokenRes.json() as { access_token?: string; error_description?: string };
    if (!tokenBody.access_token) throw new Error(`sign in: ${tokenBody.error_description ?? tokenRes.status}`);
    accessToken = tokenBody.access_token;

    await must('founders', admin.from('founders').upsert(
      { id: founderId, email: EMAIL, name: 'MBOI LAB', plan: 'studio' }, { onConflict: 'id' }));
    for (const [ws, prod, name] of [[WSA, PA, 'MBOI A'], [WSB, PB, 'MBOI B']] as const) {
      await must('workspaces', admin.from('workspaces').upsert(
        { id: ws, founder_id: founderId, name }, { onConflict: 'id' }));
      await must('products', admin.from('products').upsert({
        id: prod, founder_id: founderId, workspace_id: ws, name,
        store_url: 'https://mboi.invalid', platform: 'app_store',
      }, { onConflict: 'id' }));
    }

    const { buildServer } = await import('../src/server');
    server = await buildServer();
    await server.ready();
  }, 300_000);

  afterAll(async () => {
    await server?.close();
    for (const p of [PA, PB]) await admin.from('onboarding_sessions').delete().eq('product_id', p);
    await admin.from('products').delete().in('id', [PA, PB]);
    await admin.from('workspaces').delete().in('id', [WSA, WSB]);
    await purgeByEmail();
  });

  it('B complete, A incomplete → A reports nothing from B', async () => {
    await setOnboarding(WSA, PA, 'WORKSPACE_SETUP');
    await setOnboarding(WSB, PB, 'PHASE_1_COMPLETE');

    await activate(WSA, PA);
    const a = await brief();
    expect(a.product).toMatchObject({ id: PA });
    expect(hasStrategy(a), 'A claimed hasStrategy from B\'s onboarding').toBe(false);
    expect(phase1Rendered(a), 'A rendered a phase1 payload it never earned').toBe(false);

    // ...and B, which really did complete, still reports correctly — so the
    // test cannot pass by simply reporting false everywhere.
    await activate(WSB, PB);
    const b = await brief();
    expect(b.product).toMatchObject({ id: PB });
    expect(hasStrategy(b)).toBe(true);
    expect(phase1Rendered(b)).toBe(true);
  }, 300_000);

  it('REVERSED — A complete, B incomplete → B reports nothing from A', async () => {
    await setOnboarding(WSA, PA, 'PHASE_1_COMPLETE');
    await setOnboarding(WSB, PB, 'WORKSPACE_SETUP');

    await activate(WSB, PB);
    const b = await brief();
    expect(b.product).toMatchObject({ id: PB });
    expect(hasStrategy(b), 'B claimed hasStrategy from A\'s onboarding').toBe(false);
    expect(phase1Rendered(b), 'B rendered a phase1 payload it never earned').toBe(false);

    await activate(WSA, PA);
    const a = await brief();
    expect(hasStrategy(a)).toBe(true);
    expect(phase1Rendered(a)).toBe(true);
  }, 300_000);

  it('DIRECTION_COMPLETE also does not cross', async () => {
    // SCHEMA INVARIANT discovered while writing this: migration 062 creates
    //   UNIQUE (founder_id) WHERE current_state != 'PHASE_1_COMPLETE'
    // so a founder may hold at most ONE non-complete session. "A mid-onboarding
    // while B sits at DIRECTION_COMPLETE" is therefore not representable at all
    // — the seed is rejected by the database, not by the brief.
    //
    // The crossing is instead tested with A holding NO session, which is both
    // valid and the stronger case: B is DIRECTION_COMPLETE and A has nothing.
    await admin.from('onboarding_sessions').delete().eq('product_id', PA);
    await setOnboarding(WSB, PB, 'DIRECTION_COMPLETE');

    await activate(WSA, PA);
    const a = await brief();
    expect(hasStrategy(a), 'A claimed strategy from B DIRECTION_COMPLETE').toBe(false);
    expect(phase1Rendered(a)).toBe(false);

    await activate(WSB, PB);
    const b = await brief();
    expect(hasStrategy(b)).toBe(true);
  }, 300_000);
});
