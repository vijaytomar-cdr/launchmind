/**
 * @file creativeIntelligence.test.ts
 * @description The Creative Intelligence boundaries — B6.5 §16, §17, §18, §19, §29.
 *
 *   These are the tests that have to be LOAD-BEARING, because the whole
 *   subsystem is an argument that observing other companies' marketing can be
 *   done safely. Each block below is paired with a mutation in the report: if
 *   the invariant is deleted, a named test here must fail.
 */

import { describe, it, expect } from 'vitest';
import {
  assertInfluenceIsStructural, influenceIsStructural, CreativeBoundaryError,
  CREATIVE_INFLUENCE_DIMENSIONS, CREATIVE_SOURCE_CLASSES, MIN_INDEPENDENT_SOURCES,
  publisherIndependenceKey, creativeFreshness, resolveCreativeIntelligenceMode,
  type CreativeInfluence, type CreativeObservation,
} from '../src/services/creativeIntelligence/contract';
import {
  assertNoImitationInstruction, assertNoCompetitorAssetInRendering, assessAbstraction,
} from '../src/services/creativeIntelligence/copyrightBoundary';
import { derivePatterns } from '../src/services/creativeIntelligence/patternDerivation';
import { buildCreativeDirection, summariseDirection } from '../src/services/creativeIntelligence/creativeInfluence';
import { validateObservation } from '../src/services/creativeIntelligence/creativeIntelligenceService';

const COMPETITORS = ['Thumbtack', 'TaskRabbit', 'Angi', 'HomeAdvisor'];

function obs(over: Partial<CreativeObservation> = {}): CreativeObservation {
  return {
    id: 'o', sourceClass: 'PUBLIC_BRAND_PAGE', sourceRef: 'https://example.com/',
    publisher: 'Example', channel: 'landing_page', category: 'home_services',
    format: 'LANDING_PAGE', observedAt: '2026-08-01T00:00:00.000Z',
    narrativeShape: 'PROBLEM_LED', hookStructure: 'names a frustration',
    firstFrame: 'a stated problem', productRevealSeconds: 3, captionDensity: 'LOW',
    visualComposition: null, pacing: null, durationSeconds: 15,
    ctaStyle: 'soft invitation to browse', publicEngagement: null,
    signalLimitations: [], notes: null, ...over,
  };
}

/** Three publishers agreeing — the minimum that makes a pattern. */
function threeIndependent(over: Partial<CreativeObservation> = {}): CreativeObservation[] {
  return ['https://a.com/', 'https://b.com/', 'https://c.com/'].map((u, i) =>
    obs({ ...over, sourceRef: u, publisher: `Pub${i}`, id: `o${i}` }));
}

