/**
 * @file dev-smoke-guard.mjs
 * @description Safety contract for the B5 DEVELOPMENT browser smoke.
 *
 *   This is NOT certification and must never be mistaken for it. Isolated
 *   browser certification is scripts/browser-cert-guard.mjs, which fails closed
 *   unless every target is loopback AND the identity is a synthetic staging
 *   account. That guard is authoritative for LOCAL_ISOLATED_BROWSER_CERTIFICATION
 *   and for Phase B8, and nothing here relaxes it.
 *
 *   What this guard is for: the B5 smoke runs against LOCAL_REAL_DEVELOPMENT —
 *   the real development account and .env.local, by explicit decision. It is
 *   still worth refusing the obvious ways that goes wrong, so this checks the
 *   few things that actually make a development run unsafe:
 *
 *     · both servers are loopback (never a deployed environment)
 *     · the run is explicitly labelled LOCAL_REAL_DEVELOPMENT
 *     · the run has not been dressed up as certification
 *
 *   It deliberately does NOT check identity: using the real development account
 *   is the point of this harness, and pretending otherwise would make the
 *   distinction from certification meaningless.
 *
 * @security Prints NAMES and booleans only. No secret, token, key or password
 *   value is ever read into the output, so a failing run is safe to paste.
 */

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const problems = [];

function host(label, raw, required) {
  if (!raw) {
    if (required) problems.push(`${label} is not set`);
    return;
  }
  let h;
  try { h = new URL(raw).hostname; }
  catch { problems.push(`${label} is not a valid URL`); return; }
  if (!LOOPBACK.has(h)) problems.push(`${label} is not loopback (${h}) — development smoke never targets a deployed environment`);
}

host('frontend (PLAYWRIGHT_BASE_URL)', process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000', true);
host('backend (API_URL)', process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL, true);

if (process.env.LM_ENV_MODE !== 'LOCAL_REAL_DEVELOPMENT') {
  problems.push('LM_ENV_MODE must be exactly LOCAL_REAL_DEVELOPMENT for this harness');
}

// A development smoke that calls itself certification is the failure this
// repository has already had once. Refuse it structurally.
for (const k of ['CERT', 'CERTIFICATION', 'BROWSER_CERT', 'LM_CERTIFY']) {
  if (process.env[k]) problems.push(`${k} is set — this harness is DEVELOPMENT_SMOKE and cannot produce a certification result`);
}

const credentialed = !!(process.env.TEST_EMAIL && process.env.TEST_PASSWORD);

console.log('B5 DEVELOPMENT BROWSER SMOKE — safety contract');
console.log(`  mode                 ${process.env.LM_ENV_MODE ?? '(unset)'}`);
console.log(`  frontend loopback    ${problems.some(p => p.includes('frontend')) ? 'no' : 'yes'}`);
console.log(`  backend loopback     ${problems.some(p => p.includes('backend')) ? 'no' : 'yes'}`);
console.log(`  development account  ${credentialed ? 'present' : 'absent (authenticated steps will skip)'}`);
console.log('  label                DEVELOPMENT_SMOKE — not certification');
console.log('  writes permitted     B5 content development only, scoped to the DEV-B5-UX-PREVIEW fixture');
console.log('  writes refused       publish · launch · schedule · send · spend · Marketing Memory');

if (problems.length > 0) {
  console.error('\nREFUSED:');
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}
console.log('\nOK — proceeding as DEVELOPMENT_SMOKE.');
