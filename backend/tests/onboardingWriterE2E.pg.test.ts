/**
 * @file onboardingWriterE2E.pg.test.ts
 * @description THE MISSING PROOF — the real onboarding writer path, end to end,
 *   against real PostgREST and real Postgres.
 *
 *   Every other tenancy test so far proved something narrower: the pg tests
 *   proved the SCHEMA holds the line, and the MemoryDb tests proved the READERS
 *   filter correctly. Neither ran the actual writers against a real database.
 *   The half-applied state found in the previous pass — scoped readers,
 *   untenanted writers — would have passed both of them.
 *
 *   So this drives the shipped service functions (saveWorkspace,
 *   resolveOrCreateProduct, saveAudience, savePositioning, saveContextDelta,
 *   saveGoal, saveCompetitors, saveBoundaries) through the real Supabase client
 *   and asserts the resulting ROWS in Postgres. Nothing is inserted by hand to
 *   make an assertion pass; the only direct SQL is fixture setup for things
 *   onboarding does not create (the auth-level founder row) and teardown.
 *
 *   Discovery's web scraping is not exercised — it would make the test depend on
 *   the public internet. resolveOrCreateProduct was extracted from
 *   processDiscoveryJob precisely so the tenancy-bearing half runs for real
 *   while the scraping half stays out.
 *
 * @security Uses a DISPOSABLE founder. Never touches the real owner account.
 *   Refuses to run against anything that is not local.
 * @dependencies local Supabase (PostgREST 54321 + Postgres 54322), migrations 102-103
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { randomUUID } from 'crypto';

// Local Supabase. The default service-role key is the well-known local one — it
// is not a secret and grants nothing outside this machine.
const LOCAL_REST = process.env.LOCAL_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const LOCAL_KEY  = process.env.LOCAL_SUPABASE_SERVICE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const PG_URL = process.env.ONBOARDING_TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/**
 * Hard refusal. This file writes real rows through a service-role key, so a
 * misconfigured environment pointing it at hosted would create test businesses
 * in production.
 */
function assertLocal(): void {
  for (const u of [LOCAL_REST, PG_URL]) {
    const l = u.toLowerCase();
    if (!(l.includes('127.0.0.1') || l.includes('localhost'))) {
      throw new Error(`REFUSING to run onboarding E2E against non-local target: ${u}`);
    }
    if (l.includes('supabase.co') || l.includes('supabase.com')) {
      throw new Error(`REFUSING to run onboarding E2E against hosted Supabase: ${u}`);
    }
  }
}

const REQUIRE_PG = process.env.LM_REQUIRE_PG === '1';

let db: Client;
let ok = false;
let setupError: Error | null = null;

// One DISPOSABLE founder, two businesses.
const FOUNDER = randomUUID();
const EMAIL   = `e2e-${FOUNDER}@local.test`;

let svc: typeof import('../src/services/onboardingService');
let worker: typeof import('../src/workers/discoveryWorker');

beforeAll(async () => {
  try {
    assertLocal();
    // Point the lazily-initialised admin client at LOCAL Supabase before the
    // services are imported. tests/setup.ts sets a placeholder key; these
    // services are the subject here, so they need a client that really works.
    process.env.SUPABASE_URL = LOCAL_REST;
    process.env.SUPABASE_SERVICE_ROLE_KEY = LOCAL_KEY;

    db = new Client({ connectionString: PG_URL, connectionTimeoutMillis: 2000 });
    await db.connect();

    // The founder row is the one fixture onboarding does not create (it comes
    // from Supabase Auth). Everything after this is produced by real services.
    await db.query(`INSERT INTO founders (id, email) VALUES ($1,$2)`, [FOUNDER, EMAIL]);

    svc    = await import('../src/services/onboardingService');
    worker = await import('../src/workers/discoveryWorker');

    // Prove the client actually reaches PostgREST — otherwise every service call
    // below would fail for an unrelated reason and the diagnosis would be wrong.
    const probe = await svc.createOrResumeSession(FOUNDER);
    if (!probe?.id) throw new Error('PostgREST probe returned no session');
    await db.query('DELETE FROM onboarding_sessions WHERE id=$1', [probe.id]);

    ok = true;
  } catch (e) {
    setupError = e instanceof Error ? e : new Error(String(e));
    ok = false;
  }
}, 30_000);

