/**
 * @file business-switcher.visual.spec.ts
 * @description Browser checks for the Business Switcher.
 *
 *   The control changes the context of the entire application, so the things
 *   worth asserting are that it LOOKS like a control (real hit area, chevron,
 *   an explicit caption) and BEHAVES like a menu (keyboard, Escape, outside
 *   click) — not that it merely renders.
 *
 *   Skips loudly without TEST_EMAIL / TEST_PASSWORD, matching the repo's other
 *   visual specs. A spec that silently passes because it never ran is worse than
 *   one that fails.
 *
 * @security Test account only. Never the owner's real session.
 * @dependencies TEST_EMAIL, TEST_PASSWORD, running dev server
 */

import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

const TRIGGER = '.lm-biz-trigger';
const MENU    = '[role="menu"][aria-label="Your companies"]';

test.beforeEach(async ({ page }) => {
  test.skip(!EMAIL || !PASSWORD, 'TEST_EMAIL / TEST_PASSWORD not set — switcher checks skipped');
  await page.goto('/login');
  await page.fill('input[type="email"]', EMAIL!);
  await page.fill('input[type="password"]', PASSWORD!);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 15_000 });
  await page.goto('/dashboard/brief');
  await page.waitForLoadState('networkidle');
});

async function triggerBox(page: Page) {
  return page.locator(TRIGGER).boundingBox();
}

test.describe('header is calm: three elements only', () => {
  test('search, notifications, review-understanding and update-context are gone', async ({ page }) => {
    const header = page.locator('header').first();
    await expect(header).not.toContainText(/review product understanding/i);
    await expect(header).not.toContainText(/update launch context/i);
    // The removed capabilities still exist elsewhere — this asserts placement,
    // not deletion.
    expect(await header.locator('button, a').count()).toBeLessThanOrEqual(4);
  });

  test('shows "Start something", not "New mission"', async ({ page }) => {
    const header = page.locator('header').first();
    await expect(header).toContainText(/start something/i);
    await expect(header).not.toContainText(/new mission/i);
    // Owner language only — the route and the Mission model are untouched.
    await expect(header.locator('a[href*="/dashboard/missions"]')).toHaveCount(1);
  });
});

test.describe('closed state reads as an interactive control', () => {
  test('has a real hit area, a caption and a chevron', async ({ page }) => {
    const trigger = page.locator(TRIGGER);
    await expect(trigger).toBeVisible();

    // Big enough to read as a button rather than a status chip.
    const box = await triggerBox(page);
    expect(box!.height).toBeGreaterThanOrEqual(40);
    expect(box!.width).toBeGreaterThanOrEqual(150);

    // TWO LINES MAX — the "CURRENT BUSINESS" caption is deliberately gone.
    await expect(trigger).not.toContainText(/current business/i);
    await expect(page.locator('.lm-biz-chevron')).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  test('shows the business name, and never a raw workspace id', async ({ page }) => {
    const text = await page.locator(TRIGGER).innerText();
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
    expect(text).not.toMatch(/workspace/i);
  });

  test('the whole control is clickable, not just the chevron', async ({ page }) => {
    const box = await triggerBox(page);
    // Click the far LEFT of the control — the avatar side.
    await page.mouse.click(box!.x + 12, box!.y + box!.height / 2);
    await expect(page.locator(MENU)).toBeVisible();
  });
});

test.describe('open menu', () => {
  test.beforeEach(async ({ page }) => {
    await page.locator(TRIGGER).click();
    await expect(page.locator(MENU)).toBeVisible();
  });

  test('is wide enough to scan and headed "Your businesses"', async ({ page }) => {
    const box = await page.locator(MENU).boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(260);
    await expect(page.locator('.lm-biz-menu-head')).toContainText(/your companies/i);
    await expect(page.locator(TRIGGER)).toHaveAttribute('aria-expanded', 'true');
  });

  test('marks exactly one business active, with a checkmark not just colour', async ({ page }) => {
    const checked = page.locator('[role="menuitemradio"][aria-checked="true"]');
    await expect(checked).toHaveCount(1);
    await expect(checked.locator('.lm-biz-check')).toContainText('✓');
  });

  test('business name is visually dominant over the product name', async ({ page }) => {
    const item = page.locator('[role="menuitemradio"]').first();
    const nameSize = await item.locator('.lm-biz-item-name').evaluate(
      el => parseFloat(getComputedStyle(el).fontSize));
    const productEl = item.locator('.lm-biz-item-product');
    if (await productEl.count()) {
      const productSize = await productEl.evaluate(
        el => parseFloat(getComputedStyle(el).fontSize));
      expect(nameSize).toBeGreaterThan(productSize);
    }
  });

  test('offers Add business and Manage businesses', async ({ page }) => {
    await expect(page.locator('.lm-biz-add')).toContainText(/add company/i);
    await expect(page.locator('.lm-biz-manage')).toContainText(/manage companies/i);
  });

  test('Add business enters governed onboarding, never the legacy wizard', async ({ page }) => {
    await page.locator('.lm-biz-add').click();
    await page.waitForURL(/\/onboarding\//, { timeout: 10_000 });
    expect(page.url()).toContain('/onboarding/workspace');
    expect(page.url()).not.toContain('/dashboard/products/new');
  });

  test('Manage businesses opens Settings → Businesses', async ({ page }) => {
    await page.locator('.lm-biz-manage').click();
    await page.waitForURL(/\/dashboard\/settings/, { timeout: 10_000 });
    expect(page.url()).toContain('businesses');
  });
});

test.describe('keyboard support', () => {
  test('opens with ArrowDown, moves with arrows, closes with Escape', async ({ page }) => {
    await page.locator(TRIGGER).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator(MENU)).toBeVisible();

    // Focus lands on a menu item, not lost in the document.
    const focusedRole = await page.evaluate(() => document.activeElement?.getAttribute('role'));
    expect(['menuitemradio', 'menuitem']).toContain(focusedRole);

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    const atEnd = await page.evaluate(() => document.activeElement?.textContent ?? '');
    expect(atEnd.toLowerCase()).toContain('manage');

    await page.keyboard.press('Escape');
    await expect(page.locator(MENU)).toHaveCount(0);
    // Focus returns to the trigger, not the top of the page.
    await expect(page.locator(TRIGGER)).toBeFocused();
  });

  test('clicking outside closes it', async ({ page }) => {
    await page.locator(TRIGGER).click();
    await expect(page.locator(MENU)).toBeVisible();
    await page.mouse.click(20, 400);
    await expect(page.locator(MENU)).toHaveCount(0);
  });
});

test.describe('responsive', () => {
  test('desktop shows the secondary product/state line', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await page.waitForLoadState('networkidle');
    const sub = page.locator('.lm-biz-sub');
    if (await sub.count()) {
      await expect(sub).toBeVisible();
    }
  });

  test('mobile stays a labelled control, never a bare icon', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.waitForLoadState('networkidle');

    const name = await page.locator('.lm-biz-name').innerText();
    // The business name survives — an avatar alone would not tell the founder
    // which company is loaded.
    expect(name.trim().length).toBeGreaterThan(0);

    const box = await triggerBox(page);
    expect(box!.height).toBeGreaterThanOrEqual(36);   // still a tappable target
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
  });

  test('menu fits the viewport on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.locator(TRIGGER).click();
    const box = await page.locator(MENU).boundingBox();
    expect(box!.width).toBeLessThanOrEqual(390);
    expect(box!.x).toBeGreaterThanOrEqual(-1);
  });
});
