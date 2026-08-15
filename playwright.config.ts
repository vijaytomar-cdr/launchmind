/**
 * @file playwright.config.ts
 * @description Playwright E2E configuration.
 *
 * Three projects:
 *   "api"        — tests/e2e/api.spec.ts only — pure HTTP (request fixture).
 *                  Runnable whenever the Fastify API is up. No browser, no Next.js needed.
 *   "browser"    — tests/e2e/sanity.spec.ts — full browser smoke tests, requires Next.js dev server.
 *   "regression" — tests/e2e/regression.spec.ts — full regression suite, requires Next.js + Supabase.
 *                  Uses TEST_EMAIL / TEST_PASSWORD env vars for authenticated flows.
 *
 * Commands:
 *   npx playwright test --project=api        # API smoke (always available)
 *   npx playwright test --project=browser    # Sanity smoke (needs Next.js)
 *   npx playwright test --project=regression # Full regression (needs Next.js + valid Supabase session)
 *   SKIP_WEB_SERVER=1 npx playwright test    # skip Next.js auto-start
 *   npx playwright test                      # starts Next.js, runs everything
 */

import { defineConfig, devices } from '@playwright/test';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local so TEST_EMAIL / TEST_PASSWORD / TEST_TOTP_SECRET are available
// to test files at runtime — Playwright does not auto-load .env.local.
const envLocalPath = resolve(__dirname, '.env.local');
if (existsSync(envLocalPath)) {
  for (const line of readFileSync(envLocalPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

const skipWebServer = !!process.env.SKIP_WEB_SERVER;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    // Env-overridable so a run can target a server on another port when 3000 is
    // already taken by a dev server.
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    headless: true,
  },

  projects: [
    {
      name: 'api',
      testMatch: '**/api.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'browser',
      testMatch: '**/sanity.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'regression',
      testMatch: '**/regression.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Visual regression against LaunchMind_Production_UX_July18_2026(21).html.
      // Token-parity assertions run without credentials; screenshot baselines need
      // TEST_EMAIL / TEST_PASSWORD and skip themselves otherwise.
      name: 'visual',
      testMatch: '**/*.visual.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        // Deterministic rendering for stable snapshots.
        deviceScaleFactor: 1,
        colorScheme: 'light',
      },
    },
    {
      // Active-business isolation certification against the REAL two-business
      // account. Needs TEST_EMAIL / TEST_PASSWORD; skips itself otherwise.
      name: 'cert',
      testMatch: '**/*.cert.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: skipWebServer
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 90_000,
      },
});
