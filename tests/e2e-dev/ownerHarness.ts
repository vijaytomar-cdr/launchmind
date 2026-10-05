/**
 * @file ownerHarness.ts
 * @description The browser-verification harness — B6.8B-R1 §2.
 *
 *   WHY THIS EXISTS. B6.7 and B6.8A reported 7/7 owner journeys that were
 *   measured against BLANK PAGES. Isolated Next instances on ports 3007/3011/
 *   3021 were rejected by backend CORS (`origin: http://localhost:3000`), so
 *   every API call failed and `main` rendered an error shell. The tests passed
 *   because nearly every assertion was an assertion of ABSENCE — no leaked
 *   enum, no provider name, no execution control, no horizontal overflow. All
 *   trivially true when there is nothing on the page.
 *
 *   THE RULE THIS ENCODES: a UX test may only assert what is missing AFTER it
 *   has proved what is present. `assertOwnerPageHealthy` is that proof, and it
 *   is designed to be impossible to satisfy on a blank or API-blocked page:
 *
 *     1. NETWORK — no owner API request may have failed or returned 4xx/5xx.
 *        Catches CORS rejection, which is otherwise invisible in the DOM.
 *     2. SUBSTANCE — `main` must carry real reading content.
 *     3. IDENTITY — a known persisted string for THIS owner must be present,
 *        so a generic skeleton or an error shell cannot pass.
 *
 *   Word count alone is deliberately NOT sufficient: an error page has words.
 *
 * @security Test-only. Reads the page; changes nothing.
 */

import { expect, type Page, type Request, type Response } from '@playwright/test';

/** Requests LaunchMind's own API made, and how they went. */
export interface ApiTrace {
  failed: string[];
  bad: Array<{ url: string; status: number }>;
  ok: number;
}

/**
 * Starts recording owner-API traffic. Call BEFORE navigating.
 *
 * A CORS rejection surfaces as `requestfailed`, never as a DOM change, so this
 * is the only place the blank-page failure mode is observable.
 */
export function traceApi(
  page: Page,
  // Derived from the same env the app uses, so an isolated CORS-matched pair
  // is traced correctly. Hardcoding :3001 made the trace blind on any other
  // port and reported "no API call succeeded" for a perfectly healthy page.
  apiOrigin = new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').host,
): ApiTrace {
  const trace: ApiTrace = { failed: [], bad: [], ok: 0 };
  page.on('requestfailed', (r: Request) => {
    if (!r.url().includes(apiOrigin)) return;
    const why = r.failure()?.errorText ?? 'failed';
    // ERR_ABORTED IS NOT A FAILURE. The browser cancels in-flight requests when
    // the page navigates, and login navigates twice — so treating it as fatal
    // made the POSITIVE control fail against a perfectly healthy page. A CORS
    // rejection is ERR_FAILED, which stays fatal.
    //
    // The blocked-page case is still caught: it fails the substance and
    // identity arms as well, which is why the health check has three.
    if (/ERR_ABORTED/i.test(why)) return;
    trace.failed.push(`${r.url()} — ${why}`);
  });
  page.on('response', (r: Response) => {
    if (!r.url().includes(apiOrigin)) return;
    if (r.status() >= 400) trace.bad.push({ url: r.url(), status: r.status() });
    else trace.ok++;
  });
  return trace;
}

export interface HealthOptions {
  /** Strings that only the loaded, authenticated page can contain. */
  mustContain: readonly (string | RegExp)[];
  /** Minimum reading content in `main`. Not a quality bar — a liveness bar. */
  minWords?: number;
  trace?: ApiTrace;
  /**
   * Require at least one SUCCESSFUL browser→API call.
   *
   * Opt-in, because not every owner surface fetches from the browser: Content
   * Studio renders server-side and makes no call to :3001 at all, so demanding
   * one failed a healthy page. Set true for client-fetching surfaces — on those
   * it is the arm that catches a CORS rejection, which is invisible in the DOM.
   *
   * Where it is false, liveness is still proved by the substance and identity
   * arms, which a blank or error page cannot satisfy.
   */
  requireApiSuccess?: boolean;
}

