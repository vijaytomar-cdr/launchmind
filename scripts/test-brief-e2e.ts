/**
 * @file test-brief-e2e.ts
 * @description End-to-end brief pipeline verification for Week 6.
 *   Seeds: founder, product, campaigns (launched), campaign_metrics for current week.
 *   Then:
 *     1. POSTs to POST /admin/trigger-brief → verifies 200 + jobId
 *     2. Polls weekly_briefs until status != 'draft' OR 60s timeout
 *     3. Verifies weekly_briefs row: what_worked, what_to_kill, next_actions, ai_tokens_consumed
 *     4. Verifies playbook_signals: no PII, correct columns
 *     5. Verifies audit_logs: weekly_brief_generated entry
 *     6. Verifies audit_logs: token_consumed:weekly_brief entry
 *     7. Prints brief narrative for manual review
 *
 * Prerequisites:
 *   - supabase start (local Supabase on localhost:54321)
 *   - Fastify API running: cd backend && npm run dev  (or Docker)
 *   - Redis running: docker compose up -d redis
 *   - ANTHROPIC_API_KEY in environment (uses Claude Haiku — ~5-10s)
 *   - ADMIN_SECRET matching the server
 *   - SUPABASE_SERVICE_ROLE_KEY + SUPABASE_URL
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... \
 *   ADMIN_SECRET=your-admin-secret \
 *   SUPABASE_URL=http://localhost:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=<key> \
 *   npx tsx scripts/test-brief-e2e.ts
 */

import { createClient } from '@supabase/supabase-js';

const API = 'http://localhost:3001';
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? '';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://localhost:54321';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── Seed IDs ──────────────────────────────────────────────────────────────────

const FOUNDER_ID   = 'ba100000-0000-0000-0000-000000000001';
const PRODUCT_ID   = 'ba200000-0000-0000-0000-000000000001';
const CAMPAIGN_A   = 'ba300000-0000-0000-0000-000000000001'; // WhatsApp India — good
const CAMPAIGN_B   = 'ba300000-0000-0000-0000-000000000002'; // Meta USA — poor
const WEEK_START   = getMonday(new Date());

let pass = 0;
let fail = 0;

function ok(label: string) { console.log(`  ✓  ${label}`); pass++; }
function err(label: string, detail?: string) {
  console.log(`  ✗  ${label}${detail ? `\n     ${detail}` : ''}`);
  fail++;
}
function check(label: string, condition: boolean, detail?: string) {
  condition ? ok(label) : err(label, detail);
}

function getMonday(d: Date): string {
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d);
  mon.setUTCDate(diff);
  return mon.toISOString().split('T')[0];
}

// ── Seed ──────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('\n── Seeding test data ────────────────────────────────────────────────');

  await supabase.from('founders').upsert({
    id: FOUNDER_ID,
    email: 'brief-test@launchmind.test',
    name: 'Brief Test Founder',
    plan: 'solo',
    mfa_enabled: false,
    token_balance: 300,
  }, { onConflict: 'id' });

  await supabase.from('products').upsert({
    id: PRODUCT_ID,
    founder_id: FOUNDER_ID,
    name: 'TestBriefApp',
    store_url: 'https://apps.apple.com/app/testbriefapp/id000000002',
    platform: 'app_store',
    category: 'Productivity',
    markets: ['usa', 'india'],
    price_tier: 'freemium',
    confirmed_icp: { targetUser: 'Freelancers', geography: ['usa', 'india'], priceTier: 'freemium', painPoints: ['scattered tasks'], competitorGaps: ['no AI brief'], suggestedMarkets: ['usa', 'india'] },
  }, { onConflict: 'id' });

  await supabase.from('campaigns').upsert({
    id: CAMPAIGN_A,
    product_id: PRODUCT_ID,
    founder_id: FOUNDER_ID,
    channel: 'whatsapp',
    market: 'india',
    status: 'launched',
    hook_type: 'pain_first',
    approved_at: new Date().toISOString(),
    launched_at: new Date().toISOString(),
  }, { onConflict: 'id' });

  await supabase.from('campaigns').upsert({
    id: CAMPAIGN_B,
    product_id: PRODUCT_ID,
    founder_id: FOUNDER_ID,
    channel: 'meta',
    market: 'usa',
    status: 'launched',
    hook_type: 'social_proof',
    approved_at: new Date().toISOString(),
    launched_at: new Date().toISOString(),
  }, { onConflict: 'id' });

  // Good performer: WhatsApp India
  await supabase.from('campaign_metrics').upsert({
    campaign_id: CAMPAIGN_A,
    founder_id: FOUNDER_ID,
    week_start: WEEK_START,
    impressions: 5000,
    clicks: 350,
    installs: 42,
    cpi: 1.20,
    ctr: 0.07,
    roas: 2.1,
  }, { onConflict: 'campaign_id,week_start' });

  // Poor performer: Meta USA
  await supabase.from('campaign_metrics').upsert({
    campaign_id: CAMPAIGN_B,
    founder_id: FOUNDER_ID,
    week_start: WEEK_START,
    impressions: 12000,
    clicks: 120,
    installs: 0,
    cpi: null,
    ctr: 0.01,
    roas: 0,
  }, { onConflict: 'campaign_id,week_start' });

  console.log(`  ✓  Seeded: founder, product, 2 campaigns, 2 metrics for week ${WEEK_START}`);
}

