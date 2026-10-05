/**
 * @file productCapability.test.ts
 * @description §3–§8 — what LaunchMind may say the product does.
 *
 *   The AllignX description is the real one, verbatim, so this suite measures
 *   the actual contract rather than a convenient stand-in.
 */
import { describe, it, expect } from 'vitest';
import {
  buildProductCapabilityContract, capabilityDirective,
  findCapabilityViolations, validatePayloadCapabilities,
} from '../src/services/content/productCapabilityContract';
import { overlapIsInsufficient, adjudicateNarrativeFraming }
  from '../src/services/content/narrativeFramingPolicy';
import type { ProductContentContext } from '../src/services/content/productContentContext';
import type { GroundingOutcome, GroundedClaimResult }
  from '../src/services/content/threeSignalClaimDiscovery';

const ALLIGNX_DESC =
  'Connect with trusted, vetted home service professionals in your neighborhood — ' +
  'quickly, safely, and conveniently.';

function ctxOf(over: { description?: string | null; tagline?: string; taglineConfirmed?: boolean } = {}) {
  return {
    application: { name: 'AllignX', category: 'Productivity', markets: ['united_states'],
      description: over.description === undefined ? ALLIGNX_DESC : over.description },
    brand: { fields: over.tagline ? {
      tagline: { fieldKey: 'tagline', value: over.tagline,
        ownerConfirmed: over.taglineConfirmed !== false },
    } : {}, missing: [] },
  } as unknown as ProductContentContext;
}

const CONTRACT = buildProductCapabilityContract(ctxOf());

describe('§3 extraction is conservative', () => {
  it('derives only what the description actually says', () => {
    expect(CONTRACT.capabilities.map(c => c.verb)).toEqual(['connect']);
    expect(CONTRACT.empty).toBe(false);
  });

  it('takes the qualifiers the description itself uses', () => {
    expect(CONTRACT.qualifiers).toContain('trusted');
    expect(CONTRACT.qualifiers).toContain('vetted');
    expect(CONTRACT.qualifiers).toContain('neighborhood');
  });

  it.each(['compare', 'book', 'schedule', 'message', 'quote', 'pay',
           'track', 'manage', 'match', 'request', 'review', 'hire', 'browse', 'find'])
    ('does not derive "%s" from a description that never says it', verb => {
      expect(CONTRACT.capabilities.map(c => c.verb)).not.toContain(verb);
      expect(CONTRACT.unsupportedOrUnknown).toContain(verb);
    });

  it('a safety assertion needs the owner even when the page says it', () => {
    // A scraped page calling professionals "background-checked" is that page's
    // claim. Repeating it in an advert would make it LaunchMind's.
    const c = buildProductCapabilityContract(
      ctxOf({ description: 'Connect with background-checked, licensed professionals.' }));
    expect(c.qualifiers).not.toContain('background-checked');
    expect(c.qualifiers).not.toContain('licensed');
  });

  it('an OWNER-CONFIRMED tagline may establish one', () => {
    const c = buildProductCapabilityContract(ctxOf({
      description: 'Connect with professionals.',
      tagline: 'Every professional is background-checked.', taglineConfirmed: true }));
    expect(c.qualifiers).toContain('background-checked');
  });

  it('an OBSERVED tagline may not — brand is not evidence', () => {
    const c = buildProductCapabilityContract(ctxOf({
      description: 'Connect with professionals.',
      tagline: 'Compare every licensed pro instantly.', taglineConfirmed: false }));
    expect(c.capabilities.map(x => x.verb)).not.toContain('compare');
    expect(c.qualifiers).not.toContain('licensed');
  });

  it('no description means no capability may be stated at all', () => {
    const c = buildProductCapabilityContract(ctxOf({ description: null }));
    expect(c.empty).toBe(true);
    expect(capabilityDirective(c)).toMatch(/do NOT state any capability/i);
  });

  // C2 — category must never become a capability.
  it('the product category contributes nothing', () => {
    const a = buildProductCapabilityContract(ctxOf());
    const b = buildProductCapabilityContract({
      ...ctxOf(), application: { ...ctxOf().application, category: 'Shopping' },
    } as unknown as ProductContentContext);
    expect(b.capabilities.map(c => c.verb)).toEqual(a.capabilities.map(c => c.verb));
  });
});

