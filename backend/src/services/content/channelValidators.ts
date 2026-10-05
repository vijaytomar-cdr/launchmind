/**
 * @file channelValidators.ts
 * @description Deterministic channel structure — ADR-070 §8A, frozen 2026-08-17.
 *
 *   These are VALIDATORS, not prompt instructions. A 31-character Google
 *   headline is a structural defect, not a stylistic preference, and telling the
 *   model about the limit is not the same as enforcing it. Invalid content
 *   cannot become an approvable version.
 *
 *   Limits are pinned in code with a date. They are NOT fetched during
 *   generation: a platform changing a limit must be a reviewed code change, not
 *   a silent behaviour change mid-request.
 *
 * @security Structural validity is independent of factual safety. Passing here
 *   says nothing about whether a claim is supported.
 * @dependencies none (pure)
 */

/** Bump when a platform limit is re-checked. Shown in audit output. */
export const CHANNEL_CONSTRAINT_VERSION = '2026-09-20';

export const CONTENT_CHANNELS = ['google_ads_rsa', 'meta_ads', 'landing_page'] as const;
export type ContentChannel = typeof CONTENT_CHANNELS[number];

export interface ValidationIssue {
  field: string; rule: string; detail: string;
  severity: 'ERROR' | 'ADVISORY';
}
export interface ValidationResult {
  valid: boolean; issues: ValidationIssue[]; constraintVersion: string;
}

const err = (field: string, rule: string, detail: string): ValidationIssue =>
  ({ field, rule, detail, severity: 'ERROR' });
const advise = (field: string, rule: string, detail: string): ValidationIssue =>
  ({ field, rule, detail, severity: 'ADVISORY' });

export interface GoogleRsa { headlines: string[]; descriptions: string[]; paths?: string[] }
export interface MetaAd { primaryText: string; headline: string; description?: string }
export interface LandingPage { h1: string; subhead?: string; ctas: string[] }

/** Google disallows repeated punctuation and shouted words in RSA assets. */
const DOUBLE_PUNCT = /[!?]{2,}|\.{3,}/;
const ALL_CAPS_WORD = /\b[A-Z]{4,}\b/;

export function validateGoogleRsa(a: GoogleRsa): ValidationResult {
  const issues: ValidationIssue[] = [];
  const h = a.headlines ?? [], d = a.descriptions ?? [], p = a.paths ?? [];

  if (h.length < 3 || h.length > 15) issues.push(err('headlines', 'count', `${h.length} (need 3–15)`));
  if (d.length < 2 || d.length > 4) issues.push(err('descriptions', 'count', `${d.length} (need 2–4)`));
  if (p.length > 2) issues.push(err('paths', 'count', `${p.length} (max 2)`));

  h.forEach((x, i) => {
    if (x.length > 30) issues.push(err(`headlines[${i}]`, 'maxLength', `${x.length} > 30`));
    if (x.trim().length === 0) issues.push(err(`headlines[${i}]`, 'empty', 'blank headline'));
    if (DOUBLE_PUNCT.test(x)) issues.push(err(`headlines[${i}]`, 'punctuation', 'repeated punctuation'));
    if (ALL_CAPS_WORD.test(x)) issues.push(err(`headlines[${i}]`, 'casing', 'all-caps word'));
  });
  d.forEach((x, i) => {
    if (x.length > 90) issues.push(err(`descriptions[${i}]`, 'maxLength', `${x.length} > 90`));
    if (x.trim().length === 0) issues.push(err(`descriptions[${i}]`, 'empty', 'blank description'));
  });
  p.forEach((x, i) => {
    if (x.length > 15) issues.push(err(`paths[${i}]`, 'maxLength', `${x.length} > 15`));
    if (/[^A-Za-z0-9-]/.test(x)) issues.push(err(`paths[${i}]`, 'charset', 'non-alphanumeric path'));
  });

  return finish(issues);
}

export function validateMetaAd(a: MetaAd): ValidationResult {
  const issues: ValidationIssue[] = [];
  const primary = a.primaryText ?? '';
  if (primary.trim().length === 0) issues.push(err('primaryText', 'empty', 'blank primary text'));
  // 2200 is Meta's hard cap. 125 is a truncation THRESHOLD, not a rejection —
  // reporting it as an error would invent a limit the platform does not enforce.
  if (primary.length > 2200) issues.push(err('primaryText', 'maxLength', `${primary.length} > 2200`));
  else if (primary.length > 125) issues.push(advise('primaryText', 'truncation', `${primary.length} > 125; truncated in feed`));

  if ((a.headline ?? '').trim().length === 0) issues.push(err('headline', 'empty', 'blank headline'));
  if ((a.headline ?? '').length > 40) issues.push(err('headline', 'maxLength', `${a.headline.length} > 40`));
  if (a.description && a.description.length > 30) {
    issues.push(err('description', 'maxLength', `${a.description.length} > 30`));
  }
  return finish(issues);
}

export function validateLandingPage(a: LandingPage): ValidationResult {
  const issues: ValidationIssue[] = [];
  if ((a.h1 ?? '').trim().length === 0) issues.push(err('h1', 'empty', 'blank H1'));
  // Landing-page headings have no platform hard cap. Keep the 70-character
  // readability target, but allow a bounded 20% layout tolerance before
  // rejecting an otherwise usable customer-facing draft.
  if ((a.h1 ?? '').length > 84) issues.push(err('h1', 'maxLength', `${a.h1.length} > 84`));
  else if ((a.h1 ?? '').length > 70) issues.push(advise('h1', 'readabilityTarget', `${a.h1.length} > 70; shorten if the layout permits`));
  if (a.subhead && a.subhead.length > 160) issues.push(err('subhead', 'maxLength', `${a.subhead.length} > 160`));
  const ctas = a.ctas ?? [];
  if (ctas.length < 1) issues.push(err('ctas', 'count', 'at least one CTA required'));
  ctas.forEach((c, i) => {
    if (c.length > 25) issues.push(err(`ctas[${i}]`, 'maxLength', `${c.length} > 25`));
  });
  return finish(issues);
}

function finish(issues: ValidationIssue[]): ValidationResult {
  return {
    valid: issues.every(i => i.severity !== 'ERROR'),
    issues,
    constraintVersion: CHANNEL_CONSTRAINT_VERSION,
  };
}

export function validateChannel(channel: ContentChannel, payload: unknown): ValidationResult {
  switch (channel) {
    case 'google_ads_rsa': return validateGoogleRsa(payload as GoogleRsa);
    case 'meta_ads':       return validateMetaAd(payload as MetaAd);
    case 'landing_page':   return validateLandingPage(payload as LandingPage);
  }
}
