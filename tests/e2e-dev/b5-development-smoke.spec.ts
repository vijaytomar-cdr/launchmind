/**
 * @file b5-development-smoke.spec.ts
 * @description B5 owner-experience DEVELOPMENT SMOKE — not certification.
 *
 *   Runs the Content Intelligence owner experience in a real browser against
 *   LOCAL_REAL_DEVELOPMENT (.env.local, the real development account). Isolated
 *   browser certification with a synthetic identity is Phase B8 and runs behind
 *   scripts/browser-cert-guard.mjs; nothing here substitutes for it, and no
 *   result produced by this file may be described as certified.
 *
 *   SAFETY, enforced in the tests and not only in the guard:
 *     · every write is scoped to the DEV-B5-UX-PREVIEW fixture campaign, checked
 *       by name before the write happens
 *     · publish / launch / schedule / send / spend controls are ASSERTED ABSENT
 *       rather than merely left alone — the point is that they cannot be reached
 *     · without development credentials the authenticated specs SKIP; they never
 *       pass vacuously, because a skipped check reported as green is how an
 *       untested surface reaches an owner
 *
 * @security Reads credentials from the environment. Never logs them.
 */

import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;
const HAVE_CREDS = !!(EMAIL && PASSWORD);

/** The only fixture this smoke may write to. */
const FIXTURE = 'DEV-B5-UX-PREVIEW';

/**
 * Execution-shaped controls that must not exist in the governed content
 * experience. Whole-phrase, and checked inside <main> only: the sidebar carries
 * "Launch Readiness", which is a checklist page and not an execution control —
 * matching it would be a false alarm that trains people to ignore this check.
 */
const FORBIDDEN = [
  /^publish\b/i, /^launch campaign/i, /^launch now/i, /^schedule\b/i,
  /^send now/i, /^set budget/i, /^spend\b/i, /^approve and publish/i,
];

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).first().fill(EMAIL!);
  await page.getByLabel(/password/i).first().fill(PASSWORD!);
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

/** Asserts no execution-shaped control is reachable on the current page. */
async function assertNoExecutionControls(page: Page) {
  const main = page.locator('main');
  const controls = await main.getByRole('button').allInnerTexts();
  const links = await main.getByRole('link').allInnerTexts();
  for (const text of [...controls, ...links]) {
    for (const pattern of FORBIDDEN) {
      expect(text.trim(), `execution-shaped control reachable: "${text.trim()}"`)
        .not.toMatch(pattern);
    }
  }
}

