/**
 * @file owner-inputs.spec.ts
 * @description Can the real owner reach the two inputs that gate content quality?
 *   Navigation and disclosure only — nothing is allowed or confirmed here.
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

test('owner reaches image and brand inputs from Content Intelligence', async ({ page }) => {
  test.setTimeout(300_000);
  test.skip(!EMAIL || !PASSWORD, 'No development credentials — skipped, not passed.');
  await login(page);
  await page.goto('/dashboard/intelligence/content');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(6000);

  const text = await page.locator('main').innerText();
  console.log('\n===== WHAT LAUNCHMIND NEEDS FROM YOU =====');
  const i = text.indexOf('WHAT LAUNCHMIND NEEDS FROM YOU');
  console.log(i >= 0 ? text.slice(i, i + 1300) : '(section not found)');

  expect(text).toMatch(/WHAT LAUNCHMIND NEEDS FROM YOU/i);
  expect(text).toMatch(/Your product images/i);
  expect(text).toMatch(/only use images you allow/i);
  expect(text).toMatch(/Your brand/i);

  // Both actions are present and reachable, and nothing is pre-confirmed.
  expect(await page.getByRole('button', { name: /allow in marketing/i }).count())
    .toBeGreaterThan(0);
  expect(await page.getByRole('button', { name: /^confirm$/i }).count())
    .toBeGreaterThan(0);

  // No execution control anywhere on this surface.
  for (const t of await page.locator('main').getByRole('button').allInnerTexts()) {
    expect(t.trim()).not.toMatch(/^(publish|post|launch|schedule|boost|spend)/i);
  }
  await page.screenshot({ path: 'test-results/owner-audit/owner-inputs.png', fullPage: true });
});
