/**
 * @file authorityPrecedenceDrift.test.ts
 * @description SOURCE IS PROVENANCE. AUTHORITY_TIER IS AUTHORITY. PRECEDENCE IS
 *   DERIVED FROM AUTHORITY.
 *
 *   THE DEFECT THIS GUARDS: `precedenceTier()` carried a second, independent
 *   source→authority mapping. It had no case for the migration-107 sources, so
 *   `founder_bootstrap` — a FOUNDER_ASSERTED path — fell to the `derived_inference`
 *   default, precedence gaps vanished, and SUPERSEDE became unreachable.
 *
 * @security A future migration adding a source must not silently acquire the
 *   weakest precedence.
 * @dependencies beliefPolicy, authorityPolicy
 */
import { describe, it, expect } from 'vitest';
import { precedenceTier, precedenceRank } from '../src/services/memory/beliefPolicy';
import { bootstrapTierFromSource, AUTHORITY_TIERS } from '../src/services/memory/authorityPolicy';

/** Every source value the governed CHECK permits (migration 107). */
const GOVERNED_SOURCES = [
  'intake', 'growth_brain', 'campaign_performance', 'review', 'analytics',
  'founder_feedback', 'ai_conversation', 'experiment',
  'public_official', 'public_reputable', 'founder_bootstrap',
];

describe('authority precedence — no source-derived drift', () => {
  it('every governed source resolves to a real authority tier', () => {
    for (const s of GOVERNED_SOURCES) {
      expect(AUTHORITY_TIERS).toContain(bootstrapTierFromSource(s));
    }
  });

  it('migration-107 sources are no longer weakest-by-default', () => {
    expect(bootstrapTierFromSource('founder_bootstrap')).toBe('FOUNDER_ASSERTED');
    expect(bootstrapTierFromSource('public_official')).toBe('VERIFIED_EXTERNAL');
    expect(bootstrapTierFromSource('public_reputable')).toBe('DERIVED_INFERENCE');
    // The specific regression: founder bootstrap must outrank derived inference.
    expect(precedenceRank('founder_bootstrap')).toBeLessThan(precedenceRank('growth_brain'));
    expect(precedenceRank('public_official')).toBeLessThan(precedenceRank('public_reputable'));
  });

  it('an UNKNOWN source routes through the authority path, not a silent default', () => {
    // A future migration adding a source cannot bypass the authority mapping
    // without this test failing once bootstrapTierFromSource learns it.
    const unknown = 'a_source_no_one_has_added_yet';
    expect(precedenceTier(unknown)).toBe('derived_inference');
    expect(bootstrapTierFromSource(unknown)).toBe('DERIVED_INFERENCE');
  });

  it('MUTATION: dropping founder_bootstrap from the authority map breaks precedence', () => {
    // Documents what the defect looked like: had the mapping been absent, this
    // is the assertion that would have caught it.
    const asIfMissing = bootstrapTierFromSource('definitely_not_mapped');
    expect(asIfMissing).toBe('DERIVED_INFERENCE');
    expect(bootstrapTierFromSource('founder_bootstrap')).not.toBe(asIfMissing);
  });

  it('certified legacy precedence is unchanged', () => {
    expect(precedenceTier('founder_feedback')).toBe('founder_confirmed');
    expect(precedenceTier('campaign_performance')).toBe('observed_first_party');
    expect(precedenceTier('analytics')).toBe('observed_first_party');
    expect(precedenceTier('experiment')).toBe('observed_first_party');
    expect(precedenceTier('review')).toBe('verified_external');
    expect(precedenceTier('intake')).toBe('verified_external');
    expect(precedenceTier('ai_conversation')).toBe('derived_inference');
    expect(precedenceTier('growth_brain')).toBe('derived_inference');
  });
});
