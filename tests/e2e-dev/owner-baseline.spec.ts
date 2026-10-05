/**
 * @file owner-baseline.spec.ts
 * @description §3 — real first-viewport baseline, gated on page health.
 *   Every measurement runs ONLY after assertOwnerPageHealthy passes, so a
 *   number here can never describe a blank page again.
 */
import { test } from '@playwright/test';
import {
  assertOwnerPageHealthy, traceApi, loginAsOwner, waitForOwnerContent, density, mainText,
} from './ownerHarness';

const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;
test.skip(!EMAIL || !PASSWORD, 'needs TEST_EMAIL / TEST_PASSWORD');
test.setTimeout(150_000);

const SURFACES: Array<{ name: string; path: string; must: (string | RegExp)[]; api: boolean }> = [
  // `api` = this surface fetches from the browser, so a successful call is
  // required. Content Studio renders server-side and legitimately makes none.
  { name: 'MORNING_BRIEF',        path: '/dashboard/brief',                must: [/AllignX/i], api: true },
  { name: 'CONTENT_INTELLIGENCE', path: '/dashboard/intelligence/content', must: [/AllignX/i], api: true },
  { name: 'CONTENT_STUDIO',       path: '/dashboard/content',              must: [/AllignX/i], api: false },
];

for (const s of SURFACES) {
  test(`baseline — ${s.name}`, async ({ page }) => {
    const trace = traceApi(page);
    await loginAsOwner(page, EMAIL!, PASSWORD!);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(s.path);
    await waitForOwnerContent(page, 60);
    await assertOwnerPageHealthy(page, { trace, minWords: 60, mustContain: s.must, requireApiSuccess: s.api });

    const d = await density(page);
    const { words } = await mainText(page);
    const h = await page.evaluate(() => ({
      h1: document.querySelectorAll('main h1, h1').length,
      h2: document.querySelectorAll('main h2').length,
      h3: document.querySelectorAll('main h3').length,
      controls: document.querySelectorAll('main button, main a[href]').length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    console.log(`BASELINE ${s.name}`, JSON.stringify({ ...d, mainWords: words, ...h }));
  });
}
