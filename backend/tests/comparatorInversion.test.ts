/**
 * @file comparatorInversion.test.ts
 * @description THE P0 GATE for inverted beliefs.
 *
 *   MEASURED P0 (two distinct mechanisms, both real):
 *
 *   1. REVERSED COMPARISON. The comparator is bag-of-words, so
 *        "OUTCOME-FOCUSED headlines convert better than FEATURE-LED headlines"
 *        "FEATURE-LED headlines convert better than OUTCOME-FOCUSED headlines"
 *      have IDENTICAL token sets and IDENTICAL polarity signatures. The pair was
 *      classified REINFORCEMENT / SAME_CLAIM_SAME_SCOPE, decidedBy deterministic,
 *      zero model calls. Two claims asserting the exact opposite raised each
 *      other's confidence with no founder review.
 *
 *   2. COMPOUND WORDING. tokenize() keeps hyphens, so "feature-led" and
 *      "features" were unrelated tokens. jaccard fell to 0.182, just under the
 *      0.20 different-subject bar, and the pair was asserted UNRELATED.
 *
 *   Both paths end in the same place: a belief inversion never reaching review.
 *
 *   Every case calls the real exported comparator. No comparison logic is
 *   reproduced here — a helper that re-implemented it would prove the algorithm
 *   and not the code path.
 *
 * @security Proves an inverted belief cannot be silently reinforced.
 * @dependencies claimComparison (real)
 */

import { describe, it, expect } from 'vitest';
import {
  compareDeterministic, compareClaims, reversedComparison, expandCompounds,
} from '../src/services/memory/claimComparison';

const SC = {
  channel: null, segment: null, market: null,
  timeframe: null, productId: null, audience: null,
} as never;
const c = (text: string, scope: Record<string, unknown> = {}) =>
  ({ text, scope: { ...(SC as object), ...scope } }) as never;

const det = (a: string, b: string, sa = {}, sb = {}) =>
  compareDeterministic(c(a, sa), c(b, sb));

/** The frozen q07 pair, verbatim from the corpus fixture. */
const Q07_INCUMBENT = 'Outcome-focused headlines convert better than feature-led headlines for homeowners';
const Q07_CANDIDATE = 'Feature-led headlines convert better than outcome-focused headlines for homeowners';

/** The pair named in the brief: same inversion, differently worded. */
const BRIEF_INCUMBENT = 'Headlines that lead with the outcome outperform headlines that lead with features for homeowners';

/** The frozen q25 pair. */
const Q25_INCUMBENT = 'Premium positioning outperforms discount messaging on click-through';
const Q25_CANDIDATE = 'Discount messaging outperforms premium positioning on click-through';