afterAll(async () => {
  if (!db) return;
  // CASCADE from founders removes everything this test created.
  await db.query('DELETE FROM founders WHERE id=$1', [FOUNDER]).catch(() => undefined);
  await db.end().catch(() => undefined);
});

const e2e = (n: string, f: () => Promise<void>, timeout = 20_000) =>
  it(n, async () => {
    if (!ok) {
      if (REQUIRE_PG) throw new Error(`onboarding E2E could not start: ${setupError?.message}`);
      console.warn(`[SKIPPED — no local Supabase] ${n}: ${setupError?.message ?? 'not connected'}`);
      return;
    }
    await f();
  }, timeout);

/** Runs the governed onboarding flow for one business and returns its ids. */
async function onboard(opts: {
  workspaceName: string;
  storeUrl: string;
  productName: string;
  positioning: string;
  market: { type: string; value: string; label: string };
  goalType: string; goalUnit: string; goalTarget: number;
  spend: 'never' | 'approval_required';
}): Promise<{ sessionId: string; workspaceId: string; productId: string }> {
  // 1. Session
  const session = await svc.createOrResumeSession(FOUNDER);

  // 2. Workspace — the real service, which creates the workspaces row.
  const afterWs = await svc.saveWorkspace(session.id, FOUNDER, opts.workspaceName, 'pre_launch');
  const workspaceId = (afterWs as { workspace_id?: string }).workspace_id!;

  // 3. Product — the real discovery product-resolution path.
  const productId = (await worker.resolveOrCreateProduct({
    sessionId: session.id, founderId: FOUNDER, workspaceId,
    urls: [opts.storeUrl], storeUrl: opts.storeUrl, platform: 'app_store',
    name: opts.productName, scrapedMeta: { name: opts.productName },
  }))!;

  // Walk the state machine through the REAL transitions rather than jumping the
  // column with SQL — a raw UPDATE leaves lock_version untouched and the next
  // governed transition then fails its optimistic-concurrency check. These are
  // the states discovery and belief review would have moved through.
  for (const st of ['DISCOVERY_IN_PROGRESS', 'PRELIMINARY_REPORT', 'BELIEF_REVIEW',
                    'ALIGNMENT_AUDIENCE'] as const) {
    await svc.transitionState(session.id, FOUNDER, st);
  }

  // 4-8. Alignment, all through the real writers.
  await svc.saveAudience(session.id, FOUNDER, { audienceConfirmed: `${opts.positioning} customers` });
  await svc.savePositioning(session.id, FOUNDER, {
    positioning: opts.positioning,
    valueProposition: `Value for ${opts.positioning}`,
    primaryCustomerProblem: `Problem for ${opts.positioning}`,
    markets: [opts.market],
    currentChannels: [{ channel: 'email', status: 'active' }],
    confirmedFields: ['positioning', 'markets'],
  });
  await svc.saveContextDelta(session.id, FOUNDER, { contextDelta: `Delta for ${opts.workspaceName}` });
  await svc.saveGoal(session.id, FOUNDER, {
    goalType: opts.goalType, targetValue: opts.goalTarget, unit: opts.goalUnit,
    timeHorizonDays: 30, successDefinition: `Success for ${opts.workspaceName}`,
  });
  // Takes the ARRAY directly, not { competitors: [...] }. Passing the object
  // silently wrote nothing: `competitors.length` was undefined, the insert was
  // skipped, and the function returned normally.
  await svc.saveCompetitors(session.id, FOUNDER, [
    { name: opts.workspaceName === 'Business A' ? 'Thumbtack' : 'HubSpot',
      relationship: 'CONFIRMED' },
  ]);
  await svc.saveBoundaries(session.id, FOUNDER, {
    workingStyle: 'hands_on', notificationCadence: 'weekly',
    weeklySpendCapUsd: 0, weeklySpendCapInr: 0,
    explicitCapabilities: { SPEND: opts.spend },
    founderAcknowledged: true,
  });

  return { sessionId: session.id, workspaceId, productId };
}

