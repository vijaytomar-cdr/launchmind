/**
 * @file switch-latency.cert.spec.ts
 * @description MEASURES the company switch timeline (Part 28) and detects the
 *   split-brain window (Part 27) rather than reasoning about it.
 *
 *   Records, per switch:
 *     t_click        owner clicks the destination company
 *     t_activate     POST /businesses/:id/activate responds
 *     t_header       the switcher label becomes the destination company
 *     t_content      the content region stops containing the ORIGIN company
 *     t_overlay      the blocking "Switching…" overlay disappears
 *
 *   SPLIT-BRAIN = any interval where the header says B while the content still
 *   says A AND the overlay is gone. That is the owner-visible defect.
 *
 * @security Credentials from env only; never printed.
 * @dependencies TEST_EMAIL, TEST_PASSWORD, running dev server
 */

import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;
test.skip(!EMAIL || !PASSWORD, 'TEST_EMAIL / TEST_PASSWORD not set');

// IDENTITY SENTINELS, not bare brand words. The Morning Brief states which
// company it is reporting on ("Your growth system reviewed <NAME> overnight"),
// and that sentence is the business-identity surface. Matching a bare /Launchmind/
// also matched product self-reference copy ("while LaunchMind has no performance
// data yet") on AllignX's own opportunity, which is not mixed-business state and
// produced a 40ms false positive.
const SENTINEL = {
  allignx:    { menu: /AllignX/i,    identity: /reviewed[^.]*AllignX/i },
  launchmind: { menu: /Launchmind/i, identity: /reviewed[^.]*Launchmind/i },
};

async function login(page: Page) {
  await page.goto('/login');
  await page.fill('input[type="email"]', EMAIL!);
  await page.fill('input[type="password"]', PASSWORD!);
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
}

/** Polls the DOM every 40ms and timestamps each transition. */
async function measureSwitch(page: Page,
  destination: { menu: RegExp; identity: RegExp },
  origin: { menu: RegExp; identity: RegExp }) {
  // Timestamp the activate response.
  let activateMs = -1;
  const t0 = Date.now();
  const onResp = (r: { url(): string; status(): number }) => {
    if (r.url().includes('/activate')) activateMs = Date.now() - t0;
  };
  page.on('response', onResp);

  await page.locator('.lm-biz-trigger').click();
  await page.locator('[role="menuitemradio"]', { hasText: destination.menu }).first().click();

  let headerMs = -1, contentMs = -1, overlayMs = -1, splitBrainMs = 0;
  let sample = '';
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const snap = await page.evaluate(() => ({
      header: (document.querySelector('.lm-biz-name') as HTMLElement | null)?.innerText ?? '',
      content: (document.querySelector('main') as HTMLElement | null)?.innerText ?? '',
      overlay: Boolean(document.querySelector('.lm-biz-overlay')),
    }));
    const now = Date.now() - t0;
    const headerIsDest = destination.menu.test(snap.header);
    const contentHasOrigin = origin.identity.test(snap.content);

    if (headerMs < 0 && headerIsDest) headerMs = now;
    if (contentMs < 0 && !contentHasOrigin && headerIsDest) contentMs = now;
    if (overlayMs < 0 && !snap.overlay && headerMs >= 0) overlayMs = now;

    // The defect window: destination chrome + origin content + no overlay.
    if (headerIsDest && contentHasOrigin && !snap.overlay) {
      splitBrainMs += 40;
      if (!sample) {
        const m = snap.content.match(new RegExp(`.{0,90}${origin.identity.source}.{0,90}`, 'i'));
        sample = m ? m[0].replace(/\s+/g, ' ') : '(not located)';
      }
    }

    if (headerMs >= 0 && contentMs >= 0 && overlayMs >= 0) break;
    await page.waitForTimeout(40);
  }
  page.off('response', onResp);
  return { activateMs, headerMs, contentMs, overlayMs, splitBrainMs, sample };
}

test('company switch timeline and split-brain window', async ({ page }) => {
  test.setTimeout(600_000);
  await login(page);
  await page.goto('/dashboard/brief');
  await page.waitForLoadState('networkidle');

  const runs: Array<Record<string, number>> = [];
  const samples: string[] = [];
  // A -> B -> A -> B -> A : four measured switches.
  const seq: Array<[typeof SENTINEL.allignx, typeof SENTINEL.allignx]> = [
    [SENTINEL.launchmind, SENTINEL.allignx],
    [SENTINEL.allignx, SENTINEL.launchmind],
    [SENTINEL.launchmind, SENTINEL.allignx],
    [SENTINEL.allignx, SENTINEL.launchmind],
  ];
  // Ensure we start on AllignX.
  await page.locator('.lm-biz-trigger').click();
  await page.locator('[role="menuitemradio"]', { hasText: SENTINEL.allignx.menu }).first().click();
  await page.waitForFunction(() => !document.body.innerText.includes('Switching'), { timeout: 30_000 });
  await page.waitForLoadState('networkidle');

  for (const [dest, orig] of seq) {
    const m = await measureSwitch(page, dest, orig);
    runs.push({ activateMs: m.activateMs, headerMs: m.headerMs, contentMs: m.contentMs,
                overlayMs: m.overlayMs, splitBrainMs: m.splitBrainMs });
    if (m.sample) samples.push(`-> ${dest.menu.source}: ${m.sample}`);
    console.log(`switch -> ${dest.menu.source}: activate=${m.activateMs}ms header=${m.headerMs}ms ` +
                `content=${m.contentMs}ms overlay=${m.overlayMs}ms SPLIT_BRAIN=${m.splitBrainMs}ms`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
  }

  const p = (key: string, q: number) => {
    const v = runs.map(r => r[key]).filter(n => n >= 0).sort((a, b) => a - b);
    return v.length ? v[Math.min(v.length - 1, Math.floor(q * v.length))] : -1;
  };
  console.log(`\nACTIVATE  p50=${p('activateMs', .5)}ms p95=${p('activateMs', .95)}ms`);
  console.log(`HEADER    p50=${p('headerMs', .5)}ms p95=${p('headerMs', .95)}ms`);
  console.log(`CONTENT   p50=${p('contentMs', .5)}ms p95=${p('contentMs', .95)}ms`);
  console.log(`OVERLAY   p50=${p('overlayMs', .5)}ms p95=${p('overlayMs', .95)}ms`);
  console.log(`SPLITBRAIN total per switch: ${runs.map(r => r.splitBrainMs).join(', ')}ms`);

  // THE ACCEPTANCE ASSERTION (Part 27): zero owner-visible mixed-business state.
  console.log('\nSTALE TEXT LOCATED DURING SPLIT-BRAIN:');
  samples.forEach(x => console.log('  ' + x));
  const worst = Math.max(...runs.map(r => r.splitBrainMs));
  expect(worst, `owner saw destination chrome with origin content for ${worst}ms`).toBe(0);
});
