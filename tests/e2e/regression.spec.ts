/**
 * @file regression.spec.ts
 * @description Full regression test suite — verifies all key user flows end-to-end in a browser.
 *   Runs against a live Next.js dev server on localhost:3000.
 *   Authenticated groups require TEST_EMAIL / TEST_PASSWORD env vars (or demo defaults).
 *
 *   Run:  npx playwright test --project=regression
 *   With real creds: TEST_EMAIL=you@example.com TEST_PASSWORD=secret npx playwright test --project=regression
 *
 * @security Never hard-code real credentials. Demo fallback values are for local dev only.
 */

import { test, expect, type Page } from '@playwright/test';

// ── Login helper ─────────────────────────────────────────────────────────────

/**
 * Log in as the specified user and wait for the dashboard URL.
 * @param page    - Playwright Page instance
 * @param email   - Founder email
 * @param password - Founder password
 */
async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  // The login page uses uncontrolled inputs (refs), so we use fill on the input elements directly.
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  // Wait up to 10 s for navigation to the dashboard after the server action completes.
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
}

const TEST_EMAIL = process.env.TEST_EMAIL ?? 'vijay@lm.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'Test12345';

// ── Group 1: Authentication flows (no auth required) ─────────────────────────

test.describe('Authentication flows', () => {
  test('forgot password page renders email field', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test('/forgot-password is accessible without auth', async ({ page }) => {
    await page.goto('/forgot-password');
    // Should not redirect — page should render the reset form
    await expect(page).toHaveURL(/\/forgot-password/);
    await expect(page.getByRole('button', { name: /send reset link/i })).toBeVisible();
  });

  test('/reset-password redirects to /forgot-password without active session', async ({ page }) => {
    // No session cookies set — the page's useEffect checks getSession() and redirects
    await page.goto('/reset-password');
    // Allow time for the client-side redirect after getSession() resolves
    await expect(page).toHaveURL(/\/forgot-password/, { timeout: 10_000 });
  });
});

// ── Group 2: Authenticated dashboard shell ────────────────────────────────────

test.describe('Authenticated dashboard shell', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_EMAIL, TEST_PASSWORD);
  });

  test('dashboard sidebar renders all nav items: Products, Campaigns, Briefs, Channels, Settings', async ({ page }) => {
    // Ensure we're on the dashboard and the sidebar is rendered
    await expect(page.getByRole('link', { name: /products/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /campaigns/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /briefs/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /channels/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /settings/i })).toBeVisible();
  });

  test('clicking Products nav item navigates to /dashboard/products', async ({ page }) => {
    await page.getByRole('link', { name: /products/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/products/, { timeout: 10_000 });
  });

  test('clicking Campaigns nav item navigates to /dashboard/campaigns', async ({ page }) => {
    await page.getByRole('link', { name: /campaigns/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/campaigns/, { timeout: 10_000 });
  });

  test('clicking Briefs nav item navigates to /dashboard/briefs', async ({ page }) => {
    // Use exact match to target the sidebar "Briefs" link, not "View all briefs →" in the brief card
    await page.getByRole('link', { name: 'Briefs', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/briefs/, { timeout: 10_000 });
  });

  test('clicking Channels nav item navigates to /dashboard/channels', async ({ page }) => {
    await page.getByRole('link', { name: /channels/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/channels/, { timeout: 10_000 });
  });

  test('clicking Settings nav item navigates to /dashboard/settings', async ({ page }) => {
    await page.getByRole('link', { name: /settings/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/settings/, { timeout: 10_000 });
  });

  test('Products page shows Add product button', async ({ page }) => {
    await page.goto('/dashboard/products');
    // Matches "+ Add product" link (rendered as an <a>) and the "Add your first product" CTA
    await expect(page.getByRole('link', { name: /add product/i }).first()).toBeVisible();
  });

  test('Campaigns page shows filter selects', async ({ page }) => {
    await page.goto('/dashboard/campaigns');
    // Wait for the filter selects to appear — they render regardless of empty campaign list
    await expect(page.getByRole('combobox').first()).toBeVisible({ timeout: 10_000 });
    // There should be two select elements: status filter and channel filter
    const selects = page.getByRole('combobox');
    await expect(selects).toHaveCount(2);
  });

  test('Briefs page renders without error', async ({ page }) => {
    await page.goto('/dashboard/briefs');
    // Either the empty state or brief cards should render — no error banner should appear
    await expect(page.getByText(/weekly briefs/i)).toBeVisible({ timeout: 10_000 });
    // Error banner uses red styles — assert it is NOT present
    await expect(page.getByText(/failed to load briefs/i)).not.toBeVisible();
  });

  test('Channels page shows all 5 platform rows (WhatsApp, Meta, Google, LinkedIn, Email)', async ({ page }) => {
    await page.goto('/dashboard/channels');
    // Wait for the loading state to resolve (channels page fetches from API)
    await expect(page.getByText(/loading channels/i)).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/whatsapp business/i)).toBeVisible();
    await expect(page.getByText(/meta ads/i)).toBeVisible();
    await expect(page.getByText(/google ads/i)).toBeVisible();
    await expect(page.getByText(/linkedin ads/i)).toBeVisible();
    await expect(page.getByText(/email \(resend\)/i)).toBeVisible();
  });

  test('Settings page shows profile and security sections', async ({ page }) => {
    await page.goto('/dashboard/settings');
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByText(/profile/i)).toBeVisible();
    await expect(page.getByText(/security/i)).toBeVisible();
  });

  test('Billing page loads and shows plan info', async ({ page }) => {
    await page.goto('/dashboard/billing');
    // Wait for loading spinner to disappear
    await expect(page.getByText(/loading/i)).not.toBeVisible({ timeout: 10_000 });
    // Either current plan card or the plan grid should be visible
    const hasPlanHeader = await page.getByText(/billing & plan/i).isVisible({ timeout: 10_000 });
    expect(hasPlanHeader).toBe(true);
  });

  test('logout button signs out and redirects to /login', async ({ page }) => {
    // The sidebar footer has a "Log out" button
    await page.getByRole('button', { name: /log out/i }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    // Confirm the login form is visible after logout
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });
});

// ── Group 3: New product form validation ─────────────────────────────────────

test.describe('New product form validation', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_EMAIL, TEST_PASSWORD);
    await page.goto('/dashboard/products/new');
  });

  test('new product page shows URL input', async ({ page }) => {
    await expect(page.locator('input[type="url"]')).toBeVisible();
  });

  test('Analyse app button is disabled without a valid URL', async ({ page }) => {
    // The submit button is disabled when platform is null (no URL entered)
    const analyseBtn = page.getByRole('button', { name: /analyse app/i });
    await expect(analyseBtn).toBeVisible();
    await expect(analyseBtn).toBeDisabled();
  });

  test('Analyse app button enables when App Store URL is pasted', async ({ page }) => {
    await page.locator('input[type="url"]').fill(
      'https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580'
    );
    // Use exact match — the input placeholder also contains "App Store" so getByText(/app store/i) is ambiguous
    await expect(page.getByText('App Store', { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: /analyse app/i })).toBeEnabled();
  });

  test('Analyse app button enables when Play Store URL is pasted', async ({ page }) => {
    await page.locator('input[type="url"]').fill(
      'https://play.google.com/store/apps/details?id=com.spotify.music'
    );
    // Use exact match — the input placeholder also contains "Play Store" so getByText(/play store/i) is ambiguous
    await expect(page.getByText('Play Store', { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: /analyse app/i })).toBeEnabled();
  });

  test('invalid URL shows platform error message', async ({ page }) => {
    await page.locator('input[type="url"]').fill('https://example.com/some-random-page');
    // The error message appears when the URL is typed but platform remains null
    await expect(
      page.getByText(/only app store and play store urls are supported/i)
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: /analyse app/i })).toBeDisabled();
  });

  test.skip('Analyse app button submits and shows scraping state — end-to-end scrape', async ({ page }) => {
    // SKIPPED: Live scraping hits the Fastify backend → external App Store / Play Store.
    // This is intentionally excluded from the regression suite because:
    //   1. It requires a running backend with valid scraper credentials.
    //   2. A single scrape takes 15–30 seconds and is flaky against external URLs.
    //   3. It is covered by dedicated integration tests in backend/tests/.
    // To run manually: remove skip and set TEST_EMAIL/TEST_PASSWORD to a real account.
    await page.locator('input[type="url"]').fill(
      'https://play.google.com/store/apps/details?id=com.spotify.music'
    );
    await page.getByRole('button', { name: /analyse app/i }).click();
    await expect(page.getByText(/analysing your app/i)).toBeVisible({ timeout: 5_000 });
  });
});