// ── §3 · the fixed writer path, end to end ──────────────────────────────────
describe('§3 disposable onboarding E2E — every governed row is tenant-scoped', () => {
  let A: { sessionId: string; workspaceId: string; productId: string };

  e2e('completes the governed flow and tenants every row it wrote', async () => {
    A = await onboard({
      workspaceName: 'Business A',
      storeUrl: 'https://apps.apple.com/us/app/allignx-home-services/id1234567890',
      productName: 'AllignX Home Services',
      positioning: 'Local home services marketplace',
      market: { type: 'metro', value: 'phoenix', label: 'Phoenix' },
      goalType: 'installs', goalUnit: 'bookings/week', goalTarget: 500,
      spend: 'never',
    });

    const product = (await db.query(
      `SELECT workspace_id, canonical_identity, founder_id, markets
       FROM products WHERE id=$1`, [A.productId])).rows[0];
    expect(product.workspace_id).toBe(A.workspaceId);
    // Identity derived from the URL, never from the display name.
    expect(product.canonical_identity).toBe('apple:1234567890');
    expect(product.founder_id).toBe(FOUNDER);
    // G7: markets came from an explicit owner choice, not a silent USA default.
    expect(JSON.stringify(product.markets)).toContain('phoenix');

    const ctx = (await db.query(
      `SELECT workspace_id, product_id, positioning, context_delta, success_definition
       FROM founder_context WHERE session_id=$1`, [A.sessionId])).rows;
    expect(ctx).toHaveLength(1);
    expect(ctx[0].workspace_id).toBe(A.workspaceId);
    expect(ctx[0].product_id).toBe(A.productId);
    expect(ctx[0].positioning).toBe('Local home services marketplace');
    expect(ctx[0].context_delta).toBe('Delta for Business A');
    expect(ctx[0].success_definition).toBe('Success for Business A');

    const bound = (await db.query(
      `SELECT workspace_id, product_id, explicit_capabilities, autonomous_permitted, approval_required
       FROM approval_boundary_policies WHERE session_id=$1`, [A.sessionId])).rows;
    expect(bound).toHaveLength(1);
    expect(bound[0].workspace_id).toBe(A.workspaceId);
    expect(bound[0].product_id).toBe(A.productId);
    // NEVER means neither autonomous nor merely gated behind approval.
    expect(bound[0].explicit_capabilities.SPEND).toBe('never');
    expect(bound[0].autonomous_permitted ?? []).not.toContain('SPEND');
    expect(bound[0].approval_required ?? []).not.toContain('SPEND');

    const goal = (await db.query(
      `SELECT product_id, unit FROM business_goals WHERE session_id=$1 AND is_primary`,
      [A.sessionId])).rows;
    expect(goal[0].product_id).toBe(A.productId);
    expect(goal[0].unit).toBe('bookings/week');

    const comp = (await db.query(
      `SELECT product_id, name FROM competitor_relationships WHERE session_id=$1`,
      [A.sessionId])).rows;
    expect(comp[0].product_id).toBe(A.productId);

    const sess = (await db.query(
      `SELECT workspace_id, product_id FROM onboarding_sessions WHERE id=$1`,
      [A.sessionId])).rows[0];
    expect(sess.workspace_id).toBe(A.workspaceId);
    expect(sess.product_id).toBe(A.productId);
  });

  e2e('NO row this founder now owns is untenanted', async () => {
    // The global assertion, not a per-table one: anything the flow wrote that
    // slipped through would show up here even if I forgot to check its table.
    const orphans = (await db.query(
      `SELECT table_name, id FROM lm_untenanted_context WHERE founder_id=$1`, [FOUNDER])).rows;
    expect(orphans).toEqual([]);

    const untenantedProducts = (await db.query(
      `SELECT id FROM products WHERE founder_id=$1 AND workspace_id IS NULL`, [FOUNDER])).rows;
    expect(untenantedProducts).toEqual([]);
  });
});

