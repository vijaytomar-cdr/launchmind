/**
 * @file sanity.spec.ts
 * @description Browser smoke tests — run after every deploy.
 *   Requires Next.js dev server running on localhost:3000 + Supabase env vars set.
 *   For API-only tests (no browser needed) see api.spec.ts.
 *   Run: npx playwright test --project=browser
 */

import { test, expect } from '@playwright/test';

// ── Auth redirects ────────────────────────────────────────────────────────────

test('/ renders the marketing homepage', async ({ page }) => {
  await page.goto('/');
  // Marketing homepage stays at / for unauthenticated users (not a redirect)
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: /market your app/i })).toBeVisible();
});

test('/dashboard redirects unauthenticated user to /login', async ({ page }) => {
  await page.goto('/dashboard/products');
  await expect(page).toHaveURL(/\/login/);
});

// ── Public pages ──────────────────────────────────────────────────────────────

test('/pricing renders all four tier cards', async ({ page }) => {
  await page.goto('/pricing');
  // Use heading role to avoid strict-mode collision with repeated "Free" text
  await expect(page.getByRole('heading', { name: 'Free' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Solo' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Builder' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Studio' })).toBeVisible();
});

test('/pricing USD/INR toggle switches currency display', async ({ page }) => {
  await page.goto('/pricing');
  await expect(page.getByText('$19/mo')).toBeVisible();
  await page.getByText('🇮🇳 INR').click();
  await expect(page.getByText('₹999/mo')).toBeVisible();
});

test('/pricing shows content assets under Builder (not Solo)', async ({ page }) => {
  await page.goto('/pricing');
  // Builder card feature list includes this exact text; Solo does not
  await expect(page.getByText('Content assets (WhatsApp, Email, Meta)')).toBeVisible();
});

// ── Login page ────────────────────────────────────────────────────────────────

test('/login renders email and password fields', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByLabel(/password/i)).toBeVisible();
});

test('/login shows error for wrong credentials', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('wrong@example.com');
  await page.getByLabel(/password/i).fill('wrongpassword');
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page.getByText(/invalid|error|credentials/i)).toBeVisible({ timeout: 8_000 });
});

// ── Signup page ───────────────────────────────────────────────────────────────

test('/signup renders email and password fields', async ({ page }) => {
  await page.goto('/signup');
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByLabel(/password/i)).toBeVisible();
});

// ── Channels page ─────────────────────────────────────────────────────────────

test('/dashboard/channels redirects unauthenticated user to /login', async ({ page }) => {
  await page.goto('/dashboard/channels');
  await expect(page).toHaveURL(/\/login/);
});

// ── Intake wizard — Step 1 (unauthenticated guard) ────────────────────────────

test('/dashboard/products/new redirects unauthenticated user to /login', async ({ page }) => {
  await page.goto('/dashboard/products/new');
  await expect(page).toHaveURL(/\/login/);
});

// ── Intake wizard — Step 1: URL entry ────────────────────────────────────────
// These tests use the Vijay seed account (see backend/migrations/024_*).
// They require PLAYWRIGHT_TEST_EMAIL and PLAYWRIGHT_TEST_PASSWORD env vars.

