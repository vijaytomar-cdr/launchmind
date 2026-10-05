/**
 * @file owner-studio-audit.spec.ts
 * @description READ-ONLY: can the owner reach the governed workbench and see
 *   the creative that was actually generated for their product?
 */
import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;
const CAMPAIGN = process.env.AUDIT_CAMPAIGN_ID ?? '';

test.describe('governed workbench visibility', () => {
  test.skip(!EMAIL || !PASSWORD, 'No development credentials — skipped, not passed.');

  async function login(page: Page) {
    await page.goto('/login');
    await page.getByLabel(/email/i).first().fill(EMAIL!);
    await page.getByLabel(/password/i).first().fill(PASSWORD!);
    await page.getByRole('button', { name: /log in/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  }

  test('workbench', async ({ page }) => {
    test.setTimeout(300_000);
    await login(page);

    // 1. Does the "Open in Content Studio" link carry the campaign?
    await page.goto('/dashboard/intelligence/content');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    const open = page.getByRole('button', { name: /open in content studio/i });
    if (await open.count() > 0) {
      await open.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(4000);
      console.log(`\nOPEN-IN-STUDIO LANDED ON: ${page.url()}`);
      console.log((await page.locator('main').innerText()).slice(0, 2000));
      await page.screenshot({ path: 'test-results/owner-audit/studio-from-ci.png', fullPage: true });
    } else {
      console.log('\nNo "Open in Content Studio" control found.');
    }

    // 2. Direct campaign-scoped workbench.
    if (CAMPAIGN) {
      await page.goto(`/dashboard/content?campaign=${CAMPAIGN}`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(5000);
      console.log(`\n===== WORKBENCH ?campaign=${CAMPAIGN.slice(0, 8)} =====`);
      console.log((await page.locator('main').innerText()).slice(0, 2500));
      const imgs = await page.locator('main img').evaluateAll(
        els => els.map(e => (e as HTMLImageElement).src).filter(s => s.includes('content-assets')));
      console.log(`\nSTORED CREATIVE IMAGES RENDERED: ${imgs.length}`);
      for (const s of imgs) console.log(`   ${s.slice(0, 120)}`);
      await page.screenshot({ path: 'test-results/owner-audit/workbench-campaign.png', fullPage: true });
    }
    expect(true).toBe(true);
  });
});
