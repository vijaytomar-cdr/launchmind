/**
 * @file onboardingSteps.test.ts
 * @description The onboarding shell's step model.
 *
 *   THE DEFECT THIS PINS. `/onboarding/positioning` was added to the flow but
 *   never registered in the shell's route map, and the lookup ended in
 *   `?? STEP_META['/onboarding/workspace']`. So the screen silently rendered as
 *   stage 0: the rail highlighted "Create your workspace" while the owner was
 *   deep inside Alignment, the progress bar read 12%, and `backPath: '/'` hid
 *   the Back button — which is why that one screen's top bar did not match its
 *   neighbours. A missing map key produced a confident, wrong answer.
 *
 *   Every route in the flow is now asserted, so the next inserted substep fails
 *   here rather than in a browser.
 *
 * @security None — route metadata only.
 * @dependencies lib/onboarding/steps
 */

import { describe, it, expect } from 'vitest';
import {
  resolveStep, STEP_META, ALIGNMENT_SUBSTEPS, ALIGNMENT_COUNT, PHASE_STAGES,
} from '../onboarding/steps';

const ALIGN_STAGE = 2;

describe('every onboarding route is registered', () => {
  it('resolves each Alignment substep to "Confirm and align", never to stage 0', () => {
    for (const s of ALIGNMENT_SUBSTEPS) {
      const meta = resolveStep(s.path);
      expect(meta.stage, `${s.path} resolved to the wrong stage`).toBe(ALIGN_STAGE);
      expect(PHASE_STAGES[meta.stage].label).toBe('Confirm and align');
    }
  });

  it('positioning specifically — the reported bug', () => {
    const meta = resolveStep('/onboarding/positioning');
    expect(meta.stage).toBe(ALIGN_STAGE);        // was 0
    expect(meta.substep).toBe(2);
    expect(meta.progress).toBeGreaterThan(50);   // was 12
    expect(meta.backPath).not.toBe('/');         // '/' hid the Back button
    expect(meta.backPath).toBe('/onboarding/audience');
  });

  it('numbers the substeps 1..N with no gaps or duplicates', () => {
    const numbers = ALIGNMENT_SUBSTEPS.map(s => resolveStep(s.path).substep);
    expect(numbers).toEqual([1, 2, 3, 4, 5]);
    expect(ALIGNMENT_COUNT).toBe(5);
  });

  it('marks ONLY Alignment routes as substeps', () => {
    for (const p of ['/onboarding/workspace', '/onboarding/discovery',
                     '/onboarding/beliefs', '/onboarding/boundaries', '/onboarding/review']) {
      expect(resolveStep(p).substep, `${p} should not claim an Alignment substep`).toBeUndefined();
    }
  });
});

describe('Back targets form one unbroken chain (§7)', () => {
  it('each substep goes back to the previous one, and the first exits to beliefs', () => {
    expect(resolveStep('/onboarding/audience').backPath).toBe('/onboarding/beliefs');
    for (let i = 1; i < ALIGNMENT_SUBSTEPS.length; i++) {
      expect(resolveStep(ALIGNMENT_SUBSTEPS[i].path).backPath)
        .toBe(ALIGNMENT_SUBSTEPS[i - 1].path);
    }
  });

  it('context-delta goes back to positioning, not past it', () => {
    // The concrete drift: positioning was inserted between audience and
    // context-delta, but context-delta's Back still pointed at audience — so the
    // app's Back skipped a screen the browser's Back did not.
    expect(resolveStep('/onboarding/context-delta').backPath).toBe('/onboarding/positioning');
  });

  it('every Back target is itself a registered route', () => {
    for (const [path, meta] of Object.entries(STEP_META)) {
      if (meta.backPath === '/') continue;
      expect(STEP_META[meta.backPath], `${path} points Back at an unregistered route`).toBeDefined();
    }
  });

  it('following Back from the last substep reaches the first in N-1 hops', () => {
    // Proves the chain terminates and has no cycle.
    let path: string = ALIGNMENT_SUBSTEPS[ALIGNMENT_SUBSTEPS.length - 1].path;
    const seen = new Set<string>([path]);
    let hops = 0;
    while (path !== '/onboarding/audience' && hops < 20) {
      path = resolveStep(path).backPath;
      expect(seen.has(path), 'cycle in Back chain').toBe(false);
      seen.add(path);
      hops++;
    }
    expect(hops).toBe(ALIGNMENT_SUBSTEPS.length - 1);
  });
});

describe('progress is monotonic through the flow', () => {
  it('never goes backwards across the canonical order', () => {
    const order = [
      '/onboarding/workspace', '/onboarding/discovery', '/onboarding/report',
      '/onboarding/beliefs', ...ALIGNMENT_SUBSTEPS.map(s => s.path),
      '/onboarding/boundaries', '/onboarding/review', '/onboarding/generating',
      '/onboarding/direction', '/onboarding/complete',
    ];
    const progress = order.map(p => resolveStep(p).progress);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i], `progress dropped at ${order[i]}`).toBeGreaterThanOrEqual(progress[i - 1]);
    }
  });

  it('stage never goes backwards either', () => {
    const order = ['/onboarding/workspace', '/onboarding/discovery', '/onboarding/beliefs',
                   ...ALIGNMENT_SUBSTEPS.map(s => s.path),
                   '/onboarding/boundaries', '/onboarding/review', '/onboarding/complete'];
    const stages = order.map(p => resolveStep(p).stage);
    for (let i = 1; i < stages.length; i++) {
      expect(stages[i]).toBeGreaterThanOrEqual(stages[i - 1]);
    }
  });
});

describe('unknown routes degrade safely, not to stage 0', () => {
  it('a nested discovery route inherits its parent stage', () => {
    expect(resolveStep('/onboarding/discovery/progress').stage).toBe(1);
    // An unregistered nested route resolves by prefix rather than resetting.
    expect(resolveStep('/onboarding/discovery/something-new').stage).toBe(1);
  });

  it('a completely unknown route does not crash', () => {
    expect(() => resolveStep('/onboarding/does-not-exist')).not.toThrow();
    expect(resolveStep('/onboarding/does-not-exist').stage).toBeGreaterThanOrEqual(0);
  });
});

// ── No fabricated confidence anywhere in the step model ────────────────────
describe('the rail carries progress, not "confidence"', () => {
  it('no step exposes a confidence field', () => {
    // The rail rendered "Growth Brain confidence · N%" from these literals. The
    // value was fixed per URL, so a founder who typed one sentence and one who
    // supplied a full product history saw the same "confidence".
    for (const meta of Object.values(STEP_META)) {
      expect(meta).not.toHaveProperty('confidence');
    }
  });

  it('the discovery step no longer carries the literal 18', () => {
    const raw = JSON.stringify(STEP_META['/onboarding/discovery']);
    expect(raw).not.toMatch(/"confidence"/);
  });
});
