/**
 * @file harness-control.spec.ts
 * @description §2 negative control — the harness must REJECT a blank page.
 *
 *   This is the test that would have caught the B6.7/B6.8A failure. It blocks
 *   owner API traffic exactly as CORS did, then asserts the health check
 *   throws. If this spec ever passes without the harness complaining, the
 *   harness is worthless again and every UX result built on it is suspect.
 */
import { test, expect } from '@playwright/test';
import { assertOwnerPageHealthy, traceApi, loginAsOwner, mainText } from './ownerHarness';

const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;
test.skip(!EMAIL || !PASSWORD, 'needs TEST_EMAIL / TEST_PASSWORD');
test.setTimeout(120_000);

test('NEGATIVE CONTROL — the harness fails when the owner API is blocked', async ({ page }) => {
  await loginAsOwner(page, EMAIL!, PASSWORD!);

  // Reproduce the CORS condition deterministically: the page loads, the API
  // does not answer. This is precisely the state the invalid passes measured.
  await page.route('**/localhost:3001/**', route => route.abort());

  const trace = traceApi(page);
  await page.goto('/dashboard/brief');
  await page.waitForTimeout(4000);

  const { words } = await mainText(page);
  // Record what the OLD harness would have seen and happily accepted.
  console.log('BLOCKED_PAGE_WORDS', words);

  let threw = false;
  let why = '';
  try {
    await assertOwnerPageHealthy(page, {
      trace,
      minWords: 60,
      mustContain: [/AllignX/i], requireApiSuccess: true,
    });
  } catch (e) { threw = true; why = String((e as Error).message).split('\n')[0]; }

  console.log('HARNESS_REJECTED:', threw, '|', why.slice(0, 120));
  expect(threw, 'THE HARNESS ACCEPTED A BLANK, API-BLOCKED PAGE').toBe(true);
});

test('POSITIVE CONTROL — the harness passes on the real page', async ({ page }) => {
  const trace = traceApi(page);
  await loginAsOwner(page, EMAIL!, PASSWORD!);
  await page.goto('/dashboard/brief');
  await page.waitForFunction(() =>
    ((document.querySelector('main') as HTMLElement | null)?.innerText ?? '')
      .split(/\s+/).filter(Boolean).length >= 60, null, { timeout: 45_000 });

  await assertOwnerPageHealthy(page, { trace, minWords: 60, mustContain: [/AllignX/i], requireApiSuccess: true });
  const { words } = await mainText(page);
  console.log('REAL_PAGE_WORDS', words, '| api ok:', trace.ok);
});