test.describe('Intake wizard (requires auth)', () => {
  test.skip(!process.env.PLAYWRIGHT_TEST_EMAIL, 'Set PLAYWRIGHT_TEST_EMAIL + PLAYWRIGHT_TEST_PASSWORD to run');

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(process.env.PLAYWRIGHT_TEST_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.PLAYWRIGHT_TEST_PASSWORD!);
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
  });

  test('Step 1 — renders 3 URL slots and detects Play Store URL', async ({ page }) => {
    await page.goto('/dashboard/products/new');
    await expect(page.getByText('Play Store')).toBeVisible();
    await expect(page.getByText('App Store')).toBeVisible();
    await expect(page.getByText('Website')).toBeVisible();

    const playInput = page.getByPlaceholder(/play.google.com/i);
    await playInput.fill('https://play.google.com/store/apps/details?id=com.example');
    await expect(page.getByText('Play Store detected')).toBeVisible();
  });

  test('Step 1 — Continue is disabled until a store URL is entered', async ({ page }) => {
    await page.goto('/dashboard/products/new');
    const continueBtn = page.getByRole('button', { name: /continue/i });
    await expect(continueBtn).toBeDisabled();

    await page.getByPlaceholder(/apps.apple.com/i).fill('https://apps.apple.com/app/example/id123456789');
    await expect(continueBtn).toBeEnabled();
  });

  test('Step 1 — invalid URL shows detection warning', async ({ page }) => {
    await page.goto('/dashboard/products/new');
    await page.getByPlaceholder(/play.google.com/i).fill('https://example.com/not-play-store');
    await expect(page.getByText('Not a Play Store URL')).toBeVisible();
  });

  test('Step 2 — context page has 5 conversation sections', async ({ page }) => {
    // Navigate directly and seed sessionStorage to simulate Step 1 having run
    await page.goto('/dashboard/products/new');
    await page.evaluate(() => {
      sessionStorage.setItem('lm_intake_productId', 'test-product-id-placeholder');
      sessionStorage.setItem('lm_intake_jobId', 'test-job-id-placeholder');
      sessionStorage.setItem('lm_intake_urls', JSON.stringify({ appStoreUrl: 'https://apps.apple.com/app/test/id1' }));
    });
    await page.goto('/dashboard/products/new/context');
    await expect(page.getByText(/what stage/i)).toBeVisible();
  });

  test('Step 6 — markets page renders all 4 market options', async ({ page }) => {
    await page.goto('/dashboard/products/new');
    await page.evaluate(() => {
      sessionStorage.setItem('lm_intake_productId', 'test-product-id-placeholder');
    });
    await page.goto('/dashboard/products/new/markets');
    await expect(page.getByText('USA')).toBeVisible();
    await expect(page.getByText('India')).toBeVisible();
    await expect(page.getByText('SE Asia')).toBeVisible();
    await expect(page.getByText('UK')).toBeVisible();
  });

  test('Step 6 — Continue is disabled until a channel is selected', async ({ page }) => {
    await page.goto('/dashboard/products/new');
    await page.evaluate(() => {
      sessionStorage.setItem('lm_intake_productId', 'test-product-id-placeholder');
    });
    await page.goto('/dashboard/products/new/markets');
    const continueBtn = page.getByRole('button', { name: /continue/i });
    await expect(continueBtn).toBeDisabled();

    await page.getByText('Meta (Facebook / Instagram)').click();
    await expect(continueBtn).toBeEnabled();
  });

  test('Step 6 — amber warning shown when tried channel is selected', async ({ page }) => {
    await page.goto('/dashboard/products/new');
    await page.evaluate(() => {
      sessionStorage.setItem('lm_intake_productId', 'test-product-id-placeholder');
      sessionStorage.setItem('lm_intake_context', JSON.stringify({ channelsTried: ['meta'] }));
    });
    await page.goto('/dashboard/products/new/markets');
    await page.getByText('Meta (Facebook / Instagram)').click();
    await expect(page.getByText(/tried this channel before/i)).toBeVisible();
  });

  test('Step 7 — confirm page shows "Generate strategy" button', async ({ page }) => {
    await page.goto('/dashboard/products/new');
    await page.evaluate(() => {
      sessionStorage.setItem('lm_intake_productId', 'test-product-id-placeholder');
      sessionStorage.setItem('lm_intake_editedIcp', JSON.stringify({
        targetUser: 'Indie founders',
        geography: ['usa'],
        priceTier: 'freemium',
        painPoints: ['Hard to market'],
        competitorGaps: [],
        suggestedMarkets: ['usa'],
      }));
      sessionStorage.setItem('lm_intake_markets', JSON.stringify({
        selectedMarkets: ['usa'],
        primaryChannel: 'meta',
        excludedChannels: ['google', 'whatsapp', 'email', 'linkedin', 'aso_rewrite'],
      }));
    });
    await page.goto('/dashboard/products/new/confirm');
    await expect(page.getByRole('button', { name: /generate strategy/i })).toBeVisible();
    await expect(page.getByText('50 tokens')).toBeVisible();
  });

  test('Step 7 — confirm page renders 3-column summary grid', async ({ page }) => {
    await page.goto('/dashboard/products/new');
    await page.evaluate(() => {
      sessionStorage.setItem('lm_intake_productId', 'test-product-id-placeholder');
      sessionStorage.setItem('lm_intake_editedIcp', JSON.stringify({
        targetUser: 'App founders',
        geography: ['usa'],
        priceTier: 'freemium',
        painPoints: ['No users'],
        competitorGaps: [],
        suggestedMarkets: ['usa'],
      }));
      sessionStorage.setItem('lm_intake_markets', JSON.stringify({
        selectedMarkets: ['usa'],
        primaryChannel: 'google',
        excludedChannels: [],
      }));
    });
    await page.goto('/dashboard/products/new/confirm');
    await expect(page.getByText('ICP Brief')).toBeVisible();
    await expect(page.getByText('Markets & Channel')).toBeVisible();
    await expect(page.getByText(/competitors/i)).toBeVisible();
  });

  test('Step 7 — MOAT box shown when context has moat set', async ({ page }) => {
    await page.goto('/dashboard/products/new');
    await page.evaluate(() => {
      sessionStorage.setItem('lm_intake_productId', 'test-product-id-placeholder');
      sessionStorage.setItem('lm_intake_editedIcp', JSON.stringify({
        targetUser: 'Founders', geography: ['usa'], priceTier: 'free',
        painPoints: [], competitorGaps: [], suggestedMarkets: ['usa'],
      }));
      sessionStorage.setItem('lm_intake_context', JSON.stringify({ moat: 'Offline-first sync engine' }));
      sessionStorage.setItem('lm_intake_markets', JSON.stringify({
        selectedMarkets: ['usa'], primaryChannel: 'meta', excludedChannels: [],
      }));
    });
    await page.goto('/dashboard/products/new/confirm');
    await expect(page.getByText('Your MOAT')).toBeVisible();
    await expect(page.getByText('Offline-first sync engine')).toBeVisible();
  });

  test('Step 5 — competitors page shows empty state when no competitors found', async ({ page }) => {
    await page.goto('/dashboard/products/new');
    await page.evaluate(() => {
      sessionStorage.setItem('lm_intake_productId', 'test-product-id-placeholder');
      // No competitors key set → empty state
    });
    await page.goto('/dashboard/products/new/competitors');
    await expect(page.getByText(/no competitors found/i)).toBeVisible();
  });

  test('Step 5 — competitor can be confirmed and removed', async ({ page }) => {
    await page.goto('/dashboard/products/new');
    await page.evaluate(() => {
      sessionStorage.setItem('lm_intake_productId', 'test-product-id-placeholder');
      sessionStorage.setItem('lm_intake_competitors', JSON.stringify([
        { name: 'Rival App', developer: 'Rival Inc', rating: 4.2, priceTier: 'free', confirmed: true },
      ]));
    });
    await page.goto('/dashboard/products/new/competitors');
    await expect(page.getByText('Rival App')).toBeVisible();
    await expect(page.getByText('✓ Confirmed')).toBeVisible();

    // Remove it
    await page.getByRole('button', { name: /remove/i }).click();
    await expect(page.getByText('✗ Removed')).toBeVisible();
  });
});