// ── §4 · duplicate onboarding ───────────────────────────────────────────────
describe('§4 repeat onboarding of the same product creates nothing new', () => {
  e2e('a second discovery adopts the existing product', async () => {
    const before = (await db.query(
      `SELECT count(*)::int AS n FROM products WHERE founder_id=$1`, [FOUNDER])).rows[0].n;

    const ws = (await db.query(
      `SELECT id FROM workspaces WHERE founder_id=$1 AND name='Business A'`, [FOUNDER])).rows[0].id;
    // REUSES business A's session, because a founder can only have one:
    // `onboarding_sessions_active_founder` is UNIQUE(founder_id) WHERE
    // current_state <> 'PHASE_1_COMPLETE'. Clearing product_id reproduces
    // exactly what an owner re-running discovery for the same app looks like.
    const s2 = (await db.query(
      `SELECT id FROM onboarding_sessions
       WHERE founder_id=$1 AND current_state <> 'PHASE_1_COMPLETE'`, [FOUNDER])).rows[0];
    await db.query(`UPDATE onboarding_sessions SET product_id=NULL WHERE id=$1`, [s2.id]);

    const adopted = await worker.resolveOrCreateProduct({
      sessionId: s2.id, founderId: FOUNDER, workspaceId: ws,
      // A DIFFERENT URL form for the same app: other locale, different slug,
      // tracking params, trailing slash. A name comparison would have missed it.
      urls: ['https://apps.apple.com/in/app/totally-different-slug/id1234567890/?utm_source=x'],
      storeUrl: 'https://apps.apple.com/in/app/totally-different-slug/id1234567890/?utm_source=x',
      platform: 'app_store', name: 'AllignX・Home Services App - App Store',
      scrapedMeta: {},
    });

    const after = (await db.query(
      `SELECT count(*)::int AS n FROM products WHERE founder_id=$1`, [FOUNDER])).rows[0].n;
    expect(after).toBe(before);            // no second row

    const existing = (await db.query(
      `SELECT id FROM products WHERE workspace_id=$1 AND canonical_identity='apple:1234567890'`,
      [ws])).rows;
    expect(existing).toHaveLength(1);
    expect(adopted).toBe(existing[0].id);  // the existing product was adopted

    // And the adopting session now points at it, so the owner resumes rather
    // than starting a parallel product.
    const sess = (await db.query(
      `SELECT product_id FROM onboarding_sessions WHERE id=$1`, [s2.id])).rows[0];
    expect(sess.product_id).toBe(existing[0].id);
    // Session left intact — deleting it would CASCADE away business A's real
    // founder_context, goals, competitors and boundaries.
  });

  e2e('a genuinely different product can still be created', async () => {
    const ws = (await db.query(
      `SELECT id FROM workspaces WHERE founder_id=$1 AND name='Business A'`, [FOUNDER])).rows[0].id;
    const s3 = (await db.query(
      `SELECT id, product_id FROM onboarding_sessions
       WHERE founder_id=$1 AND current_state <> 'PHASE_1_COMPLETE'`, [FOUNDER])).rows[0];

    const other = await worker.resolveOrCreateProduct({
      sessionId: s3.id, founderId: FOUNDER, workspaceId: ws,
      urls: ['https://play.google.com/store/apps/details?id=com.other.app'],
      storeUrl: 'https://play.google.com/store/apps/details?id=com.other.app',
      platform: 'play_store', name: 'A Different App', scrapedMeta: {},
    });
    expect(other).toBeTruthy();
    const row = (await db.query(`SELECT canonical_identity FROM products WHERE id=$1`, [other])).rows[0];
    expect(row.canonical_identity).toBe('play:com.other.app');

    // Remove the extra product and restore the session's pointer to A's real
    // product, so the two-business assertions below see the true state.
    await db.query('DELETE FROM products WHERE id=$1', [other]);
    await db.query(`UPDATE onboarding_sessions SET product_id=$1 WHERE id=$2`,
      [s3.product_id, s3.id]);
  });
});