describe('§5 the directive names both sides of the boundary', () => {
  it('states what may be said and what must not be invented', () => {
    const d = capabilityDirective(CONTRACT);
    expect(d).toMatch(/PRODUCT TRUTH YOU MAY STATE/);
    expect(d).toMatch(/MUST NOT INVENT/);
    expect(d).toMatch(/connect/);
    expect(d).toMatch(/compare/);
    expect(d).toMatch(/in one place/i);
  });
  it('is generated, never hardcoded to one product', () => {
    const other = buildProductCapabilityContract(
      ctxOf({ description: 'Book and pay for cleaning in seconds.' }));
    const d = capabilityDirective(other);
    expect(d).toMatch(/book/);
    expect(d).toMatch(/pay/);
    expect(d).not.toMatch(/AllignX/);
  });
});

// ── §8 ADVERSARIAL ──────────────────────────────────────────────────────────
describe('§8 supported wording passes', () => {
  it.each([
    'Connect with vetted home-service professionals.',
    'AllignX connects homeowners with home service professionals.',
    'Connecting you with trusted professionals in your neighborhood.',
  ])('permits: %s', text => {
    expect(findCapabilityViolations(text, CONTRACT)).toEqual([]);
  });
});

describe('§8 unsupported wording is refused', () => {
  it.each([
    ['Compare providers.',                      'compare'],
    ['Compare quotes.',                         'compare'],
    ['Book a provider.',                        'book'],
    ['Book instantly.',                         'book'],
    ['Schedule service.',                       'schedule'],
    ['Track your provider.',                    'track'],
    ['Message providers.',                      'message'],
    ['Pay in the app.',                         'pay'],
    ['Choose the lowest price.',                'price'],
    ['Get matched instantly.',                  'match'],
    ['Get multiple bids.',                      'quote'],
    ['All your home projects in one dashboard.','manage'],
    // §8 "plausible adjacent language" — NOT assumed equivalent to "connect".
    ['Browse local pros.',                      'browse'],
    ['Discover local pros.',                    'browse'],
    ['Reach out to local pros.',                'reach'],
    ['Request service.',                        'request'],
    ['Find local home-service professionals through AllignX.', 'find'],
  ])('refuses %s', (text, verb) => {
    const v = findCapabilityViolations(text, CONTRACT);
    expect(v.length, `"${text}" was permitted`).toBeGreaterThan(0);
    expect(v.map(x => x.verb)).toContain(verb);
  });

  it.each([
    'Everything you need in one place.',
    'Your all-in-one home services app.',
    'One app for everything around the house.',
    'End-to-end home project management.',
  ])('refuses the breadth claim: %s', text => {
    expect(findCapabilityViolations(text, CONTRACT).length).toBeGreaterThan(0);
  });

  it.each(['Background-checked professionals.', 'Licensed and insured pros.',
           'See real-time availability.', 'Read verified reviews.'])
    ('refuses the unsupported qualifier or feature: %s', text => {
      expect(findCapabilityViolations(text, CONTRACT).length).toBeGreaterThan(0);
    });

  // C4/C5 — a capability must not enter through a field nobody checks.
  it('checks every owner-visible field, not just the body', () => {
    for (const field of ['headline', 'primaryText', 'description']) {
      const v = validatePayloadCapabilities({ [field]: 'Compare local pros.' }, CONTRACT);
      expect(v.length, `${field} was not validated`).toBeGreaterThan(0);
    }
  });

  it('an action attributed to the READER is not a product capability', () => {
    // The dominant blocking failure of the B6.7 concept sets. "Your search" is
    // the reader's afternoon, not a product feature.
    expect(findCapabilityViolations(
      'If your search for help starts with hold music, there is another way.',
      CONTRACT)).toEqual([]);
  });

  it('but the product doing it is still refused', () => {
    for (const text of [
      'AllignX searches for pros near you.',
      'Search for vetted pros.',
      'You can search local professionals.',
      'Search and compare in the app.',
    ]) {
      expect(findCapabilityViolations(text, CONTRACT).length,
        `"${text}" was permitted`).toBeGreaterThan(0);
    }
  });

  // ── §3 CAPABILITY SUBJECT BOUNDARY ────────────────────────────────────
  //
  // The B6.7 reader-attribution exclusion had to be proven not to be a
  // laundering route. Six of these UNSAFE lines passed the first version of it.
  describe('§3 a possessive does not launder a product claim', () => {
    it.each([
      'If your search for help starts with hold music...',
      'If finding help feels harder than it should...',
      'Still trying to figure out who to call?',
      'Does getting help for a home project have to feel this complicated?',
    ])('permits situational framing: %s', text => {
      expect(findCapabilityViolations(text, CONTRACT)).toEqual([]);
    });

    it.each([
      'AllignX searches for professionals.',
      'Search for professionals with AllignX.',
      'You can search for professionals.',
      'AllignX lets you find professionals.',
      'Find professionals with AllignX.',
      'Browse professionals in AllignX.',
      'Compare professionals in AllignX.',
      'Book a professional with AllignX.',
      // MEASURED HOLES. All six passed the first exclusion: a possessive noun
      // plus a passive completion asserts the PRODUCT performs the action.
      'Your booking is confirmed instantly.',
      'Your payment is processed instantly.',
      'Your quote arrives instantly.',
      'Your appointment is scheduled automatically.',
      'Your request is matched automatically.',
      'Your professional is selected automatically.',
      // Rhetorical wrappers must not launder it either.
      'What if your booking were confirmed instantly?',
      'Imagine your quote arriving instantly.',
      "Wouldn't it be easier if AllignX matched you automatically?",
    ])('refuses the product claim: %s', text => {
      expect(findCapabilityViolations(text, CONTRACT).length,
        `"${text}" was permitted`).toBeGreaterThan(0);
    });

    it('a mixed sentence is still caught', () => {
      // The possessive span is removed; a bare product-attributed use survives.
      expect(findCapabilityViolations(
        'Your search starts here. Search for pros now.', CONTRACT).length)
        .toBeGreaterThan(0);
    });
  });

  it('the real observed invention is refused', () => {
    // The exact phrase that motivated this phase.
    const v = validatePayloadCapabilities(
      { primaryText: 'AllignX lets you search, compare, and reach out in one place.' },
      CONTRACT);
    expect(v.map(x => x.verb)).toEqual(expect.arrayContaining(['find', 'compare']));
  });
});

