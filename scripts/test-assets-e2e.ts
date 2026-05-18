/**
 * @file test-assets-e2e.ts
 * @description Generates WhatsApp + Email content assets for a product and prints them
 *   for manual quality review. Verifies pain-first hooks in WhatsApp copy.
 *
 * Usage (run AFTER test-strategy-e2e.ts which seeds the product):
 *   ANTHROPIC_API_KEY=sk-ant-... \
 *   SUPABASE_URL=http://localhost:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=<key> \
 *   npx tsx scripts/test-assets-e2e.ts [productId]
 *
 * Note: requires builder plan — test-strategy-e2e.ts seeds a solo founder.
 * Update founders.plan='builder' in local DB before running.
 */

import jwt from 'jsonwebtoken';

const API = 'http://localhost:3001';
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long';
const FOUNDER_ID = '11110000-0000-0000-0000-000000000001';
const PRODUCT_ID = process.argv[2] ?? '22220000-0000-0000-0000-000000000001';

function makeToken() {
  return jwt.sign({ sub: FOUNDER_ID, role: 'authenticated' }, JWT_SECRET, { expiresIn: '1h' });
}

async function getAssets(channel: string, market: string) {
  const token = makeToken();
  console.log(`\n── POST /products/${PRODUCT_ID}/strategy/assets (${channel} / ${market}) ─`);

  const res = await fetch(`${API}/products/${PRODUCT_ID}/strategy/assets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, market }),
  });

  if (!res.ok) {
    const err = await res.json();
    console.error(`  ✗ ${res.status}:`, JSON.stringify(err));
    return null;
  }

  return res.json();
}

function reviewWhatsApp(assets: Record<string, unknown>) {
  const templates = (assets.whatsapp ?? []) as Array<{
    hookType: string;
    headline: string;
    body: string;
    cta: string;
  }>;

  console.log(`\n  WhatsApp variants (${templates.length}):`);
  for (const [i, t] of templates.entries()) {
    const isPainFirst = t.hookType === 'pain_first';
    console.log(`\n  [${i + 1}] hookType: ${t.hookType} ${isPainFirst ? '✓ pain_first' : '⚠ not pain_first'}`);
    console.log(`      Headline: ${t.headline}`);
    console.log(`      Body:     ${t.body}`);
    console.log(`      CTA:      ${t.cta}`);
  }

  const hasPainFirst = templates.some((t) => t.hookType === 'pain_first');
  const validHooks = ['pain_first', 'social_proof', 'fomo', 'outcome', 'curiosity'];
  const invalidHooks = templates.filter((t) => !validHooks.includes(t.hookType));

  console.log('\n  Checks:');
  console.log(`    ≥1 pain_first variant:  ${hasPainFirst ? '✓' : '✗ FAIL'}`);
  console.log(`    All hookTypes valid:     ${invalidHooks.length === 0 ? '✓' : `✗ invalid: ${invalidHooks.map((t) => t.hookType).join(', ')}`}`);
  console.log(`    3 variants generated:   ${templates.length === 3 ? '✓' : `⚠ got ${templates.length}`}`);
}

function reviewEmail(assets: Record<string, unknown>) {
  const seq = (assets.emailSequence ?? []) as Array<{
    day: number;
    subject: string;
    preview: string;
    body: string;
  }>;

  console.log(`\n  Email sequence (${seq.length} emails):`);
  for (const e of seq) {
    console.log(`\n  Day ${e.day}`);
    console.log(`    Subject: ${e.subject}`);
    console.log(`    Preview: ${e.preview}`);
    console.log(`    Body:    ${e.body.substring(0, 120)}${e.body.length > 120 ? '…' : ''}`);
  }
  const days = seq.map((e) => e.day).sort((a, b) => a - b);
  console.log(`\n  Day sequence: ${days.join(', ')} (expected: 0, 3, 7)`);
}

(async () => {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(' ClientPulse Content Assets — Manual Review');
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(' NOTE: requires founders.plan=\'builder\' in local DB.');
  console.log(` UPDATE founders SET plan='builder' WHERE id='${FOUNDER_ID}';`);

  // WhatsApp India (pain-first is critical here)
  const waIndia = await getAssets('whatsapp', 'india');
  if (waIndia) reviewWhatsApp(waIndia);

  // WhatsApp USA
  const waUsa = await getAssets('whatsapp', 'usa');
  if (waUsa) reviewWhatsApp(waUsa);

  // Email India
  const emailIndia = await getAssets('email', 'india');
  if (emailIndia) reviewEmail(emailIndia);

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(' Manual review checklist:');
  console.log('   □ WhatsApp India: at least 1 variant leads with a pain point, not a feature');
  console.log('   □ WhatsApp India: uses conversational tone, not corporate speak');
  console.log('   □ WhatsApp USA: outcome-focused (time savings, ROI), not "we have X feature"');
  console.log('   □ Email day 0: welcome tone, not sales pitch');
  console.log('   □ Email day 3: problem reinforcement, not product push');
  console.log('   □ Email day 7: soft CTA, not aggressive');
  console.log('══════════════════════════════════════════════════════════════════════\n');
})();