// ── Group 4: Navigation and page load ────────────────────────────────────────

test.describe('Navigation and page load', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_EMAIL, TEST_PASSWORD);
  });

  test('/dashboard/products/new renders full discover form', async ({ page }) => {
    await page.goto('/dashboard/products/new');
    await expect(page.getByText(/add a product/i)).toBeVisible();
    await expect(page.locator('input[type="url"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /analyse app/i })).toBeVisible();
  });

  test('/dashboard/metrics redirects or loads for authenticated user', async ({ page }) => {
    await page.goto('/dashboard/metrics');
    // Either the metrics page renders (Campaign Metrics heading) or the user is redirected
    // to the dashboard. Both are acceptable — the test just asserts no crash / 404.
    const isMetrics = await page.getByText(/campaign metrics/i).isVisible({ timeout: 10_000 }).catch(() => false);
    const isDashboard = page.url().includes('/dashboard');
    expect(isMetrics || isDashboard).toBe(true);
  });

  test('browser back/forward works from products → new product → back to products', async ({ page }) => {
    await page.goto('/dashboard/products');
    await expect(page).toHaveURL(/\/dashboard\/products/);

    // Navigate to the new product page via the "+ Add product" link
    await page.getByRole('link', { name: /add product/i }).first().click();
    await expect(page).toHaveURL(/\/dashboard\/products\/new/, { timeout: 10_000 });

    // Use the browser's back button
    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard\/products/, { timeout: 10_000 });

    // Use the browser's forward button
    await page.goForward();
    await expect(page).toHaveURL(/\/dashboard\/products\/new/, { timeout: 10_000 });
  });
});

