/**
 * @file test-strategy-e2e.ts
 * @description End-to-end strategy verification for ClientPulse.
 *   Seeds a solo founder + confirmed product in Supabase local, calls
 *   POST /products/:id/strategy, then prints USA + India output for manual review.
 *
 * Prerequisites:
 *   - supabase start (local Supabase running on localhost:54321)
 *   - Fastify API running: cd backend && npm run dev
 *   - Anthropic API key: ANTHROPIC_API_KEY in environment
 *   - SUPABASE_SERVICE_ROLE_KEY + SUPABASE_URL in environment
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... \
 *   SUPABASE_URL=http://localhost:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=<local_service_role_key> \
 *   npx tsx scripts/test-strategy-e2e.ts
 */

import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const API = 'http://localhost:3001';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://localhost:54321';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── ClientPulse seed data ─────────────────────────────────────────────────────

const FOUNDER_ID = '11110000-0000-0000-0000-000000000001';
const PRODUCT_ID = '22220000-0000-0000-0000-000000000001';

const CLIENTPULSE_ICP = {
  targetUser: 'Freelancers and solo consultants aged 28–45 who lose track of client communication and miss follow-ups',
  geography: ['usa', 'india'],
  priceTier: 'freemium',
  painPoints: [
    'Miss follow-up reminders and lose deals because of scattered WhatsApp/email threads',
    "No single view of client health — don't know which clients are at risk",
    'Manual CRM entry takes too long, so they stop updating it after week 2',
    'Context switching between 5 apps to track one client costs 45 minutes/day',
  ],
  competitorGaps: [
    'HubSpot and Salesforce are too complex and expensive for solo operators',
    'Competitors require manual data entry — ClientPulse auto-syncs from WhatsApp + Gmail',
    'No competitor gives a "client health score" without a data analyst',
  ],
  suggestedMarkets: ['usa', 'india'],
};

async function seed() {
  // Upsert founder
  await supabase.from('founders').upsert({
    id: FOUNDER_ID,
    email: 'test-clientpulse@launchmind.test',
    name: 'Test Founder',
    plan: 'solo',
    mfa_enabled: false,
    token_balance: 300,
  }, { onConflict: 'id' });

  // Upsert product
  await supabase.from('products').upsert({
    id: PRODUCT_ID,
    founder_id: FOUNDER_ID,
    name: 'ClientPulse',
    store_url: 'https://apps.apple.com/app/clientpulse/id999999999',
    platform: 'app_store',
    category: 'Productivity',
    markets: ['usa', 'india'],
    price_tier: 'freemium',
    confirmed_icp: CLIENTPULSE_ICP,
    competitor_set: [
      { name: 'HubSpot', developer: 'HubSpot Inc', rating: 4.2, category: 'Productivity', priceTier: 'paid', platform: 'app_store' },
      { name: 'Streak CRM', developer: 'Streak', rating: 4.0, category: 'Productivity', priceTier: 'freemium', platform: 'app_store' },
    ],
    last_scraped_at: new Date().toISOString(),
  }, { onConflict: 'id' });

  console.log('✓ Seed: ClientPulse product + founder created');
}

function makeToken() {
  return jwt.sign({ sub: FOUNDER_ID, role: 'authenticated' }, JWT_SECRET, { expiresIn: '1h' });
}

async function runStrategy() {
  const token = makeToken();

  console.log('\n── Calling POST /products/:id/strategy ──────────────────────────────');
  console.log(`   Product: ${PRODUCT_ID}`);
  console.log('   (This calls Claude Sonnet — ~10–30s)');

  const startMs = Date.now();
  const res = await fetch(`${API}/products/${PRODUCT_ID}/strategy`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`   Status: ${res.status} (${elapsed}s)\n`);

  if (!res.ok) {
    const err = await res.json();
    console.error('✗ Strategy generation failed:', JSON.stringify(err, null, 2));
    process.exit(1);
  }

  const strategy = await res.json();
  return strategy;
}

