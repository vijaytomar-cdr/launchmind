/**
 * @file brief-degradation.spec.ts
 * @description §4 / U13 — a failed AI recommendation must not empty the brief.
 *
 *   CORRECTS A CLAIM I MADE. B6.8B reported "the Morning Brief collapses when
 *   the recommendation fails" as a P0. It does not. The collapse I observed was
 *   the CORS-blocked page: the WHOLE /owner/brief fetch failed, `data` was
 *   null, and `if (!data)` correctly rendered a failure shell. Recommendation
 *   failure and brief failure were never the same branch — I diagnosed the
 *   symptom on an invalid harness and attributed it to the wrong cause.
 *
 *   These tests pin the real behaviour so the distinction cannot rot.
 */
import { test, expect } from '@playwright/test';
import {
  assertOwnerPageHealthy, traceApi, loginAsOwner, waitForOwnerContent, mainText,
} from './ownerHarness';

const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;
test.skip(!EMAIL || !PASSWORD, 'needs TEST_EMAIL / TEST_PASSWORD');
test.setTimeout(150_000);

test('U13 — recommendation unavailable, brief data still rendered', async ({ page }) => {
  const trace = traceApi(page);
  await loginAsOwner(page, EMAIL!, PASSWORD!);

  // FORCE THE DEGRADED BRANCH. Relying on the environment to be broken made
  // this test pass on the healthy path: the run logged
  // RECOMMENDATION_DEGRADED=false, so the invariant was never exercised. The
  // response is rewritten to exactly what the route emits when generation
  // fails — recommendation: null, everything else intact.
  await page.route('**/owner/brief', async route => {
    const res = await route.fetch();
    const body = await res.json() as Record<string, unknown>;
    body.recommendation = null;
    await route.fulfill({ response: res, body: JSON.stringify(body) });
  });

  await page.goto('/dashboard/brief');
  await waitForOwnerContent(page, 60);
  await assertOwnerPageHealthy(page, {
    trace, minWords: 60, mustContain: [/AllignX/i], requireApiSuccess: true });

  const { text, words } = await mainText(page);

  // The environment currently HAS no recommendation (credits exhausted), so
  // this is the degraded case under test, not a hypothetical.
  const degraded = /isn'?t ready|not available|couldn'?t generate/i.test(text);
  console.log('RECOMMENDATION_DEGRADED', degraded, '| main words', words);
  expect(degraded, 'the degraded branch was not exercised — test proves nothing')
    .toBe(true);

  // THE INVARIANT: stored, deterministic brief content survives regardless.
  expect(words, 'the brief emptied when the recommendation failed')
    .toBeGreaterThan(120);
  expect(text, 'the greeting is missing').toMatch(/Good (morning|afternoon|evening)/i);

  // If it claims data is below, data must actually be below.
  if (/data below/i.test(text)) {
    const after = text.split(/data below[^\n]*/i)[1] ?? '';
    expect(after.split(/\s+/).filter(Boolean).length,
      'the page says "your data below" and there is nothing below')
      .toBeGreaterThan(40);
  }
});

test('provider failure never reaches the owner', async ({ page }) => {
  const trace = traceApi(page);
  await loginAsOwner(page, EMAIL!, PASSWORD!);
  await page.goto('/dashboard/brief');
  await waitForOwnerContent(page, 60);
  await assertOwnerPageHealthy(page, {
    trace, minWords: 60, mustContain: [/AllignX/i], requireApiSuccess: true });

  const body = await page.locator('body').innerText();
  for (const leak of [/anthropic/i, /\bclaude\b/i, /credit balance/i, /Plans & Billing/i,
                      /invalid_request_error/i, /\b400\b/, /replicate/i, /api key/i]) {
    expect(body, `provider detail leaked to the owner: ${leak}`).not.toMatch(leak);
  }
});