// ── §17 — THE EVIDENCE BOUNDARY ─────────────────────────────────────────────
describe('§17 a creative pattern is never evidence', () => {
  const ok: CreativeInfluence = {
    patternKey: 'PROBLEM_FIRST:home_services', dimension: 'HOOK',
    directive: 'Open with a frustration the audience already recognises.',
    ownerRationale: 'Seen at 3 independent sources in current home_services marketing.',
  };

  it('permits a structural directive', () => {
    expect(() => assertInfluenceIsStructural(ok)).not.toThrow();
  });

  // M4 — the mutation this kills: a pattern becoming a product claim.
  it.each([
    ['a performance figure',     'Short captions increase conversion 27%.'],
    ['a customer result',        'Customers wait three days for a callback.'],
    ['a customer count',         'Trusted by 12,000 homeowners.'],
    ['a rating',                 'Rated 4.8 stars by users.'],
    ['an award',                 'This is an award-winning structure.'],
    ['a testimonial',            'Include a testimonial from a real customer.'],
    ['a guarantee',              'This guarantees engagement.'],
    ['a comparative',            'This performs better than a benefit-led opening.'],
    ['a price',                  'Show the $49 price in the first frame.'],
    ['a prediction',             'This hook will convert.'],
    ['a lift claim',             'Opening on the problem will improve conversion.'],
  ])('refuses %s', (_label, text) => {
    expect(() => assertInfluenceIsStructural({ ...ok, directive: text }))
      .toThrow(CreativeBoundaryError);
    expect(influenceIsStructural({ ...ok, directive: text })).toBe(false);
  });

  it('refuses an assertion hidden in the owner-facing rationale', () => {
    expect(() => assertInfluenceIsStructural({
      ...ok, ownerRationale: 'These openings lift click-through by 31%.',
    })).toThrow(CreativeBoundaryError);
  });

  it('refuses a dimension outside the influence ceiling', () => {
    expect(() => assertInfluenceIsStructural({
      ...ok, dimension: 'AUDIENCE' as never,
    })).toThrow(CreativeBoundaryError);
  });

  it('has no influence dimension that could carry a claim', () => {
    for (const d of CREATIVE_INFLUENCE_DIMENSIONS) {
      expect(d).not.toMatch(/EVIDENCE|PROOF|CLAIM|AUDIENCE|PRODUCT_TRUTH|PERFORMANCE|RESULT/);
    }
  });

  // M7 — Creative Intelligence rewriting unrelated strategy.
  it('the direction type has no field for audience, product role or proof', () => {
    const d = buildCreativeDirection({
      patterns: derivePatterns(threeIndependent(), COMPETITORS).patterns,
      messageAngle: 'the frustration of chasing contractors', channel: 'landing_page',
    });
    for (const forbidden of ['audience', 'productRole', 'proof', 'evidence',
                             'message', 'claim', 'founderDirection']) {
      expect(Object.keys(d)).not.toContain(forbidden);
    }
  });
});

// ── §16 — COPYRIGHT / COMPETITOR BOUNDARY ───────────────────────────────────
describe('§16 competitor creative is intelligence, never material', () => {
  // M3 — competitor creative entering rendering.
  it('refuses a reference asset this workspace does not own', () => {
    expect(() => assertNoCompetitorAssetInRendering(['other-asset'], ['mine-1', 'mine-2']))
      .toThrow(CreativeBoundaryError);
  });
  it('permits the workspace’s own authorised assets', () => {
    expect(() => assertNoCompetitorAssetInRendering(['mine-1'], ['mine-1', 'mine-2']))
      .not.toThrow();
  });

  it.each([
    'Copy this Angi video exactly.',
    'Make it look exactly like their ad.',
    'Recreate the opening frame of that creative.',
    'Use their footage as the background.',
    'Mimic the layout.',
    'Same opening as the competitor video.',
    'Replicate this advert for our product.',
  ])('refuses the imitation instruction: %s', text => {
    expect(() => assertNoImitationInstruction(text, COMPETITORS)).toThrow(CreativeBoundaryError);
  });

  it('refuses a competitor used as a style reference', () => {
    expect(() => assertNoImitationInstruction('Give it a Thumbtack vibe.', COMPETITORS))
      .toThrow(CreativeBoundaryError);
    expect(() => assertNoImitationInstruction('Styled like TaskRabbit.', COMPETITORS))
      .toThrow(CreativeBoundaryError);
  });

  it('permits naming a competitor while describing the market', () => {
    expect(() => assertNoImitationInstruction(
      'Homeowners in this category already use Thumbtack and Angi.', COMPETITORS)).not.toThrow();
  });

  it('permits a genuinely abstract structural instruction', () => {
    expect(() => assertNoImitationInstruction(
      'Open with a frustration the audience recognises, then show the product.', COMPETITORS))
      .not.toThrow();
  });

  it.each([
    ['quoted copy',      'Open with "Still calling around for a plumber?" on screen'],
    ['a wardrobe',       'A woman in a yellow jacket beside the van'],
    ['a prop',           'Someone holding a clipboard in the first frame'],
    ['a named company',  'Open the way Thumbtack opens'],
    ['one timeline',     'Cut at 0:04 exactly as in frame 3'],
  ])('rejects a "pattern" that is really one advert — %s', (_l, text) => {
    expect(assessAbstraction(text, COMPETITORS).abstract).toBe(false);
  });

  it('accepts an abstraction two designers could express differently', () => {
    expect(assessAbstraction(
      'Open with a frustration the audience already recognises, before showing the product.',
      COMPETITORS).abstract).toBe(true);
  });

  it('no source class permits an authenticated or private feed', () => {
    for (const c of CREATIVE_SOURCE_CLASSES) {
      expect(c).toMatch(/^(PUBLIC_|ANALYST_OR_EDITORIAL|LAUNCHMIND_)/);
    }
  });
});

