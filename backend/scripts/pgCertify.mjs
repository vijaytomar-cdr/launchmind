#!/usr/bin/env node
/**
 * @file pgCertify.mjs
 * @description Postgres integration CERTIFICATION runner — fail-closed.
 *
 *   MEASURED DEFECT: `npx vitest run` reported success with every PG suite
 *   skipped. The guards compared SUPABASE_URL against '127.0.0.1' while
 *   tests/setup.ts forced 'localhost', and no setupFiles were registered, so 4
 *   files / 29 tests silently never ran and the command exited 0.
 *
 *   This runner exists so "PG integration certified" cannot mean "skipped":
 *     1. resolves local Supabase credentials from `supabase status`
 *     2. refuses any non-loopback database
 *     3. probes reachability before running anything
 *     4. runs the PG suites with PG_INTEGRATION=required
 *     5. FAILS if the executed test count is zero
 *
 *   `--prelaunch` runs the same explicit suite list but defers only the exact
 *   P1-2 authority-total-ordering assertion documented below. The full profile
 *   remains unchanged and continues to run that assertion.
 *
 *   The normal unit workflow (`npm test`) is untouched and may still skip.
 *
 * @security Refuses a non-local database outright, so certification can never be
 *   pointed at production. Reads keys from the local CLI; never prints them.
 * @dependencies supabase CLI, vitest
 */

import { execFileSync, spawnSync } from 'node:child_process';

const FAIL = 'POSTGRES_INTEGRATION_UNAVAILABLE';
const prelaunch = process.argv.slice(2).includes('--prelaunch');

/** Suites that MUST execute for this command to mean anything. */
const PG_SUITES = [
  'tests/morningBriefOnboardingIsolation.pg.test.ts',
  'tests/growthBrainIsolation.pg.test.ts',
  'tests/growthBrainRecommendations.pg.test.ts',
  'tests/growthBrainDecisions.pg.test.ts',
  'tests/growthBrainDecisionAuthz.pg.test.ts',
  'tests/ownerLoop.pg.test.ts',
  'tests/ownerLoopFailureModes.pg.test.ts',
  'tests/actionEquivalence.pg.test.ts',
  'tests/relevanceAuthorityMatrix.pg.test.ts',
  'tests/governedRetrievalIntegration.pg.test.ts',
  'tests/lifecycleTierPropagation.pg.test.ts',
  'tests/memoryGovernance.pg.test.ts',
];

/** Exact, approved pre-launch deferral. Do not replace with a generic filter. */
const PRELAUNCH_DEFERRED = [{
  testName: 'B — AUTHORITY SENSITIVITY: identical relevance ranks by authority tier',
  displayName: 'governedRetrievalIntegration > B — AUTHORITY SENSITIVITY',
  backlog: 'P1-2',
  reason: 'strict total ordering exceeds current launch contract',
}];

function die(msg) {
  console.error(`\n${FAIL}: ${msg}\n`);
  const command = prelaunch ? 'npm run test:pg:prelaunch' : 'npm run test:pg';
  console.error(`Start the local stack with \`npx supabase start\`, then re-run \`${command}\`.\n`);
  process.exit(1);
}

let env;
try {
  env = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
} catch {
  die('`supabase status` failed — the local stack does not appear to be running');
}

const read = (k) => (env.match(new RegExp(`^${k}="?([^"\n]+)"?`, 'm')) ?? [])[1] ?? '';
const url        = read('API_URL');
const serviceKey = read('SERVICE_ROLE_KEY');
const anonKey    = read('ANON_KEY');

if (!url || !serviceKey || !anonKey) die('local Supabase did not report API_URL / SERVICE_ROLE_KEY / ANON_KEY');

let host;
try { host = new URL(url).hostname; } catch { die(`unusable API_URL: ${url}`); }
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  die(`refusing to certify against a non-local database (${host})`);
}

// Reachability, not string matching.
const probe = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '8', `${url}/rest/v1/`], { encoding: 'utf8' });
if (probe.status !== 0 || !/^[23]/.test((probe.stdout ?? '').trim())) {
  die(`local Supabase at ${url} is not responding (got "${(probe.stdout ?? '').trim() || 'no response'}")`);
}