// ── Test 1: Trigger brief via admin endpoint ──────────────────────────────────

async function testTriggerBrief(): Promise<string> {
  console.log('\n── Test 1: POST /admin/trigger-brief ───────────────────────────────');

  if (!ADMIN_SECRET) {
    err('ADMIN_SECRET not set — cannot call admin endpoint');
    return '';
  }

  const res = await fetch(`${API}/admin/trigger-brief`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-secret': ADMIN_SECRET },
    body: JSON.stringify({ productId: PRODUCT_ID, founderId: FOUNDER_ID, weekOf: WEEK_START }),
  });

  check('POST /admin/trigger-brief → 200', res.status === 200, `status: ${res.status}`);

  const body = await res.json() as { jobId?: string; queued?: boolean };
  check('Response has jobId', typeof body.jobId === 'string' && body.jobId.length > 0, JSON.stringify(body));
  check('Response has queued: true', body.queued === true, JSON.stringify(body));

  console.log(`  ↳ jobId: ${body.jobId}`);
  return body.jobId ?? '';
}

// ── Test 2: Poll for brief completion ─────────────────────────────────────────

async function pollForBrief(): Promise<Record<string, unknown> | null> {
  console.log('\n── Test 2: Polling weekly_briefs (up to 60s) ───────────────────────');
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    const { data, error } = await supabase
      .from('weekly_briefs')
      .select('id, product_id, week_of, what_worked, what_to_kill, next_actions, ai_tokens_consumed, status, sent_at')
      .eq('product_id', PRODUCT_ID)
      .eq('week_of', WEEK_START)
      .single();

    if (data) {
      console.log(`  ↳ Brief found: status=${data.status}`);
      return data as Record<string, unknown>;
    }
    if (error && error.code !== 'PGRST116') {
      err('DB error querying weekly_briefs', error.message);
      return null;
    }

    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 3000));
  }

  console.log('');
  err('Timed out waiting for brief — is the BullMQ worker running?', 'Run: cd backend && npm run dev');
  return null;
}

// ── Test 3: Verify brief row ──────────────────────────────────────────────────

function verifyBriefRow(brief: Record<string, unknown>) {
  console.log('\n── Test 3: Verify weekly_briefs row ────────────────────────────────');

  check('brief.what_worked is a non-empty string', typeof brief.what_worked === 'string' && (brief.what_worked as string).length > 0, String(brief.what_worked));
  check('brief.what_to_kill is a non-empty string', typeof brief.what_to_kill === 'string' && (brief.what_to_kill as string).length > 0, String(brief.what_to_kill));
  check('brief.next_actions is an array', Array.isArray(brief.next_actions), typeof brief.next_actions);
  check('brief.ai_tokens_consumed = 20', brief.ai_tokens_consumed === 20, String(brief.ai_tokens_consumed));
  check("brief.status is 'sent' or 'draft'", brief.status === 'sent' || brief.status === 'draft', String(brief.status));
  check('brief.week_of matches seeded week', brief.week_of === WEEK_START, String(brief.week_of));

  if (Array.isArray(brief.next_actions) && brief.next_actions.length > 0) {
    const action = brief.next_actions[0] as { channel?: string; hookType?: string; market?: string };
    check('next_actions[0] has channel', typeof action.channel === 'string', JSON.stringify(action));
    check('next_actions[0] has hookType', typeof action.hookType === 'string', JSON.stringify(action));
  }

  console.log(`\n  What worked: ${String(brief.what_worked).substring(0, 100)}`);
  console.log(`  What to kill: ${String(brief.what_to_kill).substring(0, 100)}`);
  const actions = Array.isArray(brief.next_actions) ? brief.next_actions : [];
  console.log(`  Next actions: ${actions.length} recommendations`);
  for (const a of actions as Array<{ channel: string; market: string; hookType: string; rationale: string }>) {
    console.log(`    → ${a.channel} (${a.market}): ${a.hookType} — ${a.rationale}`);
  }
}

