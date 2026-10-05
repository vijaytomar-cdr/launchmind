import { describe, expect, it } from 'vitest';
import { evaluateCreativeConceptQuality } from '../src/services/content/creativeQualityGate';

const base = {
  concept: 'PROBLEM_RECOGNITION' as const,
  productName: 'AllignX',
  audience: 'Time-pressed homeowners',
  channel: 'META_AD',
  hasAssetPlan: true,
  governanceEligible: true,
};

describe('pre-render creative quality gate', () => {
  it('rejects polished but interchangeable fallback copy without a score', () => {
    const verdict = evaluateCreativeConceptQuality({
      ...base,
      payload: {
        headline: 'Home services made easy.',
        primaryText: 'AllignX connects time-pressed homeowners with vetted professionals.',
      },
    });
    expect(verdict.state).toBe('NEEDS_IMPROVEMENT');
    expect(verdict.blocking.map(f => f.dimension)).toEqual(
      expect.arrayContaining(['SPECIFICITY', 'DISTINCTIVENESS']));
    expect(verdict).not.toHaveProperty('score');
    expect(JSON.stringify(verdict)).not.toMatch(/viral|winner|guarantee/i);
  });

  it('accepts a specific governed concept only as a publishable candidate', () => {
    const verdict = evaluateCreativeConceptQuality({
      ...base,
      payload: {
        headline: 'Still coordinating one repair through five conversations?',
        primaryText: 'AllignX connects time-pressed homeowners with trusted, vetted neighborhood professionals.',
        description: 'See how AllignX works',
      },
    });
    expect(verdict.state).toBe('PUBLISHABLE_CANDIDATE');
    expect(verdict.blocking).toEqual([]);
    expect(verdict.performanceKnown).toBe(false);
  });

  it('cannot convert failed governance into creative readiness', () => {
    const verdict = evaluateCreativeConceptQuality({
      ...base,
      governanceEligible: false,
      payload: {
        headline: 'Still coordinating one repair through five conversations?',
        primaryText: 'AllignX connects time-pressed homeowners with trusted professionals.',
      },
    });
    expect(verdict.state).toBe('NEEDS_IMPROVEMENT');
    expect(verdict.blocking.some(f => f.dimension === 'GOVERNANCE')).toBe(true);
  });

  it('requires an explicit asset plan before rendering', () => {
    const verdict = evaluateCreativeConceptQuality({
      ...base,
      hasAssetPlan: false,
      payload: {
        headline: 'Still coordinating one repair through five conversations?',
        primaryText: 'AllignX connects time-pressed homeowners with trusted professionals.',
      },
    });
    expect(verdict.blocking.some(f => f.dimension === 'ASSET_PLAN')).toBe(true);
  });
});