// ── §7 TOKEN OVERLAP ────────────────────────────────────────────────────────
describe('§7 token overlap is not grounding for behaviour statements', () => {
  const SPAN = 'Still calling around trying to find someone for your home project?';

  it('the motivating case is no longer SUPPORTED by shared nouns', () => {
    const v = overlapIsInsufficient(SPAN, 'OTHER_FACTUAL_CLAIM', ['Your product profile']);
    expect(v.insufficient).toBe(true);
  });

  it('it becomes NARRATIVE_FRAMING, with honest provenance', () => {
    const g: GroundingOutcome = {
      results: [{ claim: { field: 'primary_text', textSpan: SPAN,
                           category: 'OTHER_FACTUAL_CLAIM', sources: ['SEMANTIC'],
                           disposition: 'REQUIRES_EVIDENCE' },
                  verdict: 'SUPPORTED', support: ['Your product profile'],
                  reason: 'ok' }] as GroundedClaimResult[],
      publishable: true, blockedReasons: [],
    };
    const a = adjudicateNarrativeFraming(g);
    expect(a.narrative).toHaveLength(1);
    expect(a.narrative[0].evidenceRequired).toBe(false);
    expect(a.narrative[0].assertsMeasuredFact).toBe(false);
  });

  it('a behaviour statement carrying a number stays unsupported', () => {
    const g: GroundingOutcome = {
      results: [{ claim: { field: 'primary_text',
                           textSpan: 'Homeowners call five contractors for a home project.',
                           category: 'OTHER_FACTUAL_CLAIM', sources: ['SEMANTIC'],
                           disposition: 'REQUIRES_EVIDENCE' },
                  verdict: 'SUPPORTED', support: ['Your product profile'],
                  reason: 'ok' }] as GroundedClaimResult[],
      publishable: true, blockedReasons: [],
    };
    const a = adjudicateNarrativeFraming(g);
    expect(a.narrative).toHaveLength(0);
    expect(a.stillUnsupported).toHaveLength(1);
  });

  it('a CAPABILITY grounded on the description is left alone', () => {
    // DELIBERATELY CONTAINS "people" — a token the post-check treats as a
    // behaviour signal. The first version of this test used a span with no such
    // token, so widening POST_CHECK_CATEGORIES to include CAPABILITY changed
    // nothing and the mutation survived. A guard is only proven by a case that
    // would trip it if the guard moved.
    const v = overlapIsInsufficient(
      'AllignX connects people with vetted professionals',
      'CAPABILITY', ['Your product profile']);
    expect(v.insufficient).toBe(false);
  });

  it('real evidence backing a behaviour statement is left alone', () => {
    const v = overlapIsInsufficient(
      'Customers waited for callbacks', 'OTHER_FACTUAL_CLAIM', ['Your campaign performance']);
    expect(v.insufficient).toBe(false);
  });

  it('can only ever make a verdict stricter', () => {
    const g: GroundingOutcome = {
      results: [{ claim: { field: 'f', textSpan: 'Compare local pros.', category: 'CAPABILITY',
                           sources: ['SEMANTIC'], disposition: 'REQUIRES_EVIDENCE' },
                  verdict: 'UNSUPPORTED', support: [], reason: 'x' }] as GroundedClaimResult[],
      publishable: false, blockedReasons: [],
    };
    const a = adjudicateNarrativeFraming(g);
    expect(a.narrative).toHaveLength(0);          // C9 — framing cannot swallow it
    expect(a.stillUnsupported).toHaveLength(1);
  });
});

