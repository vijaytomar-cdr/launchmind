/**
 * @file governedAuthorityInvariance.test.ts
 * @description The canonical invariant, per Codex review:
 *
 *   A NEW governed source with a populated `authority_tier` must behave correctly
 *   WITHOUT anyone adding a case to any source-precedence switch.
 *
 *   The previous drift test only checked known source names, which cannot detect
 *   the failure mode — governed logic silently falling back to source interpretation.
 *
 * @security Founder authority must never be reachable by a weaker challenger,
 *   whatever its source string.
 * @dependencies beliefPolicy, authorityPolicy, memoryPromotionPolicy
 */
import { describe, it, expect } from 'vitest';
import { decideWithAuthority, precedenceTier } from '../src/services/memory/beliefPolicy';
import {
  authorityPrecedenceRank, AUTHORITY_RETRIEVAL_WEIGHT, bootstrapTierFromSource,
} from '../src/services/memory/authorityPolicy';
import { decidePromotion, type ComparedMemory } from '../src/services/memory/memoryPromotionPolicy';

/** Deliberately absent from EVERY source-precedence switch in the codebase. */
const FUTURE_SOURCE = 'future_verified_source';

const incumbent = (tier: string, source: string, legacy = false): ComparedMemory => ({
  memoryId: 'm1', version: 1, scope: { channel: 'meta' }, scopeKey: 'a'.repeat(64),
  memoryClass: 'FACT', authorityTier: tier as never, source, isLegacy: legacy,
  status: 'active', confidence: 0.6, classification: 'CONTRADICTION',
  decidedBy: 'model_assisted', finalRank: 1, existingIndependenceKeys: ['k9'],
});

const promote = (incTier: string, incSrc: string, chalTier: string, chalSrc: string, legacy = false) =>
  decidePromotion({
    memoryClass: 'FACT', authorityTier: chalTier as never, candidateSource: chalSrc,
    scope: { channel: 'meta' }, scopeKey: 'a'.repeat(64),
    evidenceIndependenceKeys: ['k1', 'k2'],
    related: [incumbent(incTier, incSrc, legacy)],
  });

describe('governed authority invariance — source must not veto authority', () => {
  it('an UNKNOWN governed source with VERIFIED_EXTERNAL behaves as VERIFIED_EXTERNAL', () => {
    // The source is in no switch anywhere; only the persisted tier is populated.
    expect(bootstrapTierFromSource(FUTURE_SOURCE)).toBe('DERIVED_INFERENCE');   // source says nothing
    const d = promote('DERIVED_INFERENCE', 'growth_brain', 'VERIFIED_EXTERNAL', FUTURE_SOURCE);
    expect(d.outcome).toBe('SUPERSEDE');          // behaves on the TIER, not the source
    expect(d.requiresFounderReview).toBe(false);
  });

  it('GOVERNED SOURCE INVARIANCE: changing only the source changes nothing', () => {
    const known   = promote('DERIVED_INFERENCE', 'growth_brain', 'VERIFIED_EXTERNAL', 'public_official');
    const unknown = promote('DERIVED_INFERENCE', 'growth_brain', 'VERIFIED_EXTERNAL', FUTURE_SOURCE);
    expect(unknown.outcome).toBe(known.outcome);
    expect(unknown.reasonCode).toBe(known.reasonCode);
    expect(unknown.requiresFounderReview).toBe(known.requiresFounderReview);
    expect(unknown.beliefAction).toBe(known.beliefAction);
  });

  it('retrieval weighting follows the tier, not the source name', () => {
    expect(AUTHORITY_RETRIEVAL_WEIGHT.VERIFIED_EXTERNAL).toBeGreaterThan(AUTHORITY_RETRIEVAL_WEIGHT.DERIVED_INFERENCE);
    expect(AUTHORITY_RETRIEVAL_WEIGHT.FOUNDER_ASSERTED).toBeGreaterThan(AUTHORITY_RETRIEVAL_WEIGHT.VERIFIED_EXTERNAL);
    // A governed VERIFIED_EXTERNAL row must not be weighted at the 1.0 unknown default.
    expect(AUTHORITY_RETRIEVAL_WEIGHT.VERIFIED_EXTERNAL).toBeGreaterThan(1.0);
  });

  it('founder authority is NOT overridable by an unknown-source challenger', () => {
    const d = promote('FOUNDER_ASSERTED', 'founder_bootstrap', 'VERIFIED_EXTERNAL', FUTURE_SOURCE);
    expect(d.outcome).toBe('CHALLENGE');
    expect(d.requiresFounderReview).toBe(true);
  });

  it('equal authority invents no precedence, whatever the sources', () => {
    const d = promote('VERIFIED_EXTERNAL', 'public_official', 'VERIFIED_EXTERNAL', FUTURE_SOURCE);
    expect(d.outcome).toBe('CHALLENGE');
  });

  it('tier ranks are strictly ordered founder > observed > external > derived', () => {
    expect(authorityPrecedenceRank('FOUNDER_ASSERTED')).toBeLessThan(authorityPrecedenceRank('OBSERVED_FIRST_PARTY'));
    expect(authorityPrecedenceRank('OBSERVED_FIRST_PARTY')).toBeLessThan(authorityPrecedenceRank('VERIFIED_EXTERNAL'));
    expect(authorityPrecedenceRank('VERIFIED_EXTERNAL')).toBeLessThan(authorityPrecedenceRank('DERIVED_INFERENCE'));
  });

  // ── LEGACY (no persisted tier) ──────────────────────────────────────────
  it('LEGACY null-tier with a recognised source preserves legacy behaviour', () => {
    expect(precedenceTier('founder_feedback')).toBe('founder_confirmed');
    expect(precedenceTier('review')).toBe('verified_external');
    expect(precedenceTier('intake')).toBe('verified_external');
    expect(precedenceTier('growth_brain')).toBe('derived_inference');
  });

  it('LEGACY null-tier with an UNKNOWN source falls back conservatively', () => {
    expect(precedenceTier(FUTURE_SOURCE)).toBe('derived_inference');   // no escalation
    expect(() => precedenceTier('')).not.toThrow();
    const d = decideWithAuthority('CONTRADICTION', 'DERIVED_INFERENCE', 'DERIVED_INFERENCE');
    expect(d.action).toBe('challenge');
  });
});
