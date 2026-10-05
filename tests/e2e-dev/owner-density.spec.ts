/**
 * @file owner-density.spec.ts
 * @description §21/§27/§28 — measures first-viewport density, then guards it.
 *
 *   The owner has reported Morning Brief as text-heavy three times. Card count
 *   has come down; the reading load has not been measured. This counts what is
 *   actually visible in the first viewport at 1440 so "less dense" is a number
 *   rather than an opinion.
 */
import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;
test.skip(!EMAIL || !PASSWORD, 'needs TEST_EMAIL / TEST_PASSWORD');
// Login plus a client-side data fetch does not fit the 30s project default.
test.setTimeout(120_000);

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).first().fill(EMAIL!);
  await page.getByLabel(/password/i).first().fill(PASSWORD!);
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

/** What a reader actually meets above the fold. */
async function density(page: Page) {
  return page.evaluate(() => {
    const vh = window.innerHeight;
    const inFold = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.top < vh && r.bottom > 0 && r.height > 0 && r.width > 0;
    };
    const visible = (el: Element) => {
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05;
    };
    const all = [...document.querySelectorAll('main *')].filter(e => visible(e) && inFold(e));
    // A "bordered block" is what reads as a card.
    const blocks = all.filter(e => {
      const s = getComputedStyle(e);
      return (parseFloat(s.borderTopWidth) > 0 || s.boxShadow !== 'none')
        && e.getBoundingClientRect().height > 40;
    }).length;
    const paragraphs = all.filter(e => e.tagName === 'P'
      && (e.textContent ?? '').trim().length > 30).length;
    // Uppercase micro-labels — the "eyebrow" pattern.
    const eyebrows = all.filter(e => {
      const s = getComputedStyle(e);
      return s.textTransform === 'uppercase' && parseFloat(s.fontSize) <= 12
        && (e.textContent ?? '').trim().length > 0 && e.children.length === 0;
    }).length;
    const words = all.filter(e => e.children.length === 0)
      .map(e => (e.textContent ?? '').trim())
      .join(' ').split(/\s+/).filter(Boolean).length;
    const primaryActions = all.filter(e => {
      if (!(e.tagName === 'BUTTON' || e.tagName === 'A')) return false;
      const s = getComputedStyle(e);
      const bg = s.backgroundColor;
      // A filled, high-emphasis action.
      return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'
        && !bg.startsWith('rgb(255, 255, 255)') && e.getBoundingClientRect().height > 26;
    }).length;
    return { blocks, paragraphs, eyebrows, words, primaryActions };
  });
}

test('Morning Brief first-viewport density', async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard/brief');
  // WAIT FOR CONTENT, NOT A CLOCK. A fixed 2.5s measured the loading skeleton
  // and reported 20 words on a page the owner calls text-heavy — a measurement
  // of nothing. These surfaces fetch client-side, so the wait has to be for
  // something only the loaded page has.
  await page.getByRole('heading', { level: 1 }).first()
    .waitFor({ state: 'visible', timeout: 45_000 });
  await page.waitForFunction(() =>
    (document.querySelector('main')?.innerText ?? '').split(/\s+/).length > 60,
    null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const d = await density(page);
  console.log('MORNING_BRIEF_DENSITY', JSON.stringify(d));
  // Guard rails, not a redesign target.
  expect(d.blocks, 'too many bordered blocks above the fold').toBeLessThanOrEqual(6);
  expect(d.paragraphs, 'too many long paragraphs above the fold').toBeLessThanOrEqual(4);
  expect(d.primaryActions, 'more than one action competes as primary').toBeLessThanOrEqual(2);
});

test('Content Intelligence first-viewport density', async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard/intelligence/content');
  await page.getByRole('heading', { level: 1 }).first()
    .waitFor({ state: 'visible', timeout: 45_000 });
  await page.waitForFunction(() =>
    (document.querySelector('main')?.innerText ?? '').split(/\s+/).length > 60,
    null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const d = await density(page);
  console.log('CONTENT_INTELLIGENCE_DENSITY', JSON.stringify(d));
  expect(d.blocks).toBeLessThanOrEqual(6);
  expect(d.paragraphs).toBeLessThanOrEqual(5);
});
