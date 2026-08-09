#!/usr/bin/env node
/**
 * @file staging-verify.mjs
 * @description Verifies the staging environment is genuinely ready and genuinely
 *   isolated, before any provider journey runs.
 *
 *   The isolation checks matter more than the liveness ones. A staging stack that
 *   is up but still pointing at the hosted Supabase project, or still writing to
 *   the production Redis, or still emitting PostHog events, would produce a
 *   confident PASS while mutating production — which is exactly what Step 9B §1
 *   forbids.
 *
 * Usage: node --env-file=.env.staging scripts/staging-verify.mjs
 */

const PROD_SUPABASE_REF = 'gseqtbwdenjkwysregpp';   // the hosted project staging must never touch
const WORKSPACE_NAME    = 'LaunchMind Provider Validation';

const URL      = process.env.SUPABASE_URL ?? '';
const SERVICE  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const REDIS    = process.env.REDIS_URL ?? '';
const EMAIL    = process.env.TEST_EMAIL ?? '';
const PASS     = process.env.TEST_PASSWORD ?? '';
const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:3001';
const APP_BASE = process.env.APP_BASE_URL ?? 'http://localhost:3000';

let fails = 0, warns = 0;
const ok   = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad  = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); fails++; };
const warn = (m) => { console.log(`  \x1b[33m!\x1b[0m ${m}`); warns++; };

const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const get = async (p, h = {}) => fetch(`${URL}/rest/v1/${p}`, { headers: { ...H, ...h } });

console.log('\nStaging environment verification\n');

// ── Isolation (checked FIRST — a failure here invalidates everything after) ───
console.log('Isolation');
if (URL.includes(PROD_SUPABASE_REF)) bad(`SUPABASE_URL points at the PRODUCTION project (${PROD_SUPABASE_REF})`);
else if (/127\.0\.0\.1|localhost/.test(URL)) ok(`Supabase is local: ${URL}`);
else warn(`Supabase is neither local nor the known production project: ${URL}`);

if (/:6379(\/|$)/.test(REDIS)) bad('REDIS_URL is the dev/production Redis on :6379');
else if (REDIS) ok(`Redis is isolated: ${REDIS}`);
else bad('REDIS_URL is not set');

if (process.env.NEXT_PUBLIC_POSTHOG_KEY) bad('PostHog key is set — staging events would reach production reporting');
else ok('analytics disabled (no PostHog key)');

// ── Supabase ─────────────────────────────────────────────────────────────────
console.log('\nSupabase');
try {
  const r = await get('founders?select=id&limit=1');
  r.ok ? ok(`REST reachable (HTTP ${r.status})`) : bad(`REST returned HTTP ${r.status}`);
} catch (e) { bad(`REST unreachable: ${e.message}`); }

// Schema completeness — the Phase 2 tables a provider journey writes.
const REQUIRED = [
  'founders','workspaces','products','workspace_connections','connection_credentials',
  'oauth_authorization_requests','intelligence_signals','connection_insights',
  'connection_sync_runs','connection_permission_history','growth_brain_learning_events',
];
const missing = [];
for (const t of REQUIRED) {
  const r = await get(`${t}?select=id&limit=1`);
  if (!r.ok) missing.push(t);
}
missing.length ? bad(`missing tables: ${missing.join(', ')}`) : ok(`all ${REQUIRED.length} required tables present`);

// ── Seeded fixture ───────────────────────────────────────────────────────────
console.log('\nFixture');
let workspaceId = null, founderId = null;
{
  const r = await get(`workspaces?name=eq.${encodeURIComponent(WORKSPACE_NAME)}&select=id,founder_id`);
  const rows = r.ok ? await r.json() : [];
  if (rows.length === 1) {
    workspaceId = rows[0].id; founderId = rows[0].founder_id;
    ok(`workspace "${WORKSPACE_NAME}" exists`);
  } else bad(`expected exactly 1 "${WORKSPACE_NAME}" workspace, found ${rows.length}`);
}
{
  const r = await get(`founders?select=id,email,plan`);
  const rows = r.ok ? await r.json() : [];
  const staging = rows.find(f => f.email === EMAIL);
  staging ? ok(`staging founder present (plan: ${staging.plan})`) : bad(`staging founder ${EMAIL} not found`);
  // Any founder that is NOT the staging one means production data leaked in.
  const strangers = rows.filter(f => f.email !== EMAIL);
  strangers.length === 0
    ? ok('no other founders — no production data present')
    : bad(`${strangers.length} non-staging founder(s) present — production data may have been copied`);
}

// ── Provider surfaces must start empty ───────────────────────────────────────
console.log('\nClean slate');
{
  const tables = ['workspace_connections','connection_credentials','intelligence_signals',
                  'connection_insights','connection_sync_runs','growth_brain_learning_events'];
  let dirty = 0;
  for (const t of tables) {
    const r = await fetch(`${URL}/rest/v1/${t}?select=id`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
    const n = Number((r.headers.get('content-range') || '*/0').split('/')[1] || 0);
    if (n > 0) { warn(`${t} has ${n} row(s) — run npm run staging:reset`); dirty++; }
  }
  if (!dirty) ok('every provider surface is empty — signals can only come from a real provider');
}

// ── Auth: the test user can actually log in ──────────────────────────────────
console.log('\nAuthentication');
try {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  const body = await r.json();
  if (r.ok && body.access_token) ok(`${EMAIL} can log in (Playwright TEST_EMAIL/TEST_PASSWORD work)`);
  else bad(`login failed: ${body.error_description || body.msg || r.status}`);
} catch (e) { bad(`login threw: ${e.message}`); }

// ── Services ─────────────────────────────────────────────────────────────────
console.log('\nServices');
try {
  const r = await fetch(`${API_BASE}/health/detailed`, { signal: AbortSignal.timeout(5000) });
  const d = await r.json();
  d.checks?.supabase === 'ok' ? ok('backend → Supabase ok') : bad(`backend → Supabase ${d.checks?.supabase}`);
  d.checks?.redis === 'ok'    ? ok('backend → Redis ok')    : bad(`backend → Redis ${d.checks?.redis}`);
  d.vault?.status === 'healthy'
    ? ok(`credential vault healthy (${d.vault.detail})`)
    : bad(`credential vault ${d.vault?.status}: ${d.vault?.detail}`);
} catch (e) {
  bad(`backend not reachable at ${API_BASE} — start it with: npm --prefix backend run dev:staging`);
}
try {
  const r = await fetch(`${APP_BASE}/login`, { signal: AbortSignal.timeout(5000) });
  r.ok ? ok(`frontend reachable at ${APP_BASE}`) : bad(`frontend HTTP ${r.status}`);
} catch { bad(`frontend not reachable at ${APP_BASE} — start it with: npm run dev`); }

// ── Callback URL ─────────────────────────────────────────────────────────────
console.log('\nOAuth callback');
ok(`providers must be configured with EXACTLY: ${API_BASE}/connections/oauth/callback`);

// ── Verdict ──────────────────────────────────────────────────────────────────
console.log('');
if (fails === 0) {
  console.log(`\x1b[32mPASS\x1b[0m — staging is ready${warns ? ` (${warns} warning(s))` : ''}.\n`);
  process.exit(0);
}
console.log(`\x1b[31mFAIL\x1b[0m — ${fails} problem(s), ${warns} warning(s).\n`);
process.exit(1);