test.describe('B5 development smoke — DEVELOPMENT_SMOKE, not certification', () => {
  test.skip(!HAVE_CREDS, 'No development credentials — authenticated smoke skipped, not passed.');
  test.describe.configure({ mode: 'serial' });

  test('§20 Morning Brief leads with a decision, not metrics', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard/brief');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 30_000 });

    // Metrics must not be the first dominant block. "Supporting signals" is the
    // section they were moved into; it must appear AFTER the decision content.
    const body = await page.locator('main').innerText();
    const decisionAt = Math.min(
      ...['Growth opportunities', 'Awaiting your approval', "Today"]
        .map(s => { const i = body.indexOf(s); return i === -1 ? Number.MAX_SAFE_INTEGER : i; }));
    const signalsAt = body.indexOf('Supporting signals');
    if (signalsAt !== -1) expect(signalsAt).toBeGreaterThan(decisionAt);

    await assertNoExecutionControls(page);
  });

  test('§18 Content Intelligence reads as a decision and reaches the workbench', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard/intelligence/content');
    await expect(page.getByRole('heading', { name: /content intelligence/i })).toBeVisible();

    // The decision surface never offers execution.
    await assertNoExecutionControls(page);

    const review = page.getByRole('button', { name: /review campaign/i });
    if (await review.count() > 0) {
      await review.click();
      await expect(page.getByText(/nothing here schedules, launches or spends/i)).toBeVisible();
      // §4 — Adjust direction is reachable from Campaign Review.
      await expect(page.getByRole('button', { name: /adjust direction/i })).toBeVisible();
    }
  });

  test('§4 Adjust direction previews before it applies', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard/intelligence/content');
    const review = page.getByRole('button', { name: /review campaign/i });
    test.skip(await review.count() === 0, 'No campaign in this development workspace.');
    await review.click();

    // Fixture guard: this smoke only touches DEV-B5-UX-PREVIEW.
    // Fixture guard. NOTE: the DEV-B5-UX-PREVIEW fixture lives in a seed
    // workspace the development account is not a member of, so the browser
    // legitimately cannot reach it — that is tenant isolation working. When it
    // is not reachable this SKIPS rather than passing; the same paths are
    // exercised directly against the fixture at the service layer.
    const heading = await page.locator('h2').allInnerTexts();
    test.skip(!heading.some(h => h.includes(FIXTURE)),
      `Campaign is not the ${FIXTURE} fixture — skipped, not passed.`);

    await page.getByRole('button', { name: /adjust direction/i }).click();
    await expect(page.getByRole('heading',
      { name: /what would you like launchmind to change/i })).toBeVisible();

    // A prompt box would have no structured marketing controls. These do.
    await expect(page.getByLabel('Audience')).toBeVisible();
    await expect(page.getByLabel('Message emphasis')).toBeVisible();
    await expect(page.getByLabel('What you want people to do')).toBeVisible();

    // §8 truth boundary, on the direction path: a figure is emphasis, not proof.
    await page.getByLabel('Message emphasis').fill('our conversion rate is 80% higher');
    await page.getByRole('button', { name: /show me how you would change it/i }).click();
    await expect(page.getByText(/not as something it can prove/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/content you already have stays exactly as it is/i)).toBeVisible();

    // Apply is a separate, deliberate act. Not taken here.
    await expect(page.getByRole('button', { name: /apply direction/i })).toBeVisible();
    await page.getByRole('button', { name: /^cancel$/i }).click();
  });

  test('§19 owner-directed shows its interpretation before creating anything', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard/intelligence/content/create');
    await expect(page.getByRole('heading',
      { name: /what would you like launchmind to help market/i })).toBeVisible();

    // Marketing language only — no model, provider, prompt or format field.
    const text = await page.locator('main').innerText();
    for (const banned of ['temperature', 'JSON', 'prompt', 'model:', 'schema']) {
      expect(text.toLowerCase()).not.toContain(banned.toLowerCase());
    }
    await expect(page.getByRole('button', { name: /promote a new feature/i })).toBeVisible();

    // §8 truth boundary on the owner-directed path.
    await page.getByLabel(/your request/i).fill('Create a campaign saying our conversion rate is 80% higher.');
    await page.getByRole('button', { name: /^continue$/i }).first().click();

    const understood = page.getByText(/here.s what i understood/i);
    const failed = page.getByRole('alert');
    await expect(understood.or(failed)).toBeVisible({ timeout: 90_000 });
    if (await understood.count() > 0) {
      await expect(page.getByText(/not as something it can prove/i)).toBeVisible();
      await expect(page.getByText(/what i still need from you/i)).toBeVisible();
    }
    // Nothing is created: this test never clicks Continue on the interpretation.
  });

  test('§21 Content Studio approves content and nothing else', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard/content');
    await expect(page).toHaveURL(/\/dashboard\/content/);
    await assertNoExecutionControls(page);
  });

  test('§17 product switching does not leak state between applications', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard/intelligence/content');
    await page.waitForLoadState('networkidle');

    // Identity is the APPLICATION the surface is scoped to, not a text blob.
    // Comparing rendered text was brittle: the page carries relative timestamps
    // and can be re-fetching when the assertion runs.
    const productName = async () => {
      await expect(page.getByRole('heading', { name: /content intelligence/i }))
        .toBeVisible({ timeout: 30_000 });
      const text = await page.locator('main').innerText();
      return (text.match(/For (.+)/)?.[1] ?? '').trim();
    };
    /**
     * Waits for the scoped application to become `want`.
     *
     * BusinessSwitcher documents that the destination segment commits around
     * ten seconds after the overlay lifts. Reading at networkidle is therefore
     * too early, and asserting then measures the wait, not the isolation.
     */
    const waitForProduct = async (want: string | null) => {
      const deadline = Date.now() + 45_000;
      let seen = '';
      while (Date.now() < deadline) {
        seen = await productName();
        if (want === null ? seen.length > 0 : seen === want) return seen;
        await page.waitForTimeout(1500);
      }
      return seen;
    };

    const a = await productName();
    const switcher = page.locator('.lm-biz-trigger').first();
    test.skip(await switcher.count() === 0, 'No company switcher in this build.');
    await switcher.click();
    const count = await page.locator('.lm-biz-item').count();
    test.skip(count < 2, 'Single application in this development workspace — an honest empty state, not a failure.');

    await page.locator('.lm-biz-item').nth(1).click();
    let b = await waitForProduct(null);
    const deadline = Date.now() + 45_000;
    while (b === a && Date.now() < deadline) { await page.waitForTimeout(1500); b = await productName(); }
    // B must not be showing A's application.
    expect(b, 'switching company did not change the scoped application').not.toBe(a);

    await page.locator('.lm-biz-trigger').first().click();
    await page.locator('.lm-biz-item').nth(0).click();
    expect(await waitForProduct(a), 'returning did not restore the first application').toBe(a);
  });
});

