/** Development-only connected-state verification for the Morning Brief fixture. */
import { test, expect, type Page } from '@playwright/test';
import {
  assertOwnerPageHealthy,
  loginAsOwner,
  traceApi,
  waitForOwnerContent,
} from './ownerHarness';

const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

async function openDemoBrief(page: Page) {
  await page.evaluate(() => {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith('lm_brief_data')) sessionStorage.removeItem(key);
    }
  });
  const trace = traceApi(page);
  await page.goto('/dashboard/brief');
  await waitForOwnerContent(page, 100);
  await assertOwnerPageHealthy(page, {
    mustContain: ['AllignX', /Demo performance data/i, /8\s*\/\s*20/i],
    minWords: 100,
    trace,
    requireApiSuccess: true,
  });
}

test.describe('Morning Brief development demo state', () => {
  test.skip(!EMAIL || !PASSWORD, 'No development credentials — skipped, not passed.');
  test.skip(process.env.MORNING_BRIEF_DEMO_DATA !== 'true',
    'Explicit demo flag is off — skipped, not passed.');
  test.setTimeout(180_000);

  test('protects the frozen AI CMO rail hierarchy', async ({ page }) => {
    await loginAsOwner(page, EMAIL!, PASSWORD!);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDemoBrief(page);
    const rail = page.getByRole('complementary', { name: 'Your AI CMO' });
    const order = await rail.evaluate(element => {
      const text = element.textContent ?? '';
      return ["I need from you", "I'm watching", 'Current direction', 'Ask your AI CMO',
        "I'm working on", 'No action needed', 'Memory', 'Content opportunities']
        .map(label => ({ label, index: text.indexOf(label) }));
    });
    expect(order.every(item => item.index >= 0),
      `Frozen rail section missing: ${JSON.stringify(order)}`).toBeTruthy();
    expect(order.map(item => item.index), 'Frozen rail hierarchy changed')
      .toEqual([...order.map(item => item.index)].sort((a, b) => a - b));
    await expect(rail).not.toContainText('Launch readiness');
  });

  test('connected metrics, activity, learning loop, and responsive layout', async ({ page }) => {
    page.on('response', async response => {
      if (response.url().includes('/owner/brief') && response.ok()) {
        const payload = await response.json().catch(() => null) as { opportunities?: Array<{ title: string; type: string }> } | null;
        if (payload?.opportunities) console.log('MORNING_BRIEF_OPPORTUNITY_TYPES', JSON.stringify(payload.opportunities.map(o => ({ title: o.title, type: o.type }))));
      }
    });
    await loginAsOwner(page, EMAIL!, PASSWORD!);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDemoBrief(page);
    const main = page.locator('main');
    await expect(main).toContainText('40%');
    await expect(main).toContainText('12 remaining');
    await expect(main).toContainText('14 days left');
    await expect(main).toContainText('Behind pace by 3');
    await expect(main).toContainText('31');
    await expect(main).toContainText('↑ 14.8%');
    await expect(main).toContainText('25.8%');
    await expect(main).toContainText('↓ 3.8 pts');
    await expect(main).toContainText('$42');
    await expect(main).toContainText('↑ $6');
    await expect(main).toContainText('132');
    await expect(main).toContainText('↑ 18.9%');
    await expect(main).toContainText('5 meaningful updates');
    await expect(main).toContainText('1 needs you');
    await expect(main).toContainText('Reviewed');
    await expect(main).toContainText('1 creative needs review');
    await expect(main).toContainText('2 opportunities on radar');
    await expect(main).toContainText('Last experiment');
    await expect(main).toContainText('Simplified request form');
    await expect(main).toContainText('LaunchMind learned');
    await expect(main).toContainText('Builds on the last result');
    await expect(main).toContainText('Review result');
    await expect(main).toContainText('Your AI CMO');
    await expect(main).toContainText('Seeded development snapshot');
    await expect(main).toContainText('Coverage: development fixture · live sources not represented');
    await expect(main).toContainText("I'm watching");
    await expect(main).toContainText('I need from you');
    await expect(main).toContainText("I'm working on");
    await expect(main).toContainText('Ask your AI CMO');
    await expect(main).toContainText('Below 30% target');
    await expect(main).toContainText('Approaching $45 guardrail');
    await expect(main).toContainText('Why this matters');
    await expect(main).toContainText('Watching outcome');
    await expect(main).toContainText('Request → booking conversion');
    await expect(main).toContainText('Next review');
    await expect(main).toContainText('After 25 additional requests · est. 2 days');
    await expect(main).toContainText("We'll learn");
    await expect(main).toContainText('Whether preferred availability improves request-to-booking conversion.');
    await expect(main).toContainText('Seeded review of 4 fixture signals.');
    await expect(main).toContainText(/Ready for your review|Creative wording review/);
    await expect(page.getByPlaceholder("Ask anything about today's brief...")).toBeVisible();
    const initialAskBounds = await page.getByRole('heading', { name: 'Ask your AI CMO' }).locator('..').evaluate(element => ({
      top: element.getBoundingClientRect().top,
      bottom: element.getBoundingClientRect().bottom,
    }));
    expect(initialAskBounds.bottom, 'The complete Ask surface should be visible in the initial desktop viewport').toBeLessThanOrEqual(900);
    await expect(main).toContainText('Content opportunities · 2');
    await expect(main).toContainText('Memory');
    await expect(main).toContainText('Availability frustration');
    await expect(main).toContainText('Relatable short-form concept');
    await expect(main).toContainText('One app vs. phone calls');
    await expect(main).toContainText('No action needed');
    await expect(main).not.toContainText('Launch readiness');
    const frozenRailOrder = await page.getByRole('complementary', { name: 'Your AI CMO' }).evaluate(element => {
      const text = element.textContent ?? '';
      return ["I need from you", "I'm watching", 'Current direction', 'Ask your AI CMO',
        "I'm working on", 'No action needed', 'Memory', 'Content opportunities']
        .map(label => ({ label, index: text.indexOf(label) }));
    });
    expect(frozenRailOrder.every(item => item.index >= 0),
      `Frozen rail section missing: ${JSON.stringify(frozenRailOrder)}`).toBeTruthy();
    expect(frozenRailOrder.map(item => item.index), 'Frozen rail hierarchy changed')
      .toEqual([...frozenRailOrder.map(item => item.index)].sort((a, b) => a - b));
    await expect(page.getByRole('button', { name: 'Give feedback' })).toHaveCount(0);

    await expect(page.getByRole('link', { name: '1 decision', exact: true })).toHaveAttribute('href', '#todays-priority');
    await expect(page.getByRole('link', { name: '1 creative needs review', exact: true })).toHaveAttribute('href', /\/dashboard\/content\?campaign=/);
    await expect(page.getByRole('link', { name: '2 opportunities on radar', exact: true })).toHaveAttribute('href', '/dashboard/opportunities');
    const sinceUpdatesButton = page.getByRole('button', { name: '5 meaningful updates' });
    const goalHeading = page.getByRole('heading', { name: 'Monthly Booking Goal' });
    const goalTopBeforeUpdates = await goalHeading.evaluate(element => element.getBoundingClientRect().top);
    await sinceUpdatesButton.focus();
    await sinceUpdatesButton.press('Enter');
    await expect(sinceUpdatesButton).toHaveAttribute('aria-expanded', 'true');
    const goalTopAfterUpdates = await goalHeading.evaluate(element => element.getBoundingClientRect().top);
    expect(Math.abs(goalTopAfterUpdates - goalTopBeforeUpdates), 'Activity popover must not reflow Monthly Booking Goal').toBeLessThanOrEqual(1);
    const sinceUpdates = page.getByRole('region', { name: 'Updates since your last visit' });
    await expect(sinceUpdates).toContainText('Seeded development activity');
    await expect(sinceUpdates).toContainText('9:42 AM');
    await expect(sinceUpdates).toContainText('Conversion moved below target.');
    await expect(sinceUpdates).toContainText('10:18 AM');
    await expect(sinceUpdates).toContainText('LaunchMind evaluated a new market signal.');
    await expect(sinceUpdates).toContainText('Current direction retained.');
    await expect(sinceUpdates).toContainText('3 creative concepts prepared.');
    await expect(sinceUpdates).toContainText('1 item needs your review.');
    await expect(sinceUpdates.getByRole('link', { name: /evaluated a new market signal/i })).toHaveAttribute('href', '/dashboard/intelligence/market');
    await expect(sinceUpdates.getByRole('link', { name: /creative concepts prepared/i })).toHaveAttribute('href', /\/dashboard\/content\?campaign=/);
    await expect(page.getByRole('link', { name: '1 needs you', exact: true })).toHaveAttribute('href', /\/dashboard\/content\?campaign=/);
    await page.screenshot({
      path: 'artifacts/morning-brief/final-ux-freeze/since-popover-1440.png',
      fullPage: true,
    });
    await page.keyboard.press('Escape');
    await expect(sinceUpdatesButton).toHaveAttribute('aria-expanded', 'false');
    await expect(sinceUpdatesButton).toBeFocused();

    const seeUpdatesButton = page.getByRole('button', { name: /See updates/i });
    await seeUpdatesButton.click();
    await expect(seeUpdatesButton).toHaveAttribute('aria-expanded', 'true');
    await page.getByText(/Good (morning|afternoon|evening), Vijay\./).click();
    await expect(seeUpdatesButton).toHaveAttribute('aria-expanded', 'false');

    await page.screenshot({
      path: 'artifacts/morning-brief/trust-loop-closure/after-collapsed-1440.png',
      fullPage: true,
    });

    const whyButton = page.getByRole('button', { name: /Why this\?/i });
    await whyButton.focus();
    await whyButton.press('Enter');
    await expect(whyButton).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('region', { name: 'Why LaunchMind chose this priority' })).toContainText('Founder-provided');
    await page.screenshot({
      path: 'artifacts/morning-brief/final-right-rail-completion/after-expanded-1440.png',
      fullPage: true,
    });
    await whyButton.press('Space');
    await expect(whyButton).toHaveAttribute('aria-expanded', 'false');

    await page.setViewportSize({ width: 390, height: 900 });
    await seeUpdatesButton.click();
    const mobilePopoverBounds = await sinceUpdates.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    });
    expect(mobilePopoverBounds.left, 'Activity popover leaves the mobile viewport on the left').toBeGreaterThanOrEqual(0);
    expect(mobilePopoverBounds.right, 'Activity popover leaves the mobile viewport on the right').toBeLessThanOrEqual(390);
    await page.keyboard.press('Escape');

    for (const width of [1600, 1440, 1280, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await whyButton.click();
      const reasoning = page.getByRole('region', { name: 'Why LaunchMind chose this priority' });
      await expect(reasoning).toBeVisible();
      const clipping = await reasoning.evaluate(element => ({
        vertical: element.scrollHeight - element.clientHeight,
        horizontal: element.scrollWidth - element.clientWidth,
      }));
      expect(clipping.vertical, `Reasoning is vertically clipped at ${width}px`).toBeLessThanOrEqual(1);
      expect(clipping.horizontal, `Reasoning is horizontally clipped at ${width}px`).toBeLessThanOrEqual(1);
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `Demo Morning Brief overflows at ${width}px`).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: `artifacts/morning-brief/final-right-rail-completion/expanded-${width}.png`,
        fullPage: true,
      });
      await whyButton.click();
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await whyButton.click();
    await expect(whyButton).toHaveAttribute('aria-expanded', 'true');
    await page.locator('main').evaluate(element => element.scrollTo({ top: 520, behavior: 'instant' }));
    await page.waitForTimeout(100);
    const stickyTop = await page.locator('[data-ai-cmo-sticky]').evaluate(element => element.getBoundingClientRect().top);
    expect(stickyTop, 'AI CMO priority rail should remain below the application header').toBeGreaterThanOrEqual(80);
    expect(stickyTop, 'AI CMO priority rail should stay visible while the main brief scrolls').toBeLessThanOrEqual(90);
    const askHeading = page.getByRole('heading', { name: 'Ask your AI CMO' });
    await expect(askHeading).toBeVisible();
    const askBounds = await askHeading.locator('..').evaluate(element => ({
      top: element.getBoundingClientRect().top,
      bottom: element.getBoundingClientRect().bottom,
    }));
    expect(askBounds.bottom, 'Ask should remain inside the visible desktop rail').toBeLessThanOrEqual(900);
    expect(askBounds.top, 'Ask should settle into the lower part of the desktop rail').toBeGreaterThan(520);
    await page.screenshot({ path: 'artifacts/morning-brief/trust-loop-closure/after-expanded-scrolled-1440.png' });
    await whyButton.click();
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.locator('main').evaluate(element => element.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({
      path: 'artifacts/morning-brief/final-right-rail-completion/after-1440-full.png',
      fullPage: true,
    });
  });
});