// The browser-certification database is a different lifecycle generation from
// the disposable PG-test database. Once the canonical staging fixture exists,
// this runner must refuse to start: several integration suites intentionally
// create retained audit/history rows, so running them here would invalidate the
// browser safety verifier even when every assertion passes.
try {
  const fixtureProbe = await fetch(
    `${url}/rest/v1/founders?email=eq.staging%40launchmind.test&select=id&limit=1`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
  );
  if (!fixtureProbe.ok) die(`could not verify PG/browser database separation (HTTP ${fixtureProbe.status})`);
  const fixtureRows = await fixtureProbe.json();
  if (Array.isArray(fixtureRows) && fixtureRows.length > 0) {
    die(
      'refusing to run PG certification against BROWSER_CERT_DB: the canonical ' +
      'staging fixture is present. Reset/rebuild the PG database first.',
    );
  }
} catch (err) {
  if (err instanceof Error && err.message.includes('refusing to run PG certification')) throw err;
  die(`could not verify PG/browser database separation (${err instanceof Error ? err.message : String(err)})`);
}

const profile = prelaunch ? 'pre-launch' : 'full';
console.log(`PG integration (${profile}): local Supabase reachable at ${url} — running ${PG_SUITES.length} suite(s)\n`);

const vitestArgs = ['vitest', 'run', ...PG_SUITES, '--reporter=basic'];
if (prelaunch) {
  // Vitest matches against the full test name. This anchored negative lookahead
  // excludes precisely the approved test title and nothing else.
  const exact = PRELAUNCH_DEFERRED.map(({ testName }) =>
    testName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  vitestArgs.push('--testNamePattern', `^(?!.*(?:${exact})$).*$`);
}

const run = spawnSync(
  'npx',
  vitestArgs,
  {
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
    env: {
      ...process.env,
      PG_INTEGRATION: 'required',
      SUPABASE_URL: url,
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      SUPABASE_ANON_KEY: anonKey,
    },
  },
);

const out = run.stdout ?? '';
process.stdout.write(out);

// A run where everything skipped is NOT a pass. This is the whole point.
const passed = Number((out.match(/(?:Tests\s+|\|\s+)(\d+)\s+passed/) ?? [])[1] ?? 0);
const failed = Number((out.match(/(?:Tests\s+|\|\s+)(\d+)\s+failed/) ?? [])[1] ?? 0);
const skipped = Number((out.match(/(?:Tests\s+|\|\s+)(\d+)\s+skipped/) ?? [])[1] ?? 0);
const skippedOnly = /Tests\s+\d+\s+skipped/.test(out) && passed === 0;

if (prelaunch) {
  console.log('\nPG_PRELAUNCH_CERTIFICATION');
  console.log(`executed=${passed + failed}`);
  console.log(`passed=${passed}`);
  console.log(`failed=${failed}`);
  console.log(`deferred=${PRELAUNCH_DEFERRED.length}`);
  console.log('\ndeferred:');
  for (const item of PRELAUNCH_DEFERRED) {
    console.log(`- ${item.displayName}`);
    console.log(`  backlog=${item.backlog}`);
    console.log(`  reason=${item.reason}`);
  }
}

if (skippedOnly || passed === 0) {
  console.error(`\n${FAIL}: the PG suites executed 0 tests — a skipped run is not certification.\n`);
  process.exit(1);
}
if (prelaunch && skipped !== PRELAUNCH_DEFERRED.length) {
  console.error(
    `\nPG pre-launch certification FAILED: expected exactly ${PRELAUNCH_DEFERRED.length} ` +
    `deferred test, but Vitest reported ${skipped}.\n`,
  );
  process.exit(1);
}
if (run.status !== 0 || failed > 0) {
  console.error(`\nPG integration FAILED: ${failed} test(s) failing.\n`);
  process.exit(run.status === 0 ? 1 : run.status);
}

console.log(`\nPG integration certified: ${passed} test(s) executed and passed.\n`);
