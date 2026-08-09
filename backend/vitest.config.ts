/**
 * @file backend/vitest.config.ts
 * @description Backend test config.
 *
 *   `root` is pinned to this directory so suites that resolve paths relative to the
 *   process cwd behave identically whether they are launched from `backend/` or from
 *   the repository root. executionBoundary.test.ts reads source files off disk to
 *   prove the AI layer imports no permission or execution module; before this it
 *   found nothing when run from the root and failed with "expected 0 to be greater
 *   than 0" — a self-protecting guard doing its job, but for the wrong reason.
 *
 *   Suites are split into projects so a targeted run is one flag rather than a
 *   remembered list of filenames. See AGENTS.md.
 */

import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

const HERE = resolve(__dirname);

export default defineConfig({
  root: HERE,
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'dist/**'],
    environment: 'node',
    // Real-Postgres suites talk to a container; the default 5s is tight for setup.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
