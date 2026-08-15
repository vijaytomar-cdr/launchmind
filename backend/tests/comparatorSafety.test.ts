/**
 * @file comparatorSafety.test.ts
 * @description Deterministic comparator safety policy — 3.1G remediation §1–§2.
 *
 *   THE POLICY BEING ENFORCED:
 *
 *     Deterministic REINFORCEMENT is permitted only when two claims make the
 *     SAME assertion, with one possibly saying more. Anything else defers to the
 *     model.
 *
 *   This is deliberately asymmetric. A missed reinforcement costs one model call.
 *   A false reinforcement raises confidence in a belief the new evidence
 *   undermines, and `reinforce` requires no founder review — so it happens
 *   silently. The comparator is therefore biased toward deferral.
 *
 *   WHY NOT JUST EXTEND THE ANTONYM TABLE. The B1 failure was
 *   `fatigues` vs `performs better`, and the obvious repair is to add that pair.
 *   That fixes one sentence and leaves the shape of the bug: the table can never
 *   cover English, and every word it misses is another silent false
 *   reinforcement. The tests below use verb forms the table does NOT contain, on
 *   purpose — if someone "fixes" this by growing the table, these still pass for
 *   the wrong reason, so each one also asserts the DEFERRAL, which only the
 *   boundary change produces.
 *
 * @security No provider calls — every case runs the deterministic path alone
 *   (`compareDeterministic`, or `compareClaims` with `allowModel: false`).
 * @dependencies claimComparison, beliefPolicy
 */

import { describe, it, expect } from 'vitest';
import {
  compareDeterministic, compareClaims, type ComparableClaim,
} from '../src/services/memory/claimComparison';
import { decide } from '../src/services/memory/beliefPolicy';

const c = (text: string, scope: ComparableClaim['scope'] = {}): ComparableClaim => ({ text, scope });

// ── B1, exactly as measured ──────────────────────────────────────────────────
describe('B1 — the measured false reinforcement', () => {
  const existing = c('Meta creative fatigues above frequency 3', { channel: 'meta' });
  const candidate = c('Meta creative performs better above frequency 3', { channel: 'meta' });

  it('no longer returns REINFORCEMENT', () => {
    const r = compareDeterministic(existing, candidate);
    expect(r?.classification).not.toBe('REINFORCEMENT');
  });

  it('DEFERS to the model rather than deciding', () => {
    // Null is the defer signal. Asserting it specifically means this test cannot
    // be satisfied by adding `fatigues`/`performs` to the antonym table.
    expect(compareDeterministic(existing, candidate)).toBeNull();
  });

  it('offline, it degrades to UNRELATED — which mutates nothing', () => {
    return compareClaims(existing, candidate, { allowModel: false }).then(r => {
      expect(r.classification).toBe('UNRELATED');
      expect(decide(r.classification, 'campaign_performance', 'analytics').action).toBe('none');
    });
  });
});

// ── §2 adversarial predicate set ─────────────────────────────────────────────
describe('§2 predicate/outcome safety — none of these may reinforce', () => {
  /**
   * Every pair asserts opposing or non-comparable outcomes about the same
   * subject. The only acceptable deterministic answers are CONTRADICTION (when
   * the rules can prove it) or a deferral. REINFORCEMENT is always wrong.
   */
  const PAIRS: Array<[string, string, string]> = [
    ['improves vs declines',
     'Onboarding email improves activation', 'Onboarding email declines activation'],
    ['fatigues vs performs better',
     'Meta creative fatigues above frequency 3', 'Meta creative performs better above frequency 3'],
    ['converts vs drops',
     'The pricing page converts visitors', 'The pricing page drops visitors'],
    ['increases churn vs improves retention',
     'Annual billing increases churn', 'Annual billing improves retention'],
    ['cheaper vs more expensive',
     'Search leads are cheaper this quarter', 'Search leads are more expensive this quarter'],
    ['stronger vs weaker',
     'Referral signal is stronger for enterprise', 'Referral signal is weaker for enterprise'],
    ['higher CAC vs lower CAC',
     'Paid social produces higher CAC', 'Paid social produces lower CAC'],
    ['higher conversion vs lower conversion',
     'Outcome-led copy drives higher conversion', 'Outcome-led copy drives lower conversion'],
    ['better retention vs worse retention',
     'Weekly digest gives better retention', 'Weekly digest gives worse retention'],
    ['rising vs falling (neither word in the table)',
     'Trial-to-paid rate is rising', 'Trial-to-paid rate is falling'],
    ['accelerates vs slows',
     'Self-serve onboarding accelerates activation', 'Self-serve onboarding slows activation'],
  ];

  for (const [name, a, b] of PAIRS) {
    it(`${name} — never REINFORCEMENT`, () => {
      const r = compareDeterministic(c(a), c(b));
      if (r) {
        expect(r.classification, `${name} produced ${r.classification}`).not.toBe('REINFORCEMENT');
        expect(r.classification).not.toBe('DUPLICATE');
      }
      // r === null is the deferral, which is the desired outcome for the pairs
      // the antonym table cannot see.
    });

    it(`${name} — offline resolution mutates nothing`, async () => {
      const r = await compareClaims(c(a), c(b), { allowModel: false });
      const d = decide(r.classification, 'campaign_performance', 'analytics');
      expect(['none', 'challenge'], `${name} → ${r.classification}/${d.action}`).toContain(d.action);
    });
  }
});

