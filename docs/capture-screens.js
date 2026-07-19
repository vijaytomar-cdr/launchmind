/**
 * Playwright screenshot capture for LaunchMind context PDF.
 * Captures all 12 reference screens from launchmind-ux-slate-sage.html.
 */
const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SCREENS = [
  { id: 'login',     label: 'Login' },
  { id: 'signup',    label: 'Sign Up' },
  { id: 'mfa',       label: 'MFA Verification' },
  { id: 'dashboard', label: 'Morning Brief / Dashboard' },
  { id: 'discover',  label: 'Product Discovery' },
  { id: 'confirm',   label: 'ICP Confirmation' },
  { id: 'strategy',  label: 'Strategy' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'briefs',    label: 'Weekly Briefs' },
  { id: 'channels',  label: 'Channels' },
  { id: 'billing',   label: 'Billing' },
  { id: 'settings',  label: 'Settings' },
];

const OUT_DIR = path.join(__dirname, 'screenshots');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const refFile = 'file://' + path.join(__dirname, '..', 'launchmind-ux-slate-sage.html');
  console.log('Loading reference file:', refFile);
  await page.goto(refFile, { waitUntil: 'networkidle' });

  // IMPORTANT: Do NOT override .screen display — the reference HTML uses
  // .screen { display:none } / .screen.on { display:flex } to show/hide screens.
  // Only add print color accuracy so colors render correctly.
  await page.addStyleTag({ content: `
    * { -webkit-print-color-adjust: exact !important; color-adjust: exact !important; }
  ` });

  // Wait for fonts to load
  await page.waitForTimeout(800);

  const results = [];

  for (const screen of SCREENS) {
    try {
      // Call go() to activate this screen (hides all others)
      await page.evaluate((id) => {
        window.go(id);
      }, screen.id);

      // Wait for display transition
      await page.waitForTimeout(300);

      const fname = `s-${screen.id}.png`;
      const fpath = path.join(OUT_DIR, fname);

      await page.screenshot({ path: fpath, fullPage: false });

      const stat = fs.statSync(fpath);
      console.log(`✓ ${screen.label} → ${fname} (${Math.round(stat.size/1024)}KB)`);
      results.push({ id: `s-${screen.id}`, label: screen.label, file: fpath, size: stat.size });
    } catch (err) {
      console.error(`✗ ${screen.label}: ${err.message}`);
    }
  }

  await browser.close();

  // Write manifest
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(results, null, 2));
  console.log(`\nDone. ${results.length} screenshots in ${OUT_DIR}`);
}

run().catch(err => { console.error(err); process.exit(1); });
