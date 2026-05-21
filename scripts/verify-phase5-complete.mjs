/**
 * Final verification gate — Phase 5 complete.
 *
 * Usage:
 *   node scripts/verify-phase5-complete.mjs
 *
 * Automated gates:
 *   1. 50 paying founders            — Supabase founders table
 *   2. $2,500+ MRR                   — derived from founders × PLAN_PRICES
 *   3. Token efficiency (80%+)       — audit_logs: token_topup buys vs paying founders
 *   6. Phase 6 roadmap exists        — file check
 *   7. Regression suite passes       — npx playwright test
 *   11. CLAUDE.md Section 11 updated — reads CLAUDE.md
 *
 * Manual / needs credentials:
 *   2b. MRR screenshot in docs/      — manual
 *   4.  Case study published          — manual (set CASE_STUDY_URL in .env.local)
 *   5.  IndieHackers post             — manual (set INDIEHACKERS_URL in .env.local)
 *   8.  12 dashboard screens match    — Playwright tests cover functionality; visual match manual
 *   9.  Homepage live                 — manual (set HOMEPAGE_URL in .env.local) or auto if set
 *   10. Sentry zero HIGH+ errors      — needs SENTRY_AUTH_TOKEN + SENTRY_ORG + SENTRY_PROJECT
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import path from 'path';

// ── Load env ──────────────────────────────────────────────────────────────────
function loadEnvFile(p) {
  if (!existsSync(p)) return {};
  try {
    return Object.fromEntries(
      readFileSync(p, 'utf-8')
        .split('\n')
        .filter(l => l && !l.startsWith('#') && l.includes('='))
        .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
    );
  } catch { return {}; }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...loadEnvFile(path.join(root, '.env.dev')), ...loadEnvFile(path.join(root, '.env.local')) };

const SUPABASE_URL    = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY     = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const SENTRY_TOKEN    = env.SENTRY_AUTH_TOKEN ?? '';
const SENTRY_ORG      = env.SENTRY_ORG ?? '';
const SENTRY_PROJECT  = env.SENTRY_PROJECT ?? '';
const CASE_STUDY_URL  = env.CASE_STUDY_URL ?? '';
const IH_URL          = env.INDIEHACKERS_URL ?? '';
const HOMEPAGE_URL    = env.HOMEPAGE_URL ?? '';

// PLAN_PRICES in cents/paise (mirrors billingService.ts)
const PLAN_PRICES = {
  solo:    { usd: 1900,  inr: 99900,  tokens: 300  },
  builder: { usd: 4900,  inr: 249900, tokens: 1000 },
  studio:  { usd: 9900,  inr: 499900, tokens: 3000 },
};
const PLAN_TIER_TOKENS = { free: 50, solo: 300, builder: 1000, studio: 3000 };
const INR_TO_USD = 1 / 83;
const MRR_TARGET      = 2500;
const FOUNDERS_TARGET = 50;

const PASS = '✅ ';
const FAIL = '❌ ';
const SKIP = '⏭  ';
const INFO = '   ';

let failures = 0;
let skipped  = 0;

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
  skipped++;
}

console.log('\n══ Phase 5 Completion Gates ══\n');

// ── Gate 1: 50 paying founders ────────────────────────────────────────────────
console.log('── Gate 1: 50 paying founders ──');
let payingFounders = [];
let planBreakdown  = {};
if (SUPABASE_URL && SERVICE_KEY) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/founders?plan=neq.free&deleted_at=is.null&select=id,plan,created_at&order=created_at.desc`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error(JSON.stringify(rows));
    payingFounders = rows;

    planBreakdown = rows.reduce((acc, r) => {
      acc[r.plan] = (acc[r.plan] ?? 0) + 1;
      return acc;
    }, {});

    ['solo', 'builder', 'studio'].forEach(t => {
      if (planBreakdown[t]) console.log(`${INFO}  ${t.padEnd(8)} ${planBreakdown[t]}`);
    });
    console.log(`${INFO}  total    ${rows.length}`);
    assert(rows.length >= FOUNDERS_TARGET, `${rows.length} paying founders ≥ ${FOUNDERS_TARGET} target`);
  } catch (err) {
    console.log(`${FAIL} Supabase error: ${err.message}`);
    failures++;
  }
} else {
  skip(`Paying founders ≥ ${FOUNDERS_TARGET}`, 'SUPABASE_URL or SERVICE_KEY missing');
}

// ── Gate 2: $2,500+ MRR ───────────────────────────────────────────────────────
console.log('\n── Gate 2: $2,500+ MRR ──');
if (SUPABASE_URL && SERVICE_KEY && payingFounders.length > 0) {
  try {
    // Determine USD vs INR split via audit_logs source metadata
    const logRes = await fetch(
      `${SUPABASE_URL}/rest/v1/audit_logs?action=eq.subscription_activated&select=metadata,founder_id`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const logs = await logRes.json().catch(() => []);
    const sourceByFounder = {};
    if (Array.isArray(logs)) {
      logs.forEach(l => {
        if (l.founder_id) sourceByFounder[l.founder_id] = l.metadata?.source ?? 'stripe';
      });
    }

    let totalMrrUsd = 0;
    let mrrByTier   = {};

    payingFounders.forEach(f => {
      const pricing = PLAN_PRICES[f.plan];
      if (!pricing) return;
      const source  = sourceByFounder[f.id] ?? 'stripe';
      const isInr   = source === 'razorpay';
      const usdContrib = isInr
        ? (pricing.inr / 100) * INR_TO_USD
        : (pricing.usd / 100);
      totalMrrUsd += usdContrib;
      if (!mrrByTier[f.plan]) mrrByTier[f.plan] = { founders: 0, usd: 0 };
      mrrByTier[f.plan].founders++;
      mrrByTier[f.plan].usd += usdContrib;
    });

    ['solo', 'builder', 'studio'].forEach(t => {
      if (mrrByTier[t]) {
        const row = mrrByTier[t];
        console.log(`${INFO}  ${t.padEnd(8)} ${row.founders} founders  $${row.usd.toFixed(0)} USD/mo`);
      }
    });
    console.log(`${INFO}  total    $${totalMrrUsd.toFixed(0)} USD/mo`);

    assert(
      totalMrrUsd >= MRR_TARGET,
      `MRR $${totalMrrUsd.toFixed(0)} ≥ $${MRR_TARGET} target`
    );
    console.log(`${INFO} ℹ  MRR figure is derived from DB — confirm with Stripe + Razorpay dashboard screenshots`);
    console.log(`${INFO}   Save screenshot to: docs/mrr-phase5-complete.png`);
  } catch (err) {
    console.log(`${FAIL} MRR calculation error: ${err.message}`);
    failures++;
  }
} else if (!SUPABASE_URL || !SERVICE_KEY) {
  skip('MRR ≥ $2,500', 'SUPABASE_URL or SERVICE_KEY missing');
} else {
  console.log(`${INFO} No paying founders — MRR = $0`);
  assert(false, 'MRR ≥ $2,500  — 0 paying founders');
}

// ── Gate 3: Token efficiency — 80%+ founders within allocation ────────────────
console.log('\n── Gate 3: Token efficiency — 80%+ within allocation without top-ups ──');
if (SUPABASE_URL && SERVICE_KEY && payingFounders.length > 0) {
  try {
    // Count founders who bought top-ups (distinct founder_ids in audit_logs WHERE action=token_topup)
    const topupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/audit_logs?action=eq.token_topup&select=founder_id`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const topupLogs = await topupRes.json().catch(() => []);
    const topupFounderIds = new Set(
      Array.isArray(topupLogs) ? topupLogs.map(l => l.founder_id) : []
    );

    // Also check founders whose current balance is exactly 0 (depleted this cycle)
    const depletedRes = await fetch(
      `${SUPABASE_URL}/rest/v1/founders?token_balance=eq.0&plan=neq.free&deleted_at=is.null&select=id`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const depleted = await depletedRes.json().catch(() => []);
    const depletedIds = new Set(Array.isArray(depleted) ? depleted.map(r => r.id) : []);

    const needingTopup   = new Set([...topupFounderIds, ...depletedIds]);
    const withinAlloc    = payingFounders.filter(f => !needingTopup.has(f.id)).length;
    const total          = payingFounders.length;
    const pct            = total > 0 ? Math.round((withinAlloc / total) * 100) : 0;

    console.log(`${INFO} Paying founders: ${total}`);
    console.log(`${INFO} Bought top-ups : ${topupFounderIds.size}`);
    console.log(`${INFO} Balance at 0   : ${depletedIds.size}`);
    console.log(`${INFO} Within alloc   : ${withinAlloc} (${pct}%)`);
    assert(pct >= 80, `${pct}% of founders within monthly allocation ≥ 80% target`);
  } catch (err) {
    console.log(`${FAIL} Token efficiency error: ${err.message}`);
    failures++;
  }
} else if (!SUPABASE_URL || !SERVICE_KEY) {
  skip('Token efficiency ≥ 80%', 'SUPABASE_URL or SERVICE_KEY missing');
} else {
  skip('Token efficiency', 'no paying founders yet');
}

// ── Gate 4: Case study published ──────────────────────────────────────────────
console.log('\n── Gate 4: Case study published ──');
if (CASE_STUDY_URL) {
  try {
    const res = await fetch(CASE_STUDY_URL, { signal: AbortSignal.timeout(8000) });
    assert(res.ok, `Case study URL returns ${res.status}`, CASE_STUDY_URL);
    console.log(`${INFO} ${CASE_STUDY_URL}`);
  } catch (err) {
    console.log(`${FAIL} Case study URL unreachable: ${err.message}`);
    failures++;
  }
} else {
  skip('Case study live URL', 'set CASE_STUDY_URL=https://... in .env.local');
  console.log(`${INFO} Must include: real install numbers, before/after, founder quote, app name + category`);
}

// ── Gate 5: IndieHackers post published ───────────────────────────────────────
console.log('\n── Gate 5: IndieHackers post ──');
if (IH_URL) {
  try {
    const res = await fetch(IH_URL, { signal: AbortSignal.timeout(8000) });
    assert(res.ok, `IndieHackers post returns ${res.status}`, IH_URL);
    console.log(`${INFO} ${IH_URL}`);
  } catch (err) {
    console.log(`${FAIL} IH URL unreachable: ${err.message}`);
    failures++;
  }
} else {
  skip('IndieHackers post live', 'set INDIEHACKERS_URL=https://... in .env.local');
  console.log(`${INFO} Suggested title: "We hit $2.5K MRR using only AI-generated campaigns — here's what worked"`);
}

// ── Gate 6: Phase 6 roadmap exists ────────────────────────────────────────────
console.log('\n── Gate 6: Phase 6 roadmap in docs/roadmap/phase-6.md ──');
const phase6Path = path.join(root, 'docs/roadmap/phase-6.md');
if (existsSync(phase6Path)) {
  const content = readFileSync(phase6Path, 'utf-8');
  const hasChannels = content.includes('YouTube') && content.includes('Reddit');
  const hasMarkets  = content.includes('SE Asia') || content.includes('Singapore');
  const hasMetrics  = content.includes('MRR') || content.includes('founders');
  assert(hasChannels && hasMarkets && hasMetrics,
    'phase-6.md exists and contains channels, markets, and success metrics');
  const lineCount = content.split('\n').length;
  console.log(`${INFO} ${lineCount} lines — channels: ${hasChannels ? 'yes' : 'NO'}, markets: ${hasMarkets ? 'yes' : 'NO'}, metrics: ${hasMetrics ? 'yes' : 'NO'}`);
} else {
  console.log(`${FAIL} docs/roadmap/phase-6.md not found`);
  failures++;
}

// ── Gate 7: Full regression suite ─────────────────────────────────────────────
console.log('\n── Gate 7: Full regression suite (tests/e2e/regression.spec.ts) ──');
try {
  const result = execSync('npx playwright test tests/e2e/regression.spec.ts --reporter=line', {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 180_000,
  }).toString();
  const passed = result.match(/(\d+) passed/)?.[1] ?? '0';
  const failed = result.match(/(\d+) failed/)?.[1];
  assert(!failed && parseInt(passed) > 0, `Regression suite: ${passed} passed, ${failed ?? '0'} failed`);
  console.log(`${INFO} ${passed} tests passed`);
} catch (err) {
  const output = err.stdout?.toString() ?? err.message;
  const passed = output.match(/(\d+) passed/)?.[1] ?? '0';
  const failed = output.match(/(\d+) failed/)?.[1] ?? '?';
  console.log(`${FAIL} Playwright regression: ${passed} passed, ${failed} failed`);
  const failLines = output.split('\n').filter(l => l.match(/●|FAIL|Error:|✘/));
  failLines.slice(0, 8).forEach(l => console.log(`${INFO}  ${l.trim()}`));
  failures++;
}

// ── Gate 8: 12 dashboard screens functional (sanity covers routes) ────────────
console.log('\n── Gate 8: All 12 dashboard screens functional ──');
try {
  const result = execSync('npx playwright test tests/e2e/sanity.spec.ts --reporter=line', {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 120_000,
  }).toString();
  const passed = result.match(/(\d+) passed/)?.[1] ?? '0';
  const failed = result.match(/(\d+) failed/)?.[1];
  assert(!failed && parseInt(passed) > 0, `Sanity suite: ${passed} passed (functional routing confirmed)`);
  console.log(`${INFO} Visual pixel-match against launchmind-ux-slate-sage.html requires manual review`);
} catch (err) {
  const output = err.stdout?.toString() ?? err.message;
  const passed = output.match(/(\d+) passed/)?.[1] ?? '0';
  const failed = output.match(/(\d+) failed/)?.[1] ?? '?';
  console.log(`${FAIL} Sanity: ${passed} passed, ${failed} failed`);
  failures++;
}

// ── Gate 9: Homepage live ──────────────────────────────────────────────────────
console.log('\n── Gate 9: Homepage live ──');
if (HOMEPAGE_URL) {
  try {
    const res = await fetch(HOMEPAGE_URL, { signal: AbortSignal.timeout(8000) });
    assert(res.ok, `Homepage ${HOMEPAGE_URL} returns ${res.status}`);
    console.log(`${INFO} Visual match against launchmind-homepage.html requires manual review`);
  } catch (err) {
    console.log(`${FAIL} Homepage unreachable: ${err.message}`);
    failures++;
  }
} else {
  skip('Homepage live and matching reference', 'set HOMEPAGE_URL=https://launchmind.com in .env.local');
  console.log(`${INFO} When set, script checks HTTP 200 — visual match is manual`);
}

// ── Gate 10: Sentry zero HIGH+ unresolved errors ──────────────────────────────
console.log('\n── Gate 10: Sentry — zero unresolved HIGH+ errors ──');
if (SENTRY_TOKEN && SENTRY_ORG && SENTRY_PROJECT) {
  try {
    const res = await fetch(
      `https://sentry.io/api/0/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/?query=is:unresolved+level:error&limit=100`,
      { headers: { Authorization: `Bearer ${SENTRY_TOKEN}` } }
    );
    if (!res.ok) throw new Error(`Sentry API ${res.status}: ${await res.text()}`);
    const issues = await res.json();
    console.log(`${INFO} ${issues.length} unresolved error-level issue(s)`);
    if (issues.length > 0) {
      issues.slice(0, 5).forEach(i =>
        console.log(`${INFO}  • [${i.level}] ${i.title} (${i.count} events)`)
      );
    }
    assert(issues.length === 0, `Zero unresolved HIGH+ Sentry errors (${issues.length} found)`);
  } catch (err) {
    console.log(`${FAIL} Sentry API error: ${err.message}`);
    failures++;
  }
} else {
  skip('Zero unresolved HIGH+ Sentry errors', 'set SENTRY_AUTH_TOKEN + SENTRY_ORG + SENTRY_PROJECT in .env.local');
  console.log(`${INFO} Check: https://sentry.io/organizations/${SENTRY_ORG || '<org>'}/issues/?query=is%3Aunresolved+level%3Aerror`);
}

// ── Gate 11: CLAUDE.md Section 11 updated ─────────────────────────────────────
console.log('\n── Gate 11: CLAUDE.md Section 11 updated to Phase 5 complete ──');
const claudeMdPath = path.join(root, 'CLAUDE.md');
if (existsSync(claudeMdPath)) {
  const content = readFileSync(claudeMdPath, 'utf-8');
  const sec11Match = content.match(/## 11\. Current Build State[\s\S]*?```([\s\S]*?)```/);
  if (sec11Match) {
    const buildBlock = sec11Match[1];
    const hasPhase5  = buildBlock.includes('Phase 5');
    const notPhase4  = !buildBlock.includes('Last updated: Phase 4');
    const hasWeek18  = buildBlock.includes('Week 18') || buildBlock.includes('Week 19') || buildBlock.includes('Week 20');
    console.log(`${INFO} Mentions Phase 5: ${hasPhase5 ? 'yes' : 'NO'}`);
    console.log(`${INFO} Phase 4 still listed as latest: ${!notPhase4 ? 'YES (stale)' : 'no'}`);
    console.log(`${INFO} Mentions Week 18+: ${hasWeek18 ? 'yes' : 'NO'}`);
    assert(hasPhase5 && notPhase4, 'CLAUDE.md Section 11 reflects Phase 5 complete, not Phase 4');
  } else {
    console.log(`${FAIL} Could not find Section 11 code block in CLAUDE.md`);
    failures++;
  }
} else {
  console.log(`${FAIL} CLAUDE.md not found at ${claudeMdPath}`);
  failures++;
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n══ Results ══');
const automated = 11 - skipped;
const passedCount = automated - failures;
if (failures === 0 && skipped === 0) {
  console.log(`${PASS} All 11 gates passed — Phase 5 complete!\n`);
} else if (failures === 0) {
  console.log(`${PASS} All automated gates passed (${skipped} skipped — add credentials to complete)\n`);
} else {
  console.log(`${FAIL} ${failures} gate(s) failed, ${skipped} skipped (${passedCount}/${automated} automated gates passed)\n`);
}

if (skipped > 0 || failures > 0) {
  console.log('Remaining checklist:');
  if (!CASE_STUDY_URL)  console.log('  [ ] Case study: set CASE_STUDY_URL in .env.local, or confirm published manually');
  if (!IH_URL)          console.log('  [ ] IndieHackers: set INDIEHACKERS_URL in .env.local, or confirm published manually');
  if (!HOMEPAGE_URL)    console.log('  [ ] Homepage: set HOMEPAGE_URL in .env.local');
  if (!SENTRY_TOKEN)    console.log('  [ ] Sentry: set SENTRY_AUTH_TOKEN + SENTRY_ORG + SENTRY_PROJECT in .env.local');
  console.log('  [ ] MRR screenshot: save Stripe + Razorpay dashboard screenshots to docs/mrr-phase5-complete.png');
  console.log('  [ ] Visual match: open localhost:3000 + launchmind-ux-slate-sage.html side by side');
  console.log('  [ ] CLAUDE.md Section 11: update "Last updated" line to "Phase 5 complete (Week 20)"');
  console.log('');
}
