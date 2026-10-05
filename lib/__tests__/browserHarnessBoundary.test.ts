/**
 * @file browserHarnessBoundary.test.ts
 * @description Proves the DEVELOPMENT smoke can never be mistaken for
 *   certification — Phase 3.5B5 §2.
 *
 *   Two harnesses now drive a browser, and they are not interchangeable:
 *
 *     cert:browser            LOCAL_ISOLATED_BROWSER_CERTIFICATION and B8.
 *                             Fails closed unless every target is loopback AND
 *                             the identity is synthetic. Authoritative.
 *     test:b5:dev-browser     DEVELOPMENT_SMOKE against the real development
 *                             account, by explicit decision.
 *
 *   The failure this file exists to prevent is social, not technical: a future
 *   developer running the cheaper harness and reporting its green result as
 *   "browser-certified". So the wiring is asserted, not documented — if someone
 *   points the development script at the certification guard, or drops the
 *   guard from cert:browser, these tests fail.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '..', '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8')) as
  { scripts: Record<string, string> };

describe('browser harness boundary — B5 development smoke vs B8 certification', () => {
  it('cert:browser still runs the certification guard', () => {
    expect(pkg.scripts['cert:browser']).toBeDefined();
    expect(pkg.scripts['cert:browser']).toContain('cert:browser:guard');
    expect(pkg.scripts['cert:browser:guard']).toContain('browser-cert-guard.mjs');
  });

  it('the certification guard still fails closed on identity', () => {
    const guard = readFileSync(resolve(root, 'scripts/browser-cert-guard.mjs'), 'utf-8');
    // Certification refuses a non-loopback target and a non-synthetic identity.
    // Either check disappearing would let certification run against real data.
    expect(guard).toContain('LOOPBACK');
    expect(guard).toMatch(/staging@launchmind\.test/);
  });

  it('the development smoke does NOT invoke the certification guard', () => {
    const dev = pkg.scripts['test:b5:dev-browser'];
    expect(dev).toBeDefined();
    expect(dev).not.toContain('browser-cert-guard');
    expect(dev).not.toContain('cert:browser');
    // The script delegates its guard, so follow the chain rather than assuming
    // one level — an indirection is how a guard quietly stops being invoked.
    const guardScript = pkg.scripts['test:b5:dev-browser:guard'];
    expect(dev).toContain('test:b5:dev-browser:guard');
    expect(guardScript).toContain('dev-smoke-guard.mjs');
    expect(guardScript).not.toContain('browser-cert-guard');
  });

  it('the development smoke declares its mode explicitly', () => {
    expect(pkg.scripts['test:b5:dev-browser']).toContain('LM_ENV_MODE=LOCAL_REAL_DEVELOPMENT');
  });

  it('the development guard refuses to be run as certification', () => {
    const guard = readFileSync(resolve(root, 'tests/e2e-dev/dev-smoke-guard.mjs'), 'utf-8');
    expect(guard).toContain('LOCAL_REAL_DEVELOPMENT');
    expect(guard).toContain('DEVELOPMENT_SMOKE');
    // Setting any certification-shaped flag must be refused rather than honoured.
    for (const flag of ['CERT', 'CERTIFICATION', 'BROWSER_CERT', 'LM_CERTIFY']) {
      expect(guard).toContain(flag);
    }
  });

  it('the development smoke labels itself development-only in its own name', () => {
    const spec = readFileSync(
      resolve(root, 'tests/e2e-dev/b5-development-smoke.spec.ts'), 'utf-8');
    expect(spec).toContain('DEVELOPMENT_SMOKE');
    expect(spec).toContain('not certification');
    // A skipped authenticated run must never be reported as a pass.
    expect(spec).toMatch(/skipped, not passed/);
  });

  it('the two harnesses run different Playwright projects', () => {
    expect(pkg.scripts['cert:browser']).toContain('--project=cert');
    expect(pkg.scripts['test:b5:dev-browser']).toContain('--project=dev-smoke');
  });
});
