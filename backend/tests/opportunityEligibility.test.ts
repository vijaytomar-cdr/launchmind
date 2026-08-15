/**
 * @file opportunityEligibility.test.ts
 * @description Starter opportunities must fit the product that has them.
 *
 *   THE DEFECT: three hardcoded templates for every product, with invented
 *   evidence. LaunchMind — pre-launch, no listing — was told to "Add high-intent
 *   keywords to Launchmind ASO title". AllignX, with ZERO reviews, was told
 *   "4 recent 1-star reviews mention the same onboarding friction" and
 *   "Rating: 4.2 → 4.1 (7d)".
 *
 * @security None — pure function of product state.
 * @dependencies opportunityEligibility
 */

import { describe, it, expect } from 'vitest';
import { readCapabilities, eligibleOpportunities } from '../src/services/opportunityEligibility';

const gen = (meta: Record<string, unknown>, maturity?: string) =>
  eligibleOpportunities('TestApp', readCapabilities({ maturity, scraped_meta: meta, markets: [] }));
const text = (o: ReturnType<typeof eligibleOpportunities>) => JSON.stringify(o).toLowerCase();

describe('PRE-LAUNCH with no public sources', () => {
  const opps = gen({ preLaunch: true, stores: [], websiteMeta: {} }, 'pre_launch');

  it('produces ZERO store recommendations — the reported defect', () => {
    expect(opps.some(o => o.type === 'aso')).toBe(false);
    expect(text(opps)).not.toContain('app store');
    expect(text(opps)).not.toContain('google play');
    expect(text(opps)).not.toContain('aso');
  });

  it('offers launch-appropriate advice instead of nothing', () => {
    expect(opps.map(o => o.type)).toContain('launch_prep');
    expect(opps.length).toBeGreaterThan(0);
  });

  it('never claims reviews or ratings it has not seen', () => {
    expect(text(opps)).not.toContain('review');
    expect(text(opps)).not.toContain('rating');
  });
});

describe('APP STORE product', () => {
  const opps = gen({ stores: [{ platform: 'app_store', data: {} }], websiteMeta: {} }, 'growing');

  it('makes store optimisation eligible', () => {
    expect(opps.some(o => o.type === 'aso')).toBe(true);
    expect(text(opps)).toContain('app store');
  });

  it('does NOT assume Google Play', () => {
    expect(text(opps)).not.toContain('google play');
  });

  it('does NOT invent reviews when none were read', () => {
    // AllignX's real state: a listing, zero reviews.
    expect(opps.some(o => o.type === 'review_risk')).toBe(false);
  });
});

describe('WEBSITE-only product', () => {
  const opps = gen({ stores: [], websiteMeta: { title: 'X', description: 'Y' } }, 'early');

  it('makes no App Store assumptions', () => {
    expect(opps.some(o => o.type === 'aso')).toBe(false);
    expect(text(opps)).not.toContain('app store');
  });

  it('offers website-appropriate advice', () => {
    expect(opps.some(o => o.type === 'seo_content')).toBe(true);
  });
});

describe('MULTI-STORE product', () => {
  const opps = gen({
    stores: [{ platform: 'app_store', data: {} }, { platform: 'play_store', data: {} }],
    websiteMeta: { title: 'X' }, reviews: [{ text: 'ok', rating: 4 }],
  }, 'growing');

  it('names both stores', () => {
    expect(text(opps)).toContain('app store');
    expect(text(opps)).toContain('google play');
  });

  it('allows review advice because reviews genuinely exist', () => {
    expect(opps.some(o => o.type === 'review_risk')).toBe(true);
  });
});

describe('evidence is never fabricated', () => {
  it('no opportunity cites a metric LaunchMind never measured', () => {
    for (const meta of [
      { preLaunch: true, stores: [], websiteMeta: {} },
      { stores: [{ platform: 'app_store', data: {} }], websiteMeta: {} },
      { stores: [], websiteMeta: { title: 'X' } },
    ]) {
      const t = text(gen(meta));
      // Every one of these appeared in the old hardcoded templates.
      expect(t).not.toMatch(/\+15 positions|22%|3×|60% lower|400m|4\.2|0\.1|8%/);
    }
  });

  it('expected_impact is null rather than an invented percentage', () => {
    for (const o of gen({ stores: [{ platform: 'app_store', data: {} }], websiteMeta: {} })) {
      expect(o.expected_impact).toBeNull();
    }
  });

  it('an empty product yields NO opportunities rather than filler', () => {
    expect(gen({})).toEqual([]);
  });

  it('never emits more than three', () => {
    const opps = gen({
      stores: [{ platform: 'app_store', data: {} }, { platform: 'play_store', data: {} }],
      websiteMeta: { title: 'X' }, reviews: [{ text: 'a', rating: 1 }], preLaunch: false,
    }, 'growing');
    expect(opps.length).toBeLessThanOrEqual(3);
  });
});

describe('legacy products are classified correctly', () => {
  it('a pre-stores[] product with a flat platform still counts as a listing', () => {
    // AllignX's real shape: onboarded before multi-store discovery.
    const opps = gen({ platform: 'app_store', name: 'AllignX', websiteMeta: { title: 'x' } }, 'growing');
    expect(opps.some(o => o.type === 'aso')).toBe(true);
  });
});
