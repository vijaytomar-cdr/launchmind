/**
 * @file cert-env-guard.mjs
 * @description THE fail-closed gate for LOCAL_ISOLATED_CERTIFICATION.
 *
 *   One implementation, so the rule cannot drift between entrypoints. Three
 *   scripts previously each carried their own copy as
 *
 *       if (!/127\.0\.0\.1|localhost/.test(URL)) refuse
 *
 *   which is a SUBSTRING test on a whole URL. A hosted URL carrying `localhost`
 *   anywhere in a path, query or credential segment satisfies it. Nothing has
 *   ever exploited that, and it is still the wrong shape for a safety check:
 *   the hostname is parsed here and compared exactly.
 *
 *   THIS GUARD IS FOR CERTIFICATION ONLY. It is deliberately NOT imported by
 *   `npm run dev`, `npm run dev:staging` or any application code. Normal local
 *   development against the real hosted Supabase is a supported, intentional
 *   mode (docs/environment-contract.md §A) and must not be broken by a
 *   restriction that exists to protect destructive test workflows.
 *
 * @security Refuses before any test, fixture or browser starts. Prints
 *   hostnames and identity shapes only — never keys, tokens or passwords.
 * @dependencies none
 */

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
/** The hosted project ref is a stable, non-secret identifier. */
export const HOSTED_REF = 'gseqtbwdenjkwysregpp';

