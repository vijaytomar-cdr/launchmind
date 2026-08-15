/**
 * @file alignment-shell.visual.spec.ts
 * @description Browser-level proof that every "Confirm and align" screen renders
 *   the SAME shell (§11, §12).
 *
 *   The owner reported /onboarding/audience rendering with the dark rail spread
 *   across the top and white content beneath it, with different typography —
 *   the signature of the shell's grid never being applied. These checks assert
 *   the computed layout rather than a screenshot, so they fail for the right
 *   reason and say which property broke.
 *
 *   Skips without TEST_EMAIL / TEST_PASSWORD, matching the repo's existing
 *   visual specs. The skip is logged, never silent: a spec that quietly passes
 *   because it never ran is worse than one that fails.
 *
 * @security Uses a test account only. Never the owner's real session.
 * @dependencies TEST_EMAIL, TEST_PASSWORD, running Next dev server
 */

import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

/** Every Alignment substep, in canonical order. */
const ALIGNMENT = [
  { path: '/onboarding/audience',      substep: 1 },
  { path: '/onboarding/positioning',   substep: 2 },
  { path: '/onboarding/context-delta', substep: 3 },
];

test.beforeEach(async ({ page }) => {
  test.skip(!EMAIL || !PASSWORD, 'TEST_EMAIL / TEST_PASSWORD not set — shell checks skipped');
  await page.goto('/login');
  await page.fill('input[type="email"]', EMAIL!);
  await page.fill('input[type="password"]', PASSWORD!);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 15_000 });
});

/** The shell's measurable identity: two columns, rail beside content. */
async function shellGeometry(page: Page) {
  return page.evaluate(() => {
    const shell = document.querySelector('.ob-shell') as HTMLElement | null;
    const side  = document.querySelector('.ob-side')  as HTMLElement | null;
    const main  = document.querySelector('.ob-main')  as HTMLElement | null;
    if (!shell || !main) return null;
    const s = shell.getBoundingClientRect();
    const a = side?.getBoundingClientRect();
    const m = main.getBoundingClientRect();
    return {
      display: getComputedStyle(shell).display,
      columns: getComputedStyle(shell).gridTemplateColumns,
      sideVisible: Boolean(side && getComputedStyle(side).display !== 'none'),
      // Beside, not stacked: main starts to the RIGHT of the rail.
      sideBesideMain: a ? m.left >= a.right - 1 : true,
      railFullWidth: a ? a.width > s.width * 0.9 : false,
      fontFamily: getComputedStyle(main).fontFamily,
      mainWidth: Math.round(m.width),
      docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
}

test.describe('Alignment shell is identical across substeps', () => {
  test('desktop — rail beside content on every substep, never stacked', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const seen: Array<Record<string, unknown>> = [];

    for (const step of ALIGNMENT) {
      await page.goto(step.path);
      await page.waitForLoadState('networkidle');
      const g = await shellGeometry(page);
      expect(g, `${step.path} did not render the onboarding shell at all`).not.toBeNull();

      // The reported failure mode, asserted directly.
      expect(g!.display, `${step.path}: shell lost its grid`).toBe('grid');
      expect(g!.sideVisible, `${step.path}: rail missing on desktop`).toBe(true);
      expect(g!.railFullWidth, `${step.path}: rail spans the full width (stacked)`).toBe(false);
      expect(g!.sideBesideMain, `${step.path}: content is below the rail, not beside it`).toBe(true);
      expect(g!.docOverflow, `${step.path}: horizontal overflow`).toBe(false);
      seen.push(g as Record<string, unknown>);
    }

    // Same shell, not merely each-valid-alone.
    const [first, ...rest] = seen;
    for (const g of rest) {
      expect(g.columns, 'grid columns differ between substeps').toBe(first.columns);
      expect(g.fontFamily, 'typography differs between substeps').toBe(first.fontFamily);
      expect(Math.abs((g.mainWidth as number) - (first.mainWidth as number)))
        .toBeLessThanOrEqual(1);
    }
  });

  test('the rail shows the correct substep, never "Create your workspace"', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const step of ALIGNMENT) {
      await page.goto(step.path);
      await page.waitForLoadState('networkidle');
      const rail = await page.locator('.ob-side').innerText();
      expect(rail, `${step.path}: rail does not name the substep`)
        .toContain(`Alignment ${step.substep} of 5`);
    }
  });

  test('mobile stacks intentionally — rail hidden, no overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const step of ALIGNMENT) {
      await page.goto(step.path);
      await page.waitForLoadState('networkidle');
      const g = await shellGeometry(page);
      // Design-system behaviour: the rail is HIDDEN below 700px, never a banner.
      expect(g!.sideVisible, `${step.path}: rail should be hidden on mobile`).toBe(false);
      expect(g!.docOverflow, `${step.path}: horizontal overflow on mobile`).toBe(false);
    }
  });

  test('tablet keeps two columns', async ({ page }) => {
    await page.setViewportSize({ width: 834, height: 1112 });
    await page.goto('/onboarding/positioning');
    await page.waitForLoadState('networkidle');
    const g = await shellGeometry(page);
    expect(g!.sideVisible).toBe(true);
    expect(g!.railFullWidth).toBe(false);
    expect(g!.docOverflow).toBe(false);
  });
});

test.describe('navigation matrix (§12)', () => {
  test('browser Back returns to the previous substep with the right shell', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/onboarding/audience');
    await page.waitForLoadState('networkidle');

    await page.goto('/onboarding/positioning');
    await page.waitForLoadState('networkidle');

    await page.goBack();
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/onboarding/audience');

    // The exact reported symptom: after Back, the shell must still be the shell.
    const g = await shellGeometry(page);
    expect(g!.display).toBe('grid');
    expect(g!.railFullWidth).toBe(false);
    expect(g!.sideBesideMain).toBe(true);
    await expect(page.locator('.ob-side')).toContainText('Alignment 1 of 5');
  });

  test('refresh and direct deep link reconstruct the shell from the route', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/onboarding/positioning');
    await page.waitForLoadState('networkidle');
    await page.reload();
    await page.waitForLoadState('networkidle');
    const g = await shellGeometry(page);
    expect(g!.display).toBe('grid');
    await expect(page.locator('.ob-side')).toContainText('Alignment 2 of 5');
  });
});
