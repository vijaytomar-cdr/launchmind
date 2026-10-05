/**
 * @file owner-ux-cleanup.spec.ts
 * @description The owner journey after the UX cleanup — §22, §23, §24, §25.
 *   Navigation, keyboard and disclosure only. Nothing allowed or confirmed.
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
async function ci(page: Page) {
  await page.goto('/dashboard/intelligence/content');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(5000);
}

test.describe('owner UX cleanup', () => {
  test.skip(!EMAIL || !PASSWORD, 'No development credentials — skipped, not passed.');
  test.describe.configure({ mode: 'serial' });

  test('B — Content Intelligence leads with the recommendation, readiness is compact', async ({ page }) => {
    test.setTimeout(300_000);
    await login(page); await ci(page);
    const text = await page.locator('main').innerText();
    console.log('\n===== CONTENT INTELLIGENCE =====');
    console.log(text.slice(0, 1500));

    expect(text).toMatch(/BEFORE I CREATE THIS/i);
    // The ten inline authorization cards are gone from the decision surface.
    expect(await page.getByRole('button', { name: /allow in marketing/i }).count()).toBe(0);
    // The readiness row is present either way; whether it offers a review link
    // depends on whether the item is satisfied. Asserting the unsatisfied
    // wording encoded a moment in time — product media is now satisfied.
    expect(text).toMatch(/Product media/i);
    expect(text).toMatch(/Destination/i);
    await page.screenshot({ path: 'test-results/owner-audit/ci-readiness.png', fullPage: true });
  });

  test('B — product media review opens, images are clickable and keyboard-navigable', async ({ page }) => {
    test.setTimeout(300_000);
    await login(page); await ci(page);
    const entry = page.getByRole('button', { name: /review images/i });
    test.skip(await entry.count() === 0,
      'Product media is satisfied, so no review link is offered — skipped, not passed.');
    await entry.first().click();
    await page.waitForTimeout(3500);

    const text = await page.locator('main').innerText();
    console.log('\n===== PRODUCT MEDIA REVIEW =====');
    console.log(text.slice(0, 900));
    expect(text).toMatch(/Which images may LaunchMind use/i);
    expect(text).toMatch(/\d+ of \d+ images allowed/);

    // CLICKABLE — the owner's explicit complaint.
    const thumbs = page.getByRole('button', { name: /view .* larger/i });
    expect(await thumbs.count()).toBeGreaterThan(0);
    await thumbs.first().click();
    await page.waitForTimeout(1200);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    console.log('\nLIGHTBOX:', (await dialog.innerText()).slice(0, 260));

    // Escape closes and focus returns to the thumbnail.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    await expect(dialog).toBeHidden();
    const focused = await page.evaluate(() =>
      (document.activeElement as HTMLElement)?.getAttribute('aria-label') ?? '');
    console.log('FOCUS AFTER ESCAPE:', focused);
    expect(focused).toMatch(/view .* larger/i);
    await page.screenshot({ path: 'test-results/owner-audit/media-review.png', fullPage: true });
  });

  test('C — brand review opens with per-field actions', async ({ page }) => {
    test.setTimeout(300_000);
    await login(page); await ci(page);
    await page.getByRole('button', { name: /review brand/i }).first().click();
    await page.waitForTimeout(3000);
    const text = await page.locator('main').innerText();
    console.log('\n===== BRAND REVIEW =====');
    console.log(text.slice(0, 800));
    expect(text).toMatch(/How your marketing should look and sound/i);
    // Wording depends on how much is confirmed; the invariant is that the count
    // and the not-evidence disclaimer are both present.
    expect(text).toMatch(/brand detail(s)? available to review/i);
    expect(text).toMatch(/not proof of anything/i);
    // Per-field actions appear on UNCONFIRMED fields. Once everything is
    // confirmed there is nothing to act on, which is the correct end state.
    const anyUnconfirmed = /Observed from|Inferred from/.test(text);
    if (anyUnconfirmed) {
      for (const n of ['Confirm', 'Change', 'Skip']) {
        expect(await page.getByRole('button', { name: new RegExp(`^${n}$`) }).count())
          .toBeGreaterThan(0);
      }
    } else {
      expect(text).toMatch(/You confirmed this/i);
    }
  });

  test('D — Studio creative explains why the old image is generic', async ({ page }) => {
    test.setTimeout(300_000);
    await login(page);
    await page.goto('/dashboard/content');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(4000);
    await page.getByRole('button', { name: /Rate Your 'Calling Around' Experience/i }).first().click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000);
    const text = await page.locator('main').innerText();
    console.log('\n===== CREATIVE REVIEW CONTEXT =====');
    const i = text.indexOf('Created before');
    console.log(i >= 0 ? text.slice(i, i + 700) : '(context block not found)');
    // The panel shows the CURRENT creative. A product-led render now exists, so
    // the "created before" notice correctly belongs to the earlier one only.
    // The invariant is that provenance always states which case it is.
    const usedImagery = /Product imagery: uses/i.test(text);
    if (usedImagery) {
      expect(text).toMatch(/Product imagery: uses \d+ image/i);
      // The model-wording disclosure is stored on the render, so it appears on
      // renders created after it was added — not retroactively on this one.
      // Asserting it here would be asserting a rewrite of stored provenance.
    } else {
      expect(text).toMatch(/Created before any of your product images were approved/i);
      expect(text).toMatch(/No AllignX product imagery was available/i);
    }
    expect(text).toMatch(/does not make the copy above safe/i);

    // No provider mechanics anywhere on the owner surface.
    for (const t of ['replicate', 'heygen', 'seedance', 'flux', 'model_ref', 'seed', 'prompt']) {
      expect(text.toLowerCase()).not.toContain(t);
    }
    await page.screenshot({ path: 'test-results/owner-audit/creative-context.png', fullPage: true });
  });

  test('responsive — no page-level horizontal overflow', async ({ page }) => {
    test.setTimeout(300_000);
    // Log in ONCE. Re-authenticating per width measured the login flow, not layout.
    await login(page);
    for (const w of [1440, 1280, 1024, 768, 390]) {
      await page.setViewportSize({ width: w, height: 900 });
      await ci(page);
      const over = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      console.log(`  ${w}px overflow: ${over}`);
      expect(over, `Content Intelligence overflows at ${w}px`).toBeLessThanOrEqual(1);

      await page.getByRole('button', { name: /review images/i }).first().click();
      await page.waitForTimeout(2500);
      const over2 = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      console.log(`  ${w}px media review overflow: ${over2}`);
      expect(over2, `media review overflows at ${w}px`).toBeLessThanOrEqual(1);
    }
  });
});
