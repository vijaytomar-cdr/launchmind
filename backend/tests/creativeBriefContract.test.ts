import { describe, expect, it } from 'vitest';
import { buildCreativeBriefContract, normalizeCreativeObjective }
  from '../src/services/content/creativeBriefContract';
import { CONCEPTS } from '../src/services/content/creativeConcepts';

describe('creative brief contract', () => {
  it.each([['increase qualified reach', 'REACH'], ['drive installs', 'INSTALLS'],
    ['increase bookings', 'BOOKINGS'], ['get more qualified leads', 'LEADS']])(
    'normalizes %s to %s', (raw, expected) => expect(normalizeCreativeObjective(raw)).toBe(expected));

  it('carries strategy, truth, assets, channel and experiment intent without granting authority', () => {
    const brief = buildCreativeBriefContract({
      brief: { channel: 'META_AD', contentFamily: 'ACQUISITION', audience: 'Homeowners',
        objective: 'increase qualified reach', ctaIntent: 'Learn more', ctaDestination: null,
        authorizedAssetRefs: ['screenshot you authorised'], brandConstraints: ['plain'],
      } as never,
      strategy: { campaignThesis: 'Coordination should be simpler', messageHierarchy: ['problem', 'product'],
        proofAvailable: ['owner-confirmed description'], proofUnavailable: ['measured outcomes'],
        prohibitedTerminology: ['guaranteed'] } as never,
      ctx: { application: { description: 'Connect with vetted professionals' },
        founderDirection: { contextDelta: 'Improve requests' }, marketIntelligenceAvailable: true } as never,
      concept: CONCEPTS.PROBLEM_RECOGNITION,
      creativePatterns: ['problem-first'],
    });
    expect(brief.objective).toBe('REACH');
    expect(brief.successMetric).toMatch(/reach|hold/i);
    expect(brief.authorizedAssets).toEqual(['screenshot you authorised']);
    expect(brief.prohibitedClaims).toContain('measured outcomes');
    expect(brief).not.toHaveProperty('approval');
    expect(brief).not.toHaveProperty('publish');
  });
});
