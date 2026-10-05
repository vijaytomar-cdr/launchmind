/**
 * @file assertionContext.test.ts
 * @description The shared negation/denial primitive — the fix for a defect
 *   measured twice independently (productCapabilityContract's qualifier
 *   check, then copyClaimClassifier's GUARANTEE lexicon), both treating an
 *   explicit denial as if it were the assertion it denies.
 */
import { describe, it, expect } from 'vitest';
import { isExplicitlyDenied } from '../src/services/content/assertionContext';

describe('isExplicitlyDenied — local, occurrence-aware denial', () => {
  it('a term that does not appear at all is not "denied"', () => {
    expect(isExplicitlyDenied('A calm, clear landing page.', 'verified')).toBe(false);
  });

  it.each([
    'This has not been verified.',
    'This is not verified by LaunchMind.',
    'We do not claim this is verified.',
    'LaunchMind does not guarantee availability.',
    'This is not an outcome promise.',
    'This does not mean a provider will be instantly available.',
  ])('explicit local negation is recognized: %s', (text) => {
    const term = /verif/.test(text) ? 'verified' : /guarantee/.test(text) ? 'guarantee'
      : /promise/.test(text) ? 'promise' : 'available';
    expect(isExplicitlyDenied(text, term)).toBe(true);
  });

  it('the real refused-then-corrected sentence is recognized as a denial', () => {
    const text = 'those qualities characterize who they are, not a process ' +
      'or promise LaunchMind has verified';
    expect(isExplicitlyDenied(text, 'verified')).toBe(true);
  });

  it.each([
    ['This is verified.', 'verified'],
    ['LaunchMind guarantees availability.', 'guarantee'],
    ['This is an outcome promise.', 'promise'],
  ] as const)('a bare positive occurrence is NOT denied: %s', (text, term) => {
    expect(isExplicitlyDenied(text, term)).toBe(false);
  });

  it('MIXED occurrences: one denied and one asserted still counts as asserted', () => {
    // A comma-separated contrastive clause resets scope — the second
    // "guaranteed" is a fresh, unguarded assertion.
    expect(isExplicitlyDenied('This is not guaranteed, but availability is guaranteed.', 'guaranteed'))
      .toBe(false);
  });

  it('"not only X" is an intensifier, not a denial of X', () => {
    expect(isExplicitlyDenied('This is not only guaranteed to work, but proven.', 'guaranteed'))
      .toBe(false);
  });

  it('negation in an earlier, different sentence does not suppress a later positive claim', () => {
    expect(isExplicitlyDenied(
      "We don't do things halfway. Professionals are verified before they join.",
      'verified')).toBe(false);
  });

  it('negation before an em dash does not reach across it into a new clause', () => {
    expect(isExplicitlyDenied(
      "We don't do things halfway — verified professionals handle every job.",
      'verified')).toBe(false);
  });

  it('a negator more than the local window away does not govern the occurrence', () => {
    const farNegator = 'not ' + 'a very long qualifying clause that keeps going on and on '.repeat(2)
      + 'verified';
    expect(isExplicitlyDenied(farNegator, 'verified')).toBe(false);
  });
});
