/**
 * @file improve-intelligence.visual.spec.ts
 * @description Visual regression for the Improve Intelligence surface, checked against
 *   the approved UX (spec §24 "Visual regression", §28 source priority).
 *
 *   Two kinds of check, deliberately separated:
 *
 *   1. TOKEN + STRUCTURE PARITY — parsed straight out of
 *      LaunchMind_Production_UX_July18_2026(21).html and asserted against the running
 *      app's computed styles. A screenshot cannot tell you that `--sage` drifted; this
 *      can, and it fails loudly rather than needing a human to eyeball a diff.
 *
 *   2. SCREENSHOT BASELINES — full-page and per-component snapshots at desktop,
 *      tablet, and mobile widths, so layout regressions are caught too.
 *
 *   Run:  npx playwright test --project=visual
 *   Update baselines after an intentional design change:
 *         npx playwright test --project=visual --update-snapshots
 *
 * @security Uses a signed-in session; no credentials are typed into the page and no
 *   provider secrets appear in any snapshot.
 */

import { test, expect, type Page } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const SPEC_HTML = resolve(__dirname, '../../LaunchMind_Production_UX_July18_2026(21).html');

/**
 * Extracts the `:root` custom properties from the approved HTML so the assertions
 * below are derived from the spec file rather than transcribed by hand — a copy of
 * the values here would drift the moment the spec changed.
 */
function approvedTokens(): Record<string, string> {
  const html = readFileSync(SPEC_HTML, 'utf-8');
  const rootBlock = html.match(/:root\s*\{([\s\S]*?)\}/);
  if (!rootBlock) throw new Error('Could not find :root token block in the approved HTML');

  const tokens: Record<string, string> = {};
  for (const decl of rootBlock[1].split(';')) {
    const m = decl.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*$/);
    if (m) tokens[m[1]] = m[2].replace(/\s+/g, ' ').trim();
  }
  return tokens;
}

/**
 * Normalizes a token value so equivalent spellings compare equal.
 *
 * The spec writes `#fff` where the stylesheet writes `#ffffff`, and browsers report
 * colours as `rgb(...)`. Those are the same colour, and failing on the spelling would
 * be noise that trains people to ignore this test.
 */
function normalizeTokenValue(value: string): string {
  const v = value.trim().toLowerCase().replace(/\s+/g, ' ');

  // #abc → #aabbcc
  const short = v.match(/^#([0-9a-f]{3})$/);
  if (short) {
    const [r, g, b] = short[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }

  // rgb(r, g, b) → #rrggbb
  const rgb = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*1(?:\.0+)?\s*)?\)$/);
  if (rgb) {
    const hex = [rgb[1], rgb[2], rgb[3]]
      .map(n => Number(n).toString(16).padStart(2, '0'))
      .join('');
    return `#${hex}`;
  }

  return v;
}

/** Signs in when credentials are configured; otherwise the caller skips. */
async function signIn(page: Page): Promise<boolean> {
  const email = process.env.TEST_EMAIL;
  const password = process.env.TEST_PASSWORD;
  if (!email || !password) return false;

  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 }).catch(() => undefined);
  return page.url().includes('/dashboard');
}

/** Masks anything that legitimately changes between runs. */
const VOLATILE = [
  '[data-testid="last-sync-value"]',
  '[data-volatile]',
];

test.beforeAll(() => {
  if (!existsSync(SPEC_HTML)) {
    throw new Error(
      `Approved UX file not found at ${SPEC_HTML}. Visual regression cannot run without the source of truth.`,
    );
  }
});

test.describe('Improve Intelligence — design token parity with the approved HTML', () => {
  test('every :root token in the app matches the approved spec value', async ({ page }) => {
    const tokens = approvedTokens();
    // The tokens the dashboard surfaces actually consume.
    const CHECKED = [
      '--page', '--surface', '--raised', '--ink', '--ink2', '--ink3',
      '--border', '--border2', '--sage', '--sage2', '--sage3',
      '--nav', '--amber', '--amber2', '--danger', '--danger2',
      '--violet', '--violet2', '--blue', '--blue2',
      '--r1', '--r2', '--r3',
    ];

    await page.goto('/login'); // any page that loads globals.css
    await page.waitForLoadState('domcontentloaded');

    const actual = await page.evaluate((names: string[]) => {
      const cs = getComputedStyle(document.documentElement);
      const out: Record<string, string> = {};
      for (const n of names) out[n] = cs.getPropertyValue(n).replace(/\s+/g, ' ').trim();
      return out;
    }, CHECKED);

    const mismatches: Array<{ token: string; approved: string; actual: string }> = [];
    for (const token of CHECKED) {
      const approved = tokens[token];
      if (!approved) continue; // token not defined in the spec; nothing to compare
      if (normalizeTokenValue(actual[token]) !== normalizeTokenValue(approved)) {
        mismatches.push({ token, approved, actual: actual[token] });
      }
    }

    expect(mismatches, `Design tokens drifted from ${SPEC_HTML}`).toEqual([]);
  });

  test('sidebar labels the surface exactly as the approved HTML does', async ({ page }) => {
    const html = readFileSync(SPEC_HTML, 'utf-8');
    // The approved nav item, read out of the spec rather than hard-coded here.
    expect(html).toContain('Improve Intelligence');
    expect(html).not.toContain('>Capability Unlocks<');

    if (!(await signIn(page))) test.skip(true, 'TEST_EMAIL / TEST_PASSWORD not configured');

    await page.goto('/dashboard/brief');
    const nav = page.locator('aside').getByText('Improve Intelligence', { exact: true });
    await expect(nav).toBeVisible();
  });
});