/** What `main` actually says, and how much of it there is. */
export async function mainText(page: Page): Promise<{ text: string; words: number }> {
  return page.evaluate(() => {
    const t = (document.querySelector('main') as HTMLElement | null)?.innerText ?? '';
    return { text: t, words: t.split(/\s+/).filter(Boolean).length };
  });
}

/**
 * THE PRECONDITION. Every UX assertion in this suite runs after this passes.
 *
 * @throws when the page is blank, API-blocked, an error shell, or missing the
 *   owner's own persisted content.
 */
export async function assertOwnerPageHealthy(page: Page, opts: HealthOptions): Promise<void> {
  // 1. NETWORK — the failure mode that produced the invalid results.
  if (opts.trace) {
    expect(opts.trace.failed,
      `owner API requests failed (CORS or network): ${opts.trace.failed.join(' | ')}`)
      .toEqual([]);
    expect(opts.trace.bad.map(b => `${b.status} ${b.url}`),
      'owner API returned an error status').toEqual([]);
    if (opts.requireApiSuccess) {
      expect(opts.trace.ok, 'no owner API call succeeded — the page has no data')
        .toBeGreaterThan(0);
    }
  }

  // 2. SUBSTANCE.
  const { text, words } = await mainText(page);
  expect(words, `main has too little content (${words} words) — page is blank or an error shell`)
    .toBeGreaterThanOrEqual(opts.minWords ?? 60);

  // 3. IDENTITY — a generic skeleton cannot fake this.
  for (const needle of opts.mustContain) {
    if (typeof needle === 'string') {
      expect(text, `expected owner content missing: "${needle}"`).toContain(needle);
    } else {
      expect(text, `expected owner content missing: ${needle}`).toMatch(needle);
    }
  }
}

/** Login. Shared so every spec authenticates identically. */
export async function loginAsOwner(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email/i).first().fill(email);
  await page.getByLabel(/password/i).first().fill(password);
  await page.getByRole('button', { name: /log in/i }).click();
  // Hosted auth can complete just beyond 45s even when the credential request
  // succeeds (observed server-action redirects at 44.9–45.1s). This is only the
  // login precondition; page/API health remains independently gated below.
  await page.waitForURL(/\/dashboard/, { timeout: 75_000 });
}

/** Waits for client-side data rather than for a clock. */
export async function waitForOwnerContent(page: Page, minWords = 60): Promise<void> {
  await page.waitForFunction(
    (n) => ((document.querySelector('main') as HTMLElement | null)?.innerText ?? '')
      .split(/\s+/).filter(Boolean).length >= n,
    minWords, { timeout: 45_000 }).catch(() => { /* assertion reports it */ });
}

/** First-viewport density. Reported, never used as a pass/fail quality score. */
export async function density(page: Page) {
  return page.evaluate(() => {
    const vh = window.innerHeight;
    const vis = (el: Element) => {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05) return false;
      const r = el.getBoundingClientRect();
      return r.top < vh && r.bottom > 0 && r.height > 0 && r.width > 0;
    };
    const all = [...document.querySelectorAll('main *')].filter(vis);
    return {
      blocks: all.filter(e => {
        const s = getComputedStyle(e);
        return (parseFloat(s.borderTopWidth) > 0 || s.boxShadow !== 'none')
          && e.getBoundingClientRect().height > 40;
      }).length,
      paragraphs: all.filter(e => e.tagName === 'P'
        && (e.textContent ?? '').trim().length > 30).length,
      eyebrows: all.filter(e => {
        const s = getComputedStyle(e);
        return s.textTransform === 'uppercase' && parseFloat(s.fontSize) <= 12
          && (e.textContent ?? '').trim().length > 0 && e.children.length === 0;
      }).length,
      words: all.filter(e => e.children.length === 0)
        .map(e => (e.textContent ?? '').trim()).join(' ').split(/\s+/).filter(Boolean).length,
      primaryActions: all.filter(e => {
        if (!(e.tagName === 'BUTTON' || e.tagName === 'A')) return false;
        const bg = getComputedStyle(e).backgroundColor;
        return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'
          && !bg.startsWith('rgb(255, 255, 255)') && e.getBoundingClientRect().height > 26;
      }).length,
    };
  });
}
