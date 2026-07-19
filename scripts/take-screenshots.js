#!/usr/bin/env node
/**
 * @file take-screenshots.js
 * @description Full-page screenshots of every LaunchMind page → single HTML report.
 *   Sets a temporary password on vijay@lm.com via admin API, signs in through
 *   the real login form (so SSR cookies are set correctly), then captures all pages.
 *   Run from project root: node scripts/take-screenshots.js
 */

const path = require('path');
const fs   = require('fs');

// Load .env.local manually
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL         = 'http://localhost:3000';
const EMAIL            = process.env.SCREENSHOT_USER    || 'vijay@lm.com';
const TEMP_PASSWORD    = process.env.SCREENSHOT_PASSWORD;
const OUTPUT           = path.join(__dirname, '..', 'docs', 'exports', 'LMJuly18-Screenshots.html');
const SCRATCH          = path.join(require('os').tmpdir(), 'lm-screenshots');

const PAGES = [
  // Public
  { label: 'Homepage',            path: '/'                                    },
  { label: 'Login',               path: '/login'                               },
  { label: 'Forgot Password',     path: '/forgot-password'                     },
  // Dashboard – main
  { label: 'Morning Brief',       path: '/dashboard/brief'                     },
  { label: 'Opportunities',       path: '/dashboard/opportunities'             },
  { label: 'Ask LaunchMind',      path: '/dashboard/ask'                       },
  { label: 'Approvals',           path: '/dashboard/approvals'                 },
  { label: 'Results',             path: '/dashboard/results'                   },
  { label: 'Analytics',           path: '/dashboard/analytics'                 },
  { label: 'Reports',             path: '/dashboard/reports'                   },
  { label: 'Missions',            path: '/dashboard/missions'                  },
  { label: 'Experiments',         path: '/dashboard/experiments'               },
  { label: 'Calendar',            path: '/dashboard/calendar'                  },
  { label: 'Campaigns',           path: '/dashboard/campaigns'                 },
  { label: 'Content Studio',      path: '/dashboard/content'                   },
  { label: 'Briefs',              path: '/dashboard/briefs'                    },
  { label: 'Channels',            path: '/dashboard/channels'                  },
  { label: 'Products',            path: '/dashboard/products'                  },
  { label: 'Billing',             path: '/dashboard/billing'                   },
  { label: 'Settings',            path: '/dashboard/settings'                  },
  { label: 'Settings – Usage',    path: '/dashboard/settings/usage'            },
  { label: 'Settings – Billing',  path: '/dashboard/settings/billing'          },
  // Intelligence
  { label: 'Memory',              path: '/dashboard/intelligence/memory'       },
  { label: 'Knowledge Graph',     path: '/dashboard/intelligence/knowledge'    },
  { label: 'Market Intelligence', path: '/dashboard/intelligence/market'       },
  { label: 'Reviews',             path: '/dashboard/intelligence/reviews'      },
  { label: 'Timeline',            path: '/dashboard/intelligence/timeline'     },
  { label: 'Ideas',               path: '/dashboard/intelligence/ideas'        },
  { label: 'Growth Brain',        path: '/dashboard/intelligence/growth-brain' },
  { label: 'AI Audit',            path: '/dashboard/intelligence/ai-audit'     },
  // Product intake wizard
  { label: 'New Product – Start', path: '/dashboard/products/new'             },
];

async function prepareAccount() {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  });
  const { data: { users }, error } = await admin.auth.admin.listUsers();
  if (error) throw new Error(`listUsers: ${error.message}`);
  const user = users.find(u => u.email === EMAIL);
  if (!user) throw new Error(`User ${EMAIL} not found`);

  // Set a known password so we can sign in via form (bypasses any MFA gate)
  const { error: pwErr } = await admin.auth.admin.updateUserById(user.id, {
    password: TEMP_PASSWORD,
    email_confirm: true,
  });
  if (pwErr) throw new Error(`updateUserById: ${pwErr.message}`);
  console.log(`  Password set on ${EMAIL}`);
  return user.id;
}

async function loginViaForm(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 20000 });

  // Fill via id attributes (login-email, login-password) from the actual page markup
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-password', TEMP_PASSWORD);
  // Button is type="button" with onClick — click by visible text
  await page.click('button:has-text("Sign in")');

  // Wait until we land somewhere other than /login
  await page.waitForFunction(
    () => !window.location.pathname.startsWith('/login'),
    { timeout: 20000 }
  );
  await page.waitForLoadState('networkidle', { timeout: 15000 });

  const landed = page.url();
  if (landed.includes('/login') || landed.includes('/mfa')) {
    throw new Error(`Login failed — still on ${landed}`);
  }
  console.log(`  Signed in → ${landed}`);
}

async function capturePage(page, label, urlPath) {
  const url = `${BASE_URL}${urlPath}`;
  process.stdout.write(`  ${label.padEnd(30)}`);
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 25000 });
    // If redirected to login the cookie expired — unusual but guard anyway
    if (page.url().includes('/login')) {
      console.log('✗  (redirected to login)');
      return null;
    }
    await page.waitForTimeout(1000);
    const file = path.join(SCRATCH, label.replace(/[^a-z0-9]/gi, '_') + '.png');
    await page.screenshot({ path: file, fullPage: true });
    console.log('✓');
    return file;
  } catch (err) {
    console.log(`✗  ${err.message.split('\n')[0]}`);
    return null;
  }
}

