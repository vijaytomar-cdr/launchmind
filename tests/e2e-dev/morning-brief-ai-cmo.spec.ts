/**
 * @file morning-brief-ai-cmo.spec.ts
 * @description Read-only browser verification for the Morning Brief trust pass.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  assertOwnerPageHealthy,
  density,
  loginAsOwner,
  mainText,
  traceApi,
  waitForOwnerContent,
} from './ownerHarness';

const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

async function openBrief(page: Page) {
  await page.evaluate(() => {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith('lm_brief_data')) sessionStorage.removeItem(key);
    }
  });
  const trace = traceApi(page);
  await page.goto('/dashboard/brief');
  await waitForOwnerContent(page, 80);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await assertOwnerPageHealthy(page, {
    mustContain: [/AllignX/i, /Today(?:'|’)s priority/i],
    minWords: 80,
    trace,
    requireApiSuccess: true,
  });
}

test.describe('Morning Brief AI CMO trust pass', () => {
  test.skip(!EMAIL || !PASSWORD, 'No development credentials — skipped, not passed.');
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180_000);

  test('trust, decision, lifecycle, pulse, and responsive hierarchy', async ({ page }) => {
    await loginAsOwner(page, EMAIL!, PASSWORD!);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openBrief(page);
    const { text } = await mainText(page);

    expect(text).toMatch(/Since your last visit/i);
    expect(text).toMatch(/Today(?:'|’)s priority/i);
    expect(text).toMatch(/Today\s+1 decision/i);
    expect(text).toMatch(/Basis/i);
    expect(text).toMatch(/Inference/i);
    expect(text).toMatch(/Unknown/i);
    const whyButton = page.getByRole('button', { name: /Why this\?/i });
    await expect(whyButton).toHaveAttribute('aria-expanded', 'false');
    await whyButton.click();
    const reasoning = page.getByRole('region', { name: 'Why LaunchMind chose this priority' });
    await expect(reasoning).toContainText(/Founder-provided/i);
    await expect(reasoning).toContainText(/LaunchMind infers/i);
    await expect(reasoning).toContainText(/Still unknown/i);
    await whyButton.click();
    await expect(whyButton).toHaveAttribute('aria-expanded', 'false');
    expect(text).toMatch(/Your decision/i);
    expect(text).toMatch(/Monthly booking goal/i);
    expect(text).toMatch(/Performance not measured/i);
    expect(text).toMatch(/Performance is not measured yet/i);
    expect(text).not.toMatch(/Ahead of pace|Behind pace|On pace|days left/i);
    expect(text).not.toMatch(/Below 30% target|Approaching \$45 guardrail/i);
    expect(text).not.toMatch(/After 25 additional requests|est\. 2 days|Seeded development activity|fixture signals/i);
    expect(text).toMatch(/Content opportunities|Watching/i);
    expect(text).toMatch(/Ask your AI CMO/i);
    expect(text).toMatch(/Brief reviewed · Performance not measured/i);
    expect(text).not.toMatch(/\b\d{1,3}%\s*(high|confidence)\b/i);
    expect(text).not.toMatch(/\b0 installs\b/i);
    expect(text).not.toMatch(/AI generated/i);
    for (const label of await page.locator('main').getByRole('button').allInnerTexts()) {
      expect(label.trim()).not.toMatch(/^(Ship|Launch|Publish|Schedule|Spend|Boost|Send)\b/i);
    }
    // Content state is conditional. When present, it must use lifecycle-aware
    // language rather than claiming incomplete work is "created".
    if (/concept/i.test(text)) {
      expect(text).toMatch(/Needs you|Ready for your review|Creative status/i);
      if (/needs? input/i.test(text)) expect(text).toMatch(/Needs you/i);
      if (/needs review/i.test(text)) expect(text).toMatch(/Nothing publishes without your approval/i);
      if (/needs review/i.test(text)) expect(text).toMatch(/wording it cannot verify from your current product evidence/i);
    }
    expect(text).not.toMatch(/measurable booking|direct lost bookings|single fastest path/i);

    const d = await density(page);
    console.log('MORNING_BRIEF_AI_CMO_DENSITY', JSON.stringify(d));
    expect(d.blocks).toBeLessThanOrEqual(6);
    expect(d.primaryActions).toBeLessThanOrEqual(2);
    await page.screenshot({ path: 'artifacts/morning-brief/disconnected/1440-full.png', fullPage: true });

    for (const width of [1440, 1280, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `Morning Brief overflows at ${width}px`).toBeLessThanOrEqual(1);
      const viewportPosition = await page.evaluate(() => {
        window.scrollTo({ left: 0, top: 0 });
        const heading = document.querySelector('main h1')?.getBoundingClientRect();
        return { scrollX: window.scrollX, headingLeft: heading?.left ?? -1 };
      });
      expect(viewportPosition.scrollX, `page is horizontally shifted at ${width}px`).toBe(0);
      expect(viewportPosition.headingLeft, `heading is clipped at ${width}px`).toBeGreaterThanOrEqual(0);
      await expect(page.getByText(/Today(?:'|’)s priority/i).first()).toBeVisible();
      await page.screenshot({
        path: `artifacts/morning-brief/disconnected/${width}.png`,
        fullPage: false,
      });
    }
  });
});
