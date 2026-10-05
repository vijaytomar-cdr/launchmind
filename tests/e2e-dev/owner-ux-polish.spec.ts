/**
 * @file owner-ux-polish.spec.ts
 * @description Morning Brief hierarchy, logo preview, older-creative context.
 *   Navigation, keyboard and disclosure only. Zero writes.
 */
import { test, expect, type Page } from '@playwright/test';
const EMAIL = process.env.TEST_EMAIL, PASSWORD = process.env.TEST_PASSWORD;

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).first().fill(EMAIL!);
  await page.getByLabel(/password/i).first().fill(PASSWORD!);
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

test.describe('owner UX polish', () => {
  test.skip(!EMAIL || !PASSWORD, 'No development credentials — skipped, not passed.');
  test.describe.configure({ mode: 'serial' });

  test('A — Morning Brief reads as a brief, not a dashboard', async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await page.goto('/dashboard/brief');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(6000);
    const text = await page.locator('main').innerText();
    console.log('\n===== MORNING BRIEF =====');
    console.log(text.slice(0, 2200));

    // The engineering backlog is gone from the owner's brief.
    for (const leak of ['Migrations 031', 'pgBouncer', 'SSRF', 'hot-path indexes', 'webhook replay']) {
      expect(text, `engineering string on the owner brief: ${leak}`).not.toContain(leak);
    }
    expect(text).toMatch(/Launch readiness/i);
    expect(text).toMatch(/What LaunchMind remembers/i);

    // Content Opportunity is narrative + compact metadata, not three dense columns.
    expect(text).toMatch(/Content opportunity/i);
    expect(text).toMatch(/\bwho\b/i);
    expect(text).toMatch(/\bcreate\b/i);

    // How much bordered furniture sits in the first viewport?
    const above = await page.evaluate(() => {
      const vh = window.innerHeight;
      return Array.from(document.querySelectorAll('main *')).filter(el => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.top < vh && r.height > 60 && s.borderStyle !== 'none' && s.borderTopWidth !== '0px';
      }).length;
    });
    console.log(`\nBORDERED BLOCKS IN FIRST VIEWPORT (1440): ${above}`);
    await page.screenshot({ path: 'test-results/owner-audit/brief-polished.png', fullPage: false });
  });

  test('B — brand review shows the logo, not a URL', async ({ page }) => {
    test.setTimeout(300_000);
    await login(page);
    await page.goto('/dashboard/intelligence/content');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000);
    await page.getByRole('button', { name: /review brand/i }).first().click();
    await page.waitForTimeout(3000);

    const text = await page.locator('main').innerText();
    console.log('\n===== BRAND REVIEW =====');
    console.log(text.slice(0, 800));
    expect(text).toMatch(/brand detail(s)? available to review/i);
    expect(text).toMatch(/does not mean your brand is fully set up/i);

    // The logo is rendered as an image and is clickable.
    const logoBtn = page.getByRole('button', { name: /view your logo larger/i });
    expect(await logoBtn.count()).toBeGreaterThan(0);
    await logoBtn.click();
    await page.waitForTimeout(1000);
    const dialog = page.getByRole('dialog', { name: /logo preview/i });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    await expect(dialog).toBeHidden();
    await page.screenshot({ path: 'test-results/owner-audit/brand-logo.png', fullPage: true });
  });

  test('C — Studio home says the old creative used no product imagery', async ({ page }) => {
    test.setTimeout(300_000);
    await login(page);
    await page.goto('/dashboard/content');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000);
    const text = await page.locator('main').innerText();
    console.log('\n===== STUDIO HOME =====');
    const i = text.indexOf('creative');
    console.log(text.slice(Math.max(0, i - 200), i + 700));
    // "Earlier creative" + the section note apply only while EVERY creative was
    // made without product imagery. A product-led render now exists, so the
    // heading is correctly "Recent creative". The per-thumbnail note remains the
    // invariant: an image made without product assets must say so.
    expect(text).toMatch(/(Earlier|Recent) creative/i);
    await page.getByText(/Earlier creative \(/i).click();
    expect(await page.locator('main').innerText()).toMatch(/Created without product imagery/i);
    await page.screenshot({ path: 'test-results/owner-audit/studio-earlier.png', fullPage: true });
  });

  test('responsive — no page-level overflow', async ({ page }) => {
    test.setTimeout(300_000);
    await login(page);
    for (const w of [1440, 1280, 1024, 768, 390]) {
      await page.setViewportSize({ width: w, height: 900 });
      for (const path of ['/dashboard/brief', '/dashboard/content']) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2500);
        const over = await page.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth);
        console.log(`  ${w}px ${path}: ${over}`);
        expect(over, `${path} overflows at ${w}px`).toBeLessThanOrEqual(1);
      }
    }
  });
});