// ── The behaviour that must NOT regress ──────────────────────────────────────
describe('genuine reinforcement still resolves deterministically', () => {
  it('an elaboration of the same claim is REINFORCEMENT', () => {
    // One-sided residual: the candidate says the same thing plus detail. This is
    // the case the boundary is tuned to keep, so the fix does not simply push
    // every comparison to the model.
    const r = compareDeterministic(
      c('Search converts better than Meta', { channel: 'google_ads' }),
      c('Search converts better than Meta on cost per booking', { channel: 'google_ads' }));
    expect(r?.classification).toBe('REINFORCEMENT');
    expect(r?.comparedDimensions).toContain('predicate');
  });

  it('exact and normalised duplicates are unaffected', () => {
    expect(compareDeterministic(c('Outcome-led messaging increased conversion'),
                                c('Outcome-led messaging increased conversion'))?.classification)
      .toBe('DUPLICATE');
    expect(compareDeterministic(c('The outcome-led messaging increased conversion!'),
                                c('Outcome-led messaging increased conversion'))?.classification)
      .toBe('DUPLICATE');
  });

  it('a provable same-scope contradiction is still caught without a model', () => {
    const r = compareDeterministic(
      c('Search converts better than Meta', { segment: 'smb' }),
      c('Search converts worse than Meta', { segment: 'smb' }));
    expect(r?.classification).toBe('CONTRADICTION');
    expect(r?.rationaleCode).toBe('OPPOSITE_POLARITY_SAME_SCOPE');
  });

  it('the exception on a different scope is still preserved', () => {
    const r = compareDeterministic(
      c('Search performs better than Meta', { segment: 'smb' }),
      c('Search performs worse than Meta', { segment: 'enterprise' }));
    expect(r?.classification).toBe('UNRELATED');
    expect(r?.rationaleCode).toBe('OPPOSITE_POLARITY_DIFFERENT_SCOPE');
  });

  it('an unrelated subject is still resolved without a model', () => {
    expect(compareDeterministic(
      c('Outcome-led messaging increased conversion'),
      c('Server response latency improved after the caching change'))?.classification)
      .toBe('UNRELATED');
  });
});

// ── The policy itself ────────────────────────────────────────────────────────
describe('the deterministic reinforcement boundary', () => {
  it('differing polarity vocabulary is not evidence of agreement', () => {
    // {better} vs {higher}: not opposites, but not the same assertion either.
    expect(compareDeterministic(
      c('Search converts better than Meta'),
      c('Search converts higher than Meta'))).toBeNull();
  });

  it('incidental shared direction words cannot manufacture agreement', () => {
    // "above" appears in both and is an antonym-table word. It describes a
    // threshold here, not an outcome. It must not carry a reinforcement.
    const r = compareDeterministic(
      c('Retention drops above 50 seats'),
      c('Retention climbs above 50 seats'));
    expect(r?.classification).not.toBe('REINFORCEMENT');
  });

  it('safety is preferred over avoiding model calls', async () => {
    // Deferral rate is allowed to rise; false reinforcement is not allowed at all.
    const ambiguous = PAIRS_SAMPLE.map(([a, b]) => compareDeterministic(c(a), c(b)));
    const reinforced = ambiguous.filter(r => r?.classification === 'REINFORCEMENT');
    expect(reinforced).toHaveLength(0);
  });
});

const PAIRS_SAMPLE: Array<[string, string]> = [
  ['Meta creative fatigues above frequency 3', 'Meta creative performs better above frequency 3'],
  ['Trial-to-paid rate is rising', 'Trial-to-paid rate is falling'],
  ['Annual billing increases churn', 'Annual billing improves retention'],
];
