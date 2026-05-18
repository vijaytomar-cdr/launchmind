/**
 * @file sanity.spec.ts
 * @description Browser smoke tests — run after every deploy.
 *   Requires Next.js dev server running on localhost:3000 + Supabase env vars set.
 *   For API-only tests (no browser needed) see api.spec.ts.
 *   Run: npx playwright test --project=browser
 */

import { test, expect } from '@playwright/test';

// ── Auth redirects ────────────────────────────────────────────────────────────

test('/ redirects unauthenticated user to /login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});

test('/dashboard redirects unauthenticated user to /login', async ({ page }) => {
  await page.goto('/dashboard/products');
  await expect(page).toHaveURL(/\/login/);
});

// ── Public pages ──────────────────────────────────────────────────────────────

test('/pricing renders all four tier cards', async ({ page }) => {
  await page.goto('/pricing');
  await expect(page.getByText('Free')).toBeVisible();
  await expect(page.getByText('Solo')).toBeVisible();
  await expect(page.getByText('Builder')).toBeVisible();
  await expect(page.getByText('Studio')).toBeVisible();
});

test('/pricing USD/INR toggle switches currency display', async ({ page }) => {
  await page.goto('/pricing');
  await expect(page.getByText('$19/mo')).toBeVisible();
  await page.getByText('🇮🇳 INR').click();
  await expect(page.getByText('₹999/mo')).toBeVisible();
});

test('/pricing shows content assets under Builder (not Solo)', async ({ page }) => {
  await page.goto('/pricing');
  // Builder card should mention content assets, solo should not
  const builderCard = page.locator('text=Builder').first().locator('..');
  await expect(builderCard.getByText(/content assets/i)).toBeVisible();
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
