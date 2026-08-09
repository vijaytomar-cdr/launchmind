#!/usr/bin/env node
/**
 * @file staging-reset.mjs
 * @description Restores the staging provider-validation state between runs.
 *
 *   Deletes everything a provider journey produces — connections, credentials,
 *   signals, insights, sync runs, learning events, OAuth requests, permission
 *   history — while KEEPING the founder, workspace, and product fixture, so a
 *   re-run does not need a fresh login or a new workspace id.
 *
 *   This exists because provider validation is only meaningful from a clean start:
 *   a leftover signal from a previous run is indistinguishable from one the provider
 *   just returned, and that is exactly the confusion the whole no-fake-data rule is
 *   meant to prevent.
 *
 * @security Refuses to run against anything that is not a local staging Supabase.
 *   It issues DELETEs, so the guard is a hard refusal rather than a warning.
 * Usage: node scripts/staging-reset.mjs [--full]
 *   --full also removes the founder, workspace and product (then re-seed).
 */

const URL     = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL   = process.env.TEST_EMAIL ?? 'staging@launchmind.test';
const FULL    = process.argv.includes('--full');

if (!/127\.0\.0\.1|localhost/.test(URL)) {
  console.error(`REFUSED: SUPABASE_URL is not local (${URL}).`);
  console.error('staging-reset issues DELETEs and only ever runs against a local stack.');
  process.exit(1);
}
if (!SERVICE) { console.error('REFUSED: SUPABASE_SERVICE_ROLE_KEY is not set.'); process.exit(1); }

const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };

async function count(table) {
  const res = await fetch(`${URL}/rest/v1/${table}?select=id`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
  if (!res.ok) return null;
  return Number((res.headers.get('content-range') || '*/0').split('/')[1] || 0);
}
async function deleteAll(table) {
  const res = await fetch(`${URL}/rest/v1/${table}?id=neq.00000000-0000-0000-0000-000000000000`, { method: 'DELETE', headers: H });
  return res.ok ? null : `${res.status} ${await res.text()}`.slice(0, 90);
}

/**
 * Ordered child → parent so foreign keys never block a delete.
 * Everything here is provider-run output; none of it is fixture data.
 */
const PROVIDER_TABLES = [
  'connection_permission_history',
  'connection_insights',
  'connection_sync_runs',
  'connection_credentials',
  'oauth_authorization_requests',
  'intelligence_signals',
  'growth_brain_learning_events',
  'workspace_connections',
];

/** Derived surfaces that a validation run also writes. */
const DERIVED_TABLES = ['saved_opportunities', 'learning_events', 'audit_logs'];

console.log(`\nStaging reset — ${URL}\n`);

let total = 0;
for (const table of [...PROVIDER_TABLES, ...DERIVED_TABLES]) {
  const before = await count(table);
  if (before === null) { console.log(`  ${table.padEnd(34)} (table absent)`); continue; }
  if (!before) { console.log(`  ${table.padEnd(34)} already empty`); continue; }

  const err = await deleteAll(table);
  if (err) { console.log(`  ${table.padEnd(34)} FAILED: ${err}`); continue; }

  const after = await count(table) ?? 0;
  console.log(`  ${table.padEnd(34)} ${before} → ${after}`);
  total += before - after;
}

if (FULL) {
  console.log('\n  --full: removing the fixture too');
  const lr = await fetch(`${URL}/auth/v1/admin/users?per_page=200`, { headers: H });
  const users = (await lr.json())?.users ?? [];
  const user = users.find(u => u.email === EMAIL);
  if (user) {
    // products and workspaces cascade from founders.
    await fetch(`${URL}/rest/v1/founders?id=eq.${user.id}`, { method: 'DELETE', headers: H });
    await fetch(`${URL}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers: H });
    console.log(`  founder + auth user removed: ${EMAIL}`);
    console.log('  → run: npm run staging:seed');
  } else {
    console.log('  no staging founder found');
  }
} else {
  // Prove the fixture survived — a reset that silently destroys the login would
  // be discovered only at the next Playwright run.
  const f = await count('founders'), w = await count('workspaces'), p = await count('products');
  console.log(`\n  fixture kept — founders:${f ?? 0} workspaces:${w ?? 0} products:${p ?? 0}`);
}

console.log(`\n  ${total} provider-run row(s) removed. Staging is ready for a clean journey.\n`);
