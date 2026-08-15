/**
 * @file publicSourceAuthority.test.ts
 * @description Public/external provenance is representable, and can never become
 *   founder authority.
 * @security The central assertion: a `system` actor with the best possible public
 *   source still cannot reach a FOUNDER_* tier.
 * @dependencies authorityPolicy
 */
import { describe, it, expect } from 'vitest';
import { authorityForCandidate, isFounderAuthority, AUTHORITY_TIERS } from '../src/services/memory/authorityPolicy';

describe('public source provenance', () => {
  it('official primary public source reaches VERIFIED_EXTERNAL', () => {
    const a = authorityForCandidate({ actorType: 'system', kind: 'public_source_official' });
    expect(a.tier).toBe('VERIFIED_EXTERNAL');
  });

  it('reputable secondary reporting stays DERIVED_INFERENCE', () => {
    const a = authorityForCandidate({ actorType: 'system', kind: 'public_source_reputable' });
    expect(a.tier).toBe('DERIVED_INFERENCE');
  });

  it('VERIFIED_EXTERNAL outranks DERIVED_INFERENCE but not first-party observation', () => {
    const rank = (t: string) => AUTHORITY_TIERS.indexOf(t as never);
    expect(rank('VERIFIED_EXTERNAL')).toBeLessThan(rank('DERIVED_INFERENCE'));
    expect(rank('VERIFIED_EXTERNAL')).toBeGreaterThan(rank('OBSERVED_FIRST_PARTY'));
  });

  it('NEITHER public tier is founder authority', () => {
    expect(isFounderAuthority('VERIFIED_EXTERNAL')).toBe(false);
    expect(isFounderAuthority('DERIVED_INFERENCE')).toBe(false);
  });

  it('a system actor can NEVER reach a founder tier, whatever the source', () => {
    for (const kind of ['public_source_official', 'public_source_reputable', 'founder_context', 'anything']) {
      const a = authorityForCandidate({ actorType: 'system', kind });
      expect(isFounderAuthority(a.tier)).toBe(false);
    }
  });

  it('claim text asserting founder authority does not grant it', () => {
    const a = authorityForCandidate({
      actorType: 'system', kind: 'public_source_official',
    });
    expect(a.tier).toBe('VERIFIED_EXTERNAL');
    expect(isFounderAuthority(a.tier)).toBe(false);
  });
});