describe('negation-aware qualifier + capability checks — deny the claim, not the word', () => {
  // MEASURED on the real AllignX Plumbing run: this exact sentence was
  // rejected as if it asserted "verified", when its entire purpose is to
  // deny that LaunchMind verified anything. Negation is now computed by the
  // ONE shared primitive in assertionContext.ts (isExplicitlyDenied),
  // reused by copyClaimClassifier.ts's lexicon matcher as well — see
  // assertionContext.test.ts for the primitive's own unit tests.
  const REAL_REFUSED_SENTENCE = 'those qualities characterize who they are, ' +
    'not a process or promise LaunchMind has verified';

  it('explicit local negation of the real refused sentence now passes', () => {
    expect(findCapabilityViolations(REAL_REFUSED_SENTENCE, CONTRACT)).toEqual([]);
  });

  it.each([
    'LaunchMind has not verified this',
    'This is not verified by LaunchMind',
    'We do not claim this is verified',
  ])('explicit local negation passes: %s', (text) => {
    expect(findCapabilityViolations(text, CONTRACT)).toEqual([]);
  });

  it.each([
    'LaunchMind verified this',
    'verified professionals',
    'our verified network',
    'professionals verified by LaunchMind',
  ])('a bare positive verification claim still fails: %s', (text) => {
    expect(findCapabilityViolations(text, CONTRACT).map(v => v.verb)).toContain('qualifier:verified');
  });

  it('a "not" governing a DIFFERENT clause does not suppress a real positive claim', () => {
    const text = "We don't do things halfway. Professionals are verified before they join.";
    expect(findCapabilityViolations(text, CONTRACT).map(v => v.verb)).toContain('qualifier:verified');
  });

  it('a "not" before an em dash does not reach across it into a new clause', () => {
    const text = "We don't do things halfway — verified professionals handle every job.";
    expect(findCapabilityViolations(text, CONTRACT).map(v => v.verb)).toContain('qualifier:verified');
  });

  it('a mixed text — one denied occurrence and one bare occurrence — still fails', () => {
    // Mirrors the file's own reader-attribution rule: EVERY occurrence must be
    // exempt, or the violation stands.
    const text = 'LaunchMind has not verified pricing. Our professionals are verified.';
    expect(findCapabilityViolations(text, CONTRACT).map(v => v.verb)).toContain('qualifier:verified');
  });

  it('vetting/mechanism protection is unaffected by the negation exemption', () => {
    const text = "gone through the platform's vetting process";
    expect(findCapabilityViolations(text, CONTRACT).map(v => v.verb)).toContain('vet');
  });

  it('a supported qualifier ("vetted") is still never flagged, negated or not', () => {
    expect(findCapabilityViolations('Connect with trusted, vetted professionals nearby.', CONTRACT))
      .toEqual([]);
  });

  // The CAPABILITY VERB loop gained the same shared exemption today — it
  // previously had ONLY the reader-attribution exemption, with no way to
  // recognize an explicit denial of a capability the product does not have.
  it('an explicitly denied capability verb ("availability") does not violate', () => {
    const text = 'This does not mean a provider will be instantly available.';
    expect(findCapabilityViolations(text, CONTRACT).map(v => v.verb)).not.toContain('availability');
  });

  it('a bare positive capability claim ("available") still fails', () => {
    expect(findCapabilityViolations('Providers are available instantly.', CONTRACT).map(v => v.verb))
      .toContain('availability');
  });

  it('vetting/mechanism protection is unaffected: a positive vetting claim still fails ' +
     'even in a sentence that also contains an unrelated negation', () => {
    const text = "We don't rush the process. Professionals go through the platform's vetting process.";
    expect(findCapabilityViolations(text, CONTRACT).map(v => v.verb)).toContain('vet');
  });
});