describe('comparator — inverted beliefs must never resolve deterministically (P0)', () => {
  it('CASE A — q07 reversed comparison is NOT deterministically decided', () => {
    const r = det(Q07_INCUMBENT, Q07_CANDIDATE, { channel: 'meta' }, { channel: 'meta' });
    // The specific regression: it used to return REINFORCEMENT here.
    expect(r?.classification).not.toBe('REINFORCEMENT');
    expect(r?.classification).not.toBe('UNRELATED');
    expect(r).toBeNull();
  });

  it('CASE A2 — the brief wording (compound vs plain) is NOT deterministic UNRELATED', () => {
    const r = det(BRIEF_INCUMBENT, Q07_CANDIDATE);
    expect(r?.rationaleCode).not.toBe('DIFFERENT_SUBJECT');
    expect(r).toBeNull();
  });

  it('CASE B — q25 inversion is NOT deterministically reinforced', () => {
    const r = det(Q25_INCUMBENT, Q25_CANDIDATE, { channel: 'meta' }, { channel: 'meta' });
    expect(r?.classification).not.toBe('REINFORCEMENT');
    expect(r).toBeNull();
  });

  it('CASE C — direct directional inverse defers', () => {
    const r = det('Testimonial creative improves conversion', 'Testimonial creative reduces conversion');
    expect(r?.classification).not.toBe('REINFORCEMENT');
    expect(r).toBeNull();
  });

  it('CASE D — reversed comparison, plain and hyphenated, both defer', () => {
    expect(det('Trust messaging outperforms discount messaging',
      'Discount messaging outperforms trust messaging')).toBeNull();
    expect(det('Trust-based messaging outperforms discount-led messaging',
      'Discount-led messaging outperforms trust-based messaging')).toBeNull();
  });

  it('CASE E — genuinely different subjects are STILL deterministic UNRELATED', () => {
    expect(det('Testimonial creative improves conversion', 'Warehouse dispatch reduces delays'))
      .toMatchObject({ classification: 'UNRELATED', rationaleCode: 'DIFFERENT_SUBJECT' });
    // Hyphenated on both sides — compound expansion must not bridge them.
    expect(det('Feature-led onboarding reduces support tickets',
      'Warehouse-based dispatch shortens delivery windows'))
      .toMatchObject({ classification: 'UNRELATED', rationaleCode: 'DIFFERENT_SUBJECT' });
  });

  it('CASE F — different channel/scope does not become a false contradiction', () => {
    const r = det('Testimonial creative improves conversion for homeowners',
      'Testimonial creative improves conversion for homeowners',
      { channel: 'meta' }, { channel: 'google' });
    expect(r?.classification).not.toBe('CONTRADICTION');
  });

  it('CASE G — distinct historical events keep their existing behaviour', () => {
    const r = det('Canva acquired Affinity in March', 'Canva partnered with Leonardo in July');
    expect(r?.classification).not.toBe('REINFORCEMENT');
  });

  it('CASE H — same subject, different measure still defers', () => {
    expect(det('Testimonial creative improves conversion',
      'Testimonial creative improves click-through rate')).toBeNull();
  });

  it('AGREEMENT CONTROL — a real reinforcement is NOT suppressed', () => {
    // Same operands, SAME order, different comparator word. If the inversion
    // guard fired here it would be over-broad and would block legitimate
    // reinforcement, which is the failure mode opposite to the P0.
    expect(reversedComparison(
      'Trust messaging outperforms discount messaging',
      'Trust messaging beats discount messaging')).toBe(false);
    expect(reversedComparison(
      'Outcome-focused headlines convert better than feature-led headlines',
      'Outcome-focused headlines beat feature-led headlines')).toBe(false);
  });

  it('reversedComparison requires an actual comparator on both sides', () => {
    expect(reversedComparison('Testimonial creative improves conversion',
      'Conversion improves testimonial creative')).toBe(false);
    expect(reversedComparison('Trust messaging outperforms discount messaging',
      'Discount messaging is used widely')).toBe(false);
  });

  it('expandCompounds keeps the compound and adds its parts', () => {
    const e = expandCompounds(new Set(['feature-led', 'headlines']));
    expect(e.has('feature-led')).toBe(true);
    expect(e.has('feature')).toBe(true);
    expect(e.has('led')).toBe(true);
    expect(e.has('headlines')).toBe(true);
    expect(expandCompounds(new Set(['headlines'])).size).toBe(1);
  });
});

describe('comparator — model routing on the newly deferred cases', () => {
  it('MODEL_UNAVAILABLE fails safe — never a confident UNRELATED or REINFORCEMENT', async () => {
    for (const [a, b] of [[Q07_INCUMBENT, Q07_CANDIDATE], [Q25_INCUMBENT, Q25_CANDIDATE]]) {
      const r = await compareClaims(c(a), c(b), { allowModel: false });
      expect(r.classification).not.toBe('REINFORCEMENT');
      expect(r.classification).not.toBe('SUPERSEDE');
      // "No relationship established" is not the same as "no relationship".
      expect(r.unresolved).toBe(true);
    }
  });
});