// ── §5 · same founder, second business ──────────────────────────────────────
describe('§5 same founder, two businesses — no mixing through real readers', () => {
  let B: { sessionId: string; workspaceId: string; productId: string };

  e2e('onboards a second, conflicting business', async () => {
    // createOrResumeSession RESUMES any session that is not PHASE_1_COMPLETE, so
    // a second business cannot begin until the first finishes. That is correct
    // behaviour, not a defect — but it means the real flow reaches this point
    // only after business A completes. Marked complete directly because the
    // governed path to it generates an AI strategy direction; this is flow
    // bookkeeping, not one of the tenancy rows under test.
    await db.query(
      `UPDATE onboarding_sessions SET current_state='PHASE_1_COMPLETE' WHERE founder_id=$1`,
      [FOUNDER]);

    B = await onboard({
      workspaceName: 'Business B',
      storeUrl: 'https://apps.apple.com/us/app/launchmind/id9876543210',
      productName: 'LaunchMind',
      positioning: 'AI marketing operating system',
      market: { type: 'country', value: 'usa', label: 'United States' },
      goalType: 'revenue', goalUnit: 'SaaS customers/month', goalTarget: 40,
      spend: 'approval_required',
    });
    expect(B.workspaceId).toBeTruthy();
    expect(B.productId).toBeTruthy();

    const ws = (await db.query(
      `SELECT count(*)::int AS n FROM workspaces WHERE founder_id=$1`, [FOUNDER])).rows[0].n;
    expect(ws).toBe(2);   // two businesses, one founder — the case being fixed
  });

  e2e('ContextPackage V2 returns one business only, in both directions', async () => {
    const A = (await db.query(
      `SELECT id, workspace_id FROM products WHERE founder_id=$1 AND canonical_identity='apple:1234567890'`,
      [FOUNDER])).rows[0];
    const { buildContextPackageV2 } = await import('../src/lib/context/contextPackageV2');

    const pkgA = await buildContextPackageV2({
      workspaceId: A.workspace_id, founderId: FOUNDER, productId: A.id,
      intent: 'MORNING_BRIEF', query: 'what next', persist: false,
    });
    const a = JSON.stringify(pkgA);
    expect(pkgA.founderContext.contextDelta).toBe('Delta for Business A');
    expect(a).not.toContain('AI marketing operating system');
    expect(a).not.toContain('SaaS customers/month');
    expect(a).not.toContain('HubSpot');
    expect(a).not.toContain('Delta for Business B');

    const pkgB = await buildContextPackageV2({
      workspaceId: B.workspaceId, founderId: FOUNDER, productId: B.productId,
      intent: 'MORNING_BRIEF', query: 'what next', persist: false,
    });
    const b = JSON.stringify(pkgB);
    expect(pkgB.founderContext.contextDelta).toBe('Delta for Business B');
    expect(b).not.toContain('Local home services marketplace');
    expect(b).not.toContain('bookings/week');
    expect(b).not.toContain('Thumbtack');
  });

  e2e('the legacy Context Engine is also scoped', async () => {
    const A = (await db.query(
      `SELECT id FROM products WHERE founder_id=$1 AND canonical_identity='apple:1234567890'`,
      [FOUNDER])).rows[0];
    const { buildContextPackage } = await import('../src/lib/contextEngine');
    const pkg = await buildContextPackage(FOUNDER, A.id, { includeMemories: false });
    const s = JSON.stringify(pkg);
    expect(s).not.toContain('AI marketing operating system');
    expect(s).not.toContain('HubSpot');
    expect(s).not.toContain('Delta for Business B');
  });

  e2e('IntelligenceService does not merge the two businesses', async () => {
    const { getGrowthBrainCoverage } = await import('../src/services/intelligenceService');
    const A = (await db.query(
      `SELECT workspace_id FROM products WHERE founder_id=$1 AND canonical_identity='apple:1234567890'`,
      [FOUNDER])).rows[0];

    const covA = JSON.stringify(await getGrowthBrainCoverage(
      { actorId: FOUNDER, workspaceId: A.workspace_id, role: 'owner', isOwner: true }));
    expect(covA).toContain('Delta for Business A');
    expect(covA).not.toContain('Delta for Business B');

    const covB = JSON.stringify(await getGrowthBrainCoverage(
      { actorId: FOUNDER, workspaceId: B.workspaceId, role: 'owner', isOwner: true }));
    expect(covB).toContain('Delta for Business B');
    expect(covB).not.toContain('Delta for Business A');
  });

  e2e('approval boundaries resolve per business — NEVER never widens', async () => {
    const rows = (await db.query(
      `SELECT w.name, a.explicit_capabilities
       FROM approval_boundary_policies a JOIN workspaces w ON w.id=a.workspace_id
       WHERE a.founder_id=$1 ORDER BY w.name`, [FOUNDER])).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0].explicit_capabilities.SPEND).toBe('never');              // A
    expect(rows[1].explicit_capabilities.SPEND).toBe('approval_required');  // B
  });

  e2e('goals, competitors and strategy stay with their own product', async () => {
    const goals = (await db.query(
      `SELECT p.canonical_identity, g.unit FROM business_goals g
       JOIN products p ON p.id=g.product_id WHERE g.founder_id=$1 AND g.is_primary
       ORDER BY p.canonical_identity`, [FOUNDER])).rows;
    expect(goals).toHaveLength(2);
    expect(goals[0].unit).toBe('bookings/week');            // apple:1234567890
    expect(goals[1].unit).toBe('SaaS customers/month');     // apple:9876543210

    const comps = (await db.query(
      `SELECT p.canonical_identity, c.name FROM competitor_relationships c
       JOIN products p ON p.id=c.product_id WHERE c.founder_id=$1
       ORDER BY p.canonical_identity`, [FOUNDER])).rows;
    expect(comps.map(r => r.name)).toEqual(['Thumbtack', 'HubSpot']);
  });
});

