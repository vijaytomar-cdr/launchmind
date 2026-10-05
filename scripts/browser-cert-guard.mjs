#!/usr/bin/env node
/**
 * @file browser-cert-guard.mjs
 * @description FAIL-CLOSED gate for browser certification.
 *
 *   MEASURED HAZARD (Phase 3.4C): `playwright.config.ts` loads `.env.local`,
 *   and `.env.local` holds TEST_EMAIL for the LIVE OWNER ACCOUNT. Nothing
 *   stopped a certification command from driving a real person's business in a
 *   browser. It did not happen — the frontend was pointed at local Supabase, so
 *   the owner identity simply failed to log in — but "it failed for an unrelated
 *   reason" is not a safety property.
 *
 *   This guard runs BEFORE Playwright launches a browser and exits non-zero
 *   unless every target is loopback and the identity is the approved synthetic
 *   staging account. It does NOT hide `.env.local`; the certification command
 *   loads `.env.staging` explicitly and this guard proves which one won.
 *
 * @security Never prints passwords, keys or tokens. Prints only hostnames,
 *   the email local-part shape, and pass/fail lines.
 * @dependencies local Supabase, running frontend + backend
 */

const FAIL = 'BROWSER_CERT_ENV_UNSAFE';
const problems = [];
const checks = [];

const ok = (label, detail = '') => { checks.push(`  ok    ${label}${detail ? ` — ${detail}` : ''}`); };
const bad = (label, detail) => { problems.push(`${label}: ${detail}`); checks.push(`  FAIL  ${label} — ${detail}`); };

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
function hostOf(url) { try { return new URL(url).hostname; } catch { return null; } }

function requireLoopback(label, url) {
  if (!url) return bad(label, 'not set');
  const h = hostOf(url);
  if (!h) return bad(label, `unparseable (${url})`);
  if (!LOOPBACK.has(h)) return bad(label, `not loopback (${h})`);
  ok(label, h);
}

// ── 1. Every target must be local ───────────────────────────────────────────
const baseUrl  = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const apiUrl   = process.env.NEXT_PUBLIC_API_URL ?? process.env.API_URL ?? 'http://localhost:3001';
const supaUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';

requireLoopback('frontend base URL', baseUrl);
requireLoopback('backend API URL', apiUrl);
requireLoopback('Supabase URL', supaUrl);

// ── 2. No hosted project reference anywhere in the resolved environment ─────
// The hosted project ref is a stable, non-secret identifier, so matching on it
// is a reliable way to catch a hosted URL that slipped in through any variable.
const HOSTED_REF = 'gseqtbwdenjkwysregpp';
const hostedVars = Object.entries(process.env)
  .filter(([k, v]) => typeof v === 'string' && v.includes(HOSTED_REF) && !k.startsWith('npm_'))
  .map(([k]) => k);
if (hostedVars.length) bad('hosted project reference', `present in ${hostedVars.join(', ')}`);
else ok('hosted project reference', 'absent');

// ── 3. Identity must be the approved synthetic staging account ──────────────
const APPROVED_EMAIL = 'staging@launchmind.test';
const email = process.env.TEST_EMAIL ?? '';
if (!email) bad('TEST_EMAIL', 'not set');
else if (email !== APPROVED_EMAIL) {
  // Deliberately does NOT enumerate the owner's address. Anything that is not
  // the approved synthetic identity is refused, which also covers identities
  // this file has never heard of.
  bad('TEST_EMAIL', `is not the approved synthetic staging identity (got "${email}")`);
} else ok('TEST_EMAIL', APPROVED_EMAIL);

if (!process.env.TEST_PASSWORD) bad('TEST_PASSWORD', 'not set');
else ok('TEST_PASSWORD', 'set (not printed)');

// ── 4. The certification database must hold no non-staging founder ──────────
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!serviceKey) {
  bad('SUPABASE_SERVICE_ROLE_KEY', 'not set — cannot verify database safety');
} else if (!problems.length || LOOPBACK.has(hostOf(supaUrl) ?? '')) {
  try {
    const res = await fetch(
      `${supaUrl}/rest/v1/founders?select=email`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
    if (!res.ok) bad('founder inventory', `HTTP ${res.status}`);
    else {
      const rows = await res.json();
      const others = (Array.isArray(rows) ? rows : [])
        .map(r => r.email).filter(e => e && e !== APPROVED_EMAIL);
      if (others.length) bad('non-staging founders', `${others.length} present`);
      else ok('non-staging founders', '0');
    }
  } catch (err) {
    bad('founder inventory', err instanceof Error ? err.message : String(err));
  }
}

// ── 4b. The database must be the BROWSER generation, and say so (P1-45) ─────
// Two independent signals: the explicit marker and the fixture identity. Row
// counts alone cannot tell a PG-integration database from a freshly reset
// browser one — both look empty — which is the ambiguity that let one database
// serve two incompatible lifecycles.
if (serviceKey && LOOPBACK.has(hostOf(supaUrl) ?? '')) {
  const { evaluateDatabaseGeneration } = await import('./cert-env-guard.mjs');
  let marker = null;
  let fixturePresent = false;
  try {
    const mres = await fetch(`${supaUrl}/rest/v1/lm_database_generation?select=generation&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
    if (!mres.ok) {
      bad('database generation marker', `unreadable (HTTP ${mres.status}) — run \`npm run staging:mark\``);
    } else {
      const rows = await mres.json();
      marker = Array.isArray(rows) && rows.length ? rows[0].generation : null;
    }
    const fres = await fetch(
      `${supaUrl}/rest/v1/founders?email=eq.${encodeURIComponent(APPROVED_EMAIL)}&select=id&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
    const frows = fres.ok ? await fres.json().catch(() => []) : [];
    fixturePresent = Array.isArray(frows) && frows.length > 0;
  } catch (err) {
    bad('database generation', err instanceof Error ? err.message : String(err));
  }

  const verdict = evaluateDatabaseGeneration({
    workflow: 'BROWSER_CERT',
    targetUrl: supaUrl,
    marker,
    browserFixturePresent: fixturePresent,
    otherUrl: process.env.PG_CERT_SUPABASE_URL ?? null,
  });
  if (!verdict.allowed) for (const r of verdict.refusals) bad('database generation', r);
  else ok('database generation', `BROWSER_CERT (marker present)`);
}

// ── 5. Frontend and backend must actually be up, locally ────────────────────
for (const [label, url] of [['frontend', `${baseUrl}/login`], ['backend', `${apiUrl}/health`]]) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) bad(label, `not responding (HTTP ${r.status})`);
    else ok(label, 'reachable');
  } catch {
    bad(label, 'not reachable');
  }
}

console.log('\nBROWSER_CERT_ENV_GUARD');
for (const line of checks) console.log(line);

if (problems.length) {
  console.error(`\n${FAIL}: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    '\nRun certification with the staging environment explicitly:\n' +
    '  npm run cert:browser\n');
  process.exit(1);
}
console.log('\nBROWSER_CERT_ENV_GUARD = PASS');