// ── Test 4: Verify playbook_signals (no PII) ──────────────────────────────────

async function verifyPlaybookSignals() {
  console.log('\n── Test 4: playbook_signals — no PII ───────────────────────────────');

  const { data: signals, error } = await supabase
    .from('playbook_signals')
    .select('category, market, channel, hook_type, price_tier, install_delta_pct, conversion_rate, retention_d7, week_number, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    err('Failed to query playbook_signals', error.message);
    return;
  }

  check('playbook_signals has rows', (signals?.length ?? 0) > 0, 'No signals found — did the brief run?');

  const PII_FIELDS = ['founder_id', 'product_id', 'email', 'store_url', 'ip_address', 'name', 'phone'];
  for (const signal of signals ?? []) {
    const raw = JSON.stringify(signal);
    for (const piiField of PII_FIELDS) {
      if (raw.includes(piiField)) {
        err(`CRITICAL: PII field '${piiField}' found in playbook_signals`, raw.substring(0, 100));
      }
    }
    // Check no UUID-shaped values
    const uuidPattern = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i;
    for (const [key, val] of Object.entries(signal)) {
      if (typeof val === 'string' && uuidPattern.test(val)) {
        err(`CRITICAL: UUID value found in playbook_signals column '${key}'`, val);
      }
    }
  }

  if (signals && signals.length > 0) ok(`playbook_signals: ${signals.length} rows, no PII detected`);

  for (const s of signals?.slice(0, 2) ?? []) {
    console.log(`  → ${s.channel}/${s.market} hook=${s.hook_type} install_delta=${s.install_delta_pct}`);
  }
}

// ── Test 5: Verify audit_logs ─────────────────────────────────────────────────

async function verifyAuditLogs() {
  console.log('\n── Test 5: audit_logs verification ─────────────────────────────────');

  const { data: logs } = await supabase
    .from('audit_logs')
    .select('action, metadata, created_at')
    .eq('founder_id', FOUNDER_ID)
    .in('action', ['weekly_brief_generated', 'token_consumed:weekly_brief'])
    .order('created_at', { ascending: false })
    .limit(10);

  const hasBriefLog = logs?.some((l) => l.action === 'weekly_brief_generated') ?? false;
  const hasTokenLog = logs?.some((l) => l.action === 'token_consumed:weekly_brief') ?? false;

  check('audit_logs has weekly_brief_generated', hasBriefLog, 'Missing entry — check writeBriefAuditLog()');
  check('audit_logs has token_consumed:weekly_brief (20 tokens)', hasTokenLog, 'Missing entry — check consumeTokens() in generateBriefNarrative()');

  for (const log of logs?.slice(0, 3) ?? []) {
    console.log(`  ↳ ${log.action}: ${JSON.stringify(log.metadata ?? {}).substring(0, 60)}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(' LaunchMind — Week 6 Brief Pipeline E2E');
  console.log('══════════════════════════════════════════════════════════════════════');

  try {
    const health = await fetch(`${API}/health`);
    if (!health.ok) throw new Error(`API not reachable: ${health.status}`);
    console.log('\n✓  API reachable');

    await seed();
    await testTriggerBrief();

    const brief = await pollForBrief();
    if (brief) {
      verifyBriefRow(brief);
    }

    await verifyPlaybookSignals();
    await verifyAuditLogs();

    console.log('\n══════════════════════════════════════════════════════════════════════');
    console.log(` Results: ${pass} passed, ${fail} failed`);
    if (fail === 0) {
      console.log(' All Week 6 pipeline checks passed.');
    } else {
      console.log(' Fix the failures above before proceeding to Week 7.');
    }
    console.log('══════════════════════════════════════════════════════════════════════\n');
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    console.error('\nFatal:', e);
    process.exit(1);
  }
})();