test.describe('Improve Intelligence — screenshot baselines', () => {
  test.beforeEach(async ({ page }) => {
    if (!(await signIn(page))) test.skip(true, 'TEST_EMAIL / TEST_PASSWORD not configured');
    await page.goto('/dashboard/channels');
    await page.waitForLoadState('networkidle');
    // Freeze animation so the snapshot is deterministic.
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
  });

  test('default state at desktop width', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(page).toHaveScreenshot('improve-intelligence-desktop.png', {
      fullPage: true, mask: VOLATILE.map(s => page.locator(s)), maxDiffPixelRatio: 0.01,
    });
  });

  test('recommended-source card', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const card = page.locator('article').first();
    await expect(card).toHaveScreenshot('improve-intelligence-recommended-source.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('connected-source card when a source is connected', async ({ page }) => {
    const connected = page.getByTestId('connected-intelligence');
    if ((await connected.count()) === 0) {
      test.skip(true, 'No connected source in this environment');
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(connected).toHaveScreenshot('improve-intelligence-connected.png', {
      mask: VOLATILE.map(s => page.locator(s)), maxDiffPixelRatio: 0.01,
    });
  });

  /**
   * Per-provider connected card. Each observation provider renders through the same
   * component, so a provider-specific baseline catches label or layout drift in the
   * provider-specific parts (resource name, insight text length) without needing a
   * separate page.
   */
  for (const provider of [
    'app_store_connect', 'revenue_cat', 'ga4', 'stripe', 'search_console',
    'google_ads', 'meta_ads', 'hubspot', 'mailchimp',
  ]) {
    test(`connected card renders for ${provider}`, async ({ page }) => {
      const card = page.getByTestId(`connected-source-${provider}`);
      if ((await card.count()) === 0) {
        test.skip(true, `${provider} not connected in this environment`);
      }
      await page.setViewportSize({ width: 1440, height: 1000 });

      // Status must be legible text, never colour alone (spec §21).
      await expect(card).toContainText(/Connected|Syncing|Needs/i);

      await expect(card).toHaveScreenshot(`connected-${provider}.png`, {
        mask: VOLATILE.map(s => page.locator(s)), maxDiffPixelRatio: 0.01,
      });
    });
  }

  test('tablet width has no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 834, height: 1112 });
    await page.waitForTimeout(200);

    // Spec §22: wide content scrolls inside its own container; the body never does.
    const overflows = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflows, 'Page scrolls horizontally at tablet width').toBe(false);

    await expect(page).toHaveScreenshot('improve-intelligence-tablet.png', {
      fullPage: true, mask: VOLATILE.map(s => page.locator(s)), maxDiffPixelRatio: 0.01,
    });
  });

  test('mobile width stays usable and single-column', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);

    const overflows = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflows, 'Page scrolls horizontally at mobile width').toBe(false);

    await expect(page).toHaveScreenshot('improve-intelligence-mobile.png', {
      fullPage: true, mask: VOLATILE.map(s => page.locator(s)), maxDiffPixelRatio: 0.01,
    });
  });

  test('permission copy stays readable at every width', async ({ page }) => {
    // Spec §22: "Do not shrink provider permission text below readable size."
    for (const width of [1440, 834, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(120);

      const tooSmall = await page.evaluate(() => {
        const offenders: string[] = [];
        for (const el of Array.from(document.querySelectorAll('p, span, small, li'))) {
          const text = (el.textContent ?? '').trim();
          if (!/read-only|permission|cannot|publish|spend/i.test(text)) continue;
          const size = parseFloat(getComputedStyle(el).fontSize);
          if (size < 10) offenders.push(`${size}px: ${text.slice(0, 60)}`);
        }
        return offenders;
      });

      expect(tooSmall, `Permission copy below 10px at ${width}px`).toEqual([]);
    }
  });
});

