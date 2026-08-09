/**
 * @file vitest.config.ts
 * @description Root Vitest config — FRONTEND unit tests only.
 *
 *   Without a config, `npx vitest run` from the repository root swept up
 *   `tests/e2e/*.spec.ts` (Playwright specs, which cannot run under Vitest) and
 *   `backend/tests/**` (which need the backend's own cwd and mocks). That produced
 *   7 failing files that had nothing to do with the code under test, and it hid a
 *   real cwd bug in backend/tests/executionBoundary.ts behind the noise.
 *
 *   Backend tests have their own config (backend/vitest.config.ts) and are run from
 *   `backend/`. Playwright specs are run by Playwright. See AGENTS.md for the
 *   canonical commands.
 */

import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    // Frontend unit tests live beside the code they cover.
    include: ['lib/**/*.test.ts', 'lib/**/*.test.tsx', 'components/**/*.test.tsx'],
    exclude: [
      '**/node_modules/**',
      '**/.next/**',
      'tests/e2e/**',      // Playwright — different runner entirely
      'backend/**',        // has its own config and cwd expectations
    ],
    environment: 'node',
    globals: false,
  },
  resolve: {
    alias: { '@': resolve(__dirname, '.') },
  },
});
