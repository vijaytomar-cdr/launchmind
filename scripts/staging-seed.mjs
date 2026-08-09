#!/usr/bin/env node
/**
 * @file staging-seed.mjs
 * @description Seeds the LaunchMind staging environment with the MINIMUM records
 *   needed for provider validation, and nothing else.
 *
 *   Deliberately does NOT copy production or customer data (Step 9B §4). The
 *   ClientPulse demo-seed migrations (024, 025) are excluded from staging for the
 *   same reason — a validation run must never be able to confuse demo numbers with
 *   real provider data.
 *
 *   What it creates:
 *     - one staging founder (auth user + founders row)
 *     - one workspace: "LaunchMind Provider Validation"
 *     - one product, with just enough context for Morning Brief / Growth Brain to
 *       render their non-connected states
 *
 *   What it deliberately does NOT create:
 *     - connections, credentials, signals, insights, sync runs — every one of those
 *       must come from a real provider during validation. Seeding any of them would
 *       make a "PASS" meaningless.
 *
 *   Idempotent: safe to run repeatedly.
 *
 * @security Refuses to run against anything that is not a local staging Supabase.
 * Usage: node scripts/staging-seed.mjs
 */

const URL     = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL   = process.env.TEST_EMAIL    ?? 'staging@launchmind.test';
const PASS    = process.env.TEST_PASSWORD ?? 'staging-provider-validation-2026';

const WORKSPACE_NAME = 'LaunchMind Provider Validation';

// ── Guard: never seed a hosted project ──────────────────────────────────────
if (!/127\.0\.0\.1|localhost/.test(URL)) {
  console.error(`REFUSED: SUPABASE_URL is not local (${URL}).`);
  console.error('This script only ever runs against a local staging stack.');
  process.exit(1);
}
if (!SERVICE) {
  console.error('REFUSED: SUPABASE_SERVICE_ROLE_KEY is not set.');
  process.exit(1);
}


/** Minimal Supabase REST/auth helpers over fetch — avoids supabase-js's realtime
 *  dependency, which needs a WebSocket implementation this Node version lacks. */
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };

async function rest(path, init = {}) {
  const res = await fetch(`${URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const text = await res.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: res.ok, status: res.status, body, headers: res.headers };
}

async function count(table) {
  const res = await fetch(`${URL}/rest/v1/${table}?select=id`, {
    headers: { ...H, Prefer: 'count=exact', Range: '0-0' },
  });
  const cr = res.headers.get('content-range') || '*/0';
  return Number(cr.split('/')[1] || 0);
}

async function authAdmin(path, init = {}) {
  const res = await fetch(`${URL}/auth/v1/admin/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const text = await res.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

const log = (m) => console.log(`  ${m}`);

// ── 1. Auth user ─────────────────────────────────────────────────────────────
const list = await authAdmin('users?per_page=200');
let user = (list.body?.users ?? []).find((u) => u.email === EMAIL);

if (!user) {
  const created = await authAdmin('users', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASS, email_confirm: true }),
  });
  if (!created.ok) { console.error('createUser failed:', JSON.stringify(created.body)); process.exit(1); }
  user = created.body;
  log(`auth user created: ${EMAIL}`);
} else {
  // Keep the password in step with TEST_PASSWORD so Playwright can always log in.
  await authAdmin(`users/${user.id}`, {
    method: 'PUT',
    body: JSON.stringify({ password: PASS, email_confirm: true }),
  });
  log(`auth user exists, password synced: ${EMAIL}`);
}

const founderId = user.id;

// ── 2. Founder row ───────────────────────────────────────────────────────────
// A signup trigger may already have created this; upsert either way.
{
  const r = await rest('founders?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ id: founderId, email: EMAIL, name: 'Staging Validation', plan: 'builder' }),
  });
  if (!r.ok) { console.error('founders upsert failed:', JSON.stringify(r.body)); process.exit(1); }
  log('founders row ready (plan: builder — unlocks every provider surface)');
}

// ── 3. Workspace ─────────────────────────────────────────────────────────────
let workspaceId;
{
  const q = await rest(`workspaces?founder_id=eq.${founderId}&name=eq.${encodeURIComponent(WORKSPACE_NAME)}&select=id`);
  if (q.ok && Array.isArray(q.body) && q.body.length) {
    workspaceId = q.body[0].id;
    log(`workspace exists: ${WORKSPACE_NAME}`);
  } else {
    const c = await rest('workspaces', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ founder_id: founderId, name: WORKSPACE_NAME }),
    });
    if (!c.ok) { console.error('workspace insert failed:', JSON.stringify(c.body)); process.exit(1); }
    workspaceId = c.body[0].id;
    log(`workspace created: ${WORKSPACE_NAME}`);
  }

  // resolveWorkspaceContext falls back to the oldest membership, but an explicit
  // active workspace makes every request deterministic.
  await rest(`founders?id=eq.${founderId}`, {
    method: 'PATCH', body: JSON.stringify({ active_workspace_id: workspaceId }),
  });
}

// ── 4. Product ───────────────────────────────────────────────────────────────
// Enough for Growth Brain's public-intelligence dimensions to render. Contains no
// customer data and no observed metrics — every number on screen must still come
// from a real provider.
{
  const q = await rest(`products?founder_id=eq.${founderId}&select=id&limit=1`);
  if (q.ok && Array.isArray(q.body) && q.body.length) {
    log('product exists');
  } else {
    const c = await rest('products', { method: 'POST', body: JSON.stringify({
      founder_id: founderId,
      workspace_id: workspaceId,
      name: 'Staging Validation App',
      store_url: 'https://apps.apple.com/app/id000000000',
      platform: 'app_store',
      category: 'Productivity',
      markets: ['usa'],
      confirmed_icp: {
        positioning: 'Internal fixture used only to validate provider connections.',
        audience: 'Not a real audience — staging fixture.',
        topSignal: 'No observed signal; provider data has not been imported.',
      },
    }) });
    if (!c.ok) { console.error('product insert failed:', JSON.stringify(c.body)); process.exit(1); }
    log('product created (fixture — no observed metrics)');
  }
}

// ── 5. Assert the validation surfaces start EMPTY ────────────────────────────
{
  const tables = [
    'workspace_connections', 'connection_credentials', 'oauth_authorization_requests',
    'intelligence_signals', 'connection_insights', 'connection_sync_runs',
    'growth_brain_learning_events',
  ];
  let dirty = false;
  for (const t of tables) {
    const n = await count(t);
    if (n > 0) { console.error(`  ⚠ ${t} is NOT empty (${n})`); dirty = true; }
  }
  log(dirty
    ? 'WARNING: provider tables are not empty — run staging-reset first'
    : 'provider tables empty — every signal must come from a real provider');
}

console.log('');
console.log(`  founder_id   : ${founderId}`);
console.log(`  workspace_id : ${workspaceId}`);
console.log(`  login        : ${EMAIL}`);
console.log('');