function toB64(file) {
  if (!file || !fs.existsSync(file)) return null;
  return fs.readFileSync(file).toString('base64');
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  }
  if (!TEMP_PASSWORD) {
    throw new Error('Set SCREENSHOT_PASSWORD in .env.local before running');
  }
  fs.mkdirSync(SCRATCH, { recursive: true });
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });

  console.log('Preparing account...');
  await prepareAccount();

  console.log('\nLaunching browser (1440×900)...');
  const browser = await chromium.launch({ headless: true });
  const ctx     = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page    = await ctx.newPage();

  console.log('Signing in via login form...');
  await loginViaForm(page);
  console.log('');

  const results = [];
  for (const pg of PAGES) {
    const file = await capturePage(page, pg.label, pg.path);
    results.push({ ...pg, file });
  }
  await browser.close();

  const captured = results.filter(r => r.file).length;
  const dateStr  = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  console.log(`\nBuilding HTML (${captured}/${results.length} captured)...`);

  const navHtml = results.map((r, i) =>
    `<a href="#p${i}" class="nav-item${!r.file ? ' miss' : ''}">${r.label}</a>`
  ).join('');

  const sectionsHtml = results.map((r, i) => {
    const b64 = toB64(r.file);
    const img = b64
      ? `<img class="ss" src="data:image/png;base64,${b64}" alt="${r.label}" loading="lazy">`
      : `<div class="no-ss">Screenshot not available</div>`;
    return `<div class="sec" id="p${i}">
      <div class="sec-hd">
        <span class="sec-label">${r.label}</span>
        <code class="sec-path">${r.path}</code>
      </div>
      ${img}
    </div>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>LaunchMind — All Pages (${dateStr})</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f2f3f6;color:#1b1f2e}
.sidebar{position:fixed;top:0;left:0;bottom:0;width:210px;background:#1b1f2e;overflow-y:auto;padding:14px 0;z-index:100}
.sidebar-hd{padding:0 14px 12px;border-bottom:1px solid rgba(255,255,255,.08);margin-bottom:8px}
.sidebar-hd .name{font-size:14px;font-weight:700;color:#fff}.sidebar-hd .name span{color:#34d399}
.sidebar-hd .sub{font-size:11px;color:rgba(255,255,255,.38);margin-top:3px}
.nav-item{display:block;padding:5px 14px;font-size:12px;color:rgba(255,255,255,.62);text-decoration:none;border-radius:4px;margin:1px 7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:background .12s}
.nav-item:hover{background:rgba(255,255,255,.09);color:#fff}
.nav-item.miss{color:rgba(255,255,255,.25);font-style:italic}
.main{margin-left:210px;padding:28px 32px;max-width:1260px}
.hero{background:#fff;border:1px solid rgba(0,0,0,.07);border-radius:10px;padding:22px 26px;margin-bottom:30px}
.hero h1{font-size:20px;font-weight:700}.hero p{font-size:13px;color:#626880;margin-top:5px}
.hero-meta{display:flex;gap:20px;margin-top:10px;font-size:12px;color:#626880}
.hero-meta b{color:#059669}
.sec{margin-bottom:44px}
.sec-hd{display:flex;align-items:baseline;gap:10px;margin-bottom:10px;padding-bottom:7px;border-bottom:2px solid #059669}
.sec-label{font-size:15px;font-weight:700}
.sec-path{font-size:11.5px;color:#626880;background:#f3f4f6;border:1px solid rgba(0,0,0,.08);padding:2px 7px;border-radius:4px}
.ss{width:100%;border:1px solid rgba(0,0,0,.08);border-radius:8px;display:block;box-shadow:0 2px 8px rgba(0,0,0,.07)}
.no-ss{background:#f3f4f6;border:1px dashed #d1d5db;border-radius:8px;padding:36px;text-align:center;color:#9ca4be;font-size:13px}
</style>
</head>
<body>
<nav class="sidebar">
  <div class="sidebar-hd">
    <div class="name"><span>Launch</span>Mind</div>
    <div class="sub">${captured}/${results.length} pages · ${dateStr}</div>
  </div>
  ${navHtml}
</nav>
<main class="main">
  <div class="hero">
    <h1>LaunchMind — All Pages Screenshot Reference</h1>
    <p>Full-page screenshots of every route, captured from the live dev environment.</p>
    <div class="hero-meta">
      <span>Pages: <b>${captured}/${results.length}</b></span>
      <span>Viewport: <b>1440 × 900</b></span>
      <span>Account: <b>vijay@lm.com (Solo)</b></span>
      <span>Date: <b>${dateStr}</b></span>
    </div>
  </div>
  ${sectionsHtml}
</main>
</body>
</html>`;

  fs.writeFileSync(OUTPUT, html);
  const sizeMB = (fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(1);
  console.log(`Output → ${OUTPUT} (${sizeMB} MB)`);
}

main().catch(err => { console.error('\nFatal:', err.message); process.exit(1); });