export function hostOf(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

export function isLoopback(url) {
  const h = hostOf(url);
  return h !== null && LOOPBACK.has(h);
}

/**
 * Refuses unless every resolved target is an isolated local stack.
 *
 * @param {object} opts
 * @param {string} opts.command        - name shown in the refusal, e.g. 'staging:seed'
 * @param {Record<string,string|undefined>} opts.urls - label → URL that must be loopback
 * @param {string} [opts.requireIdentity] - exact TEST_EMAIL required, when the
 *   workflow uses an identity at all
 * @param {boolean} [opts.scanEnv=true] - fail if any env var carries the hosted ref
 * @returns {void} exits the process with code 3 on refusal
 */
export function assertIsolatedCertificationEnv({ command, urls, requireIdentity, scanEnv = true }) {
  const problems = [];
  const lines = [];

  for (const [label, url] of Object.entries(urls)) {
    if (!url) { problems.push(`${label}: not set`); lines.push(`  FAIL  ${label} — not set`); continue; }
    const h = hostOf(url);
    if (!h) { problems.push(`${label}: unparseable`); lines.push(`  FAIL  ${label} — unparseable`); continue; }
    if (!LOOPBACK.has(h)) { problems.push(`${label}: not loopback (${h})`); lines.push(`  FAIL  ${label} — ${h}`); continue; }
    lines.push(`  ok    ${label} — ${h}`);
  }

  if (scanEnv) {
    const carriers = Object.entries(process.env)
      .filter(([k, v]) => typeof v === 'string' && v.includes(HOSTED_REF) && !k.startsWith('npm_'))
      .map(([k]) => k);
    if (carriers.length) {
      problems.push(`hosted project reference present in ${carriers.join(', ')}`);
      lines.push(`  FAIL  hosted project reference — ${carriers.join(', ')}`);
    } else {
      lines.push('  ok    hosted project reference — absent');
    }
  }

  if (requireIdentity) {
    const actual = process.env.TEST_EMAIL ?? '';
    if (actual !== requireIdentity) {
      // Never print the value found: it may be a real person's address.
      problems.push(`TEST_EMAIL is not the approved synthetic identity`);
      lines.push('  FAIL  identity — not the approved synthetic staging account');
    } else {
      lines.push(`  ok    identity — ${requireIdentity}`);
    }
  }

  console.log(`certification environment guard (${command}):`);
  for (const l of lines) console.log(l);

  if (problems.length) {
    console.error(`\nCERT_ENV_UNSAFE — refusing to run ${command}:`);
    for (const p of problems) console.error(`  · ${p}`);
    console.error('\nCertification runs against the local disposable stack only.');
    console.error('Load .env.staging explicitly and start it with `npm run staging:up`.');
    console.error('Normal development against hosted Supabase is unaffected — use `npm run dev`.\n');
    process.exit(3);
  }
}

// ── DUAL LOCAL DATABASE GENERATIONS (P1-45) ─────────────────────────────────
//
// Two disposable local databases with incompatible lifecycles:
//
//   BROWSER_CERT     retains a canonical fixture (staging@launchmind.test) and
//                    long-lived history rows a browser run reads back
//   PG_INTEGRATION   is intentionally filled with synthetic append-only audit
//                    rows by the integration suites
//
// Running either workflow against the other's generation silently invalidates
// it. The previous protection inferred generation from row counts, which cannot
// distinguish "the PG database" from "a browser database someone just reset" —
// both look empty. An explicit MARKER is written once per database and answers
// the question directly.
//
// The marker is created by a bootstrap command, never by a migration: migrations
// run on both databases, so a migration-created marker would say the same thing
// in both places.

export const DB_GENERATIONS = ['PG_INTEGRATION', 'BROWSER_CERT'];
export const BROWSER_FIXTURE_EMAIL = 'staging@launchmind.test';

/**
 * Decides whether a certification workflow may use a database.
 *
 * PURE — no I/O, so every refusal path is unit-testable without a database.
 * That matters here more than usual: the environment this was written in could
 * not run one, and a guard that can only be verified by the thing it protects
 * is a guard nobody has checked.
 *
 * @param {object} o
 * @param {'PG_INTEGRATION'|'BROWSER_CERT'} o.workflow  which certification is running
 * @param {string} o.targetUrl        the database/API URL it resolved
 * @param {string|null} o.marker      lm_database_generation value read from that database
 * @param {boolean} o.browserFixturePresent  is the canonical staging founder there
 * @param {string|null} [o.otherUrl]  the sibling generation's URL, when known
 * @param {string[]} [o.hostedRefVars] env var names carrying the hosted project ref
 * @returns {{allowed: boolean, refusals: string[]}}
 */
export function evaluateDatabaseGeneration({
  workflow, targetUrl, marker, browserFixturePresent,
  otherUrl = null, hostedRefVars = [],
}) {
  const refusals = [];

  if (!DB_GENERATIONS.includes(workflow)) refusals.push(`unknown workflow "${workflow}"`);
  if (!targetUrl) refusals.push('no database target was resolved');
  else if (!isLoopback(targetUrl)) refusals.push(`target is not loopback (${hostOf(targetUrl) ?? 'unparseable'})`);

  if (hostedRefVars.length) refusals.push(`hosted project reference present in ${hostedRefVars.join(', ')}`);

  // The marker is the primary control. Absent is a refusal, not a default:
  // an unmarked database is one nobody has claimed, and guessing which
  // generation it is was the P1-45 failure.
  if (!marker) {
    refusals.push('the database carries no generation marker — run the bootstrap for the generation you intend');
  } else if (!DB_GENERATIONS.includes(marker)) {
    refusals.push(`unrecognised generation marker "${marker}"`);
  } else if (marker !== workflow) {
    refusals.push(`this database is marked ${marker}; ${workflow} certification refuses to run on it`);
  }

  // Fixture presence is a SECOND, independent signal. It disagrees with the
  // marker only when something has gone wrong, and either disagreement is a
  // refusal rather than a vote.
  if (workflow === 'PG_INTEGRATION' && browserFixturePresent) {
    refusals.push('the canonical browser fixture is present — this is a browser-certification database');
  }
  if (workflow === 'BROWSER_CERT' && !browserFixturePresent) {
    refusals.push('the canonical browser fixture is absent — browser certification needs its seeded identity');
  }

  // Two names for one database is the failure mode a marker alone cannot catch.
  if (otherUrl && targetUrl && hostOf(targetUrl) === hostOf(otherUrl)
      && new URL(targetUrl).port === new URL(otherUrl).port) {
    refusals.push('both generations resolve to the SAME database — they are not isolated');
  }

  return { allowed: refusals.length === 0, refusals };
}

/**
 * Process wrapper: prints the decision and exits 3 on refusal.
 * @returns {void}
 */
export function assertDatabaseGeneration(o) {
  const { allowed, refusals } = evaluateDatabaseGeneration(o);
  console.log(`database generation guard (${o.workflow}):`);
  if (allowed) {
    console.log(`  ok    marker — ${o.marker}`);
    console.log(`  ok    target — ${hostOf(o.targetUrl)}:${new URL(o.targetUrl).port}`);
    return;
  }
  console.error(`\nCERT_DB_GENERATION_UNSAFE — refusing ${o.workflow} certification:`);
  for (const r of refusals) console.error(`  · ${r}`);
  console.error('\nSee docs/environment-contract.md — dual local database generations.\n');
  process.exit(3);
}