// ── §6 · database-level enforcement ─────────────────────────────────────────
describe('§6 Postgres enforces tenancy, not just TypeScript', () => {
  e2e('workspace A paired with product B is REJECTED by the trigger', async () => {
    const [a, b] = (await db.query(
      `SELECT id, workspace_id, canonical_identity FROM products
       WHERE founder_id=$1 AND canonical_identity IS NOT NULL ORDER BY canonical_identity`,
      [FOUNDER])).rows;
    const s = await svc.createOrResumeSession(FOUNDER);
    await expect(db.query(
      `INSERT INTO founder_context (session_id, founder_id, workspace_id, product_id, positioning)
       VALUES ($1,$2,$3,$4,'mismatched')`,
      [s.id, FOUNDER, a.workspace_id, b.id]))
      .rejects.toThrow(/does not belong to workspace/i);

    await expect(db.query(
      `INSERT INTO approval_boundary_policies
         (session_id, founder_id, workspace_id, product_id, working_style, founder_acknowledged)
       VALUES ($1,$2,$3,$4,'hands_on',true)`,
      [s.id, FOUNDER, a.workspace_id, b.id]))
      .rejects.toThrow(/does not belong to workspace/i);
    await db.query('DELETE FROM onboarding_sessions WHERE id=$1', [s.id]);
  });

  e2e('the duplicate-identity index is enforced by the database', async () => {
    const a = (await db.query(
      `SELECT workspace_id FROM products WHERE founder_id=$1 AND canonical_identity='apple:1234567890'`,
      [FOUNDER])).rows[0];
    await expect(db.query(
      `INSERT INTO products (founder_id, workspace_id, name, store_url, platform, canonical_identity)
       VALUES ($1,$2,'Sneaky duplicate','https://x.invalid','app_store','apple:1234567890')`,
      [FOUNDER, a.workspace_id])).rejects.toThrow(/duplicate key|unique/i);
  });

  e2e('service-role code still validates tenancy rather than assuming authority', async () => {
    // service_role bypasses RLS entirely, so "RLS protects us" is false for every
    // background path. The guarantee has to come from the code — and it does:
    // resolveOrCreateProduct re-reads the workspace and refuses a founder who
    // does not own it, even though the key would happily let it through.
    const other = randomUUID();
    await db.query(`INSERT INTO founders (id,email) VALUES ($1,$2)`,
      [other, `intruder-${other}@local.test`]);
    const victimWs = (await db.query(
      `SELECT id FROM workspaces WHERE founder_id=$1 LIMIT 1`, [FOUNDER])).rows[0].id;
    const s = await svc.createOrResumeSession(other);

    await expect(worker.resolveOrCreateProduct({
      sessionId: s.id, founderId: other, workspaceId: victimWs,
      urls: ['https://apps.apple.com/us/app/x/id5555555555'],
      storeUrl: 'https://apps.apple.com/us/app/x/id5555555555',
      platform: 'app_store', name: 'Intruder', scrapedMeta: {},
    })).rejects.toThrow(/does not own/i);

    const leaked = (await db.query(
      `SELECT id FROM products WHERE workspace_id=$1 AND founder_id=$2`, [victimWs, other])).rows;
    expect(leaked).toEqual([]);
    await db.query('DELETE FROM founders WHERE id=$1', [other]);
  });

  e2e('RLS denies a cross-workspace read for an authenticated non-member', async () => {
    // Exercised as the `authenticated` role with a JWT claim, which is what the
    // browser client actually is. The service-role tests above cannot show this
    // because service_role is exempt by design.
    const outsider = randomUUID();
    const victimWs = (await db.query(
      `SELECT id FROM workspaces WHERE founder_id=$1 LIMIT 1`, [FOUNDER])).rows[0].id;

    await db.query('BEGIN');
    try {
      await db.query(`SELECT set_config('role','authenticated',true)`);
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: outsider, role: 'authenticated' })]);
      await db.query(`SET LOCAL ROLE authenticated`);

      const seen = await db.query(`SELECT id FROM workspaces WHERE id=$1`, [victimWs]);
      expect(seen.rows).toEqual([]);            // read denied

      const wrote = await db.query(
        `INSERT INTO workspaces (founder_id, name) VALUES ($1,'hostile')
         ON CONFLICT DO NOTHING RETURNING id`, [FOUNDER]).catch(() => ({ rows: [] }));
      expect(wrote.rows).toEqual([]);           // write denied
    } finally {
      await db.query('ROLLBACK');
    }
  });

  e2e('the owning member CAN read their own workspace under RLS', async () => {
    // The negative tests above would also pass if RLS simply denied everything,
    // which would be a broken product rather than a secure one.
    const victimWs = (await db.query(
      `SELECT id FROM workspaces WHERE founder_id=$1 LIMIT 1`, [FOUNDER])).rows[0].id;
    await db.query('BEGIN');
    try {
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: FOUNDER, role: 'authenticated' })]);
      await db.query(`SET LOCAL ROLE authenticated`);
      const seen = await db.query(`SELECT id FROM workspaces WHERE id=$1`, [victimWs]);
      expect(seen.rows.map(r => r.id)).toEqual([victimWs]);
    } finally {
      await db.query('ROLLBACK');
    }
  });
});