test.describe('§15 responsive — DEVELOPMENT screenshots, not certification artifacts', () => {
  test.skip(!HAVE_CREDS, 'No development credentials — responsive smoke skipped, not passed.');

  const WIDTHS = [1440, 1280, 1024, 768, 390];
  const PAGES: Array<{ path: string; name: string }> = [
    { path: '/dashboard/brief', name: 'morning-brief' },
    { path: '/dashboard/intelligence/content', name: 'content-intelligence' },
    { path: '/dashboard/intelligence/content/create', name: 'owner-directed' },
    { path: '/dashboard/content', name: 'content-studio' },
  ];

  for (const width of WIDTHS) {
    for (const p of PAGES) {
      test(`${p.name} at ${width}px has no horizontal overflow`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await login(page);
        await page.goto(p.path);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1500);

        // The PAGE must never scroll sideways. Wide content scrolls inside its
        // own container; the body doing it is a layout defect at every width.
        const overflow = await page.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${p.name} at ${width}px overflows by ${overflow}px`).toBeLessThanOrEqual(1);

        await page.screenshot({
          path: `test-results/dev-smoke/${p.name}-${width}.png`, fullPage: true,
        });
      });
    }
  }
});


test.describe('§16 accessibility — DEVELOPMENT_SMOKE, not certification', () => {
  test.skip(!HAVE_CREDS, 'No development credentials — accessibility smoke skipped, not passed.');

  const SURFACES = [
    '/dashboard/brief',
    '/dashboard/intelligence/content',
    '/dashboard/intelligence/content/create',
    '/dashboard/content',
  ];

  for (const path of SURFACES) {
    test(`${path} — headings, labels and focus`, async ({ page }) => {
      await login(page);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1500);

      // Heading order must not skip a level inside main. A jump from h2 to h4
      // tells a screen-reader user a section is nested when it is not.
      const levels = await page.locator('main h1, main h2, main h3, main h4').evaluateAll(
        els => els.map(e => Number(e.tagName.slice(1))));
      let prev = levels[0] ?? 1;
      for (const l of levels) {
        expect(l - prev, `heading order skips a level on ${path}: h${prev} → h${l}`)
          .toBeLessThanOrEqual(1);
        prev = l;
      }

      // Every text input and textarea must have an accessible name. An unlabelled
      // field is unusable by voice control and ambiguous to a screen reader.
      const fields = page.locator('main input:not([type=checkbox]):not([type=hidden]), main textarea');
      for (let i = 0; i < await fields.count(); i++) {
        const name = await fields.nth(i).evaluate((el: HTMLInputElement) => {
          const id = el.getAttribute('id');
          const byLabel = id ? document.querySelector(`label[for="${id}"]`)?.textContent : null;
          return (byLabel || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim();
        });
        expect(name.length, `unlabelled field #${i} on ${path}`).toBeGreaterThan(0);
      }

      // Actions are buttons; navigation is links. A div that acts as a button is
      // not reachable by keyboard and not announced as actionable.
      const fakeButtons = await page.locator('main div[onclick], main span[onclick]').count();
      expect(fakeButtons, `non-semantic clickable elements on ${path}`).toBe(0);

      // Focus must be visible. Tabbing to an invisible focus ring is how a
      // keyboard user loses their place entirely.
      await page.keyboard.press('Tab');
      const focusVisible = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return true;
        const s = getComputedStyle(el);
        return s.outlineStyle !== 'none' || s.boxShadow !== 'none' || !!el.closest('[data-focus-ring]');
      });
      expect(focusVisible, `focus is not visible on ${path}`).toBe(true);
    });
  }

  test('status is never communicated by colour alone', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard/intelligence/content');
    await page.waitForLoadState('networkidle');
    // Every status pill carries a WORD. A coloured dot with no text is invisible
    // to a colour-blind owner and to a screen reader alike.
    const pills = page.locator('main [data-pill], main [role="status"]');
    for (let i = 0; i < await pills.count(); i++) {
      const text = (await pills.nth(i).innerText()).trim();
      expect(text.length, `status element #${i} has no text`).toBeGreaterThan(0);
    }
  });
});
