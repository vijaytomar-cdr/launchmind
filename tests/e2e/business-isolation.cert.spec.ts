/**
 * @file business-isolation.cert.spec.ts
 * @description BROWSER CERTIFICATION for active-business isolation.
 *
 *   Drives the REAL two-business account through A → B → A and asserts that no
 *   AllignX string survives into LaunchMind's view on any owner-facing surface.
 *   Route tests proved the queries; this proves the assembled application.
 *
 *   Also covers the failure mode no unit test can reach: a request issued under
 *   AllignX completing AFTER the switch to LaunchMind, and painting stale data.
 *
 * @security Credentials come from env only. They are never printed, logged,
 *   embedded in fixtures, or written to a report.
 * @dependencies TEST_EMAIL, TEST_PASSWORD, running dev server
 */

import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

/** Strings that exist ONLY in the AllignX business. */
const ALLIGNX_SENTINELS = [
  'AllignX',
  'Home Services',
];

/** Owner-facing business-scoped surfaces. */
const SURFACES = [
  '/dashboard/brief',
  '/dashboard/opportunities',
  '/dashboard/approvals',
  '/dashboard/missions',
  '/dashboard/content',
  '/dashboard/campaigns',
  '/dashboard/calendar',
  '/dashboard/experiments',
  '/dashboard/intelligence/growth-brain',
  '/dashboard/channels',
  '/dashboard/intelligence/market',
  '/dashboard/intelligence/memory',
  '/dashboard/intelligence/knowledge',
];

test.skip(!EMAIL || !PASSWORD, 'TEST_EMAIL / TEST_PASSWORD not set');
test.describe.configure({ mode: 'serial' });

async function login(page: Page) {
  await page.goto('/login');
  await page.fill('input[type="email"]', EMAIL!);
  await page.fill('input[type="password"]', PASSWORD!);
  // The login control is a type="button" with an onClick handler, not a form
  // submit — matching on [type=submit] finds nothing.
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 20_000 });
}

/** Switches business through the top-bar control and waits for it to settle. */
async function switchTo(page: Page, name: RegExp) {
  await page.locator('.lm-biz-trigger').click();
  await page.locator('[role="menuitemradio"]', { hasText: name }).first().click();
  // The overlay blocks until router.refresh() resolves.
  await page.waitForFunction(() => !document.body.innerText.includes('Switching'), { timeout: 20_000 });
  await page.waitForLoadState('networkidle');
}

async function activeBusinessName(page: Page): Promise<string> {
  return (await page.locator('.lm-biz-name').innerText()).trim();
}

/** Visible text of a surface, after it has settled. */
async function surfaceText(page: Page, path: string): Promise<string> {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  // Give client-side fetches a beat to paint.
  await page.waitForTimeout(1200);
  return page.locator('main').innerText();
}

test('A → B → A: no AllignX data survives into LaunchMind', async ({ page }) => {
  test.setTimeout(300_000);
  await login(page);

  // ── Under AllignX ───────────────────────────────────────────────────────
  await page.goto('/dashboard/brief');
  await page.waitForLoadState('networkidle');
  await switchTo(page, /AllignX/i);
  expect(await activeBusinessName(page)).toMatch(/AllignX/i);

  const allignxSaw: Record<string, boolean> = {};
  for (const path of SURFACES) {
    const text = await surfaceText(page, path);
    allignxSaw[path] = ALLIGNX_SENTINELS.some(s => text.includes(s));
  }

  // ── Switch WITHOUT hard refresh ─────────────────────────────────────────
  await page.goto('/dashboard/brief');
  await page.waitForLoadState('networkidle');
  await switchTo(page, /Launchmind/i);
  expect(await activeBusinessName(page)).toMatch(/Launchmind/i);

  // Sidebar must agree with the header.
  const railText = await page.locator('nav').first().innerText();
  expect(railText).not.toMatch(/AllignX/i);

  // ── Every surface under LaunchMind ──────────────────────────────────────
  const leaks: string[] = [];
  for (const path of SURFACES) {
    const text = await surfaceText(page, path);
    for (const sentinel of ALLIGNX_SENTINELS) {
      if (text.includes(sentinel)) leaks.push(`${path}: "${sentinel}"`);
    }
    // The specific reported defects.
    if (/App Store Connect/i.test(text)) leaks.push(`${path}: App Store Connect recommendation`);
    if (/~31% conversion/i.test(text))   leaks.push(`${path}: fabricated 31% conversion`);
    // The FABRICATED path specifically (§5): the resume banner's per-state
    // "Growth Brain is N% confident" and the completion screen's 18%→96%.
    // A bare "96%" is NOT asserted against: the AI recommendation carries its
    // own model-stated confidence, which is generated per request and per
    // business and legitimately varies.
    if (/Growth Brain is \d+% confident/i.test(text)) leaks.push(`${path}: fabricated Growth Brain confidence`);
    if (/gets it to 96%/i.test(text))                 leaks.push(`${path}: hardcoded 96% resume banner`);
    if (/ASO title/i.test(text))         leaks.push(`${path}: ASO advice for a pre-launch product`);
  }
  expect(leaks, `Cross-business leaks under LaunchMind:\n${leaks.join('\n')}`).toEqual([]);

  // ── Refresh · Back · Forward · direct URL ────────────────────────────────
  await page.reload();
  await page.waitForLoadState('networkidle');
  expect(await activeBusinessName(page)).toMatch(/Launchmind/i);

  await page.goto('/dashboard/opportunities');
  await page.waitForLoadState('networkidle');
  await page.goBack();
  await page.waitForLoadState('networkidle');
  expect(await activeBusinessName(page)).toMatch(/Launchmind/i);
  await page.goForward();
  await page.waitForLoadState('networkidle');
  expect(await activeBusinessName(page)).toMatch(/Launchmind/i);

  const direct = await surfaceText(page, '/dashboard/brief');
  expect(ALLIGNX_SENTINELS.some(s => direct.includes(s))).toBe(false);

  // ── Back to AllignX — its own data returns ──────────────────────────────
  await switchTo(page, /AllignX/i);
  expect(await activeBusinessName(page)).toMatch(/AllignX/i);
  const backText = await surfaceText(page, '/dashboard/brief');
  expect(backText).toMatch(/AllignX/i);
});

test('rapid A → B → A does not paint stale data', async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  await page.goto('/dashboard/brief');
  await page.waitForLoadState('networkidle');

  // Switch three times with minimal settle time, then assert the final state is
  // internally consistent — the race is a LATE response from an earlier business
  // overwriting the current one.
  await switchTo(page, /AllignX/i);
  await switchTo(page, /Launchmind/i);
  await switchTo(page, /AllignX/i);
  await switchTo(page, /Launchmind/i);

  await page.waitForTimeout(3000);   // let any late responses land
  expect(await activeBusinessName(page)).toMatch(/Launchmind/i);

  const text = await surfaceText(page, '/dashboard/brief');
  expect(ALLIGNX_SENTINELS.some(s => text.includes(s)),
    'a late AllignX response painted into LaunchMind').toBe(false);

  const opps = await surfaceText(page, '/dashboard/opportunities');
  expect(ALLIGNX_SENTINELS.some(s => opps.includes(s))).toBe(false);
});