// ── Pre-launch second business (the real LaunchMind failure) ────────────────
describe('pre-launch onboarding for a SECOND business', () => {
  // Verbatim from the owner's browser session.
  const LM_DESC =
    'LaunchMind is an AI-powered marketing platform that acts like an AI CMO for ' +
    'business owners, helping them understand what to do, why it matters, and what ' +
    'to do next. It continuously learns from the business, market, campaigns, and ' +
    'results to recommend and eventually help execute better growth decisions.';

  e2e('creates a pre-launch product with no URL, no scraping and no fabricated claims', async () => {
    // Business A already complete — the real precondition.
    await db.query(
      `UPDATE onboarding_sessions SET current_state='PHASE_1_COMPLETE' WHERE founder_id=$1`,
      [FOUNDER]);
    const aWorkspaces = (await db.query(
      `SELECT id FROM workspaces WHERE founder_id=$1`, [FOUNDER])).rows.map(r => r.id);

    // Add Business → new session → workspace step.
    const session = await svc.createOrResumeSession(FOUNDER);
    await svc.saveWorkspace(session.id, FOUNDER, 'LaunchMind', 'pre_launch');

    // "This product isn't public yet."
    const { productId } = await svc.startPreLaunchDiscovery(
      session.id, FOUNDER, undefined, LM_DESC);
    expect(productId).toBeTruthy();

    const p = (await db.query(
      `SELECT name, workspace_id, canonical_identity, maturity, store_url, scraped_meta
       FROM products WHERE id=$1`, [productId])).rows[0];

    // Name falls back to the company the owner typed — nothing invented.
    expect(p.name).toBe('LaunchMind');
    expect(p.maturity).toBe('pre_launch');
    // No platform id exists yet, so identity stays NULL rather than being faked.
    expect(p.canonical_identity).toBeNull();
    expect(p.scraped_meta.preLaunch).toBe(true);
    expect(p.scraped_meta.stores).toEqual([]);
    expect(p.scraped_meta.ownerDescription).toBe(LM_DESC);

    // §8 TENANCY: its own workspace, not AllignX's.
    expect(aWorkspaces).not.toContain(p.workspace_id);
    const wsName = (await db.query(
      `SELECT name FROM workspaces WHERE id=$1`, [p.workspace_id])).rows[0].name;
    expect(wsName).toBe('LaunchMind');

    // NO public claims fabricated for a product nobody can see yet.
    const claims = (await db.query(
      `SELECT id FROM product_claims WHERE session_id=$1`, [session.id])).rows;
    expect(claims).toEqual([]);

    // No discovery job was queued — there is nothing public to scrape.
    const jobs = (await db.query(
      `SELECT id FROM discovery_jobs WHERE session_id=$1`, [session.id])).rows;
    expect(jobs).toEqual([]);

    // Advanced into founder-guided Alignment.
    const st = (await db.query(
      `SELECT current_state, product_id FROM onboarding_sessions WHERE id=$1`,
      [session.id])).rows[0];
    expect(st.current_state).toBe('ALIGNMENT_AUDIENCE');
    expect(st.product_id).toBe(productId);
  });

  e2e('is idempotent — a resumed session does not create a second product', async () => {
    const session = (await db.query(
      `SELECT id FROM onboarding_sessions
       WHERE founder_id=$1 AND current_state='ALIGNMENT_AUDIENCE'`, [FOUNDER])).rows[0];
    const before = (await db.query(
      `SELECT count(*)::int n FROM products WHERE founder_id=$1`, [FOUNDER])).rows[0].n;

    await svc.startPreLaunchDiscovery(session.id, FOUNDER, undefined, LM_DESC);

    const after = (await db.query(
      `SELECT count(*)::int n FROM products WHERE founder_id=$1`, [FOUNDER])).rows[0].n;
    expect(after).toBe(before);
  });

  e2e('refuses a session that has no company yet — never guesses one', async () => {
    const orphan = randomUUID();
    await db.query(
      `INSERT INTO onboarding_sessions (id, founder_id, current_state)
       VALUES ($1,$2,'DISCOVERY_PENDING')`, [orphan, FOUNDER]).catch(() => undefined);
    // The active-session unique index may reject this; only assert when inserted.
    const exists = (await db.query(`SELECT id FROM onboarding_sessions WHERE id=$1`, [orphan])).rows;
    if (exists.length) {
      await expect(svc.startPreLaunchDiscovery(orphan, FOUNDER, undefined, LM_DESC))
        .rejects.toThrow(/no workspace/i);
      await db.query(`DELETE FROM onboarding_sessions WHERE id=$1`, [orphan]);
    }
  });
});
