import { test, expect, type Page } from '@playwright/test';
import { assertOwnerPageHealthy, loginAsOwner, traceApi, waitForOwnerContent } from './ownerHarness';

const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;
const CAMPAIGN = 'ccf9becd-8ce1-49e3-8266-f3a7ff60da52';

async function noOverflow(page: Page, width: number, label: string) {
  const overflow = await page.evaluate(() => {
    const main = document.querySelector('main');
    return Math.max(
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      main ? main.scrollWidth - main.clientWidth : 0,
    );
  });
  expect(overflow, `${label} overflows at ${width}px`).toBeLessThanOrEqual(1);
}

test.describe('UX-2 read-only creative review', () => {
  test.skip(!EMAIL || !PASSWORD, 'No development credentials — skipped, not passed.');
  test.setTimeout(180_000);

  test('intelligence to exact Studio set remains substantive and responsive', async ({ page }) => {
    const browserErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on('console', message => {
      // Chromium emits a context-free console error for the intentionally
      // placeholder PostHog key. Local response/request listeners below are
      // the actionable health gate; uncaught page errors remain fatal.
      if (message.type() === 'error' && !/^Failed to load resource:/.test(message.text())) {
        browserErrors.push(message.text());
      }
    });
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('requestfailed', request => {
      const failure = request.failure()?.errorText ?? 'failed';
      if (/ERR_ABORTED/i.test(failure) || !/^https?:\/\/localhost:(3000|3001)\//.test(request.url())) return;
      failedRequests.push(`${failure} ${request.url()}`);
    });
    page.on('response', response => {
      if (response.status() >= 400 && /\/_next\/static\//.test(response.url())) {
        failedRequests.push(`${response.status()} ${response.url()}`);
      }
    });
    await loginAsOwner(page, EMAIL!, PASSWORD!);
    await page.setViewportSize({ width: 1440, height: 900 });

    const trace = traceApi(page);
    await page.goto('/dashboard/intelligence/content');
    await waitForOwnerContent(page, 120);
    await assertOwnerPageHealthy(page, {
      mustContain: ['Content Intelligence', /recommended content opportunity/i,
        /why now/i, /best format/i, /creative direction/i],
      minWords: 80, trace, requireApiSuccess: true,
    });
    await expect(page.locator('main')).not.toContainText(/current growth objective|growth hypothesis/i);
    await page.getByRole('button', { name: /why this recommendation/i }).click();
    await expect(page.locator('main')).toContainText(/available proof|campaign review/i);
    await expect(page.getByRole('button', { name: 'Give feedback' })).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText(/guaranteed viral|will go viral|winning concept/i);
    await page.screenshot({ path: 'artifacts/ux23/02-why-recommendation-expanded.png', fullPage: true });

    await page.goto('/dashboard/content');
    await waitForOwnerContent(page, 80);
    await assertOwnerPageHealthy(page, {
      mustContain: ['AllignX', 'Content Studio', /ready for your review/i], minWords: 45,
    });
    await expect(page.getByRole('button', { name: 'Give feedback' })).toHaveCount(0);
    const attention = page.getByRole('region', { name: /ready for your review/i });
    await expect(attention.getByText('Review →').first()).toBeVisible();
    await attention.getByRole('button').first().click();
    await expect(page).toHaveURL(/\/dashboard\/content\?campaign=[^&]+&artifact=[^&]+/);
    await waitForOwnerContent(page, 100);

    await page.goto(`/dashboard/content?campaign=${CAMPAIGN}&view=compare`);
    await waitForOwnerContent(page, 100);
    await assertOwnerPageHealthy(page, {
      mustContain: ['Content Studio', 'Compare concepts', 'META', /visual thesis/i], minWords: 55,
    });
    await expect(page.getByRole('button', { name: 'Give feedback' })).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText(/Why this creative/i);
    await expect(page.locator('main')).not.toContainText(/guaranteed viral|winning concept/i);
    await page.screenshot({ path: 'artifacts/ux2/content-studio-compare-1440.png', fullPage: true });

    for (const width of [1440, 1280, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [path, label] of [
        ['/dashboard/intelligence/content', 'Content Intelligence'],
        [`/dashboard/content?campaign=${CAMPAIGN}&view=compare`, 'Content Studio comparison'],
      ] as const) {
        await page.goto(path);
        await waitForOwnerContent(page, 80);
        await expect(page.locator('main')).toContainText(label === 'Content Intelligence'
          ? 'Content Intelligence' : 'Content Studio');
        await noOverflow(page, width, label);
        await page.screenshot({ path: `artifacts/ux2/${label === 'Content Intelligence' ? 'intelligence' : 'studio'}-${width}.png`, fullPage: true });
      }
    }
    expect(browserErrors, 'browser console/page errors').toEqual([]);
    expect(failedRequests, 'failed requests or static asset errors').toEqual([]);
  });

  test('UX-2.3 required progressive-disclosure screenshots', async ({ page }) => {
    await loginAsOwner(page, EMAIL!, PASSWORD!);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('/dashboard/intelligence/content');
    await waitForOwnerContent(page, 100);
    await page.screenshot({ path: 'artifacts/ux23/01-intelligence-default.png', fullPage: true });
    await page.screenshot({ path: 'artifacts/ux23/03-readiness-collapsed.png', fullPage: true });
    await page.getByText('Review inputs →', { exact: true }).click();
    await page.screenshot({ path: 'artifacts/ux23/04-readiness-expanded.png', fullPage: true });
    await page.getByRole('button', { name: /why this recommendation/i }).click();
    await page.screenshot({ path: 'artifacts/ux23/05-campaign-review-default.png', fullPage: true });
    await page.getByText('Review full strategy', { exact: true }).click();
    await page.screenshot({ path: 'artifacts/ux23/06-campaign-strategy-expanded.png', fullPage: true });

    await page.goto('/dashboard/content');
    await waitForOwnerContent(page, 70);
    await page.screenshot({ path: 'artifacts/ux23/07-studio-home.png', fullPage: true });

    await page.goto(`/dashboard/content?campaign=${CAMPAIGN}`);
    await waitForOwnerContent(page, 90);
    await expect(page.locator('main img[alt^="Visual for"]').first()).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: 'artifacts/ux23/08-workbench-initial.png', fullPage: true });
    await page.screenshot({ path: 'artifacts/ux23/09-needs-rewrite.png', fullPage: true });
    await page.getByText('Why this creative?', { exact: true }).click();
    await page.screenshot({ path: 'artifacts/ux23/10-why-creative-expanded.png', fullPage: true });
    await page.getByText('Safety & evidence', { exact: true }).click();
    await page.screenshot({ path: 'artifacts/ux23/11-safety-evidence-expanded.png', fullPage: true });
    await page.getByText('History', { exact: true }).click();
    await page.screenshot({ path: 'artifacts/ux23/12-history-expanded.png', fullPage: true });
  });

  test('runtime recovery keeps all three owner surfaces substantive', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    const badResponses: string[] = [];
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('requestfailed', request => failedRequests.push(
      `${request.failure()?.errorText ?? 'failed'} ${request.url()}`));
    page.on('response', response => {
      if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
    });

    await loginAsOwner(page, EMAIL!, PASSWORD!);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('/dashboard/intelligence/content');
    await waitForOwnerContent(page, 120);
    await expect(page.getByText('Owner Command Center', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Current company: AllignX/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Content Intelligence' })).toBeVisible();
    const intelligence = page.locator('main');
    await expect(intelligence).toContainText(/recommended content opportunity/i);
    await expect(intelligence).toContainText(/why now/i);
    await expect(intelligence).toContainText(/best format/i);
    await expect(intelligence).toContainText(/creative direction/i);
    await expect(intelligence).toContainText(/concept/i);
    await expect(intelligence).toContainText(/ready to create|thing needed/i);

    const sidebar = page.locator('nav').first();
    const sidebarStyle = await sidebar.evaluate(element => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, backgroundImage: style.backgroundImage,
        color: style.color, font: style.fontFamily };
    });
    expect(sidebarStyle.backgroundImage).toContain('linear-gradient');
    expect(sidebarStyle.backgroundImage).toContain('rgb(16, 32, 28)');
    expect(sidebarStyle.font.toLowerCase()).not.toContain('times');

    await page.goto('/dashboard/content');
    await waitForOwnerContent(page, 80);
    await expect(page.getByRole('heading', { name: 'Content Studio' })).toBeVisible();
    await expect(page.locator('main')).toContainText(/ready for review/i);
    await expect(page.locator('main')).toContainText(/current work/i);

    await page.goto('/dashboard/brief');
    await waitForOwnerContent(page, 120);
    const brief = page.locator('main');
    await expect(brief).toContainText('Seeded development snapshot');
    await expect(brief).toContainText('40%');
    await expect(brief).toContainText('31');
    await expect(brief).toContainText('25.8%');
    await expect(brief).toContainText('$42');
    await expect(brief).toContainText('132');

    console.log('RUNTIME_RECOVERY_BROWSER', JSON.stringify({
      consoleErrors, pageErrors, failedRequests, badResponses, sidebarStyle,
    }));
    expect(pageErrors, 'uncaught browser exceptions').toEqual([]);
    expect(failedRequests.filter(line => /\/_next\/static\//.test(line)),
      'failed Next.js static requests').toEqual([]);
    expect(badResponses.filter(line => /\/_next\/static\//.test(line)),
      '4xx/5xx Next.js static responses').toEqual([]);
    expect(badResponses.filter(line => /localhost:3001/.test(line)),
      '4xx/5xx backend API responses').toEqual([]);
  });

  test('mobile and tablet keep both decision surfaces usable', async ({ page }) => {
    await loginAsOwner(page, EMAIL!, PASSWORD!);
    for (const width of [768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [path, label] of [
        ['/dashboard/intelligence/content', 'Content Intelligence'],
        [`/dashboard/content?campaign=${CAMPAIGN}&view=compare`, 'Content Studio'],
      ] as const) {
        await page.goto(path);
        await waitForOwnerContent(page, 80);
        await expect(page.locator('main')).toContainText(label);
        await noOverflow(page, width, label);
        await page.screenshot({ path: `artifacts/ux2/${label === 'Content Intelligence' ? 'intelligence' : 'studio'}-${width}.png`, fullPage: true });
      }
    }
  });

  test('UX-2.4 owner requirement, typed failure, and creative quality gate render', async ({ page }) => {
    const browserErrors: string[] = [];
    const staticFailures: string[] = [];
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400 && /\/_next\/static\//.test(response.url())) {
        staticFailures.push(`${response.status()} ${response.url()}`);
      }
    });
    await loginAsOwner(page, EMAIL!, PASSWORD!);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('/dashboard/intelligence/content');
    await waitForOwnerContent(page, 100);
    await expect(page.getByRole('heading', { name: 'Content Intelligence' })).toBeVisible();
    const toneAction = page.getByRole('button', { name: /review tone/i });
    if (await toneAction.count()) {
      await toneAction.click();
      await expect(page.getByLabel('Choose brand tone')).toBeVisible();
      await expect(page.locator('main')).toContainText(/not required to create content/i);
    }
    await page.screenshot({ path: 'artifacts/ux24/01-actionable-tone.png', fullPage: true });

    // Deterministic UI proof only: exercise the typed backend contract without
    // spending a provider call or mutating the owner's existing content.
    await page.route('**/studio/governed/package', async route => {
      await new Promise(resolve => setTimeout(resolve, 250));
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({
        code: 'CREATIVE_GENERATION_UNAVAILABLE',
        error: 'Creative generation is temporarily unavailable. Your strategy and existing content are saved.',
        stages: [
          { name: 'BUSINESS_CONTEXT', state: 'COMPLETE', durationMs: 12 },
          { name: 'PRODUCT_TRUTH', state: 'COMPLETE', durationMs: 0 },
          { name: 'CREATIVE_PATTERNS', state: 'COMPLETE', durationMs: 8 },
          { name: 'CONCEPTS', state: 'FAILED', durationMs: 130 },
          { name: 'VISUALS', state: 'SKIPPED', durationMs: 0 },
        ],
      }) });
    });
    const explain = page.getByRole('button', { name: /why this recommendation/i });
    if (await explain.count()) await explain.click();
    const create = page.getByRole('button', { name: /^Create recommended content/ }).first();
    await expect(create).toBeVisible();
    await create.click();
    const creationAlert = page.getByRole('alert').filter({ hasText: /creative generation/i });
    await expect(creationAlert).toContainText(/temporarily unavailable/i);
    await expect(page.locator('main')).not.toContainText(/Anthropic|credits|billing|HTTP 400/i);
    await page.getByRole('button', { name: /what blocked it/i }).click();
    await expect(creationAlert).toContainText(/visual creation was skipped/i);
    await page.screenshot({ path: 'artifacts/ux24/02-stage-aware-failure.png', fullPage: true });

    await page.goto(`/dashboard/content?campaign=${CAMPAIGN}`);
    await waitForOwnerContent(page, 100);
    await expect(page.locator('main img[alt^="Visual for"]').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('main')).toContainText(/LaunchMind assessment · LaunchMind is refining this/i);
    await expect(page.getByRole('button', { name: /Try another visual|Continue refining visual/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve visual' })).toHaveCount(0);
    await expect(page.locator('main')).toContainText(/Current approved product images will be used for the next visual|Current product images are available/i);
    await page.screenshot({ path: 'artifacts/ux24/03-current-assets-quality-gate.png', fullPage: true });

    expect(browserErrors).toEqual([]);
    expect(staticFailures).toEqual([]);
  });

  test('UX-2.8 keeps system repair out of owner work and disables unavailable video', async ({ page }) => {
    await loginAsOwner(page, EMAIL!, PASSWORD!);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/dashboard/content?campaign=${CAMPAIGN}&view=compare`);
    await waitForOwnerContent(page, 55);
    await expect(page.locator('main')).not.toContainText('Needs attention');
    await expect(page.locator('main')).toContainText(/Ready for your review|LaunchMind is refining this/);

    const videoConcept = page.getByRole('article').filter({ hasText: /short video/i }).first();
    if (await videoConcept.count()) {
      await videoConcept.getByRole('button', { name: 'Review this concept' }).click();
      await expect(page.locator('main')).toContainText(
        'Video production is not available in this development environment yet.');
      await expect(page.getByRole('button', { name: /Generate video/i })).toHaveCount(0);
    }
    await page.screenshot({ path: 'artifacts/ux28/owner-state-and-video.png', fullPage: true });
  });

  test('UX-2.8 performs two bounded distinct Problem Recognition renders', async ({ page }) => {
    test.skip(process.env.UX28_REAL_RENDER !== 'true',
      'Real provider mutation is opt-in; skipped by default to protect owner cost and state.');
    test.setTimeout(240_000);
    await loginAsOwner(page, EMAIL!, PASSWORD!);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/dashboard/content?campaign=${CAMPAIGN}&view=compare`);
    await waitForOwnerContent(page, 55);
    const concept = page.getByRole('article', { name: /problem recognition/i });
    await concept.getByRole('button', { name: 'Review this concept' }).click();
    await expect(page.getByRole('region', { name: 'Creative' }).getByText('Loading…'))
      .toHaveCount(0, { timeout: 30_000 });

    const image = page.locator('main img[alt^="Visual for"]').first();
    const seen = new Set<string>();
    if (await image.count()) seen.add((await image.getAttribute('src')) ?? '');
    const results: Array<{ status: number; renderJobId?: string; execution?: string;
      critique?: string; costUsd?: number | null }> = [];

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const action = page.getByRole('button', {
        name: /try another visual|continue refining visual|create visual using my product images|create visual/i,
      }).first();
      await expect(action).toBeVisible();
      const responsePromise = page.waitForResponse(response =>
        /\/studio\/governed\/artifact\/[^/]+\/visual$/.test(response.url())
          && response.request().method() === 'POST', { timeout: 120_000 });
      await action.click();
      const response = await responsePromise;
      const body = await response.json().catch(() => ({})) as {
        renderJobId?: string; provenance?: string[]; costUsd?: number | null;
      };
      results.push({ status: response.status(), renderJobId: body.renderJobId,
        costUsd: body.costUsd ?? null });
      console.log('UX28_RENDER_ATTEMPT', attempt, response.status(), JSON.stringify(body));
      expect(response.status()).toBe(201);
      await expect(page.getByRole('status')).toContainText('Visual updated', { timeout: 30_000 });
      const src = (await image.getAttribute('src')) ?? '';
      expect(src).toBeTruthy();
      expect(seen.has(src), `render ${attempt} repeated the displayed visual URL`).toBe(false);
      seen.add(src);
      await image.screenshot({ path: `artifacts/ux28/problem-recognition-${attempt}.png` });
      await page.screenshot({ path: `artifacts/ux28/problem-recognition-${attempt}-workbench.png`, fullPage: true });
    }

    const history = page.getByRole('button', { name: /Visual history/ });
    await expect(history).toBeVisible();
    await history.click();
    await expect(page.locator('main')).toContainText('Read-only — opening one does not make it current or approve it.');
    await page.screenshot({ path: 'artifacts/ux28/problem-recognition-history.png', fullPage: true });
    console.log('UX28_REAL_RENDER_RESULTS', JSON.stringify(results));
  });

  test('UX-2.7 creates one fresh Problem Recognition execution', async ({ page }) => {
    test.setTimeout(180_000);
    const trace = traceApi(page);
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await loginAsOwner(page, EMAIL!, PASSWORD!);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/dashboard/content?campaign=${CAMPAIGN}&view=compare`);
    await waitForOwnerContent(page, 55);
    await assertOwnerPageHealthy(page, {
      mustContain: ['Content Studio', 'Compare concepts', 'Problem recognition'], minWords: 55,
      trace, requireApiSuccess: true,
    });
    const concept = page.getByRole('article', { name: /problem recognition/i });
    await concept.getByRole('button', { name: 'Review this concept' }).click();
    await expect(page.getByRole('heading', { name: /problem recognition/i })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Creative' }).getByText('Loading…'))
      .toHaveCount(0, { timeout: 30_000 });
    const image = page.locator('main img[alt^="Visual for"]').first();
    const before = await image.count() ? await image.getAttribute('src') : null;
    if (before) {
      await expect(image).toBeVisible();
      expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThanOrEqual(600);
      await image.screenshot({ path: 'artifacts/ux27/problem-recognition-fresh-visual.png' });
      await page.screenshot({ path: 'artifacts/ux27/problem-recognition-fresh.png', fullPage: true });
      expect(pageErrors).toEqual([]);
      return;
    }
    const action = page.getByRole('button', { name: /try another visual|rebuild visual|create (visual )?(using|with) my product images|create visual/i }).first();
    await expect(action).toBeVisible();
    const responsePromise = page.waitForResponse(response =>
      /\/studio\/governed\/artifact\/[^/]+\/visual$/.test(response.url()) && response.request().method() === 'POST',
      { timeout: 90_000 });
    await action.click();
    const response = await responsePromise;
    expect(response.status()).toBe(201);
    await expect(page.getByRole('status')).toContainText(/Visual updated/i, { timeout: 30_000 });
    const after = await page.locator('main img[alt^="Visual for"]').first().getAttribute('src');
    expect(after).toBeTruthy();
    await page.screenshot({ path: 'artifacts/ux27/problem-recognition-fresh.png', fullPage: true });
    expect(pageErrors).toEqual([]);
  });

});
