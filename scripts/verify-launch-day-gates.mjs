/**
 * Launch-day verification gates (end of launch day).
 *
 * Usage:
 *   node scripts/verify-launch-day-gates.mjs
 *
 * Automated gates (run here):
 *   2. New signups on launch day  — queries Supabase founders table
 *   5. Oracle VM / backend health — hits NEXT_PUBLIC_API_URL/health
 *   7. Playwright sanity suite    — spawns npx playwright test
 *
 * Manual gates (instructions printed at end):
 *   1. 200+ PH upvotes by 6pm PST    — check producthunt.com
 *   3. 3+ genuine beta comments       — read PH comments yourself
 *   4. Zero Sentry 5xx in window      — Sentry dashboard
 *   6. PostHog >30% scrape conversion — PostHog funnel report
 *
 * Add to .env.local to enable optional automated checks:
 *   SENTRY_AUTH_TOKEN   — Sentry API token (Settings › API Keys)
 *   SENTRY_ORG          — e.g. launchmind
 *   SENTRY_PROJECT      — e.g. launchmind-api
 *   PH_ACCESS_TOKEN     — PH Developer Token (optional, for upvote count)
 *   PH_POST_SLUG        — your PH post slug, e.g. launchmind
 *   POSTHOG_API_KEY     — PostHog personal API key (not the project key)
 *   POSTHOG_PROJECT_ID  — PostHog project numeric ID
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import path from 'path';

// ── Load env ──────────────────────────────────────────────────────────────────
function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  try {
    return Object.fromEntries(
      readFileSync(filePath, 'utf-8')
        .split('\n')
        .filter(l => l && !l.startsWith('#') && l.includes('='))
        .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
    );
  } catch { return {}; }
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...loadEnvFile(path.join(root, '.env.dev')), ...loadEnvFile(path.join(root, '.env.local')) };

const SUPABASE_URL   = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY    = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const API_URL        = env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const SENTRY_TOKEN   = env.SENTRY_AUTH_TOKEN ?? '';
const SENTRY_ORG     = env.SENTRY_ORG ?? '';
const SENTRY_PROJECT = env.SENTRY_PROJECT ?? '';
const PH_TOKEN       = env.PH_ACCESS_TOKEN ?? '';
const PH_SLUG        = env.PH_POST_SLUG ?? '';
const PH_UPVOTE_TARGET = parseInt(env.PH_UPVOTE_TARGET ?? '200', 10);
const SIGNUP_TARGET  = parseInt(env.LAUNCH_DAY_SIGNUP_TARGET ?? '100', 10);
const POSTHOG_KEY    = env.POSTHOG_API_KEY ?? '';
const POSTHOG_PID    = env.POSTHOG_PROJECT_ID ?? '';

const PASS  = '✅ ';
const FAIL  = '❌ ';
const SKIP  = '⏭  ';
const INFO  = '   ';

let failures = 0;

function assert(condition, label, detail = '') {
  if (condition) {
    console.log(`${PASS} ${label}`);
  } else {
    console.log(`${FAIL} ${label}${detail ? `  — ${detail}` : ''}`);
    failures++;
  }
}
function skip(label, reason) {
  console.log(`${SKIP} ${label}  [${reason}]`);
}

// ── Today's date range (UTC midnight → now) ───────────────────────────────────
const todayStart = new Date();
todayStart.setUTCHours(0, 0, 0, 0);
const todayISO = todayStart.toISOString();

console.log('\n══ Launch-Day Verification Gates ══\n');
console.log(`${INFO} Launch day date (UTC): ${todayStart.toISOString().slice(0, 10)}`);
console.log(`${INFO} Signup target: ${SIGNUP_TARGET}  |  Upvote target: ${PH_UPVOTE_TARGET}\n`);

// ── Gate 1: PH upvotes (optional — needs PH_ACCESS_TOKEN + PH_POST_SLUG) ─────
console.log('── Gate 1: Product Hunt upvotes ──');
if (PH_TOKEN && PH_SLUG) {
  try {
    const query = `{
      post(slug:"${PH_SLUG}"){
        votesCount
        name
        tagline
        commentsCount
        createdAt
      }
    }`;
    const res = await fetch('https://api.producthunt.com/v2/api/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${PH_TOKEN}`,
      },
      body: JSON.stringify({ query }),
    });
    const { data, errors } = await res.json();
    if (errors?.length) throw new Error(errors[0].message);
    const post = data?.post;
    if (!post) throw new Error('Post not found');
    const votes = post.votesCount ?? 0;
    console.log(`${INFO} "${post.name}" — ${votes} upvotes, ${post.commentsCount} comments`);
    assert(votes >= PH_UPVOTE_TARGET, `${votes} upvotes ≥ ${PH_UPVOTE_TARGET} target`);
  } catch (err) {
    console.log(`${FAIL} PH API error: ${err.message}`);
    failures++;
  }
} else {
  skip(`PH upvotes ≥ ${PH_UPVOTE_TARGET}`, 'set PH_ACCESS_TOKEN + PH_POST_SLUG in .env.local to automate');
  console.log(`${INFO} Check manually: https://www.producthunt.com/posts/${PH_SLUG || '<your-slug>'}`);
}

// ── Gate 2: Signups on launch day (Supabase) ──────────────────────────────────
console.log('\n── Gate 2: New signups today ──');
if (SUPABASE_URL && SERVICE_KEY) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/founders?created_at=gte.${todayISO}&select=id,email,created_at&order=created_at.desc`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error(`Unexpected response: ${JSON.stringify(rows)}`);
    const count = rows.length;
    console.log(`${INFO} ${count} new founder${count !== 1 ? 's' : ''} signed up today (UTC midnight → now)`);
    if (count > 0) {
      rows.slice(0, 5).forEach(r => {
        console.log(`${INFO}  • ${r.email ?? r.id}  ${new Date(r.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Los_Angeles' })} PST`);
      });
      if (count > 5) console.log(`${INFO}  … and ${count - 5} more`);
    }
    assert(count >= SIGNUP_TARGET, `${count} signups ≥ ${SIGNUP_TARGET} target`);
  } catch (err) {
    console.log(`${FAIL} Signup count error: ${err.message}`);
    failures++;
  }
} else {
  skip(`Signups ≥ ${SIGNUP_TARGET}`, 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing');
}

// ── Gate 3: Beta founder comments (manual) ─────────────────────────────────────
console.log('\n── Gate 3: Genuine beta founder comments (manual) ──');
skip('3+ comments with real results', 'requires human review of PH comments');
console.log(`${INFO} Check: https://www.producthunt.com/posts/${PH_SLUG || '<your-slug>'}#comments`);
console.log(`${INFO} Look for: specific metrics ("went from 0 to 50 installs"), screenshots, app names`);

// ── Gate 4: Zero Sentry 5xx errors (optional — needs SENTRY_AUTH_TOKEN) ───────
console.log('\n── Gate 4: Zero 5xx errors in launch window ──');
if (SENTRY_TOKEN && SENTRY_ORG && SENTRY_PROJECT) {
  try {
    // Query Sentry issues API for 5xx events since today UTC midnight
    const since = encodeURIComponent(todayISO);
    const res = await fetch(
      `https://sentry.io/api/0/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/?query=level:error&limit=25&start=${since}`,
      { headers: { Authorization: `Bearer ${SENTRY_TOKEN}` } }
    );
    if (!res.ok) throw new Error(`Sentry API ${res.status}: ${await res.text()}`);
    const issues = await res.json();
    const http5xx = issues.filter(i =>
      i.title?.includes('5') || i.title?.match(/50[0-9]/) || i.level === 'fatal'
    );
    console.log(`${INFO} ${issues.length} error-level issues since UTC midnight; ${http5xx.length} possible 5xx`);
    if (http5xx.length > 0) {
      http5xx.forEach(i => console.log(`${INFO}  • ${i.title} (${i.count} events)`));
    }
    assert(http5xx.length === 0, `Zero 5xx errors during launch window (${http5xx.length} found)`);
  } catch (err) {
    console.log(`${FAIL} Sentry API error: ${err.message}`);
    failures++;
  }
} else {
  skip('Zero Sentry 5xx errors', 'set SENTRY_AUTH_TOKEN + SENTRY_ORG + SENTRY_PROJECT in .env.local to automate');
  console.log(`${INFO} Check manually: https://sentry.io/organizations/${SENTRY_ORG || '<org>'}/issues/?project=${SENTRY_PROJECT || '<project>'}&query=level%3Aerror`);
}

// ── Gate 5: Backend / Oracle VM health ────────────────────────────────────────
console.log('\n── Gate 5: Backend health ──');
try {
  const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(5000) });
  const body = await res.json().catch(() => ({}));
  assert(res.ok && body.status === 'ok', `Health endpoint ${API_URL}/health returns ok (got status=${res.status})`);
  console.log(`${INFO} Timestamp: ${body.timestamp ?? 'n/a'}`);
  if (API_URL.includes('localhost')) {
    console.log(`${INFO} ⚠  Running against localhost — also check production Oracle VM URL manually`);
  }
} catch (err) {
  console.log(`${FAIL} Health check failed: ${err.message}`);
  failures++;
}

// ── Gate 6: PostHog scrape funnel conversion (optional) ───────────────────────
console.log('\n── Gate 6: PostHog — >30% of PH visitors complete scrape step ──');
if (POSTHOG_KEY && POSTHOG_PID) {
  try {
    // Query PostHog trends for onboarding_step events on launch day
    const payload = {
      insight: 'FUNNELS',
      date_from: todayISO.slice(0, 10),
      date_to: 'today',
      events: [
        { id: '$pageview', name: 'PH landing page visit', type: 'events', order: 0 },
        { id: 'onboarding_step', name: 'Scrape started', type: 'events', order: 1,
          properties: [{ key: 'step', value: 'icp_confirmed', operator: 'exact' }] },
      ],
    };
    const res = await fetch(`https://app.posthog.com/api/projects/${POSTHOG_PID}/insights/funnel/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${POSTHOG_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`PostHog API ${res.status}`);
    const data = await res.json();
    const steps = data?.result ?? [];
    if (steps.length >= 2) {
      const topCount = steps[0]?.count ?? 0;
      const scrapeCount = steps[1]?.count ?? 0;
      const pct = topCount > 0 ? Math.round((scrapeCount / topCount) * 100) : 0;
      console.log(`${INFO} PH visitors: ${topCount}  |  completed scrape: ${scrapeCount}  |  conversion: ${pct}%`);
      assert(pct >= 30, `Scrape conversion ≥ 30% (got ${pct}%)`);
    } else {
      skip('PostHog funnel', 'insufficient funnel steps returned — check PostHog manually');
    }
  } catch (err) {
    console.log(`${FAIL} PostHog API error: ${err.message}`);
    failures++;
  }
} else {
  skip('>30% PH visitors complete scrape', 'set POSTHOG_API_KEY + POSTHOG_PROJECT_ID in .env.local to automate');
  console.log(`${INFO} Check manually: PostHog › Insights › Funnels — filter to today, PH referrer → icp_confirmed`);
}

// ── Gate 7: Playwright sanity suite ───────────────────────────────────────────
console.log('\n── Gate 7: Playwright sanity suite ──');
try {
  const result = execSync('npx playwright test tests/e2e/sanity.spec.ts --reporter=line', {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 120_000,
  }).toString();
  const passed = result.match(/(\d+) passed/)?.[1];
  const failed = result.match(/(\d+) failed/)?.[1];
  assert(!failed && passed, `Sanity suite: ${passed ?? '?'} passed, ${failed ?? '0'} failed`);
  console.log(`${INFO} ${passed} test${passed !== '1' ? 's' : ''} passed`);
} catch (err) {
  const output = err.stdout?.toString() ?? err.message;
  const passed = output.match(/(\d+) passed/)?.[1] ?? '0';
  const failed = output.match(/(\d+) failed/)?.[1] ?? '?';
  console.log(`${FAIL} Playwright: ${passed} passed, ${failed} failed`);
  const failLines = output.split('\n').filter(l => l.includes('●') || l.includes('FAIL') || l.includes('Error'));
  failLines.slice(0, 5).forEach(l => console.log(`${INFO}  ${l.trim()}`));
  failures++;
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n══ Results ══');
if (failures === 0) {
  console.log(`${PASS} All automated gates passed\n`);
} else {
  console.log(`${FAIL} ${failures} automated gate(s) failed\n`);
}

console.log('Manual checklist (cannot be fully automated):');
console.log('  [ ] 200+ PH upvotes by 6pm PST');
console.log('      Automate by adding PH_ACCESS_TOKEN + PH_POST_SLUG to .env.local');
console.log('  [ ] 3+ genuine beta founder comments with real results');
console.log('      (human review required — look for specific metrics, not "great tool!")');
console.log('  [ ] Zero 5xx in Sentry during launch window');
console.log('      Automate by adding SENTRY_AUTH_TOKEN + SENTRY_ORG + SENTRY_PROJECT to .env.local');
console.log('  [ ] Oracle VM stayed green throughout (no restarts)');
console.log('      Check: ssh oracle-vm "docker compose ps" or uptime in Sentry performance');
console.log('  [ ] PostHog >30% PH visitors → scrape step');
console.log('      Automate by adding POSTHOG_API_KEY + POSTHOG_PROJECT_ID to .env.local');
console.log('');