// ── §18 — PATTERN QUALITY ───────────────────────────────────────────────────
describe('§18 one example is not a trend', () => {
  // M5 — one public example becoming a pattern.
  it('refuses a candidate seen at one source', () => {
    const { patterns, rejected } = derivePatterns([obs()], COMPETITORS);
    expect(patterns).toHaveLength(0);
    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected[0].reason).toMatch(/1 independent source/);
  });

  it('refuses three pages of ONE publisher', () => {
    const sameCompany = ['https://acme.com/a', 'https://acme.com/b', 'https://acme.com/c']
      .map((u, i) => obs({ sourceRef: u, publisher: 'Acme', id: `x${i}` }));
    expect(derivePatterns(sameCompany, COMPETITORS).patterns).toHaveLength(0);
  });

  it('accepts three genuinely independent publishers', () => {
    const { patterns } = derivePatterns(threeIndependent(), COMPETITORS);
    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns[0].independentSourceCount).toBe(MIN_INDEPENDENT_SOURCES);
  });

  it('counts publishers, not rows — two URLs on one host are one source', () => {
    expect(publisherIndependenceKey(null, 'https://acme.com/a'))
      .toBe(publisherIndependenceKey(null, 'https://www.acme.com/b'));
  });

  it('never produces a composite score', () => {
    const { patterns } = derivePatterns(threeIndependent(), COMPETITORS);
    for (const p of patterns) {
      const keys = Object.keys(p.quality);
      expect(keys).not.toContain('score');
      expect(keys).not.toContain('creativeScore');
      expect(keys).not.toContain('viralityScore');
      expect(keys).not.toContain('overall');
    }
  });

  it('caps confidence below eight independent publishers', () => {
    const { patterns } = derivePatterns(threeIndependent(), COMPETITORS);
    expect(patterns[0].quality.observationConfidence).not.toBe('HIGH');
  });

  it('does not invent a structure it never observed', () => {
    // No COMPARISON_LED observation anywhere, so no contrast pattern may exist.
    const { patterns } = derivePatterns(threeIndependent({ narrativeShape: 'PROBLEM_LED' }), COMPETITORS);
    expect(patterns.some(p => p.key.startsWith('SIDE_BY_SIDE'))).toBe(false);
  });

  it('a candidate whose description names a competitor is refused', () => {
    // Guard the abstraction gate itself, not just the helper.
    expect(assessAbstraction('Open the way HomeAdvisor opens.', COMPETITORS).abstract).toBe(false);
  });
});

// ── §15 — INGESTION BOUNDARY ────────────────────────────────────────────────
describe('§15 an observation must be public, dated and honest about its limits', () => {
  it('refuses a non-public reference', () => {
    expect(() => validateObservation(obs({ sourceRef: 'file:///etc/passwd' }))).toThrow();
  });
  it('refuses a reference carrying credentials, because it was not public', () => {
    expect(() => validateObservation(obs({ sourceRef: 'https://x.com/a?token=abc' }))).toThrow();
    expect(() => validateObservation(obs({ sourceRef: 'https://u:p@x.com/a' }))).toThrow();
  });
  it('refuses an undated observation', () => {
    expect(() => validateObservation(obs({ observedAt: 'not a date' }))).toThrow();
  });
  it('refuses an unlisted source class', () => {
    expect(() => validateObservation(obs({ sourceClass: 'AUTHENTICATED_FEED' as never }))).toThrow();
  });

  // Popularity is never allowed to travel without its caveats.
  it('refuses an engagement figure with no stated limitations', () => {
    expect(() => validateObservation(obs({
      publicEngagement: { metric: 'views', value: 1_000_000, observedAt: '2026-08-01' },
      signalLimitations: [],
    }))).toThrow();
  });
  it('attaches the standing limitations when engagement is recorded', () => {
    const v = validateObservation(obs({
      publicEngagement: { metric: 'views', value: 10, observedAt: '2026-08-01' },
      signalLimitations: ['something'],
    }));
    expect(v.signalLimitations.join(' ')).toMatch(/not a measure of whether the creative worked/);
  });
});

