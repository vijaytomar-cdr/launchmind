/**
 * @file owner-creative-intelligence.spec.ts
 * @description LOCAL_REAL_DEVELOPMENT journey — B6.5 §30, §31.
 *
 *   NOT CERTIFICATION. This runs against the real development account by
 *   design; the certification guard exists to forbid exactly that. It proves
 *   the owner-visible surfaces render, navigate and stay legible — nothing here
 *   approves, publishes, launches, schedules or spends.
 */

import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

const WIDTHS = [1440, 1280, 1024, 768, 390];

test.skip(!EMAIL || !PASSWORD, 'needs TEST_EMAIL / TEST_PASSWORD');

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).first().fill(EMAIL!);
  await page.getByLabel(/password/i).first().fill(PASSWORD!);
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

/** No page-level horizontal overflow, at any width. */
async function noOverflow(page: Page, where: string) {
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(220);
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, `${where} overflows horizontally at this width`).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test.describe('owner creative-intelligence journey', () => {
  test('Morning Brief leads with one move, not two', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard/brief');
    await page.waitForLoadState('networkidle');

    // §5 — "Improve today's recommendation" must not compete with the main
    // move. It keeps its function; it loses its filled primary button.
    const improve = page.getByText(/Improve today's recommendation/i).first();
    if (await improve.count() > 0) {
      const card = improve.locator('xpath=ancestor::div[1]/parent::div');
      const h = await card.evaluate(el => (el as HTMLElement).getBoundingClientRect().height)
        .catch(() => 0);
      // A compact row, not a hero panel.
      expect(h, 'the improve-recommendation block is still hero-sized').toBeLessThan(200);
    }

    // No engineering backlog on an owner surface.
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/pgBouncer|SSRF|Migrations? 0?\d{2,3}[–-]/);

    await noOverflow(page, 'Morning Brief');
  });

  test('Content Intelligence has no second navigation', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard/intelligence/content');
    await page.waitForLoadState('networkidle');

    // §4 — the Intelligence TAB ROW must be gone from this page.
    //
    // Asserted on the two labels that exist ONLY in that row. "Knowledge Graph"
    // is deliberately excluded: it is a permanent item of the left navigation
    // under INTELLIGENCE (§3), so requiring zero of it would have demanded the
    // removal of something the navigation contract requires — a test that
    // contradicts the spec it is meant to protect. Instead it must appear
    // EXACTLY ONCE: present in the sidebar, absent from the tab row.
    for (const onlyInTabRow of ['AI Audit', 'Ideas Inbox']) {
      await expect(page.getByRole('link', { name: onlyInTabRow, exact: true }))
        .toHaveCount(0);
    }
    await expect(page.getByRole('link', { name: 'Knowledge Graph', exact: true }))
      .toHaveCount(1);
    // …and still present where it belongs. Waits for the ELEMENT rather than
    // for `networkidle`: Growth Brain polls, so the network never goes idle and
    // the wait times out on a page that rendered correctly seconds earlier.
    await page.goto('/dashboard/intelligence/growth-brain');
    await expect(page.getByRole('link', { name: 'AI Audit', exact: true }))
      .toHaveCount(1, { timeout: 20_000 });
  });

  test('Content Intelligence answers the five questions', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard/intelligence/content');
    await page.waitForLoadState('networkidle');
    const body = await page.locator('body').innerText();

    // §6 — the decision, not the governance report, above the fold.
    expect(body).toMatch(/Content Intelligence/i);

    // §7 — no bare lifecycle enum ever reaches the owner.
    for (const enumish of ['BLOCKED_ON_OWNER_CONFIRMATION', 'READY_TO_GENERATE',
                           'BLOCKED_ON_ASSET', 'UNSUPPORTED_CHANNEL',
                           'PRODUCT_MOTION', 'AVATAR_SPOKESPERSON']) {
      expect(body, `${enumish} leaked to the owner`).not.toContain(enumish);
    }
    // §19/§20 — no pattern key, source URL or publisher on the owner surface.
    expect(body).not.toMatch(/PROBLEM_FIRST_RECOGNITION|:home_services|thumbtack\.com/i);

    await noOverflow(page, 'Content Intelligence');
  });

  test('proof detail is disclosed, not front-loaded', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard/intelligence/content');
    await page.waitForLoadState('networkidle');

    const before = await page.locator('body').innerText();
    const review = page.getByRole('button', { name: /Review campaign/i }).first();
    if (await review.count() > 0) {
      // §6 — "Do not claim yet" belongs behind review.
      expect(before).not.toMatch(/Do not claim yet/i);
      await review.click();
      await page.waitForTimeout(400);
      const after = await page.locator('body').innerText();
      expect(after.length).toBeGreaterThan(before.length);
    }
  });

  test('Content Studio puts current work above history', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard/content');
    await page.waitForLoadState('networkidle');
    const body = await page.locator('body').innerText();

    // §12/§13 — history is labelled as history.
    if (/Creative history/i.test(body)) {
      const historyY = await page.getByText(/Creative history/i).first()
        .evaluate(el => el.getBoundingClientRect().top);
      for (const above of [/Needs your attention/i, /Ready for your review/i]) {
        const el = page.getByText(above).first();
        if (await el.count() > 0) {
          const y = await el.evaluate(e => e.getBoundingClientRect().top);
          expect(y, 'history sits above current work').toBeLessThan(historyY);
        }
      }
    }
    // No provider or model name on an owner surface.
    expect(body).not.toMatch(/flux|replicate|heygen|elevenlabs|sonnet|haiku/i);

    await noOverflow(page, 'Content Studio');
  });

  test('no execution control is reachable from a content surface', async ({ page }) => {
    await login(page);
    for (const url of ['/dashboard/intelligence/content', '/dashboard/content']) {
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      for (const forbidden of [/^Publish$/i, /^Launch$/i, /^Schedule$/i,
                               /^Send now$/i, /^Set budget$/i]) {
        await expect(page.getByRole('button', { name: forbidden })).toHaveCount(0);
      }
    }
  });

  test('keyboard and focus work on the content surfaces', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard/intelligence/content');
    await page.waitForLoadState('networkidle');

    await page.keyboard.press('Tab');
    const visible = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return false;
      const s = getComputedStyle(el);
      return s.outlineStyle !== 'none' || s.boxShadow !== 'none'
        || parseFloat(s.outlineWidth || '0') > 0;
    });
    expect(visible, 'the first focused control has no visible focus ring').toBe(true);

    // Heading hierarchy: exactly one h1, and no level skipped.
    const levels = await page.evaluate(() =>
      [...document.querySelectorAll('h1,h2,h3,h4')].map(h => Number(h.tagName[1])));
    expect(levels.filter(l => l === 1).length).toBe(1);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i] - levels[i - 1], 'a heading level was skipped').toBeLessThanOrEqual(1);
    }
  });
});