function printStrategy(strategy: Record<string, unknown>) {
  const s = strategy as {
    executiveSummary: string;
    usa: { positioning: string; messagingAngle: string; pricingAngle: string; topObjection: string; primaryChannels: string[] };
    india: { positioning: string; messagingAngle: string; pricingAngle: string; topObjection: string; primaryChannels: string[] };
    thirtyDay: Array<{ channel: string; hookType: string; rationale: string; projectedPerformance: string; suggestedWeeklySpendUSD: number; suggestedWeeklySpendINR: number; primaryKPI: string }>;
    sixtyDay: typeof s.thirtyDay;
    ninetyDay: typeof s.thirtyDay;
  };

  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(' ClientPulse Strategy — Manual Review');
  console.log('══════════════════════════════════════════════════════════════════════\n');

  console.log('── Executive Summary ────────────────────────────────────────────────');
  console.log(s.executiveSummary);

  console.log('\n── USA Market ───────────────────────────────────────────────────────');
  console.log(`Positioning:    ${s.usa.positioning}`);
  console.log(`Messaging:      ${s.usa.messagingAngle}`);
  console.log(`Pricing angle:  ${s.usa.pricingAngle}`);
  console.log(`Top objection:  ${s.usa.topObjection}`);
  console.log(`Channels:       ${s.usa.primaryChannels.join(', ')}`);

  console.log('\n── India Market ─────────────────────────────────────────────────────');
  console.log(`Positioning:    ${s.india.positioning}`);
  console.log(`Messaging:      ${s.india.messagingAngle}`);
  console.log(`Pricing angle:  ${s.india.pricingAngle}`);
  console.log(`Top objection:  ${s.india.topObjection}`);
  console.log(`Channels:       ${s.india.primaryChannels.join(', ')}`);

  console.log('\n── 30-Day Channel Plan ──────────────────────────────────────────────');
  for (const c of s.thirtyDay) {
    const painCheck = c.hookType === 'pain_first' ? '✓ pain_first' : `⚠ hookType=${c.hookType}`;
    console.log(`  ${c.channel.padEnd(10)} ${painCheck.padEnd(20)} perf=${c.projectedPerformance} USD=$${c.suggestedWeeklySpendUSD}/wk INR=₹${c.suggestedWeeklySpendINR}/wk`);
    console.log(`             rationale: ${c.rationale}`);
  }

  console.log('\n── 60-Day Channels ──────────────────────────────────────────────────');
  for (const c of s.sixtyDay) {
    console.log(`  ${c.channel.padEnd(10)} hookType=${c.hookType}`);
  }

  console.log('\n── 90-Day Channels ──────────────────────────────────────────────────');
  for (const c of s.ninetyDay) {
    console.log(`  ${c.channel.padEnd(10)} hookType=${c.hookType}`);
  }

  console.log('\n── Verification Checklist ───────────────────────────────────────────');
  const allHooks = [...s.thirtyDay, ...s.sixtyDay, ...s.ninetyDay].map((c) => c.hookType);
  const validHooks = ['pain_first', 'social_proof', 'fomo', 'outcome', 'curiosity'];
  const invalidHooks = allHooks.filter((h) => !validHooks.includes(h));
  console.log(`  hookType values valid:   ${invalidHooks.length === 0 ? '✓' : `✗ invalid: ${invalidHooks.join(', ')}`}`);
  console.log(`  USA output present:      ${s.usa.positioning ? '✓' : '✗'}`);
  console.log(`  India output present:    ${s.india.positioning ? '✓' : '✗'}`);
  console.log(`  30-day channels:         ${s.thirtyDay.length} channels`);
  console.log(`  60-day channels:         ${s.sixtyDay.length} channels`);
  console.log(`  90-day channels:         ${s.ninetyDay.length} channels`);

  const hasPainFirst = s.thirtyDay.some((c) => c.hookType === 'pain_first');
  console.log(`  Pain-first hook in 30d:  ${hasPainFirst ? '✓' : '✗ — FAIL: at least one 30d channel must use pain_first'}`);
}

async function verifyCampaignDrafts() {
  const { data: campaigns, error } = await supabase
    .from('campaigns')
    .select('channel, market, status, hook_type, spend_cap')
    .eq('product_id', PRODUCT_ID)
    .order('channel');

  if (error) {
    console.error('\n✗ Failed to query campaign drafts:', error.message);
    return;
  }

  console.log('\n── Campaign Draft Rows in DB ────────────────────────────────────────');
  console.log(`  Total rows: ${campaigns?.length ?? 0} (expected: 30d_channels × markets)`);
  for (const c of campaigns ?? []) {
    console.log(`  ${c.channel.padEnd(10)} ${c.market.padEnd(6)} status=${c.status} hookType=${c.hook_type}`);
  }

  const channelMarketPairs = new Set(campaigns?.map((c: { channel: string; market: string }) => `${c.channel}:${c.market}`) ?? []);
  console.log(`  Unique channel×market: ${channelMarketPairs.size}`);
}

async function verifyAuditLogs() {
  const { data: logs } = await supabase
    .from('audit_logs')
    .select('action, metadata, created_at')
    .eq('founder_id', FOUNDER_ID)
    .order('created_at', { ascending: false })
    .limit(10);

  console.log('\n── Recent Audit Logs ────────────────────────────────────────────────');
  for (const log of logs ?? []) {
    const meta = JSON.stringify(log.metadata ?? {});
    console.log(`  ${String(log.action).padEnd(35)} ${meta.substring(0, 60)}`);
  }

  const hasTokenLog = logs?.some((l: { action: string }) => l.action.startsWith('token_consumed'));
  const hasStrategyLog = logs?.some((l: { action: string }) => l.action === 'strategy_generated');
  console.log(`\n  token_consumed in logs:    ${hasTokenLog ? '✓' : '✗ — consumeTokens() not writing to audit_logs'}`);
  console.log(`  strategy_generated in logs: ${hasStrategyLog ? '✓' : '✗'}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  try {
    await seed();
    const strategy = await runStrategy();
    printStrategy(strategy);
    await verifyCampaignDrafts();
    await verifyAuditLogs();

    console.log('\n══════════════════════════════════════════════════════════════════════');
    console.log(' Review the USA + India output above manually for quality.');
    console.log(' WhatsApp copy quality: run the assets endpoint next.');
    console.log(` npx tsx scripts/test-assets-e2e.ts ${PRODUCT_ID}`);
    console.log('══════════════════════════════════════════════════════════════════════\n');
  } catch (err) {
    console.error('Fatal:', err);
    process.exit(1);
  }
})();