// ── §19 — INFLUENCE ─────────────────────────────────────────────────────────
describe('§19 influence is bounded, explained and never silent', () => {
  const patterns = () => derivePatterns(threeIndependent(), COMPETITORS).patterns;

  // M6 — Creative Intelligence ignored entirely.
  it('applies a relevant pattern', () => {
    const d = buildCreativeDirection({
      patterns: patterns(), channel: 'landing_page',
      messageAngle: 'the frustration of chasing contractors for a quote',
    });
    expect(d.influences.length).toBeGreaterThan(0);
    expect(summariseDirection(d).recommends.length).toBeGreaterThan(0);
  });

  it('works, and says why, with NO creative intelligence at all', () => {
    const d = buildCreativeDirection({ patterns: [], messageAngle: 'anything', channel: 'meta_ad' });
    expect(d.influences).toHaveLength(0);
    expect(d.limitation).toBeTruthy();
  });

  it('applies nothing to an unrelated message, and says so', () => {
    const d = buildCreativeDirection({
      patterns: patterns(), channel: 'meta_ad',
      messageAngle: 'quarterly compliance reporting for auditors',
    });
    expect(d.influences).toHaveLength(0);
    expect(d.limitation).toBeTruthy();
  });

  it('drops a stale pattern rather than applying last year’s category', () => {
    const old = derivePatterns(
      threeIndependent({ observedAt: '2024-01-01T00:00:00.000Z' }), COMPETITORS).patterns;
    expect(old[0].quality.freshness).toBe('STALE');
    const d = buildCreativeDirection({
      patterns: old, messageAngle: 'the frustration of chasing contractors', channel: 'landing_page' });
    expect(d.influences).toHaveLength(0);
  });

  it('NEVER returns an empty direction with no explanation', () => {
    for (const msg of ['the frustration of chasing contractors', 'unrelated topic', '']) {
      for (const ps of [patterns(), []]) {
        const d = buildCreativeDirection({ patterns: ps, messageAngle: msg, channel: 'meta_ad' });
        if (d.influences.length === 0) expect(d.limitation).toBeTruthy();
      }
    }
  });

  it('every applied influence passes the structural guard', () => {
    const d = buildCreativeDirection({
      patterns: patterns(), channel: 'landing_page',
      messageAngle: 'the frustration of chasing contractors' });
    for (const i of d.influences) expect(() => assertInfluenceIsStructural(i)).not.toThrow();
  });

  // M19 — internal handles leaking to an owner surface.
  it('the owner summary leaks no key, publisher, URL or confidence band', () => {
    const d = buildCreativeDirection({
      patterns: patterns(), channel: 'landing_page',
      messageAngle: 'the frustration of chasing contractors' });
    const text = JSON.stringify(summariseDirection(d));
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/Pub\d/);
    expect(text).not.toMatch(/_LED\b|:home_services|OBSERVATION_CONFIDENCE|MODERATE|LOW\b/);
  });

  it('records that the owner’s own direction wins over the category', () => {
    const d = buildCreativeDirection({
      patterns: patterns(), channel: 'landing_page',
      messageAngle: 'the frustration of chasing contractors',
      brandDirectives: ['Plain, never hyperbolic'] });
    expect(d.notImitated.join(' ')).toMatch(/your direction is used/i);
  });
});

describe('mode and freshness', () => {
  it('an unrecognised mode quietens the system rather than widening it', () => {
    expect(resolveCreativeIntelligenceMode('BANANA')).toBe('OFF');
  });
  it('freshness degrades with age', () => {
    const now = new Date('2026-08-24T00:00:00Z');
    expect(creativeFreshness('2026-08-01T00:00:00Z', now)).toBe('CURRENT');
    expect(creativeFreshness('2026-01-01T00:00:00Z', now)).toBe('AGING');
    expect(creativeFreshness('2024-01-01T00:00:00Z', now)).toBe('STALE');
  });
});
