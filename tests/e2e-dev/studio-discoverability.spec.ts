/**
 * @file studio-discoverability.spec.ts
 * @description Does the sidebar "Content Studio" now reach governed content?
 *   READ-ONLY: navigation and disclosure only. Nothing generated or approved.
 */
import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).first().fill(EMAIL!);
  await page.getByLabel(/password/i).first().fill(PASSWORD!);
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

test.describe('Content Studio discoverability', () => {
  test.skip(!EMAIL || !PASSWORD, 'No development credentials — skipped, not passed.');
  test.describe.configure({ mode: 'serial' });

  test('sidebar Content Studio shows the real campaign with no query string', async ({ page }) => {
    test.setTimeout(240_000);
    await login(page);

    // Click the sidebar link — the owner's actual path.
    await page.getByRole('link', { name: /^content studio$/i }).click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(4000);
    expect(page.url()).toMatch(/\/dashboard\/content$/);

    const text = await page.locator('main').innerText();
    console.log('\n===== SIDEBAR → CONTENT STUDIO =====');
    console.log(text.slice(0, 1800));

    // The real AllignX campaign must be here without a campaign id.
    expect(text).toMatch(/Rate Your 'Calling Around' Experience/);
    expect(text).toMatch(/Everything LaunchMind has created/);

    // No execution control anywhere on the governed home.
    for (const t of await page.locator('main').getByRole('button').allInnerTexts()) {
      expect(t.trim()).not.toMatch(/^(publish|post|launch|schedule|boost|spend)/i);
    }
    await page.screenshot({ path: 'test-results/owner-audit/studio-home.png', fullPage: true });
  });

  test('opening the campaign reaches the same workbench identity', async ({ page }) => {
    test.setTimeout(240_000);
    await login(page);
    await page.goto('/dashboard/content');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3500);

    await page.getByRole('button', { name: /Rate Your 'Calling Around' Experience/i }).first().click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(4000);
    const text = await page.locator('main').innerText();
    console.log('\n===== CAMPAIGN OPENED FROM HOME =====');
    console.log(text.slice(0, 1200));
    expect(text).toMatch(/Home service, without the chaos/);
    expect(text).toMatch(/CREATIVE/i);
    await page.screenshot({ path: 'test-results/owner-audit/studio-workbench.png', fullPage: true });
  });

  test('legacy tools remain reachable but secondary', async ({ page }) => {
    test.setTimeout(240_000);
    await login(page);
    await page.goto('/dashboard/content');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3500);
    await page.getByRole('button', { name: /other content tools/i }).click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2500);
    const text = await page.locator('main').innerText();
    console.log('\n===== LEGACY TOOLS =====');
    console.log(text.slice(0, 400));
    expect(text).not.toMatch(/Other content tools/);
    // And a way back, so the legacy surface is a side trip.
    expect(text).toMatch(/← Content Studio/);
  });
});
