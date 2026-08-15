/**
 * @file opportunity-badge.cert.spec.ts
 * @description Browser certification that the sidebar Opportunities badge and the
 *   Opportunities "All" list agree for the ACTIVE business, and keep agreeing
 *   across A → B → A.
 *
 *   The route test proves the two queries return the same population. This proves
 *   the assembled application does too — including the part no route test can
 *   reach: the badge is rendered by a SERVER layout that does not re-run on
 *   client-side navigation, so a correct query can still paint a stale number.
 *
 * @security Credentials come from env only; never printed, logged, or committed.
 * @dependencies TEST_EMAIL, TEST_PASSWORD, running dev server
 */

import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

test.skip(!EMAIL || !PASSWORD, 'TEST_EMAIL / TEST_PASSWORD not set');

async function login(page: Page) {
  await page.goto('/login');
  await page.fill('input[type="email"]', EMAIL!);
  await page.fill('input[type="password"]', PASSWORD!);
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
}

async function switchTo(page: Page, name: RegExp) {
  await page.locator('.lm-biz-trigger').click();
  await page.locator('[role="menuitemradio"]', { hasText: name }).first().click();
  await page.waitForFunction(() => !document.body.innerText.includes('Switching'), { timeout: 20_000 });
  await page.waitForLoadState('networkidle');
}

/** The number rendered in the sidebar badge, or 0 when no badge is shown. */
async function badge(page: Page): Promise<number> {
  const el = page.locator('nav a[href="/dashboard/opportunities"] span').last();
  const raw = (await el.innerText().catch(() => '')).trim();
  return /^\d+$/.test(raw) ? Number(raw) : 0;
}

async function rows(page: Page): Promise<number> {
  return page.locator('main [data-opp-row]').count();
}

test('badge equals the All list for each active business, across A -> B -> A', async ({ page }) => {
  test.setTimeout(300_000);
  await login(page);

  for (const biz of [/AllignX/i, /Launchmind/i, /AllignX/i]) {
    await page.goto('/dashboard/brief');
    await page.waitForLoadState('networkidle');
    await switchTo(page, biz);
    const name = (await page.locator('.lm-biz-name').innerText()).trim();

    // CLIENT-SIDE navigation — the path where a server-rendered badge goes stale.
    await page.locator('nav a[href="/dashboard/opportunities"]').first().click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    const navBadge = await badge(page);
    const navRows  = await rows(page);

    // FULL reload — the server layout definitely re-renders here.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    const loadBadge = await badge(page);
    const loadRows  = await rows(page);

    expect(navRows, `${name}: badge ${navBadge} vs ${navRows} rows after client-side nav`).toBe(navBadge);
    expect(loadRows, `${name}: badge ${loadBadge} vs ${loadRows} rows after full load`).toBe(loadBadge);
    // Client-side nav and full load must agree, or the badge is a stale snapshot.
    expect(navBadge, `${name}: badge differs between client nav and full load`).toBe(loadBadge);
  }
});
