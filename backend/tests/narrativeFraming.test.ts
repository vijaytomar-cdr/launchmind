/**
 * @file narrativeFraming.test.ts
 * @description The narrative-framing boundary — §3, §5, §21, §22.
 *
 *   Every example in this file is taken VERBATIM from the phase brief, so the
 *   contract and the test cannot drift apart by paraphrase.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyNarrativeFraming, adjudicateNarrativeFraming,
  NARRATIVE_ELIGIBLE_CATEGORIES, NARRATIVE_SOURCE_TYPE,
} from '../src/services/content/narrativeFramingPolicy';
import type { ClaimCategory } from '../src/services/content/copyClaimClassifier';
import type { GroundingOutcome, GroundedClaimResult } from '../src/services/content/threeSignalClaimDiscovery';

const framing = (t: string, c: ClaimCategory = 'OTHER_FACTUAL_CLAIM') =>
  classifyNarrativeFraming(t, c);

// ── §5 SAFE ─────────────────────────────────────────────────────────────────
describe('§5 lines that may be narrative framing', () => {
  it.each([
    'Still calling around?',
    'Another voicemail?',
    'Home project on your list?',
    'Imagine starting your search from one place.',
    'Ready to simplify how you look for home-service professionals?',
    // §2's own examples.
    'Still calling around trying to find someone for your home project?',
    "Home projects shouldn't start with a phone-tag marathon.",
    'Imagine starting your search without another round of calls.',
    "Looking for the right home-service professional shouldn't feel complicated.",
    // §1 example B — the line that motivated the whole contract.
    'Calling multiple contractors can be frustrating.',
    // A HEDGED absolute addressed to the reader. Blocked by the first draft of
    // the prevalence rule, which treated bare "never" as prevalence; "may never
    // come" is a worry, not a report.
    'Still on hold for a callback that may never come?',
    // Plural subject. Identical framing to "doesn't have to"; the first draft
    // matched only the singular verb and refused this one.
    "Home projects don't have to start this way.",
    'Home projects do not have to start this way.',
  ])('permits: %s', text => {
    const v = framing(text);
    expect(v.eligible, `refused because: ${v.refusedBecause}`).toBe(true);
    expect(v.qualifiedBy).toBeTruthy();
  });
});

// ── §5 UNSAFE ───────────────────────────────────────────────────────────────
describe('§5 lines that remain claims', () => {
  it.each([
    ['Still waiting three days for a callback?',            'a duration'],
    ['Called five contractors already?',                    'a count'],
    ['Everyone hates finding contractors.',                 'prevalence'],
    ['Most homeowners never hear back.',                    'prevalence'],
    ['Contractors usually disappear.',                      'prevalence'],
    ['Homeowners waste hours calling around.',              'a population assertion'],
    ['People save hours with AllignX.',                     'a product outcome'],
    ['AllignX eliminates phone tag.',                       'a product outcome'],
    ['Get booked instantly.',                               'a timeframe'],
    ['Never call another contractor again.',                'a product outcome'],
    // §5 — question syntax must not launder a number.
    ['Are homeowners wasting 10 hours calling contractors?', 'a number'],
    // §3 — the explicit boundary list.
    ['Homeowners call five contractors.',                   'a count'],
    ['Contractors take three days to respond.',             'a duration'],
    ['Most homeowners struggle to find contractors.',       'prevalence'],
    ['Our customers were tired of calling around.',         'real customers'],
    ['Finally, I found someone I can trust.',               'a testimonial'],
    ['AllignX gets your project booked faster.',            'a product outcome'],
    ['AllignX is easier than Thumbtack.',                   'a comparison'],
    ['Get twice as many responses.',                        'a comparison'],
    ['Trusted by thousands.',                               'social proof'],
    ['The easiest way to find home-service professionals.', 'a superlative'],
    ['Providers are filling up fast.',                      'scarcity'],
    // The UNHEDGED absolutes must stay refused — the hedge exemption is narrow.
    ['You never get a callback.',                           'an absolute'],
    ['Contractors always disappear.',                       'an absolute'],
    // SECOND PERSON IS NOT A QUALIFIER. Found by an existing b3 test after the
    // first draft rescued this as framing: a pronoun does not turn a promised
    // result into a description of the reader's situation.
    ['Your funnel, unclogged.',                             'an outcome promise'],
    ['Your project, booked.',                               'an outcome promise'],
    ['Find someone today.',                                 'a guarantee'],
    ['Did you know 80% of homeowners call at least five contractors?', 'a number'],
  ])('refuses %s (%s)', (text) => {
    const v = framing(text);
    expect(v.eligible, `wrongly permitted as: ${v.qualifiedBy}`).toBe(false);
    expect(v.refusedBecause).toBeTruthy();
  });
});

// ── §22 N1/N2/N6 — syntax must not launder an assertion ─────────────────────
describe('§22 punctuation and hypotheticals launder nothing', () => {
  it('N1 — a question mark does not make a factual claim safe', () => {
    expect(framing('Did you know most homeowners call five contractors?').eligible).toBe(false);
    expect(framing('Homeowners wait three days, right?').eligible).toBe(false);
  });
  it('N2 — a hypothetical does not make a number safe', () => {
    expect(framing('Imagine saving three hours on your next project.').eligible).toBe(false);
    expect(framing('Imagine getting five quotes in one day.').eligible).toBe(false);
  });
  it('N6 — a rhetorical question does not make a prevalence claim safe', () => {
    expect(framing('Do most homeowners really hear back?').eligible).toBe(false);
    expect(framing('Why do contractors always disappear?').eligible).toBe(false);
  });
  it('N4 — a testimonial does not become framing by adding "you"', () => {
    expect(framing('You know the feeling — finally, I found someone I can trust.').eligible).toBe(false);
  });
  it('N4b — naming real customers is refused even in a shape that would qualify', () => {
    // DELIBERATELY SHAPED TO QUALIFY: second person AND a question, so gate 3
    // passes and only the real-customer disqualifier can refuse it. Without
    // this, removing that rule left every test green — the sentence in §3 was
    // being caught by the fail-closed default instead, so the rule itself was
    // never proven load-bearing.
    const v = framing('Are you tired of what our customers went through?');
    expect(v.eligible).toBe(false);
    expect(v.refusedBecause).toMatch(/real customers/i);
    expect(framing('Do their customers wait, like you?').eligible).toBe(false);
  });
  it('N5 — a performance claim does not become framing by sounding emotional', () => {
    expect(framing('You feel the relief of twice as many responses.').eligible).toBe(false);
    expect(framing('Feel your search time cut in half.').eligible).toBe(false);
  });
});

// ── §2 — this is not a marketing exemption ──────────────────────────────────
describe('§2 the class is narrow by construction', () => {
  it('only two claim categories are ever considered', () => {
    expect([...NARRATIVE_ELIGIBLE_CATEGORIES].sort())
      .toEqual(['OTHER_FACTUAL_CLAIM', 'OUTCOME_PROMISE']);
  });

  it.each([
    'CUSTOMER_COUNT', 'SOCIAL_PROOF', 'SUPERLATIVE', 'COMPARATIVE', 'EXCLUSIVITY',
    'QUANTIFIED_PERFORMANCE', 'FIRST_PARTY_PERFORMANCE', 'PRICING', 'GUARANTEE',
    'SCARCITY_URGENCY', 'CAPABILITY', 'SECURITY', 'COMPLIANCE_CERTIFICATION',
    'ENDORSEMENT', 'REGULATED_VERTICAL', 'LEGAL_APPROVAL', 'COMPETITOR_CLAIM',
    'GEOGRAPHIC_AVAILABILITY',
  ] as ClaimCategory[])('%s can never be rescued, however it is phrased', cat => {
    // Text that WOULD qualify on shape alone. The category alone must refuse it.
    expect(classifyNarrativeFraming('Is your home project waiting on you?', cat).eligible)
      .toBe(false);
  });

  it('fails closed on a sentence that is neither claim-shaped nor framing-shaped', () => {
    // No disqualifier fires, and no qualifier does either.
    const v = framing('Home services exist.');
    expect(v.eligible).toBe(false);
    expect(v.refusedBecause).toMatch(/statement of fact/i);
  });
});

// ── §22 N3/N8/N9 — provenance and the span rule ─────────────────────────────
function outcome(rows: Array<{ field: string; span: string; cat: ClaimCategory }>): GroundingOutcome {
  return {
    results: rows.map(r => ({
      claim: { field: r.field, textSpan: r.span, category: r.cat,
               sources: ['SEMANTIC'], disposition: 'REQUIRES_EVIDENCE' },
      verdict: 'UNSUPPORTED', support: [], reason: 'x',
      failure: 'EVIDENCE_DOES_NOT_MENTION_THIS',
    })) as GroundedClaimResult[],
    publishable: false, blockedReasons: [],
  };
}

describe('§22 adjudication is span-level and carries provenance', () => {
  it('N3 — a rescued line is never marked SUPPORTED', () => {
    const a = adjudicateNarrativeFraming(outcome([
      { field: 'primary_text', span: 'Still calling around?', cat: 'OTHER_FACTUAL_CLAIM' }]));
    expect(a.narrative).toHaveLength(1);
    expect(a.narrative[0].sourceType).toBe(NARRATIVE_SOURCE_TYPE);
    expect(a.narrative[0].evidenceRequired).toBe(false);
    expect(a.narrative[0].assertsMeasuredFact).toBe(false);
    expect(a.stillUnsupported).toHaveLength(0);
  });

  it('a span with ONE ineligible claim is not rescued by its eligible one', () => {
    // "Thousands of homeowners trust AllignX" fires twice in production: once as
    // CUSTOMER_COUNT and once as OTHER_FACTUAL_CLAIM. Per-claim adjudication
    // would rescue it through the second and ship it.
    const a = adjudicateNarrativeFraming(outcome([
      { field: 'primary_text', span: 'Is your project waiting?', cat: 'CUSTOMER_COUNT' },
      { field: 'primary_text', span: 'Is your project waiting?', cat: 'OTHER_FACTUAL_CLAIM' },
    ]));
    expect(a.narrative).toHaveLength(0);
    expect(a.stillUnsupported).toHaveLength(2);
    expect(a.refused[0].reason).toBeTruthy();
  });

  it('never touches PROHIBITED or NEEDS_OWNER_CONFIRMATION', () => {
    const g: GroundingOutcome = {
      results: [
        { claim: { field: 'f', textSpan: 'Still calling around?', category: 'OTHER_FACTUAL_CLAIM',
                   sources: ['SEMANTIC'], disposition: 'PROHIBITED_IN_3_5' },
          verdict: 'PROHIBITED', support: [], reason: 'x' },
        { claim: { field: 'f', textSpan: 'Is this for you?', category: 'OTHER_FACTUAL_CLAIM',
                   sources: ['SEMANTIC'], disposition: 'REQUIRES_OWNER_CONFIRMATION' },
          verdict: 'NEEDS_OWNER_CONFIRMATION', support: [], reason: 'x' },
      ] as GroundedClaimResult[],
      publishable: false, blockedReasons: [],
    };
    const a = adjudicateNarrativeFraming(g);
    expect(a.narrative).toHaveLength(0);
    expect(a.stillUnsupported).toHaveLength(0);   // neither was UNSUPPORTED
  });

  it('leaves SUPPORTED claims entirely alone', () => {
    const g: GroundingOutcome = {
      results: [{ claim: { field: 'f', textSpan: 'AllignX connects you with vetted professionals.',
                           category: 'CAPABILITY', sources: ['SEMANTIC'], disposition: 'REQUIRES_EVIDENCE' },
                  verdict: 'SUPPORTED', support: ['Your product profile'], reason: 'ok' }] as GroundedClaimResult[],
      publishable: true, blockedReasons: [],
    };
    const a = adjudicateNarrativeFraming(g);
    expect(a.narrative).toHaveLength(0);
    expect(a.stillUnsupported).toHaveLength(0);
  });
});

// ── §21 NEGATIVE CLAIM CONTROL ──────────────────────────────────────────────
describe('§21 the claim gate was not weakened', () => {
  it.each([
    'Trusted by 12,000 homeowners.',
    'Cut your wait by three days.',
    'Book a provider in minutes.',
    'Rated #1 for home services.',
    'Most homeowners prefer AllignX.',
    'Users save hours every week.',
    'Five times faster than calling around.',
    'Guaranteed response.',
    'Providers are available now.',
  ])('still blocked: %s', text => {
    // Tried in BOTH eligible categories — neither may rescue it.
    for (const cat of NARRATIVE_ELIGIBLE_CATEGORIES) {
      expect(classifyNarrativeFraming(text, cat).eligible,
        `${text} was permitted as ${cat}`).toBe(false);
    }
  });
});

describe('the patterns are linear', () => {
  it('a long hostile string does not hang the classifier', () => {
    const hostile = 'a '.repeat(4000) + '?';
    const t0 = Date.now();
    classifyNarrativeFraming(hostile, 'OTHER_FACTUAL_CLAIM');
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
