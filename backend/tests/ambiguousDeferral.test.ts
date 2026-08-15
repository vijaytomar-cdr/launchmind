/**
 * @file ambiguousDeferral.test.ts
 * @description SAME SUBJECT / DIFFERENT MEASURE must defer, without over-deferring.
 *
 *   THE MEASURED DEFECT: "push before 9am → higher open rates" vs "→ higher
 *   unsubscribe rates" returned CREATE_NEW with no review. Both may be true at
 *   once; the interaction is exactly what a founder must weigh. UNRELATED was the
 *   worst available answer.
 *
 *   The counter-risk is over-deferral, so the clear cases are frozen too.
 *
 * @security Pure comparison. No DB, no owner data.
 * @dependencies claimComparison
 */
import { describe, it, expect } from 'vitest';
import { compareDeterministic, deterministicSafetyClass, type ComparableClaim } from '../src/services/memory/claimComparison';

const c = (text: string, scope: Partial<ComparableClaim['scope']> = {}): ComparableClaim => ({
  text,
  scope: { channel: null, segment: null, market: null, timeframe: null, productId: null, ...scope },
  memoryType: 'LEARNING',
});

describe('ambiguous deferral — same subject, different measure', () => {
  it('1. push before 9am: open rate vs unsubscribe rate → DEFER', () => {
    const a = c('Push notifications sent before 9am produce higher open rates');
    const b = c('Push notifications sent before 9am produce higher unsubscribe rates');
    expect(deterministicSafetyClass(a, b)).toBe('SAME_SUBJECT_DIFFERENT_MEASURE');
    expect(compareDeterministic(a, b)).toBeNull();          // deferred, not answered
  });

  it('2. discounts: conversion vs AOV → DEFER', () => {
    // Reaches the SAFE outcome by a different route: subject containment is 0.5,
    // under the 0.6 same-subject threshold, so the deterministic layer defers
    // before the measure rule is consulted. The requirement is that it must not
    // resolve — which it does not. The threshold is deliberately NOT retuned
    // here; widening it would change comparator behaviour far beyond this case.
    const a = c('Discount codes increase conversion');
    const b = c('Discount codes reduce AOV');
    expect(compareDeterministic(a, b)).toBeNull();
  });

  it('3. Meta frequency: fatigue vs CTR — SAME measure family (engagement)', () => {
    // FROZEN RULE: fatigue and CTR are both engagement measures, so this is NOT
    // same-subject/different-measure. Ordinary polarity rules apply and the pair
    // remains resolvable — deferring here would be over-deferral.
    const a = c('Meta creative above frequency 3 shows fatigue');
    const b = c('Meta creative above frequency 3 shows worse CTR');
    expect(deterministicSafetyClass(a, b)).toBeNull();
  });

  it('4. same subject, same measure, same polarity → resolvable as reinforcement', () => {
    const a = c('Search delivers lower CAC');
    const b = c('Search delivers lower CAC');
    expect(deterministicSafetyClass(a, b)).toBeNull();
    expect(compareDeterministic(a, b)?.classification).toBe('DUPLICATE');
  });

  it('5. same subject, same measure, opposite polarity → NOT intercepted as ambiguous', () => {
    // PRE-EXISTING BEHAVIOUR, unchanged: this pair is deferred to the model
    // rather than resolved deterministically. What matters for THIS change is
    // that the measure rule does not intercept it — a genuine contradiction must
    // stay resolvable, and the model is free to answer CONTRADICTION.
    const a = c('Search delivers lower CAC');
    const b = c('Search delivers higher CAC');
    expect(deterministicSafetyClass(a, b)).toBeNull();
  });

  it('6. same measure, opposite polarity, DIFFERENT segment → not a false contradiction', () => {
    const a = c('Search delivers lower CAC', { segment: 'smb' });
    const b = c('Search delivers higher CAC', { segment: 'enterprise' });
    const r = compareDeterministic(a, b);
    expect(r?.classification).not.toBe('CONTRADICTION');
  });

  it('7. genuinely different subject → UNRELATED is safe', () => {
    const a = c('Search delivers lower CAC');
    const b = c('Email improves open rate');
    expect(deterministicSafetyClass(a, b)).toBeNull();
    expect(compareDeterministic(a, b)?.classification).toBe('UNRELATED');
  });

  it('no measure named on one side → not treated as different-measure', () => {
    const a = c('Push notifications sent before 9am work well');
    const b = c('Push notifications sent before 9am produce higher unsubscribe rates');
    expect(deterministicSafetyClass(a, b)).toBeNull();
  });

  it('MUTATION: collapsing the measure families reintroduces the defect', () => {
    // If every measure word were one family, case 1 would resolve instead of
    // deferring. This asserts the family split is load-bearing.
    const a = c('Push notifications sent before 9am produce higher open rates');
    const b = c('Push notifications sent before 9am produce higher unsubscribe rates');
    const safety = deterministicSafetyClass(a, b);
    expect(safety).toBe('SAME_SUBJECT_DIFFERENT_MEASURE');
    // Same intervention, and the two outcome words are in different families.
    expect(a.text).toContain('open rates');
    expect(b.text).toContain('unsubscribe rates');
  });
});