/**
 * Accessibility contract for the connect flow (spec §21).
 *
 * These exercise the shared Dialog and the account radiogroup through a real
 * browser, which is the only way to verify a focus trap honestly — a unit test
 * against a virtual DOM does not model Tab.
 *
 * They need a signed-in session and a provider the workspace can actually connect,
 * so they skip in an environment without TEST_EMAIL / TEST_PASSWORD.
 */
test.describe('Improve Intelligence — connect dialog accessibility', () => {
  test.beforeEach(async ({ page }) => {
    if (!(await signIn(page))) test.skip(true, 'TEST_EMAIL / TEST_PASSWORD not configured');
    await page.goto('/dashboard/channels');
    await page.waitForLoadState('networkidle');
  });

  /** Opens the preview dialog from the first source offering one. */
  async function openPreview(page: Page): Promise<boolean> {
    const preview = page.getByRole('button', { name: /^Preview$/ }).first();
    if ((await preview.count()) === 0) return false;
    await preview.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    return true;
  }

  test('dialog is announced, traps focus, and restores it on close', async ({ page }) => {
    const trigger = page.getByRole('button', { name: /^Preview$/ }).first();
    if ((await trigger.count()) === 0) test.skip(true, 'No connectable source in this environment');
    await trigger.focus();
    await trigger.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toHaveAttribute('aria-label', /.+/);

    // Focus starts inside.
    expect(await dialog.evaluate((d, a) => d.contains(a), await page.evaluateHandle(() => document.activeElement)))
      .toBe(true);

    // Tab many times: focus must never leave the dialog.
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      const inside = await dialog.evaluate(
        (d) => d.contains(document.activeElement),
      );
      expect(inside, `focus escaped the dialog after ${i + 1} tabs`).toBe(true);
    }

    // Escape closes, and focus returns to the control that opened it.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('the page behind the dialog cannot scroll', async ({ page }) => {
    if (!(await openPreview(page))) test.skip(true, 'No connectable source in this environment');
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');
  });

  test('permission review states both what LaunchMind can and cannot do', async ({ page }) => {
    if (!(await openPreview(page))) test.skip(true, 'No connectable source in this environment');
    await page.getByRole('button', { name: /Review what LaunchMind will access/ }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('LaunchMind will be able to');
    await expect(dialog).toContainText('LaunchMind will not be able to');
    await expect(dialog).toContainText(/Spend any money/i);
  });

  test('accounts are a keyboard-navigable radiogroup', async ({ page }) => {
    const group = page.getByRole('radiogroup');
    if ((await group.count()) === 0) {
      test.skip(true, 'No multi-account provider connected in this environment');
    }
    const options = group.getByRole('radio');
    const count = await options.count();
    expect(count).toBeGreaterThan(1);

    await options.first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(options.nth(1)).toBeFocused();
    await expect(options.nth(1)).toHaveAttribute('aria-checked', 'true');

    await page.keyboard.press('ArrowUp');
    await expect(options.first()).toBeFocused();
    await expect(options.first()).toHaveAttribute('aria-checked', 'true');
  });

  test('sync progress is exposed to assistive technology, not just as a bar width', async ({ page }) => {
    const bar = page.getByRole('progressbar');
    if ((await bar.count()) === 0) test.skip(true, 'No sync in flight in this environment');
    await expect(bar).toHaveAttribute('aria-valuenow', /\d+/);
    await expect(page.getByRole('status')).toHaveCount(1, { timeout: 5_000 });
  });

  test('connection health is never communicated by colour alone', async ({ page }) => {
    const cards = page.locator('[data-testid^="connected-source-"]');
    if ((await cards.count()) === 0) test.skip(true, 'No connected source in this environment');

    // Every card must carry a readable status word, not only a coloured border.
    for (let i = 0; i < await cards.count(); i++) {
      await expect(cards.nth(i)).toContainText(
        /Connected|Syncing|Needs|Disconnected|partial|no history/i,
      );
    }
  });

  test('every recovery state explains itself in words', async ({ page }) => {
    const notices = page.locator('[data-testid^="recovery-"]');
    if ((await notices.count()) === 0) test.skip(true, 'No source in a recovery state here');
    for (let i = 0; i < await notices.count(); i++) {
      const n = notices.nth(i);
      // "what happened" plus "what LaunchMind can and cannot do" (spec §14).
      await expect(n).toContainText(/Action needed|Problem|Healthy|Note/);
      expect((await n.innerText()).length).toBeGreaterThan(80);
    }
  });
});
