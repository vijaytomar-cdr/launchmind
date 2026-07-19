/**
 * Capture live screenshots of every real LaunchMind page.
 * Logs in as vijay@lm.com, then visits each route and screenshots it.
 */
const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const EMAIL = 'vijay@lm.com';
const PASSWORD = 'Test12345';
const BASE = 'http://localhost:3000';
const OUT_DIR = path.join(__dirname, 'screenshots-live');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// All pages to capture — grouped by section
const PAGES = [
  // Auth (no login needed)
  { id: 'auth-login',    label: 'Login',         route: '/login',          auth: false },
  { id: 'auth-signup',   label: 'Sign Up',        route: '/signup',         auth: false },
  { id: 'auth-mfa',      label: 'MFA',            route: '/mfa',            auth: false },

  // Main dashboard
  { id: 'brief',         label: 'Morning Brief',  route: '/dashboard/brief',      auth: true },
  { id: 'opportunities', label: 'Opportunities',  route: '/dashboard/opportunities', auth: true },
  { id: 'approvals',     label: 'Approvals',      route: '/dashboard/approvals',   auth: true },
  { id: 'ask',           label: 'Ask LaunchMind', route: '/dashboard/ask',         auth: true },

  // Products
  { id: 'products',      label: 'Products',       route: '/dashboard/products',    auth: true },

  // Marketing
  { id: 'campaigns',     label: 'Campaigns',      route: '/dashboard/campaigns',   auth: true },
  { id: 'content',       label: 'Content Studio', route: '/dashboard/content',     auth: true },
  { id: 'briefs',        label: 'Weekly Briefs',  route: '/dashboard/briefs',      auth: true },
  { id: 'experiments',   label: 'Experiments',    route: '/dashboard/experiments', auth: true },
  { id: 'calendar',      label: 'Calendar',       route: '/dashboard/calendar',    auth: true },
  { id: 'missions',      label: 'Missions',       route: '/dashboard/missions',    auth: true },

  // Results
  { id: 'analytics',     label: 'Analytics',      route: '/dashboard/analytics',   auth: true },
  { id: 'reports',       label: 'Reports',        route: '/dashboard/reports',     auth: true },
  { id: 'results',       label: 'Results',        route: '/dashboard/results',     auth: true },

  // Intelligence
  { id: 'growth-brain',  label: 'Growth Brain',   route: '/dashboard/intelligence/growth-brain', auth: true },
  { id: 'market',        label: 'Market Intel',   route: '/dashboard/intelligence/market',       auth: true },
  { id: 'reviews',       label: 'Reviews',        route: '/dashboard/intelligence/reviews',      auth: true },
  { id: 'memory',        label: 'Memory',         route: '/dashboard/intelligence/memory',       auth: true },
  { id: 'knowledge',     label: 'Knowledge Graph',route: '/dashboard/intelligence/knowledge',    auth: true },
  { id: 'timeline',      label: 'Timeline',       route: '/dashboard/intelligence/timeline',     auth: true },
  { id: 'ai-audit',      label: 'AI Audit',       route: '/dashboard/intelligence/ai-audit',     auth: true },

  // Connect & Account
  { id: 'channels',      label: 'Channels',       route: '/dashboard/channels',    auth: true },
  { id: 'billing',       label: 'Billing',        route: '/dashboard/billing',     auth: true },
  { id: 'settings',      label: 'Settings',       route: '/dashboard/settings',    auth: true },
];

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // ── Step 1: Log in ────────────────────────────────────────────────────────
  console.log('\n🔐 Logging in as', EMAIL);
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });

  // Fill email
  const emailInput = await page.$('input[type="email"], input[placeholder*="email" i], input[name="email"]');
  if (!emailInput) throw new Error('Email field not found on login page');
  await emailInput.fill(EMAIL);

  // Fill password
  const pwInput = await page.$('input[type="password"]');
  if (!pwInput) throw new Error('Password field not found on login page');
  await pwInput.fill(PASSWORD);

  // Submit — button is type="button" with text "Sign in →"
  const submitBtn = await page.getByRole('button', { name: /sign in/i }).first();
  if (!submitBtn) throw new Error('Submit button not found on login page');
  await submitBtn.click();

  // Wait for redirect away from /login
  try {
    await page.waitForURL(url => !url.href.includes('/login') && !url.href.includes('/mfa'), { timeout: 8000 });
    console.log('✓ Logged in → redirected to:', page.url());
  } catch (e) {
    // Might be on MFA page
    const currentUrl = page.url();
    console.log('⚠ After login, on:', currentUrl);
    if (currentUrl.includes('/mfa')) {
      console.log('  (MFA page — will skip authenticated captures; only auth pages available)');
    }
  }

  await page.waitForTimeout(1000);

  const results = [];

  // ── Step 1b: Capture auth pages in a fresh unauthenticated context ────────
  console.log('\n📸 Capturing auth pages (unauthenticated)...');
  const authCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const authPage = await authCtx.newPage();
  for (const pg of PAGES.filter(p => !p.auth)) {
    try {
      await authPage.goto(`${BASE}${pg.route}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await authPage.waitForTimeout(600);
      const fname = `${pg.id}.png`;
      const fpath = path.join(OUT_DIR, fname);
      await authPage.screenshot({ path: fpath, fullPage: false });
      const stat = fs.statSync(fpath);
      console.log(`✓ ${pg.label} → ${fname} (${Math.round(stat.size/1024)}KB)`);
    } catch (err) {
      console.error(`✗ ${pg.label}: ${err.message}`);
    }
  }
  await authCtx.close();

  // ── Step 2: Capture each authenticated page ────────────────────────────────
  for (const pg of PAGES.filter(p => p.auth)) {
    try {
      const url = `${BASE}${pg.route}`;
      // Use domcontentloaded for pages that may have long-running fetch (brief, analytics)
      const waitUntil = ['brief','analytics','results'].some(s => pg.route.includes(s))
        ? 'domcontentloaded' : 'networkidle';
      await page.goto(url, { waitUntil, timeout: 20000 });
      await page.waitForTimeout(1200); // let JS render data

      const fname = `${pg.id}.png`;
      const fpath = path.join(OUT_DIR, fname);
      await page.screenshot({ path: fpath, fullPage: false });

      const stat = fs.statSync(fpath);
      const landed = page.url();
      const redirected = !landed.includes(pg.route);
      const flag = redirected ? '⚠ (redirected)' : '✓';
      console.log(`${flag} ${pg.label} → ${fname} (${Math.round(stat.size/1024)}KB)${redirected ? '  [→ '+landed+']' : ''}`);

      results.push({
        id: pg.id,
        label: pg.label,
        route: pg.route,
        file: fpath,
        size: stat.size,
        landedUrl: landed,
        redirected,
      });
    } catch (err) {
      console.error(`✗ ${pg.label} (${pg.route}): ${err.message}`);
      // Save error state screenshot if possible
      try {
        const fpath = path.join(OUT_DIR, `${pg.id}-error.png`);
        await page.screenshot({ path: fpath, fullPage: false });
        results.push({ id: pg.id, label: pg.label + ' (error)', route: pg.route, file: fpath, size: 0, error: err.message });
      } catch (_) {}
    }
  }

  await browser.close();

  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(results, null, 2));
  console.log(`\n✅ Done — ${results.length} screenshots in ${OUT_DIR}`);
}

run().catch(err => { console.error('FATAL:', err); process.exit(1); });
