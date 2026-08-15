/**
 * @file guard-dev-dist.mjs
 * @description Removes production build artifacts from `.next` before `next dev`
 *   starts.
 *
 *   WHY THIS EXISTS RATHER THAN A RULE IN A COMMENT. `next build` and `next dev`
 *   share `.next`, and a production build leaves BUILD_ID, prerender-manifest
 *   and export-marker behind. A dev server started against those serves HTML
 *   referencing CSS chunks that do not exist, so every page renders with NO
 *   stylesheet — dark panels stacked full-width, serif fallback fonts — and
 *   nothing logs an error. The page looks broken in a way that points at the
 *   layout rather than at the build directory, which is why it has cost several
 *   debugging sessions.
 *
 *   next.config.js already offers NEXT_DIST_DIR for verification builds, but a
 *   documented option only helps the person who remembers it. This runs
 *   automatically and needs no discipline.
 *
 *   BUILD_ID is the signal: `next dev` never writes one, so its presence means a
 *   production build wrote here and the directory cannot be trusted for dev.
 *
 * @security None — local filesystem only, touches nothing outside `.next`.
 * @dependencies node:fs
 */

import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const DIST = join(process.cwd(), '.next');
const MARKER = join(DIST, 'BUILD_ID');

if (existsSync(MARKER)) {
  rmSync(DIST, { recursive: true, force: true });
  console.log(
    '[guard-dev-dist] Removed .next — it held a PRODUCTION build (BUILD_ID present).\n' +
    '                 A dev server started on those artifacts serves 404s for every\n' +
    '                 CSS chunk and renders the app unstyled.\n' +
    '                 For verification builds use: NEXT_DIST_DIR=.next-build npx next build',
  );
}
