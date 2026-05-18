/**
 * @file seed-demo.ts
 * @description Creates a fully populated demo account for local development.
 *
 *   Creates:
 *     ✓ Auth user (demo@launchmind.test / LaunchMind2026!)
 *     ✓ Founder row (solo plan, 300 tokens)
 *     ✓ Product: FocusFlow — a productivity app on App Store
 *     ✓ 3 Campaigns: WhatsApp India, Meta USA, Google USA
 *     ✓ 4 weeks of campaign_metrics (realistic data with trends)
 *     ✓ 1 weekly_brief for current week
 *     ✓ Playbook signals (anonymized)
 *     ✓ Audit log entries
 *     ✓ 2 UTM tracking links
 *
 *   Requires the real service_role key (NOT the anon key):
 *     Supabase Dashboard → Settings → API → service_role (secret)
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... npx tsx scripts/seed-demo.ts
 *
 *   Or add it to .env.dev and run:
 *   npx tsx scripts/seed-demo.ts
 */

import { createClient } from '@supabase/supabase-js';
import WS from 'ws';
if (!('WebSocket' in globalThis)) Object.assign(globalThis, { WebSocket: WS });

// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://gseqtbwdenjkwysregpp.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const DEMO_EMAIL    = 'demo@launchmind.test';
const DEMO_PASSWORD = 'LaunchMind2026!';

// ── Helpers ───────────────────────────────────────────────────────────────────

let pass = 0; let fail = 0;
function ok(msg: string)  { console.log(`  ✓  ${msg}`); pass++; }
function err(msg: string, detail?: string) {
  console.log(`  ✗  ${msg}${detail ? `\n     ${detail}` : ''}`); fail++;
}

function getMonday(d: Date, weeksAgo = 0): string {
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1) - weeksAgo * 7;
  const mon = new Date(d);
  mon.setUTCDate(diff);
  return mon.toISOString().split('T')[0];
}

// Validate service_role key
function validateServiceRoleKey(key: string): void {
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
    if (payload.role !== 'service_role') {
      console.error('\n❌  Wrong key type.');
      console.error(`    Got role: "${payload.role}" — need role: "service_role"`);
      console.error('\n    Get the correct key from:');
      console.error(`    https://supabase.com/dashboard/project/gseqtbwdenjkwysregpp/settings/api`);
      console.error('    Under "Project API keys" → "service_role" (click Reveal)\n');
      process.exit(1);
    }
  } catch {
    console.error('\n❌  Could not parse SUPABASE_SERVICE_ROLE_KEY — make sure it is a valid JWT.\n');
    process.exit(1);
  }
}

// ── IDs (stable so script is idempotent) ──────────────────────────────────────

