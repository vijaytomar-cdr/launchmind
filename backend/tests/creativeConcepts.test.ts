/**
 * @file creativeConcepts.test.ts
 * @description §8/§9 — three hypotheses, and the check that they stay three.
 */
import { describe, it, expect } from 'vitest';
import {
  CONCEPTS, CONCEPT_KEYS, DISTINCTNESS_DIMENSIONS, MIN_DIFFERING_DIMENSIONS,
  assertConceptsDistinct, copyIsDistinct, type ConceptShape,
} from '../src/services/content/creativeConcepts';

const ALL = CONCEPT_KEYS.map(k => CONCEPTS[k]);

describe('§8 the three concepts are different arguments', () => {
  it('all six dimensions genuinely separate them', () => {
    const v = assertConceptsDistinct(ALL);
    expect(v.distinct).toBe(true);
    expect(v.collapsedDimensions).toEqual([]);
    expect(v.differingDimensions).toHaveLength(DISTINCTNESS_DIMENSIONS.length);
  });

  it('each concept puts the product in a different place in the argument', () => {
    expect(new Set(ALL.map(c => c.productProminence)).size).toBe(3);
    expect(new Set(ALL.map(c => c.messageStructure)).size).toBe(3);
    expect(new Set(ALL.map(c => c.hookType)).size).toBe(3);
  });

  it('no concept guidance permits a measured outcome', () => {
    for (const c of ALL) {
      expect(c.guidance).not.toMatch(/\d/);
      expect(c.guidance).not.toMatch(/\bfaster\b|\bmore\b.*\bthan\b|\bbest\b/i);
    }
  });
});

describe('§9 near-identical versions are refused', () => {
  const base = CONCEPTS.PROBLEM_RECOGNITION;

  it('rejects three that differ only in layout', () => {
    const shapes: ConceptShape[] = [
      { ...base, key: 'PROBLEM_RECOGNITION', layout: 'PROBLEM_FRAME' },
      { ...base, key: 'PRODUCT_DEMONSTRATION', layout: 'PRODUCT_HERO' },
      { ...base, key: 'RELIEF', layout: 'RELIEF_FRAME' },
    ];
    const v = assertConceptsDistinct(shapes);
    expect(v.distinct).toBe(false);
    expect(v.differingDimensions).toEqual(['layout']);
    expect(v.reason).toMatch(/same argument/i);
  });

  it('rejects a set where only two of three differ on a dimension', () => {
    const shapes: ConceptShape[] = [
      { ...base, layout: 'PROBLEM_FRAME', hookType: 'PROBLEM_FIRST' },
      { ...base, layout: 'PRODUCT_HERO', hookType: 'PRODUCT_FIRST' },
      // Third repeats the first's hook: the dimension did not separate the set.
      { ...base, layout: 'RELIEF_FRAME', hookType: 'PROBLEM_FIRST' },
    ];
    const v = assertConceptsDistinct(shapes);
    expect(v.collapsedDimensions).toContain('hookType');
    expect(v.distinct).toBe(false);
  });

  it('the floor is above "a background and a headline swap"', () => {
    // Two differing dimensions must NOT be enough.
    expect(MIN_DIFFERING_DIMENSIONS).toBeGreaterThan(2);
  });

  it('refuses to compare a set of one', () => {
    expect(assertConceptsDistinct([base]).distinct).toBe(false);
  });

  it('produces no composite score', () => {
    const v = assertConceptsDistinct(ALL) as Record<string, unknown>;
    for (const k of ['score', 'rank', 'winner', 'best', 'predicted']) {
      expect(Object.keys(v)).not.toContain(k);
    }
  });
});

describe('§9 wording variants are not concepts', () => {
  it('catches three paraphrases of one headline', () => {
    const v = copyIsDistinct([
      'Home service without the calling around',
      'Home services without all the calling around',
      'Home service, without calling around',
    ]);
    expect(v.distinct).toBe(false);
    expect(v.overlap).toBeGreaterThan(0.7);
  });

  it('accepts genuinely different headlines', () => {
    const v = copyIsDistinct([
      "Your search shouldn't start on hold",
      'Meet AllignX for Home Services',
      'Home projects, your way',
    ]);
    expect(v.distinct).toBe(true);
  });

  // The three headlines this pass actually produced.
  it('the real AllignX headlines are distinct', () => {
    expect(copyIsDistinct([
      "Your search shouldn't start on hold",
      'Meet AllignX for Home Services',
      'Home projects, your way',
    ]).overlap).toBeLessThan(0.5);
  });
});
