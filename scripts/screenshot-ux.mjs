/**
 * Screenshots all 12 UX screens from launchmind-ux-slate-sage.html
 * and saves them to scripts/ux-screenshots/ for PDF embedding.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HTML_FILE = path.join(ROOT, 'launchmind-ux-slate-sage.html');
const OUT_DIR   = path.join(__dirname, 'ux-screenshots');

const SCREENS = [
  { id: 'login',     label: 'Login' },
  { id: 'signup',    label: 'Sign Up' },
  { id: 'mfa',       label: 'MFA Verification' },
  { id: 'dashboard', label: 'Main Dashboard' },
  { id: 'discover',  label: 'Add Product (Discover)' },
  { id: 'confirm',   label: 'Confirm ICP' },
  { id: 'strategy',  label: 'Strategy' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'briefs',    label: 'Weekly Briefs' },
  { id: 'channels',  label: 'Channels' },
  { id: 'billing',   label: 'Billing' },
  { id: 'settings',  label: 'Settings' },
];

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const page    = await browser.newPage();

await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`file://${HTML_FILE}`);

// Wait for fonts to load
await page.waitForTimeout(1500);

// Hide the screen-switcher nav bar so it doesn't appear in screenshots
await page.evaluate(() => {
  const nav = document.getElementById('nav');
  if (nav) nav.style.display = 'none';
});

const results = [];

for (const screen of SCREENS) {
  // Activate the screen
  await page.evaluate((id) => {
    // Replicate the go() function from the HTML
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));
    const el = document.getElementById('s-' + id);
    if (el) el.classList.add('on');
  }, screen.id);

  await page.waitForTimeout(200);

  // Get the actual content height of this screen
  const height = await page.evaluate((id) => {
    const el = document.getElementById('s-' + id);
    return el ? Math.max(el.scrollHeight, 900) : 900;
  }, screen.id);

  // Resize viewport to fit content (capped at 2400px to avoid huge files)
  await page.setViewportSize({ width: 1440, height: Math.min(height + 20, 2400) });
  await page.waitForTimeout(100);

  const outPath = path.join(OUT_DIR, `${screen.id}.png`);
  await page.screenshot({ path: outPath, fullPage: false });

  const stats = fs.statSync(outPath);
  results.push({ id: screen.id, label: screen.label, path: outPath, size: stats.size });
  console.log(`✅ ${screen.label.padEnd(25)} → ${path.relative(ROOT, outPath)} (${Math.round(stats.size / 1024)}KB)`);
}

await browser.close();

console.log(`\n✓ ${results.length} screenshots saved to scripts/ux-screenshots/`);