const PRODUCT_ID  = 'dd200000-0000-0000-0000-000000000001';
const CAMPAIGN_WA = 'dd300000-0000-0000-0000-000000000001'; // WhatsApp India
const CAMPAIGN_MT = 'dd300000-0000-0000-0000-000000000002'; // Meta USA
const CAMPAIGN_GG = 'dd300000-0000-0000-0000-000000000003'; // Google USA

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(' LaunchMind — Demo Seed Script');
  console.log('══════════════════════════════════════════════════════════════════════\n');

  if (!SERVICE_ROLE_KEY) {
    console.error('❌  SUPABASE_SERVICE_ROLE_KEY is not set.\n');
    console.error('    Get it from:');
    console.error(`    https://supabase.com/dashboard/project/gseqtbwdenjkwysregpp/settings/api`);
    console.error('    Under "Project API keys" → "service_role" (click Reveal)\n');
    console.error('    Then run:');
    console.error('    SUPABASE_SERVICE_ROLE_KEY=eyJ... npx tsx scripts/seed-demo.ts\n');
    process.exit(1);
  }

  validateServiceRoleKey(SERVICE_ROLE_KEY);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── 1. Create / update auth user ────────────────────────────────────────────

  console.log('── Step 1: Auth user ────────────────────────────────────────────────');

  let userId: string;

  const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) { err('Failed to list users', listError.message); process.exit(1); }

  const existing = users.find((u) => u.email === DEMO_EMAIL);

  if (existing) {
    userId = existing.id;
    // Update password in case it changed
    await supabase.auth.admin.updateUserById(userId, { password: DEMO_PASSWORD });
    ok(`Auth user already exists (${userId}) — password reset`);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { name: 'Vijay (Demo)' },
    });
    if (error || !data.user) { err('Failed to create auth user', error?.message); process.exit(1); }
    userId = data.user.id;
    ok(`Auth user created (${userId})`);
  }

  // ── 2. Founder row ───────────────────────────────────────────────────────────

  console.log('\n── Step 2: Founder ──────────────────────────────────────────────────');

  const { error: founderError } = await supabase.from('founders').upsert({
    id: userId,
    email: DEMO_EMAIL,
    name: 'Vijay (Demo)',
    plan: 'solo',
    mfa_enabled: false,
    token_balance: 300,
  }, { onConflict: 'id' });

  founderError ? err('founders upsert failed', founderError.message) : ok('Founder row (solo plan, 300 tokens)');

  // ── 3. Product ───────────────────────────────────────────────────────────────

  console.log('\n── Step 3: Product ──────────────────────────────────────────────────');

  const { error: productError } = await supabase.from('products').upsert({
    id: PRODUCT_ID,
    founder_id: userId,
    name: 'FocusFlow',
    store_url: 'https://apps.apple.com/app/focusflow-deep-work-timer/id1234567890',
    platform: 'app_store',
    category: 'Productivity',
    markets: ['usa', 'india'],
    price_tier: 'freemium',
    confirmed_icp: {
      targetUser: 'Knowledge workers and freelancers who struggle with distraction',
      geography: ['usa', 'india'],
      priceTier: 'freemium',
      painPoints: [
        'Can\'t stay focused for more than 20 minutes',
        'Constant app switching kills deep work',
        'No visibility into where time actually goes',
      ],
      competitorGaps: [
        'Forest/Pomodoro apps lack detailed analytics',
        'RescueTime is desktop-only, no mobile deep work mode',
        'No competitor targets India market seriously',
      ],
      suggestedMarkets: ['usa', 'india'],
    },
    scraped_meta: {
      name: 'FocusFlow — Deep Work Timer',
      developer: 'LaunchMind Demo',
      description: 'The only Pomodoro timer built for knowledge workers. Track deep work sessions, block distractions, and see exactly where your productive hours go.',
      category: 'Productivity',
      rating: 4.6,
      ratingCount: 2847,
      priceTier: 'freemium',
      screenshots: [],
      reviews: [
        { rating: 5, text: 'Finally an app that actually helps me focus. The analytics are incredible.', date: '2026-04-10' },
        { rating: 4, text: 'Great app but wish the widget was better on iPad.', date: '2026-04-08' },
        { rating: 5, text: 'Been using for 3 months, my deep work hours doubled.', date: '2026-03-22' },
      ],
    },
    last_scraped_at: new Date().toISOString(),
  }, { onConflict: 'id' });

  productError ? err('products upsert failed', productError.message) : ok('Product: FocusFlow (Productivity, App Store, USA + India)');

  // ── 4. Campaigns ──────────────────────────────────────────────────────────────

  console.log('\n── Step 4: Campaigns ────────────────────────────────────────────────');

  const campaignBase = { product_id: PRODUCT_ID, founder_id: userId, approved_at: new Date(Date.now() - 28 * 86400_000).toISOString(), launched_at: new Date(Date.now() - 27 * 86400_000).toISOString() };

  const campaigns = [
    { id: CAMPAIGN_WA, channel: 'whatsapp', market: 'india', status: 'launched', hook_type: 'pain_first',
      copy_text: '🧠 Still struggling to focus at work?\nFocusFlow tracks your deep work sessions and blocks distractions automatically.\n✅ 50,000+ knowledge workers swear by it\n📲 Free download — no credit card needed' },
    { id: CAMPAIGN_MT, channel: 'meta',     market: 'usa',   status: 'launched', hook_type: 'social_proof',
      copy_text: '"I went from 2 hours of deep work to 5 hours a day in 3 weeks." — FocusFlow user\nYour best work starts here. Download free.' },
    { id: CAMPAIGN_GG, channel: 'google',   market: 'usa',   status: 'launched', hook_type: 'pain_first',
      copy_text: 'Can\'t focus at work? FocusFlow blocks distractions & tracks deep work. Free download.' },
  ];

  for (const c of campaigns) {
    const { error } = await supabase.from('campaigns').upsert({ ...campaignBase, ...c }, { onConflict: 'id' });
    error ? err(`Campaign ${c.channel}/${c.market} failed`, error.message) : ok(`Campaign: ${c.channel} (${c.market}) — ${c.hook_type}`);
  }

  // ── 5. Campaign metrics — 4 weeks of data ────────────────────────────────────

  console.log('\n── Step 5: Campaign metrics (4 weeks) ──────────────────────────────');

  // Realistic upward trend: WhatsApp India improving, Meta plateauing, Google declining
  const weeklyMetrics = [
    // 4 weeks ago
    {
      campaign_id: CAMPAIGN_WA, week_start: getMonday(new Date(), 3),
      impressions: 3200, clicks: 192, installs: 18, cpi: 2.10, ctr: 0.060, roas: 1.1,
    },
    {
      campaign_id: CAMPAIGN_MT, week_start: getMonday(new Date(), 3),
      impressions: 9500, clicks: 133, installs: 8,  cpi: 5.50, ctr: 0.014, roas: 0.6,
    },
    {
      campaign_id: CAMPAIGN_GG, week_start: getMonday(new Date(), 3),
      impressions: 4100, clicks: 246, installs: 12, cpi: 3.20, ctr: 0.060, roas: 0.9,
    },
    // 3 weeks ago
    {
      campaign_id: CAMPAIGN_WA, week_start: getMonday(new Date(), 2),
      impressions: 4100, clicks: 287, installs: 26, cpi: 1.80, ctr: 0.070, roas: 1.5,
    },
    {
      campaign_id: CAMPAIGN_MT, week_start: getMonday(new Date(), 2),
      impressions: 10200, clicks: 143, installs: 9, cpi: 5.10, ctr: 0.014, roas: 0.7,
    },
    {
      campaign_id: CAMPAIGN_GG, week_start: getMonday(new Date(), 2),
      impressions: 3900, clicks: 234, installs: 10, cpi: 3.60, ctr: 0.060, roas: 0.8,
    },
    // 2 weeks ago
    {
      campaign_id: CAMPAIGN_WA, week_start: getMonday(new Date(), 1),
      impressions: 5400, clicks: 432, installs: 38, cpi: 1.40, ctr: 0.080, roas: 1.9,
    },
    {
      campaign_id: CAMPAIGN_MT, week_start: getMonday(new Date(), 1),
      impressions: 11000, clicks: 154, installs: 11, cpi: 4.80, ctr: 0.014, roas: 0.8,
    },
    {
      campaign_id: CAMPAIGN_GG, week_start: getMonday(new Date(), 1),
      impressions: 3600, clicks: 216, installs: 8,  cpi: 4.10, ctr: 0.060, roas: 0.7,
    },
    // Current week
    {
      campaign_id: CAMPAIGN_WA, week_start: getMonday(new Date(), 0),
      impressions: 6800, clicks: 612, installs: 54, cpi: 1.10, ctr: 0.090, roas: 2.4,
    },
    {
      campaign_id: CAMPAIGN_MT, week_start: getMonday(new Date(), 0),
      impressions: 12500, clicks: 163, installs: 14, cpi: 4.20, ctr: 0.013, roas: 1.0,
    },
    {
      campaign_id: CAMPAIGN_GG, week_start: getMonday(new Date(), 0),
      impressions: 3200, clicks: 192, installs: 6,  cpi: 4.90, ctr: 0.060, roas: 0.6,
    },
  ];

  for (const m of weeklyMetrics) {
    const { error } = await supabase.from('campaign_metrics').upsert(
      { ...m, founder_id: userId },
      { onConflict: 'campaign_id,week_start' }
    );
    if (error) err(`Metrics ${m.campaign_id.slice(-4)} wk ${m.week_start} failed`, error.message);
  }
  ok('12 metric rows across 4 weeks (WhatsApp trending up, Meta flat, Google declining)');

  // ── 6. Weekly brief ───────────────────────────────────────────────────────────

  console.log('\n── Step 6: Weekly brief ─────────────────────────────────────────────');

  const { error: briefError } = await supabase.from('weekly_briefs').upsert({
    id: 'dd600000-0000-0000-0000-000000000001',
    product_id: PRODUCT_ID,
    founder_id: userId,
    week_of: getMonday(new Date(), 0),
    what_worked: 'WhatsApp India (pain_first hook) continues its strong run — 54 installs at ₹90 CPI, up 42% week-over-week. The "struggling to focus" opening line is outperforming the social proof variant by 2.4x ROAS. India market responds strongly to problem-aware messaging. Freemium positioning landing well — no friction to install.',
    what_to_kill: 'Google USA is bleeding spend with declining installs (6 this week, down from 12). CPI has risen to $4.90 with ROAS of 0.6 — below break-even. The pain_first copy is too generic for search intent; users searching "focus app" want feature specifics, not emotional resonance. Pause Google USA and reallocate budget to WhatsApp India.',
    next_actions: [
      {
        channel: 'whatsapp',
        market: 'india',
        hookType: 'social_proof',
        rationale: 'Test a social proof variant against the winning pain_first hook. Use the "deep work hours doubled" testimonial. Keep same CTA and freemium angle. Run for 1 week with 30% of India budget.',
      },
      {
        channel: 'meta',
        market: 'india',
        hookType: 'pain_first',
        rationale: 'Expand to Meta India with the WhatsApp-winning pain_first copy. India Meta CPMs are 60% cheaper than USA. Target 25–40 software professionals in Bangalore, Hyderabad, Pune.',
      },
      {
        channel: 'google',
        market: 'usa',
        hookType: 'feature_first',
        rationale: 'If reactivating Google USA, switch to feature-first copy ("Block distractions, track deep work") to match search intent. Run only on high-intent keywords: "pomodoro app", "focus timer app".',
      },
    ],
    ai_tokens_consumed: 20,
    status: 'sent',
    sent_at: new Date(Date.now() - 3600_000).toISOString(),
  }, { onConflict: 'product_id,week_of' });

  briefError ? err('weekly_briefs upsert failed', briefError.message) : ok('Weekly brief (current week, status=sent, 3 next actions)');

  // ── 7. Playbook signals ───────────────────────────────────────────────────────

  console.log('\n── Step 7: Playbook signals ─────────────────────────────────────────');

  const signals = [
    { category: 'Productivity', market: 'india', channel: 'whatsapp', hook_type: 'pain_first', price_tier: 'freemium', install_delta_pct: 42.1, conversion_rate: 0.090, retention_d7: 0.62, week_number: 20 },
    { category: 'Productivity', market: 'usa',   channel: 'meta',     hook_type: 'social_proof', price_tier: 'freemium', install_delta_pct: 27.3, conversion_rate: 0.013, retention_d7: 0.58, week_number: 20 },
    { category: 'Productivity', market: 'usa',   channel: 'google',   hook_type: 'pain_first', price_tier: 'freemium', install_delta_pct: -25.0, conversion_rate: 0.060, retention_d7: 0.51, week_number: 20 },
  ];

  for (const s of signals) {
    const { error } = await supabase.from('playbook_signals').insert(s);
    if (error && !error.message.includes('duplicate')) err('Playbook signal failed', error.message);
  }
  ok('3 playbook signals (anonymized — no PII)');

  // ── 8. Audit logs ─────────────────────────────────────────────────────────────

  console.log('\n── Step 8: Audit logs ───────────────────────────────────────────────');

  const auditEntries = [
    { founder_id: userId, action: 'product_scraped',        resource_type: 'product', resource_id: PRODUCT_ID, metadata: { url: 'https://apps.apple.com/app/focusflow/id1234567890', platform: 'app_store', name: 'FocusFlow' } },
    { founder_id: userId, action: 'product_confirmed',      resource_type: 'product', resource_id: PRODUCT_ID, metadata: { name: 'FocusFlow', platform: 'app_store' } },
    { founder_id: userId, action: 'strategy_generated',     resource_type: 'product', resource_id: PRODUCT_ID, metadata: { tokens: 50 } },
    { founder_id: userId, action: 'weekly_brief_generated', resource_type: 'product', resource_id: PRODUCT_ID, metadata: { weekOf: getMonday(new Date(), 0), tokensConsumed: 20, triggeredBy: 'cron' } },
    { founder_id: userId, action: 'token_consumed:weekly_brief', metadata: { amount: 20, balance: 280 } },
  ];

  for (const entry of auditEntries) {
    const { error } = await supabase.from('audit_logs').insert(entry);
    if (error) err(`audit_log ${entry.action} failed`, error.message);
  }
  ok('5 audit log entries');

  // ── 9. UTM links ──────────────────────────────────────────────────────────────

  console.log('\n── Step 9: UTM links ────────────────────────────────────────────────');

  const utmLinks = [
    {
      id: 'dd700000-0000-0000-0000-000000000001',
      campaign_id: CAMPAIGN_WA, founder_id: userId,
      base_url: 'https://apps.apple.com/app/focusflow/id1234567890',
      utm_source: 'whatsapp', utm_medium: 'social', utm_campaign: 'pain_first_india_w20',
      utm_content: null, utm_term: null,
      short_code: 'ff-wa-in1', click_count: 127,
    },
    {
      id: 'dd700000-0000-0000-0000-000000000002',
      campaign_id: CAMPAIGN_MT, founder_id: userId,
      base_url: 'https://apps.apple.com/app/focusflow/id1234567890',
      utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'social_proof_usa_w20',
      utm_content: 'testimonial_v1', utm_term: null,
      short_code: 'ff-mt-us1', click_count: 43,
    },
  ];

  for (const link of utmLinks) {
    const { error } = await supabase.from('utm_links').upsert(link, { onConflict: 'short_code' });
    if (error) err(`UTM link ${link.short_code} failed`, error.message);
  }
  ok('2 UTM tracking links (WhatsApp: 127 clicks, Meta: 43 clicks)');

  // ── Done ─────────────────────────────────────────────────────────────────────

  console.log('\n══════════════════════════════════════════════════════════════════════');
  if (fail === 0) {
    console.log(' ✅  Seed complete! All data created successfully.\n');
    console.log(' 🔑  Login credentials:');
    console.log(`      Email:    ${DEMO_EMAIL}`);
    console.log(`      Password: ${DEMO_PASSWORD}`);
    console.log('\n 🌐  Open: http://localhost:3000');
    console.log('      → Sign in → Dashboard → explore FocusFlow data');
    console.log('\n 📊  What you\'ll see:');
    console.log('      /dashboard/metrics     → 4 weeks of WhatsApp/Meta/Google data');
    console.log('      /dashboard/briefs      → Weekly brief with 3 next actions');
    console.log('      /dashboard/campaigns   → 3 launched campaigns');
    console.log('      /dashboard/products    → FocusFlow (App Store, Productivity)');
  } else {
    console.log(` ⚠️   Seed finished with ${fail} failure(s). See errors above.`);
    console.log('     Common cause: missing DB migrations. Run:');
    console.log('     supabase db push  (for hosted Supabase)');
  }
  console.log('══════════════════════════════════════════════════════════════════════\n');
  process.exit(fail > 0 ? 1 : 0);
})();
