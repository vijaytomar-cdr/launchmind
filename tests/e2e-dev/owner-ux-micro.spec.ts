/**
 * @file owner-ux-micro.spec.ts
 * @description Dedup, owner-safe brand summary, Studio semantics. Zero writes.
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

test.describe('owner UX micro closure', () => {
  test.skip(!EMAIL || !PASSWORD, 'No development credentials — skipped, not passed.');
  test.describe.configure({ mode: 'serial' });

  test('Morning Brief: featured opportunity appears once, nothing clipped', async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await page.goto('/dashboard/brief');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(6500);
    const text = await page.locator('main').innerText();
    console.log('\n===== MORNING BRIEF =====');
    console.log(text.slice(0, 2000));

    // Featured once, not twice.
    const occurrences = text.split("Rate Your 'Calling Around' Experience").length - 1;
    console.log(`\n"Rate Your 'Calling Around'" occurrences: ${occurrences}`);
    expect(occurrences, 'featured opportunity is duplicated below').toBeLessThanOrEqual(1);

    // No truncated thought presented as a summary.
    expect(text).not.toMatch(/perenn…/);
    expect(text, 'a truncated word is presented as a summary').not.toMatch(/\w{3,}…/);

    // The fabricated readiness figure is gone.
    expect(text).not.toMatch(/\b72%/);
    expect(text).toMatch(/Some setup items still need your attention/i);
    await page.screenshot({ path: 'test-results/owner-audit/brief-micro.png', fullPage: false });
  });

  test('Content Intelligence: no raw logo URL in the brand summary', async ({ page }) => {
    test.setTimeout(300_000);
    await login(page);
    await page.goto('/dashboard/intelligence/content');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(6000);
    const text = await page.locator('main').innerText();
    console.log('\n===== CONTENT INTELLIGENCE (brand region) =====');
    const i = text.toUpperCase().indexOf('BRAND');
    console.log(i >= 0 ? text.slice(i, i + 500) : '(brand section not found)');

    // No storage path or asset URL shown as an owner-facing value, anywhere.
    expect(text).not.toMatch(/https?:\/\/\S+\.(png|jpe?g|svg|webp)/i);
    expect(text).not.toContain('allignx_new.png');
    await page.screenshot({ path: 'test-results/owner-audit/ci-brand-summary.png', fullPage: true });
  });

  test('Content Studio: not an execution surface', async ({ page }) => {
    test.setTimeout(300_000);
    await login(page);
    await page.goto('/dashboard/content');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000);

    const shell = await page.locator('header, [role="banner"]').first().innerText();
    console.log('\nSTUDIO PAGE CONTEXT:', shell.split('\n')[0]);
    expect(shell).not.toMatch(/Execution Center/i);

    const text = await page.locator('main').innerText();
    // "Earlier creative" applies only while EVERY creative was made without
    // product imagery. A product-led render now exists, so the heading is
    // correctly "Recent creative" — the per-thumbnail note is the invariant.
    expect(text).toMatch(/(Earlier|Recent) creative/i);
    // History is collapsed by default so it cannot compete with current work.
    // Open it before asserting the owner-facing historical explanation.
    await page.getByText(/Earlier creative \(/i).click();
    expect(await page.locator('main').innerText()).toMatch(/Created without product imagery/i);
    for (const t of await page.locator('main').getByRole('button').allInnerTexts()) {
      expect(t.trim()).not.toMatch(/^(publish|post|launch|schedule|boost|spend)/i);
    }
    await page.screenshot({ path: 'test-results/owner-audit/studio-micro.png', fullPage: true });
  });
});
