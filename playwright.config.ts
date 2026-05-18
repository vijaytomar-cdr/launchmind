/**
 * @file playwright.config.ts
 * @description Playwright E2E configuration.
 *
 * Two projects:
 *   "api"      — tests/e2e/api.spec.ts only — pure HTTP (request fixture).
 *                Runnable whenever the Fastify API is up. No browser, no Next.js needed.
 *   "browser"  — tests/e2e/sanity.spec.ts — full browser tests, requires Next.js dev server.
 *
 * Commands:
 *   npx playwright test --project=api        # API smoke (always available)
 *   SKIP_WEB_SERVER=1 npx playwright test    # skip Next.js auto-start
 *   npx playwright test                      # starts Next.js, runs everything
 */

import { defineConfig, devices } from '@playwright/test';

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
    baseURL: 'http://localhost:3000',
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
