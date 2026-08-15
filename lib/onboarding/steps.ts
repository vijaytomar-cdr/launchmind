/**
 * @file steps.ts
 * @description The canonical onboarding step model — one source of truth for the
 *   shell's stage, substep, progress and Back target.
 *
 *   EXTRACTED FROM THE LAYOUT so it can be tested. Next.js forbids arbitrary
 *   exports from a `layout.tsx`, which is why this model previously lived inline
 *   and unverified — and why a missing entry for `/onboarding/positioning` went
 *   unnoticed: the lookup fell back to the workspace entry, so the rail claimed
 *   the owner was on step 1 while they were deep inside Alignment, the progress
 *   bar read 12%, and `backPath: '/'` hid the Back button entirely.
 *
 * @security None — pure route metadata, no owner data.
 * @dependencies none
 */

export interface StepMeta {
  /**
   * NO `confidence` FIELD. This model used to carry a per-route confidence
   * percentage that the rail rendered as "Growth Brain confidence". It measured
   * nothing — the value was fixed per URL, identical for every founder and every
   * business. Progress belongs here; confidence is derived from real state.
   */
  /** Index into the five top-level phases. */
  stage: number;
  label: string;
  progress: number;
  backPath: string;
  /** 1-based position within "Confirm and align", when the route is a substep. */
  substep?: number;
}

export const PHASE_STAGES = [
  { key: 'account',    label: 'Create your workspace', sub: 'Save and resume safely' },
  { key: 'discover',   label: 'Discover your product', sub: 'Public evidence first' },
  { key: 'align',      label: 'Confirm and align',     sub: 'Correct what AI inferred' },
  { key: 'boundaries', label: 'Set boundaries',        sub: 'You remain in control' },
  { key: 'direction',  label: 'Get first direction',   sub: 'A useful plan, not a setup receipt' },
] as const;

/**
 * THE CANONICAL SUBSTEP SEQUENCE for "Confirm and align".
 *
 * Every Back target is derived from this order rather than written by hand.
 * Hand-written back links are what let `/onboarding/positioning` be inserted
 * into the flow while context-delta still pointed back at audience — so the
 * app's own Back button skipped a screen the browser's Back button did not.
 */
export const ALIGNMENT_SUBSTEPS = [
  { path: '/onboarding/audience',      label: 'Audience' },
  { path: '/onboarding/positioning',   label: 'Check my understanding' },
  { path: '/onboarding/context-delta', label: "What's changing" },
  { path: '/onboarding/goal',          label: 'Define success' },
  { path: '/onboarding/competitors',   label: 'Competitors' },
] as const;

export const ALIGNMENT_COUNT = ALIGNMENT_SUBSTEPS.length;

/** The screen before an Alignment substep, in canonical order. */
export function alignmentBackPath(index: number): string {
  return index === 0 ? '/onboarding/beliefs' : ALIGNMENT_SUBSTEPS[index - 1].path;
}

export const STEP_META: Record<string, StepMeta> = {
  '/onboarding/workspace':          { stage: 0, label: 'Secure workspace setup',   progress: 12,  backPath: '/' },
  '/onboarding/discovery':          { stage: 1, label: 'Product discovery',        progress: 28, backPath: '/onboarding/workspace' },
  '/onboarding/discovery/progress': { stage: 1, label: 'Building Growth Brain',    progress: 38, backPath: '/onboarding/discovery' },
  '/onboarding/discovery/recovery': { stage: 1, label: 'Recovery needed',          progress: 28, backPath: '/onboarding/discovery' },
  '/onboarding/report':             { stage: 2, label: 'Preliminary report',       progress: 50, backPath: '/onboarding/discovery' },
  '/onboarding/beliefs':            { stage: 2, label: 'Review beliefs',           progress: 56, backPath: '/onboarding/report' },

  // Generated, so a new substep cannot be added without its progress, Back
  // target and rail label all moving together.
  ...Object.fromEntries(ALIGNMENT_SUBSTEPS.map((s, i): [string, StepMeta] => [s.path, {
    stage: 2,
    label: s.label,
    progress: 60 + Math.round((i / ALIGNMENT_SUBSTEPS.length) * 20),
    backPath: alignmentBackPath(i),
    substep: i + 1,
  }])),

  '/onboarding/boundaries':         { stage: 3, label: 'Set working boundaries',      progress: 84,  backPath: '/onboarding/competitors' },
  '/onboarding/review':             { stage: 4, label: 'Final review',                progress: 88,  backPath: '/onboarding/boundaries' },
  '/onboarding/generating':         { stage: 4, label: 'Generating direction…',       progress: 94,  backPath: '/onboarding/review' },
  '/onboarding/direction':          { stage: 4, label: 'Your first direction',        progress: 97,  backPath: '/onboarding/review' },
  '/onboarding/complete':           { stage: 4, label: 'Product understanding ready', progress: 100, backPath: '/onboarding/direction' },
};

/**
 * Resolves a route to its shell metadata.
 *
 * An unknown `/onboarding/*` route resolves to the nearest registered prefix
 * rather than silently claiming stage 0. Being vague about which substep the
 * owner is on is recoverable; telling them they are back at "Create your
 * workspace" when they have already built a product is not.
 *
 * @param pathname - the current route
 * @returns metadata for the shell; never throws
 */
export function resolveStep(pathname: string): StepMeta {
  const exact = STEP_META[pathname];
  if (exact) return exact;
  const prefix = Object.keys(STEP_META)
    .filter(p => pathname.startsWith(p))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? STEP_META[prefix] : STEP_META['/onboarding/workspace'];
}
