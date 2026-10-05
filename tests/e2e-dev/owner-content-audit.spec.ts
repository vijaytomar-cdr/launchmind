/**
 * @file owner-content-audit.spec.ts
 * @description READ-ONLY owner content visibility audit — LOCAL_REAL_DEVELOPMENT.
 *
 *   Logs in through the normal application flow as the real owner and records
 *   what is actually on screen. Clicks nothing that creates, approves, publishes
 *   or spends: every interaction here is navigation or a disclosure toggle.
 *
 *   Not certification. DEVELOPMENT_SMOKE only.
 */

import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

test.describe('owner content visibility audit', () => {
  test.skip(!EMAIL || !PASSWORD, 'No development credentials — skipped, not passed.');
  test.describe.configure({ mode: 'serial' });

  async function login(page: Page) {
    await page.goto('/login');
    await page.getByLabel(/email/i).first().fill(EMAIL!);
    await page.getByLabel(/password/i).first().fill(PASSWORD!);
    await page.getByRole('button', { name: /log in/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  }

  test('audit', async ({ page }) => {
    test.setTimeout(300_000);
    await login(page);
    console.log(`\nLOGGED IN AS: ${EMAIL}`);

    // Which company is scoped?
    const company = await page.locator('.lm-biz-trigger').first().innerText().catch(() => '(no switcher)');
    console.log(`SCOPED COMPANY: ${company.replace(/\n/g, ' · ')}`);

    const companies = await page.locator('.lm-biz-trigger').first().click()
      .then(async () => {
        const items = await page.locator('.lm-biz-item').allInnerTexts();
        await page.keyboard.press('Escape');
        return items;
      }).catch(() => []);
    console.log(`COMPANIES VISIBLE: ${companies.length}`);
    for (const c of companies) console.log(`   - ${c.replace(/\n/g, ' · ').slice(0, 80)}`);

    for (const [label, path] of [
      ['MORNING BRIEF', '/dashboard/brief'],
      ['CONTENT INTELLIGENCE', '/dashboard/intelligence/content'],
      ['CONTENT STUDIO', '/dashboard/content'],
    ] as const) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(4000);
      const text = await page.locator('main').innerText();
      console.log(`\n===== ${label}  (${path}) =====`);
      console.log(text.slice(0, 2200));
      await page.screenshot({ path: `test-results/owner-audit/${label.toLowerCase().replace(/ /g, '-')}.png`, fullPage: true });
    }

    // Campaign Review, if the decision surface offers it.
    await page.goto('/dashboard/intelligence/content');
    await page.waitForLoadState('networkidle');
    const review = page.getByRole('button', { name: /review campaign/i });
    if (await review.count() > 0) {
      await review.click();
      await page.waitForTimeout(2500);
      console.log('\n===== CAMPAIGN REVIEW (expanded) =====');
      console.log((await page.locator('main').innerText()).slice(0, 2500));
      await page.screenshot({ path: 'test-results/owner-audit/campaign-review.png', fullPage: true });
    } else {
      console.log('\n===== CAMPAIGN REVIEW: no "Review campaign" control on screen =====');
    }
    expect(true).toBe(true);
  });
});