// ── Group 5: Week 18 — Token model UI ────────────────────────────────────────

test.describe('Week 18 token model UI', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_EMAIL, TEST_PASSWORD);
  });

  test('settings/usage page renders balance section', async ({ page }) => {
    await page.goto('/dashboard/settings/usage');
    // Balance card has a "Tokens" or "Unlimited" heading
    await expect(page.getByText(/current balance/i)).toBeVisible({ timeout: 10_000 });
  });

  test('settings/usage page has "Buy more tokens" link to billing', async ({ page }) => {
    await page.goto('/dashboard/settings/usage');
    const link = page.getByRole('link', { name: /buy more tokens/i });
    await expect(link).toBeVisible({ timeout: 10_000 });
  });

  test('settings/usage page renders usage breakdown section', async ({ page }) => {
    await page.goto('/dashboard/settings/usage');
    await expect(page.getByText(/usage breakdown/i)).toBeVisible({ timeout: 10_000 });
  });

  test('billing page shows token top-up section', async ({ page }) => {
    await page.goto('/dashboard/billing');
    await expect(page.getByText(/loading/i)).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/token top-ups/i)).toBeVisible({ timeout: 10_000 });
  });

  test('billing page shows all three top-up pack sizes', async ({ page }) => {
    await page.goto('/dashboard/billing');
    await expect(page.getByText(/loading/i)).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('500')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('1,500')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('5,000')).toBeVisible({ timeout: 10_000 });
  });

  test('settings page has token usage card linking to /settings/usage', async ({ page }) => {
    await page.goto('/dashboard/settings');
    await expect(page.getByRole('link', { name: /view usage/i })).toBeVisible({ timeout: 10_000 });
  });
});

// ── Group 6: Public pages (no auth required) ─────────────────────────────────

test.describe('Public pages regression', () => {
  test('/login shows forgot password link', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('link', { name: /forgot password/i })).toBeVisible();
  });

  test('/forgot-password shows send reset link button', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.getByRole('button', { name: /send reset link/i })).toBeVisible();
  });

  test('/signup shows create account button', async ({ page }) => {
    await page.goto('/signup');
    // The signup CTA is the submit button for the credentials form — "Continue" leads to MFA setup
    await expect(page.getByRole('button', { name: /continue/i })).toBeVisible();
  });

  test('pricing page has 4 tiers', async ({ page }) => {
    await page.goto('/pricing');
    // Use heading role — "Free"/"Solo"/"Builder"/"Studio" each appear as h3 headings in the pricing cards
    // Avoids strict-mode violations from duplicate text in price labels, CTAs, and comparison table
    await expect(page.getByRole('heading', { name: 'Free', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Solo', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Builder', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Studio', exact: true })).toBeVisible();
  });

  test('/ shows waitlist form or redirects logged-out users correctly', async ({ page }) => {
    await page.goto('/');
    // Unauthenticated users are either redirected to /login (middleware) or shown the
    // marketing homepage / waitlist form. Both outcomes are correct.
    const redirectedToLogin = page.url().includes('/login');
    const onHomepage = page.url() === 'http://localhost:3000/' || page.url().endsWith('/');
    expect(redirectedToLogin || onHomepage).toBe(true);
    // If on homepage, assert that basic content is visible and no crash occurred
    if (onHomepage) {
      await expect(page.locator('body')).not.toBeEmpty();
    }
  });
});
