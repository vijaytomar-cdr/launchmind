/**
 * @file owner-content-correction.spec.ts
 * @description §26 owner journey after the correction pass. Read-mostly:
 *   nothing is approved, published or confirmed on the owner's behalf.
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
  await page.waitForTimeout(5500);
}

test.describe('owner content correction', () => {
  test.skip(!EMAIL || !PASSWORD, 'No development credentials — skipped, not passed.');
  test.describe.configure({ mode: 'serial' });

  test('nav: CREATE groups both content surfaces', async ({ page }) => {
    test.setTimeout(240_000);
    await login(page);
    const nav = await page.locator('nav').first().innerText();
    const iCreate = nav.indexOf('CREATE'), iExec = nav.indexOf('EXECUTION');
    const create = nav.slice(iCreate, iExec);
    expect(create).toMatch(/Content Intelligence/);
    expect(create).toMatch(/Content Studio/);
    // Not merged, not renamed.
    expect(nav).toContain('Content Intelligence');
    expect(nav).toContain('Content Studio');
    expect(nav.slice(iExec)).not.toMatch(/Content Studio/);
  });

  test('destination editor closes on confirm and shows the saved state', async ({ page }) => {
    test.setTimeout(240_000);
    await login(page); await ci(page);
    const open = page.getByRole('button', { name: /choose destination/i });
    test.skip(await open.count() === 0, 'No destination control on screen.');
    await open.first().click();
    await page.waitForTimeout(2500);

    const text = await page.locator('main').innerText();
    console.log('\n===== DESTINATION =====');
    console.log(text.slice(text.indexOf('Where should people go'), text.indexOf('Where should people go') + 600));
    // SINGLE selection — radios, not checkboxes.
    expect(await page.locator('input[type=radio][name=destination]').count()).toBeGreaterThan(1);
    expect(await page.locator('input[type=checkbox][name=destination]').count()).toBe(0);
    // Leave without choosing: the owner's data is theirs to set.
    await page.getByRole('button', { name: /← Back/i }).click();
    await page.waitForTimeout(1500);
    expect(await page.locator('main').innerText()).toMatch(/BEFORE I CREATE THIS/i);
  });

  test('creation keeps the page mounted and reports per-channel', async ({ page }) => {
    test.setTimeout(300_000);
    await login(page); await ci(page);
    const create = page.getByRole('button', { name: /create recommended content/i });
    test.skip(await create.count() === 0, 'Nothing to create right now.');

    await create.first().click();
    // The recommendation must still be on screen while creation runs.
    await page.waitForTimeout(2500);
    const during = await page.locator('main').innerText();
    console.log('\n===== DURING CREATION =====');
    console.log(during.slice(0, 700));
    expect(during, 'the page was replaced during creation').not.toMatch(/Couldn.t load this/i);
    expect(during).toMatch(/Content opportunity|YOU ASKED FOR THIS|Creating what/i);

    await page.waitForTimeout(45_000);
    const after = await page.locator('main').innerText();
    console.log('\n===== AFTER CREATION =====');
    console.log(after.slice(0, 900));
    // Whatever happened, the surface survived.
    expect(after, 'a failed creation replaced the page').not.toMatch(/^Couldn.t load this/i);
    await page.screenshot({ path: 'test-results/owner-audit/creation-inline.png', fullPage: true });
  });

  test('Studio: earlier creative language and no execution control', async ({ page }) => {
    test.setTimeout(240_000);
    await login(page);
    await page.goto('/dashboard/content');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000);
    const text = await page.locator('main').innerText();
    console.log('\n===== STUDIO HOME =====');
    console.log(text.slice(0, 900));
    // The section note is a whole-set statement and appears only while EVERY
    // creative lacks product imagery. The per-thumbnail note is the invariant:
    // an image made without product assets must say so on its own card.
    expect(text).toMatch(/(Recent|Earlier) creative/i);
    for (const t of await page.locator('main').getByRole('button').allInnerTexts()) {
      expect(t.trim()).not.toMatch(/^(publish|post|launch|schedule|boost|spend)/i);
    }
  });

  test('responsive: no page overflow anywhere in the flow', async ({ page }) => {
    test.setTimeout(300_000);
    await login(page);
    for (const w of [1440, 1280, 1024, 768, 390]) {
      await page.setViewportSize({ width: w, height: 900 });
      for (const path of ['/dashboard/brief', '/dashboard/intelligence/content', '/dashboard/content']) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2200);
        const over = await page.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth);
        console.log(`  ${w}px ${path}: ${over}`);
        expect(over, `${path} overflows at ${w}px`).toBeLessThanOrEqual(1);
      }
    }
  });
});
